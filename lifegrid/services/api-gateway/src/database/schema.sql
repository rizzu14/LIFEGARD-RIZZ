-- ============================================================
-- LIFEGRID – PostgreSQL Database Schema
-- National Emergency Coordination Infrastructure
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";       -- GIS support
CREATE EXTENSION IF NOT EXISTS "pg_trgm";       -- Full-text search
CREATE EXTENSION IF NOT EXISTS "btree_gist";    -- GiST index support

-- ─── Schema ───────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS lifegrid;
SET search_path TO lifegrid, public;

-- ─── Enumerations ─────────────────────────────────────────────

CREATE TYPE incident_severity AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW');
CREATE TYPE incident_status AS ENUM (
  'TRIGGERED', 'CLASSIFIED', 'DISPATCHED', 'EN_ROUTE',
  'ON_SCENE', 'RESOLVED', 'CLOSED', 'ESCALATED'
);
CREATE TYPE incident_type AS ENUM (
  'MEDICAL', 'FIRE', 'NATURAL_DISASTER', 'SECURITY',
  'INFRASTRUCTURE', 'CHEMICAL', 'BIOLOGICAL', 'RADIOLOGICAL',
  'NUCLEAR', 'CYBER', 'MASS_CASUALTY', 'UNKNOWN'
);
CREATE TYPE trigger_source AS ENUM (
  'VOICE_CALL', 'SMS', 'MOBILE_APP', 'PANIC_BUTTON',
  'IOT_SENSOR', 'SATELLITE', 'SOCIAL_MEDIA', 'OPERATOR', 'API', 'CCTV'
);
CREATE TYPE responder_type AS ENUM (
  'POLICE', 'FIRE', 'AMBULANCE', 'HAZMAT',
  'SEARCH_RESCUE', 'MILITARY', 'CYBER_UNIT', 'MEDICAL_TEAM', 'DISASTER_MGMT'
);
CREATE TYPE responder_status AS ENUM (
  'AVAILABLE', 'DISPATCHED', 'EN_ROUTE', 'ON_SCENE',
  'RETURNING', 'OFFLINE', 'MAINTENANCE'
);
CREATE TYPE user_role AS ENUM (
  'CITIZEN', 'OPERATOR', 'SUPERVISOR', 'COMMANDER',
  'SYSTEM_ADMIN', 'RESPONDER', 'ANALYST'
);
CREATE TYPE alert_level AS ENUM ('GREEN', 'YELLOW', 'ORANGE', 'RED', 'BLACK');
CREATE TYPE verification_method AS ENUM (
  'OPERATOR_CONFIRM', 'RESPONDER_CONFIRM', 'CITIZEN_CONFIRM', 'SENSOR_CONFIRM'
);

-- ─── Users ────────────────────────────────────────────────────

CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email           VARCHAR(255) UNIQUE NOT NULL,
  phone           VARCHAR(30),
  name            VARCHAR(200) NOT NULL,
  role            user_role NOT NULL DEFAULT 'CITIZEN',
  language        VARCHAR(10) NOT NULL DEFAULT 'en',
  password_hash   VARCHAR(255) NOT NULL,
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  mfa_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret      VARCHAR(100),
  permissions     TEXT[] NOT NULL DEFAULT '{}',
  last_login_at   TIMESTAMPTZ,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_phone ON users(phone);

-- ─── Incidents ────────────────────────────────────────────────

