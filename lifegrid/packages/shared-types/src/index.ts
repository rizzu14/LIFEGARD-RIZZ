// ============================================================
// LIFEGRID – Shared Type Definitions
// National Emergency Coordination Infrastructure
// ============================================================

// ─── Enumerations ────────────────────────────────────────────

export enum IncidentSeverity {
  CRITICAL = 'CRITICAL',   // Mass casualty, national threat
  HIGH     = 'HIGH',       // Life-threatening, immediate response
  MEDIUM   = 'MEDIUM',     // Urgent but stable
  LOW      = 'LOW',        // Non-urgent, informational
}

export enum IncidentStatus {
  TRIGGERED    = 'TRIGGERED',
  CLASSIFIED   = 'CLASSIFIED',
  DISPATCHED   = 'DISPATCHED',
  EN_ROUTE     = 'EN_ROUTE',
  ON_SCENE     = 'ON_SCENE',
  RESOLVED     = 'RESOLVED',
  CLOSED       = 'CLOSED',
  ESCALATED    = 'ESCALATED',
}

export enum IncidentType {
  MEDICAL        = 'MEDICAL',
  FIRE           = 'FIRE',
  NATURAL_DISASTER = 'NATURAL_DISASTER',
  SECURITY       = 'SECURITY',
  INFRASTRUCTURE = 'INFRASTRUCTURE',
  CHEMICAL       = 'CHEMICAL',
  BIOLOGICAL     = 'BIOLOGICAL',
  RADIOLOGICAL   = 'RADIOLOGICAL',
  NUCLEAR        = 'NUCLEAR',
  CYBER          = 'CYBER',
  MASS_CASUALTY  = 'MASS_CASUALTY',
  UNKNOWN        = 'UNKNOWN',
}

export enum TriggerSource {
  VOICE_CALL    = 'VOICE_CALL',
  SMS           = 'SMS',
  MOBILE_APP    = 'MOBILE_APP',
  PANIC_BUTTON  = 'PANIC_BUTTON',
  IOT_SENSOR    = 'IOT_SENSOR',
  SATELLITE     = 'SATELLITE',
  SOCIAL_MEDIA  = 'SOCIAL_MEDIA',
  OPERATOR      = 'OPERATOR',
  API           = 'API',
  CCTV          = 'CCTV',
}

export enum ResponderType {
  POLICE        = 'POLICE',
  FIRE          = 'FIRE',
  AMBULANCE     = 'AMBULANCE',
  HAZMAT        = 'HAZMAT',
  SEARCH_RESCUE = 'SEARCH_RESCUE',
  MILITARY      = 'MILITARY',
  CYBER_UNIT    = 'CYBER_UNIT',
  MEDICAL_TEAM  = 'MEDICAL_TEAM',
  DISASTER_MGMT = 'DISASTER_MGMT',
}

export enum ResponderStatus {
  AVAILABLE   = 'AVAILABLE',
  DISPATCHED  = 'DISPATCHED',
  EN_ROUTE    = 'EN_ROUTE',
  ON_SCENE    = 'ON_SCENE',
  RETURNING   = 'RETURNING',
  OFFLINE     = 'OFFLINE',
  MAINTENANCE = 'MAINTENANCE',
}

export enum UserRole {
  CITIZEN          = 'CITIZEN',
  OPERATOR         = 'OPERATOR',
  SUPERVISOR       = 'SUPERVISOR',
  COMMANDER        = 'COMMANDER',
  SYSTEM_ADMIN     = 'SYSTEM_ADMIN',
  RESPONDER        = 'RESPONDER',
  ANALYST          = 'ANALYST',
}

export enum AlertLevel {
  GREEN  = 'GREEN',   // Normal operations
  YELLOW = 'YELLOW',  // Elevated readiness
  ORANGE = 'ORANGE',  // High alert
  RED    = 'RED',     // Critical emergency
  BLACK  = 'BLACK',   // National catastrophe
}

// ─── Core Data Models ─────────────────────────────────────────

export interface GeoCoordinate {
  lat: number;
  lng: number;
  altitude?: number;
  accuracy?: number;  // meters
  timestamp?: string;
}

export interface GeoZone {
  id: string;
  name: string;
  type: 'CIRCLE' | 'POLYGON' | 'RECTANGLE';
  center?: GeoCoordinate;
  radius?: number;       // meters, for CIRCLE
  coordinates?: GeoCoordinate[];  // for POLYGON/RECTANGLE
  metadata?: Record<string, unknown>;
}

export interface Address {
  street?: string;
  city: string;
  state: string;
  country: string;
  postalCode?: string;
  landmark?: string;
  formatted?: string;
}

export interface ContactInfo {
  phone?: string;
  email?: string;
  alternatePhone?: string;
}

