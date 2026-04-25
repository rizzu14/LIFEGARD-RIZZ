// ============================================================
// LIFEGRID – MongoDB Incident Repository
// Full CRUD + geospatial + text search operations
// ============================================================

import { IncidentModel, IIncident } from '../schemas/IncidentSchema';
import { logger } from '../../utils/logger';

export class MongoIncidentRepository {

  // ── Create ────────────────────────────────────────────────

  static async create(data: Partial<IIncident>): Promise<IIncident | null> {
    try {
      const incident = new IncidentModel(data);
      return await incident.save();
    } catch (err) {
      logger.error('[MongoDB] Incident create failed:', err);
      return null;
    }
  }

  // ── Read ──────────────────────────────────────────────────

  static async findById(incidentId: string): Promise<IIncident | null> {
    try {
      return await IncidentModel.findOne({ incidentId }).lean();
    } catch (err) {
      logger.error('[MongoDB] Incident findById failed:', err);
      return null;
    }
  }

  static async findByReferenceCode(code: string): Promise<IIncident | null> {
    try {
      return await IncidentModel.findOne({ referenceCode: code }).lean();
    } catch (err) {
      return null;
    }
  }

  static async findActive(limit = 100): Promise<IIncident[]> {
    try {
      return await IncidentModel
        .find({ status: { $nin: ['CLOSED', 'RESOLVED'] } })
        .sort({ severity: -1, createdAt: -1 })
        .limit(limit)
        .lean();
    } catch (err) {
      logger.error('[MongoDB] findActive failed:', err);
      return [];
    }
  }

