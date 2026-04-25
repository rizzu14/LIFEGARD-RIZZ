// ============================================================
// LIFEGRID – MongoDB Responder Repository
// ============================================================

import { ResponderModel, IResponder } from '../schemas/ResponderSchema';
import { logger } from '../../utils/logger';

export class MongoResponderRepository {

  static async upsert(data: Partial<IResponder>): Promise<IResponder | null> {
    try {
      return await ResponderModel.findOneAndUpdate(
        { responderId: data.responderId },
        { $set: data },
        { upsert: true, new: true, lean: true },
      );
    } catch (err) {
      logger.error('[MongoDB] Responder upsert failed:', err);
      return null;
    }
  }

  static async findById(responderId: string): Promise<IResponder | null> {
    try {
      return await ResponderModel.findOne({ responderId }).lean();
    } catch (err) {
      return null;
    }
  }

  static async findAll(): Promise<IResponder[]> {
    try {
      return await ResponderModel.find().sort({ type: 1, status: 1 }).lean();
    } catch (err) {
      return [];
    }
  }

  // Find available responders near a location
  static async findAvailableNear(
    lat: number,
    lng: number,
    radiusKm: number,
    type?: string,
  ): Promise<IResponder[]> {
    try {
      const filter: Record<string, any> = {
        isAvailable: true,
        status: 'AVAILABLE',
        currentLocation: {
          $near: {
            $geometry:    { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: radiusKm * 1000,
          },
        },
      };
      if (type) filter.type = type;

      return await ResponderModel.find(filter).limit(20).lean();
    } catch (err) {
      logger.error('[MongoDB] findAvailableNear failed:', err);
      return [];
    }
  }

  // Update location and append to history
  static async updateLocation(
    responderId: string,
    lat: number,
    lng: number,
    speed?: number,
    heading?: number,
  ): Promise<void> {
    try {
      await ResponderModel.updateOne(
        { responderId },
        {
          $set: {
            currentLocation: { type: 'Point', coordinates: [lng, lat] },
            lastLocationUpdate: new Date(),
          },
          // Keep last 1440 location history entries (24h at 1/min)
          $push: {
            locationHistory: {
              $each: [{ coordinates: [lng, lat], timestamp: new Date(), speed, heading }],
              $slice: -1440,
            },
          },
        },
      );
    } catch (err) {
      logger.error('[MongoDB] updateLocation failed:', err);
    }
  }

  static async updateStatus(
    responderId: string,
    status: string,
    incidentId?: string,
  ): Promise<void> {
    try {
      await ResponderModel.updateOne(
        { responderId },
        {
          $set: {
            status,
            isAvailable: status === 'AVAILABLE',
            currentIncidentId: incidentId ?? null,
            updatedAt: new Date(),
          },
        },
      );
    } catch (err) {
      logger.error('[MongoDB] updateStatus failed:', err);
    }
  }

  // Update performance metrics after incident resolution
  static async updatePerformance(
    responderId: string,
    responseTimeSeconds: number,
    success: boolean,
  ): Promise<void> {
    try {
      const responder = await ResponderModel.findOne({ responderId });
      if (!responder) return;

      const metrics = responder.performanceMetrics;
      const total   = metrics.totalDispatches + 1;
      const newAvg  = (metrics.avgResponseTimeSeconds * metrics.totalDispatches + responseTimeSeconds) / total;
      const newRate = (metrics.successRate * metrics.totalDispatches + (success ? 1 : 0)) / total;

      await ResponderModel.updateOne(
        { responderId },
        {
          $set: {
            'performanceMetrics.avgResponseTimeSeconds': Math.round(newAvg),
            'performanceMetrics.totalDispatches':        total,
            'performanceMetrics.successRate':            Math.round(newRate * 1000) / 1000,
            'performanceMetrics.lastUpdated':            new Date(),
          },
        },
      );
    } catch (err) {
      logger.error('[MongoDB] updatePerformance failed:', err);
    }
  }
}