// ─── Incident Models ──────────────────────────────────────────

export interface IncidentTrigger {
  source: TriggerSource;
  rawInput: string;
  language: string;
  timestamp: string;
  deviceId?: string;
  sensorData?: IoTSensorPayload;
  callerInfo?: ContactInfo;
  mediaUrls?: string[];
}

export interface NLPAnalysis {
  originalText: string;
  translatedText?: string;
  detectedLanguage: string;
  confidence: number;
  entities: NLPEntity[];
  intent: string;
  sentiment: 'PANIC' | 'URGENT' | 'CALM' | 'CONFUSED';
  keywords: string[];
  classifiedType: IncidentType;
  classificationConfidence: number;
}

export interface NLPEntity {
  type: 'LOCATION' | 'PERSON' | 'INJURY' | 'HAZARD' | 'VEHICLE' | 'WEAPON' | 'TIME';
  value: string;
  confidence: number;
  position?: { start: number; end: number };
}

export interface AIDecision {
  recommendedResponders: ResponderRecommendation[];
  estimatedResponseTime: number;  // seconds
  riskScore: number;              // 0–100
  escalationRequired: boolean;
  predictedCasualties?: number;
  resourceRequirements: ResourceRequirement[];
  decisionConfidence: number;
  modelVersion: string;
  timestamp: string;
}

export interface ResponderRecommendation {
  responderId: string;
  responderType: ResponderType;
  priority: number;
  estimatedArrival: number;  // seconds
  distanceKm: number;
  reason: string;
}

export interface ResourceRequirement {
  type: string;
  quantity: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface DispatchRecord {
  dispatchId: string;
  incidentId: string;
  responderId: string;
  dispatchedAt: string;
  encryptedChannel: string;
  routeId: string;
  estimatedArrival: string;
  acknowledgedAt?: string;
  arrivedAt?: string;
}

export interface RouteOptimization {
  routeId: string;
  responderId: string;
  origin: GeoCoordinate;
  destination: GeoCoordinate;
  waypoints: GeoCoordinate[];
  distanceKm: number;
  estimatedMinutes: number;
  trafficFactor: number;
  alternateRoutes: AlternateRoute[];
  gisLayers: string[];
}

export interface AlternateRoute {
  routeId: string;
  distanceKm: number;
  estimatedMinutes: number;
  reason: string;
}

export interface IncidentUpdate {
  updateId: string;
  incidentId: string;
  operatorId: string;
  timestamp: string;
  previousStatus: IncidentStatus;
  newStatus: IncidentStatus;
  notes: string;
  attachments?: string[];
}

export interface VerificationRecord {
  verificationId: string;
  incidentId: string;
  method: 'OPERATOR_CONFIRM' | 'RESPONDER_CONFIRM' | 'CITIZEN_CONFIRM' | 'SENSOR_CONFIRM';
  verifiedBy: string;
  timestamp: string;
  signature: string;  // cryptographic signature
  notes?: string;
}

export interface Incident {
  id: string;
  referenceCode: string;  // e.g. INC-2026-04-001234
  status: IncidentStatus;
  severity: IncidentSeverity;
  type: IncidentType;
  alertLevel: AlertLevel;

  // Step 1: Trigger
  trigger: IncidentTrigger;

  // Step 2: Understanding
  nlpAnalysis?: NLPAnalysis;

  // Step 3: Decision
  aiDecision?: AIDecision;

  // Step 4: Dispatch
  dispatches: DispatchRecord[];

  // Step 5: Execution
  routes: RouteOptimization[];

  // Step 6: Support
  guidanceSessions: GuidanceSession[];

  // Step 7: Confirmation
  verifications: VerificationRecord[];
  closedAt?: string;
  closureReport?: string;

  // Location
  location: GeoCoordinate;
  address?: Address;
  affectedZone?: GeoZone;

