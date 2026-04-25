// ============================================================
// LIFEGRID – Satellite Notification Channel
// Iridium SBD (Short Burst Data) + Starlink terminal messaging
// ============================================================

import axios from 'axios';
import { logger } from '../utils/logger';

const IRIDIUM_URL  = process.env.IRIDIUM_GATEWAY_URL ?? '';
const IRIDIUM_KEY  = process.env.IRIDIUM_API_KEY ?? '';
const STARLINK_URL = process.env.STARLINK_GATEWAY_URL ?? '';
const STARLINK_KEY = process.env.STARLINK_API_KEY ?? '';

// Max SBD payload: 340 bytes
const MAX_SBD_BYTES = 340;

export const SatelliteChannel = {
  async send(payload: any): Promise<void> {
    const imei    = payload.imei ?? payload.deviceImei;
    const message = this.buildSBDMessage(payload);

    // Try Iridium first
    if (IRIDIUM_URL && IRIDIUM_KEY && imei) {
      try {
        await this.sendIridium(imei, message);
        logger.info(`[Satellite] Iridium SBD sent to IMEI ${imei}`);
        return;
      } catch (err) {
        logger.warn(`[Satellite] Iridium failed: ${err}, trying Starlink`);
      }
    }

    // Fallback to Starlink
    if (STARLINK_URL && STARLINK_KEY) {
      try {
        await this.sendStarlink(payload.terminalId, message);
        logger.info(`[Satellite] Starlink message sent to terminal ${payload.terminalId}`);
        return;
      } catch (err) {
        logger.warn(`[Satellite] Starlink failed: ${err}`);
      }
    }

    logger.warn('[Satellite] No satellite channel available');
  },

  buildSBDMessage(payload: any): Buffer {
    // Compact binary format for SBD (max 340 bytes)
    // Format: [type:1][priority:1][lat:4][lng:4][incidentId:16][message:variable]
    const type     = payload.type === 'DISPATCH' ? 0x01 : 0x02;
    const priority = payload.priority === 'EMERGENCY' ? 0xFF : 0x80;
    const lat      = Math.round((payload.data?.location?.lat ?? 0) * 1e6);
    const lng      = Math.round((payload.data?.location?.lng ?? 0) * 1e6);
    const msgText  = (payload.body ?? '').slice(0, 300);

    const buf = Buffer.alloc(10 + msgText.length);
    buf.writeUInt8(type, 0);
    buf.writeUInt8(priority, 1);
    buf.writeInt32BE(lat, 2);
    buf.writeInt32BE(lng, 6);
    buf.write(msgText, 10, 'utf8');

    return buf.subarray(0, Math.min(buf.length, MAX_SBD_BYTES));
  },

  async sendIridium(imei: string, data: Buffer): Promise<void> {
    await axios.post(
      `${IRIDIUM_URL}/send`,
      {
        imei,
        data: data.toString('base64'),
        flush_mt_queue: true,
      },
      {
        headers: { 'Authorization': `Bearer ${IRIDIUM_KEY}` },
        timeout: 15000,
      },
    );
  },

  async sendStarlink(terminalId: string, data: Buffer): Promise<void> {
    await axios.post(
      `${STARLINK_URL}/terminals/${terminalId}/messages`,
      { payload: data.toString('base64'), priority: 'HIGH' },
      {
        headers: { 'Authorization': `Bearer ${STARLINK_KEY}` },
        timeout: 15000,
      },
    );
  },
};
