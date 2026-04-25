"""
LIFEGRID AI Engine – Model Registry
Central loader and health tracker for all AI models.
"""
import asyncio
from typing import Dict, Any
import structlog

log = structlog.get_logger()


class ModelRegistry:
    """
    Lazy-loads all AI models at startup.
    Each model is isolated — a failure in one does not block others.
    """
    _models: Dict[str, Any] = {}
    _status: Dict[str, str] = {}

    @classmethod
    async def initialize(cls) -> None:
        """Load all models concurrently with individual error isolation."""
        tasks = [
            ("nlp_classifier",    cls._load_nlp),
            ("dispatch_engine",   cls._load_dispatch),
            ("flood_predictor",   cls._load_flood),
            ("weather_predictor", cls._load_weather),
            ("ndvi_analyzer",     cls._load_ndvi),
            ("face_recognizer",   cls._load_face),
            ("safety_classifier", cls._load_safety),
        ]

        results = await asyncio.gather(
            *[cls._safe_load(name, loader) for name, loader in tasks],
            return_exceptions=True,
        )

        for (name, _), result in zip(tasks, results):
            if isinstance(result, Exception):
                log.error("model_load_failed", model=name, error=str(result))
                cls._status[name] = "failed"
            else:
                cls._status[name] = "ready"

        ready = sum(1 for s in cls._status.values() if s == "ready")
        log.info("models_loaded", ready=ready, total=len(tasks))

    @classmethod
    async def _safe_load(cls, name: str, loader) -> None:
        cls._status[name] = "loading"
        model = await asyncio.get_event_loop().run_in_executor(None, loader)
        cls._models[name] = model
        log.info("model_ready", model=name)

    # ── Individual loaders ────────────────────────────────────

    @classmethod
    def _load_nlp(cls):
        from src.models.nlp_classifier import NLPClassifier
        return NLPClassifier()

    @classmethod
    def _load_dispatch(cls):
        from src.models.dispatch_engine import DispatchEngine
        return DispatchEngine()

    @classmethod
    def _load_flood(cls):
        from src.models.flood_predictor import FloodPredictor
        return FloodPredictor()

    @classmethod
    def _load_weather(cls):
        from src.models.weather_predictor import WeatherPredictor
        return WeatherPredictor()

    @classmethod
    def _load_ndvi(cls):
        from src.models.ndvi_analyzer import NDVIAnalyzer
        return NDVIAnalyzer()

    @classmethod
    def _load_face(cls):
        from src.models.face_recognizer import FaceRecognizer
        return FaceRecognizer()

    @classmethod
    def _load_safety(cls):
        from src.models.safety_classifier import SafetyClassifier
        return SafetyClassifier()

    # ── Accessors ─────────────────────────────────────────────

    @classmethod
    def get(cls, name: str) -> Any:
        model = cls._models.get(name)
        if model is None:
            raise RuntimeError(f"Model '{name}' not loaded (status: {cls._status.get(name, 'unknown')})")
        return model

    @classmethod
    def loaded_models(cls) -> Dict[str, str]:
        return dict(cls._status)

    @classmethod
    def is_ready(cls, name: str) -> bool:
        return cls._status.get(name) == "ready"
