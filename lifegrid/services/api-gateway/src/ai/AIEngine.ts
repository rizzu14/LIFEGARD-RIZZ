// ============================================================
// LIFEGRID – AI Decision Engine
// NLP + Classification + Dispatch Optimization + Prediction
// ============================================================

import {
  NLPAnalysis, NLPEntity, IncidentType, AIDecision,
  Incident, Responder, GeoCoordinate, ResponderRecommendation,
  ResourceRequirement,
} from '@lifegrid/shared-types';
import { logger } from '../utils/logger';
import axios from 'axios';

const NLP_SERVICE_URL = process.env.NLP_SERVICE_URL ?? 'http://localhost:5001';
const PREDICTION_SERVICE_URL = process.env.PREDICTION_SERVICE_URL ?? 'http://localhost:5002';
const GEOCODING_API_URL = process.env.GEOCODING_API_URL ?? 'https://nominatim.openstreetmap.org';

// ── Keyword classification fallback ──────────────────────────

const INCIDENT_KEYWORDS: Record<IncidentType, string[]> = {
  [IncidentType.MEDICAL]: ['heart', 'breathing', 'unconscious', 'bleeding', 'ambulance', 'hospital', 'pain', 'injury', 'overdose', 'seizure'],
  [IncidentType.FIRE]: ['fire', 'smoke', 'burning', 'flames', 'explosion', 'blaze'],
  [IncidentType.NATURAL_DISASTER]: ['earthquake', 'flood', 'tsunami', 'tornado', 'hurricane', 'landslide', 'storm'],
  [IncidentType.SECURITY]: ['shooting', 'robbery', 'attack', 'weapon', 'threat', 'bomb', 'hostage', 'violence'],
  [IncidentType.INFRASTRUCTURE]: ['power outage', 'gas leak', 'bridge collapse', 'road collapse', 'water main'],
  [IncidentType.CHEMICAL]: ['chemical', 'toxic', 'spill', 'hazmat', 'fumes', 'poison'],
  [IncidentType.BIOLOGICAL]: ['biological', 'outbreak', 'epidemic', 'contamination', 'virus'],
  [IncidentType.RADIOLOGICAL]: ['radiation', 'nuclear', 'radioactive'],
  [IncidentType.NUCLEAR]: ['nuclear', 'reactor', 'meltdown'],
  [IncidentType.CYBER]: ['cyber', 'hack', 'system down', 'ransomware', 'breach'],
  [IncidentType.MASS_CASUALTY]: ['mass casualty', 'multiple victims', 'mass shooting', 'disaster'],
  [IncidentType.UNKNOWN]: [],
};

const RESPONDER_TYPE_MAP: Record<IncidentType, string[]> = {
  [IncidentType.MEDICAL]: ['AMBULANCE', 'MEDICAL_TEAM'],
  [IncidentType.FIRE]: ['FIRE', 'AMBULANCE'],
  [IncidentType.NATURAL_DISASTER]: ['SEARCH_RESCUE', 'DISASTER_MGMT', 'MEDICAL_TEAM'],
  [IncidentType.SECURITY]: ['POLICE'],
  [IncidentType.INFRASTRUCTURE]: ['FIRE', 'POLICE'],
  [IncidentType.CHEMICAL]: ['HAZMAT', 'FIRE', 'AMBULANCE'],
  [IncidentType.BIOLOGICAL]: ['HAZMAT', 'MEDICAL_TEAM'],
  [IncidentType.RADIOLOGICAL]: ['HAZMAT', 'MILITARY'],
  [IncidentType.NUCLEAR]: ['HAZMAT', 'MILITARY', 'DISASTER_MGMT'],
  [IncidentType.CYBER]: ['CYBER_UNIT'],
  [IncidentType.MASS_CASUALTY]: ['AMBULANCE', 'POLICE', 'FIRE', 'MEDICAL_TEAM', 'MILITARY'],
  [IncidentType.UNKNOWN]: ['POLICE', 'AMBULANCE'],
};

export class AIEngine {
  private static ready = false;
  private static modelVersion = '1.0.0';

  static async initialize(): Promise<void> {
    try {
      // Verify NLP service connectivity
      await axios.get(`${NLP_SERVICE_URL}/health`, { timeout: 5000 });
      this.ready = true;
      logger.info('✅ AIEngine connected to NLP service');
    } catch {
      logger.warn('⚠️  AIEngine: NLP service unavailable, using local fallback models');
      this.ready = true;  // Still operational with fallbacks
    }
  }

  static isReady(): boolean {
    return this.ready;
  }

  // ── NLP Text Analysis ─────────────────────────────────────

  static async analyzeText(text: string, language: string = 'en'): Promise<NLPAnalysis> {
    try {
      const response = await axios.post(
        `${NLP_SERVICE_URL}/analyze`,
        { text, language },
        { timeout: 3000 },
      );
      return response.data as NLPAnalysis;
    } catch {
      logger.warn('[AIEngine] NLP service unavailable, using local fallback');
      return this.localNLPFallback(text, language);
    }
  }

  private static localNLPFallback(text: string, language: string): NLPAnalysis {
    const lower = text.toLowerCase();
    let classifiedType = IncidentType.UNKNOWN;
    let maxMatches = 0;

    for (const [type, keywords] of Object.entries(INCIDENT_KEYWORDS)) {
      const matches = keywords.filter(kw => lower.includes(kw)).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        classifiedType = type as IncidentType;
      }
    }

