// ============================================================
// LIFEGRID – CCTV / Video Analytics Handler
// Receives anomaly events from video analytics systems
// ============================================================

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { KafkaClient } from '../../../event-bus/src/KafkaClient';
import { TOPICS } from '../../../event-bus/src/topics';
import { logger } from '../utils/logger';

const CCTVEventSchema = z.object({
  cameraId:    z.string(),
  location:    z.object({ lat: z.number(), lng: z.number() }),
  eventType:   z.enum(['CROWD_ANOMALY', 'FIGHT', 'FIRE_SMOKE', 'ABANDONED_OBJECT', 'INTRUSION', 'FALL']),
  confidence:  z.number().min(0).max(1),
  timestamp:   z.string(),
  frameUrl:    z.string().url().optional(),
  metadata:    z.record(z.unknown()).optional(),
});

const EVENT_DESCRIPTIONS: Record<string, string> = {
  CROWD_ANOMALY:    'Crowd anomaly detected by CCTV',
  FIGHT:            'Physical altercation detected by CCTV',
  FIRE_SMOKE:       'Fire or smoke detected by CCTV',
  ABANDONED_OBJECT: 'Abandoned object detected by CCTV',
  INTRUSION:        'Unauthorized intrusion detected by CCTV',
  FALL:             'Person fall detected by CCTV',
};

export class CCTVHandler {
  static async handle(req: Request, res: Response): Promise<void> {
    if (req.headers['x-cctv-api-key'] !== process.env.CCTV_API_KEY) {
      res.status(401).json({ success: false });
      return;
    }

    const parsed = CCTVEventSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ success: false });
      return;
    }

    const event = parsed.data;

    // Only trigger incidents for high-confidence events
    if (event.confidence < 0.75) {
      res.status(200).json({ success: true, action: 'logged_only' });
      return;
    }

    const trigger = {
      triggerId:   uuidv4(),
      source:      'CCTV',
      rawInput:    `${EVENT_DESCRIPTIONS[event.eventType]} at camera ${event.cameraId}. Confidence: ${(event.confidence * 100).toFixed(0)}%`,
      language:    'en',
      timestamp:   event.timestamp,
      deviceId:    event.cameraId,
      mediaUrls:   event.frameUrl ? [event.frameUrl] : [],
      sensorData: {
        deviceId:   event.cameraId,
        deviceType: 'CCTV',
        location:   event.location,
        readings: [{
          metric:      'confidence',
          value:       event.confidence,
          unit:        'score',
          isAnomalous: true,
        }],
        timestamp:  event.timestamp,
        protocol:   'HTTP',
      },
      metadata: { eventType: event.eventType, ...event.metadata },
    };

    await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, trigger, {
      key: trigger.triggerId,
      sourceService: 'ingestion-service:cctv',
    });

    logger.info(`[CCTV] ${event.eventType} at ${event.cameraId} (conf: ${event.confidence.toFixed(2)})`);
    res.status(202).json({ success: true, triggerId: trigger.triggerId });
  }
}
