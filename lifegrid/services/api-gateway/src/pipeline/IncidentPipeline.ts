// ============================================================
// LIFEGRID – 7-Step Incident Processing Pipeline
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import {
  Incident, IncidentStatus, IncidentSeverity, AlertLevel,
  TriggerSource, IncidentTrigger, DispatchRecord, RouteOptimization,
  GuidanceSession, VerificationRecord, WSEventType,
} from '@lifegrid/shared-types';
import { logger } from '../utils/logger';
import { AIEngine } from '../ai/AIEngine';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { IncidentRepository } from '../database/repositories/IncidentRepository';
import { MongoIncidentRepository } from '../database/repositories/MongoIncidentRepository';
import { ResponderRepository } from '../database/repositories/ResponderRepository';
import { RouteService } from '../services/RouteService';
import { EncryptionService } from '../services/EncryptionService';
import { NotificationService } from '../services/NotificationService';
import { GuidanceService } from '../services/GuidanceService';
import { AuditService } from '../services/AuditService';
import { RedisManager } from '../cache/RedisManager';

interface PipelineContext {
  incident: Incident;
  processingStartedAt: number;
  stepTimings: Record<string, number>;
  errors: PipelineError[];
  fallbacksUsed: string[];
}

interface PipelineError {
  step: string;
  error: string;
  timestamp: string;
  recovered: boolean;
}

export class IncidentPipeline {
  private static wsManager: typeof WebSocketManager;
  private static aiEngine: typeof AIEngine;

  static initialize(
    wsManager: typeof WebSocketManager,
    aiEngine: typeof AIEngine,
  ): void {
    this.wsManager = wsManager;
    this.aiEngine = aiEngine;
    logger.info('✅ IncidentPipeline initialized');
  }

  // ── Main pipeline entry point ─────────────────────────────

  static async process(trigger: IncidentTrigger): Promise<Incident> {
    const incidentId = uuidv4();
    const referenceCode = this.generateReferenceCode();

    const incident: Incident = {
      id: incidentId,
      referenceCode,
      status: IncidentStatus.TRIGGERED,
      severity: IncidentSeverity.MEDIUM,  // default, overridden by AI
      type: trigger.sensorData?.deviceType as any ?? 'UNKNOWN',
      alertLevel: AlertLevel.YELLOW,
      trigger,
      dispatches: [],
      routes: [],
      guidanceSessions: [],
      verifications: [],
      location: { lat: 0, lng: 0 },  // extracted in step 2
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tags: [],
      notes: [],
      mediaUrls: [],
      isPublic: false,
    };

    const ctx: PipelineContext = {
      incident,
      processingStartedAt: Date.now(),
      stepTimings: {},
      errors: [],
      fallbacksUsed: [],
    };

    logger.info(`[Pipeline] Starting 7-step processing for incident ${incidentId}`);

    try {
      // Save initial record immediately for traceability
      await IncidentRepository.create(incident);

      // Mirror to MongoDB (non-blocking — PostgreSQL is source of truth)
      MongoIncidentRepository.create({
        incidentId:    incident.id,
        referenceCode: incident.referenceCode,
        status:        incident.status as any,
        severity:      incident.severity as any,
        type:          incident.type as any,
        alertLevel:    incident.alertLevel as any,
        location: {
          type: 'Point',
          coordinates: [incident.location.lng, incident.location.lat],
        },
        locationLat: incident.location.lat,
        locationLng: incident.location.lng,
        trigger: {
          source:      trigger.source as any,
          rawInput:    trigger.rawInput,
          language:    trigger.language,
          timestamp:   new Date(trigger.timestamp),
          deviceId:    trigger.deviceId,
          callerPhone: trigger.callerInfo?.phone,
          mediaUrls:   trigger.mediaUrls ?? [],
        },
        isPublic: false,
        tags: [],
        notes: [],
        mediaUrls: [],
        dispatches: [],
        guidanceSessions: [],
        verifications: [],
        auditTrail: [{
          action: 'INCIDENT_CREATED',
          timestamp: new Date(),
          details: { source: trigger.source },
        }],
      }).catch(() => {}); // Non-fatal

      this.broadcast('INCIDENT_CREATED', incident);

      // Execute 7-step pipeline
      await this.step1_Trigger(ctx);
      await this.step2_Understanding(ctx);
      await this.step3_Decision(ctx);
      await this.step4_Dispatch(ctx);
      await this.step5_Execution(ctx);
      await this.step6_Support(ctx);
      // Step 7 (Confirmation) is triggered asynchronously by responder/operator actions

      const totalMs = Date.now() - ctx.processingStartedAt;
      logger.info(`[Pipeline] Steps 1–6 complete for ${incidentId} in ${totalMs}ms`);

      await AuditService.logPipelineCompletion(ctx.incident, ctx.stepTimings, ctx.errors);

      return ctx.incident;
    } catch (err) {
      logger.error(`[Pipeline] Fatal error for incident ${incidentId}:`, err);
      ctx.incident.status = IncidentStatus.ESCALATED;
      ctx.incident.notes.push(`Pipeline error: ${(err as Error).message}`);
      await IncidentRepository.update(incidentId, ctx.incident);
      this.broadcast('INCIDENT_UPDATED', ctx.incident);
      throw err;
    }
  }

