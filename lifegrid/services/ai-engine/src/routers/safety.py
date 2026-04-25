"""
LIFEGRID AI Engine – Women Safety Router
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.models.registry import ModelRegistry
import structlog

log = structlog.get_logger()
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────

class AccelerometerSample(BaseModel):
    x: float
    y: float
    z: float


class SafetyClassifyRequest(BaseModel):
    device_id: str = Field(..., min_length=1, max_length=100)
    timestamp: str

    # Accelerometer: list of [x, y, z] samples (2-second window at 50Hz = 100 samples)
    accelerometer: List[List[float]] = Field(default=[], max_length=200)
    gyroscope: List[List[float]] = Field(default=[], max_length=200)

    # Physiological
    heart_rate_bpm: float = Field(default=70.0, ge=20.0, le=250.0)
    hr_baseline_bpm: float = Field(default=70.0, ge=20.0, le=250.0)
    gsr_us: float = Field(default=2.0, ge=0.0)           # skin conductance µS
    gsr_baseline_us: float = Field(default=2.0, ge=0.0)

    # Context
    sound_level_db: float = Field(default=40.0, ge=0.0, le=140.0)
    panic_button_pressed: bool = False

    # Location (optional, for alert routing)
    location: Optional[Dict[str, float]] = None


class AlertDecisionRequest(BaseModel):
    classification: Dict[str, Any]
    location: Optional[Dict[str, float]] = None


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/classify")
async def classify_safety(request: SafetyClassifyRequest):
    """
    Classify wearable sensor data for distress detection.

    Models: SVM (RBF kernel) + Naive Bayes ensemble
    Features: 52-dimensional (accelerometer, gyroscope, HR, GSR, sound)
    Classes: NORMAL, FALL, STRUGGLE, PANIC, DISTRESS, EMERGENCY

    Latency: < 50ms classification
    Alert trigger: < 3 seconds end-to-end

    Panic button press → immediate EMERGENCY classification.
    """
    if not ModelRegistry.is_ready("safety_classifier"):
        raise HTTPException(503, "Safety classifier not ready")

    classifier = ModelRegistry.get("safety_classifier")
    result = classifier.classify(request.model_dump())

    return {
        "predicted_class": result.predicted_class,
        "confidence": result.confidence,
        "probabilities": result.probabilities,
        "alert_required": result.alert_required,
        "alert_priority": result.alert_priority,
        "trigger_reason": result.trigger_reason,
        "features_used": result.features_used,
        "processing_ms": result.processing_ms,
        "model_used": result.model_used,
        "device_id": result.device_id,
        "timestamp": result.timestamp,
    }


@router.post("/alert-decision")
async def alert_decision(request: AlertDecisionRequest):
    """
    Stateful alert decision with consecutive event tracking.

    Applies temporal logic:
    - Single EMERGENCY (confidence > 0.7) → immediate alert
    - 2× consecutive STRUGGLE/PANIC → alert
    - 3× consecutive DISTRESS → alert
    - FALL (confidence > 0.85) → alert

    Maintains per-device state for consecutive window tracking.
    """
    if not ModelRegistry.is_ready("safety_classifier"):
        raise HTTPException(503, "Safety classifier not ready")

    classifier = ModelRegistry.get("safety_classifier")

    # Reconstruct classification object
    from src.models.safety_classifier import SafetyClassification
    clf = SafetyClassification(
        predicted_class=request.classification.get("predicted_class", "NORMAL"),
        confidence=request.classification.get("confidence", 0.0),
        probabilities=request.classification.get("probabilities", {}),
        alert_required=request.classification.get("alert_required", False),
        alert_priority=request.classification.get("alert_priority", "LOW"),
        trigger_reason=request.classification.get("trigger_reason", ""),
        features_used=request.classification.get("features_used", []),
        processing_ms=request.classification.get("processing_ms", 0.0),
        model_used=request.classification.get("model_used", ""),
        device_id=request.classification.get("device_id", ""),
        timestamp=request.classification.get("timestamp", ""),
    )

    decision = classifier.decide_alert(clf, request.location)

    return {
        "should_alert": decision.should_alert,
        "priority": decision.priority,
        "reason": decision.reason,
        "location": decision.location,
        "device_id": decision.device_id,
        "classification": decision.classification,
        "confidence": decision.confidence,
        "consecutive_alerts": decision.consecutive_alerts,
    }


@router.post("/stream")
async def stream_classify(request: SafetyClassifyRequest):
    """
    Combined classify + alert decision in a single call.
    Optimized for real-time wearable streaming (< 3s total latency).
    """
    if not ModelRegistry.is_ready("safety_classifier"):
        raise HTTPException(503, "Safety classifier not ready")

    classifier = ModelRegistry.get("safety_classifier")

    # Classify
    classification = classifier.classify(request.model_dump())

    # Alert decision
    decision = classifier.decide_alert(classification, request.location)

    return {
        "classification": {
            "predicted_class": classification.predicted_class,
            "confidence": classification.confidence,
            "probabilities": classification.probabilities,
            "processing_ms": classification.processing_ms,
            "model_used": classification.model_used,
        },
        "alert": {
            "should_alert": decision.should_alert,
            "priority": decision.priority,
            "reason": decision.reason,
            "consecutive_alerts": decision.consecutive_alerts,
        },
        "device_id": request.device_id,
        "timestamp": request.timestamp,
        "location": request.location,
    }
