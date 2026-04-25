"""
============================================================
LIFEGRID AI Engine – Dispatch Decision Engine
============================================================
Architecture:
  Multi-criteria scoring with XGBoost re-ranking.

  Scoring factors (weighted):
    1. Proximity score       (30%) – inverse distance, penalizes > 30km
    2. Availability score    (25%) – status + workload + shift time
    3. Type match score      (25%) – capability alignment to incident
    4. Severity urgency      (10%) – escalation for CRITICAL
    5. Historical performance (10%) – avg response time, success rate

  Output: Ranked responder list with confidence scores,
          resource requirements, escalation flag.

Latency target: < 50ms (pure Python, no GPU)
============================================================
"""
import math
import time
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple

import numpy as np
import structlog

log = structlog.get_logger()

# ── Responder type → incident type affinity matrix ────────────
# Score 0.0–1.0: how well this responder type handles this incident type

AFFINITY_MATRIX: Dict[str, Dict[str, float]] = {
    "MEDICAL": {
        "AMBULANCE": 1.0, "MEDICAL_TEAM": 0.95, "FIRE": 0.4,
        "POLICE": 0.2, "SEARCH_RESCUE": 0.3, "HAZMAT": 0.1,
        "MILITARY": 0.1, "CYBER_UNIT": 0.0, "DISASTER_MGMT": 0.3,
    },
    "FIRE": {
        "FIRE": 1.0, "AMBULANCE": 0.5, "HAZMAT": 0.6,
        "POLICE": 0.3, "SEARCH_RESCUE": 0.4, "MEDICAL_TEAM": 0.3,
        "MILITARY": 0.2, "CYBER_UNIT": 0.0, "DISASTER_MGMT": 0.4,
    },
    "NATURAL_DISASTER": {
        "SEARCH_RESCUE": 1.0, "DISASTER_MGMT": 0.95, "MILITARY": 0.8,
        "FIRE": 0.6, "AMBULANCE": 0.7, "MEDICAL_TEAM": 0.7,
        "POLICE": 0.5, "HAZMAT": 0.3, "CYBER_UNIT": 0.0,
    },
    "SECURITY": {
        "POLICE": 1.0, "MILITARY": 0.7, "FIRE": 0.2,
        "AMBULANCE": 0.3, "SEARCH_RESCUE": 0.2, "HAZMAT": 0.1,
        "MEDICAL_TEAM": 0.2, "CYBER_UNIT": 0.1, "DISASTER_MGMT": 0.1,
    },
    "INFRASTRUCTURE": {
        "FIRE": 0.7, "POLICE": 0.6, "DISASTER_MGMT": 0.8,
        "HAZMAT": 0.5, "MILITARY": 0.4, "AMBULANCE": 0.3,
        "SEARCH_RESCUE": 0.4, "MEDICAL_TEAM": 0.2, "CYBER_UNIT": 0.2,
    },
    "CHEMICAL": {
        "HAZMAT": 1.0, "FIRE": 0.7, "AMBULANCE": 0.5,
        "MEDICAL_TEAM": 0.5, "MILITARY": 0.4, "POLICE": 0.3,
        "SEARCH_RESCUE": 0.3, "DISASTER_MGMT": 0.4, "CYBER_UNIT": 0.0,
    },
    "BIOLOGICAL": {
        "HAZMAT": 0.9, "MEDICAL_TEAM": 1.0, "AMBULANCE": 0.7,
        "MILITARY": 0.5, "DISASTER_MGMT": 0.6, "FIRE": 0.3,
        "POLICE": 0.2, "SEARCH_RESCUE": 0.2, "CYBER_UNIT": 0.0,
    },
    "RADIOLOGICAL": {
        "HAZMAT": 1.0, "MILITARY": 0.8, "DISASTER_MGMT": 0.7,
        "FIRE": 0.4, "AMBULANCE": 0.3, "MEDICAL_TEAM": 0.4,
        "POLICE": 0.3, "SEARCH_RESCUE": 0.2, "CYBER_UNIT": 0.0,
    },
    "NUCLEAR": {
        "HAZMAT": 1.0, "MILITARY": 0.9, "DISASTER_MGMT": 0.8,
        "FIRE": 0.3, "AMBULANCE": 0.2, "MEDICAL_TEAM": 0.3,
        "POLICE": 0.2, "SEARCH_RESCUE": 0.2, "CYBER_UNIT": 0.0,
    },
    "CYBER": {
        "CYBER_UNIT": 1.0, "MILITARY": 0.5, "POLICE": 0.3,
        "DISASTER_MGMT": 0.2, "FIRE": 0.0, "AMBULANCE": 0.0,
        "HAZMAT": 0.0, "SEARCH_RESCUE": 0.0, "MEDICAL_TEAM": 0.0,
    },
    "MASS_CASUALTY": {
        "AMBULANCE": 0.9, "MEDICAL_TEAM": 1.0, "FIRE": 0.7,
        "POLICE": 0.8, "MILITARY": 0.7, "SEARCH_RESCUE": 0.8,
        "DISASTER_MGMT": 0.9, "HAZMAT": 0.4, "CYBER_UNIT": 0.0,
    },
    "UNKNOWN": {
        "POLICE": 0.7, "AMBULANCE": 0.6, "FIRE": 0.5,
        "MEDICAL_TEAM": 0.5, "SEARCH_RESCUE": 0.4, "HAZMAT": 0.3,
        "MILITARY": 0.3, "DISASTER_MGMT": 0.3, "CYBER_UNIT": 0.1,
    },
}

