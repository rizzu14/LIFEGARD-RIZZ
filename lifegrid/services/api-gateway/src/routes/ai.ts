// ============================================================
// LIFEGRID – AI Engine Proxy Routes
// Exposes AI subsystems to the operator dashboard and IoT pipeline
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@lifegrid/shared-types';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { AIEngineClient } from '../ai/AIEngineClient';

export const aiRouter = Router();

// ── Flood prediction ──────────────────────────────────────────

const FloodRequestSchema = z.object({
  location: z.object({ lat: z.number(), lng: z.number() }),
  radiusKm: z.number().min(0.1).max(200).optional(),
  rainfallMm24h: z.number().min(0).optional(),
  riverLevelM: z.number().min(0).optional(),
  soilMoisturePct: z.number().min(0).max(100).optional(),
  sensorReadings: z.array(z.any()).optional(),
});

aiRouter.post(
  '/flood/predict',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER,
               UserRole.SYSTEM_ADMIN, UserRole.ANALYST]),
  validate(FloodRequestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await AIEngineClient.predictFlood(req.body);
    res.json({ success: true, data: result, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// ── Weather alerts ────────────────────────────────────────────

const WeatherRequestSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  windSpeedKmh: z.number().min(0).optional(),
  rainfallMm1h: z.number().min(0).optional(),
  capeJkg: z.number().min(0).optional(),
  pressureHpa: z.number().min(800).max(1100).optional(),
  tempC: z.number().min(-80).max(60).optional(),
  sensorReadings: z.array(z.any()).optional(),
});

aiRouter.post(
  '/weather/predict',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER,
               UserRole.SYSTEM_ADMIN, UserRole.ANALYST]),
  validate(WeatherRequestSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await AIEngineClient.predictWeather(req.body);
    res.json({ success: true, data: result, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// ── NDVI analysis ─────────────────────────────────────────────

aiRouter.post(
  '/ndvi/analyze',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER,
               UserRole.SYSTEM_ADMIN, UserRole.ANALYST]),
  asyncHandler(async (req: Request, res: Response) => {
    const { location, bands, historicalBaseline } = req.body;
    if (!location || !bands?.red || !bands?.nir) {
      throw new AppError('location, bands.red, and bands.nir are required', 400, 'VALIDATION_ERROR');
    }
    const result = await AIEngineClient.analyzeNDVI({ location, bands, historicalBaseline });
    res.json({ success: true, data: result, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// ── Missing person search ─────────────────────────────────────

const FaceSearchSchema = z.object({
  imageBase64: z.string().min(100),
  searchRadiusKm: z.number().min(0.1).max(500).optional(),
  centerLocation: z.object({ lat: z.number(), lng: z.number() }).optional(),
  maxResults: z.number().int().min(1).max(20).optional(),
});

aiRouter.post(
  '/missing/search',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN]),
  validate(FaceSearchSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const result = await AIEngineClient.searchMissingPerson(req.body);
    res.json({ success: true, data: result, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// ── Women safety stream ───────────────────────────────────────
// Called by wearable device gateway — device-level auth

aiRouter.post(
  '/safety/stream',
  asyncHandler(async (req: Request, res: Response) => {
    const apiKey = req.headers['x-device-api-key'];
    const validKey = process.env.IOT_API_KEY ?? 'lifegrid-iot-dev-key';
    if (apiKey !== validKey && !req.user) {
      throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    const result = await AIEngineClient.classifySafety(req.body);

    // If alert triggered, create incident automatically
    if (result.alert.shouldAlert) {
      const { IncidentPipeline } = await import('../pipeline/IncidentPipeline');
      const { TriggerSource } = await import('@lifegrid/shared-types');

      await IncidentPipeline.process({
        source: TriggerSource.PANIC_BUTTON,
        rawInput: `Women safety alert: ${result.alert.reason} (${result.classification.predictedClass}, confidence: ${(result.classification.confidence * 100).toFixed(0)}%)`,
        language: 'en',
        timestamp: result.timestamp,
        deviceId: result.deviceId,
        sensorData: result.location ? {
          deviceId: result.deviceId,
          deviceType: 'PANIC_BUTTON',
          location: result.location,
          readings: [],
          timestamp: result.timestamp,
          protocol: 'HTTP',
        } : undefined,
      });
    }

    res.json({ success: true, data: result, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// ── AI engine health ──────────────────────────────────────────

aiRouter.get(
  '/health',
  requireRole([UserRole.OPERATOR, UserRole.SYSTEM_ADMIN]),
  asyncHandler(async (_req: Request, res: Response) => {
    const health = await AIEngineClient.checkHealth();
    res.json({ success: true, data: health, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);
