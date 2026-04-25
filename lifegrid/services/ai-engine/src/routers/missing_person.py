"""
LIFEGRID AI Engine – Missing Person Router
"""
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from src.models.registry import ModelRegistry
import structlog

log = structlog.get_logger()
router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────

class LocationSchema(BaseModel):
    lat: float
    lng: float


class SearchRequest(BaseModel):
    image_base64: str = Field(..., min_length=100)
    search_radius_km: float = Field(default=50.0, ge=0.1, le=500.0)
    center_location: Optional[LocationSchema] = None
    max_results: int = Field(default=5, ge=1, le=20)


class RegisterRequest(BaseModel):
    person_id: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=1, max_length=200)
    age: Optional[int] = Field(default=None, ge=0, le=150)
    images_base64: List[str] = Field(..., min_length=1, max_length=5)
    last_known_location: Optional[LocationSchema] = None
    missing_since: Optional[str] = None
    description: Optional[str] = Field(default=None, max_length=2000)


# ── Endpoints ─────────────────────────────────────────────────

@router.post("/search")
async def search_missing_person(request: SearchRequest):
    """
    Search for a missing person using face recognition.

    Pipeline:
    1. RetinaFace detection → bounding boxes
    2. ArcFace R100 → 512-d L2-normalized embedding
    3. FAISS IVF-PQ search → top-k matches
    4. Geographic filter by radius
    5. Geospatial risk heatmap (Brownian motion model)

    Returns matches with similarity score, confidence level,
    risk assessment, and location probability heatmap.
    """
    if not ModelRegistry.is_ready("face_recognizer"):
        raise HTTPException(503, "Face recognizer not ready")

    recognizer = ModelRegistry.get("face_recognizer")
    result = recognizer.search(request.model_dump())

    return {
        "matches": [
            {
                "person_id": m.person_id,
                "name": m.name,
                "age": m.age,
                "similarity": m.similarity,
                "confidence": m.confidence,
                "last_known_location": m.last_known_location,
                "missing_since": m.missing_since,
                "risk_level": m.risk_level,
                "geospatial_heatmap": m.geospatial_heatmap,
                "description": m.description,
            }
            for m in result.matches
        ],
        "faces_detected": result.faces_detected,
        "query_embedding_computed": result.query_embedding_computed,
        "processing_ms": result.processing_ms,
        "model_used": result.model_used,
    }


@router.post("/register")
async def register_missing_person(request: RegisterRequest):
    """
    Register a missing person's face embeddings in the search index.

    Accepts up to 5 images per person for robust multi-angle coverage.
    Embeddings are stored in FAISS index for fast retrieval.
    """
    if not ModelRegistry.is_ready("face_recognizer"):
        raise HTTPException(503, "Face recognizer not ready")

    recognizer = ModelRegistry.get("face_recognizer")
    result = recognizer.register(request.model_dump())

    if not result.success:
        raise HTTPException(422, f"Registration failed: {result.message}")

    return {
        "person_id": result.person_id,
        "embeddings_stored": result.embeddings_stored,
        "success": result.success,
        "message": result.message,
    }


@router.delete("/deregister/{person_id}")
async def deregister_missing_person(person_id: str):
    """Remove a person from the missing persons index (found/resolved)."""
    if not ModelRegistry.is_ready("face_recognizer"):
        raise HTTPException(503, "Face recognizer not ready")

    recognizer = ModelRegistry.get("face_recognizer")
    if person_id in recognizer._metadata:
        del recognizer._metadata[person_id]
        recognizer._persist_metadata()
        return {"success": True, "message": f"Person {person_id} removed from index"}

    raise HTTPException(404, f"Person {person_id} not found in index")
