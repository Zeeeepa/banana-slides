"""
Component Editor Controller
Handles component-level editing of generated slide images
"""
import os
import logging
from flask import Blueprint, request, jsonify, current_app
from models import db, Project, Page
from services.ai_service import AIService
from services.file_service import FileService
from utils.image_processor import ImageProcessor
from PIL import Image
import base64
from io import BytesIO

def success_response(data):
    return jsonify({'success': True, 'data': data}), 200

def error_response(error_type, message, status_code):
    return jsonify({'success': False, 'error': error_type, 'message': message}), status_code

def bad_request(message):
    return jsonify({'success': False, 'error': 'BAD_REQUEST', 'message': message}), 400

logger = logging.getLogger(__name__)

component_editor_bp = Blueprint('component_editor', __name__, url_prefix='/api/projects')


@component_editor_bp.route('/<project_id>/pages/<page_id>/components/prepare', methods=['POST'])
def prepare_component_editing(project_id, page_id):
    """
    POST /api/projects/{project_id}/pages/{page_id}/components/prepare
    Prepare page for component editing:
    1. Generate white background version
    2. Generate pure background version
    3. Extract components from white background version
    
    Request body:
    {
        "min_area": 100,              // Optional: minimum component area
        "white_threshold": 240,       // Optional: white detection threshold
        "force_regenerate": false     // Optional: force regenerate AI images
    }
    
    Response:
    {
        "white_bg_image_url": "/files/...",
        "pure_bg_image_url": "/files/...",
        "components": [
            {
                "id": 0,
                "url": "/files/.../component_0.png",
                "bbox": [x, y, width, height],
                "area": 1234,
                "centroid": [cx, cy]
            }
        ]
    }
    """
    try:
        # Validate project and page
        project = Project.query.filter_by(id=project_id).first()
        if not project:
            return error_response('PROJECT_NOT_FOUND', 'Project not found', 404)
        
        page = Page.query.filter_by(id=page_id, project_id=project_id).first()
        if not page:
            return error_response('PAGE_NOT_FOUND', 'Page not found', 404)
        
        # Check if page has generated image
        if not page.generated_image_path:
            return bad_request("Page must have generated image first")
        
        # Get request parameters
        data = request.get_json() or {}
        min_area = data.get('min_area', 100)
        white_threshold = data.get('white_threshold', 240)
        force_regenerate = data.get('force_regenerate', False)
        
        # Initialize services
        file_service = FileService(current_app)
        ai_service = AIService(
            api_key=current_app.config['GOOGLE_API_KEY'],
            api_base=current_app.config.get('GOOGLE_API_BASE')
        )
        
        # Create output directory for component editing
        output_dir = os.path.join(
            current_app.config['UPLOAD_FOLDER'],
            project_id,
            'pages',
            page_id,
            'components'
        )
        os.makedirs(output_dir, exist_ok=True)
        
        # Check if already processed and not forcing regenerate
        white_bg_path = os.path.join(output_dir, 'white_bg.png')
        pure_bg_path = os.path.join(output_dir, 'pure_bg.png')
        
        if not force_regenerate and os.path.exists(white_bg_path) and os.path.exists(pure_bg_path):
            logger.info(f"Using cached component editing data for page {page_id}")
        else:
            # Step 1: Generate white background version
            logger.info(f"Generating white background version for page {page_id}")
            
            current_image_path = file_service.get_absolute_path(page.generated_image_path)
            
            # Prompt for white background
            white_bg_prompt = (
                "请将这张PPT幻灯片的背景改为纯白色（#FFFFFF），保持所有前景元素（文字、图片、图标等）"
                "完全不变，只改变背景颜色为纯白色。要求：1）背景必须是纯白色 2）所有前景元素位置、大小、"
                "颜色、样式保持完全一致 3）不要添加任何新元素"
            )
            
            white_bg_image = ai_service.edit_image(
                edit_instruction=white_bg_prompt,
                current_image_path=current_image_path,
                aspect_ratio=current_app.config['DEFAULT_ASPECT_RATIO'],
                resolution=current_app.config['DEFAULT_RESOLUTION']
            )
            
            if not white_bg_image:
                return error_response('AI_SERVICE_ERROR', 'Failed to generate white background image', 503)
            
            white_bg_image.save(white_bg_path, "PNG")
            logger.info(f"Saved white background image to {white_bg_path}")
            
            # Step 2: Generate pure background version
            logger.info(f"Generating pure background version for page {page_id}")
            
            pure_bg_prompt = (
                "请移除这张PPT幻灯片中的所有前景元素（包括文字、图片、图标、图表等），"
                "只保留纯粹的背景。要求：1）完全移除所有文字和图形元素 2）保持背景的颜色、"
                "渐变、纹理等样式 3）结果应该是一张干净的背景图"
            )
            
            pure_bg_image = ai_service.edit_image(
                edit_instruction=pure_bg_prompt,
                current_image_path=current_image_path,
                aspect_ratio=current_app.config['DEFAULT_ASPECT_RATIO'],
                resolution=current_app.config['DEFAULT_RESOLUTION']
            )
            
            if not pure_bg_image:
                return error_response('AI_SERVICE_ERROR', 'Failed to generate pure background image', 503)
            
            pure_bg_image.save(pure_bg_path, "PNG")
            logger.info(f"Saved pure background image to {pure_bg_path}")
        
        # Step 3: Extract components from white background image
        logger.info(f"Extracting components from page {page_id}")
        
        white_bg_image = Image.open(white_bg_path)
        
        # Remove white background to get transparent image
        transparent_image = ImageProcessor.remove_white_background(
            white_bg_image, threshold=white_threshold
        )
        
        # Split into components
        components = ImageProcessor.split_foreground_components(
            transparent_image, min_area=min_area
        )
        
        # Save components and prepare response
        component_data = []
        for i, comp in enumerate(components):
            comp_filename = f"component_{i}.png"
            comp_path = os.path.join(output_dir, comp_filename)
            comp['image'].save(comp_path, "PNG")
            
            # Create relative path for URL
            relative_path = os.path.relpath(comp_path, current_app.config['UPLOAD_FOLDER'])
            comp_url = f"/files/{relative_path.replace(os.sep, '/')}"
            
            component_data.append({
                'id': i,
                'url': comp_url,
                'bbox': comp['bbox'],
                'area': comp['area'],
                'centroid': comp['centroid']
            })
        
        # Create URLs for background images
        white_bg_url = f"/files/{project_id}/pages/{page_id}/components/white_bg.png"
        pure_bg_url = f"/files/{project_id}/pages/{page_id}/components/pure_bg.png"
        
        logger.info(f"Successfully prepared component editing for page {page_id} with {len(component_data)} components")
        
        return success_response({
            'white_bg_image_url': white_bg_url,
            'pure_bg_image_url': pure_bg_url,
            'components': component_data
        })
        
    except Exception as e:
        logger.error(f"Error preparing component editing: {str(e)}", exc_info=True)
        return error_response('INTERNAL_ERROR', str(e), 500)


