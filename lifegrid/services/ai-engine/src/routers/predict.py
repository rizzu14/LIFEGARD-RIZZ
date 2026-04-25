"""
LIFEGRID AI Engine – Prediction Router
Flood, Weather, NDVI/Agricultural stress
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.models.registry import ModelRegistry
from src.cache import CacheManager
import structlog

log = structlog.get_logger()
router = APIRouter()


# ── Flood prediction ──────────────────────────────────────────

class SensorReadingSchema(BaseModel):
    metric: str
    value: float
    unit: str
    isAnomalous: bool = False


class FloodRequest(BaseModel):
    location: Dict[str, float]
    radius_km: float = Field(default=10.0, ge=0.1, le=200.0)
    satellite_bands: Optional[List[List[List[float]]]] = None  # [7][H][W]
    sensor_readings: List[SensorReadingSchema] = []
    rainfall_mm_24h: float = Field(default=0.0, ge=0.0)
    river_level_m: float = Field(default=0.0, ge=0.0)
    soil_moisture_pct: float = Field(default=50.0, ge=0.0, le=100.0)


@router.post("/flood")
async def predict_flood(request: FloodRequest):
    """
    Flood risk prediction using U-Net segmentation + rule engine.

    With satellite_bands: U-Net semantic segmentation on 7-band raster
    Without satellite_bands: Rule engine using sensor + weather data

    Returns: probability, risk level, affected area, 6h/12h/24h forecast
    """
    cached = await CacheManager.get("flood_predict", {
        "lat": request.location.get("lat"), "lng": request.location.get("lng"),
        "rainfall": request.rainfall_mm_24h, "river": request.river_level_m,
    })
    if cached:
        return cached

    if not ModelRegistry.is_ready("flood_predictor"):
        raise HTTPException(503, "Flood predictor not ready")

    predictor = ModelRegistry.get("flood_predictor")
    result = predictor.predict(request.model_dump())

    response = {
        "flood_probability": result.flood_probability,
        "risk_level": result.risk_level,
        "affected_area_km2": result.affected_area_km2,
        "estimated_population": result.estimated_population,
        "forecast_6h": result.forecast_6h,
        "forecast_12h": result.forecast_12h,
        "forecast_24h": result.forecast_24h,
        "risk_zones": [
            {
                "center_lat": z.center_lat,
                "center_lng": z.center_lng,
                "radius_m": z.radius_m,
                "probability": z.probability,
                "risk_level": z.risk_level,
                "estimated_population": z.estimated_population,
            }
            for z in result.risk_zones
        ],
        "confidence": result.confidence,
        "model_used": result.model_used,
        "processing_ms": result.processing_ms,
        "factors": result.factors,
    }

    await CacheManager.set("flood_predict", {}, response, ttl=300)
    return response


# ── Weather prediction ────────────────────────────────────────

class WeatherRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    sensor_readings: List[SensorReadingSchema] = []
    wind_speed_kmh: float = Field(default=0.0, ge=0.0)
    rainfall_mm_1h: float = Field(default=0.0, ge=0.0)
    rainfall_mm_3h: float = Field(default=0.0, ge=0.0)
    cape_jkg: float = Field(default=0.0, ge=0.0)
    pressure_hpa: float = Field(default=1013.0, ge=800.0, le=1100.0)
    temp_c: float = Field(default=20.0, ge=-80.0, le=60.0)
    humidity_pct: float = Field(default=50.0, ge=0.0, le=100.0)
    satellite_data: Optional[Dict[str, Any]] = None
    data_sources: List[str] = []


@router.post("/weather")
async def predict_weather(request: WeatherRequest):
    """
    Weather alert prediction using LightGBM + Prophet ensemble.

    Returns alerts for 1h, 6h, and 24h windows with:
    - Alert type (tornado, hurricane, flash flood, etc.)
    - Severity and probability
    - Onset time and duration
    - Recommended emergency actions
    """
    if not ModelRegistry.is_ready("weather_predictor"):
        raise HTTPException(503, "Weather predictor not ready")

    predictor = ModelRegistry.get("weather_predictor")
    result = predictor.predict(request.model_dump())

    def serialize_alerts(alerts):
        return [
            {
                "alert_type": a.alert_type,
                "severity": a.severity,
                "probability": a.probability,
                "onset_minutes": a.onset_minutes,
                "duration_hours": a.duration_hours,
                "affected_radius_km": a.affected_radius_km,
                "description": a.description,
                "recommended_actions": a.recommended_actions,
            }
            for a in alerts
        ]

    return {
        "location": {"lat": result.location_lat, "lng": result.location_lng},
        "current_conditions": result.current_conditions,
        "alerts_1h": serialize_alerts(result.alerts_1h),
        "alerts_6h": serialize_alerts(result.alerts_6h),
        "alerts_24h": serialize_alerts(result.alerts_24h),
        "overall_risk": result.overall_risk,
        "confidence": result.confidence,
        "model_used": result.model_used,
        "processing_ms": result.processing_ms,
        "data_sources": result.data_sources,
    }


# ── NDVI / Agricultural stress ────────────────────────────────

class NDVIBandsSchema(BaseModel):
    blue:  Optional[List[List[float]]] = None   # B2
    green: Optional[List[List[float]]] = None   # B3
    red:   List[List[float]]                    # B4 (required)
    nir:   List[List[float]]                    # B8 (required)
    swir1: Optional[List[List[float]]] = None   # B11


class NDVIRequest(BaseModel):
    location: Dict[str, float]
    bands: NDVIBandsSchema
    acquisition_date: Optional[str] = None
    historical_baseline: Optional[Dict[str, float]] = None


@router.post("/ndvi")
async def analyze_ndvi(request: NDVIRequest):
    """
    Agricultural stress analysis using NDVI, NDWI, EVI, SAVI.

    Detects:
    - Drought stress (NDVI < 0.2, NDWI < -0.3)
    - Flood inundation (NDWI > 0.3)
    - Fire risk (dry biomass: NDVI < 0.15, EVI < 0.1)

    Compares against historical baseline for anomaly detection.
    """
    if not ModelRegistry.is_ready("ndvi_analyzer"):
        raise HTTPException(503, "NDVI analyzer not ready")

    analyzer = ModelRegistry.get("ndvi_analyzer")
    result = analyzer.analyze(request.model_dump())

    return {
        "ndvi_mean": result.ndvi_mean,
        "ndvi_min": result.ndvi_min,
        "ndvi_max": result.ndvi_max,
        "ndvi_std": result.ndvi_std,
        "ndwi_mean": result.ndwi_mean,
        "evi_mean": result.evi_mean,
        "savi_mean": result.savi_mean,
        "stress_type": result.stress_type,
        "stress_severity": result.stress_severity,
        "anomaly_score": result.anomaly_score,
        "affected_area_pct": result.affected_area_pct,
        "alerts": [
            {
                "alert_type": a.alert_type,
                "severity": a.severity,
                "description": a.description,
                "affected_area_pct": a.affected_area_pct,
                "recommended_actions": a.recommended_actions,
            }
            for a in result.alerts
        ],
        "confidence": result.confidence,
        "processing_ms": result.processing_ms,
        "pixel_count": result.pixel_count,
    }
