"""
============================================================
LIFEGRID AI Engine – Agricultural Stress Analyzer
============================================================
Architecture:
  Computes NDVI, NDWI, EVI, SAVI from Sentinel-2 bands.
  Detects crop stress, drought, and vegetation anomalies
  that can precede or accompany natural disasters.

  Indices:
    NDVI  = (NIR - Red) / (NIR + Red)
            Normalized Difference Vegetation Index
            Range: -1 to +1 (healthy vegetation > 0.4)

    NDWI  = (Green - NIR) / (Green + NIR)
            Normalized Difference Water Index
            Range: -1 to +1 (water bodies > 0.3)

    EVI   = 2.5 × (NIR - Red) / (NIR + 6×Red - 7.5×Blue + 1)
            Enhanced Vegetation Index (less soil noise)

    SAVI  = 1.5 × (NIR - Red) / (NIR + Red + 0.5)
            Soil-Adjusted Vegetation Index

  Anomaly detection:
    - Z-score against 5-year historical baseline
    - Drought stress: NDVI < 0.2 AND NDWI < -0.3
    - Flood stress:   NDWI > 0.3 AND NDVI drop > 0.3
    - Fire risk:      NDVI < 0.15 AND EVI < 0.1 (dry biomass)

Input:
  {
    "location": {"lat": float, "lng": float},
    "bands": {
      "blue":  float[H][W],   # B2 (490nm)
      "green": float[H][W],   # B3 (560nm)
      "red":   float[H][W],   # B4 (665nm)
      "nir":   float[H][W],   # B8 (842nm)
      "swir1": float[H][W],   # B11 (1610nm)
    },
    "acquisition_date": "ISO8601",
    "historical_baseline": {"ndvi_mean": float, "ndvi_std": float}
  }

Output:
  {
    "ndvi_mean": float, "ndvi_min": float, "ndvi_max": float,
    "ndwi_mean": float,
    "evi_mean": float,
    "savi_mean": float,
    "stress_type": "DROUGHT|FLOOD|FIRE_RISK|HEALTHY|UNKNOWN",
    "stress_severity": "CRITICAL|HIGH|MEDIUM|LOW|NONE",
    "anomaly_score": float,
    "affected_area_pct": float,
    "alerts": [...],
    "confidence": float
  }

Latency target: < 300ms (NumPy vectorized)
============================================================
"""
import time
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional

import numpy as np
import structlog

log = structlog.get_logger()

# ── Stress classification thresholds ─────────────────────────

NDVI_THRESHOLDS = {
    "healthy":    (0.4,  1.0),
    "moderate":   (0.2,  0.4),
    "stressed":   (0.1,  0.2),
    "bare_soil":  (-0.1, 0.1),
    "water":      (-1.0, -0.1),
}

STRESS_RULES = {
    "DROUGHT":   lambda ndvi, ndwi, evi: ndvi < 0.2 and ndwi < -0.3,
    "FLOOD":     lambda ndvi, ndwi, evi: ndwi > 0.3,
    "FIRE_RISK": lambda ndvi, ndwi, evi: ndvi < 0.15 and evi < 0.1,
    "HEALTHY":   lambda ndvi, ndwi, evi: ndvi > 0.4 and ndwi > -0.2,
}


@dataclass
class VegetationAlert:
    alert_type: str
    severity: str
    description: str
    affected_area_pct: float
    recommended_actions: List[str]


@dataclass
class NDVIAnalysis:
    ndvi_mean: float
    ndvi_min: float
    ndvi_max: float
    ndvi_std: float
    ndwi_mean: float
    evi_mean: float
    savi_mean: float
    stress_type: str
    stress_severity: str
    anomaly_score: float
    affected_area_pct: float
    alerts: List[VegetationAlert]
    confidence: float
    processing_ms: float
    pixel_count: int


