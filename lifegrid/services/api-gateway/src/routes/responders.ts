import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@lifegrid/shared-types';
import { requireRole } from '../middleware/requireRole';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { ResponderRepository } from '../database/repositories/ResponderRepository';
import { AppError } from '../utils/AppError';

export const responderRouter = Router();

const UpdateLocationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

// GET /responders
responderRouter.get(
  '/',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN]),
  asyncHandler(async (_req: Request, res: Response) => {
    const responders = await ResponderRepository.findAll();
    res.json({ success: true, data: responders, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// GET /responders/:id
responderRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const responder = await ResponderRepository.findById(req.params.id);
    if (!responder) throw new AppError('Responder not found', 404, 'NOT_FOUND');
    res.json({ success: true, data: responder, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// PATCH /responders/:id/location  (responder self-update)
responderRouter.patch(
  '/:id/location',
  requireRole([UserRole.RESPONDER, UserRole.OPERATOR, UserRole.SYSTEM_ADMIN]),
  validate(UpdateLocationSchema),
  asyncHandler(async (req: Request, res: Response) => {
    await ResponderRepository.updateLocation(req.params.id, req.body);
    res.json({ success: true, data: { updated: true }, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);
