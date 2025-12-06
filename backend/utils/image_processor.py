"""
Image processing utilities for component extraction
"""
import cv2
import numpy as np
from PIL import Image
import os
import logging
from typing import List, Tuple, Dict

logger = logging.getLogger(__name__)


class ImageProcessor:
    """Image processor for component extraction and manipulation"""
    
    @staticmethod
    def remove_white_background(image: Image.Image, threshold: int = 240) -> Image.Image:
        """
        Convert white background to transparent
        
        Args:
            image: Input PIL Image (will be converted to RGBA)
            threshold: White detection threshold (0-255), higher = more lenient
            
        Returns:
            PIL Image with transparent background
        """
        try:
            # Convert to RGBA
            img = image.convert("RGBA")
            datas = img.getdata()
            
            new_data = []
            for item in datas:
                r, g, b, a = item
                # If pixel is close to white, make it transparent
                if r >= threshold and g >= threshold and b >= threshold:
                    new_data.append((255, 255, 255, 0))
                else:
                    new_data.append(item)
            
            img.putdata(new_data)
            logger.info(f"Removed white background with threshold {threshold}")
            return img
            
        except Exception as e:
            logger.error(f"Error removing white background: {str(e)}")
            raise
    
    @staticmethod
    def split_foreground_components(
        image: Image.Image, 
        min_area: int = 100,
        max_components: int = 50
    ) -> List[Dict]:
        """
        Split foreground image into connected components
        
        Args:
            image: Input PIL Image (RGBA with transparent background)
            min_area: Minimum area to filter out noise
            max_components: Maximum number of components to extract
            
        Returns:
            List of component dicts with:
                - image: PIL Image of the component
                - bbox: (x, y, width, height) bounding box
                - area: pixel area
        """
        try:
            # Convert to numpy array
            img_np = np.array(image)
            
            # Extract alpha channel
            if img_np.shape[2] == 4:
                alpha = img_np[:, :, 3]
            else:
                # If no alpha channel, treat all non-white as foreground
                gray = cv2.cvtColor(img_np, cv2.COLOR_RGB2GRAY)
                _, alpha = cv2.threshold(gray, 240, 255, cv2.THRESH_BINARY_INV)
            
            # Create binary mask: alpha > 0
            _, mask = cv2.threshold(alpha, 0, 255, cv2.THRESH_BINARY)
            
            # Connected component labeling
            num_labels, labels, stats, centroids = cv2.connectedComponentsWithStats(
                mask, connectivity=8
            )
            
            components = []
            
            # Process each component (skip label 0 which is background)
            for i in range(1, min(num_labels, max_components + 1)):
                area = stats[i, cv2.CC_STAT_AREA]
                
                # Filter out small noise
                if area < min_area:
                    continue
                
                x, y, w, h = stats[i, cv2.CC_STAT_LEFT:cv2.CC_STAT_TOP + 3]
                
                # Create component alpha channel
                component_alpha = np.zeros_like(alpha)
                component_alpha[labels == i] = alpha[labels == i]
                
                # Create RGBA image for this component
                component_rgba = np.zeros_like(img_np)
                if img_np.shape[2] == 4:
                    component_rgba[:, :, :3] = img_np[:, :, :3]
                else:
                    component_rgba[:, :, :3] = img_np
                    component_rgba = np.dstack([component_rgba, np.ones(img_np.shape[:2], dtype=np.uint8) * 255])
                
                component_rgba[:, :, 3] = component_alpha
                
                # Crop to bounding box
                crop = component_rgba[y:y + h, x:x + w]
                
                # Convert to PIL Image
                component_image = Image.fromarray(crop, mode="RGBA")
                
                components.append({
                    'image': component_image,
                    'bbox': (int(x), int(y), int(w), int(h)),
                    'area': int(area),
                    'centroid': (float(centroids[i][0]), float(centroids[i][1]))
                })
            
            logger.info(f"Extracted {len(components)} components from image")
            return components
            
        except Exception as e:
            logger.error(f"Error splitting components: {str(e)}")
            raise
    
    @staticmethod
    def save_components(
        components: List[Dict], 
        output_dir: str, 
        prefix: str = "component"
    ) -> List[str]:
        """
        Save extracted components to disk
        
        Args:
            components: List of component dicts from split_foreground_components
            output_dir: Directory to save components
            prefix: Filename prefix
            
        Returns:
            List of saved file paths
        """
        try:
            os.makedirs(output_dir, exist_ok=True)
            saved_paths = []
            
            for i, component in enumerate(components):
                filename = f"{prefix}_{i}.png"
                filepath = os.path.join(output_dir, filename)
                
                component['image'].save(filepath, "PNG")
                saved_paths.append(filepath)
                
                logger.debug(f"Saved component {i} to {filepath}")
            
            logger.info(f"Saved {len(saved_paths)} components to {output_dir}")
            return saved_paths
            
        except Exception as e:
            logger.error(f"Error saving components: {str(e)}")
            raise
    
    @staticmethod
    def process_for_component_editing(
        image_path: str,
        output_dir: str,
        min_area: int = 100,
        white_threshold: int = 240
    ) -> Tuple[str, List[Dict]]:
        """
        Complete pipeline to process an image for component editing
        
        Args:
            image_path: Path to input image
            output_dir: Directory for output files
            min_area: Minimum component area
            white_threshold: White detection threshold
            
        Returns:
            Tuple of (transparent_image_path, components_list)
        """
        try:
            # Load image
            image = Image.open(image_path)
            
            # Remove white background
            transparent_image = ImageProcessor.remove_white_background(
                image, threshold=white_threshold
            )
            
            # Save transparent version
            os.makedirs(output_dir, exist_ok=True)
            transparent_path = os.path.join(output_dir, "transparent.png")
            transparent_image.save(transparent_path, "PNG")
            
            # Split into components
            components = ImageProcessor.split_foreground_components(
                transparent_image, min_area=min_area
            )
            
            # Save components
            component_paths = ImageProcessor.save_components(
                components, output_dir
            )
            
            # Add file paths to component info
            for i, component in enumerate(components):
                component['path'] = component_paths[i]
            
            return transparent_path, components
            
        except Exception as e:
            logger.error(f"Error in component editing pipeline: {str(e)}")
            raise



