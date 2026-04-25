// ============================================================
// LIFEGRID – MongoDB Incident Schema
// Stores full incident documents with embedded sub-documents.
// Complements PostgreSQL (which stores normalized relational data).
//
// MongoDB stores:
//   - Full incident document (denormalized, fast reads)
//   - NLP analysis results (JSONB → document)
//   - AI decision history
//   - All dispatches embedded
//   - Guidance session messages
//   - Verification records
//   - Media attachments
//   - Full audit trail per incident
// ============================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

// ── Sub-document schemas ──────────────────────────────────────

const GeoPointSchema = new Schema({
  type:        { type: String, enum: ['Point'], default: 'Point' },
  coordinates: { type: [Number], required: true },  // [lng, lat]
}, { _id: false });

const NLPEntitySchema = new Schema({
  type:       { type: String, required: true },
  value:      { type: String, required: true },
  confidence: { type: Number, min: 0, max: 1 },
  position:   { start: Number, end: Number },
}, { _id: false });

const NLPAnalysisSchema = new Schema({
  originalText:              String,
  translatedText:            String,
  detectedLanguage:          { type: String, default: 'en' },
  confidence:                Number,
  entities:                  [NLPEntitySchema],
  intent:                    String,
  sentiment:                 { type: String, enum: ['PANIC', 'URGENT', 'CALM', 'CONFUSED'] },
  keywords:                  [String],
  classifiedType:            String,
  classificationConfidence:  Number,
  medicalSubtype:            String,
  urgencyScore:              Number,
  processingMs:              Number,
}, { _id: false });

const AIDecisionSchema = new Schema({
  recommendedResponders: [{
    responderId:    String,
    responderType:  String,
    priority:       Number,
    estimatedArrival: Number,
    distanceKm:     Number,
    compositeScore: Number,
    reason:         String,
  }],
  estimatedResponseTime: Number,
  riskScore:             { type: Number, min: 0, max: 100 },
  escalationRequired:    Boolean,
  predictedCasualties:   Number,
  resourceRequirements:  [{
    type:     String,
    quantity: Number,
    priority: String,
  }],
  decisionConfidence: Number,
  modelVersion:       String,
  timestamp:          Date,
}, { _id: false });

const DispatchSchema = new Schema({
  dispatchId:       { type: String, required: true },
  responderId:      String,
  responderType:    String,
  dispatchedAt:     Date,
  encryptedChannel: String,
  routeId:          String,
  estimatedArrival: Date,
  acknowledgedAt:   Date,
  arrivedAt:        Date,
  route: {
    distanceKm:       Number,
    estimatedMinutes: Number,
    trafficFactor:    Number,
  },
}, { _id: false });

const GuidanceMessageSchema = new Schema({
  messageId:         String,
  role:              { type: String, enum: ['SYSTEM', 'OPERATOR', 'CITIZEN', 'AI'] },
  content:           { type: String, required: true },
  translatedContent: String,
  language:          { type: String, default: 'en' },
  audioUrl:          String,
  isRead:            { type: Boolean, default: false },
  createdAt:         { type: Date, default: Date.now },
}, { _id: false });

const GuidanceSessionSchema = new Schema({
  sessionId:  String,
  citizenId:  String,
  operatorId: String,
  language:   { type: String, default: 'en' },
  channel:    { type: String, enum: ['VOICE', 'SMS', 'APP', 'CHAT'] },
  startedAt:  Date,
  endedAt:    Date,
  messages:   [GuidanceMessageSchema],
}, { _id: false });

const VerificationSchema = new Schema({
  verificationId: String,
  method:         String,
  verifiedBy:     String,
  signature:      String,
  notes:          String,
  createdAt:      { type: Date, default: Date.now },
}, { _id: false });

const AuditEntrySchema = new Schema({
  action:    { type: String, required: true },
  actorId:   String,
  actorRole: String,
  timestamp: { type: Date, default: Date.now },
  details:   Schema.Types.Mixed,
}, { _id: false });

