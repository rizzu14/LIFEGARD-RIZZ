import os

class Settings:
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"
    PORT: int = int(os.getenv("PORT", "5002"))
    KAFKA_BROKERS: list = os.getenv("KAFKA_BROKERS", "localhost:9092").split(",")
    REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379")
    DATABASE_URL: str = os.getenv("DATABASE_URL", "postgresql://lifegrid:lifegrid@localhost:5432/lifegrid")
    MODELS_DIR: str = os.getenv("MODELS_DIR", "./models")
    DEM_DATA_DIR: str = os.getenv("DEM_DATA_DIR", "./data/dem")
    SATELLITE_DATA_DIR: str = os.getenv("SATELLITE_DATA_DIR", "./data/satellite")

settings = Settings()
