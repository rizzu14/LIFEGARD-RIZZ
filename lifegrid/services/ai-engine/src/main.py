"""
============================================================
LIFEGRID AI Engine – FastAPI Entry Point
============================================================
Exposes all AI subsystems as REST endpoints consumed by
the Node.js API Gateway.

Subsystems:
  /nlp          – Emergency text classification + NER
  /dispatch     – Responder selection decision engine
  /predict      – Flood, weather, agricultural prediction
  /missing      – Missing person face search
  /safety       – Women safety wearable alert classifier
  /health       – System health + model status
============================================================
"""

import asyncio
import time
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_fastapi_instrumentator import Instrumentator

from src.config import settings
from src.cache import CacheManager
from src.routers import nlp, dispatch, predict, missing_person, safety, health
from src.models.registry import ModelRegistry

log = structlog.get_logger()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    log.info("lifegrid_ai_engine_starting", version=settings.VERSION)

    # ── Load all models ───────────────────────────────────────
    await ModelRegistry.initialize()

    # ── Connect cache ─────────────────────────────────────────
    await CacheManager.connect()

    log.info("lifegrid_ai_engine_ready", models=ModelRegistry.loaded_models())
    yield

    # ── Shutdown ──────────────────────────────────────────────
    await CacheManager.disconnect()
    log.info("lifegrid_ai_engine_stopped")


app = FastAPI(
    title="LIFEGRID AI Engine",
    description="National Emergency AI: NLP · Dispatch · Prediction · Face Search · Safety",
    version=settings.VERSION,
    lifespan=lifespan,
    docs_url="/docs" if settings.DEBUG else None,
    redoc_url=None,
)

# ── CORS ──────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization", "X-Request-ID"],
)

# ── Prometheus metrics ────────────────────────────────────────
Instrumentator().instrument(app).expose(app, endpoint="/metrics")

# ── Request timing middleware ─────────────────────────────────
@app.middleware("http")
async def timing_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"
    log.debug("request", path=request.url.path, ms=round(elapsed_ms, 2),
              status=response.status_code)
    return response

# ── Global exception handler ──────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    log.error("unhandled_exception", path=request.url.path, error=str(exc))
    return JSONResponse(
        status_code=500,
        content={"success": False, "error": {"code": "INTERNAL_ERROR",
                                              "message": "AI engine internal error"}},
    )

# ── Routers ───────────────────────────────────────────────────
app.include_router(health.router,          prefix="/health",   tags=["Health"])
app.include_router(nlp.router,             prefix="/nlp",      tags=["NLP"])
app.include_router(dispatch.router,        prefix="/dispatch", tags=["Dispatch"])
app.include_router(predict.router,         prefix="/predict",  tags=["Prediction"])
app.include_router(missing_person.router,  prefix="/missing",  tags=["Missing Person"])
app.include_router(safety.router,          prefix="/safety",   tags=["Women Safety"])
