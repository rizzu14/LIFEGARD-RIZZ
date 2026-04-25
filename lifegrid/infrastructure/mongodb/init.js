// ============================================================
// LIFEGRID – MongoDB Initialization Script
// Creates database, user, and indexes on first startup
// ============================================================

// Switch to lifegrid database
db = db.getSiblingDB('lifegrid');

// Create application user with readWrite access
db.createUser({
  user: 'lifegrid',
  pwd:  'lifegrid',
  roles: [{ role: 'readWrite', db: 'lifegrid' }],
});

// ── Create collections with validation ───────────────────────

db.createCollection('incidents', {
  validator: {
    $jsonSchema: {
      bsonType: 'object',
      required: ['incidentId', 'referenceCode', 'status', 'severity', 'type'],
      properties: {
        incidentId:    { bsonType: 'string' },
        referenceCode: { bsonType: 'string' },
        status:        { bsonType: 'string', enum: ['TRIGGERED','CLASSIFIED','DISPATCHED','EN_ROUTE','ON_SCENE','RESOLVED','CLOSED','ESCALATED'] },
        severity:      { bsonType: 'string', enum: ['CRITICAL','HIGH','MEDIUM','LOW'] },
        type:          { bsonType: 'string' },
      },
    },
  },
  validationAction: 'warn',  // Warn but don't reject — resilience over strictness
});

db.createCollection('responders');
db.createCollection('iot_devices');
db.createCollection('iot_readings');
db.createCollection('users');
db.createCollection('safety_alerts');
db.createCollection('notification_logs');

// ── Create indexes ────────────────────────────────────────────

// Incidents
db.incidents.createIndex({ incidentId: 1 },    { unique: true });
db.incidents.createIndex({ referenceCode: 1 },  { unique: true });
db.incidents.createIndex({ status: 1, severity: 1, createdAt: -1 });
db.incidents.createIndex({ location: '2dsphere' });
db.incidents.createIndex({ 'trigger.rawInput': 'text', notes: 'text' });

// Responders
db.responders.createIndex({ responderId: 1 },   { unique: true });
db.responders.createIndex({ currentLocation: '2dsphere' });
db.responders.createIndex({ isAvailable: 1, type: 1, status: 1 });

// IoT
db.iot_devices.createIndex({ deviceId: 1 },     { unique: true });
db.iot_devices.createIndex({ location: '2dsphere' });
db.iot_readings.createIndex({ deviceId: 1, timestamp: -1 });
db.iot_readings.createIndex({ timestamp: 1 },   { expireAfterSeconds: 31536000 }); // 1 year TTL

// Users
db.users.createIndex({ userId: 1 },             { unique: true });
db.users.createIndex({ email: 1 },              { unique: true });

// Alerts
db.safety_alerts.createIndex({ alertId: 1 },    { unique: true });
db.safety_alerts.createIndex({ isActive: 1, severity: 1, createdAt: -1 });
db.safety_alerts.createIndex({ location: '2dsphere' });

// Notifications
db.notification_logs.createIndex({ recipientId: 1, createdAt: -1 });
db.notification_logs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days TTL

print('✅ LIFEGRID MongoDB initialized successfully');
print('   Collections: incidents, responders, iot_devices, iot_readings, users, safety_alerts, notification_logs');
