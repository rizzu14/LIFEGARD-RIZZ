// ============================================================
// LIFEGRID – Dispatch Service
// Port: 4003
//
// Consumes: lifegrid.dispatch.command
// Produces: lifegrid.dispatch.ack
//           lifegrid.notification.push
//           lifegrid.notification.radio
//           lifegrid.notification.satellite
//           lifegrid.incident.updated
//
// Responsibilities:
//   - Create AES-256-GCM encrypted dispatch channels
//   - Compute optimized routes (OSRM)
//   - Send dispatch commands to responders (multi-channel)
//   - Track acknowledgements
//   - Update responder status in DB
// ============================================================

import 'dotenv/config';
import express from 'express';
import { KafkaClient, KafkaEnvelope } from '../../event-bus/src/KafkaClient';
import { TOPICS } from '../../event-bus/src/topics';
import { EncryptionService } from './security/EncryptionService';
import { RouteOptimizer } from './routing/RouteOptimizer';
import { DispatchDB } from './db/DispatchDB';
import { logger } from './utils/logger';
import { v4 as uuidv4 } from 'uuid';

const PORT = parseInt(process.env.PORT ?? '4003', 10);
const GROUP_ID = 'lifegrid-dispatch-service';

// ── Dispatch command processor ────────────────────────────────

async function processDispatchCommand(envelope: KafkaEnvelope<any>): Promise<void> {
  const cmd = envelope.payload;
  const { incidentId, referenceCode, location, type, severity, responders } = cmd;

  logger.info(`[Dispatch] Processing command for incident ${incidentId} (${severity})`);

  const dispatches: any[] = [];
  const routes: any[] = [];

  // Process each recommended responder
  for (const rec of (responders ?? []).slice(0, 5)) {
    const dispatchId = uuidv4();

    // Create encrypted channel
    const channel = await EncryptionService.createSecureChannel(incidentId, rec.responder_id);

    // Compute optimized route
    let route: any = null;
    try {
      const responderLocation = await DispatchDB.getResponderLocation(rec.responder_id);
      if (responderLocation) {
        route = await RouteOptimizer.optimize({
          origin:      responderLocation,
          destination: location,
          severity,
          incidentType: type,
        });
        route.routeId     = uuidv4();
        route.responderId = rec.responder_id;
        routes.push(route);
      }
    } catch (err) {
      logger.warn(`[Dispatch] Route optimization failed for ${rec.responder_id}: ${err}`);
    }

    const dispatch = {
      dispatchId,
      incidentId,
      responderId:      rec.responder_id,
      responderType:    rec.responder_type,
      dispatchedAt:     new Date().toISOString(),
      encryptedChannel: channel.channelId,
      encryptedKey:     channel.encryptedKey,
      routeId:          route?.routeId ?? null,
      estimatedArrival: new Date(Date.now() + (rec.eta_seconds ?? 300) * 1000).toISOString(),
      priority:         rec.priority,
    };

    dispatches.push(dispatch);

    // Persist dispatch record
    await DispatchDB.createDispatch(dispatch);

    // Update responder status
    await DispatchDB.updateResponderStatus(rec.responder_id, 'DISPATCHED', incidentId);

    // Publish push notification to responder device
    await KafkaClient.publish(TOPICS.NOTIFICATION_PUSH, {
      recipientId:   rec.responder_id,
      recipientType: 'RESPONDER',
      title:         `DISPATCH: ${type.replace('_', ' ')} – ${severity}`,
      body:          `Incident ${referenceCode}. ETA: ${Math.round((rec.eta_seconds ?? 300) / 60)}min`,
      data: {
        incidentId,
        referenceCode,
        location,
        type,
        severity,
        channelId:    channel.channelId,
        encryptedKey: channel.encryptedKey,
        route:        route ?? null,
      },
      priority: severity === 'CRITICAL' ? 'EMERGENCY' : 'HIGH',
    }, {
      key: rec.responder_id,
      sourceService: 'dispatch-service',
      metadata: { incidentId },
    });

    // For CRITICAL: also send via radio/satellite backup
    if (severity === 'CRITICAL') {
      await KafkaClient.publish(TOPICS.NOTIFICATION_RADIO, {
        responderId: rec.responder_id,
        message:     `PRIORITY DISPATCH: ${type} at ${location.lat.toFixed(4)},${location.lng.toFixed(4)}. Incident ${referenceCode}.`,
        incidentId,
        frequency:   process.env.RADIO_FREQUENCY ?? '155.340',
      }, {
        key: rec.responder_id,
        sourceService: 'dispatch-service',
        metadata: { incidentId },
      });
    }
  }

  // Publish dispatch acknowledgement
  await KafkaClient.publish(TOPICS.DISPATCH_ACK, {
    incidentId,
    referenceCode,
    dispatches,
    routes,
    dispatchedAt: new Date().toISOString(),
    responderCount: dispatches.length,
  }, {
    key: incidentId,
    correlationId: envelope.correlationId,
    sourceService: 'dispatch-service',
    metadata: { incidentId },
  });

  // Update incident with dispatch records
  await KafkaClient.publish(TOPICS.INCIDENT_UPDATED, {
    incidentId,
    status:    'DISPATCHED',
    dispatches,
    routes,
    updatedAt: new Date().toISOString(),
  }, {
    key: incidentId,
    sourceService: 'dispatch-service',
    metadata: { incidentId },
  });

  logger.info(`[Dispatch] ✅ ${dispatches.length} units dispatched for ${incidentId}`);
}

// ── Bootstrap ─────────────────────────────────────────────────

async function bootstrap() {
  logger.info('🚀 Dispatch Service starting...');

  KafkaClient.initialize();

  const app = express();
  app.get('/health', (_req, res) => res.json({ status: 'operational', service: 'dispatch' }));
  app.listen(PORT, () => logger.info(`✅ Dispatch Service health on port ${PORT}`));

  await KafkaClient.subscribe<any>(
    GROUP_ID,
    [TOPICS.DISPATCH_COMMAND],
    processDispatchCommand,
    { maxRetries: 3, sendToDLQ: true },
  );

  logger.info(`✅ Dispatch Service consuming ${TOPICS.DISPATCH_COMMAND}`);

  process.on('SIGTERM', async () => {
    await KafkaClient.disconnect();
    process.exit(0);
  });
}

bootstrap().catch(err => { console.error('Fatal:', err); process.exit(1); });
