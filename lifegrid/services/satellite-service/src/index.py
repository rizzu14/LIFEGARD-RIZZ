"""
============================================================
LIFEGRID – Satellite Data Integration Service
Port: 5002

Satellite sources:
  NISAR     – NASA/ISRO SAR (soil moisture, agriculture, deformation)
  INSAT-3DS – ISRO weather satellite (lightning, rainfall, SST)
  Sentinel-1 – ESA SAR (flood detection, change detection)
  Sentinel-2 – ESA optical (NDVI, NDWI, EVI, SAVI)
  GOES-16/17 – NOAA weather (convection, lightning, fire)
  Landsat-9  – USGS thermal (LST, fire hotspots)

Processing pipeline:
  1. Ingest raw satellite data (HDF5, NetCDF, GeoTIFF)
  2. Preprocess (calibration, atmospheric correction, reprojection)
  3. Compute indices (NDVI, NDWI, EVI, SAVI, CAPE, etc.)
  4. Anomaly detection (Z-score, threshold, U-Net)
  5. 3D terrain flood depth estimation (DEM + SAR)
  6. Alert generation
  7. Publish to Kafka

Consumes:
  lifegrid.satellite.nisar.ingest
  lifegrid.satellite.insat.ingest
  lifegrid.satellite.sentinel.ingest

Produces:
  lifegrid.satellite.processed
  lifegrid.satellite.alert
  lifegrid.incident.triggered (for critical alerts)
============================================================
"""

import asyncio
import os
import time
import json
import logging
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List

import numpy as np
import structlog
from fastapi import FastAPI, BackgroundTasks, HTTPException
from pydantic import BaseModel
import uvicorn

from src.processors.nisar_processor import NISARProcessor
from src.processors.insat_processor import INSATProcessor
from src.processors.sentinel_processor import SentinelProcessor
from src.processors.goes_processor import GOESProcessor
from src.algorithms.ndvi import compute_ndvi, compute_ndwi, compute_evi, compute_savi
from src.algorithms.flood_detection import FloodDetector
from src.algorithms.anomaly_detection import ZScoreAnomalyDetector
from src.algorithms.terrain_analysis import TerrainAnalyzer
from src.kafka_client import KafkaProducer, KafkaConsumer
from src.config import settings

log = structlog.get_logger()

app = FastAPI(
    title="LIFEGRID Satellite Service",
    version="1.0.0",
    docs_url="/docs" if settings.DEBUG else None,
)

# ── Initialize processors ─────────────────────────────────────

nisar_processor    = NISARProcessor()
insat_processor    = INSATProcessor()
sentinel_processor = SentinelProcessor()
goes_processor     = GOESProcessor()
flood_detector     = FloodDetector()
anomaly_detector   = ZScoreAnomalyDetector()
terrain_analyzer   = TerrainAnalyzer()
kafka_producer     = KafkaProducer()


# ── Request schemas ───────────────────────────────────────────

class SatelliteIngestRequest(BaseModel):
    source: str          # NISAR | INSAT_3DS | SENTINEL_1 | SENTINEL_2 | GOES_16 | LANDSAT_9
    scene_id: str
    acquisition_time: str
    bounding_box: Dict[str, float]  # {min_lat, max_lat, min_lng, max_lng}
    data_url: Optional[str] = None  # S3/GCS URL to raw data
    bands: Optional[Dict[str, List[List[float]]]] = None  # inline band data
    metadata: Optional[Dict[str, Any]] = None


class ProcessingResult(BaseModel):
    scene_id: str
    source: str
    processed_at: str
    indices: Dict[str, float]
    anomalies: List[Dict]
    alerts: List[Dict]
    flood_zones: List[Dict]
    processing_ms: float


# ── Main processing pipeline ──────────────────────────────────

