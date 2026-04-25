-- ============================================================
-- LIFEGRID – Security & Legal Database Schema Extension
-- ============================================================

SET search_path TO lifegrid, public;

-- ─── Consent Records (GDPR Art. 6/9) ─────────────────────────

CREATE TABLE IF NOT EXISTS consent_records (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose         VARCHAR(100) NOT NULL,
  legal_basis     TEXT NOT NULL,
  jurisdiction    VARCHAR(10) NOT NULL DEFAULT 'DEFAULT',
  consented_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  withdrawn_at    TIMESTAMPTZ,
  ip_hash         VARCHAR(64),  -- pseudonymized IP
  user_agent_hash VARCHAR(64),  -- pseudonymized UA
  UNIQUE(user_id, purpose)
);

CREATE INDEX idx_consent_user ON consent_records(user_id);
CREATE INDEX idx_consent_purpose ON consent_records(purpose);

-- ─── Good Samaritan Tokens ────────────────────────────────────

CREATE TABLE IF NOT EXISTS good_samaritan_tokens (
  token_id        UUID PRIMARY KEY,
  incident_id     UUID NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  jurisdiction    VARCHAR(10) NOT NULL DEFAULT 'DEFAULT',
  legal_basis     TEXT NOT NULL,
  immunity_scope  TEXT NOT NULL,
  reporter_hash   VARCHAR(64) NOT NULL,  -- one-way hash, cannot reverse
  signature       VARCHAR(64) NOT NULL,
  issued_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_gst_incident ON good_samaritan_tokens(incident_id);

-- ─── Data Erasure Requests (GDPR Art. 17) ────────────────────

CREATE TABLE IF NOT EXISTS erasure_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL,
  requested_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at    TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  erased_fields   TEXT[] DEFAULT '{}',
  retained_fields TEXT[] DEFAULT '{}',
  retention_reason TEXT,
  processed_by    UUID REFERENCES users(id)
);

CREATE INDEX idx_erasure_user ON erasure_requests(user_id);
CREATE INDEX idx_erasure_status ON erasure_requests(status);

-- ─── Data Breach Register (GDPR Art. 33) ─────────────────────

CREATE TABLE IF NOT EXISTS breach_register (
  breach_id         UUID PRIMARY KEY,
  type              VARCHAR(100) NOT NULL,
  affected_records  INTEGER NOT NULL DEFAULT 0,
  data_categories   TEXT[] DEFAULT '{}',
  discovered_at     TIMESTAMPTZ NOT NULL,
  notified_at       TIMESTAMPTZ,
  dpa_notified_at   TIMESTAMPTZ,
  users_notified_at TIMESTAMPTZ,
  description       TEXT NOT NULL,
  remediation       TEXT,
  severity          VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Security Events ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS security_events (
  id              BIGSERIAL PRIMARY KEY,
  event_type      VARCHAR(50) NOT NULL,
  severity        VARCHAR(20) NOT NULL DEFAULT 'INFO',
  ip_address      INET,
  user_id         UUID REFERENCES users(id),
  threat_score    INTEGER DEFAULT 0,
  details         JSONB DEFAULT '{}',
  resolved        BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE security_events_2026_04 PARTITION OF security_events
  FOR VALUES FROM ('2026-04-01') TO ('2026-05-01');
CREATE TABLE security_events_2026_05 PARTITION OF security_events
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE INDEX idx_sec_events_type ON security_events(event_type, created_at DESC);
CREATE INDEX idx_sec_events_ip ON security_events(ip_address);
CREATE INDEX idx_sec_events_user ON security_events(user_id);

-- ─── API Keys ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS api_keys (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_hash        VARCHAR(64) UNIQUE NOT NULL,  -- SHA-256 of raw key
  name            VARCHAR(200) NOT NULL,
  owner_id        UUID REFERENCES users(id),
  purpose         VARCHAR(100) NOT NULL,
  permissions     TEXT[] DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);
CREATE INDEX idx_api_keys_owner ON api_keys(owner_id);

-- ─── Witness Protection Registry ─────────────────────────────

CREATE TABLE IF NOT EXISTS witness_protection (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  original_id     UUID NOT NULL,
  protected_id    VARCHAR(20) UNIQUE NOT NULL,
  activated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_by    UUID REFERENCES users(id),
  reason          TEXT NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE INDEX idx_wp_original ON witness_protection(original_id);
CREATE INDEX idx_wp_protected ON witness_protection(protected_id);

-- ─── Key Rotation Log ─────────────────────────────────────────

CREATE TABLE IF NOT EXISTS key_rotation_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_purpose     VARCHAR(100) NOT NULL,
  old_key_id      VARCHAR(100),
  new_key_id      VARCHAR(100) NOT NULL,
  rotated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_by      UUID REFERENCES users(id),
  reason          VARCHAR(200) NOT NULL DEFAULT 'SCHEDULED_ROTATION'
);

-- ─── Immutable security audit trigger ────────────────────────

CREATE OR REPLACE FUNCTION prevent_security_audit_delete()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Security audit records cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_no_delete_security_events
  BEFORE DELETE ON security_events
  FOR EACH ROW EXECUTE FUNCTION prevent_security_audit_delete();

-- ─── Row-level security policies ─────────────────────────────

ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE erasure_requests ENABLE ROW LEVEL SECURITY;

-- Citizens can only see their own consent records
CREATE POLICY citizen_consent_policy ON consent_records
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id', TRUE)::UUID
         OR current_setting('app.current_user_role', TRUE) IN ('OPERATOR','SUPERVISOR','COMMANDER','SYSTEM_ADMIN'));

-- Citizens can only see their own erasure requests
CREATE POLICY citizen_erasure_policy ON erasure_requests
  FOR SELECT
  USING (user_id = current_setting('app.current_user_id', TRUE)::UUID
         OR current_setting('app.current_user_role', TRUE) IN ('SYSTEM_ADMIN'));

-- ─── Data retention cleanup function ─────────────────────────

CREATE OR REPLACE FUNCTION cleanup_expired_data()
RETURNS void AS $$
BEGIN
  -- Delete expired location data (90 days)
  UPDATE lifegrid.incidents
  SET location_lat = NULL, location_lng = NULL, location = NULL
  WHERE created_at < NOW() - INTERVAL '90 days'
    AND status IN ('CLOSED', 'RESOLVED')
    AND location_lat IS NOT NULL;

  -- Delete expired biometric data (30 days)
  -- (face embeddings stored in AI engine, not PostgreSQL)

  -- Archive old IoT readings (365 days)
  -- (handled by partition dropping)

  RAISE NOTICE 'Data retention cleanup completed at %', NOW();
END;
$$ LANGUAGE plpgsql;

-- Schedule cleanup (requires pg_cron extension in production)
-- SELECT cron.schedule('0 2 * * *', 'SELECT lifegrid.cleanup_expired_data()');
