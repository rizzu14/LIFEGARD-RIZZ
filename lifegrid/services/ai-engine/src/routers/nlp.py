"""
LIFEGRID AI Engine – NLP Router
"""
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, field_validator

from src.models.registry import ModelRegistry
from src.cache import CacheManager
import structlog

log = structlog.get_logger()
router = APIRouter()


# ── Request / Response schemas ────────────────────────────────

class AnalyzeRequest(BaseModel):
    text: str = Field(..., min_length=3, max_length=5000)
    language: str = Field(default="en", max_length=10)

    @field_validator("text")
    @classmethod
    def text_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("text cannot be empty")
        return v.strip()


class EntityResponse(BaseModel):
    type: str
    value: str
    confidence: float
    position: Optional[dict] = None


class AnalyzeResponse(BaseModel):
    original_text: str
    translated_text: Optional[str]
    detected_language: str
    confidence: float
    entities: List[EntityResponse]
    intent: str
    sentiment: str
    keywords: List[str]
    classified_type: str
    classification_confidence: float
    medical_subtype: Optional[str]
    urgency_score: float
    processing_ms: float


class BatchAnalyzeRequest(BaseModel):
    items: List[AnalyzeRequest] = Field(..., max_length=20)


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_text(request: AnalyzeRequest):
    """
    Classify emergency text and extract entities.

    - Detects incident type (12 classes)
    - Extracts named entities (location, person, injury, hazard, etc.)
    - Scores urgency and sentiment
    - Identifies medical sub-type for MEDICAL incidents
    """
    # Cache check
    cached = await CacheManager.get("nlp_analyze", request.model_dump())
    if cached:
        return cached

    if not ModelRegistry.is_ready("nlp_classifier"):
        raise HTTPException(503, "NLP classifier not ready")

    classifier = ModelRegistry.get("nlp_classifier")
    result = classifier.analyze(request.text, request.language)

    response = AnalyzeResponse(
        original_text=result.original_text,
        translated_text=result.translated_text,
        detected_language=result.detected_language,
        confidence=result.confidence,
        entities=[EntityResponse(**e) for e in result.entities],
        intent=result.intent,
        sentiment=result.sentiment,
        keywords=result.keywords,
        classified_type=result.classified_type,
        classification_confidence=result.classification_confidence,
        medical_subtype=result.medical_subtype,
        urgency_score=result.urgency_score,
        processing_ms=result.processing_ms,
    )

    await CacheManager.set("nlp_analyze", request.model_dump(), response.model_dump(), ttl=60)
    return response


@router.post("/batch-analyze")
async def batch_analyze(request: BatchAnalyzeRequest):
    """Analyze multiple texts in a single request (max 20)."""
    if not ModelRegistry.is_ready("nlp_classifier"):
        raise HTTPException(503, "NLP classifier not ready")

    classifier = ModelRegistry.get("nlp_classifier")
    results = []
    for item in request.items:
        result = classifier.analyze(item.text, item.language)
        results.append({
            "classified_type": result.classified_type,
            "classification_confidence": result.classification_confidence,
            "sentiment": result.sentiment,
            "urgency_score": result.urgency_score,
            "entities": result.entities,
            "processing_ms": result.processing_ms,
        })

    return {"success": True, "results": results, "count": len(results)}
