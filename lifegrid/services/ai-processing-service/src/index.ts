// ============================================================
// LIFEGRID – AI Processing Service
// Port: 4002
//
// Consumes: lifegrid.incident.triggered
// Produces: lifegrid.incident.classified
//           lifegrid.ai.dispatch.request
//           lifegrid.incident.dispatched
//           lifegrid.incident.escalated
//
// Responsibilities:
//   - NLP classification (calls AI Engine)
//   - Dispatch decision (calls AI Engine)
//   - Risk scoring and escalation logic
//   - Writes enriched incident to PostgreSQL
//   - Publishes downstream events to Kafka
// ============================================================

import 'dotenv/config';
import { KafkaClient, KafkaEnvelope } from '../../event-bus/src/KafkaClient';
import { TOPICS } from '../../event-bus/src/topics';
import { AIEngineClient } from './clients/AIEngineClient';
import { IncidentWriter } from './db/IncidentWriter';
import { ResponderFetcher } from './db/ResponderFetcher';
import { logger } from './utils/logger';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';

const PORT = parseInt(process.env.PORT ?? '4002', 10);
const GROUP_ID = 'lifegrid-ai-processing';

// ── Concurrency limiter ───────────────────────────────────────
// Prevent overwhelming the AI engine with concurrent requests

class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) { this.permits = permits; }

  async acquire(): Promise<void> {
    if (this.permits > 0) { this.permits--; return; }
    return new Promise(resolve => this.queue.push(resolve));
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    } else {
      this.permits++;
    }
  }
}

const aiSemaphore = new Semaphore(parseInt(process.env.AI_CONCURRENCY ?? '10', 10));

// ── Main processing pipeline ──────────────────────────────────

async function processIncidentTrigger(envelope: KafkaEnvelope<any>): Promise<void> {
  const trigger = envelope.payload;
  const incidentId = uuidv4();
  const referenceCode = generateReferenceCode();

  logger.info(`[AI-Proc] Processing trigger ${trigger.triggerId} → incident ${incidentId}`);

  await aiSemaphore.acquire();
  try {
    // ── Step 1: Persist initial incident record ───────────────
    const incident = await IncidentWriter.createInitial({
      id: incidentId,
      referenceCode,
      trigger,
    });

    // ── Step 2: NLP Classification ────────────────────────────
    let nlpResult: any = null;
    try {
      nlpResult = await AIEngineClient.analyzeText(trigger.rawInput, trigger.language);
      await IncidentWriter.updateNLP(incidentId, nlpResult);

      await KafkaClient.publish(TOPICS.INCIDENT_CLASSIFIED, {
        incidentId,
        referenceCode,
        nlpResult,
        severity: deriveSeverity(nlpResult),
        type:     nlpResult.classified_type,
      }, {
        key: incidentId,
        correlationId: trigger.triggerId,
        sourceService: 'ai-processing-service',
        metadata: { incidentId },
      });
    } catch (err) {
      logger.warn(`[AI-Proc] NLP failed for ${incidentId}, using keyword fallback`);
      nlpResult = keywordFallback(trigger.rawInput);
    }

    // ── Step 3: Dispatch Decision ─────────────────────────────
    const incidentType = nlpResult?.classified_type ?? 'UNKNOWN';
    const severity     = deriveSeverity(nlpResult);
    const location     = trigger.sensorData?.location ?? { lat: 0, lng: 0 };

    // Fetch available responders from DB
    const responders = await ResponderFetcher.findAvailable(location, incidentType, 50);

    let dispatchDecision: any = null;
    try {
      dispatchDecision = await AIEngineClient.makeDispatchDecision({
        incident_location: location,
        incident_type:     incidentType,
        incident_severity: severity,
        available_responders: responders,
        nlp_urgency_score: nlpResult?.urgency_score ?? 0.5,
      });
    } catch (err) {
      logger.warn(`[AI-Proc] Dispatch AI failed for ${incidentId}, using nearest-responder fallback`);
      dispatchDecision = nearestResponderFallback(responders, location, incidentType);
    }

    await IncidentWriter.updateAIDecision(incidentId, dispatchDecision);

    // ── Step 4: Publish dispatch command ──────────────────────
    await KafkaClient.publish(TOPICS.DISPATCH_COMMAND, {
      incidentId,
      referenceCode,
      location,
      type:     incidentType,
      severity,
      responders: dispatchDecision.recommended_responders ?? [],
      routes:     [],
      encryptedChannels: [],
    }, {
      key: incidentId,
      correlationId: trigger.triggerId,
      sourceService: 'ai-processing-service',
      metadata: { incidentId },
    });

    // ── Escalation check ──────────────────────────────────────
    if (dispatchDecision.escalation_required || dispatchDecision.risk_score >= 80) {
      await KafkaClient.publish(TOPICS.INCIDENT_ESCALATED, {
        incidentId,
        referenceCode,
        riskScore: dispatchDecision.risk_score,
        reason:    'AI escalation threshold exceeded',
      }, {
        key: incidentId,
        sourceService: 'ai-processing-service',
        metadata: { incidentId },
      });
    }

    // ── Publish AI prediction result ──────────────────────────
    await KafkaClient.publish(TOPICS.AI_PREDICTION_RESULT, {
      incidentId,
      nlpResult,
      dispatchDecision,
      riskScore: dispatchDecision.risk_score,
      timestamp: new Date().toISOString(),
    }, {
      key: incidentId,
      sourceService: 'ai-processing-service',
      metadata: { incidentId },
    });

    logger.info(`[AI-Proc] ✅ Incident ${incidentId} processed. Risk: ${dispatchDecision.risk_score}/100`);

  } finally {
    aiSemaphore.release();
  }
}

