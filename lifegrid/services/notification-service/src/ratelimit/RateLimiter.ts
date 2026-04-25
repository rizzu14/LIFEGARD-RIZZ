import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');

// Max notifications per recipient per channel per window
const LIMITS: Record<string, { max: number; windowSec: number }> = {
  sms:       { max: 5,  windowSec: 300  },  // 5 per 5 min
  push:      { max: 20, windowSec: 300  },  // 20 per 5 min
  email:     { max: 3,  windowSec: 3600 },  // 3 per hour
  voice:     { max: 2,  windowSec: 600  },  // 2 per 10 min
  radio:     { max: 10, windowSec: 60   },  // 10 per min
  satellite: { max: 3,  windowSec: 600  },  // 3 per 10 min
};

export const RateLimiter = {
  async isLimited(recipientId: string, channel: string): Promise<boolean> {
    const limit = LIMITS[channel];
    if (!limit) return false;

    const key   = `ratelimit:${channel}:${recipientId}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, limit.windowSec);
    return count > limit.max;
  },

  async record(recipientId: string, channel: string): Promise<void> {
    // Already recorded in isLimited via INCR
  },
};
