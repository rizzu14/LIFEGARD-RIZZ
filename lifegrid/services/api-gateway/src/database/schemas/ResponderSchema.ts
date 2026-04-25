// ============================================================
// LIFEGRID – MongoDB Responder Schema
// Real-time responder state with location history
// ============================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IResponder extends Document {
  responderId:        string;
  badgeNumber:        string;
  name:               string;
  type:               string;
  status:             string;
  currentLocation:    { type: string; coordinates: number[] };
  locationHistory:    Array<{ coordinates: number[]; timestamp: Date; speed?: number; heading?: number }>;
  lastLocationUpdate: Date;
  unitId:             string;
  stationId:          string;
  capabilities:       string[];
  equipment:          string[];
  certifications:     string[];
  currentIncidentId?: string;
  contactPhone?:      string;
  contactEmail?:      string;
  shiftStart?:        Date;
  shiftEnd?:          Date;
  isAvailable:        boolean;
  performanceMetrics: {
    avgResponseTimeSeconds: number;
    totalDispatches:        number;
    successRate:            number;
    lastUpdated:            Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

const ResponderSchema = new Schema<IResponder>(
  {
    responderId:  { type: String, required: true, unique: true, index: true },
    badgeNumber:  { type: String, required: true, unique: true },
    name:         { type: String, required: true },
    type:         { type: String, required: true, index: true },
    status:       { type: String, required: true, default: 'AVAILABLE', index: true },

    currentLocation: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },

    // Rolling 24h location history (capped at 1440 entries = 1/min for 24h)
    locationHistory: [{
      coordinates: [Number],
      timestamp:   { type: Date, default: Date.now },
      speed:       Number,
      heading:     Number,
    }],

    lastLocationUpdate: Date,
    unitId:             String,
    stationId:          { type: String, index: true },
    capabilities:       [String],
    equipment:          [String],
    certifications:     [String],
    currentIncidentId:  { type: String, index: true },
    contactPhone:       String,
    contactEmail:       String,
    shiftStart:         Date,
    shiftEnd:           Date,
    isAvailable:        { type: Boolean, default: true, index: true },

    performanceMetrics: {
      avgResponseTimeSeconds: { type: Number, default: 0 },
      totalDispatches:        { type: Number, default: 0 },
      successRate:            { type: Number, default: 1.0 },
      lastUpdated:            { type: Date, default: Date.now },
    },
  },
  {
    timestamps: true,
    collection: 'responders',
  },
);

// Geospatial index for proximity queries
ResponderSchema.index({ currentLocation: '2dsphere' });
ResponderSchema.index({ isAvailable: 1, type: 1, status: 1 });
ResponderSchema.index({ stationId: 1, isAvailable: 1 });

export const ResponderModel: Model<IResponder> = mongoose.model<IResponder>('Responder', ResponderSchema);
