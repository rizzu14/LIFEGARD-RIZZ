"""
============================================================
LIFEGRID – Flood Detection Algorithms
============================================================
Three-stage flood detection pipeline:

Stage 1: SAR-based detection (Sentinel-1)
  - Threshold: σ° < -15 dB indicates open water
  - Change detection: coherence loss between pre/post images
  - Otsu thresholding on VV/VH ratio

Stage 2: Z-score anomaly detection
  - Compare current NDWI against 5-year historical baseline
  - Z-score > 2.5 → anomaly flag
  - Spatial clustering of anomalous pixels

Stage 3: 3D terrain flood depth estimation
  - DEM (Digital Elevation Model) integration
  - Flood extent from SAR mask
  - Depth = DEM_elevation - flood_surface_elevation
  - Volume estimation for affected areas
============================================================
"""

import numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
import math


@dataclass
class FloodZone:
    zone_id: str
    center_lat: float
    center_lng: float
    radius_m: float
    probability: float
    risk_level: str
    estimated_depth_m: float
    estimated_area_km2: float
    estimated_population: int
    confidence: float


@dataclass
class FloodDetectionResult:
    probability: float
    confidence: float
    area_km2: float
    zones: List[Dict]
    depth_stats: Dict[str, float]
    model_used: str


class FloodDetector:
    """
    Multi-method flood detection combining SAR, optical, and terrain data.
    """

    # SAR thresholds (dB)
    WATER_THRESHOLD_VV = -15.0   # σ° < -15 dB = open water
    WATER_THRESHOLD_VH = -22.0

    # NDWI threshold
    NDWI_WATER_THRESHOLD = 0.3

    def detect_from_sar(
        self,
        sar_vv: np.ndarray,
        sar_vh: np.ndarray,
        dem: Optional[np.ndarray] = None,
        pixel_size_m: float = 10.0,
    ) -> FloodDetectionResult:
        """
        Detect flood extent from Sentinel-1 SAR backscatter.

        Algorithm:
          1. Convert to dB if linear: σ°_dB = 10 × log10(σ°_linear)
          2. Apply water threshold: water_mask = σ°_VV < -15 dB
          3. Refine with VH: water_mask &= σ°_VH < -22 dB
          4. Morphological cleaning (remove speckle)
          5. Compute flood probability per pixel
          6. Aggregate to flood zones
          7. Estimate depth from DEM (if available)
        """
        # Convert to dB if needed (linear values are typically < 1)
        if sar_vv.max() <= 1.0:
            sar_vv_db = 10 * np.log10(np.clip(sar_vv, 1e-10, None))
            sar_vh_db = 10 * np.log10(np.clip(sar_vh, 1e-10, None))
        else:
            sar_vv_db = sar_vv
            sar_vh_db = sar_vh

        # Water mask
        water_mask_vv = sar_vv_db < self.WATER_THRESHOLD_VV
        water_mask_vh = sar_vh_db < self.WATER_THRESHOLD_VH
        water_mask = water_mask_vv & water_mask_vh

        # Morphological cleaning (simple erosion/dilation)
        water_mask = self._morphological_clean(water_mask)

        # Flood probability (smooth gradient around threshold)
        flood_prob_map = self._compute_probability_map(sar_vv_db, sar_vh_db)

        # Statistics
        flooded_pixels = water_mask.sum()
        total_pixels   = water_mask.size
        flood_fraction = flooded_pixels / max(total_pixels, 1)
        area_km2       = flooded_pixels * (pixel_size_m / 1000) ** 2

        overall_probability = float(flood_prob_map[water_mask].mean()) if flooded_pixels > 0 else 0.0

        # Depth estimation from DEM
        depth_stats = {}
        if dem is not None and flooded_pixels > 0:
            depth_stats = self._estimate_flood_depth(water_mask, dem)

        # Build flood zones (cluster connected regions)
        zones = self._build_flood_zones(water_mask, flood_prob_map, pixel_size_m)

        risk_level = (
            "CRITICAL" if overall_probability > 0.8 else
            "HIGH"     if overall_probability > 0.6 else
            "MEDIUM"   if overall_probability > 0.4 else "LOW"
        )

        return FloodDetectionResult(
            probability=round(overall_probability, 4),
            confidence=0.85,
            area_km2=round(area_km2, 2),
            zones=[self._zone_to_dict(z) for z in zones],
            depth_stats=depth_stats,
            model_used="sar_threshold_v2",
        )

    def detect_from_ndwi(
        self,
        ndwi: np.ndarray,
        baseline_mean: float = 0.0,
        baseline_std: float = 0.15,
        pixel_size_m: float = 10.0,
    ) -> FloodDetectionResult:
        """
        Detect flood from NDWI (Sentinel-2 optical).
        Uses Z-score anomaly detection against historical baseline.
        """
        # Z-score
        z_scores = (ndwi - baseline_mean) / max(baseline_std, 0.01)

        # Flood pixels: NDWI > threshold AND Z-score > 2.5
        flood_mask = (ndwi > self.NDWI_WATER_THRESHOLD) & (z_scores > 2.5)
        flood_mask = self._morphological_clean(flood_mask)

        flooded_pixels = flood_mask.sum()
        area_km2 = flooded_pixels * (pixel_size_m / 1000) ** 2

        # Probability from NDWI value
        prob_map = np.clip((ndwi - 0.1) / 0.6, 0, 1)
        overall_prob = float(prob_map[flood_mask].mean()) if flooded_pixels > 0 else 0.0

        zones = self._build_flood_zones(flood_mask, prob_map, pixel_size_m)

        return FloodDetectionResult(
            probability=round(overall_prob, 4),
            confidence=0.78,
            area_km2=round(area_km2, 2),
            zones=[self._zone_to_dict(z) for z in zones],
            depth_stats={},
            model_used="ndwi_zscore",
        )

    def estimate_3d_flood_depth(
        self,
        flood_mask: np.ndarray,
        dem: np.ndarray,
        pixel_size_m: float = 10.0,
    ) -> Dict[str, Any]:
        """
        3D terrain flood depth estimation.

        Algorithm:
          1. Extract DEM values within flood mask
          2. Estimate flood surface elevation (percentile of flooded DEM values)
          3. Depth = flood_surface_elevation - DEM_elevation (for flooded pixels)
          4. Volume = Σ(depth × pixel_area)

        Returns depth statistics and volume estimate.
        """
        if not flood_mask.any():
            return {"mean_depth_m": 0, "max_depth_m": 0, "volume_m3": 0}

        flooded_elevations = dem[flood_mask]

        # Flood surface = 95th percentile of flooded pixel elevations
        flood_surface_elev = float(np.percentile(flooded_elevations, 95))

        # Depth per pixel
        depths = np.maximum(flood_surface_elev - dem, 0) * flood_mask.astype(float)

        pixel_area_m2 = pixel_size_m ** 2
        volume_m3 = float(depths.sum() * pixel_area_m2)

        return {
            "mean_depth_m":       round(float(depths[flood_mask].mean()), 2),
            "max_depth_m":        round(float(depths.max()), 2),
            "flood_surface_elev": round(flood_surface_elev, 1),
            "volume_m3":          round(volume_m3, 0),
            "volume_km3":         round(volume_m3 / 1e9, 6),
        }

    # ── Private helpers ───────────────────────────────────────

    def _morphological_clean(self, mask: np.ndarray, kernel_size: int = 3) -> np.ndarray:
        """Simple morphological erosion then dilation to remove speckle."""
        from scipy.ndimage import binary_erosion, binary_dilation
        try:
            eroded  = binary_erosion(mask,  iterations=1)
            dilated = binary_dilation(eroded, iterations=1)
            return dilated
        except Exception:
            return mask

    def _compute_probability_map(
        self, vv_db: np.ndarray, vh_db: np.ndarray
    ) -> np.ndarray:
        """Sigmoid probability from distance to water threshold."""
        vv_prob = 1 / (1 + np.exp(0.5 * (vv_db - self.WATER_THRESHOLD_VV)))
        vh_prob = 1 / (1 + np.exp(0.5 * (vh_db - self.WATER_THRESHOLD_VH)))
        return (vv_prob + vh_prob) / 2

    def _estimate_flood_depth(
        self, flood_mask: np.ndarray, dem: np.ndarray
    ) -> Dict[str, float]:
        if dem.shape != flood_mask.shape:
            return {}
        return self.estimate_3d_flood_depth(flood_mask, dem)

    def _build_flood_zones(
        self,
        mask: np.ndarray,
        prob_map: np.ndarray,
        pixel_size_m: float,
    ) -> List[FloodZone]:
        """Cluster flood pixels into geographic zones."""
        zones = []
        h, w = mask.shape

        # Divide into quadrants for simple zone detection
        quadrants = [
            (mask[:h//2, :w//2], 0, 0),
            (mask[:h//2, w//2:], 0, w//2),
            (mask[h//2:, :w//2], h//2, 0),
            (mask[h//2:, w//2:], h//2, w//2),
        ]

        for i, (quad, row_off, col_off) in enumerate(quadrants):
            if not quad.any():
                continue

            flooded = quad.sum()
            area_km2 = flooded * (pixel_size_m / 1000) ** 2

            if area_km2 < 0.01:
                continue

            # Center of flooded pixels in this quadrant
            rows, cols = np.where(quad)
            center_row = float(rows.mean()) + row_off
            center_col = float(cols.mean()) + col_off

            # Convert pixel coords to approximate lat/lng offset
            # (in production: use proper georeferencing)
            prob = float(prob_map[
                int(center_row):int(center_row)+1,
                int(center_col):int(center_col)+1
            ].mean()) if prob_map.size > 0 else 0.5

            risk = ("CRITICAL" if prob > 0.8 else "HIGH" if prob > 0.6 else "MEDIUM")

            zones.append(FloodZone(
                zone_id=f"zone-{i}",
                center_lat=0.0,  # Set by caller with actual georeferencing
                center_lng=0.0,
                radius_m=math.sqrt(area_km2 * 1e6 / math.pi),
                probability=round(prob, 4),
                risk_level=risk,
                estimated_depth_m=0.0,
                estimated_area_km2=round(area_km2, 2),
                estimated_population=int(area_km2 * 500),  # 500 people/km² default
                confidence=0.80,
            ))

        return zones

    def _zone_to_dict(self, zone: FloodZone) -> Dict:
        return {
            "zone_id":              zone.zone_id,
            "center_lat":           zone.center_lat,
            "center_lng":           zone.center_lng,
            "radius_m":             zone.radius_m,
            "probability":          zone.probability,
            "risk_level":           zone.risk_level,
            "estimated_depth_m":    zone.estimated_depth_m,
            "estimated_area_km2":   zone.estimated_area_km2,
            "estimated_population": zone.estimated_population,
            "confidence":           zone.confidence,
        }
