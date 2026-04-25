import axios from 'axios';
import { logger } from '../utils/logger';

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID ?? '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN ?? '';
const TWILIO_FROM  = process.env.TWILIO_FROM_NUMBER ?? '';

export const VoiceChannel = {
  async send(payload: any): Promise<void> {
    if (!TWILIO_SID || !payload.phone) {
      logger.warn('[Voice] Twilio not configured or no phone number');
      return;
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="${payload.language ?? 'en-US'}">
    ${payload.body ?? payload.title ?? 'LIFEGRID Emergency Alert'}
  </Say>
  <Pause length="1"/>
  <Say voice="alice">Press 1 to confirm receipt.</Say>
  <Gather numDigits="1" action="/voice/confirm" method="POST">
    <Pause length="5"/>
  </Gather>
</Response>`;

    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`,
      new URLSearchParams({
        To:   payload.phone,
        From: TWILIO_FROM,
        Twiml: twiml,
      }),
      {
        auth: { username: TWILIO_SID, password: TWILIO_TOKEN },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 10000,
      },
    );

    logger.info(`[Voice] Call initiated to ${payload.phone}`);
  },
};
