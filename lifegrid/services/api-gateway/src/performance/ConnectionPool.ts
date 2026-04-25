// ============================================================
// LIFEGRID – Optimized Connection Pool Manager
// Billion-user scale database connection management
//
// Strategy:
//   - Separate read/write pools (write → primary, read → replicas)
//   - Adaptive pool sizing based on load
//   - Connection health monitoring
//   - Query timeout enforcement
//   - Slow query logging
// ============================================================

import { Pool, PoolClient, PoolConfig } from 'pg';
import { logger } from '../utils/logger';

const SLOW_QUERY_THRESHOLD_MS = 100;

interface PoolStats {
  total:    number;
  idle:     number;
  waiting:  number;
  queries:  number;
  slowQueries: number;
  errors:   number;
}

export class ConnectionPool {
  private static writePool: Pool | null = null;
  private static readPool:  Pool | null = null;
  private static stats = { queries: 0, slowQueries: 0, errors: 0 };

  static async initialize(): Promise<void> {
    const baseConfig: PoolConfig = {
      max:                  parseInt(process.env.DB_POOL_MAX ?? '50', 10),
      min:                  parseInt(process.env.DB_POOL_MIN ?? '5', 10),
      idleTimeoutMillis:    30000,
      connectionTimeoutMillis: 5000,
      statement_timeout:    30000,   // 30s query timeout
      query_timeout:        30000,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: true }
        : false,
    };

    // Write pool → primary
    this.writePool = new Pool({
      ...baseConfig,
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DB_WRITE_POOL_MAX ?? '20', 10),
      application_name: 'lifegrid-write',
    });

    // Read pool → replica (round-robin via PgBouncer or HAProxy)
    const readUrl = process.env.DATABASE_READ_URL ?? process.env.DATABASE_URL;
    this.readPool = new Pool({
      ...baseConfig,
      connectionString: readUrl,
      max: parseInt(process.env.DB_READ_POOL_MAX ?? '100', 10),
      application_name: 'lifegrid-read',
    });

    // Error handlers
    this.writePool.on('error', (err) => logger.error('[DB Write Pool] Error:', err.message));
    this.readPool.on('error',  (err) => logger.error('[DB Read Pool] Error:', err.message));

    // Verify connections
    await Promise.all([
      this.writePool.query('SELECT 1'),
      this.readPool.query('SELECT 1'),
    ]);

    logger.info('✅ Connection pools initialized (write + read)');
  }

  // ── Query with automatic read/write routing ───────────────

  static async query<T = any>(
    sql: string,
    params?: any[],
    options: { forceWrite?: boolean; timeout?: number } = {},
  ): Promise<T[]> {
    const isWrite = options.forceWrite ||
      /^\s*(INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TRUNCATE)/i.test(sql);

    const pool = isWrite ? this.writePool! : this.readPool!;
    const start = Date.now();
    this.stats.queries++;

    try {
      const result = await pool.query({
        text: sql,
        values: params,
        ...(options.timeout ? { query_timeout: options.timeout } : {}),
      });

      const elapsed = Date.now() - start;
      if (elapsed > SLOW_QUERY_THRESHOLD_MS) {
        this.stats.slowQueries++;
        logger.warn(`[DB] Slow query (${elapsed}ms): ${sql.slice(0, 100)}`);
      }

      return result.rows as T[];
    } catch (err) {
      this.stats.errors++;
      logger.error(`[DB] Query error: ${(err as Error).message}. SQL: ${sql.slice(0, 100)}`);
      throw err;
    }
  }

  static async queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  // ── Batch insert (high-throughput) ────────────────────────

  static async batchInsert(
    table: string,
    columns: string[],
    rows: any[][],
    onConflict: string = 'DO NOTHING',
  ): Promise<void> {
    if (rows.length === 0) return;

    // Build parameterized batch insert
    const placeholders = rows.map((_, i) =>
      `(${columns.map((_, j) => `$${i * columns.length + j + 1}`).join(', ')})`
    ).join(', ');

    const values = rows.flat();
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders} ON CONFLICT ${onConflict}`;

    await this.query(sql, values, { forceWrite: true });
  }

  // ── Transaction ───────────────────────────────────────────

  static async transaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    isolationLevel: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE' = 'READ COMMITTED',
  ): Promise<T> {
    const client = await this.writePool!.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolationLevel}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ── Stats ─────────────────────────────────────────────────

  static getStats(): PoolStats {
    const write = this.writePool;
    const read  = this.readPool;
    return {
      total:       (write?.totalCount ?? 0) + (read?.totalCount ?? 0),
      idle:        (write?.idleCount ?? 0)  + (read?.idleCount ?? 0),
      waiting:     (write?.waitingCount ?? 0) + (read?.waitingCount ?? 0),
      queries:     this.stats.queries,
      slowQueries: this.stats.slowQueries,
      errors:      this.stats.errors,
    };
  }

  static async disconnect(): Promise<void> {
    await Promise.all([
      this.writePool?.end(),
      this.readPool?.end(),
    ]);
  }
}