  static async findAll(query: {
    status?: string | string[];
    severity?: string;
    type?: string;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ incidents: IIncident[]; total: number }> {
    try {
      const filter: Record<string, any> = {};

      if (query.status) {
        filter.status = Array.isArray(query.status)
          ? { $in: query.status }
          : query.status;
      }
      if (query.severity) filter.severity = query.severity;
      if (query.type)     filter.type     = query.type;
      if (query.from || query.to) {
        filter.createdAt = {};
        if (query.from) filter.createdAt.$gte = new Date(query.from);
        if (query.to)   filter.createdAt.$lte = new Date(query.to);
      }

      const page     = query.page ?? 1;
      const pageSize = query.pageSize ?? 20;
      const skip     = (page - 1) * pageSize;

      const [incidents, total] = await Promise.all([
        IncidentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
        IncidentModel.countDocuments(filter),
      ]);

      return { incidents, total };
    } catch (err) {
      logger.error('[MongoDB] findAll failed:', err);
      return { incidents: [], total: 0 };
    }
  }

  // ── Geospatial: find incidents near a location ────────────

  static async findNear(
    lat: number,
    lng: number,
    radiusKm: number,
    limit = 20,
  ): Promise<IIncident[]> {
    try {
      return await IncidentModel.find({
        location: {
          $near: {
            $geometry:    { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: radiusKm * 1000,
          },
        },
        status: { $nin: ['CLOSED', 'RESOLVED'] },
      }).limit(limit).lean();
    } catch (err) {
      logger.error('[MongoDB] findNear failed:', err);
      return [];
    }
  }

  // ── Full-text search ──────────────────────────────────────

  static async search(query: string, limit = 20): Promise<IIncident[]> {
    try {
      return await IncidentModel
        .find({ $text: { $search: query } }, { score: { $meta: 'textScore' } })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit)
        .lean();
    } catch (err) {
      logger.error('[MongoDB] search failed:', err);
      return [];
    }
  }

  // ── Update ────────────────────────────────────────────────

  static async update(incidentId: string, updates: Partial<IIncident>): Promise<IIncident | null> {
    try {
      return await IncidentModel.findOneAndUpdate(
        { incidentId },
        { $set: { ...updates, updatedAt: new Date() } },
        { new: true, lean: true },
      );
    } catch (err) {
      logger.error('[MongoDB] Incident update failed:', err);
      return null;
    }
  }

  static async updateStatus(incidentId: string, status: string): Promise<void> {
    try {
      await IncidentModel.updateOne(
        { incidentId },
        { $set: { status, updatedAt: new Date() } },
      );
    } catch (err) {
      logger.error('[MongoDB] updateStatus failed:', err);
    }
  }

  // ── Push to arrays ────────────────────────────────────────

  static async addDispatch(incidentId: string, dispatch: any): Promise<void> {
    try {
      await IncidentModel.updateOne(
        { incidentId },
        { $push: { dispatches: dispatch }, $set: { updatedAt: new Date() } },
      );
    } catch (err) {
      logger.error('[MongoDB] addDispatch failed:', err);
    }
  }

  static async addGuidanceMessage(incidentId: string, sessionId: string, message: any): Promise<void> {
    try {
      await IncidentModel.updateOne(
        { incidentId, 'guidanceSessions.sessionId': sessionId },
        { $push: { 'guidanceSessions.$.messages': message } },
      );
    } catch (err) {
      logger.error('[MongoDB] addGuidanceMessage failed:', err);
    }
  }

  static async addVerification(incidentId: string, verification: any): Promise<void> {
    try {
      await IncidentModel.updateOne(
        { incidentId },
        { $push: { verifications: verification, auditTrail: {
          action: 'VERIFICATION_ADDED',
          actorId: verification.verifiedBy,
          timestamp: new Date(),
          details: { method: verification.method },
        }}},
      );
    } catch (err) {
      logger.error('[MongoDB] addVerification failed:', err);
    }
  }

  static async addNote(incidentId: string, note: string, actorId?: string): Promise<void> {
    try {
      await IncidentModel.updateOne(
        { incidentId },
        {
          $push: {
            notes: note,
            auditTrail: { action: 'NOTE_ADDED', actorId, timestamp: new Date(), details: { note } },
          },
          $set: { updatedAt: new Date() },
        },
      );
    } catch (err) {
      logger.error('[MongoDB] addNote failed:', err);
    }
  }

  // ── Analytics ─────────────────────────────────────────────

  static async getStats(): Promise<Record<string, any>> {
    try {
      const [statusCounts, typeCounts, severityCounts, last24h] = await Promise.all([
        IncidentModel.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        IncidentModel.aggregate([{ $group: { _id: '$type',   count: { $sum: 1 } } }]),
        IncidentModel.aggregate([{ $group: { _id: '$severity', count: { $sum: 1 } } }]),
        IncidentModel.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } }),
      ]);

      return {
        byStatus:   Object.fromEntries(statusCounts.map(s => [s._id, s.count])),
        byType:     Object.fromEntries(typeCounts.map(t => [t._id, t.count])),
        bySeverity: Object.fromEntries(severityCounts.map(s => [s._id, s.count])),
        last24h,
      };
    } catch (err) {
      logger.error('[MongoDB] getStats failed:', err);
      return {};
    }
  }

  static async getHeatmapData(days = 7): Promise<any[]> {
    try {
      return await IncidentModel.aggregate([
        { $match: { createdAt: { $gte: new Date(Date.now() - days * 86400000) }, locationLat: { $ne: null } } },
        { $group: {
          _id: {
            lat: { $round: ['$locationLat', 2] },
            lng: { $round: ['$locationLng', 2] },
            type: '$type',
          },
          count: { $sum: 1 },
          avgSeverity: { $avg: {
            $switch: { branches: [
              { case: { $eq: ['$severity', 'CRITICAL'] }, then: 4 },
              { case: { $eq: ['$severity', 'HIGH'] },     then: 3 },
              { case: { $eq: ['$severity', 'MEDIUM'] },   then: 2 },
            ], default: 1 },
          }},
        }},
        { $project: {
          lat: '$_id.lat', lng: '$_id.lng', type: '$_id.type',
          count: 1, avgSeverity: 1, weight: '$count', _id: 0,
        }},
      ]);
    } catch (err) {
      logger.error('[MongoDB] getHeatmapData failed:', err);
      return [];
    }
  }
}