# Severity → minimum responder count
MIN_RESPONDERS: Dict[str, int] = {
    "CRITICAL": 5, "HIGH": 3, "MEDIUM": 2, "LOW": 1,
}

# Severity → max dispatch radius (km)
MAX_RADIUS_KM: Dict[str, float] = {
    "CRITICAL": 100.0, "HIGH": 60.0, "MEDIUM": 40.0, "LOW": 25.0,
}

# Average speed by responder type (km/h) for ETA calculation
AVG_SPEED_KMH: Dict[str, float] = {
    "AMBULANCE": 80.0, "FIRE": 70.0, "POLICE": 90.0,
    "HAZMAT": 60.0, "SEARCH_RESCUE": 65.0, "MILITARY": 100.0,
    "CYBER_UNIT": 70.0, "MEDICAL_TEAM": 75.0, "DISASTER_MGMT": 65.0,
}

# Scoring weights
WEIGHTS = {
    "proximity":    0.30,
    "availability": 0.25,
    "type_match":   0.25,
    "severity":     0.10,
    "performance":  0.10,
}


@dataclass
class ScoredResponder:
    responder_id: str
    responder_type: str
    composite_score: float
    proximity_score: float
    availability_score: float
    type_match_score: float
    distance_km: float
    eta_seconds: int
    reason: str


@dataclass
class DispatchDecision:
    recommended_responders: List[ScoredResponder]
    estimated_response_time: int   # seconds (fastest responder)
    risk_score: int                # 0–100
    escalation_required: bool
    predicted_casualties: Optional[int]
    resource_requirements: List[Dict]
    decision_confidence: float
    model_version: str
    processing_ms: float


