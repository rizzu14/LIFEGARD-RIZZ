// ============================================================
// LIFEGRID – SMS Channel (Twilio)
// ============================================================

import axios from 'axios';
import { logger } from '../utils/logger';

const TWILIO_SID    = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_TOKEN  = process.env.TWILIO_AUTH_TOKEN ?? '';
const TWILIO_FROM   = process.env.TWILIO_FROM_NUMBER ?? '';
const TWILIO_URL    = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`;

// SMS templates per notification type
const TEMPLATES: Record<string, (p: any) => string> = {
  DISPATCH: (p) =>
    `LIFEGRID DISPATCH: ${p.title}. Incident ${p.data?.referenceCode ?? ''}. ` +
    `Location: ${p.data?.location?.lat?.toFixed(4)},${p.data?.location?.lng?.toFixed(4)}. ` +
    `ETA: ${p.data?.eta ?? 'N/A'}min. Reply ARRIVED when on scene.`,

  ALERT: (p) =>
    `LIFEGRID ALERT: ${p.body}. Ref: ${p.data?.referenceCode ?? ''}`,

  GUIDANCE: (p) =>
    `LIFEGRID: ${p.body}`,
};

export const SMSChannel = {
  async send(payload: any): Promise<void> {
    if (!TWILIO_SID || !TWILIO_TOKEN) {
      logger.warn('[SMS] Twilio credentials not configured, skipping');
      return;
    }

    const phone = payload.phone ?? payload.callerPhone ?? payload.recipientPhone;
    if (!phone) {
      logger.warn('[SMS] No phone number in payload');
      return;
    }

    const templateFn = TEMPLATES[payload.type ?? 'ALERT'] ?? TEMPLATES.ALERT;
    const body = templateFn(payload);

    await axios.post(
      TWILIO_URL,
      new URLSearchParams({ To: phone, From: TWILIO_FROM, Body: body }),
      {
        auth: { username: TWILIO_SID, password: TWILIO_TOKEN },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      },
    );

    logger.info(`[SMS] Sent to ${phone}: "${body.slice(0, 60)}..."`);
  },
};
