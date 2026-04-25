import { createClient, RedisClientType } from 'redis';
import { logger } from '../utils/logger';

export class RedisManager {
  private static client: RedisClientType | null = null;
  private static connected = false;

  static async connect(): Promise<void> {
    const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

    this.client = createClient({
      url,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) return new Error('Redis max retries exceeded');
          return Math.min(retries * 100, 3000);
        },
      },
    }) as RedisClientType;

    this.client.on('error', (err) => logger.error('Redis error:', err.message));
    this.client.on('connect', () => { this.connected = true; logger.info('✅ Redis connected'); });
    this.client.on('disconnect', () => { this.connected = false; logger.warn('Redis disconnected'); });

    try {
      await this.client.connect();
    } catch (err) {
      logger.warn('⚠️  Redis unavailable, caching disabled');
    }
  }

  static async get(key: string): Promise<string | null> {
    if (!this.client || !this.connected) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  static async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (!this.client || !this.connected) return;
    try {
      if (ttlSeconds) {
        await this.client.setEx(key, ttlSeconds, value);
      } else {
        await this.client.set(key, value);
      }
    } catch (err) {
      logger.warn(`Redis set failed for key ${key}:`, err);
    }
  }

  static async del(key: string): Promise<void> {
    if (!this.client || !this.connected) return;
    try {
      await this.client.del(key);
    } catch (err) {
      logger.warn(`Redis del failed for key ${key}:`, err);
    }
  }

  static async exists(key: string): Promise<boolean> {
    if (!this.client || !this.connected) return false;
    try {
      return (await this.client.exists(key)) > 0;
    } catch {
      return false;
    }
  }

  static isConnected(): boolean {
    return this.connected;
  }

  static async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.connected = false;
    }
  }
}
