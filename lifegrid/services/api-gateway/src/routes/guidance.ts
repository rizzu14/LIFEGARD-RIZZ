import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@lifegrid/shared-types';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { GuidanceService } from '../services/GuidanceService';
import { WebSocketManager } from '../websocket/WebSocketManager';
import { DatabaseManager } from '../database/DatabaseManager';
import { AppError } from '../utils/AppError';

export const guidanceRouter = Router();

const AddMessageSchema = z.object({
  content: z.string().min(1).max(1000),
  language: z.string().default('en'),
});

// GET /guidance/:sessionId
guidanceRouter.get(
  '/:sessionId',
  asyncHandler(async (req: Request, res: Response) => {
    const session = await DatabaseManager.queryOne(
      `SELECT gs.*, json_agg(gm.* ORDER BY gm.created_at) AS messages
       FROM lifegrid.guidance_sessions gs
       LEFT JOIN lifegrid.guidance_messages gm ON gm.session_id = gs.id
       WHERE gs.id = $1
       GROUP BY gs.id`,
      [req.params.sessionId],
    );

    if (!session) throw new AppError('Session not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: session, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// POST /guidance/:sessionId/message  (operator sends message)
guidanceRouter.post(
  '/:sessionId/message',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER]),
  validate(AddMessageSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const message = await GuidanceService.addMessage(
      req.params.sessionId,
      'OPERATOR',
      req.body.content,
      req.body.language,
    );

    // Get incident ID for the session
    const session = await DatabaseManager.queryOne<{ incident_id: string }>(
      'SELECT incident_id FROM lifegrid.guidance_sessions WHERE id = $1',
      [req.params.sessionId],
    );

    if (session) {
      WebSocketManager.broadcastToIncident(session.incident_id, 'GUIDANCE_MESSAGE', {
        sessionId: req.params.sessionId,
        message,
      });
    }

    res.json({ success: true, data: message, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);