@component_editor_bp.route('/<project_id>/pages/<page_id>/components/save', methods=['POST'])
def save_component_layout(project_id, page_id):
    """
    POST /api/projects/{project_id}/pages/{page_id}/components/save
    Save the edited component layout as a new page image
    
    Request body:
    {
        "canvas_data_url": "data:image/png;base64,..."  // Canvas as data URL
    }
    
    Response:
    {
        "image_url": "/files/...",
        "updated_at": "2024-01-01T00:00:00"
    }
    """
    try:
        # Validate project and page
        project = Project.query.filter_by(id=project_id).first()
        if not project:
            return error_response('PROJECT_NOT_FOUND', 'Project not found', 404)
        
        page = Page.query.filter_by(id=page_id, project_id=project_id).first()
        if not page:
            return error_response('PAGE_NOT_FOUND', 'Page not found', 404)
        
        # Get canvas data
        data = request.get_json()
        if not data or 'canvas_data_url' not in data:
            return bad_request("canvas_data_url is required")
        
        canvas_data_url = data['canvas_data_url']
        
        # Parse data URL
        if not canvas_data_url.startswith('data:image/png;base64,'):
            return bad_request("Invalid canvas data URL format")
        
        # Extract base64 data
        base64_data = canvas_data_url.split(',')[1]
        image_data = base64.b64decode(base64_data)
        
        # Convert to PIL Image
        image = Image.open(BytesIO(image_data))
        
        # Initialize file service
        file_service = FileService(current_app)
        
        # Save as new version of page image
        image_path = file_service.save_generated_image(
            image=image,
            project_id=project_id,
            page_id=page_id
        )
        
        # Update page
        page.generated_image_path = image_path
        page.updated_at = db.func.now()
        db.session.commit()
        
        logger.info(f"Saved component layout for page {page_id}")
        
        return success_response({
            'image_url': f"/files/{image_path}",
            'updated_at': page.updated_at.isoformat() if page.updated_at else None
        })
        
    except Exception as e:
        logger.error(f"Error saving component layout: {str(e)}", exc_info=True)
        db.session.rollback()
        return error_response('INTERNAL_ERROR', str(e), 500)