async def process_satellite_scene(request: SatelliteIngestRequest) -> ProcessingResult:
    t0 = time.perf_counter()
    log.info("processing_satellite_scene", source=request.source, scene_id=request.scene_id)

    indices = {}
    anomalies = []
    alerts = []
    flood_zones = []

    try:
        if request.source in ("SENTINEL_1", "SENTINEL_2"):
            result = await process_sentinel(request)
            indices.update(result.get("indices", {}))
            anomalies.extend(result.get("anomalies", []))
            alerts.extend(result.get("alerts", []))
            flood_zones.extend(result.get("flood_zones", []))

        elif request.source == "NISAR":
            result = await process_nisar(request)
            indices.update(result.get("indices", {}))
            anomalies.extend(result.get("anomalies", []))
            alerts.extend(result.get("alerts", []))

        elif request.source == "INSAT_3DS":
            result = await process_insat(request)
            indices.update(result.get("indices", {}))
            anomalies.extend(result.get("anomalies", []))
            alerts.extend(result.get("alerts", []))

        elif request.source in ("GOES_16", "GOES_17"):
            result = await process_goes(request)
            indices.update(result.get("indices", {}))
            anomalies.extend(result.get("anomalies", []))
            alerts.extend(result.get("alerts", []))

    except Exception as e:
        log.error("satellite_processing_error", source=request.source, error=str(e))

    ms = (time.perf_counter() - t0) * 1000

    processed = ProcessingResult(
        scene_id=request.scene_id,
        source=request.source,
        processed_at=datetime.now(timezone.utc).isoformat(),
        indices=indices,
        anomalies=anomalies,
        alerts=alerts,
        flood_zones=flood_zones,
        processing_ms=round(ms, 2),
    )

    # Publish processed result to Kafka
    await kafka_producer.publish(
        topic="lifegrid.satellite.processed",
        key=request.scene_id,
        payload=processed.model_dump(),
    )

    # Publish individual alerts
    for alert in alerts:
        await kafka_producer.publish(
            topic="lifegrid.satellite.alert",
            key=alert.get("alert_id", request.scene_id),
            payload=alert,
        )

        # Trigger incident for CRITICAL alerts
        if alert.get("severity") in ("CRITICAL", "HIGH"):
            await kafka_producer.publish(
                topic="lifegrid.incident.triggered",
                key=alert.get("alert_id"),
                payload={
                    "triggerId":  alert.get("alert_id"),
                    "source":     "SATELLITE",
                    "rawInput":   alert.get("description", "Satellite alert"),
                    "language":   "en",
                    "timestamp":  processed.processed_at,
                    "sensorData": {
                        "deviceId":   request.scene_id,
                        "deviceType": "WEATHER",
                        "location":   alert.get("location", {}),
                        "readings":   [],
                        "timestamp":  processed.processed_at,
                        "protocol":   "SATELLITE",
                    },
                    "metadata": {"source": request.source, "sceneId": request.scene_id},
                },
            )

    log.info("satellite_scene_processed",
             source=request.source, scene_id=request.scene_id,
             alerts=len(alerts), flood_zones=len(flood_zones), ms=round(ms, 2))

    return processed


# ── Source-specific processors ────────────────────────────────

