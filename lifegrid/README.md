# LIFEGRID
## National Emergency Coordination Infrastructure

> AI-powered dual-interface emergency response platform. Real-time. Encrypted. Multilingual.

---

## Quick Start

```bash
# 1. Start infrastructure (PostgreSQL, Redis, MQTT)
docker-compose up postgres redis mqtt -d

# 2. Install all dependencies
npm install

# 3. Configure environment
cp services/api-gateway/.env.example services/api-gateway/.env

# 4. Start all services concurrently
npm run dev
```

| Service | URL | Description |
|---------|-----|-------------|
| Citizen UI | http://localhost:5173 | Public emergency reporting interface |
| Operator Command Center | http://localhost:5174 | Operator control dashboard |
| API Gateway | http://localhost:4000 | REST API + WebSocket |
| API Health | http://localhost:4000/health | System health check |

---

## Project Structure

```
lifegrid/
├── apps/
│   ├── citizen-ui/          # React citizen interface (Vite + Tailwind)
│   └── operator-ui/         # React command center (Vite + Tailwind)
├── services/
│   └── api-gateway/         # Node.js/Express API + WebSocket + MQTT
│       ├── src/
│       │   ├── pipeline/    # 7-step incident processing pipeline
│       │   ├── ai/          # AI engine (NLP, dispatch decisions)
│       │   ├── websocket/   # Real-time WebSocket manager
│       │   ├── iot/         # MQTT broker integration
│       │   ├── routes/      # REST API routes
│       │   ├── middleware/  # Auth, validation, error handling
│       │   ├── database/    # PostgreSQL repositories
│       │   ├── cache/       # Redis manager
│       │   └── services/    # Business logic services
│       └── src/database/schema.sql  # Full PostgreSQL schema
├── packages/
│   └── shared-types/        # TypeScript types shared across apps
├── infrastructure/
│   ├── nginx/               # Reverse proxy configuration
│   └── mosquitto/           # MQTT broker configuration
├── docker-compose.yml       # Full stack Docker setup
└── ARCHITECTURE.md          # Detailed system architecture
```

---

## The 7-Step Pipeline

```
TRIGGER → UNDERSTAND → DECIDE → DISPATCH → EXECUTE → SUPPORT → CONFIRM
   ↓           ↓          ↓         ↓          ↓         ↓         ↓
Multi-src    NLP+NER    AI Sel.  Encrypted  Route     Multilng  Dual
Input        Class.     Resp.    Channel    Optim.    Guidance  Verify
```

Every emergency event flows through all 7 steps with automatic fallbacks at each stage. No single point of failure.

---

## Tech Stack

**Frontend:** React 18, TypeScript, Vite, Tailwind CSS, Framer Motion, Leaflet, Recharts, Zustand, Socket.IO Client

**Backend:** Node.js, Express, TypeScript, Socket.IO, MQTT.js, Zod, JWT, bcrypt, Winston

**Database:** PostgreSQL 16 + PostGIS, Redis 7

**Infrastructure:** Docker, Nginx, Eclipse Mosquitto

**AI/ML:** External NLP microservice (pluggable), local keyword fallback

**GIS:** OpenStreetMap, ESRI Satellite, OSRM routing, Nominatim geocoding

---

## License

CLASSIFIED – National Infrastructure System
