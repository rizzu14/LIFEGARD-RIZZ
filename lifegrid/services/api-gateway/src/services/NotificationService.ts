import { WebSocketManager } from '../websocket/WebSocketManager';
import { logger } from '../utils/logger';
import type { Incident, RouteOptimization } from '@lifegrid/shared-types';

export class NotificationService {
  static async dispatchResponder(responderId: string, payload: unknown): Promise<void> {
    // Push via WebSocket to responder's device
    WebSocketManager.sendToUser(responderId, 'DISPATCH_SENT', payload);

    // In production: also send via push notification (FCM/APNs), SMS, radio
    logger.info(`[Notification] Dispatch sent to responder ${responderId}`);
  }

  static async sendRoute(responderId: string, route: RouteOptimization): Promise<void> {
    WebSocketManager.sendToUser(responderId, 'INCIDENT_UPDATED', { route });
    logger.info(`[Notification] Route sent to responder ${responderId}`);
  }

  static async notifyCommanders(incident: Incident): Promise<void> {
    WebSocketManager.broadcastToCommandCenter('INCIDENT_UPDATED', {
      ...incident,
      _escalated: true,
    });
    logger.warn(`[Notification] Commanders notified of escalation: ${incident.referenceCode}`);
  }

  static async sendSMS(phone: string, message: string): Promise<void> {
    // In production: integrate Twilio/AWS SNS
    logger.info(`[Notification] SMS to ${phone}: ${message.slice(0, 50)}...`);
  }

  static async sendPushNotification(userId: string, title: string, body: string): Promise<void> {
    // In production: integrate FCM/APNs
    logger.info(`[Notification] Push to ${userId}: ${title}`);
  }
}
