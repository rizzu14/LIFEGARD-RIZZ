// ============================================================
// LIFEGRID – Emergency Ingestion Service
// Port: 4001
//
// Responsibilities:
//   - Receive emergency events from ALL sources
//   - Normalize into canonical IncidentTrigger schema
//   - Deduplicate (Redis, 60s window)
//   - Validate and enrich (geocode, language detect)
//   - Publish to Kafka: lifegrid.incident.triggered
//   - Offline queue for satellite-connected devices
//
// Sources handled:
//   VOICE_CALL · SMS · MOBILE_APP · PANIC_BUTTON
//   IOT_SENSOR · SATELLITE · SOCIAL_MEDIA · CCTV · API
// ============================================================

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';

import { KafkaClient } from '../../event-bus/src/KafkaClient';
import { TOPICS } from '../../event-bus/src/topics';
import { logger } from './utils/logger';
import { TwilioVoiceHandler } from './handlers/TwilioVoiceHandler';
import { SMSHandler } from './handlers/SMSHandler';
import { SatelliteIngestHandler } from './handlers/SatelliteIngestHandler';
import { CCTVHandler } from './handlers/CCTVHandler';
import { SocialMediaHandler } from './handlers/SocialMediaHandler';
import { RedundancyManager } from './redundancy/RedundancyManager';

const PORT = parseInt(process.env.PORT ?? '4001', 10);
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

// ── Validation schemas ────────────────────────────────────────

const MobileReportSchema = z.object({
  rawInput:    z.string().min(3).max(5000),
  language:    z.string().default('en'),
  source:      z.enum(['MOBILE_APP', 'PANIC_BUTTON', 'API']).default('MOBILE_APP'),
  location:    z.object({ lat: z.number(), lng: z.number() }).optional(),
  mediaUrls:   z.array(z.string().url()).max(10).optional(),
  callerPhone: z.string().optional(),
  deviceId:    z.string().optional(),
});

const IoTPayloadSchema = z.object({
  deviceId:   z.string().min(1),
  deviceType: z.enum(['SMOKE','FLOOD','SEISMIC','CHEMICAL','RADIATION','PANIC_BUTTON','CCTV','WEATHER']),
  location:   z.object({ lat: z.number(), lng: z.number() }),
  readings:   z.array(z.object({
    metric: z.string(), value: z.number(), unit: z.string(),
    threshold: z.number().optional(), isAnomalous: z.boolean(),
  })),
  timestamp:  z.string(),
  protocol:   z.enum(['MQTT','CoAP','HTTP','SATELLITE']),
});

// ── Deduplication ─────────────────────────────────────────────

async function isDuplicate(key: string): Promise<boolean> {
  const result = await redis.set(`dedup:${key}`, '1', 'EX', 60, 'NX');
  return result === null;  // null means key already existed
}

// ── Canonical trigger builder ─────────────────────────────────

function buildTrigger(source: string, rawInput: string, language: string, extras: Record<string, unknown> = {}) {
  return {
    triggerId:   uuidv4(),
    source,
    rawInput,
    language,
    timestamp:   new Date().toISOString(),
    ...extras,
  };
}

// ── Bootstrap ─────────────────────────────────────────────────

