// ============================================================
// LIFEGRID – Notification Service
// Port: 4004
//
// Consumes:
//   lifegrid.notification.sms
//   lifegrid.notification.push
//   lifegrid.notification.email
//   lifegrid.notification.voice
//   lifegrid.notification.radio
//   lifegrid.notification.satellite
//
// Channels:
//   SMS      → Twilio SMS API
//   Push     → Firebase Cloud Messaging (FCM)
//   Email    → AWS SES / SendGrid
//   Voice    → Twilio Voice API (TTS)
//   Radio    → P25/DMR gateway API
//   Satellite → Iridium SBD / Starlink API
//
// Features:
//   - Priority queuing (EMERGENCY > URGENT > NORMAL)
//   - Delivery tracking with retry
//   - Multi-channel fallback
//   - Rate limiting per recipient
//   - Template rendering (multilingual)
// ============================================================

import 'dotenv/config';
import express from 'express';
import { KafkaClient, KafkaEnvelope } from '../../event-bus/src/KafkaClient';
import { TOPICS } from '../../event-bus/src/topics';
import { SMSChannel } from './channels/SMSChannel';
import { PushChannel } from './channels/PushChannel';
import { EmailChannel } from './channels/EmailChannel';
import { VoiceChannel } from './channels/VoiceChannel';
import { RadioChannel } from './channels/RadioChannel';
import { SatelliteChannel } from './channels/SatelliteChannel';
import { DeliveryTracker } from './tracking/DeliveryTracker';
import { RateLimiter } from './ratelimit/RateLimiter';
import { logger } from './utils/logger';

const PORT = parseInt(process.env.PORT ?? '4004', 10);
const GROUP_ID = 'lifegrid-notification-service';

// ── Priority queue ────────────────────────────────────────────

interface QueuedNotification {
  envelope: KafkaEnvelope<any>;
  priority: number;  // 0=EMERGENCY, 1=URGENT, 2=NORMAL
  channel:  string;
  enqueuedAt: number;
}

class PriorityQueue {
  private items: QueuedNotification[] = [];

  enqueue(item: QueuedNotification): void {
    this.items.push(item);
    this.items.sort((a, b) => a.priority - b.priority || a.enqueuedAt - b.enqueuedAt);
  }

  dequeue(): QueuedNotification | undefined {
    return this.items.shift();
  }

  get size(): number { return this.items.length; }
}

const queue = new PriorityQueue();
let isProcessing = false;

function priorityFromString(p: string): number {
  return p === 'EMERGENCY' ? 0 : p === 'URGENT' ? 1 : 2;
}

// ── Channel dispatch ──────────────────────────────────────────

async function deliverNotification(channel: string, payload: any): Promise<boolean> {
  const recipientId = payload.recipientId ?? payload.responderId ?? 'unknown';

  // Rate limit check
  if (await RateLimiter.isLimited(recipientId, channel)) {
    logger.warn(`[Notify] Rate limited: ${recipientId} on ${channel}`);
    return false;
  }

  try {
    switch (channel) {
      case 'sms':       await SMSChannel.send(payload);       break;
      case 'push':      await PushChannel.send(payload);      break;
      case 'email':     await EmailChannel.send(payload);     break;
      case 'voice':     await VoiceChannel.send(payload);     break;
      case 'radio':     await RadioChannel.send(payload);     break;
      case 'satellite': await SatelliteChannel.send(payload); break;
      default:
        logger.warn(`[Notify] Unknown channel: ${channel}`);
        return false;
    }

    await DeliveryTracker.recordSuccess(recipientId, channel, payload);
    await RateLimiter.record(recipientId, channel);
    return true;
  } catch (err) {
    logger.error(`[Notify] Delivery failed on ${channel} for ${recipientId}:`, err);
    await DeliveryTracker.recordFailure(recipientId, channel, payload, String(err));
    return false;
  }
}

// ── Queue processor ───────────────────────────────────────────

async function processQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  while (queue.size > 0) {
    const item = queue.dequeue();
    if (!item) break;

    const { envelope, channel } = item;
    const success = await deliverNotification(channel, envelope.payload);

    // Fallback chain for failed EMERGENCY notifications
    if (!success && item.priority === 0) {
      const fallbacks: Record<string, string[]> = {
        push:      ['sms', 'voice', 'satellite'],
        sms:       ['push', 'voice'],
        radio:     ['push', 'sms', 'satellite'],
        satellite: ['push', 'sms'],
      };

      for (const fallback of (fallbacks[channel] ?? [])) {
        const fallbackSuccess = await deliverNotification(fallback, envelope.payload);
        if (fallbackSuccess) {
          logger.info(`[Notify] Fallback to ${fallback} succeeded for ${envelope.payload.recipientId}`);
          break;
        }
      }
    }
  }

  isProcessing = false;
}

// ── Kafka consumers ───────────────────────────────────────────

async function enqueueFromKafka(channel: string) {
  return async (envelope: KafkaEnvelope<any>) => {
    const priority = priorityFromString(envelope.payload.priority ?? 'NORMAL');
    queue.enqueue({ envelope, priority, channel, enqueuedAt: Date.now() });
    setImmediate(processQueue);
  };
}

// ── Bootstrap ─────────────────────────────────────────────────

async function bootstrap() {
  logger.info('🚀 Notification Service starting...');

  KafkaClient.initialize();

  const app = express();
  app.get('/health', (_req, res) => res.json({
    status: 'operational',
    service: 'notification',
    queueSize: queue.size,
  }));
  app.listen(PORT, () => logger.info(`✅ Notification Service health on port ${PORT}`));

  // Subscribe to all notification topics
  await Promise.all([
    KafkaClient.subscribe(GROUP_ID + '-sms',       [TOPICS.NOTIFICATION_SMS],       await enqueueFromKafka('sms')),
    KafkaClient.subscribe(GROUP_ID + '-push',      [TOPICS.NOTIFICATION_PUSH],      await enqueueFromKafka('push')),
    KafkaClient.subscribe(GROUP_ID + '-email',     [TOPICS.NOTIFICATION_EMAIL],     await enqueueFromKafka('email')),
    KafkaClient.subscribe(GROUP_ID + '-voice',     [TOPICS.NOTIFICATION_VOICE],     await enqueueFromKafka('voice')),
    KafkaClient.subscribe(GROUP_ID + '-radio',     [TOPICS.NOTIFICATION_RADIO],     await enqueueFromKafka('radio')),
    KafkaClient.subscribe(GROUP_ID + '-satellite', [TOPICS.NOTIFICATION_SATELLITE], await enqueueFromKafka('satellite')),
  ]);

  logger.info('✅ Notification Service consuming all notification topics');

  process.on('SIGTERM', async () => {
    await KafkaClient.disconnect();
    process.exit(0);
  });
}

bootstrap().catch(err => { console.error('Fatal:', err); process.exit(1); });
