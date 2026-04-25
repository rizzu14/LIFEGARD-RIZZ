// ============================================================
// LIFEGRID – Kafka Topic Registry
// Single source of truth for all event bus topics
// ============================================================

export const TOPICS = {
  // ── Incident lifecycle ──────────────────────────────────────
  INCIDENT_TRIGGERED:    'lifegrid.incident.triggered',
  INCIDENT_CLASSIFIED:   'lifegrid.incident.classified',
  INCIDENT_DISPATCHED:   'lifegrid.incident.dispatched',
  INCIDENT_UPDATED:      'lifegrid.incident.updated',
  INCIDENT_CLOSED:       'lifegrid.incident.closed',
  INCIDENT_ESCALATED:    'lifegrid.incident.escalated',

  // ── AI processing ───────────────────────────────────────────
  AI_NLP_REQUEST:        'lifegrid.ai.nlp.request',
  AI_NLP_RESPONSE:       'lifegrid.ai.nlp.response',
  AI_DISPATCH_REQUEST:   'lifegrid.ai.dispatch.request',
  AI_DISPATCH_RESPONSE:  'lifegrid.ai.dispatch.response',
  AI_PREDICTION_RESULT:  'lifegrid.ai.prediction.result',

  // ── Dispatch ────────────────────────────────────────────────
  DISPATCH_COMMAND:      'lifegrid.dispatch.command',
  DISPATCH_ACK:          'lifegrid.dispatch.ack',
  DISPATCH_ARRIVED:      'lifegrid.dispatch.arrived',

  // ── Notifications ───────────────────────────────────────────
  NOTIFICATION_SMS:      'lifegrid.notification.sms',
  NOTIFICATION_PUSH:     'lifegrid.notification.push',
  NOTIFICATION_EMAIL:    'lifegrid.notification.email',
  NOTIFICATION_VOICE:    'lifegrid.notification.voice',
  NOTIFICATION_RADIO:    'lifegrid.notification.radio',
  NOTIFICATION_SATELLITE:'lifegrid.notification.satellite',

  // ── IoT / Sensors ───────────────────────────────────────────
  IOT_READING:           'lifegrid.iot.reading',
  IOT_ALERT:             'lifegrid.iot.alert',
  IOT_PANIC:             'lifegrid.iot.panic',

  // ── Satellite ───────────────────────────────────────────────
  SAT_NISAR_INGEST:      'lifegrid.satellite.nisar.ingest',
  SAT_INSAT_INGEST:      'lifegrid.satellite.insat.ingest',
  SAT_SENTINEL_INGEST:   'lifegrid.satellite.sentinel.ingest',
  SAT_PROCESSED:         'lifegrid.satellite.processed',
  SAT_ALERT:             'lifegrid.satellite.alert',

  // ── Responders ──────────────────────────────────────────────
  RESPONDER_LOCATION:    'lifegrid.responder.location',
  RESPONDER_STATUS:      'lifegrid.responder.status',

  // ── System ──────────────────────────────────────────────────
  SYSTEM_ALERT_LEVEL:    'lifegrid.system.alert_level',
  SYSTEM_HEALTH:         'lifegrid.system.health',
  AUDIT_EVENT:           'lifegrid.audit.event',
} as const;

export type TopicName = typeof TOPICS[keyof typeof TOPICS];

// ── Topic configuration (partitions, replication, retention) ──

export const TOPIC_CONFIG: Record<string, {
  partitions: number;
  replicationFactor: number;
  retentionMs: number;
  cleanupPolicy: 'delete' | 'compact';
}> = {
  [TOPICS.INCIDENT_TRIGGERED]:   { partitions: 12, replicationFactor: 3, retentionMs: 7 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.INCIDENT_CLASSIFIED]:  { partitions: 12, replicationFactor: 3, retentionMs: 7 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.INCIDENT_DISPATCHED]:  { partitions: 12, replicationFactor: 3, retentionMs: 7 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.INCIDENT_UPDATED]:     { partitions: 12, replicationFactor: 3, retentionMs: 7 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.INCIDENT_CLOSED]:      { partitions: 6,  replicationFactor: 3, retentionMs: 30 * 86400000, cleanupPolicy: 'delete' },
  [TOPICS.AI_NLP_REQUEST]:       { partitions: 8,  replicationFactor: 3, retentionMs: 1 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.AI_NLP_RESPONSE]:      { partitions: 8,  replicationFactor: 3, retentionMs: 1 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.AI_DISPATCH_REQUEST]:  { partitions: 8,  replicationFactor: 3, retentionMs: 1 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.AI_DISPATCH_RESPONSE]: { partitions: 8,  replicationFactor: 3, retentionMs: 1 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.DISPATCH_COMMAND]:     { partitions: 12, replicationFactor: 3, retentionMs: 3 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.NOTIFICATION_SMS]:     { partitions: 6,  replicationFactor: 3, retentionMs: 3 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.NOTIFICATION_PUSH]:    { partitions: 6,  replicationFactor: 3, retentionMs: 1 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.IOT_READING]:          { partitions: 24, replicationFactor: 3, retentionMs: 1 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.IOT_ALERT]:            { partitions: 12, replicationFactor: 3, retentionMs: 7 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.SAT_NISAR_INGEST]:     { partitions: 4,  replicationFactor: 3, retentionMs: 7 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.SAT_INSAT_INGEST]:     { partitions: 4,  replicationFactor: 3, retentionMs: 1 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.SAT_SENTINEL_INGEST]:  { partitions: 4,  replicationFactor: 3, retentionMs: 7 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.SAT_PROCESSED]:        { partitions: 4,  replicationFactor: 3, retentionMs: 30 * 86400000, cleanupPolicy: 'compact' },
  [TOPICS.SAT_ALERT]:            { partitions: 6,  replicationFactor: 3, retentionMs: 7 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.RESPONDER_LOCATION]:   { partitions: 24, replicationFactor: 3, retentionMs: 1 * 86400000,  cleanupPolicy: 'delete' },
  [TOPICS.AUDIT_EVENT]:          { partitions: 6,  replicationFactor: 3, retentionMs: 365 * 86400000, cleanupPolicy: 'delete' },
};
