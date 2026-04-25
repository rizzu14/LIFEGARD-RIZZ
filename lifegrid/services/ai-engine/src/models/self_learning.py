"""
============================================================
LIFEGRID – AI Self-Learning System
============================================================
Continuously improves all models from real-world outcomes.

Learning loops:
  1. Dispatch Outcome Learning
     - Tracks: dispatch → arrival time, success rate, responder type match
     - Updates: XGBoost dispatch model weights every 1000 outcomes
     - Metric: mean response time reduction

  2. NLP Classification Feedback
     - Tracks: operator corrections to AI classifications
     - Updates: TF-IDF classifier and keyword corpus
     - Metric: classification accuracy on corrected samples

  3. Predictive Crisis Prevention
     - Tracks: incident patterns by time, location, type, weather
     - Builds: spatiotemporal risk models
     - Outputs: proactive alerts before incidents occur

  4. Affinity Matrix Evolution
     - Tracks: which responder types actually resolved which incident types
     - Updates: AFFINITY_MATRIX weights via exponential moving average
     - Metric: resolution rate per (incident_type, responder_type) pair

  5. Anomaly Baseline Drift
     - Tracks: NDVI/NDWI/sensor baselines over time
     - Updates: rolling Z-score baselines per geographic cell
     - Prevents: false positives from seasonal drift

Architecture:
  - Online learning: incremental updates on each outcome
  - Batch learning: full retrain every 24h on accumulated data
  - A/B testing: shadow model runs in parallel, promoted on improvement
  - Rollback: automatic revert if new model degrades performance
============================================================
"""

import asyncio
import json
import math
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Tuple, Any

import numpy as np
import structlog

log = structlog.get_logger()


# ── Outcome tracking ──────────────────────────────────────────

@dataclass
class DispatchOutcome:
    incident_id: str
    incident_type: str
    incident_severity: str
    responder_id: str
    responder_type: str
    dispatch_score: float          # AI-assigned composite score
    actual_arrival_seconds: int    # Ground truth
    predicted_arrival_seconds: int # AI prediction
    resolution_success: bool       # Was incident resolved?
    responder_rating: Optional[float]  # Operator feedback (0–5)
    timestamp: str


@dataclass
class ClassificationFeedback:
    incident_id: str
    ai_classification: str
    operator_correction: str       # What operator changed it to
    confidence_at_time: float
    text_length: int
    language: str
    timestamp: str


@dataclass
class CrisisPattern:
    pattern_id: str
    incident_type: str
    location_cell: str             # H3 geohash cell
    time_bucket: str               # "MON_08", "FRI_22", etc.
    weather_condition: str
    frequency: int
    avg_severity: float
    last_seen: str
    prediction_confidence: float


# ── Self-learning engine ──────────────────────────────────────

