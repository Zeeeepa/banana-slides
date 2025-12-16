"""Settings Controller - handles application settings endpoints"""

import logging
from flask import Blueprint, request, current_app
from models import db, Settings
from utils import success_response, error_response, bad_request
from datetime import datetime, timezone
from config import Config

logger = logging.getLogger(__name__)

settings_bp = Blueprint(
    "settings", __name__, url_prefix="/api/settings"
)


# 防止 http://backend:5000/api/settings/ 不加末尾的 / 会返回重定向问题.
@settings_bp.route("/", methods=["GET"], strict_slashes=False)
def get_settings():
    """
    GET /api/settings - Get application settings
    """
    try:
        settings = Settings.get_settings()
        return success_response(settings.to_dict())
    except Exception as e:
        logger.error(f"Error getting settings: {str(e)}")
        return error_response(
            "GET_SETTINGS_ERROR",
            f"Failed to get settings: {str(e)}",
            500,
        )


@settings_bp.route("/", methods=["PUT"], strict_slashes=False)
def update_settings():
    """
    PUT /api/settings - Update application settings

    Request Body:
        {
            "api_base_url": "https://api.example.com",
            "api_key": "your-api-key",
            "image_resolution": "2K",
            "image_aspect_ratio": "16:9"
        }
    """
    try:
        data = request.get_json()
        if not data:
            return bad_request("Request body is required")

        settings = Settings.get_settings()

        # Update AI provider format configuration
        if "ai_provider_format" in data:
            provider_format = data["ai_provider_format"]
            if provider_format not in ["openai", "gemini"]:
                return bad_request("AI provider format must be 'openai' or 'gemini'")
            settings.ai_provider_format = provider_format

        # Update API configuration
        if "api_base_url" in data:
            raw_base_url = data["api_base_url"]
            # 前端传入空字符串时，视为“清除覆盖，回退到 env/default”
            # None / "" / 纯空白 => 存 None，_sync_settings_to_config 会 pop 掉覆盖
            if raw_base_url is None:
                settings.api_base_url = None
            else:
                value = str(raw_base_url).strip()
                settings.api_base_url = value if value != "" else None

        if "api_key" in data:
            settings.api_key = data["api_key"]

        # Update image generation configuration
        if "image_resolution" in data:
            resolution = data["image_resolution"]
            if resolution not in ["1K", "2K", "4K"]:
                return bad_request("Resolution must be 1K, 2K, or 4K")
            settings.image_resolution = resolution

        if "image_aspect_ratio" in data:
            aspect_ratio = data["image_aspect_ratio"]
            settings.image_aspect_ratio = aspect_ratio

        # Update worker configuration
        if "max_description_workers" in data:
            workers = int(data["max_description_workers"])
            if workers < 1 or workers > 20:
                return bad_request(
                    "Max description workers must be between 1 and 20"
                )
            settings.max_description_workers = workers

        if "max_image_workers" in data:
            workers = int(data["max_image_workers"])
            if workers < 1 or workers > 20:
                return bad_request(
                    "Max image workers must be between 1 and 20"
                )
            settings.max_image_workers = workers

        settings.updated_at = datetime.utcnow()
        db.session.commit()

        # Sync to app.config
        _sync_settings_to_config(settings)

        logger.info("Settings updated successfully")
        return success_response(
            settings.to_dict(), "Settings updated successfully"
        )

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error updating settings: {str(e)}")
        return error_response(
            "UPDATE_SETTINGS_ERROR",
            f"Failed to update settings: {str(e)}",
            500,
        )