async def process_sentinel(request: SatelliteIngestRequest) -> Dict:
    """Process Sentinel-1 (SAR) and Sentinel-2 (optical) data."""
    bands = request.bands or {}
    result = {"indices": {}, "anomalies": [], "alerts": [], "flood_zones": []}

    if request.source == "SENTINEL_2" and "red" in bands and "nir" in bands:
        red   = np.array(bands["red"],   dtype=np.float32)
        nir   = np.array(bands["nir"],   dtype=np.float32)
        green = np.array(bands.get("green", np.zeros_like(red)), dtype=np.float32)
        blue  = np.array(bands.get("blue",  np.zeros_like(red)), dtype=np.float32)

        # Normalize if in DN range
        if red.max() > 1.0:
            red, nir, green, blue = red/10000, nir/10000, green/10000, blue/10000

        ndvi = compute_ndvi(nir, red)
        ndwi = compute_ndwi(green, nir)
        evi  = compute_evi(nir, red, blue)
        savi = compute_savi(nir, red)

        result["indices"] = {
            "ndvi_mean": float(np.nanmean(ndvi)),
            "ndvi_min":  float(np.nanmin(ndvi)),
            "ndvi_max":  float(np.nanmax(ndvi)),
            "ndwi_mean": float(np.nanmean(ndwi)),
            "evi_mean":  float(np.nanmean(evi)),
            "savi_mean": float(np.nanmean(savi)),
        }

        # Z-score anomaly detection against historical baseline
        baseline = request.metadata.get("baseline", {}) if request.metadata else {}
        anomalies = anomaly_detector.detect(
            ndvi, baseline.get("ndvi_mean", 0.45), baseline.get("ndvi_std", 0.12)
        )
        result["anomalies"] = anomalies

        # Generate vegetation stress alerts
        ndvi_mean = result["indices"]["ndvi_mean"]
        ndwi_mean = result["indices"]["ndwi_mean"]

        if ndwi_mean > 0.3:
            result["alerts"].append({
                "alert_id":    f"flood-{request.scene_id}",
                "type":        "FLOOD_INUNDATION",
                "severity":    "HIGH" if ndwi_mean > 0.5 else "MEDIUM",
                "description": f"Flood inundation detected. NDWI={ndwi_mean:.3f}",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.85,
                "source":      "SENTINEL_2",
            })

        if ndvi_mean < 0.15 and evi.mean() < 0.1:
            result["alerts"].append({
                "alert_id":    f"fire-risk-{request.scene_id}",
                "type":        "FIRE_RISK",
                "severity":    "HIGH",
                "description": f"High fire risk: dry biomass. NDVI={ndvi_mean:.3f}",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.78,
                "source":      "SENTINEL_2",
            })

    elif request.source == "SENTINEL_1" and "sar_vv" in bands:
        # SAR flood detection
        sar_vv = np.array(bands["sar_vv"], dtype=np.float32)
        sar_vh = np.array(bands.get("sar_vh", np.zeros_like(sar_vv)), dtype=np.float32)

        flood_result = flood_detector.detect_from_sar(sar_vv, sar_vh)
        result["indices"]["flood_probability"] = flood_result["probability"]
        result["flood_zones"] = flood_result["zones"]

        if flood_result["probability"] > 0.6:
            result["alerts"].append({
                "alert_id":    f"flood-sar-{request.scene_id}",
                "type":        "FLOOD_DETECTION",
                "severity":    "CRITICAL" if flood_result["probability"] > 0.8 else "HIGH",
                "description": f"SAR flood detection: {flood_result['probability']:.0%} probability. "
                               f"Affected area: {flood_result.get('area_km2', 0):.1f}km²",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  flood_result["confidence"],
                "source":      "SENTINEL_1",
                "flood_zones": flood_result["zones"],
            })

    return result


async def process_nisar(request: SatelliteIngestRequest) -> Dict:
    """
    Process NISAR (NASA/ISRO SAR) data.
    NISAR provides:
      - L-band SAR: soil moisture, vegetation structure, ice dynamics
      - S-band SAR: surface deformation, agricultural monitoring
      - 12-day repeat cycle, 240km swath
    """
    bands = request.bands or {}
    result = {"indices": {}, "anomalies": [], "alerts": []}

    if "l_band_backscatter" in bands:
        l_band = np.array(bands["l_band_backscatter"], dtype=np.float32)

        # Soil moisture estimation from L-band backscatter
        # Using empirical relationship: SM ≈ (σ° + 25) / 35 (simplified)
        soil_moisture = np.clip((l_band + 25) / 35, 0, 1)
        sm_mean = float(np.nanmean(soil_moisture))

        result["indices"]["soil_moisture_mean"] = sm_mean
        result["indices"]["soil_moisture_max"]  = float(np.nanmax(soil_moisture))

        # Agricultural stress detection
        if sm_mean < 0.15:
            result["alerts"].append({
                "alert_id":    f"drought-{request.scene_id}",
                "type":        "DROUGHT_STRESS",
                "severity":    "HIGH" if sm_mean < 0.10 else "MEDIUM",
                "description": f"Severe soil moisture deficit detected. SM={sm_mean:.3f}. "
                               f"Agricultural drought risk in affected region.",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.82,
                "source":      "NISAR",
            })
        elif sm_mean > 0.85:
            result["alerts"].append({
                "alert_id":    f"saturation-{request.scene_id}",
                "type":        "SOIL_SATURATION",
                "severity":    "HIGH",
                "description": f"Soil saturation detected. SM={sm_mean:.3f}. "
                               f"High flood risk in low-lying areas.",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.80,
                "source":      "NISAR",
            })

    if "s_band_coherence" in bands:
        coherence = np.array(bands["s_band_coherence"], dtype=np.float32)
        coh_mean = float(np.nanmean(coherence))

        # Low coherence indicates surface change (landslide, flood, construction)
        if coh_mean < 0.3:
            result["alerts"].append({
                "alert_id":    f"deformation-{request.scene_id}",
                "type":        "SURFACE_DEFORMATION",
                "severity":    "MEDIUM",
                "description": f"Surface deformation detected via InSAR coherence loss. "
                               f"Coherence={coh_mean:.3f}. Possible landslide or subsidence.",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.72,
                "source":      "NISAR",
            })

    return result


