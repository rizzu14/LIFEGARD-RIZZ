"""
LIFEGRID – Kafka Client for Python services
"""
import json
import os
import asyncio
from typing import AsyncIterator, Dict, Any
from datetime import datetime, timezone
import uuid

import structlog

log = structlog.get_logger()

KAFKA_BROKERS = os.getenv("KAFKA_BROKERS", "localhost:9092").split(",")


class KafkaProducer:
    def __init__(self):
        self._producer = None

    async def _get_producer(self):
        if self._producer is None:
            try:
                from aiokafka import AIOKafkaProducer
                self._producer = AIOKafkaProducer(
                    bootstrap_servers=KAFKA_BROKERS,
                    value_serializer=lambda v: json.dumps(v).encode(),
                    key_serializer=lambda k: k.encode() if k else None,
                    compression_type="lz4",
                    enable_idempotence=True,
                )
                await self._producer.start()
            except ImportError:
                log.warning("aiokafka_not_installed_using_stub")
                self._producer = _StubProducer()
        return self._producer

    async def publish(self, topic: str, key: str, payload: Dict[str, Any]) -> None:
        producer = await self._get_producer()
        envelope = {
            "eventId":       str(uuid.uuid4()),
            "topic":         topic,
            "version":       "1.0",
            "timestamp":     datetime.now(timezone.utc).isoformat(),
            "sourceService": "satellite-service",
            "payload":       payload,
        }
        try:
            await producer.send_and_wait(topic, value=envelope, key=key)
            log.debug("kafka_published", topic=topic, key=key)
        except Exception as e:
            log.error("kafka_publish_failed", topic=topic, error=str(e))


class KafkaConsumer:
    def __init__(self, topics: list, group_id: str):
        self.topics = topics
        self.group_id = group_id

    async def consume(self) -> AsyncIterator[Dict]:
        try:
            from aiokafka import AIOKafkaConsumer
            consumer = AIOKafkaConsumer(
                *self.topics,
                bootstrap_servers=KAFKA_BROKERS,
                group_id=self.group_id,
                value_deserializer=lambda v: json.loads(v.decode()),
                auto_offset_reset="latest",
            )
            await consumer.start()
            try:
                async for msg in consumer:
                    yield msg.value
            finally:
                await consumer.stop()
        except ImportError:
            log.warning("aiokafka_not_installed_consumer_disabled")
            # Yield nothing — service runs in HTTP-only mode
            while False:
                yield {}


class _StubProducer:
    """No-op producer when Kafka is unavailable."""
    async def send_and_wait(self, *args, **kwargs):
        pass
