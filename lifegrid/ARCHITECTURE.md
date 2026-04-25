# LIFEGRID – System Architecture
## National Emergency Coordination Infrastructure

---

## System Overview

LIFEGRID is a dual-interface, AI-powered national emergency coordination platform. It processes emergency events from multiple input sources through a deterministic 7-step pipeline, dispatching responders with encrypted communications, real-time GIS routing, and multilingual citizen guidance.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         LIFEGRID PLATFORM                               │
│                                                                         │
│  ┌──────────────────┐              ┌──────────────────────────────────┐ │
│  │   CITIZEN UI     │              │    OPERATOR COMMAND CENTER       │ │
│  │  (React/Vite)    │              │       (React/Vite)               │ │
│  │  Port: 5173      │              │       Port: 5174                 │ │
│  │                  │              │                                  │ │
│  │ • Emergency Form │              │ • 3-panel grid layout            │ │
│  │ • Live Tracking  │              │ • Real-time incident list        │ │
│  │ • Guidance Chat  │              │ • GIS command map                │ │
│  │ • Multilingual   │              │ • AI analysis panel              │ │
│  └────────┬─────────┘              │ • Analytics bar                  │ │
│           │                        │ • System log                     │ │
│           │ HTTPS/WSS              └──────────────┬───────────────────┘ │
│           │                                       │                     │
│  ┌────────▼───────────────────────────────────────▼───────────────────┐ │
│  │                      NGINX REVERSE PROXY                           │ │
│  │              Rate limiting · TLS termination · Headers             │ │
│  └────────────────────────────┬───────────────────────────────────────┘ │
│                               │                                         │
│  ┌────────────────────────────▼───────────────────────────────────────┐ │
│  │                    API GATEWAY (Node.js/Express)                   │ │
│  │                         Port: 4000                                 │ │
│  │                                                                    │ │
│  │  REST API          WebSocket (Socket.IO)    MQTT Broker Client     │ │
│  │  /api/v1/*         Real-time events         IoT sensor ingestion   │ │
│  │                                                                    │ │
│  │  ┌─────────────────────────────────────────────────────────────┐  │ │
│  │  │              7-STEP INCIDENT PIPELINE                       │  │ │
│  │  │                                                             │  │ │
│  │  │  1. TRIGGER → 2. UNDERSTAND → 3. DECIDE → 4. DISPATCH      │  │ │
│  │  │       ↓              ↓             ↓           ↓           │  │ │
│  │  │  Multi-source    NLP + NER     AI Responder  Encrypted     │  │ │
│  │  │  normalization   Classification Selection   Channels       │  │ │
│  │  │                                                             │  │ │
│  │  │  5. EXECUTE → 6. SUPPORT → 7. CONFIRM                      │  │ │
│  │  │       ↓            ↓            ↓                          │  │ │
│  │  │  Route Optim.  Multilingual  Dual Verification             │  │ │
│  │  │  GIS Layers    Guidance      Cryptographic Sig.            │  │ │
│  │  └─────────────────────────────────────────────────────────────┘  │ │
│  │                                                                    │ │
│  │  AI Engine         Route Service      Encryption Service          │ │
│  │  Guidance Service  Notification Svc   Audit Service               │ │
│  └──────────┬─────────────────────────────────────────────────────────┘ │
│             │                                                           │
│  ┌──────────▼──────────────────────────────────────────────────────┐   │
│  │                    DATA LAYER                                   │   │
│  │                                                                 │   │
│  │  PostgreSQL + PostGIS    Redis Cache       MQTT Broker          │   │
│  │  (Primary store)         (Sessions/Cache)  (IoT ingestion)      │   │
│  │  Port: 5432              Port: 6379        Port: 1883           │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘

External Integrations:
  • OSRM          – Route optimization
  • Nominatim     – Geocoding
  • NLP Service   – Text classification (microservice)
  • Satellite APIs – GIS layers (ESRI, OpenTopoMap)
  • SMS/Push      – Twilio / FCM (production)
```

---

## 7-Step Pipeline Detail

### Step 1: Trigger
**Input sources:** Voice call, SMS, Mobile app, Panic button, IoT sensor, Satellite, Social media, CCTV, Operator manual

**Processing:**
- Source normalization into unified `IncidentTrigger` schema
- Deduplication via Redis (60-second window per device/caller)
- Media attachment handling
- Initial incident record creation (immediate persistence)

**Fallback:** If source parsing fails, raw input is preserved for manual classification

---

### Step 2: Understanding (NLP)
**Primary:** External NLP microservice (`/analyze` endpoint)

**Processing:**
- Language detection
- Named entity recognition (LOCATION, PERSON, INJURY, HAZARD, VEHICLE, WEAPON, TIME)
- Intent classification
- Sentiment analysis (PANIC / URGENT / CALM / CONFUSED)
- Incident type classification (12 types)
- Geocoding of extracted location entities

**Fallback:** Local keyword-matching classifier with 12 incident type dictionaries

---

### Step 3: Decision (AI)
**Primary:** External AI decision service

**Processing:**
- Spatial query for available responders within configurable radius (default 50km)
- Multi-factor responder scoring: distance, ETA, type match, capabilities
- Risk score calculation (0–100)
- Escalation determination
- Resource requirement planning

**Fallback:** Nearest-available-responder rule with type matching

---

### Step 4: Dispatch
**Processing:**
- AES-256-GCM encrypted channel creation per responder
- Dispatch record creation with cryptographic channel IDs
- Multi-channel notification: WebSocket → Push → SMS → Radio
- Responder status update (AVAILABLE → DISPATCHED)
- Maximum 5 responders per incident (configurable)

**Non-recoverable:** Dispatch failure triggers incident escalation

---

### Step 5: Execution
**Processing:**
- OSRM route optimization with traffic factor
- Emergency vehicle priority routing (0.7x time factor for CRITICAL)
- Alternate route calculation (2 alternatives)
- GIS layer activation (roads, hospitals, hazards)
- Route push to responder devices

**Fallback:** Direct Haversine route calculation

---

### Step 6: Support
**Processing:**
- Language detection from NLP analysis
- Incident-type-specific guidance template selection
- ETA-aware first message
- Session persistence (voice/SMS/app/chat channels)
- 8 supported languages: EN, ES, FR, AR, ZH, HI, PT, RU

---

### Step 7: Confirmation
**Processing:**
- Dual verification requirement for CRITICAL incidents
- Cryptographic HMAC signature per verification
- Verification methods: OPERATOR_CONFIRM, RESPONDER_CONFIRM, CITIZEN_CONFIRM, SENSOR_CONFIRM
- Automatic closure on sufficient verifications
- Full audit trail

---

## Database Schema

### Core Tables
| Table | Purpose | Key Indexes |
|-------|---------|-------------|
| `incidents` | Primary incident records | PostGIS spatial, severity, status, FTS |
| `dispatches` | Responder dispatch records | incident_id, responder_id |
| `routes` | Optimized route data | incident_id, responder_id |
| `guidance_sessions` | Citizen guidance sessions | incident_id |
| `guidance_messages` | Individual guidance messages | session_id |
| `verifications` | Closure verification records | incident_id |
| `responders` | Responder profiles + location | PostGIS spatial, status, type |
| `responder_units` | Vehicle/unit records | station_id |
| `stations` | Emergency service stations | PostGIS spatial |
| `iot_devices` | Registered IoT sensors | PostGIS spatial, type |
| `iot_readings` | Time-series sensor data | Partitioned by month |
| `users` | All user accounts | email, role |
| `audit_log` | Immutable audit trail | Partitioned by month |
| `system_config` | Runtime configuration | key |

### Key Design Decisions
- **PostGIS** for all spatial queries (responder proximity, affected zones)
- **JSONB** for NLP analysis and AI decision (schema flexibility)
- **Table partitioning** for IoT readings and audit log (time-series performance)
- **Materialized views** for active incidents and metrics
- **Triggers** for automatic `updated_at` maintenance

---

## API Structure

```
POST   /api/v1/auth/login
POST   /api/v1/auth/register
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout

POST   /api/v1/incidents/report          (public – citizen)
GET    /api/v1/incidents                 (operator+)
GET    /api/v1/incidents/:id
PATCH  /api/v1/incidents/:id             (operator+)
POST   /api/v1/incidents/:id/verify      (operator/responder)
GET    /api/v1/incidents/:id/timeline
GET    /api/v1/incidents/stats/summary   (operator+)

GET    /api/v1/responders                (operator+)
GET    /api/v1/responders/:id
PATCH  /api/v1/responders/:id/location   (responder)

POST   /api/v1/iot/ingest                (device key auth)
POST   /api/v1/iot/panic                 (device key auth)

GET    /api/v1/analytics/metrics         (operator+)
GET    /api/v1/analytics/heatmap         (operator+)
GET    /api/v1/analytics/timeseries      (operator+)

GET    /api/v1/gis/layers
GET    /api/v1/gis/stations

GET    /api/v1/guidance/:sessionId
POST   /api/v1/guidance/:sessionId/message  (operator+)

GET    /health
```

---

## WebSocket Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `INCIDENT_CREATED` | Server → Client | New incident triggered |
| `INCIDENT_UPDATED` | Server → Client | Incident status/data changed |
| `INCIDENT_CLOSED` | Server → Client | Incident closed |
| `RESPONDER_LOCATION_UPDATE` | Server → Operators | Responder GPS update |
| `RESPONDER_STATUS_CHANGE` | Server → Operators | Responder status changed |
| `DISPATCH_SENT` | Server → All | Dispatch notification |
| `DISPATCH_ACKNOWLEDGED` | Server → Operators | Responder acknowledged |
| `GUIDANCE_MESSAGE` | Server → Citizen | New guidance message |
| `SENSOR_ALERT` | Server → Operators | IoT anomaly detected |
| `SYSTEM_ALERT` | Server → All | System-wide alert |
| `ALERT_LEVEL_CHANGE` | Server → All | National alert level change |
| `OPERATOR_BROADCAST` | Server → All | Operator broadcast message |
| `VERIFICATION_COMPLETE` | Server → All | Incident verification recorded |
| `RESPONDER_LOCATION` | Responder → Server | GPS location update |
| `JOIN_INCIDENT` | Client → Server | Subscribe to incident room |
| `LEAVE_INCIDENT` | Client → Server | Unsubscribe from incident room |

---

## Security Architecture

### Authentication
- JWT access tokens (15-minute expiry) + refresh tokens (7-day expiry)
- Token rotation on refresh
- Redis-backed token blacklist for logout
- MFA (TOTP) required for OPERATOR+ roles
- Account lockout after 5 failed attempts (15-minute lockout)

### Authorization
- Role-based access control (CITIZEN, OPERATOR, SUPERVISOR, COMMANDER, SYSTEM_ADMIN, RESPONDER, ANALYST)
- Route-level role guards
- Resource-level ownership checks (citizens can only view own incidents)

### Data Security
- AES-256-GCM encryption for dispatch channels
- HMAC-SHA256 signatures for verification records
- Parameterized queries (no SQL injection)
- Input validation via Zod schemas on all endpoints
- Helmet.js security headers
- HSTS with preload

### Infrastructure
- Rate limiting: 500 req/15min global, 30 req/min for emergency endpoints
- CORS restricted to known origins
- IoT devices use separate API key authentication
- All access logged to immutable audit table

---

## Scalability Design

### Horizontal Scaling
- Stateless API gateway (session state in Redis)
- WebSocket sticky sessions via Nginx upstream
- Database connection pooling (max 20 connections per instance)
- Redis pub/sub for multi-instance WebSocket coordination (production)

### Performance
- Redis caching for user lookups (5-minute TTL)
- Trigger deduplication cache (60-second TTL)
- Database indexes on all query paths
- PostGIS spatial indexes for geo queries
- Table partitioning for time-series data
- Lazy-loaded frontend routes
- Code splitting by vendor/map/charts/ui

### Cloud-Native Readiness
- Docker containerization for all services
- Health check endpoints on all services
- Graceful shutdown with connection draining
- Environment-based configuration
- Structured JSON logging for log aggregation
- Stateless design for Kubernetes deployment

---

## IoT Integration

### Supported Protocols
- **MQTT** (primary) – Eclipse Mosquitto broker, QoS 1
- **CoAP** – via HTTP bridge
- **HTTP** – REST fallback endpoint `/api/v1/iot/ingest`

### Topic Structure
```
lifegrid/sensors/{deviceType}/{deviceId}/data
lifegrid/alerts/{deviceType}/{deviceId}/alert
lifegrid/panic/{deviceId}
lifegrid/satellite/{layerId}/data
lifegrid/system/gateway/status
```

### Supported Device Types
SMOKE, FLOOD, SEISMIC, CHEMICAL, RADIATION, PANIC_BUTTON, CCTV, WEATHER

### Anomaly Detection
Per-device-type threshold configuration with automatic incident pipeline trigger on anomaly detection.

---

## Deployment

### Development
```bash
# Start infrastructure
docker-compose up postgres redis mqtt -d

# Install dependencies
npm install

# Start all services
npm run dev
```

### Production
```bash
# Full stack
docker-compose up -d

# Scale API gateway
docker-compose up -d --scale api-gateway=3
```

### Environment Requirements
- Node.js 20+
- PostgreSQL 16+ with PostGIS 3.4+
- Redis 7.2+
- Eclipse Mosquitto 2.0+
- Docker 24+ / Kubernetes 1.28+
