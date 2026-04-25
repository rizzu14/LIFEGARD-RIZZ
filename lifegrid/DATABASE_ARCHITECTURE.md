# LIFEGRID – Database Architecture
## PostgreSQL + MongoDB Hybrid

---

## Why Both Databases?

| Concern | PostgreSQL | MongoDB |
|---------|-----------|---------|
| Structured relational data | ✅ Primary | — |
| ACID transactions | ✅ Full support | ✅ Multi-doc |
| Geospatial queries | ✅ PostGIS | ✅ 2dsphere |
| Flexible document storage | ❌ JSONB (limited) | ✅ Native |
| Time-series IoT data | ❌ Partitioned tables | ✅ TTL indexes |
| Full-text search | ✅ pg_trgm | ✅ Text indexes |
| Aggregation pipelines | ✅ SQL | ✅ Faster for complex |
| Schema evolution | ❌ Migrations needed | ✅ Schemaless |
| Embedded sub-documents | ❌ Joins required | ✅ Native |
| Horizontal sharding | ❌ Complex | ✅ Built-in |

**Rule:** PostgreSQL = source of truth for critical structured data. MongoDB = fast reads, flexible documents, time-series, analytics.

---

## Data Distribution

```
PostgreSQL (Relational — Source of Truth)
├── users                    Auth, roles, permissions
├── incidents                Core incident records (normalized)
├── dispatches               Dispatch records
├── routes                   Route optimization results
├── guidance_sessions        Session metadata
├── guidance_messages        Individual messages
├── verifications            Closure verification records
├── responders               Responder profiles + location
├── responder_units          Vehicle/unit records
├── stations                 Emergency service stations
├── iot_devices              Device registry
├── iot_readings             Sensor readings (partitioned)
├── audit_log                Immutable audit trail (partitioned)
├── consent_records          GDPR consent
├── erasure_requests         GDPR right to erasure
├── breach_register          GDPR breach notifications
├── security_events          Security event log (partitioned)
├── api_keys                 API key hashes
├── witness_protection       Identity protection records
└── system_config            Runtime configuration

MongoDB (Document Store — Fast Reads + Flexibility)
├── incidents                Full denormalized incident documents
│   ├── nlpAnalysis          Embedded NLP results
│   ├── aiDecision           Embedded AI decision history
│   ├── dispatches[]         Embedded dispatch records
│   ├── guidanceSessions[]   Embedded sessions + messages
│   ├── verifications[]      Embedded verification records
│   └── auditTrail[]         Per-incident audit log
├── responders               Real-time responder state + location history
├── iot_devices              Device registry with metadata
├── iot_readings             Time-series sensor data (TTL: 1 year)
├── users                    User profiles + preferences + device tokens
├── safety_alerts            Active safety alerts (geospatial)
└── notification_logs        Delivery tracking (TTL: 90 days)
```

---

## MongoDB Collections Detail

### incidents
```javascript
{
  incidentId:    "uuid",           // Links to PostgreSQL
  referenceCode: "INC-20260425-001234",
  status:        "DISPATCHED",
  severity:      "HIGH",
  type:          "MEDICAL",
  location: { type: "Point", coordinates: [lng, lat] },  // GeoJSON
  trigger: {
    source:   "MOBILE_APP",
    rawInput: "I need medical help...",
    language: "en",
    timestamp: ISODate,
  },
  nlpAnalysis: {                   // Embedded — no join needed
    classifiedType: "MEDICAL",
    sentiment: "PANIC",
    urgencyScore: 0.87,
    entities: [{ type: "LOCATION", value: "5th Ave" }],
  },
  aiDecision: {                    // Embedded AI decision
    riskScore: 78,
    recommendedResponders: [...],
    escalationRequired: false,
  },
  dispatches: [                    // Embedded — no join needed
    { responderId: "...", dispatchedAt: ISODate, etaSeconds: 420 }
  ],
  guidanceSessions: [              // Full conversation embedded
    {
      sessionId: "...",
      language: "en",
      messages: [
        { role: "SYSTEM", content: "Help is on the way...", timestamp: ISODate },
        { role: "CITIZEN", content: "I cannot move", timestamp: ISODate },
      ]
    }
  ],
  auditTrail: [                    // Per-incident audit
    { action: "INCIDENT_CREATED", timestamp: ISODate },
    { action: "STATUS_CHANGED", details: { from: "TRIGGERED", to: "DISPATCHED" } },
  ]
}
```

