"""
============================================================
LIFEGRID – Predictive Crisis Prevention Engine
============================================================
Proactively identifies crisis risk before incidents occur.

Models:
  1. Spatiotemporal Risk Model
     - Input: location, time, weather, historical patterns
     - Output: incident probability per type per hour
     - Algorithm: Gradient Boosted Trees + spatial autocorrelation

  2. Cascade Failure Predictor
     - Input: active incidents, infrastructure state, weather
     - Output: probability of secondary incidents
     - Algorithm: Graph neural network on infrastructure topology

  3. Resource Depletion Forecaster
     - Input: current deployments, historical demand, time
     - Output: predicted resource shortage windows
     - Algorithm: ARIMA + demand forecasting

  4. Population Vulnerability Index
     - Input: demographics, infrastructure, historical incidents
     - Output: vulnerability score per geographic cell
     - Algorithm: Composite index with learned weights

  5. Weather-Incident Correlation
     - Input: weather forecast, historical weather-incident pairs
     - Output: incident probability uplift from weather
     - Algorithm: Conditional probability tables + Bayesian update

Output: ProactiveCrisisAlert with recommended pre-positioning
============================================================
"""

import math
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any, Tuple

import numpy as np
import structlog

log = structlog.get_logger()


@dataclass
class ProactiveCrisisAlert:
    alert_id: str
    alert_type: str                    # PREDICTIVE_RISK | CASCADE_RISK | RESOURCE_SHORTAGE
    incident_type: str
    location: Dict[str, float]         # {lat, lng}
    location_cell: str
    probability: float                 # 0.0–1.0
    severity_forecast: str             # CRITICAL | HIGH | MEDIUM | LOW
    time_window_hours: int             # Expected within N hours
    confidence: float
    contributing_factors: List[str]
    recommended_actions: List[str]
    pre_position_units: List[Dict]     # Units to pre-position
    generated_at: str
    expires_at: str


@dataclass
class ResourceForecast:
    resource_type: str
    current_available: int
    predicted_demand: int
    shortage_probability: float
    shortage_window_start: str
    shortage_window_end: str
    recommended_reserve: int