class DispatchEngine:
    """
    Multi-criteria responder selection with XGBoost re-ranking.
    Falls back to pure weighted scoring if XGBoost unavailable.
    """

    MODEL_VERSION = "2.0.0"

    def __init__(self):
        self._xgb_model = None
        self._xgb_ready = False
        self._init_xgboost()

    def _init_xgboost(self) -> None:
        """
        In production: load pre-trained XGBoost model from disk.
        The model is trained on historical dispatch outcomes:
          features: [distance, type_affinity, availability, severity, time_of_day, weather]
          target:   response_success (1/0) + response_time_minutes
        """
        try:
            import xgboost as xgb
            import os
            from src.config import settings
            model_path = os.path.join(settings.MODELS_DIR, "dispatch_xgb.json")
            if os.path.exists(model_path):
                self._xgb_model = xgb.XGBClassifier()
                self._xgb_model.load_model(model_path)
                self._xgb_ready = True
                log.info("dispatch_xgb_loaded")
            else:
                log.info("dispatch_xgb_model_not_found_using_weighted_scoring")
        except Exception as e:
            log.warning("dispatch_xgb_unavailable", error=str(e))

    # ── Public interface ──────────────────────────────────────

    def decide(
        self,
        incident_location: Dict,
        incident_type: str,
        incident_severity: str,
        available_responders: List[Dict],
        nlp_urgency_score: float = 0.5,
    ) -> DispatchDecision:
        t0 = time.perf_counter()

        if not available_responders:
            return self._empty_decision(t0)

        # Score all responders
        scored = [
            self._score_responder(r, incident_location, incident_type,
                                  incident_severity, nlp_urgency_score)
            for r in available_responders
        ]

        # XGBoost re-ranking (if available)
        if self._xgb_ready:
            scored = self._xgb_rerank(scored, incident_type, incident_severity)
        else:
            scored.sort(key=lambda s: s.composite_score, reverse=True)

        # Select top N based on severity
        min_count = MIN_RESPONDERS.get(incident_severity, 2)
        selected = scored[:max(min_count, 1)]

        # Risk score
        risk_score = self._calculate_risk(incident_type, incident_severity,
                                          nlp_urgency_score, len(available_responders))

        # Resource requirements
        resources = self._build_resource_requirements(incident_type, incident_severity)

        # Predicted casualties
        casualties = self._estimate_casualties(incident_type, incident_severity)

        ms = (time.perf_counter() - t0) * 1000

        return DispatchDecision(
            recommended_responders=selected,
            estimated_response_time=selected[0].eta_seconds if selected else 600,
            risk_score=risk_score,
            escalation_required=risk_score >= 75 or incident_severity == "CRITICAL",
            predicted_casualties=casualties,
            resource_requirements=resources,
            decision_confidence=self._confidence(scored, selected),
            model_version=self.MODEL_VERSION,
            processing_ms=round(ms, 2),
        )

    # ── Scoring ───────────────────────────────────────────────

    def _score_responder(
        self,
        responder: Dict,
        incident_loc: Dict,
        incident_type: str,
        severity: str,
        urgency: float,
    ) -> ScoredResponder:
        dist_km = self._haversine(
            incident_loc["lat"], incident_loc["lng"],
            responder["currentLocation"]["lat"],
            responder["currentLocation"]["lng"],
        )

        # 1. Proximity score (exponential decay, 30km half-life)
        max_radius = MAX_RADIUS_KM.get(severity, 50.0)
        proximity = math.exp(-dist_km / (max_radius * 0.4)) if dist_km <= max_radius else 0.0

        # 2. Availability score
        availability = self._availability_score(responder)

        # 3. Type match score
        affinity_map = AFFINITY_MATRIX.get(incident_type, AFFINITY_MATRIX["UNKNOWN"])
        type_match = affinity_map.get(responder.get("type", "POLICE"), 0.3)

        # 4. Severity urgency modifier
        severity_weights = {"CRITICAL": 1.0, "HIGH": 0.8, "MEDIUM": 0.6, "LOW": 0.4}
        severity_mod = severity_weights.get(severity, 0.6)

        # 5. Historical performance (placeholder — use real data in production)
        performance = responder.get("_performanceScore", 0.75)

        # Composite weighted score
        composite = (
            WEIGHTS["proximity"]    * proximity +
            WEIGHTS["availability"] * availability +
            WEIGHTS["type_match"]   * type_match +
            WEIGHTS["severity"]     * severity_mod +
            WEIGHTS["performance"]  * performance
        )

        # ETA calculation
        speed = AVG_SPEED_KMH.get(responder.get("type", "POLICE"), 70.0)
        # Emergency vehicles get 20% speed boost for CRITICAL
        if severity == "CRITICAL":
            speed *= 1.2
        eta_seconds = int((dist_km / speed) * 3600)

        reason = self._build_reason(proximity, type_match, availability, dist_km)

        return ScoredResponder(
            responder_id=responder["id"],
            responder_type=responder.get("type", "UNKNOWN"),
            composite_score=round(composite, 4),
            proximity_score=round(proximity, 4),
            availability_score=round(availability, 4),
            type_match_score=round(type_match, 4),
            distance_km=round(dist_km, 2),
            eta_seconds=eta_seconds,
            reason=reason,
        )

    def _availability_score(self, responder: Dict) -> float:
        status = responder.get("status", "AVAILABLE")
        status_scores = {
            "AVAILABLE":   1.0,
            "RETURNING":   0.6,
            "ON_SCENE":    0.1,
            "EN_ROUTE":    0.05,
            "DISPATCHED":  0.05,
            "MAINTENANCE": 0.0,
            "OFFLINE":     0.0,
        }
        base = status_scores.get(status, 0.0)

        # Penalize if shift ending soon (< 30 min)
        shift_end = responder.get("shiftEnd")
        if shift_end:
            try:
                from datetime import datetime, timezone
                end_dt = datetime.fromisoformat(shift_end.replace("Z", "+00:00"))
                now = datetime.now(timezone.utc)
                minutes_left = (end_dt - now).total_seconds() / 60
                if minutes_left < 30:
                    base *= 0.5
                elif minutes_left < 60:
                    base *= 0.8
            except Exception:
                pass

        return base

    def _xgb_rerank(
        self, scored: List[ScoredResponder], incident_type: str, severity: str
    ) -> List[ScoredResponder]:
        """Re-rank using XGBoost predictions."""
        try:
            import numpy as np
            features = np.array([[
                s.proximity_score,
                s.availability_score,
                s.type_match_score,
                s.distance_km / 100.0,
                s.eta_seconds / 3600.0,
                {"CRITICAL": 1.0, "HIGH": 0.75, "MEDIUM": 0.5, "LOW": 0.25}.get(severity, 0.5),
            ] for s in scored])

            proba = self._xgb_model.predict_proba(features)[:, 1]
            for i, s in enumerate(scored):
                # Blend XGBoost probability with composite score
                s.composite_score = 0.6 * float(proba[i]) + 0.4 * s.composite_score

            scored.sort(key=lambda s: s.composite_score, reverse=True)
        except Exception as e:
            log.warning("xgb_rerank_failed", error=str(e))
            scored.sort(key=lambda s: s.composite_score, reverse=True)

        return scored

    # ── Risk & resource calculation ───────────────────────────

    def _calculate_risk(
        self, incident_type: str, severity: str,
        urgency: float, responder_count: int
    ) -> int:
        base_risk = {
            "CRITICAL": 70, "HIGH": 50, "MEDIUM": 30, "LOW": 10,
        }.get(severity, 30)

        type_risk_bonus = {
            "NUCLEAR": 30, "RADIOLOGICAL": 25, "BIOLOGICAL": 20,
            "CHEMICAL": 18, "MASS_CASUALTY": 22, "NATURAL_DISASTER": 15,
            "SECURITY": 12, "FIRE": 10, "MEDICAL": 8,
            "INFRASTRUCTURE": 8, "CYBER": 10, "UNKNOWN": 5,
        }.get(incident_type, 5)

        urgency_bonus = int(urgency * 15)

        # Penalize if very few responders available
        resource_penalty = max(0, (3 - responder_count) * 5)

        return min(base_risk + type_risk_bonus + urgency_bonus + resource_penalty, 100)

    def _build_resource_requirements(
        self, incident_type: str, severity: str
    ) -> List[Dict]:
        affinity = AFFINITY_MATRIX.get(incident_type, AFFINITY_MATRIX["UNKNOWN"])
        # Select top 3 responder types by affinity
        top_types = sorted(affinity.items(), key=lambda x: x[1], reverse=True)[:3]

        priority_map = {"CRITICAL": "CRITICAL", "HIGH": "HIGH", "MEDIUM": "MEDIUM", "LOW": "LOW"}
        priority = priority_map.get(severity, "MEDIUM")

        return [
            {"type": rtype, "quantity": 1 if score < 0.8 else 2, "priority": priority}
            for rtype, score in top_types
            if score > 0.3
        ]

    def _estimate_casualties(self, incident_type: str, severity: str) -> Optional[int]:
        if severity not in ("CRITICAL", "HIGH"):
            return None
        estimates = {
            "MASS_CASUALTY": 50, "NUCLEAR": 1000, "RADIOLOGICAL": 200,
            "BIOLOGICAL": 100, "NATURAL_DISASTER": 30, "CHEMICAL": 20,
            "FIRE": 5, "SECURITY": 3, "MEDICAL": 1,
        }
        return estimates.get(incident_type)

    def _confidence(
        self, all_scored: List[ScoredResponder], selected: List[ScoredResponder]
    ) -> float:
        if not selected:
            return 0.0
        top_score = selected[0].composite_score
        # Confidence is higher when top score is clearly better than second
        if len(all_scored) > 1:
            gap = top_score - all_scored[1].composite_score
            return min(0.5 + top_score * 0.3 + gap * 0.5, 0.99)
        return min(0.5 + top_score * 0.4, 0.95)

    def _build_reason(
        self, proximity: float, type_match: float,
        availability: float, dist_km: float
    ) -> str:
        parts = []
        if proximity > 0.7:
            parts.append(f"nearest unit ({dist_km:.1f}km)")
        if type_match > 0.8:
            parts.append("optimal type match")
        if availability > 0.9:
            parts.append("fully available")
        return ", ".join(parts) if parts else f"{dist_km:.1f}km away"

    def _empty_decision(self, t0: float) -> DispatchDecision:
        return DispatchDecision(
            recommended_responders=[],
            estimated_response_time=0,
            risk_score=50,
            escalation_required=True,
            predicted_casualties=None,
            resource_requirements=[],
            decision_confidence=0.0,
            model_version=self.MODEL_VERSION,
            processing_ms=round((time.perf_counter() - t0) * 1000, 2),
        )

    @staticmethod
    def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
        R = 6371.0
        dlat = math.radians(lat2 - lat1)
        dlng = math.radians(lng2 - lng1)
        a = (math.sin(dlat / 2) ** 2 +
             math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
             math.sin(dlng / 2) ** 2)
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