### responders
```javascript
{
  responderId: "uuid",
  type: "AMBULANCE",
  status: "EN_ROUTE",
  currentLocation: { type: "Point", coordinates: [lng, lat] },
  locationHistory: [               // Rolling 24h, capped at 1440 entries
    { coordinates: [lng, lat], timestamp: ISODate, speed: 65, heading: 180 }
  ],
  performanceMetrics: {
    avgResponseTimeSeconds: 420,
    totalDispatches: 847,
    successRate: 0.96,
  }
}
```

### iot_readings (Time-Series)
```javascript
{
  deviceId:   "sensor-flood-001",
  deviceType: "FLOOD",
  location:   { type: "Point", coordinates: [lng, lat] },
  readings: [
    { metric: "water_level_cm", value: 142, unit: "cm", threshold: 100, isAnomalous: true }
  ],
  timestamp: ISODate,              // TTL index: auto-delete after 1 year
  isAlert: true,
  incidentId: "uuid"
}
```

---

## Indexes

### MongoDB Geospatial Indexes
```javascript
// Find incidents near a location
db.incidents.createIndex({ location: '2dsphere' })
// → db.incidents.find({ location: { $near: { $geometry: {type:'Point', coordinates:[lng,lat]}, $maxDistance: 5000 } } })

// Find available responders near incident
db.responders.createIndex({ currentLocation: '2dsphere' })
// → db.responders.find({ currentLocation: { $near: ... }, isAvailable: true })

// Find IoT devices in an area
db.iot_devices.createIndex({ location: '2dsphere' })
```

### MongoDB TTL Indexes (Auto-cleanup)
```javascript
// IoT readings: delete after 1 year
db.iot_readings.createIndex({ timestamp: 1 }, { expireAfterSeconds: 31536000 })

// Notification logs: delete after 90 days
db.notification_logs.createIndex({ createdAt: 1 }, { expireAfterSeconds: 7776000 })

// Closed incidents: delete after 7 years
db.incidents.createIndex({ closedAt: 1 }, {
  expireAfterSeconds: 220752000,
  partialFilterExpression: { status: 'CLOSED' }
})
```

### MongoDB Text Indexes (Full-text search)
```javascript
db.incidents.createIndex({ 'trigger.rawInput': 'text', notes: 'text' })
// → db.incidents.find({ $text: { $search: "cardiac arrest downtown" } })
```

---

## Connection Configuration

### Environment Variables
```bash
# PostgreSQL
DATABASE_URL=postgresql://lifegrid:lifegrid@localhost:5432/lifegrid

# MongoDB
MONGODB_URI=mongodb://lifegrid:lifegrid@localhost:27017/lifegrid?authSource=admin

# MongoDB Atlas (production)
MONGODB_URI=mongodb+srv://lifegrid:<password>@cluster0.xxxxx.mongodb.net/lifegrid?retryWrites=true&w=majority
```

### Connection Pools
| Database | Pool Size | Timeout |
|----------|-----------|---------|
| PostgreSQL (write) | 20 | 5s |
| PostgreSQL (read) | 100 | 5s |
| MongoDB | 20 (min 5) | 10s |
| Redis | 10 | 5s |

---

## Write Strategy (Dual-Write)

```
Incident Created
      │
      ├──► PostgreSQL (primary, synchronous)
      │    → incidents table (normalized)
      │    → ACID transaction
      │
      └──► MongoDB (secondary, async, non-blocking)
           → incidents collection (denormalized)
           → Embedded sub-documents
           → Geospatial index updated

If MongoDB write fails:
  → Log warning
  → Continue (PostgreSQL is source of truth)
  → Retry via background job
```

---

## Read Strategy

```
API Request: GET /incidents/:id
      │
      ├──► Try MongoDB first (faster, denormalized)
      │    → Single document read, no joins
      │    → Returns in ~2ms
      │
      └──► Fall back to PostgreSQL if MongoDB unavailable
           → JOIN across 5 tables
           → Returns in ~15ms

API Request: GET /analytics/heatmap
      │
      └──► MongoDB aggregation pipeline
           → $group by lat/lng cell
           → $project weight and type
           → Returns in ~50ms (vs ~500ms in PostgreSQL)
```

---

## MongoDB Atlas Setup (Production)

1. Go to **https://cloud.mongodb.com** → Create free cluster (M0)
2. Create database user: `lifegrid` / strong password
3. Whitelist IP: `0.0.0.0/0` (or specific server IPs)
4. Get connection string → set `MONGODB_URI` in environment
5. Enable: Backup, Monitoring, Performance Advisor

**Free tier limits (M0):**
- 512MB storage
- Shared RAM
- No dedicated ops
- Good for development/demo

**Production (M10+):**
- Dedicated cluster
- 10GB+ storage
- Automated backups
- Global clusters for multi-region
