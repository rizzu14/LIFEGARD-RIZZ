import Redis from 'ioredis';
import { logger } from '../utils/logger';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

export const DeliveryTracker = {
  async recordSuccess(recipientId: string, channel: string, payload: any): Promise<void> {
    const key = `delivery:${recipientId}:${channel}:${Date.now()}`;
    await redis.setex(key, 86400, JSON.stringify({
      status: 'delivered',
      channel,
      recipientId,
      incidentId: payload.data?.incidentId,
      timestamp: new Date().toISOString(),
    }));
  },

  async recordFailure(recipientId: string, channel: string, payload: any, error: string): Promise<void> {
    const key = `delivery:fail:${recipientId}:${channel}:${Date.now()}`;
    await redis.setex(key, 86400 * 7, JSON.stringify({
      status: 'failed',
      channel,
      recipientId,
      error,
      incidentId: payload.data?.incidentId,
      timestamp: new Date().toISOString(),
    }));
    logger.warn(`[Delivery] Failed: ${recipientId} via ${channel}: ${error}`);
  },
};
