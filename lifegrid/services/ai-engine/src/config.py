"""
LIFEGRID AI Engine – Configuration
"""
import os
from typing import List
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    PORT: int = int(os.getenv("PORT", "5001"))

    # Redis
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    CACHE_TTL_SECONDS: int = 300

    # CORS
    ALLOWED_ORIGINS: List[str] = os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:4000"
    ).split(",")

    # Model paths
    MODELS_DIR: str = os.getenv("MODELS_DIR", "./models")
    NLP_MODEL_NAME: str = os.getenv("NLP_MODEL_NAME", "distilbert-base-uncased")
    FACE_MODEL_PATH: str = os.getenv("FACE_MODEL_PATH", "./models/arcface.onnx")
    FLOOD_MODEL_PATH: str = os.getenv("FLOOD_MODEL_PATH", "./models/flood_unet.pt")
    SAFETY_MODEL_PATH: str = os.getenv("SAFETY_MODEL_PATH", "./models/safety_svm.joblib")

    # Thresholds
    NLP_CONFIDENCE_THRESHOLD: float = 0.55
    FACE_SIMILARITY_THRESHOLD: float = 0.65   # cosine similarity
    SAFETY_ALERT_LATENCY_MS: int = 3000        # max 3 seconds
    FLOOD_RISK_THRESHOLD: float = 0.70

    # FAISS index
    FACE_INDEX_PATH: str = os.getenv("FACE_INDEX_PATH", "./data/face_index.faiss")
    FACE_METADATA_PATH: str = os.getenv("FACE_METADATA_PATH", "./data/face_metadata.json")

    class Config:
        env_file = ".env"


settings = Settings()
