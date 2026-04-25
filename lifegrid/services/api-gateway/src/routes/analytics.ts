import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@lifegrid/shared-types';
import { requireRole } from '../middleware/requireRole';
import { asyncHandler } from '../utils/asyncHandler';
import { DatabaseManager } from '../database/DatabaseManager';
import { IncidentRepository } from '../database/repositories/IncidentRepository';
import { ResponderRepository } from '../database/repositories/ResponderRepository';

import { MongoIncidentRepository } from '../database/repositories/MongoIncidentRepository';

export const analyticsRouter = Router();

// GET /analytics/metrics
analyticsRouter.get(
  '/metrics',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN, UserRole.ANALYST]),
  asyncHandler(async (_req: Request, res: Response) => {
    const [incidentStats, responders] = await Promise.all([
      IncidentRepository.getSummaryStats(),
      ResponderRepository.findAll(),
    ]);

    const metrics = {
      activeIncidents: incidentStats.active_incidents ?? 0,
      criticalIncidents: incidentStats.critical_incidents ?? 0,
      availableResponders: responders.filter(r => r.isAvailable).length,
      dispatchedResponders: responders.filter(r => r.status === 'DISPATCHED' || r.status === 'EN_ROUTE').length,
      avgResponseTimeSeconds: incidentStats.avg_resolution_seconds ?? 0,
      incidentsLast24h: incidentStats.incidents_24h ?? 0,
      resolvedLast24h: incidentStats.resolved_24h ?? 0,
      systemAlertLevel: 'GREEN',
      timestamp: new Date().toISOString(),
    };

    res.json({ success: true, data: metrics, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// GET /analytics/heatmap — uses MongoDB aggregation pipeline
analyticsRouter.get(
  '/heatmap',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN, UserRole.ANALYST]),
  asyncHandler(async (req: Request, res: Response) => {
    const days = parseInt(req.query.days as string ?? '7', 10);

    // Try MongoDB first (faster aggregation), fall back to PostgreSQL
    let heatmap = await MongoIncidentRepository.getHeatmapData(days);

    if (heatmap.length === 0) {
      // PostgreSQL fallback
      const rows = await DatabaseManager.query(
        `SELECT location_lat, location_lng, type, COUNT(*) as count
         FROM lifegrid.incidents
         WHERE created_at > NOW() - INTERVAL '${days} days'
           AND location_lat IS NOT NULL
         GROUP BY location_lat, location_lng, type`,
      );
      heatmap = rows.map(r => ({
        location: { lat: parseFloat(r.location_lat), lng: parseFloat(r.location_lng) },
        weight: parseInt(r.count, 10),
        incidentType: r.type,
        count: parseInt(r.count, 10),
      }));
    }

    res.json({ success: true, data: heatmap, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// GET /analytics/timeseries
analyticsRouter.get(
  '/timeseries',
  requireRole([UserRole.OPERATOR, UserRole.SUPERVISOR, UserRole.COMMANDER, UserRole.SYSTEM_ADMIN, UserRole.ANALYST]),
  asyncHandler(async (req: Request, res: Response) => {
    const hours = parseInt(req.query.hours as string ?? '24', 10);

    const rows = await DatabaseManager.query(
      `SELECT
        DATE_TRUNC('hour', created_at) AS hour,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL') AS critical,
        COUNT(*) FILTER (WHERE status = 'CLOSED') AS resolved
       FROM lifegrid.incidents
       WHERE created_at > NOW() - INTERVAL '${hours} hours'
       GROUP BY 1
       ORDER BY 1`,
    );

    res.json({ success: true, data: rows, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);
