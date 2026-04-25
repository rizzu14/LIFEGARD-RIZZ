"""
LIFEGRID AI Engine – Redis Cache Manager
"""
import json
import hashlib
from typing import Any, Optional

import redis.asyncio as aioredis
import structlog

from src.config import settings

log = structlog.get_logger()


class CacheManager:
    _client: Optional[aioredis.Redis] = None

    @classmethod
    async def connect(cls) -> None:
        try:
            cls._client = aioredis.from_url(
                settings.REDIS_URL,
                encoding="utf-8",
                decode_responses=True,
                socket_connect_timeout=5,
            )
            await cls._client.ping()
            log.info("cache_connected", url=settings.REDIS_URL)
        except Exception as e:
            log.warning("cache_unavailable", error=str(e))
            cls._client = None

    @classmethod
    async def disconnect(cls) -> None:
        if cls._client:
            await cls._client.aclose()

    @classmethod
    def _make_key(cls, namespace: str, payload: Any) -> str:
        raw = json.dumps(payload, sort_keys=True, default=str)
        digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
        return f"lifegrid:ai:{namespace}:{digest}"

    @classmethod
    async def get(cls, namespace: str, payload: Any) -> Optional[Any]:
        if not cls._client:
            return None
        try:
            key = cls._make_key(namespace, payload)
            value = await cls._client.get(key)
            return json.loads(value) if value else None
        except Exception:
            return None

    @classmethod
    async def set(cls, namespace: str, payload: Any, result: Any,
                  ttl: int = settings.CACHE_TTL_SECONDS) -> None:
        if not cls._client:
            return
        try:
            key = cls._make_key(namespace, payload)
            await cls._client.setex(key, ttl, json.dumps(result, default=str))
        except Exception:
            pass

    @classmethod
    def is_connected(cls) -> bool:
        return cls._client is not None
