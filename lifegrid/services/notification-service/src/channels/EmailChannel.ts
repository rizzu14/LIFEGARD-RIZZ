import axios from 'axios';
import { logger } from '../utils/logger';

const SENDGRID_KEY = process.env.SENDGRID_API_KEY ?? '';
const FROM_EMAIL   = process.env.FROM_EMAIL ?? 'alerts@lifegrid.gov';

export const EmailChannel = {
  async send(payload: any): Promise<void> {
    if (!SENDGRID_KEY || !payload.email) {
      logger.warn('[Email] SendGrid not configured or no email address');
      return;
    }

    await axios.post(
      'https://api.sendgrid.com/v3/mail/send',
      {
        personalizations: [{ to: [{ email: payload.email }] }],
        from: { email: FROM_EMAIL, name: 'LIFEGRID Emergency System' },
        subject: payload.title ?? 'LIFEGRID Emergency Alert',
        content: [{ type: 'text/plain', value: payload.body ?? '' }],
      },
      {
        headers: { Authorization: `Bearer ${SENDGRID_KEY}` },
        timeout: 10000,
      },
    );

    logger.info(`[Email] Sent to ${payload.email}: ${payload.title}`);
  },
};