async function bootstrap() {
  logger.info('🚀 Ingestion Service starting...');

  // Initialize Kafka
  KafkaClient.initialize();
  await KafkaClient.provisionTopics();

  // Initialize redundancy manager
  await RedundancyManager.initialize();

  const app = express();
  const server = createServer(app);

  app.use(helmet());
  app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }));
  app.use(express.json({ limit: '10mb' }));

  // Rate limits
  const emergencyLimit = rateLimit({ windowMs: 60000, max: 60 });
  const iotLimit       = rateLimit({ windowMs: 1000,  max: 500 });

  // ── Health ────────────────────────────────────────────────

  app.get('/health', (_req, res) => {
    res.json({
      status: 'operational',
      service: 'ingestion',
      redundancy: RedundancyManager.getStatus(),
      timestamp: new Date().toISOString(),
    });
  });

  // ── Mobile / App report ───────────────────────────────────

  app.post('/ingest/mobile', emergencyLimit, async (req, res) => {
    const parsed = MobileReportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.issues[0]?.message });
    }

    const { rawInput, language, source, location, mediaUrls, callerPhone, deviceId } = parsed.data;
    const dedupeKey = `${source}:${deviceId ?? callerPhone ?? req.ip}`;

    if (await isDuplicate(dedupeKey)) {
      return res.status(200).json({ success: true, deduplicated: true });
    }

    const trigger = buildTrigger(source, rawInput, language, {
      deviceId, callerInfo: callerPhone ? { phone: callerPhone } : undefined,
      mediaUrls, sensorData: location ? {
        deviceId: deviceId ?? 'mobile',
        deviceType: 'PANIC_BUTTON',
        location,
        readings: [],
        timestamp: new Date().toISOString(),
        protocol: 'HTTP',
      } : undefined,
    });

    await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, trigger, {
      key: trigger.triggerId,
      sourceService: 'ingestion-service',
    });

    logger.info(`[Ingest] Mobile report: ${source} → ${trigger.triggerId}`);
    res.status(202).json({ success: true, triggerId: trigger.triggerId });
  });

  // ── IoT sensor ingest ─────────────────────────────────────

  app.post('/ingest/iot', iotLimit, async (req, res) => {
    // Device API key auth
    if (req.headers['x-device-api-key'] !== process.env.IOT_API_KEY) {
      return res.status(401).json({ success: false, error: 'Invalid device key' });
    }

    const parsed = IoTPayloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: 'Invalid payload' });
    }

    const payload = parsed.data;
    const hasAnomaly = payload.readings.some(r => r.isAnomalous);

    // Always publish raw reading
    await KafkaClient.publish(TOPICS.IOT_READING, payload, {
      key: payload.deviceId,
      sourceService: 'ingestion-service',
    });

    // Publish alert if anomalous
    if (hasAnomaly) {
      await KafkaClient.publish(TOPICS.IOT_ALERT, payload, {
        key: payload.deviceId,
        sourceService: 'ingestion-service',
      });

      const description = payload.readings
        .filter(r => r.isAnomalous)
        .map(r => `${r.metric}: ${r.value}${r.unit}`)
        .join(', ');

      const trigger = buildTrigger('IOT_SENSOR',
        `Sensor alert from ${payload.deviceType} device ${payload.deviceId}: ${description}`,
        'en',
        { deviceId: payload.deviceId, sensorData: payload },
      );

      await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, trigger, {
        key: trigger.triggerId,
        sourceService: 'ingestion-service',
      });
    }

    res.status(202).json({ success: true, anomalyDetected: hasAnomaly });
  });

  // ── Panic button ──────────────────────────────────────────

  app.post('/ingest/panic', emergencyLimit, async (req, res) => {
    if (req.headers['x-device-api-key'] !== process.env.IOT_API_KEY) {
      return res.status(401).json({ success: false, error: 'Invalid device key' });
    }

    const { deviceId, lat, lng } = req.body;
    const dedupeKey = `panic:${deviceId}`;

    if (await isDuplicate(dedupeKey)) {
      return res.status(200).json({ success: true, deduplicated: true });
    }

    const trigger = buildTrigger('PANIC_BUTTON',
      `PANIC BUTTON ACTIVATED – Device: ${deviceId}`,
      'en',
      {
        deviceId,
        sensorData: {
          deviceId, deviceType: 'PANIC_BUTTON',
          location: { lat: lat ?? 0, lng: lng ?? 0 },
          readings: [], timestamp: new Date().toISOString(), protocol: 'HTTP',
        },
      },
    );

    await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, trigger, {
      key: trigger.triggerId,
      sourceService: 'ingestion-service',
      metadata: { incidentId: trigger.triggerId },
    });

    res.status(202).json({ success: true, triggerId: trigger.triggerId });
  });

  // ── Voice call webhook (Twilio) ───────────────────────────

  app.post('/ingest/voice', emergencyLimit, TwilioVoiceHandler.handle);

  // ── SMS webhook ───────────────────────────────────────────

  app.post('/ingest/sms', emergencyLimit, SMSHandler.handle);

  // ── Satellite direct-to-device ────────────────────────────

  app.post('/ingest/satellite', SatelliteIngestHandler.handle);

  // ── CCTV / video analytics ────────────────────────────────

  app.post('/ingest/cctv', CCTVHandler.handle);

  // ── Offline queue flush (for reconnected devices) ─────────

  app.post('/ingest/offline-queue', async (req, res) => {
    const { items } = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ success: false });

    let processed = 0;
    for (const item of items.slice(0, 50)) {
      try {
        await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, item.payload, {
          key: item.id,
          sourceService: 'ingestion-service',
          metadata: { retryCount: item.retries },
        });
        processed++;
      } catch {
        // Continue processing remaining items
      }
    }

    res.json({ success: true, processed });
  });

  server.listen(PORT, () => {
    logger.info(`✅ Ingestion Service running on port ${PORT}`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await KafkaClient.disconnect();
    await redis.quit();
    server.close(() => process.exit(0));
  });
}

bootstrap().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
