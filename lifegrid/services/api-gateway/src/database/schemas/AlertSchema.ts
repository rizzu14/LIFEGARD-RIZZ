// ============================================================
// LIFEGRID – MongoDB Alert & Notification Schema
// Stores system alerts, safety alerts, and notification logs
// ============================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Safety Alert ──────────────────────────────────────────────

export interface ISafetyAlert extends Document {
  alertId:     string;
  type:        string;
  severity:    string;
  source:      string;
  title:       string;
  description: string;
  location?:   { type: string; coordinates: number[] };
  affectedArea?: { type: string; coordinates: number[][][] };
  actions:     string[];
  isActive:    boolean;
  expiresAt?:  Date;
  metadata:    Record<string, unknown>;
  createdAt:   Date;
  updatedAt:   Date;
}

const SafetyAlertSchema = new Schema<ISafetyAlert>(
  {
    alertId:     { type: String, required: true, unique: true, index: true },
    type:        { type: String, required: true, index: true },
    severity:    { type: String, required: true, index: true },
    source:      { type: String, required: true, enum: ['FLOOD', 'WEATHER', 'SECURITY', 'SENSOR', 'SYSTEM', 'SATELLITE'] },
    title:       { type: String, required: true },
    description: { type: String, required: true },
    location: {
      type:        { type: String, enum: ['Point'] },
      coordinates: [Number],
    },
    affectedArea: {
      type:        { type: String, enum: ['Polygon'] },
      coordinates: [[[Number]]],
    },
    actions:     [String],
    isActive:    { type: Boolean, default: true, index: true },
    expiresAt:   Date,
    metadata:    { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true, collection: 'safety_alerts' },
);

SafetyAlertSchema.index({ location: '2dsphere' });
SafetyAlertSchema.index({ isActive: 1, severity: 1, createdAt: -1 });
SafetyAlertSchema.index({ source: 1, isActive: 1 });
// TTL: auto-expire inactive alerts after 30 days
SafetyAlertSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SafetyAlertModel: Model<ISafetyAlert> = mongoose.model<ISafetyAlert>('SafetyAlert', SafetyAlertSchema);

// ── Notification Log ──────────────────────────────────────────

export interface INotificationLog extends Document {
  notificationId: string;
  recipientId:    string;
  channel:        string;
  type:           string;
  title:          string;
  body:           string;
  status:         string;
  incidentId?:    string;
  deliveredAt?:   Date;
  failureReason?: string;
  retryCount:     number;
  createdAt:      Date;
}

const NotificationLogSchema = new Schema<INotificationLog>(
  {
    notificationId: { type: String, required: true, unique: true },
    recipientId:    { type: String, required: true, index: true },
    channel:        { type: String, required: true, enum: ['SMS', 'PUSH', 'EMAIL', 'VOICE', 'RADIO', 'SATELLITE'] },
    type:           String,
    title:          String,
    body:           String,
    status:         { type: String, default: 'PENDING', enum: ['PENDING', 'DELIVERED', 'FAILED', 'RETRYING'] },
    incidentId:     { type: String, index: true },
    deliveredAt:    Date,
    failureReason:  String,
    retryCount:     { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'notification_logs' },
);

NotificationLogSchema.index({ recipientId: 1, createdAt: -1 });
NotificationLogSchema.index({ status: 1, createdAt: -1 });
// TTL: delete logs after 90 days
NotificationLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

export const NotificationLogModel: Model<INotificationLog> = mongoose.model<INotificationLog>('NotificationLog', NotificationLogSchema);
