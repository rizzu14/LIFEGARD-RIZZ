// ============================================================
// LIFEGRID – Request Batcher (DataLoader pattern)
// Batches individual DB/API calls into bulk operations
//
// Eliminates N+1 query problems at billion-user scale.
// Inspired by Facebook's DataLoader.
//
// Example: 1000 concurrent requests for incident details
//   Without batcher: 1000 individual SELECT queries
//   With batcher:    1 SELECT WHERE id IN (...)
// ============================================================

import { DatabaseManager } from '../database/DatabaseManager';
import { logger } from '../utils/logger';

type BatchFn<K, V> = (keys: K[]) => Promise<Map<K, V>>;

class DataLoader<K, V> {
  private queue: Array<{ key: K; resolve: (v: V | null) => void; reject: (e: Error) => void }> = [];
  private scheduled = false;
  private readonly batchFn: BatchFn<K, V>;
  private readonly maxBatchSize: number;
  private readonly batchDelayMs: number;

  constructor(batchFn: BatchFn<K, V>, maxBatchSize = 100, batchDelayMs = 5) {
    this.batchFn = batchFn;
    this.maxBatchSize = maxBatchSize;
    this.batchDelayMs = batchDelayMs;
  }

  load(key: K): Promise<V | null> {
    return new Promise((resolve, reject) => {
      this.queue.push({ key, resolve, reject });

      if (this.queue.length >= this.maxBatchSize) {
        this.flush();
      } else if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => this.flush(), this.batchDelayMs);
      }
    });
  }

  private async flush(): Promise<void> {
    this.scheduled = false;
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.maxBatchSize);
    const keys = batch.map(b => b.key);

    try {
      const results = await this.batchFn(keys);
      for (const { key, resolve } of batch) {
        resolve(results.get(key) ?? null);
      }
    } catch (err) {
      for (const { reject } of batch) {
        reject(err as Error);
      }
    }
  }
}

// ── Incident loader ───────────────────────────────────────────

const incidentLoader = new DataLoader<string, any>(async (ids) => {
  const rows = await DatabaseManager.query(
    `SELECT * FROM lifegrid.incidents WHERE id = ANY($1)`,
    [ids],
  );
  const map = new Map<string, any>();
  for (const row of rows) map.set(row.id, row);
  return map;
}, 50, 5);

// ── Responder loader ──────────────────────────────────────────

const responderLoader = new DataLoader<string, any>(async (ids) => {
  const rows = await DatabaseManager.query(
    `SELECT * FROM lifegrid.responders WHERE id = ANY($1)`,
    [ids],
  );
  const map = new Map<string, any>();
  for (const row of rows) map.set(row.id, row);
  return map;
}, 100, 5);

// ── User loader ───────────────────────────────────────────────

const userLoader = new DataLoader<string, any>(async (ids) => {
  const rows = await DatabaseManager.query(
    `SELECT id, email, name, role, language, permissions FROM lifegrid.users WHERE id = ANY($1)`,
    [ids],
  );
  const map = new Map<string, any>();
  for (const row of rows) map.set(row.id, row);
  return map;
}, 200, 2);

// ── Responder location batch updater ─────────────────────────

interface LocationUpdate {
  responderId: string;
  lat: number;
  lng: number;
  timestamp: string;
}

class LocationBatchUpdater {
  private pending = new Map<string, LocationUpdate>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly flushIntervalMs: number;

  constructor(flushIntervalMs = 1000) {
    this.flushIntervalMs = flushIntervalMs;
  }

  enqueue(update: LocationUpdate): void {
    // Latest update wins for same responder
    this.pending.set(update.responderId, update);

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.flushIntervalMs);
    }
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    if (this.pending.size === 0) return;

    const updates = Array.from(this.pending.values());
    this.pending.clear();

    try {
      // Batch upsert all location updates in one query
      const values = updates.flatMap(u => [u.responderId, u.lat, u.lng, u.timestamp]);
      const placeholders = updates.map((_, i) =>
        `($${i*4+1}, $${i*4+2}, $${i*4+3}, ST_SetSRID(ST_MakePoint($${i*4+3}, $${i*4+2}), 4326), $${i*4+4})`
      ).join(', ');

      await DatabaseManager.query(
        `INSERT INTO lifegrid.responders (id, current_lat, current_lng, current_location, last_location_update)
         VALUES ${placeholders}
         ON CONFLICT (id) DO UPDATE SET
           current_lat = EXCLUDED.current_lat,
           current_lng = EXCLUDED.current_lng,
           current_location = EXCLUDED.current_location,
           last_location_update = EXCLUDED.last_location_update`,
        values,
      );

      logger.debug(`[Batcher] Flushed ${updates.length} location updates`);
    } catch (err) {
      logger.error('[Batcher] Location flush failed:', err);
    }
  }
}

export const RequestBatcher = {
  loadIncident:  (id: string) => incidentLoader.load(id),
  loadResponder: (id: string) => responderLoader.load(id),
  loadUser:      (id: string) => userLoader.load(id),
  locationUpdater: new LocationBatchUpdater(500),  // Flush every 500ms
};