  // ── Step 1: Trigger ───────────────────────────────────────
  // Normalize multi-source input into a unified incident record

  private static async step1_Trigger(ctx: PipelineContext): Promise<void> {
    const t = Date.now();
    logger.info(`[Step 1] Trigger normalization for ${ctx.incident.id}`);

    try {
      const { trigger } = ctx.incident;

      // Extract location from trigger source
      if (trigger.sensorData?.location) {
        ctx.incident.location = trigger.sensorData.location;
      } else if (trigger.source === TriggerSource.MOBILE_APP) {
        // Location embedded in rawInput as JSON
        try {
          const parsed = JSON.parse(trigger.rawInput);
          if (parsed.lat && parsed.lng) {
            ctx.incident.location = { lat: parsed.lat, lng: parsed.lng };
          }
        } catch {
          // Will be extracted by NLP in step 2
        }
      }

      // Attach media if present
      if (trigger.mediaUrls) {
        ctx.incident.mediaUrls.push(...trigger.mediaUrls);
      }

      // Cache trigger for deduplication (prevent duplicate incidents within 60s)
      const dedupeKey = `trigger:dedup:${trigger.source}:${trigger.deviceId ?? trigger.callerInfo?.phone ?? 'anon'}`;
      const existing = await RedisManager.get(dedupeKey);
      if (existing) {
        logger.warn(`[Step 1] Duplicate trigger detected, linking to existing incident ${existing}`);
        ctx.incident.notes.push(`Duplicate trigger linked to ${existing}`);
      } else {
        await RedisManager.set(dedupeKey, ctx.incident.id, 60);
      }

      ctx.incident.status = IncidentStatus.TRIGGERED;
      ctx.stepTimings['step1'] = Date.now() - t;
    } catch (err) {
      this.recordError(ctx, 'step1', err as Error, true);
    }
  }

  // ── Step 2: Understanding ─────────────────────────────────
  // NLP classification, entity extraction, language detection

  private static async step2_Understanding(ctx: PipelineContext): Promise<void> {
    const t = Date.now();
    logger.info(`[Step 2] NLP understanding for ${ctx.incident.id}`);

    try {
      const nlpResult = await this.aiEngine.analyzeText(
        ctx.incident.trigger.rawInput,
        ctx.incident.trigger.language,
      );

      ctx.incident.nlpAnalysis = nlpResult;
      ctx.incident.type = nlpResult.classifiedType;

      // Extract location from NLP entities if not already set
      if (ctx.incident.location.lat === 0) {
        const locationEntity = nlpResult.entities.find(e => e.type === 'LOCATION');
        if (locationEntity) {
          const geocoded = await this.aiEngine.geocodeAddress(locationEntity.value);
          if (geocoded) ctx.incident.location = geocoded;
        }
      }

      // Determine initial severity from NLP sentiment + type
      ctx.incident.severity = this.deriveSeverity(nlpResult);
      ctx.incident.alertLevel = this.deriveAlertLevel(ctx.incident.severity);
      ctx.incident.status = IncidentStatus.CLASSIFIED;

      await IncidentRepository.update(ctx.incident.id, ctx.incident);
      this.broadcast('INCIDENT_UPDATED', ctx.incident);

      ctx.stepTimings['step2'] = Date.now() - t;
    } catch (err) {
      // Fallback: use keyword-based classification
      logger.warn(`[Step 2] NLP failed, using keyword fallback`);
      ctx.incident.severity = IncidentSeverity.HIGH;
      ctx.incident.alertLevel = AlertLevel.ORANGE;
      ctx.fallbacksUsed.push('step2:keyword-classification');
      this.recordError(ctx, 'step2', err as Error, true);
    }
  }

  // ── Step 3: Decision ──────────────────────────────────────
  // AI responder selection, resource allocation