// ── Helpers ───────────────────────────────────────────────────

function generateReferenceCode(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const seq = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
  return `INC-${y}${m}${d}-${seq}`;
}

function deriveSeverity(nlp: any): string {
  if (!nlp) return 'MEDIUM';
  if (nlp.sentiment === 'PANIC' || nlp.classification_confidence > 0.9) return 'CRITICAL';
  if (nlp.sentiment === 'URGENT') return 'HIGH';
  if (nlp.classification_confidence > 0.6) return 'MEDIUM';
  return 'LOW';
}

function keywordFallback(text: string): any {
  const lower = text.toLowerCase();
  const typeMap: Record<string, string> = {
    fire: 'FIRE', flood: 'NATURAL_DISASTER', medical: 'MEDICAL',
    shooting: 'SECURITY', chemical: 'CHEMICAL', earthquake: 'NATURAL_DISASTER',
  };
  const classified_type = Object.entries(typeMap).find(([k]) => lower.includes(k))?.[1] ?? 'UNKNOWN';
  return {
    classified_type,
    classification_confidence: 0.4,
    sentiment: lower.includes('help') || lower.includes('emergency') ? 'URGENT' : 'CALM',
    urgency_score: 0.5,
    entities: [],
    keywords: text.toLowerCase().split(/\s+/).filter(w => w.length > 3),
  };
}

function nearestResponderFallback(responders: any[], location: any, type: string): any {
  const typeMap: Record<string, string[]> = {
    MEDICAL: ['AMBULANCE', 'MEDICAL_TEAM'],
    FIRE: ['FIRE', 'AMBULANCE'],
    SECURITY: ['POLICE'],
    NATURAL_DISASTER: ['SEARCH_RESCUE', 'DISASTER_MGMT'],
    CHEMICAL: ['HAZMAT', 'FIRE'],
  };
  const preferred = typeMap[type] ?? ['POLICE', 'AMBULANCE'];
  const filtered = responders.filter(r => preferred.includes(r.type)).slice(0, 3);

  return {
    recommended_responders: filtered.map((r, i) => ({
      responder_id: r.id,
      responder_type: r.type,
      priority: i + 1,
      eta_seconds: 300,
      distance_km: 5,
      reason: 'Nearest available unit (fallback)',
    })),
    estimated_response_time: 300,
    risk_score: 50,
    escalation_required: false,
    resource_requirements: preferred.map(t => ({ type: t, quantity: 1, priority: 'HIGH' })),
    decision_confidence: 0.5,
    model_version: 'fallback-1.0',
  };
}

// ── Bootstrap ─────────────────────────────────────────────────

async function bootstrap() {
  logger.info('🚀 AI Processing Service starting...');

  KafkaClient.initialize();

  // Health endpoint
  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'operational', service: 'ai-processing' }));
  app.listen(PORT, () => logger.info(`✅ AI Processing Service health on port ${PORT}`));

  // Subscribe to incident triggers
  await KafkaClient.subscribe<any>(
    GROUP_ID,
    [TOPICS.INCIDENT_TRIGGERED],
    async (envelope) => {
      await processIncidentTrigger(envelope);
    },
    { maxRetries: 3, sendToDLQ: true },
  );

  logger.info(`✅ AI Processing Service consuming ${TOPICS.INCIDENT_TRIGGERED}`);

  process.on('SIGTERM', async () => {
    await KafkaClient.disconnect();
    process.exit(0);
  });
}

bootstrap().catch(err => { console.error('Fatal:', err); process.exit(1); });