async def process_insat(request: SatelliteIngestRequest) -> Dict:
    """
    Process INSAT-3DS data.
    INSAT-3DS provides:
      - 6 solar reflectance channels (0.5–1.6μm)
      - 4 thermal infrared channels (3.9–13.5μm)
      - Water vapor channel (6.8μm)
      - Lightning Imager (LI)
      - Data Relay Transponder (DRT)
      - 15-minute full-disk imagery
    """
    bands = request.bands or {}
    result = {"indices": {}, "anomalies": [], "alerts": []}

    # ── Lightning detection ───────────────────────────────────
    if "lightning_density" in bands:
        li = np.array(bands["lightning_density"], dtype=np.float32)
        li_max = float(np.nanmax(li))
        li_mean = float(np.nanmean(li))

        result["indices"]["lightning_density_max"]  = li_max
        result["indices"]["lightning_density_mean"] = li_mean

        if li_max > 50:  # flashes per km² per hour
            result["alerts"].append({
                "alert_id":    f"lightning-{request.scene_id}",
                "type":        "LIGHTNING_STORM",
                "severity":    "HIGH" if li_max > 100 else "MEDIUM",
                "description": f"Severe lightning activity detected. "
                               f"Peak density: {li_max:.0f} flashes/km²/h. "
                               f"Thunderstorm warning issued.",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.92,
                "source":      "INSAT_3DS",
            })

    # ── Rainfall estimation (IMSRA algorithm) ────────────────
    if "ir_brightness_temp" in bands:
        ir = np.array(bands["ir_brightness_temp"], dtype=np.float32)  # Kelvin

        # Cold cloud tops indicate deep convection and heavy rainfall
        cold_pixels = (ir < 235).sum()  # < -38°C
        total_pixels = ir.size
        cold_fraction = cold_pixels / max(total_pixels, 1)

        # Rainfall estimate: ~1mm/h per 1% cold cloud fraction (simplified IMSRA)
        rainfall_estimate = cold_fraction * 100

        result["indices"]["ir_min_temp_k"]       = float(np.nanmin(ir))
        result["indices"]["cold_cloud_fraction"]  = float(cold_fraction)
        result["indices"]["rainfall_estimate_mmh"] = float(rainfall_estimate)

        if rainfall_estimate > 50:
            result["alerts"].append({
                "alert_id":    f"heavy-rain-{request.scene_id}",
                "type":        "HEAVY_RAINFALL",
                "severity":    "CRITICAL" if rainfall_estimate > 100 else "HIGH",
                "description": f"Extreme rainfall estimated: {rainfall_estimate:.0f}mm/h. "
                               f"Cold cloud fraction: {cold_fraction:.1%}. "
                               f"Flash flood risk is HIGH.",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.78,
                "source":      "INSAT_3DS",
            })

    # ── Sea Surface Temperature (SST) ─────────────────────────
    if "sst" in bands:
        sst = np.array(bands["sst"], dtype=np.float32)  # Celsius
        sst_mean = float(np.nanmean(sst))
        sst_anomaly = sst_mean - 28.0  # Cyclone threshold

        result["indices"]["sst_mean_c"] = sst_mean

        if sst_anomaly > 2.0:
            result["alerts"].append({
                "alert_id":    f"cyclone-risk-{request.scene_id}",
                "type":        "CYCLONE_RISK",
                "severity":    "HIGH",
                "description": f"Elevated SST detected: {sst_mean:.1f}°C "
                               f"({sst_anomaly:+.1f}°C above threshold). "
                               f"Favorable conditions for cyclone intensification.",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.70,
                "source":      "INSAT_3DS",
            })

    # ── Water vapor (atmospheric moisture) ───────────────────
    if "water_vapor" in bands:
        wv = np.array(bands["water_vapor"], dtype=np.float32)
        wv_mean = float(np.nanmean(wv))
        result["indices"]["precipitable_water_mm"] = wv_mean * 50  # approximate

    return result