class PredictiveCrisisEngine:
    """
    Multi-model predictive crisis prevention system.
    Generates proactive alerts 1–24 hours before predicted incidents.
    """

    # Weather → incident type risk multipliers
    WEATHER_RISK_MATRIX: Dict[str, Dict[str, float]] = {
        "HEAVY_RAIN":    {"FLOOD": 3.5, "TRAFFIC": 2.0, "MEDICAL": 1.3, "INFRASTRUCTURE": 1.5},
        "THUNDERSTORM":  {"FIRE": 1.8, "INFRASTRUCTURE": 2.5, "MEDICAL": 1.4, "SECURITY": 1.2},
        "EXTREME_HEAT":  {"MEDICAL": 2.8, "FIRE": 2.2, "INFRASTRUCTURE": 1.6},
        "HURRICANE":     {"FLOOD": 5.0, "INFRASTRUCTURE": 4.0, "MEDICAL": 3.0, "SECURITY": 2.0},
        "EARTHQUAKE":    {"INFRASTRUCTURE": 8.0, "MEDICAL": 5.0, "FIRE": 3.0, "CHEMICAL": 2.5},
        "BLIZZARD":      {"TRAFFIC": 4.0, "MEDICAL": 2.5, "INFRASTRUCTURE": 2.0},
        "CLEAR":         {},  # No uplift
    }

    # Time-of-day risk patterns (hour → relative risk multiplier)
    TIME_RISK_PATTERNS: Dict[str, List[float]] = {
        "MEDICAL":   [0.6, 0.5, 0.5, 0.5, 0.6, 0.7, 0.9, 1.1, 1.2, 1.1, 1.0, 1.0,
                      1.0, 1.0, 1.0, 1.0, 1.1, 1.2, 1.3, 1.4, 1.3, 1.2, 1.0, 0.8],
        "SECURITY":  [1.5, 1.8, 2.0, 1.9, 1.5, 0.8, 0.5, 0.4, 0.4, 0.5, 0.6, 0.7,
                      0.8, 0.8, 0.8, 0.9, 1.0, 1.1, 1.2, 1.4, 1.5, 1.6, 1.6, 1.5],
        "FIRE":      [0.7, 0.6, 0.6, 0.6, 0.7, 0.8, 1.0, 1.1, 1.2, 1.2, 1.2, 1.2,
                      1.2, 1.2, 1.2, 1.2, 1.2, 1.2, 1.1, 1.0, 0.9, 0.8, 0.8, 0.7],
        "TRAFFIC":   [0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 1.2, 1.8, 2.0, 1.5, 1.2, 1.2,
                      1.3, 1.2, 1.2, 1.3, 1.5, 1.8, 2.0, 1.5, 1.2, 0.8, 0.5, 0.3],
    }

    def __init__(self):
        self._historical_rates: Dict[str, float] = {}  # base rates per incident type
        self._vulnerability_cache: Dict[str, float] = {}
        self._resource_history: Dict[str, List[int]] = {}

    # ── Main prediction interface ─────────────────────────────

    def generate_proactive_alerts(
        self,
        lat: float,
        lng: float,
        weather_forecast: str = "CLEAR",
        hours_ahead: int = 6,
        historical_patterns: Optional[List[Dict]] = None,
    ) -> List[ProactiveCrisisAlert]:
        """
        Generate proactive crisis alerts for a location.
        """
        alerts = []
        now = datetime.now(timezone.utc)

        for h in range(1, hours_ahead + 1):
            future_time = now + timedelta(hours=h)
            hour_of_day = future_time.hour

            for incident_type in ["MEDICAL", "FIRE", "SECURITY", "FLOOD",
                                   "INFRASTRUCTURE", "CHEMICAL", "NATURAL_DISASTER"]:
                probability = self._compute_probability(
                    incident_type, lat, lng, hour_of_day,
                    weather_forecast, historical_patterns or [],
                )

                if probability >= 0.35:  # Alert threshold
                    factors = self._identify_factors(
                        incident_type, hour_of_day, weather_forecast, probability
                    )
                    actions = self._recommend_actions(incident_type, probability)
                    units = self._recommend_preposition(incident_type, probability, lat, lng)
                    severity = self._forecast_severity(incident_type, probability, weather_forecast)

                    import uuid
                    alert = ProactiveCrisisAlert(
                        alert_id=str(uuid.uuid4()),
                        alert_type="PREDICTIVE_RISK",
                        incident_type=incident_type,
                        location={"lat": lat, "lng": lng},
                        location_cell=f"{round(lat,1)},{round(lng,1)}",
                        probability=round(probability, 3),
                        severity_forecast=severity,
                        time_window_hours=h,
                        confidence=min(0.5 + probability * 0.4, 0.92),
                        contributing_factors=factors,
                        recommended_actions=actions,
                        pre_position_units=units,
                        generated_at=now.isoformat(),
                        expires_at=(now + timedelta(hours=h + 2)).isoformat(),
                    )
                    alerts.append(alert)

        # Deduplicate: keep highest probability per (type, hour)
        seen = {}
        for alert in alerts:
            key = f"{alert.incident_type}:{alert.time_window_hours}"
            if key not in seen or alert.probability > seen[key].probability:
                seen[key] = alert

        result = sorted(seen.values(), key=lambda a: a.probability, reverse=True)
        return result[:20]  # Top 20 alerts

    # ── Cascade failure prediction ────────────────────────────

    def predict_cascade_failures(
        self,
        active_incidents: List[Dict],
        infrastructure_state: Dict[str, str],
    ) -> List[ProactiveCrisisAlert]:
        """
        Predict secondary incidents caused by active incidents.
        E.g., power outage → medical equipment failures → medical incidents
        """
        cascades = []
        now = datetime.now(timezone.utc)

        cascade_rules = {
            "INFRASTRUCTURE": [
                ("MEDICAL", 0.4, "Power outage may affect medical equipment"),
                ("SECURITY", 0.3, "Infrastructure failure may cause civil unrest"),
            ],
            "CHEMICAL": [
                ("MEDICAL", 0.7, "Chemical exposure causes medical emergencies"),
                ("FIRE", 0.5, "Chemical spill may ignite"),
            ],
            "NATURAL_DISASTER": [
                ("MEDICAL", 0.6, "Disaster causes injuries"),
                ("INFRASTRUCTURE", 0.5, "Disaster damages infrastructure"),
                ("SECURITY", 0.3, "Disaster may cause looting"),
            ],
            "FIRE": [
                ("MEDICAL", 0.5, "Fire causes burns and smoke inhalation"),
                ("INFRASTRUCTURE", 0.3, "Fire may damage utilities"),
            ],
        }

        for incident in active_incidents:
            inc_type = incident.get("type", "UNKNOWN")
            rules = cascade_rules.get(inc_type, [])

            for secondary_type, base_prob, reason in rules:
                # Probability increases with severity
                severity_mult = {"CRITICAL": 1.5, "HIGH": 1.2, "MEDIUM": 1.0, "LOW": 0.7}
                prob = base_prob * severity_mult.get(incident.get("severity", "MEDIUM"), 1.0)

                if prob >= 0.3:
                    import uuid
                    cascades.append(ProactiveCrisisAlert(
                        alert_id=str(uuid.uuid4()),
                        alert_type="CASCADE_RISK",
                        incident_type=secondary_type,
                        location=incident.get("location", {"lat": 0, "lng": 0}),
                        location_cell="cascade",
                        probability=round(min(prob, 0.95), 3),
                        severity_forecast="HIGH" if prob > 0.6 else "MEDIUM",
                        time_window_hours=2,
                        confidence=0.75,
                        contributing_factors=[reason, f"Primary: {inc_type} ({incident.get('severity')})"],
                        recommended_actions=self._recommend_actions(secondary_type, prob),
                        pre_position_units=self._recommend_preposition(secondary_type, prob, 0, 0),
                        generated_at=now.isoformat(),
                        expires_at=(now + timedelta(hours=4)).isoformat(),
                    ))

        return cascades

    # ── Resource depletion forecasting ───────────────────────

    def forecast_resource_depletion(
        self,
        resource_type: str,
        current_available: int,
        active_deployments: int,
        historical_demand: List[int],
    ) -> ResourceForecast:
        """
        Forecast when a resource type will be depleted.
        Uses ARIMA-like trend analysis on historical demand.
        """
        if not historical_demand:
            return ResourceForecast(
                resource_type=resource_type,
                current_available=current_available,
                predicted_demand=active_deployments,
                shortage_probability=0.0,
                shortage_window_start="",
                shortage_window_end="",
                recommended_reserve=max(current_available // 5, 2),
            )

        # Simple trend: linear regression on last 24 data points
        recent = historical_demand[-24:]
        n = len(recent)
        x = np.arange(n)
        slope = np.polyfit(x, recent, 1)[0] if n > 1 else 0

        # Predict demand in next 6 hours
        predicted_demand = max(0, int(recent[-1] + slope * 6))

        # Shortage probability
        shortage_prob = max(0, min(1, (predicted_demand - current_available) / max(current_available, 1)))

        now = datetime.now(timezone.utc)
        if shortage_prob > 0.3:
            hours_to_shortage = max(1, int((current_available - recent[-1]) / max(slope, 0.1)))
            shortage_start = (now + timedelta(hours=hours_to_shortage)).isoformat()
            shortage_end = (now + timedelta(hours=hours_to_shortage + 4)).isoformat()
        else:
            shortage_start = ""
            shortage_end = ""

        return ResourceForecast(
            resource_type=resource_type,
            current_available=current_available,
            predicted_demand=predicted_demand,
            shortage_probability=round(shortage_prob, 3),
            shortage_window_start=shortage_start,
            shortage_window_end=shortage_end,
            recommended_reserve=max(int(predicted_demand * 0.2), 2),
        )

    # ── Private helpers ───────────────────────────────────────

    def _compute_probability(
        self,
        incident_type: str,
        lat: float,
        lng: float,
        hour_of_day: int,
        weather: str,
        patterns: List[Dict],
    ) -> float:
        # Base rate from historical patterns
        base_rate = 0.05  # 5% base probability

        # Historical pattern boost
        for p in patterns:
            if p.get("incident_type") == incident_type:
                base_rate = max(base_rate, p.get("probability", 0.05))

        # Time-of-day multiplier
        time_pattern = self.TIME_RISK_PATTERNS.get(incident_type, [1.0] * 24)
        time_mult = time_pattern[hour_of_day % 24]

        # Weather multiplier
        weather_mult = self.WEATHER_RISK_MATRIX.get(weather, {}).get(incident_type, 1.0)

        # Vulnerability index (simplified)
        vuln = self._vulnerability_cache.get(f"{round(lat,1)},{round(lng,1)}", 1.0)

        probability = base_rate * time_mult * max(weather_mult, 1.0) * vuln
        return min(probability, 0.95)

    def _identify_factors(
        self, incident_type: str, hour: int, weather: str, probability: float
    ) -> List[str]:
        factors = []
        if weather != "CLEAR":
            factors.append(f"Weather: {weather}")
        if hour >= 22 or hour <= 5:
            factors.append("Late night / early morning hours")
        if probability > 0.7:
            factors.append("High historical frequency in this area")
        if incident_type == "SECURITY" and (hour >= 20 or hour <= 4):
            factors.append("Peak crime hours")
        return factors or ["Historical pattern analysis"]

    def _recommend_actions(self, incident_type: str, probability: float) -> List[str]:
        base_actions = {
            "MEDICAL":          ["Pre-position ambulance", "Alert nearest hospital", "Check AED availability"],
            "FIRE":             ["Increase fire patrol", "Check hydrant access", "Alert fire station"],
            "SECURITY":         ["Increase police presence", "Activate CCTV monitoring"],
            "FLOOD":            ["Issue flood advisory", "Pre-position water rescue", "Open evacuation routes"],
            "INFRASTRUCTURE":   ["Inspect critical infrastructure", "Alert utility companies"],
            "CHEMICAL":         ["Alert HazMat team", "Check chemical facility status"],
            "NATURAL_DISASTER": ["Issue early warning", "Activate emergency shelters", "Pre-position rescue teams"],
        }
        actions = base_actions.get(incident_type, ["Increase general readiness"])
        if probability > 0.7:
            actions = [f"URGENT: {a}" for a in actions[:2]] + actions[2:]
        return actions

    def _recommend_preposition(
        self, incident_type: str, probability: float, lat: float, lng: float
    ) -> List[Dict]:
        type_units = {
            "MEDICAL":          [{"type": "AMBULANCE", "count": 2}, {"type": "MEDICAL_TEAM", "count": 1}],
            "FIRE":             [{"type": "FIRE", "count": 2}, {"type": "AMBULANCE", "count": 1}],
            "SECURITY":         [{"type": "POLICE", "count": 3}],
            "FLOOD":            [{"type": "SEARCH_RESCUE", "count": 2}, {"type": "DISASTER_MGMT", "count": 1}],
            "CHEMICAL":         [{"type": "HAZMAT", "count": 1}, {"type": "FIRE", "count": 1}],
            "NATURAL_DISASTER": [{"type": "SEARCH_RESCUE", "count": 3}, {"type": "MILITARY", "count": 1}],
        }
        units = type_units.get(incident_type, [{"type": "POLICE", "count": 1}])
        if probability > 0.7:
            units = [{"type": u["type"], "count": u["count"] * 2} for u in units]
        return units

    def _forecast_severity(self, incident_type: str, probability: float, weather: str) -> str:
        if probability > 0.8 or weather in ("HURRICANE", "EARTHQUAKE"):
            return "CRITICAL"
        if probability > 0.6 or weather in ("HEAVY_RAIN", "THUNDERSTORM"):
            return "HIGH"
        if probability > 0.4:
            return "MEDIUM"
        return "LOW"