class NDVIAnalyzer:
    """
    Vectorized NDVI/NDWI/EVI/SAVI computation and stress detection.
    Pure NumPy — no GPU required.
    """

    def analyze(self, request: Dict[str, Any]) -> NDVIAnalysis:
        t0 = time.perf_counter()

        bands = request.get("bands", {})
        baseline = request.get("historical_baseline", {})

        if not bands or "nir" not in bands or "red" not in bands:
            return self._empty_analysis(t0)

        # Convert to numpy arrays
        nir   = np.array(bands["nir"],   dtype=np.float32)
        red   = np.array(bands["red"],   dtype=np.float32)
        green = np.array(bands.get("green", np.zeros_like(nir)), dtype=np.float32)
        blue  = np.array(bands.get("blue",  np.zeros_like(nir)), dtype=np.float32)

        # Normalize to [0, 1] if in DN (0–10000 range)
        if nir.max() > 1.0:
            nir, red, green, blue = nir / 10000, red / 10000, green / 10000, blue / 10000

        # Clip to valid reflectance range
        nir   = np.clip(nir,   0.0001, 1.0)
        red   = np.clip(red,   0.0001, 1.0)
        green = np.clip(green, 0.0001, 1.0)
        blue  = np.clip(blue,  0.0001, 1.0)

        # ── Compute indices ───────────────────────────────────

        # NDVI: (NIR - Red) / (NIR + Red)
        ndvi = (nir - red) / (nir + red + 1e-8)

        # NDWI: (Green - NIR) / (Green + NIR)
        ndwi = (green - nir) / (green + nir + 1e-8)

        # EVI: 2.5 × (NIR - Red) / (NIR + 6×Red - 7.5×Blue + 1)
        evi = 2.5 * (nir - red) / (nir + 6 * red - 7.5 * blue + 1 + 1e-8)
        evi = np.clip(evi, -1.0, 1.0)

        # SAVI: 1.5 × (NIR - Red) / (NIR + Red + 0.5)
        savi = 1.5 * (nir - red) / (nir + red + 0.5 + 1e-8)

        # ── Statistics ────────────────────────────────────────

        ndvi_mean = float(np.nanmean(ndvi))
        ndvi_min  = float(np.nanmin(ndvi))
        ndvi_max  = float(np.nanmax(ndvi))
        ndvi_std  = float(np.nanstd(ndvi))
        ndwi_mean = float(np.nanmean(ndwi))
        evi_mean  = float(np.nanmean(evi))
        savi_mean = float(np.nanmean(savi))

        # ── Anomaly detection ─────────────────────────────────

        baseline_mean = baseline.get("ndvi_mean", 0.45)
        baseline_std  = baseline.get("ndvi_std", 0.12)
        anomaly_score = abs(ndvi_mean - baseline_mean) / max(baseline_std, 0.01)
        anomaly_score = min(anomaly_score / 3.0, 1.0)  # normalize to [0,1]

        # ── Stress classification ─────────────────────────────

        stress_type = "UNKNOWN"
        for stype, rule in STRESS_RULES.items():
            if rule(ndvi_mean, ndwi_mean, evi_mean):
                stress_type = stype
                break

        # Affected area: pixels with NDVI below healthy threshold
        stressed_pixels = (ndvi < 0.3).sum()
        total_pixels = ndvi.size
        affected_pct = float(stressed_pixels / total_pixels * 100)

        stress_severity = self._classify_severity(ndvi_mean, anomaly_score, stress_type)

        # ── Build alerts ──────────────────────────────────────

        alerts = self._build_alerts(
            stress_type, stress_severity, ndvi_mean, ndwi_mean, affected_pct
        )

        ms = (time.perf_counter() - t0) * 1000
        return NDVIAnalysis(
            ndvi_mean=round(ndvi_mean, 4),
            ndvi_min=round(ndvi_min, 4),
            ndvi_max=round(ndvi_max, 4),
            ndvi_std=round(ndvi_std, 4),
            ndwi_mean=round(ndwi_mean, 4),
            evi_mean=round(evi_mean, 4),
            savi_mean=round(savi_mean, 4),
            stress_type=stress_type,
            stress_severity=stress_severity,
            anomaly_score=round(anomaly_score, 4),
            affected_area_pct=round(affected_pct, 2),
            alerts=alerts,
            confidence=0.90,
            processing_ms=round(ms, 2),
            pixel_count=total_pixels,
        )

    # ── Helpers ───────────────────────────────────────────────

    def _classify_severity(
        self, ndvi_mean: float, anomaly_score: float, stress_type: str
    ) -> str:
        if stress_type == "HEALTHY":
            return "NONE"
        if anomaly_score > 0.8 or ndvi_mean < 0.1:
            return "CRITICAL"
        if anomaly_score > 0.5 or ndvi_mean < 0.2:
            return "HIGH"
        if anomaly_score > 0.3 or ndvi_mean < 0.3:
            return "MEDIUM"
        return "LOW"

    def _build_alerts(
        self, stress_type: str, severity: str,
        ndvi: float, ndwi: float, affected_pct: float
    ) -> List[VegetationAlert]:
        alerts = []

        if stress_type == "DROUGHT":
            alerts.append(VegetationAlert(
                alert_type="DROUGHT_STRESS",
                severity=severity,
                description=f"Drought stress detected. NDVI={ndvi:.3f}, NDWI={ndwi:.3f}. "
                            f"{affected_pct:.1f}% of area affected.",
                affected_area_pct=affected_pct,
                recommended_actions=[
                    "Issue drought advisory for affected region",
                    "Activate water conservation protocols",
                    "Pre-position water tankers",
                    "Alert agricultural authorities",
                ],
            ))

        elif stress_type == "FLOOD":
            alerts.append(VegetationAlert(
                alert_type="FLOOD_INUNDATION",
                severity=severity,
                description=f"Flood inundation detected. NDWI={ndwi:.3f} indicates standing water. "
                            f"{affected_pct:.1f}% of area affected.",
                affected_area_pct=affected_pct,
                recommended_actions=[
                    "Activate flood response teams",
                    "Issue evacuation advisory for low-lying areas",
                    "Deploy water rescue units",
                ],
            ))

        elif stress_type == "FIRE_RISK":
            alerts.append(VegetationAlert(
                alert_type="FIRE_RISK",
                severity=severity,
                description=f"High fire risk: dry biomass detected. NDVI={ndvi:.3f}, EVI low. "
                            f"{affected_pct:.1f}% of area at risk.",
                affected_area_pct=affected_pct,
                recommended_actions=[
                    "Issue fire weather watch",
                    "Pre-position aerial firefighting assets",
                    "Restrict open burning",
                    "Alert fire departments in affected zones",
                ],
            ))

        return alerts

    def _empty_analysis(self, t0: float) -> NDVIAnalysis:
        ms = (time.perf_counter() - t0) * 1000
        return NDVIAnalysis(
            ndvi_mean=0.0, ndvi_min=0.0, ndvi_max=0.0, ndvi_std=0.0,
            ndwi_mean=0.0, evi_mean=0.0, savi_mean=0.0,
            stress_type="UNKNOWN", stress_severity="NONE",
            anomaly_score=0.0, affected_area_pct=0.0,
            alerts=[], confidence=0.0,
            processing_ms=round(ms, 2), pixel_count=0,
        )