// ── Main Incident schema ──────────────────────────────────────

export interface IIncident extends Document {
  incidentId:       string;
  referenceCode:    string;
  status:           string;
  severity:         string;
  type:             string;
  alertLevel:       string;

  // Location (GeoJSON for $near queries)
  location:         { type: string; coordinates: number[] };
  locationLat:      number;
  locationLng:      number;
  address?:         string;

  // Trigger
  trigger: {
    source:      string;
    rawInput:    string;
    language:    string;
    timestamp:   Date;
    deviceId?:   string;
    callerPhone?: string;
    mediaUrls:   string[];
  };

  // AI pipeline results
  nlpAnalysis?:   typeof NLPAnalysisSchema;
  aiDecision?:    typeof AIDecisionSchema;

  // Embedded sub-documents
  dispatches:       typeof DispatchSchema[];
  guidanceSessions: typeof GuidanceSessionSchema[];
  verifications:    typeof VerificationSchema[];
  auditTrail:       typeof AuditEntrySchema[];

  // Metadata
  reportedBy?:          string;
  assignedOperatorId?:  string;
  assignedCommanderId?: string;
  estimatedAffected?:   number;
  isPublic:             boolean;
  tags:                 string[];
  notes:                string[];
  mediaUrls:            string[];
  closureReport?:       string;
  closedAt?:            Date;
  createdAt:            Date;
  updatedAt:            Date;
}

const IncidentSchema = new Schema<IIncident>(
  {
    incidentId:    { type: String, required: true, unique: true, index: true },
    referenceCode: { type: String, required: true, unique: true, index: true },
    status:        { type: String, required: true, default: 'TRIGGERED', index: true },
    severity:      { type: String, required: true, default: 'MEDIUM',    index: true },
    type:          { type: String, required: true, default: 'UNKNOWN',   index: true },
    alertLevel:    { type: String, required: true, default: 'YELLOW' },

    // GeoJSON location for geospatial queries
    location: {
      type:        { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
    },
    locationLat: Number,
    locationLng: Number,
    address:     String,

    trigger: {
      source:      { type: String, required: true },
      rawInput:    { type: String, required: true },
      language:    { type: String, default: 'en' },
      timestamp:   { type: Date,   required: true },
      deviceId:    String,
      callerPhone: String,
      mediaUrls:   [String],
    },

    nlpAnalysis:   NLPAnalysisSchema,
    aiDecision:    AIDecisionSchema,

    dispatches:       [DispatchSchema],
    guidanceSessions: [GuidanceSessionSchema],
    verifications:    [VerificationSchema],
    auditTrail:       [AuditEntrySchema],

    reportedBy:          String,
    assignedOperatorId:  String,
    assignedCommanderId: String,
    estimatedAffected:   Number,
    isPublic:            { type: Boolean, default: false },
    tags:                [String],
    notes:               [String],
    mediaUrls:           [String],
    closureReport:       String,
    closedAt:            Date,
  },
  {
    timestamps: true,
    collection: 'incidents',
  },
);

// ── Indexes ───────────────────────────────────────────────────

// Geospatial index for location-based queries
IncidentSchema.index({ location: '2dsphere' });

// Compound indexes for common query patterns
IncidentSchema.index({ status: 1, severity: 1, createdAt: -1 });
IncidentSchema.index({ type: 1, createdAt: -1 });
IncidentSchema.index({ assignedOperatorId: 1, status: 1 });
IncidentSchema.index({ 'trigger.source': 1, createdAt: -1 });
IncidentSchema.index({ tags: 1 });

// Text index for full-text search on raw input
IncidentSchema.index({ 'trigger.rawInput': 'text', notes: 'text' });

// TTL index: auto-delete CLOSED incidents after 7 years
IncidentSchema.index(
  { closedAt: 1 },
  { expireAfterSeconds: 7 * 365 * 24 * 3600, partialFilterExpression: { status: 'CLOSED' } },
);

export const IncidentModel: Model<IIncident> = mongoose.model<IIncident>('Incident', IncidentSchema);
