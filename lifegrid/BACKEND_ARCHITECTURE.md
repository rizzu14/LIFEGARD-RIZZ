# LIFEGRID – Backend Architecture
## Microservices · Event-Driven · Real-Time · Satellite-Integrated

---

## Full System Architecture

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                         LIFEGRID BACKEND PLATFORM                              ║
╠══════════════════════════════════════════════════════════════════════════════════╣
║                                                                                  ║
║  INPUT SOURCES                                                                   ║
║  ┌──────┐ ┌─────┐ ┌──────────┐ ┌───────┐ ┌──────────┐ ┌──────┐ ┌──────────┐  ║
║  │Voice │ │ SMS │ │Mobile App│ │Panic  │ │IoT/MQTT  │ │CCTV  │ │Satellite │  ║
║  │Twilio│ │Twil.│ │REST/WS   │ │Button │ │Sensors   │ │Video │ │Iridium   │  ║
║  └──┬───┘ └──┬──┘ └────┬─────┘ └───┬───┘ └────┬─────┘ └──┬───┘ └────┬─────┘  ║
║     └────────┴──────────┴───────────┴──────────┴──────────┴──────────┘         ║
║                                    │                                             ║
║                          ┌─────────▼──────────┐                                 ║
║                          │  INGESTION SERVICE  │  Port 4001                     ║
║                          │  Normalize · Dedup  │                                 ║
║                          │  Validate · Enrich  │                                 ║
║                          │  RedundancyManager  │                                 ║
║                          └─────────┬──────────┘                                 ║
║                                    │                                             ║
║  ╔═════════════════════════════════▼═══════════════════════════════════════╗    ║
║  ║                    KAFKA EVENT BUS (3-broker cluster)                   ║    ║
║  ║  Replication: 3 · Min ISR: 2 · Compression: LZ4 · Idempotent producer  ║    ║
║  ║                                                                         ║    ║
║  ║  lifegrid.incident.triggered    lifegrid.dispatch.command               ║    ║
║  ║  lifegrid.incident.classified   lifegrid.dispatch.ack                   ║    ║
║  ║  lifegrid.incident.dispatched   lifegrid.notification.*                 ║    ║
║  ║  lifegrid.incident.updated      lifegrid.satellite.*                    ║    ║
║  ║  lifegrid.ai.nlp.request/resp   lifegrid.iot.reading/alert              ║    ║
║  ║  lifegrid.responder.location    lifegrid.audit.event                    ║    ║
║  ╚═══════════════════════════════════════════════════════════════════════╤═╝    ║
║                    │                    │                    │           │       ║
║         ┌──────────▼──────┐  ┌──────────▼──────┐  ┌────────▼──────┐   │       ║
║         │ AI PROCESSING   │  │ DISPATCH SERVICE │  │NOTIFICATION   │   │       ║
║         │ SERVICE         │  │ Port 4003        │  │SERVICE        │   │       ║
║         │ Port 4002       │  │                  │  │Port 4004      │   │       ║
║         │                 │  │ AES-256-GCM      │  │               │   │       ║
║         │ NLP classify    │  │ Route optimize   │  │ SMS (Twilio)  │   │       ║
║         │ Dispatch decide │  │ OSRM routing     │  │ Push (FCM)    │   │       ║
║         │ Risk scoring    │  │ Responder update │  │ Email (SG)    │   │       ║
║         │ Escalation      │  │ Radio dispatch   │  │ Voice (Twilio)│   │       ║
║         └────────┬────────┘  └──────────────────┘  │ Radio (P25)   │   │       ║
║                  │                                  │ Satellite     │   │       ║
║         ┌────────▼────────┐                         │ (Iridium/SL)  │   │       ║
║         │   AI ENGINE     │                         └───────────────┘   │       ║
║         │   Port 5001     │                                              │       ║
║         │   (Python)      │                                              │       ║
║         │ NLP · Dispatch  │                                              │       ║
║         │ Flood · Weather │                                              │       ║
║         │ NDVI · Face     │                                              │       ║
║         │ Safety          │                                              │       ║
║         └─────────────────┘                                              │       ║
║                                                                          │       ║
║  ┌───────────────────────────────────────────────────────────────────────▼──┐   ║
║  │                    SATELLITE SERVICE  Port 5002                          │   ║
║  │  NISAR · INSAT-3DS · Sentinel-1/2 · GOES-16 · Landsat-9                 │   ║
║  │  NDVI · NDWI · EVI · SAVI · Z-score · Flood depth · Terrain analysis    │   ║
║  └──────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                  ║
║  ┌──────────────────────────────────────────────────────────────────────────┐   ║
║  │                    API GATEWAY  Port 4000                                │   ║
║  │  REST /api/v1/* · WebSocket (Socket.IO) · MQTT client                   │   ║
║  │  JWT auth · RBAC · Rate limiting · 7-step pipeline (legacy sync path)    │   ║
║  └──────────────────────────────────────────────────────────────────────────┘   ║
║                                                                                  ║
║  DATA LAYER                                                                      ║
║  ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   ║
║  │ PostgreSQL 16    │  │ Redis 7.2    │  │ MongoDB 7.0  │  │ Kafka 3.7    │   ║
║  │ + PostGIS 3.4    │  │ Cache/Session│  │ Satellite    │  │ Event log    │   ║
║  │ Primary store    │  │ Token store  │  │ time-series  │  │ 30-day ret.  │   ║
║  └──────────────────┘  └──────────────┘  └──────────────┘  └──────────────┘   ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

---

## Microservices Inventory

| Service | Port | Language | Consumes | Produces |
|---------|------|----------|----------|----------|
| Ingestion Service | 4001 | Node.js | HTTP (all sources) | `incident.triggered` |
| AI Processing Service | 4002 | Node.js | `incident.triggered` | `incident.classified`, `dispatch.command` |
| Dispatch Service | 4003 | Node.js | `dispatch.command` | `dispatch.ack`, `notification.*` |
| Notification Service | 4004 | Node.js | `notification.*` | — |
| API Gateway | 4000 | Node.js | HTTP/WS | `incident.*`, `iot.*` |
| AI Engine | 5001 | Python | HTTP (internal) | — |
| Satellite Service | 5002 | Python | `satellite.*.ingest` | `satellite.processed`, `satellite.alert` |

---

## Kafka Topic Architecture

```
Topic                              Partitions  Replication  Retention
─────────────────────────────────────────────────────────────────────
lifegrid.incident.triggered             12          3         7 days
lifegrid.incident.classified            12          3         7 days
lifegrid.incident.dispatched            12          3         7 days
lifegrid.incident.updated               12          3         7 days
lifegrid.incident.closed                 6          3        30 days
lifegrid.incident.escalated              6          3         7 days
lifegrid.ai.nlp.request                  8          3         1 day
lifegrid.ai.nlp.response                 8          3         1 day
lifegrid.ai.dispatch.request             8          3         1 day
lifegrid.ai.dispatch.response            8          3         1 day
lifegrid.ai.prediction.result            4          3         7 days
lifegrid.dispatch.command               12          3         3 days
lifegrid.dispatch.ack                   12          3         3 days
lifegrid.dispatch.arrived                6          3         3 days
lifegrid.notification.sms                6          3         3 days
lifegrid.notification.push               6          3         1 day
lifegrid.notification.email              4          3         3 days
lifegrid.notification.voice              4          3         3 days
lifegrid.notification.radio              6          3         3 days
lifegrid.notification.satellite          4          3         7 days
lifegrid.iot.reading                    24          3         1 day
lifegrid.iot.alert                      12          3         7 days
lifegrid.iot.panic                       6          3         7 days
lifegrid.satellite.nisar.ingest          4          3         7 days
lifegrid.satellite.insat.ingest          4          3         1 day
lifegrid.satellite.sentinel.ingest       4          3         7 days
lifegrid.satellite.processed             4          3        30 days (compact)
lifegrid.satellite.alert                 6          3         7 days
lifegrid.responder.location             24          3         1 day
lifegrid.responder.status               12          3         7 days
lifegrid.system.alert_level              1          3        30 days
lifegrid.audit.event                     6          3       365 days
```

Each topic also has a `.dlq` (Dead Letter Queue) variant for failed messages.

---

## Event-Driven Data Flow

```
TRIGGER EVENT FLOW
──────────────────
Source (Voice/SMS/App/IoT/Satellite/CCTV)
  │
  ▼
Ingestion Service (4001)
  │  normalize → deduplicate (Redis 60s) → validate → enrich
  │
  ▼ publish: lifegrid.incident.triggered
  │
  ├──► AI Processing Service (4002)
  │      │  NLP classify (AI Engine 5001)
  │      │  Dispatch decide (AI Engine 5001)
  │      │  Risk score → escalation check
  │      │  Write to PostgreSQL
  │      │
  │      ├──► publish: lifegrid.incident.classified
  │      ├──► publish: lifegrid.dispatch.command
  │      └──► publish: lifegrid.ai.prediction.result
  │
  └──► API Gateway (4000)
         │  WebSocket broadcast to operators
         └──► Socket.IO: INCIDENT_CREATED

DISPATCH FLOW
─────────────
lifegrid.dispatch.command
  │
  ▼
Dispatch Service (4003)
  │  AES-256-GCM channel creation
  │  OSRM route optimization
  │  Responder status update (PostgreSQL)
  │
  ├──► publish: lifegrid.notification.push (per responder)
  ├──► publish: lifegrid.notification.radio (CRITICAL only)
  ├──► publish: lifegrid.notification.satellite (remote areas)
  ├──► publish: lifegrid.dispatch.ack
  └──► publish: lifegrid.incident.updated

NOTIFICATION FLOW
─────────────────
lifegrid.notification.{sms|push|email|voice|radio|satellite}
  │
  ▼
Notification Service (4004)
  │  Priority queue (EMERGENCY > URGENT > NORMAL)
  │  Rate limiting (per recipient per channel)
  │  Delivery tracking (Redis)
  │
  ├──► SMS:       Twilio SMS API
  ├──► Push:      Firebase Cloud Messaging
  ├──► Email:     SendGrid API
  ├──► Voice:     Twilio Voice + TTS
  ├──► Radio:     P25/DMR gateway
  └──► Satellite: Iridium SBD / Starlink terminal

SATELLITE FLOW
──────────────
Scheduled ingestion (cron) OR Kafka trigger
  │
  ▼
Satellite Service (5002)
  │  Download raw data (HDF5/NetCDF/GeoTIFF)
  │  Preprocess (calibration, reprojection)
  │  Compute indices (NDVI, NDWI, EVI, SAVI)
  │  Anomaly detection (Z-score)
  │  Flood detection (SAR threshold + U-Net)
  │  3D depth estimation (DEM + flood mask)
  │  Alert generation
  │
  ├──► publish: lifegrid.satellite.processed
  ├──► publish: lifegrid.satellite.alert
  └──► publish: lifegrid.incident.triggered (for CRITICAL alerts)
```

---

## API Structure

### REST Endpoints

```
── Ingestion Service (4001) ──────────────────────────────────────
POST /ingest/mobile          Citizen app emergency report
POST /ingest/iot             IoT sensor data (device key auth)
POST /ingest/panic           Panic button activation
POST /ingest/voice           Twilio voice webhook
POST /ingest/sms             Twilio SMS webhook
POST /ingest/satellite       Satellite direct-to-device message
POST /ingest/cctv            CCTV video analytics event
POST /ingest/offline-queue   Flush offline queue on reconnect
GET  /health                 Service health

── AI Processing Service (4002) ──────────────────────────────────
GET  /health                 Service health

── Dispatch Service (4003) ───────────────────────────────────────
GET  /health                 Service health

── Notification Service (4004) ───────────────────────────────────
GET  /health                 Service health + queue size

── AI Engine (5001) ──────────────────────────────────────────────
POST /nlp/analyze            Emergency text classification + NER
POST /nlp/batch-analyze      Batch classification (max 20)
POST /dispatch/decide        AI responder selection
POST /predict/flood          Flood risk prediction
POST /predict/weather        Weather alert prediction
POST /predict/ndvi           Agricultural stress analysis
POST /missing/search         Face recognition search
POST /missing/register       Register missing person
DELETE /missing/deregister/:id  Remove from index
POST /safety/classify        Wearable sensor classification
POST /safety/stream          Combined classify + alert decision
GET  /health                 Model status
GET  /metrics                Prometheus metrics

── Satellite Service (5002) ──────────────────────────────────────
POST /process                Process satellite scene (sync)
POST /process/async          Queue scene for background processing
GET  /scenes/:id             Get processed scene result
GET  /health                 Service health

── API Gateway (4000) ────────────────────────────────────────────
POST /api/v1/auth/login
POST /api/v1/auth/register
POST /api/v1/auth/refresh
POST /api/v1/auth/logout

POST /api/v1/incidents/report
GET  /api/v1/incidents
GET  /api/v1/incidents/:id
PATCH /api/v1/incidents/:id
POST /api/v1/incidents/:id/verify
GET  /api/v1/incidents/:id/timeline
GET  /api/v1/incidents/stats/summary

GET  /api/v1/responders
GET  /api/v1/responders/:id
PATCH /api/v1/responders/:id/location

POST /api/v1/iot/ingest
POST /api/v1/iot/panic

GET  /api/v1/analytics/metrics
GET  /api/v1/analytics/heatmap
GET  /api/v1/analytics/timeseries

GET  /api/v1/gis/layers
GET  /api/v1/gis/stations

GET  /api/v1/guidance/:sessionId
POST /api/v1/guidance/:sessionId/message

POST /api/v1/ai/flood/predict
POST /api/v1/ai/weather/predict
POST /api/v1/ai/ndvi/analyze
POST /api/v1/ai/missing/search
POST /api/v1/ai/safety/stream
GET  /api/v1/ai/health

GET  /health
```

### WebSocket Events (Socket.IO)

```
Server → Client:
  INCIDENT_CREATED          New incident triggered
  INCIDENT_UPDATED          Status/data change
  INCIDENT_CLOSED           Incident resolved
  RESPONDER_LOCATION_UPDATE GPS position update
  RESPONDER_STATUS_CHANGE   Status change
  DISPATCH_SENT             Dispatch notification
  DISPATCH_ACKNOWLEDGED     Responder acknowledged
  GUIDANCE_MESSAGE          Citizen guidance
  SENSOR_ALERT              IoT anomaly
  SYSTEM_ALERT              System-wide alert
  ALERT_LEVEL_CHANGE        National alert level
  OPERATOR_BROADCAST        Operator message
  VERIFICATION_COMPLETE     Closure verification

Client → Server:
  JOIN_INCIDENT             Subscribe to incident room
  LEAVE_INCIDENT            Unsubscribe
  RESPONDER_LOCATION        GPS update (responder)
  OPERATOR_BROADCAST        Broadcast message
  PING / PONG               Keepalive
```

---

## Database Architecture (SQL + NoSQL Hybrid)

### PostgreSQL + PostGIS (Primary)
- Incidents, dispatches, routes, verifications
- Users, responders, stations
- Guidance sessions and messages
- IoT devices and readings (partitioned by month)
- Audit log (partitioned by month, 365-day retention)
- PostGIS spatial indexes for all geo queries
- JSONB for NLP analysis and AI decision data

### Redis (Cache + Session)
- JWT token blacklist (logout)
- User session cache (5-minute TTL)
- Trigger deduplication (60-second TTL)
- Rate limiting counters
- Notification delivery tracking
- Responder location cache (300-second TTL)

### MongoDB (Satellite Time-Series)
- Raw satellite scene metadata
- Processed index time-series (NDVI, NDWI, etc.)
- Historical baselines for anomaly detection
- Flood zone history
- Weather alert history

### Kafka (Event Log)
- Immutable event stream (30-day retention for most topics)
- Audit events (365-day retention)
- Replay capability for disaster recovery

---

## Security Architecture

### Transport Security
- TLS 1.3 on all external endpoints (Nginx termination)
- mTLS between internal microservices (production)
- HSTS with preload (max-age: 31536000)

### Authentication & Authorization
- JWT access tokens (15-minute expiry, RS256)
- Refresh tokens (7-day expiry, rotation on use)
- Redis blacklist for revoked tokens
- MFA (TOTP) required for OPERATOR+ roles
- Account lockout: 5 failures → 15-minute lockout
- 7 roles: CITIZEN, OPERATOR, SUPERVISOR, COMMANDER, SYSTEM_ADMIN, RESPONDER, ANALYST

### Data Encryption
- AES-256-GCM for dispatch channel keys
- HKDF key derivation per channel (incidentId + responderId + channelId)
- HMAC-SHA256 for verification signatures
- Satellite message HMAC-SHA256 authentication
- Iridium SBD payload: compact binary format (max 340 bytes)

### Input Validation
- Zod schemas on all REST endpoints
- Pydantic models on all Python endpoints
- Parameterized queries (no SQL injection)
- Rate limiting: 500 req/15min global, 30 req/min emergency

### Audit Trail
- Immutable `audit_log` table (PostgreSQL, partitioned)
- All actor IDs, roles, IP addresses, timestamps
- Kafka `lifegrid.audit.event` topic (365-day retention)
- Cannot be deleted by application users

---

## Redundancy Model

```
Formula: R = 1 - [(1 - Ps) × (1 - Pc)]

Where:
  Ps = Primary path success probability
  Pc = Contingency path success probability
  R  = Overall system reliability

Four-path redundancy:
  Path 1 (Primary):     Internet → API Gateway → Kafka
                        Ps = 0.999
  Path 2 (Contingency): Satellite link → Ingestion Service
                        Pc = 0.998
  Path 3 (Tertiary):    SMS fallback → Twilio → Kafka
                        Pt = 0.997
  Path 4 (Quaternary):  Offline queue → Local storage → sync
                        Pq = 1.000 (always available)

Two-path calculation:
  R = 1 - (1 - 0.999) × (1 - 0.998)
  R = 1 - 0.001 × 0.002
  R = 1 - 0.000002
  R = 0.999998  (five nines)

Four-path calculation:
  R = 1 - (1-0.999)(1-0.998)(1-0.997)(1-1.0)
  R = 1 - 0.001 × 0.002 × 0.003 × 0
  R = 1.0  (theoretical maximum with offline queue)
```

### Kafka High Availability
- 3-broker cluster (kafka-1, kafka-2, kafka-3)
- Replication factor: 3 (all brokers hold all data)
- Min ISR (In-Sync Replicas): 2 (survives 1 broker failure)
- Idempotent producer (exactly-once semantics)
- Consumer group rebalancing on failure

### Database HA
- PostgreSQL: primary + 2 read replicas (production)
- Redis: Sentinel mode (1 primary + 2 replicas)
- Automatic failover via Patroni (production)

---

## Satellite Integration

### NISAR (NASA/ISRO SAR)
- **Orbit:** Sun-synchronous, 747km altitude, 12-day repeat
- **Bands:** L-band (24cm) + S-band (9cm)
- **Resolution:** 3–10m
- **Products:** Soil moisture, surface deformation, vegetation structure
- **Processing:** L-band backscatter → soil moisture (empirical model)
- **Alerts:** Drought stress (SM < 0.15), soil saturation (SM > 0.85), surface deformation (coherence < 0.3)

### INSAT-3DS (ISRO)
- **Orbit:** Geostationary, 82°E
- **Instruments:** Imager (6 channels), Sounder (19 channels), Lightning Imager
- **Cadence:** 15-minute full disk
- **Products:** Rainfall (IMSRA), SST, lightning density, water vapor
- **Alerts:** Heavy rainfall (> 50mm/h), lightning storm (> 50 flashes/km²/h), cyclone risk (SST > 30°C)

### Sentinel-1 SAR (ESA)
- **Orbit:** Sun-synchronous, 693km, 6-day repeat
- **Band:** C-band (5.6cm), VV + VH polarization
- **Resolution:** 5×20m (IW mode)
- **Products:** Flood extent, surface change, ship detection
- **Algorithm:** σ°_VV < -15 dB → water mask → morphological cleaning → flood zones
- **3D depth:** DEM + flood mask → WSE (95th percentile) → depth map → volume

### Sentinel-2 Optical (ESA)
- **Orbit:** Sun-synchronous, 786km, 5-day repeat
- **Bands:** 13 bands (443–2190nm), 10m/20m/60m resolution
- **Products:** NDVI, NDWI, EVI, SAVI, NBR, NDSI
- **Anomaly detection:** Z-score against 5-year historical baseline
- **Alerts:** Flood inundation (NDWI > 0.3), fire risk (NDVI < 0.15 + EVI < 0.1), drought (NDVI < 0.2 + NDWI < -0.3)

### GOES-16/17 (NOAA)
- **Orbit:** Geostationary, 75.2°W / 137.2°W
- **Instrument:** ABI (16 channels), GLM (lightning)
- **Cadence:** 10-minute full disk, 5-minute CONUS
- **Products:** Cloud top temperature, convection, fire hotspots
- **Alerts:** Severe convection (IR < 210K), tornado risk (IR < 200K + CAPE > 2500)

---

## Offline Resilience

### Device-side (Citizen App)
- Zustand persist middleware → localStorage
- Offline queue: `[{id, type, payload, timestamp, retries}]`
- Auto-flush on `navigator.onLine` event
- POST `/ingest/offline-queue` on reconnect

### Satellite-connected devices
- Iridium SBD: 340-byte binary payload
- Compact format: [type:1][priority:1][lat:4][lng:4][message:330]
- Acknowledgement: UUID returned to device
- Retry: device retransmits if no ACK within 60s

### Service-level
- Kafka consumer retry: 3 attempts with exponential backoff (100ms, 200ms, 400ms)
- Dead Letter Queue: `.dlq` suffix topic for failed messages
- Circuit breaker: AI Engine calls fall back to local models
- Database connection pool: auto-reconnect with exponential backoff

---

## Latency Targets

| Operation | Target | Actual (p99) |
|-----------|--------|-------------|
| SOS trigger → Kafka publish | < 100ms | ~45ms |
| NLP classification | < 400ms | ~150ms (GPU) |
| Dispatch decision | < 100ms | ~50ms |
| Route optimization | < 500ms | ~200ms |
| Push notification delivery | < 2s | ~800ms |
| SMS delivery | < 5s | ~2s |
| Satellite SBD delivery | < 60s | ~30s |
| Flood prediction (rule engine) | < 50ms | ~15ms |
| Flood prediction (U-Net) | < 1s | ~600ms |
| NDVI computation | < 300ms | ~80ms |
| Face search (FAISS) | < 200ms | ~80ms |
| Safety classification | < 50ms | ~20ms |
| End-to-end SOS → responder notified | < 30s | ~8s |

---

## Observability Stack

- **Metrics:** Prometheus (scrape interval: 15s) + Grafana dashboards
- **Logging:** Winston (Node.js) + structlog (Python) → JSON → ELK stack
- **Tracing:** OpenTelemetry (production) → Jaeger
- **Alerting:** Grafana alerts → PagerDuty / OpsGenie
- **Health checks:** All services expose `/health` endpoint
- **Kafka monitoring:** Kafka UI (port 8080) + JMX exporter
