// ============================================================
// LIFEGRID – MongoDB Manager
// Handles connection lifecycle with retry and health checks
// ============================================================

import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export class MongoManager {
  private static connected = false;
  private static retryCount = 0;
  private static readonly MAX_RETRIES = 5;

  static async connect(): Promise<void> {
    const uri = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/lifegrid';

    mongoose.set('strictQuery', true);

    // Connection event handlers
    mongoose.connection.on('connected', () => {
      this.connected = true;
      this.retryCount = 0;
      logger.info('✅ MongoDB connected');
    });

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB error:', err.message);
    });

    mongoose.connection.on('disconnected', () => {
      this.connected = false;
      logger.warn('MongoDB disconnected — attempting reconnect...');
    });

    try {
      await mongoose.connect(uri, {
        maxPoolSize:          20,
        minPoolSize:          5,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS:      45000,
        connectTimeoutMS:     10000,
        retryWrites:          true,
        retryReads:           true,
        // Atlas / production settings
        ...(process.env.NODE_ENV === 'production' && {
          tls: true,
          tlsAllowInvalidCertificates: false,
        }),
      });
    } catch (err) {
      logger.warn('⚠️  MongoDB unavailable — running without document store');
      // Non-fatal: PostgreSQL handles critical data
    }
  }

  static isConnected(): boolean {
    return mongoose.connection.readyState === 1;
  }

  static async disconnect(): Promise<void> {
    await mongoose.disconnect();
    this.connected = false;
    logger.info('MongoDB disconnected');
  }

  static getConnection(): mongoose.Connection {
    return mongoose.connection;
  }
}