    const isPanic = /help|emergency|dying|please|hurry|now|fast/i.test(text);
    const entities: NLPEntity[] = this.extractEntitiesLocal(text);

    return {
      originalText: text,
      detectedLanguage: language,
      confidence: maxMatches > 0 ? Math.min(0.5 + maxMatches * 0.1, 0.9) : 0.3,
      entities,
      intent: classifiedType === IncidentType.UNKNOWN ? 'REPORT_INCIDENT' : `REPORT_${classifiedType}`,
      sentiment: isPanic ? 'PANIC' : 'URGENT',
      keywords: text.toLowerCase().split(/\s+/).filter(w => w.length > 3),
      classifiedType,
      classificationConfidence: maxMatches > 0 ? Math.min(0.4 + maxMatches * 0.15, 0.95) : 0.3,
    };
  }

  private static extractEntitiesLocal(text: string): NLPEntity[] {
    const entities: NLPEntity[] = [];

    // Simple location pattern: "at [location]", "near [location]", "on [street]"
    const locationMatch = text.match(/(?:at|near|on|in|by)\s+([A-Z][a-zA-Z\s,]+?)(?:\.|,|$)/);
    if (locationMatch) {
      entities.push({
        type: 'LOCATION',
        value: locationMatch[1].trim(),
        confidence: 0.6,
      });
    }

    // Injury patterns
    if (/bleeding|injured|hurt|wound/i.test(text)) {
      entities.push({ type: 'INJURY', value: 'physical injury', confidence: 0.8 });
    }

    return entities;
  }

  // ── Geocoding ─────────────────────────────────────────────

  static async geocodeAddress(address: string): Promise<GeoCoordinate | null> {
    try {
      const response = await axios.get(`${GEOCODING_API_URL}/search`, {
        params: { q: address, format: 'json', limit: 1 },
        headers: { 'User-Agent': 'LIFEGRID-Emergency-System/1.0' },
        timeout: 5000,
      });

      if (response.data?.length > 0) {
        const result = response.data[0];
        return {
          lat: parseFloat(result.lat),
          lng: parseFloat(result.lon),
          accuracy: 100,
          timestamp: new Date().toISOString(),
        };
      }
      return null;
    } catch {
      logger.warn(`[AIEngine] Geocoding failed for: ${address}`);
      return null;
    }
  }

  // ── Dispatch Decision ─────────────────────────────────────

  static async makeDispatchDecision(
    incident: Incident,
    availableResponders: Responder[],
  ): Promise<AIDecision> {
    try {
      const response = await axios.post(
        `${NLP_SERVICE_URL}/dispatch-decision`,
        { incident, availableResponders },
        { timeout: 5000 },
      );
      return response.data as AIDecision;
    } catch {
      return this.localDispatchDecision(incident, availableResponders);
    }
  }

  private static localDispatchDecision(
    incident: Incident,
    responders: Responder[],
  ): AIDecision {
    const requiredTypes = RESPONDER_TYPE_MAP[incident.type] ?? ['POLICE'];

    // Score and rank responders
    const scored = responders
      .filter(r => r.isAvailable && requiredTypes.includes(r.type))
      .map(r => {
        const dist = this.haversineKm(incident.location, r.currentLocation);
        const eta = Math.round((dist / 60) * 3600);  // assume 60 km/h avg
        const score = 1000 - dist * 10 - eta;
        return { responder: r, dist, eta, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    const recommendations: ResponderRecommendation[] = scored.map((s, i) => ({
      responderId: s.responder.id,
      responderType: s.responder.type,
      priority: i + 1,
      estimatedArrival: s.eta,
      distanceKm: s.dist,
      reason: `Nearest available ${s.responder.type} unit`,
    }));

    const resources: ResourceRequirement[] = requiredTypes.map(t => ({
      type: t,
      quantity: 1,
      priority: 'HIGH',
    }));

    const riskScore = this.calculateRiskScore(incident);

    return {
      recommendedResponders: recommendations,
      estimatedResponseTime: recommendations[0]?.estimatedArrival ?? 600,
      riskScore,
      escalationRequired: riskScore > 80 || incident.severity === 'CRITICAL',
      resourceRequirements: resources,
      decisionConfidence: 0.75,
      modelVersion: this.modelVersion,
      timestamp: new Date().toISOString(),
    };
  }

  private static calculateRiskScore(incident: Incident): number {
    let score = 0;
    if (incident.severity === 'CRITICAL') score += 40;
    else if (incident.severity === 'HIGH') score += 25;
    else if (incident.severity === 'MEDIUM') score += 10;

    const highRiskTypes = [
      IncidentType.NUCLEAR, IncidentType.RADIOLOGICAL,
      IncidentType.BIOLOGICAL, IncidentType.MASS_CASUALTY,
    ];
    if (highRiskTypes.includes(incident.type)) score += 40;

    if (incident.nlpAnalysis?.sentiment === 'PANIC') score += 20;

    return Math.min(score, 100);
  }

  // ── Haversine distance ────────────────────────────────────

  private static haversineKm(a: GeoCoordinate, b: GeoCoordinate): number {
    const R = 6371;
    const dLat = this.toRad(b.lat - a.lat);
    const dLng = this.toRad(b.lng - a.lng);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(a.lat)) * Math.cos(this.toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }

  private static toRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }
}
