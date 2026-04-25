// ============================================================
// LIFEGRID – Satellite Direct-to-Device Ingest Handler
// Handles Iridium / Starlink / VSAT emergency messages
// ============================================================

import { Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { KafkaClient } from '../../../event-bus/src/KafkaClient';
import { TOPICS } from '../../../event-bus/src/topics';
import { logger } from '../utils/logger';
import crypto from 'crypto';

// Satellite message schema (Iridium SBD / Starlink format)
const SatelliteMessageSchema = z.object({
  // Satellite provider metadata
  provider:    z.enum(['IRIDIUM', 'STARLINK', 'VSAT', 'INMARSAT', 'THURAYA']),
  momsn:       z.number().optional(),   // Iridium Mobile Originated Message Sequence Number
  imei:        z.string().optional(),   // Device IMEI
  deviceId:    z.string(),
  sessionTime: z.string(),

  // Location (from satellite fix)
  latitude:    z.number().min(-90).max(90),
  longitude:   z.number().min(-180).max(180),
  cepRadius:   z.number().optional(),   // Circular Error Probable (meters)

  // Payload
  data:        z.string(),              // Base64-encoded payload
  messageType: z.enum(['SOS', 'STATUS', 'SENSOR', 'ACK', 'PING']),

  // Authentication
  signature:   z.string().optional(),  // HMAC-SHA256 of payload
});

const SATELLITE_HMAC_KEY = process.env.SATELLITE_HMAC_KEY ?? 'lifegrid-satellite-key';

export class SatelliteIngestHandler {
  static async handle(req: Request, res: Response): Promise<void> {
    // Verify satellite provider auth
    const authHeader = req.headers['x-satellite-auth'];
    if (!authHeader || authHeader !== process.env.SATELLITE_API_KEY) {
      res.status(401).json({ success: false, error: 'Unauthorized satellite source' });
      return;
    }

    const parsed = SatelliteMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false, error: 'Invalid satellite message format' });
      return;
    }

    const msg = parsed.data;

    // Verify HMAC signature if present
    if (msg.signature) {
      const expected = crypto
        .createHmac('sha256', SATELLITE_HMAC_KEY)
        .update(msg.data)
        .digest('hex');
      if (!crypto.timingSafeEqual(Buffer.from(msg.signature), Buffer.from(expected))) {
        res.status(401).json({ success: false, error: 'Invalid message signature' });
        return;
      }
    }

    // Decode payload
    let decodedPayload: Record<string, unknown> = {};
    try {
      const raw = Buffer.from(msg.data, 'base64').toString('utf8');
      decodedPayload = JSON.parse(raw);
    } catch {
      // Binary payload — treat as raw SOS
      decodedPayload = { raw: msg.data };
    }

    const location = { lat: msg.latitude, lng: msg.longitude, accuracy: msg.cepRadius };

    if (msg.messageType === 'SOS') {
      const trigger = {
        triggerId:   uuidv4(),
        source:      'SATELLITE',
        rawInput:    (decodedPayload.message as string) ?? `SOS via ${msg.provider} satellite. Device: ${msg.deviceId}`,
        language:    (decodedPayload.language as string) ?? 'en',
        timestamp:   msg.sessionTime,
        deviceId:    msg.deviceId,
        sensorData: {
          deviceId:   msg.deviceId,
          deviceType: 'PANIC_BUTTON',
          location,
          readings:   [],
          timestamp:  msg.sessionTime,
          protocol:   'SATELLITE',
        },
        satelliteMetadata: {
          provider: msg.provider,
          imei:     msg.imei,
          momsn:    msg.momsn,
          cepRadius: msg.cepRadius,
        },
      };

      await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, trigger, {
        key: trigger.triggerId,
        sourceService: 'ingestion-service:satellite',
      });

      logger.warn(`[Satellite] SOS received: ${msg.provider} · ${msg.deviceId} · ${msg.latitude},${msg.longitude}`);
    } else if (msg.messageType === 'SENSOR') {
      await KafkaClient.publish(TOPICS.IOT_READING, {
        deviceId:   msg.deviceId,
        deviceType: (decodedPayload.deviceType as string) ?? 'WEATHER',
        location,
        readings:   (decodedPayload.readings as any[]) ?? [],
        timestamp:  msg.sessionTime,
        protocol:   'SATELLITE',
      }, { key: msg.deviceId, sourceService: 'ingestion-service:satellite' });
    }

    // Always acknowledge to satellite provider
    res.status(200).json({
      success: true,
      messageType: msg.messageType,
      deviceId: msg.deviceId,
      ack: uuidv4(),
    });
  }
}
