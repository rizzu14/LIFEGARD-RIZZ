// ============================================================
// LIFEGRID – Radio Channel (P25/DMR Gateway)
// ============================================================

import axios from 'axios';
import { logger } from '../utils/logger';

const RADIO_GW_URL = process.env.RADIO_GATEWAY_URL ?? '';
const RADIO_GW_KEY = process.env.RADIO_GATEWAY_KEY ?? '';

export const RadioChannel = {
  async send(payload: any): Promise<void> {
    if (!RADIO_GW_URL) {
      logger.warn('[Radio] Gateway not configured, logging only');
      logger.info(`[Radio] Would transmit on ${payload.frequency ?? '155.340'}: ${payload.message}`);
      return;
    }

    await axios.post(
      `${RADIO_GW_URL}/transmit`,
      {
        frequency:  payload.frequency ?? '155.340',
        talkgroup:  payload.talkgroup ?? 'LIFEGRID_DISPATCH',
        message:    payload.message,
        responderId: payload.responderId,
        priority:   'EMERGENCY',
        tts:        true,  // Text-to-speech on radio
      },
      {
        headers: { 'X-Radio-Key': RADIO_GW_KEY },
        timeout: 5000,
      },
    );

    logger.info(`[Radio] Transmitted on ${payload.frequency}: "${payload.message?.slice(0, 60)}"`);
  },
};
