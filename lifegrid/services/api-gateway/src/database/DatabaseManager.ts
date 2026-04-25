import { Pool, PoolClient } from 'pg';
import { logger } from '../utils/logger';

export class DatabaseManager {
  private static pool: Pool | null = null;
  private static connected = false;

  static async connect(): Promise<void> {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? 'postgresql://lifegrid:lifegrid@localhost:5432/lifegrid',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
    });

    this.pool.on('error', (err) => logger.error('PostgreSQL pool error:', err.message));

    try {
      const client = await this.pool.connect();
      await client.query('SELECT 1');
      client.release();
      this.connected = true;
      logger.info('✅ PostgreSQL connected');
    } catch (err) {
      logger.error('PostgreSQL connection failed:', err);
      throw err;
    }
  }

  static async query<T = any>(text: string, params?: any[]): Promise<T[]> {
    if (!this.pool) throw new Error('Database not connected');
    const result = await this.pool.query(text, params);
    return result.rows as T[];
  }

  static async queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  static async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (!this.pool) throw new Error('Database not connected');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
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

  static isConnected(): boolean {
    return this.connected;
  }

  static async disconnect(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.connected = false;
      logger.info('PostgreSQL disconnected');
    }
  }
}
