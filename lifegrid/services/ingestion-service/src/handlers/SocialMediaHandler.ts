// ============================================================
// LIFEGRID – Social Media Ingest Handler
// Processes emergency signals from social media streams
// ============================================================

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { KafkaClient } from '../../../event-bus/src/KafkaClient';
import { TOPICS } from '../../../event-bus/src/topics';
import { logger } from '../utils/logger';

// Emergency keywords for social media filtering
const EMERGENCY_PATTERNS = [
  /\b(fire|flood|earthquake|shooting|explosion|accident|emergency|help|sos|trapped|injured)\b/i,
  /\b(ambulance|police|firefighter|rescue|evacuate|disaster)\b/i,
  /#(emergency|sos|help|disaster|flood|fire|earthquake)/i,
];

export class SocialMediaHandler {
  static async handle(req: Request, res: Response): Promise<void> {
    if (req.headers['x-social-api-key'] !== process.env.SOCIAL_API_KEY) {
      res.status(401).json({ success: false });
      return;
    }

    const { platform, postId, text, authorId, location, timestamp, confidence } = req.body;

    // Only process if confidence threshold met (pre-filtered by social media service)
    if (!confidence || confidence < 0.7) {
      res.status(200).json({ success: true, action: 'below_threshold' });
      return;
    }

    const matchesEmergency = EMERGENCY_PATTERNS.some(p => p.test(text));
    if (!matchesEmergency) {
      res.status(200).json({ success: true, action: 'no_emergency_keywords' });
      return;
    }

    const trigger = {
      triggerId:   uuidv4(),
      source:      'SOCIAL_MEDIA',
      rawInput:    text,
      language:    'en',
      timestamp:   timestamp ?? new Date().toISOString(),
      sensorData:  location ? {
        deviceId:   `social-${platform}-${postId}`,
        deviceType: 'CCTV',
        location,
        readings:   [],
        timestamp:  timestamp ?? new Date().toISOString(),
        protocol:   'HTTP',
      } : undefined,
      metadata: { platform, postId, authorId, confidence },
    };

    await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, trigger, {
      key: trigger.triggerId,
      sourceService: 'ingestion-service:social',
    });

    logger.info(`[Social] ${platform} post ${postId}: "${text.slice(0, 60)}"`);
    res.status(202).json({ success: true, triggerId: trigger.triggerId });
  }
}
