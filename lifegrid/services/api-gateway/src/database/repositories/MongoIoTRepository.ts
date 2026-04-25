// ============================================================
// LIFEGRID – MongoDB IoT Repository
// ============================================================

import { IoTDeviceModel, IoTReadingModel, IIoTDevice, IIoTReading } from '../schemas/IoTSchema';
import { logger } from '../../utils/logger';

export class MongoIoTRepository {

  // ── Devices ───────────────────────────────────────────────

  static async upsertDevice(data: Partial<IIoTDevice>): Promise<void> {
    try {
      await IoTDeviceModel.findOneAndUpdate(
        { deviceId: data.deviceId },
        { $set: { ...data, lastSeen: new Date() } },
        { upsert: true },
      );
    } catch (err) {
      logger.error('[MongoDB] IoT upsertDevice failed:', err);
    }
  }

  static async findDevicesNear(lat: number, lng: number, radiusKm: number): Promise<IIoTDevice[]> {
    try {
      return await IoTDeviceModel.find({
        isActive: true,
        location: {
          $near: {
            $geometry:    { type: 'Point', coordinates: [lng, lat] },
            $maxDistance: radiusKm * 1000,
          },
        },
      }).limit(50).lean();
    } catch (err) {
      return [];
    }
  }

  // ── Readings ──────────────────────────────────────────────

  static async saveReading(data: Partial<IIoTReading>): Promise<void> {
    try {
      await IoTReadingModel.create(data);
    } catch (err) {
      logger.error('[MongoDB] IoT saveReading failed:', err);
    }
  }

  static async saveBatchReadings(readings: Partial<IIoTReading>[]): Promise<void> {
    try {
      await IoTReadingModel.insertMany(readings, { ordered: false });
    } catch (err) {
      logger.error('[MongoDB] IoT saveBatchReadings failed:', err);
    }
  }

  static async getRecentReadings(deviceId: string, limit = 100): Promise<IIoTReading[]> {
    try {
      return await IoTReadingModel
        .find({ deviceId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
    } catch (err) {
      return [];
    }
  }

  static async getAlerts(hours = 24): Promise<IIoTReading[]> {
    try {
      return await IoTReadingModel
        .find({
          isAlert: true,
          timestamp: { $gte: new Date(Date.now() - hours * 3600000) },
        })
        .sort({ timestamp: -1 })
        .limit(200)
        .lean();
    } catch (err) {
      return [];
    }
  }

  // Time-series aggregation: readings per hour for a device
  static async getTimeSeries(
    deviceId: string,
    metric: string,
    hours = 24,
  ): Promise<any[]> {
    try {
      return await IoTReadingModel.aggregate([
        {
          $match: {
            deviceId,
            timestamp: { $gte: new Date(Date.now() - hours * 3600000) },
            'readings.metric': metric,
          },
        },
        { $unwind: '$readings' },
        { $match: { 'readings.metric': metric } },
        {
          $group: {
            _id: {
              hour: { $dateToString: { format: '%Y-%m-%dT%H:00', date: '$timestamp' } },
            },
            avgValue: { $avg: '$readings.value' },
            maxValue: { $max: '$readings.value' },
            minValue: { $min: '$readings.value' },
            count:    { $sum: 1 },
          },
        },
        { $sort: { '_id.hour': 1 } },
      ]);
    } catch (err) {
      return [];
    }
  }
}
