// ============================================================
// LIFEGRID – MongoDB IoT Sensor Schema
// Time-series sensor readings with automatic TTL cleanup
// ============================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── IoT Device ────────────────────────────────────────────────

export interface IIoTDevice extends Document {
  deviceId:        string;
  deviceType:      string;
  location:        { type: string; coordinates: number[] };
  protocol:        string;
  isActive:        boolean;
  lastSeen:        Date;
  batteryLevel?:   number;
  firmwareVersion?: string;
  metadata:        Record<string, unknown>;
  alertThresholds: Record<string, number>;
  createdAt:       Date;
  updatedAt:       Date;
}

const IoTDeviceSchema = new Schema<IIoTDevice>(
  {
    deviceId:    { type: String, required: true, unique: true, index: true },
    deviceType:  { type: String, required: true, index: true },
    location: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    protocol:        { type: String, enum: ['MQTT', 'CoAP', 'HTTP', 'SATELLITE'], default: 'MQTT' },
    isActive:        { type: Boolean, default: true, index: true },
    lastSeen:        Date,
    batteryLevel:    Number,
    firmwareVersion: String,
    metadata:        { type: Schema.Types.Mixed, default: {} },
    alertThresholds: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'iot_devices' },
);

IoTDeviceSchema.index({ location: '2dsphere' });
IoTDeviceSchema.index({ deviceType: 1, isActive: 1 });

export const IoTDeviceModel: Model<IIoTDevice> = mongoose.model<IIoTDevice>('IoTDevice', IoTDeviceSchema);

// ── IoT Reading (time-series) ─────────────────────────────────

export interface IIoTReading extends Document {
  deviceId:    string;
  deviceType:  string;
  location:    { type: string; coordinates: number[] };
  readings:    Array<{ metric: string; value: number; unit: string; threshold?: number; isAnomalous: boolean }>;
  timestamp:   Date;
  isAlert:     boolean;
  incidentId?: string;
}

const IoTReadingSchema = new Schema<IIoTReading>(
  {
    deviceId:   { type: String, required: true, index: true },
    deviceType: { type: String, required: true },
    location: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    readings: [{
      metric:      { type: String, required: true },
      value:       { type: Number, required: true },
      unit:        { type: String, required: true },
      threshold:   Number,
      isAnomalous: { type: Boolean, default: false },
    }],
    timestamp:  { type: Date, required: true, default: Date.now, index: true },
    isAlert:    { type: Boolean, default: false, index: true },
    incidentId: String,
  },
  { collection: 'iot_readings' },
);

// Geospatial + time-series indexes
IoTReadingSchema.index({ location: '2dsphere' });
IoTReadingSchema.index({ deviceId: 1, timestamp: -1 });
IoTReadingSchema.index({ isAlert: 1, timestamp: -1 });
IoTReadingSchema.index({ deviceType: 1, timestamp: -1 });

// TTL: auto-delete readings older than 365 days
IoTReadingSchema.index({ timestamp: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });

export const IoTReadingModel: Model<IIoTReading> = mongoose.model<IIoTReading>('IoTReading', IoTReadingSchema);
