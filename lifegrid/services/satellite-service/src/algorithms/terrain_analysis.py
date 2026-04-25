"""
============================================================
LIFEGRID – 3D Terrain Flood Depth Estimation
============================================================
Uses Digital Elevation Model (DEM) + flood extent mask
to estimate flood depth and volume.

Data sources:
  - SRTM 30m DEM (global)
  - ALOS World 3D 12.5m (high resolution)
  - Copernicus DEM 10m (Europe)
  - NASADEM (improved SRTM)

Algorithm:
  1. Load DEM for bounding box
  2. Apply flood mask from SAR/optical detection
  3. Estimate flood water surface elevation (WSE)
     WSE = percentile(DEM[flood_mask], 95)
  4. Compute depth: D(x,y) = max(0, WSE - DEM(x,y)) × flood_mask
  5. Volume: V = Σ D(x,y) × pixel_area
  6. Identify at-risk infrastructure from DEM topology
============================================================
"""

import numpy as np
from typing import Dict, Any, Optional, List
import math


class TerrainAnalyzer:
    """
    DEM-based flood depth and volume estimation.
    """

    def estimate_flood_depth(
        self,
        dem: np.ndarray,
        flood_mask: np.ndarray,
        pixel_size_m: float = 30.0,
        wse_percentile: float = 95.0,
    ) -> Dict[str, Any]:
        """
        Estimate flood depth from DEM and flood mask.

        Parameters:
          dem:            Digital Elevation Model (meters above sea level)
          flood_mask:     Boolean mask of flooded pixels
          pixel_size_m:   Ground resolution in meters
          wse_percentile: Percentile of flooded DEM values used as water surface

        Returns:
          depth statistics, volume, and risk zones
        """
        if not flood_mask.any():
            return self._empty_result()

        flooded_elevations = dem[flood_mask]

        # Water Surface Elevation (WSE)
        # Use high percentile to represent the flood water level
        wse = float(np.percentile(flooded_elevations, wse_percentile))

        # Depth map: positive where DEM is below WSE within flood extent
        depth_map = np.maximum(wse - dem, 0.0) * flood_mask.astype(float)

        # Statistics
        flooded_depths = depth_map[flood_mask]
        pixel_area_m2  = pixel_size_m ** 2
        volume_m3      = float(depth_map.sum() * pixel_area_m2)

        # Depth classification
        shallow  = float((flooded_depths < 0.5).sum() / len(flooded_depths))
        moderate = float(((flooded_depths >= 0.5) & (flooded_depths < 2.0)).sum() / len(flooded_depths))
        deep     = float((flooded_depths >= 2.0).sum() / len(flooded_depths))

        # Identify low-lying areas at risk (DEM < WSE + 1m buffer)
        at_risk_mask = (dem < wse + 1.0) & ~flood_mask
        at_risk_area_km2 = float(at_risk_mask.sum() * pixel_area_m2 / 1e6)

        return {
            "water_surface_elevation_m": round(wse, 2),
            "mean_depth_m":              round(float(flooded_depths.mean()), 2),
            "max_depth_m":               round(float(flooded_depths.max()), 2),
            "median_depth_m":            round(float(np.median(flooded_depths)), 2),
            "volume_m3":                 round(volume_m3, 0),
            "volume_km3":                round(volume_m3 / 1e9, 8),
            "flooded_area_km2":          round(float(flood_mask.sum() * pixel_area_m2 / 1e6), 3),
            "at_risk_area_km2":          round(at_risk_area_km2, 3),
            "depth_distribution": {
                "shallow_pct":  round(shallow * 100, 1),   # < 0.5m
                "moderate_pct": round(moderate * 100, 1),  # 0.5–2m
                "deep_pct":     round(deep * 100, 1),      # > 2m
            },
        }

    def compute_flow_direction(self, dem: np.ndarray) -> np.ndarray:
        """
        Compute D8 flow direction from DEM.
        Used to predict flood propagation paths.

        D8 encoding:
          1=E, 2=SE, 4=S, 8=SW, 16=W, 32=NW, 64=N, 128=NE
        """
        h, w = dem.shape
        flow_dir = np.zeros((h, w), dtype=np.uint8)

        # Neighbor offsets: E, SE, S, SW, W, NW, N, NE
        neighbors = [(0,1), (1,1), (1,0), (1,-1), (0,-1), (-1,-1), (-1,0), (-1,1)]
        codes     = [1, 2, 4, 8, 16, 32, 64, 128]

        for i in range(1, h - 1):
            for j in range(1, w - 1):
                min_elev = dem[i, j]
                min_code = 0
                for (di, dj), code in zip(neighbors, codes):
                    ni, nj = i + di, j + dj
                    if dem[ni, nj] < min_elev:
                        min_elev = dem[ni, nj]
                        min_code = code
                flow_dir[i, j] = min_code

        return flow_dir

    def identify_flood_pathways(
        self,
        dem: np.ndarray,
        flood_source: tuple,  # (row, col) of flood origin
        max_depth_m: float = 5.0,
    ) -> np.ndarray:
        """
        Trace flood propagation pathways using DEM topology.
        Simple gravity-based flood fill.
        """
        h, w = dem.shape
        source_elev = dem[flood_source]
        flood_level = source_elev + max_depth_m

        # Flood fill: all connected pixels below flood level
        flooded = np.zeros((h, w), dtype=bool)
        stack = [flood_source]
        visited = set()

        while stack:
            r, c = stack.pop()
            if (r, c) in visited or r < 0 or r >= h or c < 0 or c >= w:
                continue
            visited.add((r, c))

            if dem[r, c] <= flood_level:
                flooded[r, c] = True
                for dr, dc in [(-1,0),(1,0),(0,-1),(0,1)]:
                    nr, nc = r + dr, c + dc
                    if (nr, nc) not in visited:
                        stack.append((nr, nc))

        return flooded

    def _empty_result(self) -> Dict[str, Any]:
        return {
            "water_surface_elevation_m": 0,
            "mean_depth_m": 0,
            "max_depth_m": 0,
            "median_depth_m": 0,
            "volume_m3": 0,
            "volume_km3": 0,
            "flooded_area_km2": 0,
            "at_risk_area_km2": 0,
            "depth_distribution": {"shallow_pct": 0, "moderate_pct": 0, "deep_pct": 0},
        }