  // Metadata
  reportedBy?: string;
  assignedOperatorId?: string;
  assignedCommanderId?: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  notes: string[];
  mediaUrls: string[];
  isPublic: boolean;
  estimatedAffected?: number;
}

// ─── Responder Models ─────────────────────────────────────────

export interface Responder {
  id: string;
  badgeNumber: string;
  name: string;
  type: ResponderType;
  status: ResponderStatus;
  currentLocation: GeoCoordinate;
  lastLocationUpdate: string;
  unitId: string;
  stationId: string;
  capabilities: string[];
  equipment: string[];
  certifications: string[];
  currentIncidentId?: string;
  contactInfo: ContactInfo;
  shiftEnd?: string;
  isAvailable: boolean;
}

export interface ResponderUnit {
  id: string;
  callSign: string;
  type: ResponderType;
  stationId: string;
  members: string[];  // responder IDs
  vehicleId?: string;
  status: ResponderStatus;
  currentLocation: GeoCoordinate;
  capacity: number;
}

export interface Station {
  id: string;
  name: string;
  type: ResponderType[];
  location: GeoCoordinate;
  address: Address;
  units: string[];  // unit IDs
  coverageZone: GeoZone;
  contactInfo: ContactInfo;
  isOperational: boolean;
}

// ─── IoT / Sensor Models ──────────────────────────────────────

export interface IoTSensorPayload {
  deviceId: string;
  deviceType: 'SMOKE' | 'FLOOD' | 'SEISMIC' | 'CHEMICAL' | 'RADIATION' | 'PANIC_BUTTON' | 'CCTV' | 'WEATHER';
  location: GeoCoordinate;
  readings: SensorReading[];
  timestamp: string;
  batteryLevel?: number;
  signalStrength?: number;
  protocol: 'MQTT' | 'CoAP' | 'HTTP' | 'SATELLITE';
}

export interface SensorReading {
  metric: string;
  value: number;
  unit: string;
  threshold?: number;
  isAnomalous: boolean;
}

// ─── Guidance / Support Models ────────────────────────────────

export interface GuidanceSession {
  sessionId: string;
  incidentId: string;
  citizenId?: string;
  language: string;
  startedAt: string;
  endedAt?: string;
  channel: 'VOICE' | 'SMS' | 'APP' | 'CHAT';
  messages: GuidanceMessage[];
  operatorId?: string;
}

export interface GuidanceMessage {
  messageId: string;
  role: 'SYSTEM' | 'OPERATOR' | 'CITIZEN';
  content: string;
  translatedContent?: string;
  language: string;
  timestamp: string;
  audioUrl?: string;
  isRead: boolean;
}

// ─── User / Auth Models ───────────────────────────────────────

export interface User {
  id: string;
  email: string;
  phone?: string;
  name: string;
  role: UserRole;
  language: string;
  location?: GeoCoordinate;
  isVerified: boolean;
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string;
  mfaEnabled: boolean;
  permissions: string[];
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
  userId: string;
  role: UserRole;
}

// ─── API Response Wrappers ────────────────────────────────────

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
  timestamp: string;
  requestId: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  stack?: string;  // only in development
}

export interface ResponseMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
}

// ─── WebSocket Event Types ────────────────────────────────────

export interface WSEvent<T = unknown> {
  event: WSEventType;
  payload: T;
  timestamp: string;
  sourceId?: string;
}

export type WSEventType =
  | 'INCIDENT_CREATED'
  | 'INCIDENT_UPDATED'
  | 'INCIDENT_CLOSED'
  | 'RESPONDER_LOCATION_UPDATE'
  | 'RESPONDER_STATUS_CHANGE'
  | 'DISPATCH_SENT'
  | 'DISPATCH_ACKNOWLEDGED'
  | 'GUIDANCE_MESSAGE'
  | 'SENSOR_ALERT'
  | 'SYSTEM_ALERT'
  | 'ALERT_LEVEL_CHANGE'
  | 'OPERATOR_BROADCAST'
  | 'VERIFICATION_COMPLETE';

// ─── Dashboard / Analytics Models ────────────────────────────

export interface SystemMetrics {
  activeIncidents: number;
  criticalIncidents: number;
  availableResponders: number;
  dispatchedResponders: number;
  avgResponseTimeSeconds: number;
  incidentsLast24h: number;
  resolvedLast24h: number;
  systemAlertLevel: AlertLevel;
  timestamp: string;
}

export interface IncidentHeatmapPoint {
  location: GeoCoordinate;
  weight: number;
  incidentType: IncidentType;
  count: number;
}

export interface PredictionModel {
  modelId: string;
  name: string;
  version: string;
  accuracy: number;
  lastTrained: string;
  predictions: Prediction[];
}

export interface Prediction {
  type: IncidentType;
  probability: number;
  location: GeoCoordinate;
  timeWindow: string;
  confidence: number;
  factors: string[];
}

// ─── Satellite / GIS Layers ───────────────────────────────────

export interface SatelliteLayer {
  layerId: string;
  name: string;
  type: 'TERRAIN' | 'WEATHER' | 'THERMAL' | 'FLOOD' | 'FIRE' | 'POPULATION';
  provider: string;
  lastUpdated: string;
  resolution: string;
  tileUrl: string;
  opacity: number;
  isActive: boolean;
}

export interface GISLayer {
  layerId: string;
  name: string;
  type: 'ROADS' | 'HOSPITALS' | 'STATIONS' | 'HAZARDS' | 'EVACUATION' | 'UTILITIES';
  features: GeoJSON.FeatureCollection;
  style: Record<string, unknown>;
  isVisible: boolean;
}
