// ============================================================
// LIFEGRID – API Gateway Entry Point
// ============================================================

import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';

import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';
import { requestLogger } from './middleware/requestLogger';
import { authenticate } from './middleware/authenticate';

import { incidentRouter } from './routes/incidents';
import { responderRouter } from './routes/responders';
import { authRouter } from './routes/auth';
import { iotRouter } from './routes/iot';
import { analyticsRouter } from './routes/analytics';
import { gisRouter } from './routes/gis';
import { guidanceRouter } from './routes/guidance';
import { privacyRouter } from './routes/privacy';
import { aiRouter } from './routes/ai';
import { applySecurityStack } from './middleware/securityMiddleware';

import { WebSocketManager } from './websocket/WebSocketManager';
import { MQTTBroker } from './iot/MQTTBroker';
import { AIEngine } from './ai/AIEngine';
import { IncidentPipeline } from './pipeline/IncidentPipeline';
import { DatabaseManager } from './database/DatabaseManager';
import { MongoManager } from './database/MongoManager';
import { RedisManager } from './cache/RedisManager';
import { setupCallSignaling, getCallStats } from './call/CallSignalingServer';

const PORT = parseInt(process.env.PORT ?? '4000', 10);
const WS_PORT = parseInt(process.env.WS_PORT ?? '4001', 10);

async function bootstrap(): Promise<void> {
  logger.info('🚀 LIFEGRID API Gateway starting...');

  // ── Database connections ──────────────────────────────────
  await DatabaseManager.connect();
  await MongoManager.connect();
  await RedisManager.connect();

  // ── Express app ───────────────────────────────────────────
  const app = express();
  const httpServer = createServer(app);

  // ── Security middleware ───────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'wss:', 'ws:'],
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  }));

  app.use(cors({
    origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174').split(','),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'X-Device-ID'],
  }));

  // ── Rate limiting ─────────────────────────────────────────
  const globalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many requests' } },
  });

  const emergencyLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 30,
    message: { success: false, error: { code: 'RATE_LIMIT', message: 'Emergency endpoint rate limit' } },
  });

  app.use(globalLimiter);
  app.use(compression());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  app.use(requestLogger);

  // ── Security middleware stack (applied before all routes) ──
  applySecurityStack(app as any);

  // ── Health check (unauthenticated) ────────────────────────
  app.get('/health', (_req, res) => {
    res.json({
      status: 'operational',
      version: process.env.npm_package_version ?? '1.0.0',
      timestamp: new Date().toISOString(),
      services: {
        database: DatabaseManager.isConnected(),
        mongodb:  MongoManager.isConnected(),
        cache: RedisManager.isConnected(),
        mqtt: MQTTBroker.isConnected(),
        ai: AIEngine.isReady(),
      },
      calls: getCallStats(),
    });
  });

  // ── Public routes ─────────────────────────────────────────
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/incidents/report', emergencyLimiter);  // extra limit on public reporting

  // ── Protected routes ──────────────────────────────────────
  app.use('/api/v1/incidents', authenticate, incidentRouter);
  app.use('/api/v1/responders', authenticate, responderRouter);
  app.use('/api/v1/iot', iotRouter);  // IoT uses device-level auth
  app.use('/api/v1/analytics', authenticate, analyticsRouter);
  app.use('/api/v1/gis', authenticate, gisRouter);
  app.use('/api/v1/guidance', authenticate, guidanceRouter);
  app.use('/api/v1/privacy', authenticate, privacyRouter);
  app.use('/api/v1/ai', authenticate, aiRouter);

  // ── Error handler (must be last) ──────────────────────────
  app.use(errorHandler);

  // ── WebSocket server ──────────────────────────────────────
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174').split(','),
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    pingTimeout: 30000,
    pingInterval: 10000,
  });

  WebSocketManager.initialize(io);

  // ── WebRTC Call Signaling ─────────────────────────────────
  setupCallSignaling(io);

  // ── MQTT IoT broker ───────────────────────────────────────
  await MQTTBroker.connect();

  // ── AI Engine ─────────────────────────────────────────────
  await AIEngine.initialize();

  // ── Incident pipeline ─────────────────────────────────────
  IncidentPipeline.initialize(WebSocketManager, AIEngine);

  // ── Start server ──────────────────────────────────────────
  httpServer.listen(PORT, () => {
    logger.info(`✅ LIFEGRID API Gateway running on port ${PORT}`);
    logger.info(`✅ WebSocket server active on port ${PORT}`);
    logger.info(`✅ Environment: ${process.env.NODE_ENV ?? 'development'}`);
  });

  // ── Graceful shutdown ─────────────────────────────────────
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`📴 Received ${signal}. Graceful shutdown initiated...`);
    httpServer.close(async () => {
      await DatabaseManager.disconnect();
      await MongoManager.disconnect();
      await RedisManager.disconnect();
      await MQTTBroker.disconnect();
      logger.info('✅ Graceful shutdown complete.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception:', err);
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection:', reason);
  });
}

bootstrap().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
