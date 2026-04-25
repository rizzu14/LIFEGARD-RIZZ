import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { TriggerSource } from '@lifegrid/shared-types';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { IncidentPipeline } from '../pipeline/IncidentPipeline';
import { MQTTBroker } from '../iot/MQTTBroker';

export const iotRouter = Router();

// Device API key auth (separate from user JWT)
function authenticateDevice(req: Request, res: Response, next: Function): void {
  const apiKey = req.headers['x-device-api-key'];
  const validKey = process.env.IOT_API_KEY ?? 'lifegrid-iot-dev-key';
  if (apiKey !== validKey) {
    res.status(401).json({ success: false, error: { code: 'INVALID_DEVICE_KEY', message: 'Invalid device API key' } });
    return;
  }
  next();
}

const SensorPayloadSchema = z.object({
  deviceId: z.string().min(1),
  deviceType: z.enum(['SMOKE', 'FLOOD', 'SEISMIC', 'CHEMICAL', 'RADIATION', 'PANIC_BUTTON', 'CCTV', 'WEATHER']),
  location: z.object({ lat: z.number(), lng: z.number() }),
  readings: z.array(z.object({
    metric: z.string(),
    value: z.number(),
    unit: z.string(),
    threshold: z.number().optional(),
    isAnomalous: z.boolean(),
  })),
  timestamp: z.string(),
});

// POST /iot/ingest  (HTTP fallback for devices that can't use MQTT)
iotRouter.post(
  '/ingest',
  authenticateDevice,
  validate(SensorPayloadSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body;
    const hasAnomaly = payload.readings.some((r: any) => r.isAnomalous);

    if (hasAnomaly) {
      const description = payload.readings
        .filter((r: any) => r.isAnomalous)
        .map((r: any) => `${r.metric}: ${r.value}${r.unit}`)
        .join(', ');

      await IncidentPipeline.process({
        source: TriggerSource.IOT_SENSOR,
        rawInput: `Sensor alert from ${payload.deviceType} device ${payload.deviceId}: ${description}`,
        language: 'en',
        timestamp: payload.timestamp,
        deviceId: payload.deviceId,
        sensorData: payload,
      });
    }

    // Also publish to MQTT for other subscribers
    MQTTBroker.publish(
      `lifegrid/sensors/${payload.deviceType}/${payload.deviceId}/data`,
      payload,
    );

    res.json({
      success: true,
      data: { received: true, anomalyDetected: hasAnomaly },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// POST /iot/panic  (panic button HTTP endpoint)
iotRouter.post(
  '/panic',
  authenticateDevice,
  asyncHandler(async (req: Request, res: Response) => {
    const { deviceId, lat, lng } = req.body;

    await IncidentPipeline.process({
      source: TriggerSource.PANIC_BUTTON,
      rawInput: `PANIC BUTTON ACTIVATED - Device: ${deviceId}`,
      language: 'en',
      timestamp: new Date().toISOString(),
      deviceId,
      sensorData: {
        deviceId,
        deviceType: 'PANIC_BUTTON',
        location: { lat: lat ?? 0, lng: lng ?? 0 },
        readings: [],
        timestamp: new Date().toISOString(),
        protocol: 'HTTP',
      },
    });

    res.json({ success: true, data: { received: true }, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);
