// ============================================================
// LIFEGRID – Incident Routes
// ============================================================

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import {
  TriggerSource, IncidentStatus, IncidentSeverity,
  UserRole, ApiResponse, Incident,
} from '@lifegrid/shared-types';
import { IncidentPipeline } from '../pipeline/IncidentPipeline';
import { IncidentRepository } from '../database/repositories/IncidentRepository';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';

export const incidentRouter = Router();

// ── Validation schemas ────────────────────────────────────────

const ReportIncidentSchema = z.object({
  rawInput: z.string().min(5).max(2000),
  language: z.string().default('en'),
  source: z.nativeEnum(TriggerSource).default(TriggerSource.MOBILE_APP),
  location: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }).optional(),
  mediaUrls: z.array(z.string().url()).max(10).optional(),
  callerPhone: z.string().optional(),
});

const UpdateIncidentSchema = z.object({
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  notes: z.string().max(2000).optional(),
  assignedOperatorId: z.string().uuid().optional(),
});

const VerifyClosureSchema = z.object({
  method: z.enum(['OPERATOR_CONFIRM', 'RESPONDER_CONFIRM', 'CITIZEN_CONFIRM', 'SENSOR_CONFIRM']),
  notes: z.string().max(1000).optional(),
});

const ListIncidentsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(IncidentStatus).optional(),
  severity: z.nativeEnum(IncidentSeverity).optional(),
  type: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
  radiusKm: z.coerce.number().min(0.1).max(500).optional(),
});

// ── POST /incidents/report  (public – citizen reporting) ──────

incidentRouter.post(
  '/report',
  validate(ReportIncidentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof ReportIncidentSchema>;

    const trigger = {
      source: body.source,
      rawInput: body.rawInput,
      language: body.language,
      timestamp: new Date().toISOString(),
      deviceId: req.headers['x-device-id'] as string | undefined,
      callerInfo: body.callerPhone ? { phone: body.callerPhone } : undefined,
      mediaUrls: body.mediaUrls,
      sensorData: body.location
        ? undefined
        : undefined,
    };

    // If location provided, embed in rawInput for NLP extraction
    if (body.location) {
      (trigger as any).sensorData = {
        deviceId: req.headers['x-device-id'] ?? 'mobile',
        deviceType: 'PANIC_BUTTON',
        location: body.location,
        readings: [],
        timestamp: new Date().toISOString(),
        protocol: 'HTTP',
      };
    }

    const incident = await IncidentPipeline.process(trigger);

    const response: ApiResponse<{ incidentId: string; referenceCode: string; status: string }> = {
      success: true,
      data: {
        incidentId: incident.id,
        referenceCode: incident.referenceCode,
        status: incident.status,
      },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    };

    res.status(201).json(response);
  }),
);

// ── GET /incidents  (operator+) ───────────────────────────────

incidentRouter.get(
  '/',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN, UserRole.ANALYST]),
  validate(ListIncidentsSchema, 'query'),
  asyncHandler(async (req: Request, res: Response) => {
    const query = req.query as z.infer<typeof ListIncidentsSchema>;
    const result = await IncidentRepository.findAll(query);

    res.json({
      success: true,
      data: result.incidents,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / query.pageSize),
        hasNext: query.page * query.pageSize < result.total,
        hasPrev: query.page > 1,
      },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── GET /incidents/:id ────────────────────────────────────────

incidentRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const incident = await IncidentRepository.findById(req.params.id);
    if (!incident) throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');

    // Citizens can only see their own incidents
    if (req.user?.role === UserRole.CITIZEN && incident.reportedBy !== req.user.id) {
      throw new AppError('Access denied', 403, 'FORBIDDEN');
    }

    res.json({ success: true, data: incident, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// ── PATCH /incidents/:id  (operator+) ─────────────────────────

incidentRouter.patch(
  '/:id',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN]),
  validate(UpdateIncidentSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const incident = await IncidentRepository.findById(req.params.id);
    if (!incident) throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');

    const updates: Partial<Incident> = {
      ...req.body,
      updatedAt: new Date().toISOString(),
    };

    if (req.body.notes) {
      updates.notes = [...incident.notes, `[${req.user!.id}] ${req.body.notes}`];
      delete (updates as any).notes;
    }

    const updated = await IncidentRepository.update(req.params.id, updates);
    WebSocketManager.broadcastToCommandCenter('INCIDENT_UPDATED', updated);

    res.json({ success: true, data: updated, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// ── POST /incidents/:id/verify  (operator/responder) ──────────

incidentRouter.post(
  '/:id/verify',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.RESPONDER]),
  validate(VerifyClosureSchema),
  asyncHandler(async (req: Request, res: Response) => {
    await IncidentPipeline.confirmClosure(
      req.params.id,
      req.user!.id,
      req.body.method,
      req.body.notes,
    );

    res.json({
      success: true,
      data: { message: 'Verification recorded' },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── GET /incidents/:id/timeline ───────────────────────────────

incidentRouter.get(
  '/:id/timeline',
  asyncHandler(async (req: Request, res: Response) => {
    const incident = await IncidentRepository.findById(req.params.id);
    if (!incident) throw new AppError('Incident not found', 404, 'INCIDENT_NOT_FOUND');

    const timeline = [
      { step: 1, name: 'Triggered', timestamp: incident.trigger.timestamp, status: 'complete' },
      { step: 2, name: 'Classified', timestamp: incident.nlpAnalysis ? incident.createdAt : null, status: incident.nlpAnalysis ? 'complete' : 'pending' },
      { step: 3, name: 'Decision Made', timestamp: incident.aiDecision?.timestamp ?? null, status: incident.aiDecision ? 'complete' : 'pending' },
      { step: 4, name: 'Dispatched', timestamp: incident.dispatches[0]?.dispatchedAt ?? null, status: incident.dispatches.length > 0 ? 'complete' : 'pending' },
      { step: 5, name: 'En Route', timestamp: incident.routes[0] ? incident.dispatches[0]?.dispatchedAt : null, status: incident.routes.length > 0 ? 'complete' : 'pending' },
      { step: 6, name: 'Guidance Active', timestamp: incident.guidanceSessions[0]?.startedAt ?? null, status: incident.guidanceSessions.length > 0 ? 'complete' : 'pending' },
      { step: 7, name: 'Confirmed & Closed', timestamp: incident.closedAt ?? null, status: incident.status === IncidentStatus.CLOSED ? 'complete' : 'pending' },
    ];

    res.json({ success: true, data: timeline, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// ── GET /incidents/stats/summary  (operator+) ─────────────────

incidentRouter.get(
  '/stats/summary',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN, UserRole.ANALYST]),
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await IncidentRepository.getSummaryStats();
    res.json({ success: true, data: stats, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);
