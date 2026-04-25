"""
LIFEGRID AI Engine – Dispatch Decision Router
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.models.registry import ModelRegistry
from src.cache import CacheManager
import structlog

log = structlog.get_logger()
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────

class LocationSchema(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class ResponderSchema(BaseModel):
    id: str
    type: str
    status: str
    currentLocation: LocationSchema
    isAvailable: bool
    shiftEnd: Optional[str] = None
    capabilities: List[str] = []


class DispatchRequest(BaseModel):
    incident_location: LocationSchema
    incident_type: str
    incident_severity: str
    available_responders: List[ResponderSchema]
    nlp_urgency_score: float = Field(default=0.5, ge=0.0, le=1.0)


class ScoredResponderResponse(BaseModel):
    responder_id: str
    responder_type: str
    composite_score: float
    proximity_score: float
    availability_score: float
    type_match_score: float
    distance_km: float
    eta_seconds: int
    reason: str


class DispatchResponse(BaseModel):
    recommended_responders: List[ScoredResponderResponse]
    estimated_response_time: int
    risk_score: int
    escalation_required: bool
    predicted_casualties: Optional[int]
    resource_requirements: List[Dict[str, Any]]
    decision_confidence: float
    model_version: str
    processing_ms: float


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/decide", response_model=DispatchResponse)
async def dispatch_decision(request: DispatchRequest):
    """
    AI-powered responder selection.

    Scores all available responders using:
    - Proximity (30%) — exponential decay, type-specific radius
    - Availability (25%) — status + shift time remaining
    - Type match (25%) — affinity matrix per incident type
    - Severity urgency (10%)
    - Historical performance (10%)

    Re-ranks with XGBoost if model available.
    """
    if not ModelRegistry.is_ready("dispatch_engine"):
        raise HTTPException(503, "Dispatch engine not ready")

    engine = ModelRegistry.get("dispatch_engine")

    responders_dict = [r.model_dump() for r in request.available_responders]
    # Normalize location key
    for r in responders_dict:
        r["currentLocation"] = r["currentLocation"]

    decision = engine.decide(
        incident_location=request.incident_location.model_dump(),
        incident_type=request.incident_type,
        incident_severity=request.incident_severity,
        available_responders=responders_dict,
        nlp_urgency_score=request.nlp_urgency_score,
    )

    return DispatchResponse(
        recommended_responders=[
            ScoredResponderResponse(
                responder_id=r.responder_id,
                responder_type=r.responder_type,
                composite_score=r.composite_score,
                proximity_score=r.proximity_score,
                availability_score=r.availability_score,
                type_match_score=r.type_match_score,
                distance_km=r.distance_km,
                eta_seconds=r.eta_seconds,
                reason=r.reason,
            )
            for r in decision.recommended_responders
        ],
        estimated_response_time=decision.estimated_response_time,
        risk_score=decision.risk_score,
        escalation_required=decision.escalation_required,
        predicted_casualties=decision.predicted_casualties,
        resource_requirements=decision.resource_requirements,
        decision_confidence=decision.decision_confidence,
        model_version=decision.model_version,
        processing_ms=decision.processing_ms,
    )
