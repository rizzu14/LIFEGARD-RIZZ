// ============================================================
// LIFEGRID – Privacy & Legal Routes
// GDPR / CCPA / HIPAA compliance endpoints
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@lifegrid/shared-types';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { PrivacyCompliance } from '../legal/PrivacyCompliance';
import { GoodSamaritanPolicy } from '../legal/GoodSamaritanPolicy';
import { IdentityMasking } from '../security/IdentityMasking';
import { DatabaseManager } from '../database/DatabaseManager';
import { logger } from '../utils/logger';

export const privacyRouter = Router();

// ── POST /privacy/erasure-request  (GDPR Art. 17) ────────────

privacyRouter.post(
  '/erasure-request',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

    const result = await PrivacyCompliance.processErasureRequest(req.user.id);

    // Log erasure request
    await DatabaseManager.query(
      `INSERT INTO lifegrid.erasure_requests
        (user_id, status, erased_fields, retained_fields, retention_reason)
       VALUES ($1, 'COMPLETED', $2, $3, $4)`,
      [req.user.id, result.erasedFields, result.retainedFields, result.reason],
    ).catch(() => {});

    logger.info(`[Privacy] Erasure request processed for user ${req.user.id.slice(0, 8)}...`);

    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── GET /privacy/export  (GDPR Art. 20 — data portability) ───

privacyRouter.get(
  '/export',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

    const data = await PrivacyCompliance.exportUserData(req.user.id);

    res.setHeader('Content-Disposition', `attachment; filename="lifegrid-data-export-${Date.now()}.json"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(data);
  }),
);

// ── GET /privacy/consent  (view consent records) ─────────────

privacyRouter.get(
  '/consent',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

    const records = await DatabaseManager.query(
      `SELECT purpose, legal_basis, jurisdiction, consented_at, withdrawn_at
       FROM lifegrid.consent_records WHERE user_id = $1`,
      [req.user.id],
    );

    res.json({
      success: true,
      data: records,
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── DELETE /privacy/consent/:purpose  (withdraw consent) ─────

privacyRouter.delete(
  '/consent/:purpose',
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');

    await DatabaseManager.query(
      `UPDATE lifegrid.consent_records
       SET withdrawn_at = NOW()
       WHERE user_id = $1 AND purpose = $2`,
      [req.user.id, req.params.purpose],
    );

    res.json({
      success: true,
      data: { message: 'Consent withdrawn' },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── GET /privacy/policy  (machine-readable privacy policy) ───

privacyRouter.get(
  '/policy',
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({
      success: true,
      data: {
        version: '2.0',
        effectiveDate: '2026-01-01',
        controller: 'LIFEGRID National Emergency Infrastructure',
        dpo: process.env.DPA_NOTIFICATION_EMAIL ?? 'dpa@lifegrid.gov',
        legalBases: {
          emergency: 'GDPR Art. 6(1)(d) — vital interests',
          health: 'GDPR Art. 9(2)(c) — vital interests (health data)',
          legal: 'GDPR Art. 6(1)(c) — legal obligation',
        },
        retentionSchedule: Object.fromEntries(
          Object.entries({
            location: 90, identity: 2555, health: 2555,
            biometric: 30, behavioral: 365, communication: 1825,
          }).map(([k, v]) => [k, `${v} days`])
        ),
        rights: ['access', 'rectification', 'erasure', 'portability', 'restriction', 'objection'],
        transfers: 'Data processed within jurisdiction. Cross-border only with adequacy decision.',
        contact: 'privacy@lifegrid.gov',
      },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── POST /privacy/good-samaritan-token  (issue token) ────────

privacyRouter.post(
  '/good-samaritan-token',
  asyncHandler(async (req: Request, res: Response) => {
    const { incidentId, jurisdiction } = req.body;
    if (!incidentId) throw new AppError('incidentId required', 400, 'VALIDATION_ERROR');

    const reporterIdentifier = req.user?.id ?? req.ip ?? 'anonymous';
    const token = GoodSamaritanPolicy.issueToken(incidentId, reporterIdentifier, jurisdiction);

    // Store token
    await DatabaseManager.query(
      `INSERT INTO lifegrid.good_samaritan_tokens
        (token_id, incident_id, jurisdiction, legal_basis, immunity_scope, reporter_hash, signature, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (token_id) DO NOTHING`,
      [token.tokenId, token.incidentId, token.jurisdiction, token.legalBasis,
       token.immunityScope, token.reporterHash, token.signature, token.expiresAt],
    ).catch(() => {});

    res.json({
      success: true,
      data: {
        tokenId: token.tokenId,
        jurisdiction: token.jurisdiction,
        legalBasis: token.legalBasis,
        immunityScope: token.immunityScope,
        issuedAt: token.issuedAt,
        expiresAt: token.expiresAt,
        // Note: reporterHash and signature not returned to client
      },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── POST /privacy/witness-protection  (commander only) ───────

privacyRouter.post(
  '/witness-protection',
  requireRole([UserRole.COMMANDER, UserRole.SYSTEM_ADMIN]),
  asyncHandler(async (req: Request, res: Response) => {
    const { userId, reason, durationDays } = req.body;
    if (!userId || !reason) throw new AppError('userId and reason required', 400, 'VALIDATION_ERROR');

    const record = IdentityMasking.activateWitnessProtection(
      userId, req.user!.id, reason, durationDays ?? 365,
    );

    // Persist
    await DatabaseManager.query(
      `INSERT INTO lifegrid.witness_protection
        (original_id, protected_id, activated_by, reason, expires_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [record.originalId, record.protectedId, record.activatedBy, record.reason, record.expiresAt],
    ).catch(() => {});

    logger.warn(`[Privacy] Witness protection activated for ${userId.slice(0, 8)}... by ${req.user!.id.slice(0, 8)}...`);

    res.json({
      success: true,
      data: {
        protectedId: record.protectedId,
        activatedAt: record.activatedAt,
        expiresAt: record.expiresAt,
      },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── GET /privacy/security-events  (admin only) ───────────────

privacyRouter.get(
  '/security-events',
  requireRole([UserRole.SYSTEM_ADMIN]),
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string ?? '50', 10), 200);
    const events = await DatabaseManager.query(
      `SELECT event_type, severity, ip_address, threat_score, details, created_at
       FROM lifegrid.security_events
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit],
    );

    res.json({
      success: true,
      data: events,
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);
