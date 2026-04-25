// ============================================================
// LIFEGRID – Twilio Voice Call Handler
// Receives voice call webhooks, transcribes, publishes to Kafka
// ============================================================

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { KafkaClient } from '../../../event-bus/src/KafkaClient';
import { TOPICS } from '../../../event-bus/src/topics';
import { logger } from '../utils/logger';

export class TwilioVoiceHandler {
  static async handle(req: Request, res: Response): Promise<void> {
    const { CallSid, From, SpeechResult, Confidence, CallStatus } = req.body;

    if (CallStatus === 'completed' && SpeechResult) {
      const trigger = {
        triggerId:   uuidv4(),
        source:      'VOICE_CALL',
        rawInput:    SpeechResult,
        language:    'en',  // Twilio returns language in headers
        timestamp:   new Date().toISOString(),
        callerInfo:  { phone: From },
        metadata:    { callSid: CallSid, confidence: parseFloat(Confidence ?? '0') },
      };

      await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, trigger, {
        key: trigger.triggerId,
        sourceService: 'ingestion-service:voice',
      });

      logger.info(`[Voice] Call from ${From}: "${SpeechResult.slice(0, 80)}..."`);
    }

    // TwiML response — gather speech
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">You have reached LIFEGRID Emergency Services. Please describe your emergency after the tone.</Say>
  <Record maxLength="60" transcribe="true" transcribeCallback="/ingest/voice" playBeep="true" />
  <Say>Thank you. Help is being dispatched. Please stay on the line.</Say>
</Response>`);
  }
}