CREATE TABLE incidents (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference_code        VARCHAR(30) UNIQUE NOT NULL,
  status                incident_status NOT NULL DEFAULT 'TRIGGERED',
  severity              incident_severity NOT NULL DEFAULT 'MEDIUM',
  type                  incident_type NOT NULL DEFAULT 'UNKNOWN',
  alert_level           alert_level NOT NULL DEFAULT 'YELLOW',

  -- Location (PostGIS)
  location              GEOGRAPHY(POINT, 4326),
  location_lat          DECIMAL(10, 7),
  location_lng          DECIMAL(10, 7),
  address_formatted     TEXT,
  address_city          VARCHAR(100),
  address_state         VARCHAR(100),
  address_country       VARCHAR(100),

  -- Trigger data
  trigger_source        trigger_source NOT NULL,
  trigger_raw_input     TEXT NOT NULL,
  trigger_language      VARCHAR(10) NOT NULL DEFAULT 'en',
  trigger_timestamp     TIMESTAMPTZ NOT NULL,
  trigger_device_id     VARCHAR(100),
  trigger_caller_phone  VARCHAR(30),
  trigger_media_urls    TEXT[] DEFAULT '{}',

  -- NLP Analysis (JSONB for flexibility)
  nlp_analysis          JSONB,

  -- AI Decision
  ai_decision           JSONB,

  -- Metadata
  reported_by           UUID REFERENCES users(id),
  assigned_operator_id  UUID REFERENCES users(id),
  assigned_commander_id UUID REFERENCES users(id),
  estimated_affected    INTEGER,
  is_public             BOOLEAN NOT NULL DEFAULT FALSE,
  tags                  TEXT[] DEFAULT '{}',
  notes                 TEXT[] DEFAULT '{}',
  media_urls            TEXT[] DEFAULT '{}',
  closure_report        TEXT,
  closed_at             TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Spatial index for geo queries
CREATE INDEX idx_incidents_location ON incidents USING GIST(location);
CREATE INDEX idx_incidents_status ON incidents(status);
CREATE INDEX idx_incidents_severity ON incidents(severity);
CREATE INDEX idx_incidents_type ON incidents(type);
CREATE INDEX idx_incidents_created_at ON incidents(created_at DESC);
CREATE INDEX idx_incidents_reference_code ON incidents(reference_code);
CREATE INDEX idx_incidents_operator ON incidents(assigned_operator_id);
-- Full-text search on raw input
CREATE INDEX idx_incidents_fts ON incidents USING GIN(to_tsvector('english', trigger_raw_input));

-- ─── Dispatches ───────────────────────────────────────────────

CREATE TABLE dispatches (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id         UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  responder_id        UUID NOT NULL,
  dispatched_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  encrypted_channel   VARCHAR(255) NOT NULL,
  route_id            UUID,
  estimated_arrival   TIMESTAMPTZ,
  acknowledged_at     TIMESTAMPTZ,
  arrived_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dispatches_incident ON dispatches(incident_id);
CREATE INDEX idx_dispatches_responder ON dispatches(responder_id);

-- ─── Routes ───────────────────────────────────────────────────

CREATE TABLE routes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id         UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  responder_id        UUID NOT NULL,
  origin_lat          DECIMAL(10, 7) NOT NULL,
  origin_lng          DECIMAL(10, 7) NOT NULL,
  destination_lat     DECIMAL(10, 7) NOT NULL,
  destination_lng     DECIMAL(10, 7) NOT NULL,
  waypoints           JSONB DEFAULT '[]',
  distance_km         DECIMAL(8, 2),
  estimated_minutes   INTEGER,
  traffic_factor      DECIMAL(4, 2) DEFAULT 1.0,
  alternate_routes    JSONB DEFAULT '[]',
  gis_layers          TEXT[] DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_routes_incident ON routes(incident_id);
CREATE INDEX idx_routes_responder ON routes(responder_id);

-- ─── Guidance Sessions ────────────────────────────────────────

CREATE TABLE guidance_sessions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id   UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  citizen_id    UUID REFERENCES users(id),
  operator_id   UUID REFERENCES users(id),
  language      VARCHAR(10) NOT NULL DEFAULT 'en',
  channel       VARCHAR(20) NOT NULL DEFAULT 'APP',
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at      TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guidance_incident ON guidance_sessions(incident_id);

CREATE TABLE guidance_messages (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id          UUID NOT NULL REFERENCES guidance_sessions(id) ON DELETE CASCADE,
  role                VARCHAR(20) NOT NULL,
  content             TEXT NOT NULL,
  translated_content  TEXT,
  language            VARCHAR(10) NOT NULL DEFAULT 'en',
  audio_url           TEXT,
  is_read             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guidance_messages_session ON guidance_messages(session_id);

-- ─── Verifications ────────────────────────────────────────────

CREATE TABLE verifications (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  incident_id   UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  method        verification_method NOT NULL,
  verified_by   UUID NOT NULL,
  signature     TEXT NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_verifications_incident ON verifications(incident_id);

-- ─── Responders ───────────────────────────────────────────────

CREATE TABLE responders (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  badge_number          VARCHAR(50) UNIQUE NOT NULL,
  user_id               UUID REFERENCES users(id),
  name                  VARCHAR(200) NOT NULL,
  type                  responder_type NOT NULL,
  status                responder_status NOT NULL DEFAULT 'AVAILABLE',
  current_location      GEOGRAPHY(POINT, 4326),
  current_lat           DECIMAL(10, 7),
  current_lng           DECIMAL(10, 7),
  last_location_update  TIMESTAMPTZ,
  unit_id               UUID,
  station_id            UUID,
  capabilities          TEXT[] DEFAULT '{}',
  equipment             TEXT[] DEFAULT '{}',
  certifications        TEXT[] DEFAULT '{}',
  current_incident_id   UUID REFERENCES incidents(id),
  contact_phone         VARCHAR(30),
  contact_email         VARCHAR(255),
  shift_end             TIMESTAMPTZ,
  is_available          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_responders_location ON responders USING GIST(current_location);
CREATE INDEX idx_responders_status ON responders(status);
CREATE INDEX idx_responders_type ON responders(type);
CREATE INDEX idx_responders_available ON responders(is_available) WHERE is_available = TRUE;

-- ─── Responder Units ──────────────────────────────────────────

CREATE TABLE responder_units (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_sign       VARCHAR(50) UNIQUE NOT NULL,
  type            responder_type NOT NULL,
  station_id      UUID,
  vehicle_id      UUID,
  status          responder_status NOT NULL DEFAULT 'AVAILABLE',
  current_lat     DECIMAL(10, 7),
  current_lng     DECIMAL(10, 7),
  capacity        INTEGER NOT NULL DEFAULT 4,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Stations ─────────────────────────────────────────────────

CREATE TABLE stations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(200) NOT NULL,
  types           responder_type[] NOT NULL,
  location        GEOGRAPHY(POINT, 4326),
  lat             DECIMAL(10, 7) NOT NULL,
  lng             DECIMAL(10, 7) NOT NULL,
  address_city    VARCHAR(100),
  address_state   VARCHAR(100),
  address_country VARCHAR(100),
  contact_phone   VARCHAR(30),
  contact_email   VARCHAR(255),
  is_operational  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stations_location ON stations USING GIST(location);

-- ─── IoT Devices ──────────────────────────────────────────────

CREATE TABLE iot_devices (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id       VARCHAR(100) UNIQUE NOT NULL,
  device_type     VARCHAR(50) NOT NULL,
  location        GEOGRAPHY(POINT, 4326),
  lat             DECIMAL(10, 7),
  lng             DECIMAL(10, 7),
  protocol        VARCHAR(20) NOT NULL DEFAULT 'MQTT',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen       TIMESTAMPTZ,
  battery_level   INTEGER,
  firmware_version VARCHAR(50),
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_iot_devices_location ON iot_devices USING GIST(location);
CREATE INDEX idx_iot_devices_type ON iot_devices(device_type);

CREATE TABLE iot_readings (
  id          BIGSERIAL PRIMARY KEY,
  device_id   VARCHAR(100) NOT NULL,
  metric      VARCHAR(100) NOT NULL,
  value       DECIMAL(15, 4) NOT NULL,
  unit        VARCHAR(30) NOT NULL,
  threshold   DECIMAL(15, 4),
  is_anomalous BOOLEAN NOT NULL DEFAULT FALSE,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (recorded_at);

-- Partition by month for time-series performance
CREATE TABLE iot_readings_2026_04 PARTITION OF iot_readings
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE iot_readings_2026_05 PARTITION OF iot_readings
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE INDEX idx_iot_readings_device ON iot_readings(device_id, recorded_at DESC);
CREATE INDEX idx_iot_readings_anomalous ON iot_readings(is_anomalous) WHERE is_anomalous = TRUE;

-- ─── Audit Log ────────────────────────────────────────────────

CREATE TABLE audit_log (
  id          BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id   UUID NOT NULL,
  action      VARCHAR(100) NOT NULL,
  actor_id    UUID,
  actor_role  user_role,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_log_2026_04 PARTITION OF audit_log
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE audit_log_2026_05 PARTITION OF audit_log
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE INDEX idx_audit_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_actor ON audit_log(actor_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ─── System Configuration ─────────────────────────────────────

CREATE TABLE system_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_by  UUID REFERENCES users(id),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO system_config (key, value, description) VALUES
  ('alert_level', '"GREEN"', 'Current national alert level'),
  ('max_dispatch_radius_km', '50', 'Maximum dispatch radius in kilometers'),
  ('dual_verification_required', 'true', 'Require dual verification for CRITICAL incidents'),
  ('ai_confidence_threshold', '0.6', 'Minimum AI confidence for auto-dispatch'),
  ('guidance_languages', '["en","es","fr","ar","zh","hi","pt","ru"]', 'Supported guidance languages');

-- ─── Triggers for updated_at ──────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_incidents_updated_at
  BEFORE UPDATE ON incidents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_responders_updated_at
  BEFORE UPDATE ON responders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Views ────────────────────────────────────────────────────

CREATE VIEW active_incidents AS
SELECT
  i.*,
  u.name AS operator_name,
  COUNT(d.id) AS dispatch_count,
  COUNT(v.id) AS verification_count
FROM incidents i
LEFT JOIN users u ON u.id = i.assigned_operator_id
LEFT JOIN dispatches d ON d.incident_id = i.id
LEFT JOIN verifications v ON v.incident_id = i.id
WHERE i.status NOT IN ('CLOSED', 'RESOLVED')
GROUP BY i.id, u.name;

CREATE VIEW incident_metrics AS
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  type,
  severity,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status = 'CLOSED') AS resolved,
  AVG(EXTRACT(EPOCH FROM (closed_at - created_at))) AS avg_resolution_seconds
FROM incidents
GROUP BY 1, 2, 3;

CREATE VIEW available_responders AS
SELECT
  r.*,
  s.name AS station_name,
  ST_Distance(r.current_location, s.location) AS distance_from_station
FROM responders r
LEFT JOIN stations s ON s.id = r.station_id
WHERE r.is_available = TRUE AND r.status = 'AVAILABLE';
