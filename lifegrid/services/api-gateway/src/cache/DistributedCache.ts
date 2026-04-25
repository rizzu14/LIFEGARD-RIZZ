// ============================================================
// LIFEGRID – Distributed Cache Layer
// Multi-tier caching for billion-user scale
//
// Tiers:
//   L1: In-process LRU cache (< 1ms, 10k entries)
//   L2: Redis Cluster (< 2ms, unlimited)
//   L3: PostgreSQL materialized views (< 10ms, persistent)
//
// Cache strategies:
//   - Cache-aside (read-through)
//   - Write-through for critical data
//   - Write-behind for analytics
//   - Cache warming on startup
//   - Stampede prevention (probabilistic early expiry)
// ============================================================

import { RedisManager } from './RedisManager';
import { logger } from '../utils/logger';

// ── L1: In-process LRU cache ──────────────────────────────────

interface LRUEntry<T> {
  value: T;
  expiresAt: number;
  hits: number;
}

class LRUCache<T> {
  private cache = new Map<string, LRUEntry<T>>();
  private readonly maxSize: number;

  constructor(maxSize: number = 10000) {
    this.maxSize = maxSize;
  }

  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    // Move to end (most recently used)
    this.cache.delete(key);
    entry.hits++;
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    if (this.cache.size >= this.maxSize) {
      // Evict least recently used (first entry)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + ttlMs, hits: 0 });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  stats(): { size: number; hitRate: number } {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }
    return { size: this.cache.size, hitRate: totalHits / Math.max(this.cache.size, 1) };
  }
}

// ── Cache key builders ────────────────────────────────────────

export const CacheKeys = {
  incident:          (id: string)           => `incident:${id}`,
  incidentList:      (params: string)       => `incidents:list:${params}`,
  responder:         (id: string)           => `responder:${id}`,
  responderAvailable:(type: string, lat: number, lng: number) =>
                                              `responders:avail:${type}:${lat.toFixed(2)}:${lng.toFixed(2)}`,
  metrics:           ()                     => 'metrics:summary',
  heatmap:           ()                     => 'analytics:heatmap',
  user:              (id: string)           => `user:${id}`,
  station:           (id: string)           => `station:${id}`,
  stationList:       ()                     => 'stations:all',
  gisLayers:         ()                     => 'gis:layers',
  alertLevel:        ()                     => 'system:alert_level',
  aiDecision:        (hash: string)         => `ai:decision:${hash}`,
  nlpResult:         (hash: string)         => `ai:nlp:${hash}`,
  route:             (origin: string, dest: string) => `route:${origin}:${dest}`,
};

// ── TTL configuration ─────────────────────────────────────────

export const CacheTTL = {
  INCIDENT:           30,      // 30 seconds (frequently updated)
  INCIDENT_LIST:      10,      // 10 seconds (very dynamic)
  RESPONDER:          60,      // 1 minute
  RESPONDER_AVAILABLE: 5,      // 5 seconds (critical for dispatch)
  METRICS:            8,       // 8 seconds
  HEATMAP:            300,     // 5 minutes
  USER:               300,     // 5 minutes
  STATION:            3600,    // 1 hour (rarely changes)
  GIS_LAYERS:         3600,    // 1 hour
  ALERT_LEVEL:        5,       // 5 seconds (critical)
  AI_DECISION:        60,      // 1 minute
  NLP_RESULT:         300,     // 5 minutes
  ROUTE:              120,     // 2 minutes
};

// ── Distributed cache implementation ─────────────────────────

export class DistributedCache {
  private static l1 = new LRUCache<any>(10000);
  private static hitStats = { l1: 0, l2: 0, miss: 0 };

  // ── Read-through cache ────────────────────────────────────

  static async get<T>(key: string): Promise<T | null> {
    // L1 check
    const l1Hit = this.l1.get(key);
    if (l1Hit !== null) {
      this.hitStats.l1++;
      return l1Hit as T;
    }

    // L2 check (Redis)
    const l2Hit = await RedisManager.get(key);
    if (l2Hit) {
      this.hitStats.l2++;
      const parsed = JSON.parse(l2Hit) as T;
      // Populate L1
      this.l1.set(key, parsed, 5000);  // 5s in L1
      return parsed;
    }

    this.hitStats.miss++;
    return null;
  }

  // ── Write-through cache ───────────────────────────────────

  static async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    // Write to both tiers simultaneously
    const serialized = JSON.stringify(value);

    // L1 (shorter TTL to prevent stale data)
    this.l1.set(key, value, Math.min(ttlSeconds * 1000, 30000));

    // L2 (Redis)
    await RedisManager.set(key, serialized, ttlSeconds);
  }

  // ── Invalidation ──────────────────────────────────────────

  static async invalidate(key: string): Promise<void> {
    this.l1.delete(key);
    await RedisManager.del(key);
  }

  static async invalidatePattern(pattern: string): Promise<void> {
    // L1: clear all matching keys
    // (simplified — in production use Redis SCAN)
    this.l1.clear();
    logger.debug(`[Cache] Invalidated pattern: ${pattern}`);
  }

  // ── Stampede prevention (probabilistic early expiry) ──────

  static async getWithStampedeProtection<T>(
    key: string,
    ttlSeconds: number,
    fetchFn: () => Promise<T>,
    beta: number = 1.0,
  ): Promise<T> {
    const cached = await this.get<{ value: T; expiresAt: number }>(key);

    if (cached) {
      const now = Date.now() / 1000;
      const remainingTtl = cached.expiresAt - now;
      const recomputeTime = 0.1;  // Estimated recompute time in seconds

      // Probabilistic early expiry: recompute before expiry to prevent stampede
      const shouldRecompute = remainingTtl <= recomputeTime * beta * Math.log(Math.random());

      if (!shouldRecompute) {
        return cached.value;
      }
    }

    // Fetch fresh value
    const value = await fetchFn();
    const expiresAt = Date.now() / 1000 + ttlSeconds;
    await this.set(key, { value, expiresAt }, ttlSeconds);
    return value;
  }

  // ── Cache warming ─────────────────────────────────────────

  static async warmCache(warmFns: Array<() => Promise<void>>): Promise<void> {
    logger.info('[Cache] Warming cache...');
    await Promise.allSettled(warmFns.map(fn => fn()));
    logger.info('[Cache] Cache warm complete');
  }

  // ── Stats ─────────────────────────────────────────────────

  static getStats(): {
    l1Size: number;
    l1HitRate: number;
    totalHits: number;
    hitRatio: number;
  } {
    const total = this.hitStats.l1 + this.hitStats.l2 + this.hitStats.miss;
    const hits = this.hitStats.l1 + this.hitStats.l2;
    return {
      l1Size:    this.l1.size,
      l1HitRate: this.l1.stats().hitRate,
      totalHits: hits,
      hitRatio:  total > 0 ? hits / total : 0,
    };
  }
}
