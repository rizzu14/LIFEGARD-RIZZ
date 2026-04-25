// ============================================================
// LIFEGRID – Shared Types (local copy for citizen UI)
// ============================================================

export enum IncidentSeverity {
  CRITICAL = 'CRITICAL',
  HIGH     = 'HIGH',
  MEDIUM   = 'MEDIUM',
  LOW      = 'LOW',
}

export enum IncidentStatus {
  TRIGGERED  = 'TRIGGERED',
  CLASSIFIED = 'CLASSIFIED',
  DISPATCHED = 'DISPATCHED',
  EN_ROUTE   = 'EN_ROUTE',
  ON_SCENE   = 'ON_SCENE',
  RESOLVED   = 'RESOLVED',
  CLOSED     = 'CLOSED',
  ESCALATED  = 'ESCALATED',
}

export enum IncidentType {
  MEDICAL          = 'MEDICAL',
  FIRE             = 'FIRE',
  NATURAL_DISASTER = 'NATURAL_DISASTER',
  SECURITY         = 'SECURITY',
  INFRASTRUCTURE   = 'INFRASTRUCTURE',
  CHEMICAL         = 'CHEMICAL',
  BIOLOGICAL       = 'BIOLOGICAL',
  RADIOLOGICAL     = 'RADIOLOGICAL',
  NUCLEAR          = 'NUCLEAR',
  CYBER            = 'CYBER',
  MASS_CASUALTY    = 'MASS_CASUALTY',
  UNKNOWN          = 'UNKNOWN',
}

export enum TriggerSource {
  VOICE_CALL   = 'VOICE_CALL',
  SMS          = 'SMS',
  MOBILE_APP   = 'MOBILE_APP',
  PANIC_BUTTON = 'PANIC_BUTTON',
  IOT_SENSOR   = 'IOT_SENSOR',
  SATELLITE    = 'SATELLITE',
  SOCIAL_MEDIA = 'SOCIAL_MEDIA',
  OPERATOR     = 'OPERATOR',
  API          = 'API',
  CCTV         = 'CCTV',
}

export enum UserRole {
  CITIZEN      = 'CITIZEN',
  OPERATOR     = 'OPERATOR',
  SUPERVISOR   = 'SUPERVISOR',
  COMMANDER    = 'COMMANDER',
  SYSTEM_ADMIN = 'SYSTEM_ADMIN',
  RESPONDER    = 'RESPONDER',
  ANALYST      = 'ANALYST',
}

export enum AlertLevel {
  GREEN  = 'GREEN',
  YELLOW = 'YELLOW',
  ORANGE = 'ORANGE',
  RED    = 'RED',
  BLACK  = 'BLACK',
}

export interface GeoCoordinate {
  lat: number;
  lng: number;
  altitude?: number;
  accuracy?: number;
  timestamp?: string;
}

export interface User {
  id: string;
  email: string;
  phone?: string;
  name: string;
  role: UserRole;
  language: string;
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

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  timestamp: string;
  requestId: string;
}
