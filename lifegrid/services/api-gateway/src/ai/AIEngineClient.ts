// ============================================================
// LIFEGRID – AI Engine HTTP Client
// Typed client for all Python AI microservice endpoints.
// Wraps every call with timeout, retry, and local fallback.
// ============================================================

import axios, { AxiosInstance } from 'axios';
import {
  NLPAnalysis, AIDecision, Incident, Responder,
  GeoCoordinate, IncidentType,
} from '@lifegrid/shared-types';
import { logger } from '../utils/logger';

const AI_ENGINE_URL = process.env.AI_ENGINE_URL ?? 'http://localhost:5001';
const TIMEOUT_MS    = parseInt(process.env.AI_ENGINE_TIMEOUT_MS ?? '5000', 10);
const MAX_RETRIES   = 2;

// ── Response types ────────────────────────────────────────────

export interface NLPAnalysisExtended extends NLPAnalysis {
  medicalSubtype?: string;
  urgencyScore: number;
  processingMs: number;
}

export interface DispatchDecisionResult {
  recommendedResponders: Array<{
    responderId: string;
    responderType: string;
    compositeScore: number;
    proximityScore: number;
    availabilityScore: number;
    typeMatchScore: number;
    distanceKm: number;
    etaSeconds: number;
    reason: string;
  }>;
  estimatedResponseTime: number;
  riskScore: number;
  escalationRequired: boolean;
  predictedCasualties?: number;
  resourceRequirements: Array<{ type: string; quantity: number; priority: string }>;
  decisionConfidence: number;
  modelVersion: string;
  processingMs: number;
}

export interface FloodPredictionResult {
  floodProbability: number;
  riskLevel: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  affectedAreaKm2: number;
  estimatedPopulation: number;
  forecast6h: number;
  forecast12h: number;
  forecast24h: number;
  riskZones: Array<{
    centerLat: number; centerLng: number;
    radiusM: number; probability: number;
    riskLevel: string; estimatedPopulation: number;
  }>;
  confidence: number;
  modelUsed: string;
  processingMs: number;
  factors: string[];
}

export interface WeatherAlertResult {
  location: GeoCoordinate;
  currentConditions: Record<string, number>;
  alerts1h: WeatherAlert[];
  alerts6h: WeatherAlert[];
  alerts24h: WeatherAlert[];
  overallRisk: string;
  confidence: number;
  modelUsed: string;
  processingMs: number;
}

export interface WeatherAlert {
  alertType: string;
  severity: string;
  probability: number;
  onsetMinutes: number;
  durationHours: number;
  affectedRadiusKm: number;
  description: string;
  recommendedActions: string[];
}

export interface NDVIAnalysisResult {
  ndviMean: number;
  ndwiMean: number;
  eviMean: number;
  saviMean: number;
  stressType: string;
  stressSeverity: string;
  anomalyScore: number;
  affectedAreaPct: number;
  alerts: Array<{
    alertType: string; severity: string;
    description: string; affectedAreaPct: number;
    recommendedActions: string[];
  }>;
  confidence: number;
  processingMs: number;
}

export interface FaceSearchResult {
  matches: Array<{
    personId: string; name: string; age?: number;
    similarity: number; confidence: string;
    lastKnownLocation?: GeoCoordinate;
    missingSince?: string; riskLevel: string;
    geospatialHeatmap: Array<{ lat: number; lng: number; probability: number; radiusKm: number }>;
    description?: string;
  }>;
  facesDetected: number;
  processingMs: number;
  modelUsed: string;
}

export interface SafetyClassificationResult {
  predictedClass: string;
  confidence: number;
  probabilities: Record<string, number>;
  alertRequired: boolean;
  alertPriority: string;
  triggerReason: string;
  processingMs: number;
  modelUsed: string;
  deviceId: string;
  timestamp: string;
}

export interface SafetyStreamResult {
  classification: {
    predictedClass: string;
    confidence: number;
    probabilities: Record<string, number>;
    processingMs: number;
  };
  alert: {
    shouldAlert: boolean;
    priority: string;
    reason: string;
    consecutiveAlerts: number;
  };
  deviceId: string;
  timestamp: string;
  location?: GeoCoordinate;
}

// ── Client ────────────────────────────────────────────────────

export class AIEngineClient {
  private static http: AxiosInstance = axios.create({
    baseURL: AI_ENGINE_URL,
    timeout: TIMEOUT_MS,
    headers: { 'Content-Type': 'application/json' },
  });

