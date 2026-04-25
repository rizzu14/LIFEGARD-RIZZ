// ============================================================
// LIFEGRID – Push Notification Channel (FCM)
// ============================================================

import axios from 'axios';
import { logger } from '../utils/logger';

const FCM_URL        = 'https://fcm.googleapis.com/v1/projects/{PROJECT_ID}/messages:send';
const FCM_SERVER_KEY = process.env.FCM_SERVER_KEY ?? '';
const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID ?? 'lifegrid';

export const PushChannel = {
  async send(payload: any): Promise<void> {
    if (!FCM_SERVER_KEY) {
      logger.warn('[Push] FCM not configured, skipping');
      return;
    }

    const fcmToken = payload.fcmToken ?? payload.deviceToken;
    if (!fcmToken) {
      logger.warn('[Push] No FCM token in payload');
      return;
    }

    const url = FCM_URL.replace('{PROJECT_ID}', FCM_PROJECT_ID);

    const message = {
      message: {
        token: fcmToken,
        notification: {
          title: payload.title ?? 'LIFEGRID Alert',
          body:  payload.body  ?? '',
        },
        data: Object.fromEntries(
          Object.entries(payload.data ?? {}).map(([k, v]) => [k, String(v)])
        ),
        android: {
          priority: payload.priority === 'EMERGENCY' ? 'HIGH' : 'NORMAL',
          notification: {
            sound:       'emergency_alert',
            channelId:   'lifegrid_emergency',
            priority:    'MAX',
            visibility:  'PUBLIC',
          },
        },
        apns: {
          headers: { 'apns-priority': payload.priority === 'EMERGENCY' ? '10' : '5' },
          payload: {
            aps: {
              sound:            'emergency_alert.caf',
              badge:            1,
              contentAvailable: 1,
            },
          },
        },
      },
    };

    await axios.post(url, message, {
      headers: {
        Authorization: `Bearer ${FCM_SERVER_KEY}`,
        'Content-Type': 'application/json',
      },
      timeout: 8000,
    });

    logger.info(`[Push] Sent to ${fcmToken.slice(0, 12)}...: ${payload.title}`);
  },
};