@settings_bp.route("/reset", methods=["POST"], strict_slashes=False)
def reset_settings():
    """
    POST /api/settings/reset - Reset settings to default values
    """
    try:
        settings = Settings.get_settings()

        # Reset to default values (from Config / .env)
        # 规则：
        # - 先看 AI_PROVIDER_FORMAT
        # - 如果是 openai => 使用 OPENAI_API_BASE / OPENAI_API_KEY
        # - 否则（默认为 gemini）=> 使用 GOOGLE_API_BASE / GOOGLE_API_KEY
        settings.ai_provider_format = Config.AI_PROVIDER_FORMAT

        if (Config.AI_PROVIDER_FORMAT or '').lower() == 'openai':
            default_api_base = Config.OPENAI_API_BASE or None
            default_api_key = Config.OPENAI_API_KEY or None
        else:
            default_api_base = Config.GOOGLE_API_BASE or None
            default_api_key = Config.GOOGLE_API_KEY or None

        settings.api_base_url = default_api_base
        settings.api_key = default_api_key
        settings.image_resolution = Config.DEFAULT_RESOLUTION
        settings.image_aspect_ratio = Config.DEFAULT_ASPECT_RATIO
        settings.max_description_workers = Config.MAX_DESCRIPTION_WORKERS
        settings.max_image_workers = Config.MAX_IMAGE_WORKERS
        settings.updated_at = datetime.now(timezone.utc)

        db.session.commit()

        # Sync to app.config
        _sync_settings_to_config(settings)

        logger.info("Settings reset to defaults")
        return success_response(
            settings.to_dict(), "Settings reset to defaults"
        )

    except Exception as e:
        db.session.rollback()
        logger.error(f"Error resetting settings: {str(e)}")
        return error_response(
            "RESET_SETTINGS_ERROR",
            f"Failed to reset settings: {str(e)}",
            500,
        )


def _sync_settings_to_config(settings: Settings):
    """Sync settings to Flask app config"""
    # Sync AI provider format (always sync, has default value)
    if settings.ai_provider_format:
        current_app.config["AI_PROVIDER_FORMAT"] = settings.ai_provider_format
        logger.info(f"Updated AI_PROVIDER_FORMAT to: {settings.ai_provider_format}")
    
    # Sync API configuration
    # Note: We sync even if value is None/empty to allow clearing settings
    # But we only log if there's an actual value
    if settings.api_base_url is not None:
        # 同步到两套配置，确保优先使用数据库值而不是环境变量
        current_app.config["GOOGLE_API_BASE"] = settings.api_base_url
        current_app.config["OPENAI_API_BASE"] = settings.api_base_url
        logger.info(f"[SYNC] Updated API_BASE in app.config to: '{settings.api_base_url}' (type: {type(settings.api_base_url).__name__})")
        # Verify it was set correctly
        for key in ("GOOGLE_API_BASE", "OPENAI_API_BASE"):
            if key in current_app.config:
                logger.info(f"[SYNC] Verified {key} in app.config: '{current_app.config[key]}'")
            else:
                logger.error(f"[SYNC] ERROR: {key} was not set in app.config!")
    else:
        # 移除覆盖，让环境变量或默认值接管
        current_app.config.pop("GOOGLE_API_BASE", None)
        current_app.config.pop("OPENAI_API_BASE", None)

    if settings.api_key is not None:
        current_app.config["GOOGLE_API_KEY"] = settings.api_key
        current_app.config["OPENAI_API_KEY"] = settings.api_key
        if settings.api_key:
            logger.info("Updated API key from settings (applied to GOOGLE_API_KEY & OPENAI_API_KEY)")
        else:
            logger.info("Cleared API key in settings (fall back to env/default)")
    else:
        current_app.config.pop("GOOGLE_API_KEY", None)
        current_app.config.pop("OPENAI_API_KEY", None)

    # Sync image generation settings
    current_app.config['DEFAULT_RESOLUTION'] = settings.image_resolution
    current_app.config['DEFAULT_ASPECT_RATIO'] = settings.image_aspect_ratio
    logger.info(f"Updated image settings: {settings.image_resolution}, {settings.image_aspect_ratio}")

    # Sync worker settings
    current_app.config['MAX_DESCRIPTION_WORKERS'] = settings.max_description_workers
    current_app.config['MAX_IMAGE_WORKERS'] = settings.max_image_workers
    logger.info(f"Updated worker settings: desc={settings.max_description_workers}, img={settings.max_image_workers}")
