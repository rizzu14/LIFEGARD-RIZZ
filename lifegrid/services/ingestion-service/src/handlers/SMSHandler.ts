// ============================================================
// LIFEGRID – SMS Ingest Handler
// Twilio SMS webhook → Kafka trigger
// ============================================================

import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { KafkaClient } from '../../../event-bus/src/KafkaClient';
import { TOPICS } from '../../../event-bus/src/topics';
import { logger } from '../utils/logger';

// SMS keyword shortcuts
const SMS_KEYWORDS: Record<string, string> = {
  'SOS':      'Emergency SOS via SMS',
  'HELP':     'Help requested via SMS',
  'FIRE':     'Fire emergency reported via SMS',
  'FLOOD':    'Flood emergency reported via SMS',
  'MEDICAL':  'Medical emergency reported via SMS',
  'POLICE':   'Security emergency reported via SMS',
};

export class SMSHandler {
  static async handle(req: Request, res: Response): Promise<void> {
    const { From, Body, MessageSid, FromCity, FromState, FromCountry } = req.body;

    if (!Body || !From) {
      res.status(400).send('');
      return;
    }

    const upperBody = Body.trim().toUpperCase();
    const keywordMatch = Object.keys(SMS_KEYWORDS).find(k => upperBody.startsWith(k));
    const rawInput = keywordMatch ? `${SMS_KEYWORDS[keywordMatch]}. Message: ${Body}` : Body;

    const trigger = {
      triggerId:   uuidv4(),
      source:      'SMS',
      rawInput,
      language:    'en',
      timestamp:   new Date().toISOString(),
      callerInfo:  { phone: From },
      metadata: {
        messageSid: MessageSid,
        fromCity:   FromCity,
        fromState:  FromState,
        fromCountry: FromCountry,
        isKeyword:  !!keywordMatch,
        keyword:    keywordMatch,
      },
    };

    await KafkaClient.publish(TOPICS.INCIDENT_TRIGGERED, trigger, {
      key: trigger.triggerId,
      sourceService: 'ingestion-service:sms',
    });

    logger.info(`[SMS] From ${From}: "${Body.slice(0, 60)}"`);

    // TwiML response
    res.type('text/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>LIFEGRID: Your emergency report has been received. Reference: ${trigger.triggerId.slice(0, 8).toUpperCase()}. Help is being dispatched.</Message>
</Response>`);
  }
}
