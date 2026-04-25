// ============================================================
// LIFEGRID – MQTT IoT Broker Integration
// Handles MQTT/CoAP sensor ingestion
// ============================================================

import mqtt, { MqttClient } from 'mqtt';
import { IoTSensorPayload, TriggerSource } from '@lifegrid/shared-types';
import { logger } from '../utils/logger';
import { IncidentPipeline } from '../pipeline/IncidentPipeline';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { z } from 'zod';

const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME ?? '';
const MQTT_PASSWORD = process.env.MQTT_PASSWORD ?? '';

// ── Topic structure ───────────────────────────────────────────
// lifegrid/sensors/{deviceType}/{deviceId}/data
// lifegrid/alerts/{deviceType}/{deviceId}/alert
// lifegrid/panic/{deviceId}

const SUBSCRIBED_TOPICS = [
  'lifegrid/sensors/+/+/data',
  'lifegrid/alerts/+/+/alert',
  'lifegrid/panic/+',
  'lifegrid/satellite/+/data',
];

// ── Payload validation schema ─────────────────────────────────

const SensorPayloadSchema = z.object({
  deviceId: z.string().min(1),
  deviceType: z.enum(['SMOKE', 'FLOOD', 'SEISMIC', 'CHEMICAL', 'RADIATION', 'PANIC_BUTTON', 'CCTV', 'WEATHER']),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  readings: z.array(z.object({
    metric: z.string(),
    value: z.number(),
    unit: z.string(),
    threshold: z.number().optional(),
    isAnomalous: z.boolean(),
  })),
  timestamp: z.string(),
  protocol: z.enum(['MQTT', 'CoAP', 'HTTP', 'SATELLITE']),
});

// ── Anomaly thresholds ────────────────────────────────────────

const ANOMALY_THRESHOLDS: Record<string, Record<string, number>> = {
  SMOKE: { 'smoke_density': 50 },
  FLOOD: { 'water_level_cm': 100 },
  SEISMIC: { 'magnitude': 4.0 },
  CHEMICAL: { 'concentration_ppm': 10 },
  RADIATION: { 'dose_rate_msv': 1.0 },
};

export class MQTTBroker {
  private static client: MqttClient | null = null;
  private static connected = false;
  private static reconnectAttempts = 0;
  private static readonly MAX_RECONNECT = 10;

  static async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const options: mqtt.IClientOptions = {
        clientId: `lifegrid-gateway-${Date.now()}`,
        username: MQTT_USERNAME || undefined,
        password: MQTT_PASSWORD || undefined,
        keepalive: 60,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
        clean: true,
        will: {
          topic: 'lifegrid/system/gateway/status',
          payload: JSON.stringify({ status: 'offline', timestamp: new Date().toISOString() }),
          qos: 1,
          retain: true,
        },
      };

      this.client = mqtt.connect(MQTT_BROKER_URL, options);

      this.client.on('connect', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        logger.info(`✅ MQTT connected to ${MQTT_BROKER_URL}`);

        // Subscribe to all sensor topics
        this.client!.subscribe(SUBSCRIBED_TOPICS, { qos: 1 }, (err) => {
          if (err) {
            logger.error('MQTT subscription error:', err);
            reject(err);
          } else {
            logger.info(`✅ MQTT subscribed to ${SUBSCRIBED_TOPICS.length} topic patterns`);
            resolve();
          }
        });

        // Publish online status
        this.client!.publish(
          'lifegrid/system/gateway/status',
          JSON.stringify({ status: 'online', timestamp: new Date().toISOString() }),
          { qos: 1, retain: true },
        );
      });

      this.client.on('message', this.handleMessage.bind(this));

      this.client.on('error', (err) => {
        logger.error('MQTT error:', err.message);
        if (this.reconnectAttempts === 0) reject(err);
      });

      this.client.on('reconnect', () => {
        this.reconnectAttempts++;
        logger.warn(`MQTT reconnecting... attempt ${this.reconnectAttempts}`);
        if (this.reconnectAttempts >= this.MAX_RECONNECT) {
          logger.error('MQTT max reconnect attempts reached');
        }
      });

      this.client.on('offline', () => {
        this.connected = false;
        logger.warn('MQTT client offline');
      });

      // Resolve after timeout if broker unavailable (non-fatal)
      setTimeout(() => {
        if (!this.connected) {
          logger.warn('⚠️  MQTT broker unavailable, IoT ingestion disabled');
          resolve();
        }
      }, 8000);
    });
  }

  private static async handleMessage(topic: string, message: Buffer): Promise<void> {
    try {
      const raw = JSON.parse(message.toString());

      // ── Panic button ──────────────────────────────────────
      if (topic.startsWith('lifegrid/panic/')) {
        const deviceId = topic.split('/')[2];
        await this.handlePanicButton(deviceId, raw);
        return;
      }

      // ── Sensor data ───────────────────────────────────────
      const parsed = SensorPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        logger.warn(`[MQTT] Invalid payload on topic ${topic}:`, parsed.error.issues);
        return;
      }

      const payload = parsed.data as IoTSensorPayload;

      // Check for anomalies
      const hasAnomaly = payload.readings.some(r => r.isAnomalous);
      const isAlert = topic.includes('/alert');

      if (hasAnomaly || isAlert) {
        await this.triggerSensorIncident(payload);
      }

      // Broadcast sensor data to command center
      WebSocketManager.broadcastToCommandCenter('SENSOR_ALERT', {
        topic,
        payload,
        isAlert: hasAnomaly || isAlert,
      });

    } catch (err) {
      logger.error(`[MQTT] Message processing error on ${topic}:`, err);
    }
  }

  private static async handlePanicButton(deviceId: string, data: any): Promise<void> {
    logger.warn(`[MQTT] PANIC BUTTON activated: ${deviceId}`);

    await IncidentPipeline.process({
      source: TriggerSource.PANIC_BUTTON,
      rawInput: `PANIC BUTTON ACTIVATED - Device: ${deviceId}`,
      language: 'en',
      timestamp: new Date().toISOString(),
      deviceId,
      sensorData: {
        deviceId,
        deviceType: 'PANIC_BUTTON',
        location: data.location ?? { lat: 0, lng: 0 },
        readings: [],
        timestamp: new Date().toISOString(),
        protocol: 'MQTT',
      },
    });
  }

  private static async triggerSensorIncident(payload: IoTSensorPayload): Promise<void> {
    const anomalousReadings = payload.readings.filter(r => r.isAnomalous);
    const description = anomalousReadings
      .map(r => `${r.metric}: ${r.value}${r.unit} (threshold: ${r.threshold ?? 'N/A'})`)
      .join(', ');

    logger.warn(`[MQTT] Sensor anomaly detected: ${payload.deviceType} - ${description}`);

    await IncidentPipeline.process({
      source: TriggerSource.IOT_SENSOR,
      rawInput: `Sensor alert from ${payload.deviceType} device ${payload.deviceId}: ${description}`,
      language: 'en',
      timestamp: payload.timestamp,
      deviceId: payload.deviceId,
      sensorData: payload,
    });
  }

  static publish(topic: string, payload: unknown, qos: 0 | 1 | 2 = 1): void {
    if (!this.client || !this.connected) {
      logger.warn(`[MQTT] Cannot publish to ${topic}: not connected`);
      return;
    }
    this.client.publish(topic, JSON.stringify(payload), { qos });
  }

  static isConnected(): boolean {
    return this.connected;
  }

  static async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.client) {
        this.client.end(false, {}, () => {
          this.connected = false;
          logger.info('MQTT disconnected');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}