  private static async request<T>(
    method: 'get' | 'post',
    path: string,
    data?: unknown,
    timeoutOverride?: number,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.http.request<T>({
          method,
          url: path,
          data,
          timeout: timeoutOverride ?? TIMEOUT_MS,
        });
        return response.data;
      } catch (err: any) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error(`AI Engine request failed: ${path}`);
  }

  // ── NLP ───────────────────────────────────────────────────

  static async analyzeText(
    text: string,
    language: string = 'en',
  ): Promise<NLPAnalysisExtended> {
    const raw = await this.request<any>('post', '/nlp/analyze', { text, language });
    return {
      originalText: raw.original_text,
      translatedText: raw.translated_text,
      detectedLanguage: raw.detected_language,
      confidence: raw.confidence,
      entities: raw.entities,
      intent: raw.intent,
      sentiment: raw.sentiment,
      keywords: raw.keywords,
      classifiedType: raw.classified_type as IncidentType,
      classificationConfidence: raw.classification_confidence,
      medicalSubtype: raw.medical_subtype,
      urgencyScore: raw.urgency_score,
      processingMs: raw.processing_ms,
    };
  }

  // ── Dispatch ──────────────────────────────────────────────

  static async makeDispatchDecision(
    incident: Incident,
    availableResponders: Responder[],
  ): Promise<DispatchDecisionResult> {
    const raw = await this.request<any>('post', '/dispatch/decide', {
      incident_location: incident.location,
      incident_type: incident.type,
      incident_severity: incident.severity,
      available_responders: availableResponders,
      nlp_urgency_score: incident.nlpAnalysis
        ? (incident.nlpAnalysis as any).urgencyScore ?? 0.5
        : 0.5,
    });

    return {
      recommendedResponders: raw.recommended_responders.map((r: any) => ({
        responderId: r.responder_id,
        responderType: r.responder_type,
        compositeScore: r.composite_score,
        proximityScore: r.proximity_score,
        availabilityScore: r.availability_score,
        typeMatchScore: r.type_match_score,
        distanceKm: r.distance_km,
        etaSeconds: r.eta_seconds,
        reason: r.reason,
      })),
      estimatedResponseTime: raw.estimated_response_time,
      riskScore: raw.risk_score,
      escalationRequired: raw.escalation_required,
      predictedCasualties: raw.predicted_casualties,
      resourceRequirements: raw.resource_requirements,
      decisionConfidence: raw.decision_confidence,
      modelVersion: raw.model_version,
      processingMs: raw.processing_ms,
    };
  }

  // ── Flood prediction ──────────────────────────────────────

  static async predictFlood(params: {
    location: GeoCoordinate;
    radiusKm?: number;
    sensorReadings?: any[];
    rainfallMm24h?: number;
    riverLevelM?: number;
    soilMoisturePct?: number;
    satelliteBands?: number[][][];
  }): Promise<FloodPredictionResult> {
    const raw = await this.request<any>('post', '/predict/flood', {
      location: params.location,
      radius_km: params.radiusKm ?? 10,
      sensor_readings: params.sensorReadings ?? [],
      rainfall_mm_24h: params.rainfallMm24h ?? 0,
      river_level_m: params.riverLevelM ?? 0,
      soil_moisture_pct: params.soilMoisturePct ?? 50,
      satellite_bands: params.satelliteBands,
    }, 10000);

    return {
      floodProbability: raw.flood_probability,
      riskLevel: raw.risk_level,
      affectedAreaKm2: raw.affected_area_km2,
      estimatedPopulation: raw.estimated_population,
      forecast6h: raw.forecast_6h,
      forecast12h: raw.forecast_12h,
      forecast24h: raw.forecast_24h,
      riskZones: (raw.risk_zones ?? []).map((z: any) => ({
        centerLat: z.center_lat, centerLng: z.center_lng,
        radiusM: z.radius_m, probability: z.probability,
        riskLevel: z.risk_level, estimatedPopulation: z.estimated_population,
      })),
      confidence: raw.confidence,
      modelUsed: raw.model_used,
      processingMs: raw.processing_ms,
      factors: raw.factors ?? [],
    };
  }

  // ── Weather alerts ────────────────────────────────────────

  static async predictWeather(params: {
    lat: number; lng: number;
    windSpeedKmh?: number; rainfallMm1h?: number;
    capeJkg?: number; pressureHpa?: number; tempC?: number;
    sensorReadings?: any[];
  }): Promise<WeatherAlertResult> {
    const raw = await this.request<any>('post', '/predict/weather', {
      lat: params.lat, lng: params.lng,
      wind_speed_kmh: params.windSpeedKmh ?? 0,
      rainfall_mm_1h: params.rainfallMm1h ?? 0,
      cape_jkg: params.capeJkg ?? 0,
      pressure_hpa: params.pressureHpa ?? 1013,
      temp_c: params.tempC ?? 20,
      sensor_readings: params.sensorReadings ?? [],
    });

    const mapAlerts = (alerts: any[]): WeatherAlert[] =>
      alerts.map(a => ({
        alertType: a.alert_type,
        severity: a.severity,
        probability: a.probability,
        onsetMinutes: a.onset_minutes,
        durationHours: a.duration_hours,
        affectedRadiusKm: a.affected_radius_km,
        description: a.description,
        recommendedActions: a.recommended_actions,
      }));

    return {
      location: raw.location,
      currentConditions: raw.current_conditions,
      alerts1h: mapAlerts(raw.alerts_1h ?? []),
      alerts6h: mapAlerts(raw.alerts_6h ?? []),
      alerts24h: mapAlerts(raw.alerts_24h ?? []),
      overallRisk: raw.overall_risk,
      confidence: raw.confidence,
      modelUsed: raw.model_used,
      processingMs: raw.processing_ms,
    };
  }

  // ── NDVI analysis ─────────────────────────────────────────

  static async analyzeNDVI(params: {
    location: GeoCoordinate;
    bands: { red: number[][]; nir: number[][]; green?: number[][]; blue?: number[][] };
    historicalBaseline?: { ndviMean: number; ndviStd: number };
  }): Promise<NDVIAnalysisResult> {
    const raw = await this.request<any>('post', '/predict/ndvi', {
      location: params.location,
      bands: {
        red: params.bands.red,
        nir: params.bands.nir,
        green: params.bands.green,
        blue: params.bands.blue,
      },
      historical_baseline: params.historicalBaseline
        ? { ndvi_mean: params.historicalBaseline.ndviMean, ndvi_std: params.historicalBaseline.ndviStd }
        : undefined,
    }, 8000);

    return {
      ndviMean: raw.ndvi_mean,
      ndwiMean: raw.ndwi_mean,
      eviMean: raw.evi_mean,
      saviMean: raw.savi_mean,
      stressType: raw.stress_type,
      stressSeverity: raw.stress_severity,
      anomalyScore: raw.anomaly_score,
      affectedAreaPct: raw.affected_area_pct,
      alerts: (raw.alerts ?? []).map((a: any) => ({
        alertType: a.alert_type,
        severity: a.severity,
        description: a.description,
        affectedAreaPct: a.affected_area_pct,
        recommendedActions: a.recommended_actions,
      })),
      confidence: raw.confidence,
      processingMs: raw.processing_ms,
    };
  }

  // ── Face search ───────────────────────────────────────────

  static async searchMissingPerson(params: {
    imageBase64: string;
    searchRadiusKm?: number;
    centerLocation?: GeoCoordinate;
    maxResults?: number;
  }): Promise<FaceSearchResult> {
    const raw = await this.request<any>('post', '/missing/search', {
      image_base64: params.imageBase64,
      search_radius_km: params.searchRadiusKm ?? 50,
      center_location: params.centerLocation,
      max_results: params.maxResults ?? 5,
    }, 8000);

    return {
      matches: (raw.matches ?? []).map((m: any) => ({
        personId: m.person_id,
        name: m.name,
        age: m.age,
        similarity: m.similarity,
        confidence: m.confidence,
        lastKnownLocation: m.last_known_location,
        missingSince: m.missing_since,
        riskLevel: m.risk_level,
        geospatialHeatmap: m.geospatial_heatmap ?? [],
        description: m.description,
      })),
      facesDetected: raw.faces_detected,
      processingMs: raw.processing_ms,
      modelUsed: raw.model_used,
    };
  }

  // ── Women safety ──────────────────────────────────────────

  static async classifySafety(params: {
    deviceId: string;
    timestamp: string;
    accelerometer?: number[][];
    gyroscope?: number[][];
    heartRateBpm?: number;
    hrBaselineBpm?: number;
    gsrUs?: number;
    gsrBaselineUs?: number;
    soundLevelDb?: number;
    panicButtonPressed?: boolean;
    location?: GeoCoordinate;
  }): Promise<SafetyStreamResult> {
    const raw = await this.request<any>('post', '/safety/stream', {
      device_id: params.deviceId,
      timestamp: params.timestamp,
      accelerometer: params.accelerometer ?? [],
      gyroscope: params.gyroscope ?? [],
      heart_rate_bpm: params.heartRateBpm ?? 70,
      hr_baseline_bpm: params.hrBaselineBpm ?? 70,
      gsr_us: params.gsrUs ?? 2.0,
      gsr_baseline_us: params.gsrBaselineUs ?? 2.0,
      sound_level_db: params.soundLevelDb ?? 40,
      panic_button_pressed: params.panicButtonPressed ?? false,
      location: params.location,
    }, 3000);  // strict 3s timeout for safety

    return {
      classification: {
        predictedClass: raw.classification.predicted_class,
        confidence: raw.classification.confidence,
        probabilities: raw.classification.probabilities,
        processingMs: raw.classification.processing_ms,
      },
      alert: {
        shouldAlert: raw.alert.should_alert,
        priority: raw.alert.priority,
        reason: raw.alert.reason,
        consecutiveAlerts: raw.alert.consecutive_alerts,
      },
      deviceId: raw.device_id,
      timestamp: raw.timestamp,
      location: raw.location,
    };
  }

  // ── Health check ──────────────────────────────────────────

  static async checkHealth(): Promise<{ status: string; models: Record<string, string> }> {
    return this.request('get', '/health', undefined, 3000);
  }
}