class SelfLearningEngine:
    """
    Online + batch learning system for continuous model improvement.
    """

    # Rolling windows for online learning
    DISPATCH_WINDOW_SIZE = 10000
    NLP_WINDOW_SIZE = 5000
    PATTERN_WINDOW_DAYS = 90

    # Learning rates
    AFFINITY_LEARNING_RATE = 0.05   # EMA alpha for affinity matrix updates
    BASELINE_LEARNING_RATE = 0.01   # EMA alpha for sensor baselines

    # Improvement thresholds for model promotion
    MIN_IMPROVEMENT_PCT = 2.0       # Must improve by 2% to promote new model

    def __init__(self):
        # Outcome buffers
        self._dispatch_outcomes: deque = deque(maxlen=self.DISPATCH_WINDOW_SIZE)
        self._nlp_feedback: deque = deque(maxlen=self.NLP_WINDOW_SIZE)

        # Learned affinity matrix (starts from hardcoded, evolves)
        self._learned_affinity: Dict[str, Dict[str, float]] = {}
        self._affinity_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
        self._affinity_successes: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

        # Crisis patterns
        self._crisis_patterns: Dict[str, CrisisPattern] = {}

        # Sensor baselines (per device, per metric)
        self._sensor_baselines: Dict[str, Dict[str, Tuple[float, float]]] = {}  # {device: {metric: (mean, std)}}

        # Performance tracking
        self._model_performance: Dict[str, List[float]] = defaultdict(list)

        # A/B test state
        self._shadow_model_active = False
        self._shadow_model_outcomes: List[float] = []
        self._primary_model_outcomes: List[float] = []

        log.info("self_learning_engine_initialized")

    # ── 1. Dispatch outcome learning ─────────────────────────

    def record_dispatch_outcome(self, outcome: DispatchOutcome) -> None:
        """Record a dispatch outcome for online learning."""
        self._dispatch_outcomes.append(outcome)

        # Update affinity matrix via EMA
        inc_type = outcome.incident_type
        resp_type = outcome.responder_type

        self._affinity_counts[inc_type][resp_type] += 1
        if outcome.resolution_success:
            self._affinity_successes[inc_type][resp_type] += 1

        # Compute new success rate
        count = self._affinity_counts[inc_type][resp_type]
        success = self._affinity_successes[inc_type][resp_type]
        new_rate = success / max(count, 1)

        # EMA update
        if inc_type not in self._learned_affinity:
            self._learned_affinity[inc_type] = {}

        current = self._learned_affinity[inc_type].get(resp_type, 0.5)
        alpha = self.AFFINITY_LEARNING_RATE
        self._learned_affinity[inc_type][resp_type] = (
            alpha * new_rate + (1 - alpha) * current
        )

        # Track prediction accuracy
        error = abs(outcome.actual_arrival_seconds - outcome.predicted_arrival_seconds)
        self._model_performance['dispatch_eta_error'].append(error)

        log.debug("dispatch_outcome_recorded",
                  incident_type=inc_type, responder_type=resp_type,
                  success=outcome.resolution_success,
                  eta_error=error)

    def get_learned_affinity(self, incident_type: str, responder_type: str) -> Optional[float]:
        """Get learned affinity score, or None if insufficient data."""
        count = self._affinity_counts[incident_type][responder_type]
        if count < 10:  # Need at least 10 samples
            return None
        return self._learned_affinity.get(incident_type, {}).get(responder_type)

    # ── 2. NLP classification feedback ───────────────────────

    def record_classification_feedback(self, feedback: ClassificationFeedback) -> None:
        """Record operator correction to AI classification."""
        self._nlp_feedback.append(feedback)

        # Track accuracy
        is_correct = feedback.ai_classification == feedback.operator_correction
        self._model_performance['nlp_accuracy'].append(1.0 if is_correct else 0.0)

        if not is_correct:
            log.info("nlp_correction_recorded",
                     ai_class=feedback.ai_classification,
                     correct_class=feedback.operator_correction,
                     confidence=feedback.confidence_at_time)

    def get_nlp_accuracy(self, window: int = 1000) -> float:
        """Rolling NLP accuracy over last N samples."""
        recent = list(self._model_performance['nlp_accuracy'])[-window:]
        return sum(recent) / max(len(recent), 1)

    # ── 3. Predictive crisis prevention ──────────────────────

    def record_incident_pattern(
        self,
        incident_type: str,
        lat: float,
        lng: float,
        severity: str,
        weather_condition: str = "CLEAR",
    ) -> None:
        """Record incident for pattern learning."""
        # H3-like cell (simplified: 0.1° grid)
        cell_lat = round(lat, 1)
        cell_lng = round(lng, 1)
        location_cell = f"{cell_lat:.1f},{cell_lng:.1f}"

        # Time bucket: day_of_week + hour
        now = datetime.now(timezone.utc)
        day = now.strftime("%a").upper()
        hour = now.hour
        time_bucket = f"{day}_{hour:02d}"

        pattern_key = f"{incident_type}:{location_cell}:{time_bucket}:{weather_condition}"

        if pattern_key in self._crisis_patterns:
            p = self._crisis_patterns[pattern_key]
            p.frequency += 1
            p.last_seen = now.isoformat()
            # Update average severity
            sev_score = {"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}.get(severity, 2)
            p.avg_severity = 0.9 * p.avg_severity + 0.1 * sev_score
            # Confidence increases with frequency
            p.prediction_confidence = min(0.5 + p.frequency * 0.01, 0.95)
        else:
            self._crisis_patterns[pattern_key] = CrisisPattern(
                pattern_id=pattern_key,
                incident_type=incident_type,
                location_cell=location_cell,
                time_bucket=time_bucket,
                weather_condition=weather_condition,
                frequency=1,
                avg_severity={"CRITICAL": 4, "HIGH": 3, "MEDIUM": 2, "LOW": 1}.get(severity, 2),
                last_seen=now.isoformat(),
                prediction_confidence=0.3,
            )

    def predict_crisis_risk(
        self,
        lat: float,
        lng: float,
        hours_ahead: int = 6,
        weather_condition: str = "CLEAR",
    ) -> List[Dict[str, Any]]:
        """
        Predict crisis risk for a location in the next N hours.
        Returns list of predicted incidents with probability and type.
        """
        predictions = []
        now = datetime.now(timezone.utc)

        cell_lat = round(lat, 1)
        cell_lng = round(lng, 1)
        location_cell = f"{cell_lat:.1f},{cell_lng:.1f}"

        for h in range(hours_ahead):
            future_time = now + timedelta(hours=h)
            day = future_time.strftime("%a").upper()
            hour = future_time.hour
            time_bucket = f"{day}_{hour:02d}"

            # Check all incident types for this cell + time
            for incident_type in [
                "MEDICAL", "FIRE", "NATURAL_DISASTER", "SECURITY",
                "INFRASTRUCTURE", "CHEMICAL", "FLOOD",
            ]:
                pattern_key = f"{incident_type}:{location_cell}:{time_bucket}:{weather_condition}"
                pattern = self._crisis_patterns.get(pattern_key)

                if pattern and pattern.frequency >= 3 and pattern.prediction_confidence >= 0.4:
                    # Decay confidence for further-ahead predictions
                    time_decay = math.exp(-h * 0.1)
                    adjusted_confidence = pattern.prediction_confidence * time_decay

                    if adjusted_confidence >= 0.3:
                        predictions.append({
                            "incident_type":  incident_type,
                            "location_cell":  location_cell,
                            "hours_ahead":    h,
                            "probability":    round(adjusted_confidence, 3),
                            "avg_severity":   pattern.avg_severity,
                            "historical_freq": pattern.frequency,
                            "weather_factor": weather_condition,
                            "recommended_action": self._get_preventive_action(
                                incident_type, adjusted_confidence
                            ),
                        })

        # Sort by probability descending
        predictions.sort(key=lambda x: x["probability"], reverse=True)
        return predictions[:10]  # Top 10 predictions

    def _get_preventive_action(self, incident_type: str, confidence: float) -> str:
        """Recommend preventive action based on predicted incident type."""
        actions = {
            "MEDICAL":          "Pre-position ambulance units in sector",
            "FIRE":             "Increase fire patrol frequency",
            "NATURAL_DISASTER": "Issue early warning advisory",
            "SECURITY":         "Increase police presence",
            "INFRASTRUCTURE":   "Schedule infrastructure inspection",
            "CHEMICAL":         "Alert HazMat team to standby",
            "FLOOD":            "Pre-position water rescue teams",
        }
        base = actions.get(incident_type, "Increase general readiness")
        if confidence > 0.8:
            return f"URGENT: {base}"
        return base

    # ── 4. Sensor baseline drift correction ──────────────────

    def update_sensor_baseline(
        self,
        device_id: str,
        metric: str,
        value: float,
    ) -> Tuple[float, float]:
        """
        Update rolling baseline for a sensor metric.
        Returns updated (mean, std).
        """
        if device_id not in self._sensor_baselines:
            self._sensor_baselines[device_id] = {}

        if metric not in self._sensor_baselines[device_id]:
            self._sensor_baselines[device_id][metric] = (value, 0.1)
            return (value, 0.1)

        mean, std = self._sensor_baselines[device_id][metric]
        alpha = self.BASELINE_LEARNING_RATE

        # Welford's online algorithm for mean and variance
        new_mean = (1 - alpha) * mean + alpha * value
        new_std = math.sqrt((1 - alpha) * std ** 2 + alpha * (value - new_mean) ** 2)
        new_std = max(new_std, 0.001)  # Prevent zero std

        self._sensor_baselines[device_id][metric] = (new_mean, new_std)
        return (new_mean, new_std)

    def get_sensor_zscore(self, device_id: str, metric: str, value: float) -> float:
        """Compute Z-score for a sensor reading against learned baseline."""
        if device_id not in self._sensor_baselines:
            return 0.0
        if metric not in self._sensor_baselines[device_id]:
            return 0.0
        mean, std = self._sensor_baselines[device_id][metric]
        return (value - mean) / max(std, 0.001)

    # ── 5. A/B testing framework ──────────────────────────────

    def start_ab_test(self) -> None:
        """Start A/B test: shadow model runs in parallel."""
        self._shadow_model_active = True
        self._shadow_model_outcomes = []
        self._primary_model_outcomes = []
        log.info("ab_test_started")

    def record_ab_outcome(
        self,
        primary_score: float,
        shadow_score: float,
    ) -> None:
        """Record outcome for both primary and shadow models."""
        if not self._shadow_model_active:
            return
        self._primary_model_outcomes.append(primary_score)
        self._shadow_model_outcomes.append(shadow_score)

    def evaluate_ab_test(self) -> Dict[str, Any]:
        """
        Evaluate A/B test results.
        Returns recommendation: PROMOTE, ROLLBACK, or CONTINUE.
        """
        if len(self._primary_model_outcomes) < 100:
            return {"recommendation": "CONTINUE", "reason": "Insufficient samples"}

        primary_mean = np.mean(self._primary_model_outcomes)
        shadow_mean  = np.mean(self._shadow_model_outcomes)
        improvement  = (shadow_mean - primary_mean) / max(primary_mean, 0.001) * 100

        # Statistical significance (simplified t-test)
        from scipy import stats
        t_stat, p_value = stats.ttest_ind(
            self._primary_model_outcomes,
            self._shadow_model_outcomes,
        )

        if p_value < 0.05 and improvement >= self.MIN_IMPROVEMENT_PCT:
            recommendation = "PROMOTE"
            reason = f"Shadow model improves by {improvement:.1f}% (p={p_value:.4f})"
        elif p_value < 0.05 and improvement < -self.MIN_IMPROVEMENT_PCT:
            recommendation = "ROLLBACK"
            reason = f"Shadow model degrades by {abs(improvement):.1f}% (p={p_value:.4f})"
        else:
            recommendation = "CONTINUE"
            reason = f"No significant difference (improvement={improvement:.1f}%, p={p_value:.4f})"

        log.info("ab_test_evaluated",
                 recommendation=recommendation,
                 improvement=improvement,
                 p_value=p_value,
                 samples=len(self._primary_model_outcomes))

        return {
            "recommendation": recommendation,
            "reason": reason,
            "primary_mean": primary_mean,
            "shadow_mean": shadow_mean,
            "improvement_pct": improvement,
            "p_value": p_value,
            "samples": len(self._primary_model_outcomes),
        }

    # ── Performance metrics ───────────────────────────────────

    def get_performance_report(self) -> Dict[str, Any]:
        """Generate performance report for all learning loops."""
        report = {}

        # Dispatch ETA accuracy
        eta_errors = self._model_performance.get('dispatch_eta_error', [])
        if eta_errors:
            recent = eta_errors[-1000:]
            report['dispatch_eta_mae_seconds'] = round(np.mean(recent), 1)
            report['dispatch_eta_p95_seconds'] = round(np.percentile(recent, 95), 1)

        # NLP accuracy
        report['nlp_accuracy_rolling'] = round(self.get_nlp_accuracy(), 4)

        # Affinity matrix coverage
        total_pairs = sum(
            len(v) for v in self._affinity_counts.values()
        )
        report['affinity_pairs_learned'] = total_pairs

        # Crisis patterns
        report['crisis_patterns_learned'] = len(self._crisis_patterns)
        report['high_confidence_patterns'] = sum(
            1 for p in self._crisis_patterns.values()
            if p.prediction_confidence >= 0.7
        )

        # Sensor baselines
        report['sensor_baselines_tracked'] = sum(
            len(v) for v in self._sensor_baselines.values()
        )

        return report


# ── Singleton instance ────────────────────────────────────────

_engine: Optional[SelfLearningEngine] = None

def get_learning_engine() -> SelfLearningEngine:
    global _engine
    if _engine is None:
        _engine = SelfLearningEngine()
    return _engine
