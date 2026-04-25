"""
LIFEGRID AI Engine – Health Router
"""
from fastapi import APIRouter
from src.models.registry import ModelRegistry
from src.cache import CacheManager
from src.config import settings

router = APIRouter()


@router.get("")
async def health():
    """System health check — used by API Gateway and load balancer."""
    models = ModelRegistry.loaded_models()
    ready_count = sum(1 for s in models.values() if s == "ready")
    total_count = len(models)

    return {
        "status": "operational" if ready_count > 0 else "degraded",
        "version": settings.VERSION,
        "models": models,
        "models_ready": ready_count,
        "models_total": total_count,
        "cache_connected": CacheManager.is_connected(),
        "subsystems": {
            "nlp":          models.get("nlp_classifier", "unknown"),
            "dispatch":     models.get("dispatch_engine", "unknown"),
            "flood":        models.get("flood_predictor", "unknown"),
            "weather":      models.get("weather_predictor", "unknown"),
            "ndvi":         models.get("ndvi_analyzer", "unknown"),
            "face_search":  models.get("face_recognizer", "unknown"),
            "safety":       models.get("safety_classifier", "unknown"),
        },
    }