async def process_goes(request: SatelliteIngestRequest) -> Dict:
    """Process GOES-16/17 data for weather alerts."""
    bands = request.bands or {}
    result = {"indices": {}, "anomalies": [], "alerts": []}

    if "ir_channel_13" in bands:
        ir = np.array(bands["ir_channel_13"], dtype=np.float32)
        ir_min = float(np.nanmin(ir))
        result["indices"]["cloud_top_temp_k"] = ir_min

        if ir_min < 210:  # Very cold cloud tops = severe convection
            result["alerts"].append({
                "alert_id":    f"severe-storm-{request.scene_id}",
                "type":        "SEVERE_THUNDERSTORM",
                "severity":    "CRITICAL" if ir_min < 200 else "HIGH",
                "description": f"Severe convection detected. Cloud top temp: {ir_min:.0f}K. "
                               f"Tornado/severe thunderstorm risk.",
                "location":    _bbox_center(request.bounding_box),
                "confidence":  0.85,
                "source":      request.source,
            })

    return result


# ── Helpers ───────────────────────────────────────────────────

def _bbox_center(bbox: Dict[str, float]) -> Dict[str, float]:
    return {
        "lat": (bbox.get("min_lat", 0) + bbox.get("max_lat", 0)) / 2,
        "lng": (bbox.get("min_lng", 0) + bbox.get("max_lng", 0)) / 2,
    }


def compute_evi(nir: np.ndarray, red: np.ndarray, blue: np.ndarray) -> np.ndarray:
    return 2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1 + 1e-8)


# ── API endpoints ─────────────────────────────────────────────

@app.get("/health")
async def health():
    return {
        "status": "operational",
        "service": "satellite",
        "processors": ["NISAR", "INSAT_3DS", "SENTINEL_1", "SENTINEL_2", "GOES_16"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/process", response_model=ProcessingResult)
async def process_scene(request: SatelliteIngestRequest, background: BackgroundTasks):
    """Process a satellite scene synchronously."""
    return await process_satellite_scene(request)


@app.post("/process/async")
async def process_scene_async(request: SatelliteIngestRequest, background: BackgroundTasks):
    """Queue satellite scene for background processing."""
    background.add_task(process_satellite_scene, request)
    return {"accepted": True, "scene_id": request.scene_id}


@app.get("/scenes/{scene_id}")
async def get_scene_result(scene_id: str):
    """Retrieve processed scene result from cache."""
    # In production: fetch from Redis/DB
    raise HTTPException(404, f"Scene {scene_id} not found in cache")


# ── Kafka consumer loop ───────────────────────────────────────

async def start_kafka_consumers():
    """Consume satellite ingest events from Kafka."""
    consumer = KafkaConsumer(
        topics=[
            "lifegrid.satellite.nisar.ingest",
            "lifegrid.satellite.insat.ingest",
            "lifegrid.satellite.sentinel.ingest",
        ],
        group_id="lifegrid-satellite-service",
    )

    async for envelope in consumer.consume():
        try:
            request = SatelliteIngestRequest(**envelope["payload"])
            await process_satellite_scene(request)
        except Exception as e:
            log.error("kafka_consumer_error", error=str(e))


# ── Entry point ───────────────────────────────────────────────

if __name__ == "__main__":
    import asyncio

    async def main():
        # Start Kafka consumer in background
        asyncio.create_task(start_kafka_consumers())
        # Start FastAPI server
        config = uvicorn.Config(app, host="0.0.0.0", port=5002, loop="uvloop")
        server = uvicorn.Server(config)
        await server.serve()

    asyncio.run(main())