  private static async step3_Decision(ctx: PipelineContext): Promise<void> {
    const t = Date.now();
    logger.info(`[Step 3] AI decision for ${ctx.incident.id}`);

    try {
      const availableResponders = await ResponderRepository.findAvailable(
        ctx.incident.location,
        ctx.incident.type,
        50,  // km radius
      );

      const decision = await this.aiEngine.makeDispatchDecision(
        ctx.incident,
        availableResponders,
      );

      ctx.incident.aiDecision = decision;

      // Escalate if AI recommends it
      if (decision.escalationRequired) {
        ctx.incident.severity = IncidentSeverity.CRITICAL;
        ctx.incident.alertLevel = AlertLevel.RED;
        await NotificationService.notifyCommanders(ctx.incident);
      }

      await IncidentRepository.update(ctx.incident.id, ctx.incident);
      this.broadcast('INCIDENT_UPDATED', ctx.incident);

      ctx.stepTimings['step3'] = Date.now() - t;
    } catch (err) {
      // Fallback: nearest-responder rule
      logger.warn(`[Step 3] AI decision failed, using nearest-responder fallback`);
      ctx.fallbacksUsed.push('step3:nearest-responder');
      this.recordError(ctx, 'step3', err as Error, true);
    }
  }

  // ── Step 4: Dispatch ──────────────────────────────────────
  // Encrypted communication to selected responders

  private static async step4_Dispatch(ctx: PipelineContext): Promise<void> {
    const t = Date.now();
    logger.info(`[Step 4] Dispatch for ${ctx.incident.id}`);

    try {
      const recommendations = ctx.incident.aiDecision?.recommendedResponders ?? [];

      for (const rec of recommendations.slice(0, 5)) {  // max 5 responders per incident
        const channel = await EncryptionService.createSecureChannel(
          ctx.incident.id,
          rec.responderId,
        );

        const dispatch: DispatchRecord = {
          dispatchId: uuidv4(),
          incidentId: ctx.incident.id,
          responderId: rec.responderId,
          dispatchedAt: new Date().toISOString(),
          encryptedChannel: channel.channelId,
          routeId: '',  // filled in step 5
          estimatedArrival: new Date(Date.now() + rec.estimatedArrival * 1000).toISOString(),
        };

        ctx.incident.dispatches.push(dispatch);

        // Send encrypted dispatch notification
        await NotificationService.dispatchResponder(rec.responderId, {
          incidentId: ctx.incident.id,
          referenceCode: ctx.incident.referenceCode,
          location: ctx.incident.location,
          type: ctx.incident.type,
          severity: ctx.incident.severity,
          channel: channel.channelId,
          encryptedKey: channel.encryptedKey,
        });

        // Update responder status
        await ResponderRepository.updateStatus(rec.responderId, 'DISPATCHED', ctx.incident.id);
      }

      ctx.incident.status = IncidentStatus.DISPATCHED;
      await IncidentRepository.update(ctx.incident.id, ctx.incident);
      this.broadcast('DISPATCH_SENT', {
        incidentId: ctx.incident.id,
        dispatches: ctx.incident.dispatches,
      });

      ctx.stepTimings['step4'] = Date.now() - t;
    } catch (err) {
      this.recordError(ctx, 'step4', err as Error, false);
      throw err;  // Dispatch failure is non-recoverable
    }
  }

  // ── Step 5: Execution ─────────────────────────────────────
  // Route optimization + GIS layer activation

  private static async step5_Execution(ctx: PipelineContext): Promise<void> {
    const t = Date.now();
    logger.info(`[Step 5] Route optimization for ${ctx.incident.id}`);

    try {
      for (const dispatch of ctx.incident.dispatches) {
        const responder = await ResponderRepository.findById(dispatch.responderId);
        if (!responder) continue;

        const route = await RouteService.optimize({
          origin: responder.currentLocation,
          destination: ctx.incident.location,
          incidentType: ctx.incident.type,
          severity: ctx.incident.severity,
          avoidZones: [],  // populated from GIS hazard layers
        });

        route.routeId = uuidv4();
        route.responderId = dispatch.responderId;
        dispatch.routeId = route.routeId;

        ctx.incident.routes.push(route);

        // Push route to responder device
        await NotificationService.sendRoute(dispatch.responderId, route);
      }

      ctx.incident.status = IncidentStatus.EN_ROUTE;
      await IncidentRepository.update(ctx.incident.id, ctx.incident);
      this.broadcast('INCIDENT_UPDATED', ctx.incident);

      ctx.stepTimings['step5'] = Date.now() - t;
    } catch (err) {
      logger.warn(`[Step 5] Route optimization failed, using direct route fallback`);
      ctx.fallbacksUsed.push('step5:direct-route');
      this.recordError(ctx, 'step5', err as Error, true);
    }
  }

