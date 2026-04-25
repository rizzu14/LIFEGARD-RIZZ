"""
============================================================
LIFEGRID – Z-Score Anomaly Detection
============================================================
Detects statistically significant deviations from historical
baselines in satellite-derived indices.

Method:
  Z = (X_current - μ_historical) / σ_historical

Thresholds:
  |Z| > 1.5 → ELEVATED
  |Z| > 2.5 → ANOMALY
  |Z| > 3.5 → CRITICAL ANOMALY

Applied to: NDVI, NDWI, soil moisture, SST, rainfall
============================================================
"""

import numpy as np
from typing import List, Dict, Any, Optional


class ZScoreAnomalyDetector:
    """
    Pixel-wise and region-wise Z-score anomaly detection.
    """

    THRESHOLDS = {
        "ELEVATED": 1.5,
        "ANOMALY":  2.5,
        "CRITICAL": 3.5,
    }

    def detect(
        self,
        current: np.ndarray,
        baseline_mean: float,
        baseline_std: float,
        min_anomalous_fraction: float = 0.05,
    ) -> List[Dict[str, Any]]:
        """
        Detect anomalies in a 2D array against a scalar baseline.

        Returns list of anomaly records.
        """
        if baseline_std < 0.001:
            baseline_std = 0.001

        z_scores = (current - baseline_mean) / baseline_std
        anomalies = []

        for label, threshold in self.THRESHOLDS.items():
            mask = np.abs(z_scores) > threshold
            fraction = float(mask.sum() / max(mask.size, 1))

            if fraction >= min_anomalous_fraction:
                direction = "BELOW" if float(z_scores[mask].mean()) < 0 else "ABOVE"
                anomalies.append({
                    "type":              f"ZSCORE_{label}",
                    "severity":          label,
                    "z_score_mean":      round(float(np.abs(z_scores[mask]).mean()), 3),
                    "z_score_max":       round(float(np.abs(z_scores).max()), 3),
                    "anomalous_fraction": round(fraction, 4),
                    "direction":         direction,
                    "current_mean":      round(float(current.mean()), 4),
                    "baseline_mean":     round(baseline_mean, 4),
                    "deviation":         round(float(current.mean() - baseline_mean), 4),
                })
                break  # Report highest severity only

        return anomalies

    def detect_temporal(
        self,
        time_series: np.ndarray,  # shape: [T, H, W]
        window: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Detect anomalies in a time series using rolling statistics.
        """
        if len(time_series) < window + 1:
            return []

        anomalies = []
        for t in range(window, len(time_series)):
            historical = time_series[t - window:t]
            current    = time_series[t]
            mean = historical.mean()
            std  = max(historical.std(), 0.001)
            z    = abs((current.mean() - mean) / std)

            if z > self.THRESHOLDS["ANOMALY"]:
                anomalies.append({
                    "timestep":    t,
                    "z_score":     round(float(z), 3),
                    "severity":    "CRITICAL" if z > self.THRESHOLDS["CRITICAL"] else "ANOMALY",
                    "current":     round(float(current.mean()), 4),
                    "baseline":    round(float(mean), 4),
                })

        return anomalies

    def compute_change_map(
        self,
        before: np.ndarray,
        after: np.ndarray,
    ) -> Dict[str, Any]:
        """
        Compute pixel-wise change between two images.
        Used for pre/post disaster comparison.
        """
        change = after - before
        abs_change = np.abs(change)

        return {
            "mean_change":     round(float(change.mean()), 4),
            "max_increase":    round(float(change.max()), 4),
            "max_decrease":    round(float(change.min()), 4),
            "changed_fraction": round(float((abs_change > 0.1).sum() / change.size), 4),
            "change_map":      change.tolist() if change.size < 10000 else None,
        }