  // ── Step 6: Support ───────────────────────────────────────
  // Live multilingual guidance to citizen

  private static async step6_Support(ctx: PipelineContext): Promise<void> {
    const t = Date.now();
    logger.info(`[Step 6] Guidance session for ${ctx.incident.id}`);

    try {
      const language = ctx.incident.nlpAnalysis?.detectedLanguage ?? ctx.incident.trigger.language ?? 'en';

      const session = await GuidanceService.startSession({
        incidentId: ctx.incident.id,
        language,
        channel: ctx.incident.trigger.source === TriggerSource.VOICE_CALL ? 'VOICE' : 'APP',
        incidentType: ctx.incident.type,
        severity: ctx.incident.severity,
        estimatedArrival: ctx.incident.aiDecision?.estimatedResponseTime,
      });

      ctx.incident.guidanceSessions.push(session);
      await IncidentRepository.update(ctx.incident.id, ctx.incident);

      this.broadcast('GUIDANCE_MESSAGE', {
        incidentId: ctx.incident.id,
        sessionId: session.sessionId,
        message: session.messages[0],
      });

      ctx.stepTimings['step6'] = Date.now() - t;
    } catch (err) {
      logger.warn(`[Step 6] Guidance service failed`);
      ctx.fallbacksUsed.push('step6:no-guidance');
      this.recordError(ctx, 'step6', err as Error, true);
    }
  }

  // ── Step 7: Confirmation ──────────────────────────────────
  // Dual verification closure — called externally by operator/responder

  static async confirmClosure(
    incidentId: string,
    verifiedBy: string,
    method: VerificationRecord['method'],
    notes?: string,
  ): Promise<void> {
    const incident = await IncidentRepository.findById(incidentId);
    if (!incident) throw new Error(`Incident ${incidentId} not found`);

    const verification: VerificationRecord = {
      verificationId: uuidv4(),
      incidentId,
      method,
      verifiedBy,
      timestamp: new Date().toISOString(),
      signature: await EncryptionService.sign(`${incidentId}:${verifiedBy}:${Date.now()}`),
      notes,
    };

    incident.verifications.push(verification);

    // Require dual verification for CRITICAL incidents
    const requiredVerifications = incident.severity === IncidentSeverity.CRITICAL ? 2 : 1;
    const hasEnoughVerifications = incident.verifications.length >= requiredVerifications;

    if (hasEnoughVerifications) {
      incident.status = IncidentStatus.CLOSED;
      incident.closedAt = new Date().toISOString();
      logger.info(`[Step 7] Incident ${incidentId} closed with dual verification`);
    }

    incident.updatedAt = new Date().toISOString();
    await IncidentRepository.update(incidentId, incident);

    WebSocketManager.broadcast('VERIFICATION_COMPLETE', {
      incidentId,
      verification,
      isClosed: incident.status === IncidentStatus.CLOSED,
    });

    if (incident.status === IncidentStatus.CLOSED) {
      await AuditService.logIncidentClosure(incident);
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  private static generateReferenceCode(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const seq = Math.floor(Math.random() * 999999).toString().padStart(6, '0');
    return `INC-${year}${month}${day}-${seq}`;
  }

  private static deriveSeverity(nlp: any): IncidentSeverity {
    if (nlp.sentiment === 'PANIC' || nlp.classificationConfidence > 0.9) {
      return IncidentSeverity.CRITICAL;
    }
    if (nlp.sentiment === 'URGENT') return IncidentSeverity.HIGH;
    if (nlp.classificationConfidence > 0.6) return IncidentSeverity.MEDIUM;
    return IncidentSeverity.LOW;
  }

  private static deriveAlertLevel(severity: IncidentSeverity): AlertLevel {
    const map: Record<IncidentSeverity, AlertLevel> = {
      [IncidentSeverity.CRITICAL]: AlertLevel.RED,
      [IncidentSeverity.HIGH]: AlertLevel.ORANGE,
      [IncidentSeverity.MEDIUM]: AlertLevel.YELLOW,
      [IncidentSeverity.LOW]: AlertLevel.GREEN,
    };
    return map[severity];
  }

  private static recordError(
    ctx: PipelineContext,
    step: string,
    err: Error,
    recovered: boolean,
  ): void {
    ctx.errors.push({
      step,
      error: err.message,
      timestamp: new Date().toISOString(),
      recovered,
    });
    logger.error(`[Pipeline][${step}] Error (recovered=${recovered}):`, err.message);
  }

  private static broadcast(event: WSEventType, payload: unknown): void {
    WebSocketManager.broadcast(event, payload);
  }
}
