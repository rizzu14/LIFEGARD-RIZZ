-- ============================================================
-- LIFEGRID – Database Optimization Schema
-- Billion-user scale performance enhancements
-- ============================================================

SET search_path TO lifegrid, public;

-- ─── Materialized views (pre-computed aggregations) ───────────

-- Active incidents with full join (refreshed every 30s)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_active_incidents AS
SELECT
  i.id,
  i.reference_code,
  i.status,
  i.severity,
  i.type,
  i.alert_level,
  i.location_lat,
  i.location_lng,
  i.trigger_source,
  i.created_at,
  i.updated_at,
  i.assigned_operator_id,
  u.name AS operator_name,
  COUNT(DISTINCT d.id) AS dispatch_count,
  COUNT(DISTINCT v.id) AS verification_count,
  COALESCE(i.ai_decision->>'riskScore', '0')::INTEGER AS risk_score
FROM incidents i
LEFT JOIN users u ON u.id = i.assigned_operator_id
LEFT JOIN dispatches d ON d.incident_id = i.id
LEFT JOIN verifications v ON v.incident_id = i.id
WHERE i.status NOT IN ('CLOSED', 'RESOLVED')
GROUP BY i.id, u.name
WITH DATA;

CREATE UNIQUE INDEX ON mv_active_incidents(id);
CREATE INDEX ON mv_active_incidents(severity, created_at DESC);
CREATE INDEX ON mv_active_incidents(status);

-- Refresh function (called by pg_cron every 30s)
CREATE OR REPLACE FUNCTION refresh_active_incidents()
RETURNS void AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY lifegrid.mv_active_incidents;
END;
$$ LANGUAGE plpgsql;

-- ─── Available responders (refreshed every 5s) ────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_available_responders AS
SELECT
  r.id,
  r.badge_number,
  r.name,
  r.type,
  r.status,
  r.current_lat,
  r.current_lng,
  r.current_location,
  r.capabilities,
  r.station_id,
  s.name AS station_name,
  s.lat AS station_lat,
  s.lng AS station_lng
FROM responders r
LEFT JOIN stations s ON s.id = r.station_id
WHERE r.is_available = TRUE AND r.status = 'AVAILABLE'
WITH DATA;

CREATE UNIQUE INDEX ON mv_available_responders(id);
CREATE INDEX ON mv_available_responders USING GIST(current_location);
CREATE INDEX ON mv_available_responders(type);

-- ─── Incident metrics (refreshed every 1 minute) ─────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_incident_metrics AS
SELECT
  DATE_TRUNC('hour', created_at) AS hour,
  type,
  severity,
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE status = 'CLOSED') AS resolved,
  AVG(EXTRACT(EPOCH FROM (closed_at - created_at)))
    FILTER (WHERE status = 'CLOSED') AS avg_resolution_seconds,
  PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (closed_at - created_at)))
    FILTER (WHERE status = 'CLOSED') AS p95_resolution_seconds
FROM incidents
WHERE created_at > NOW() - INTERVAL '30 days'
GROUP BY 1, 2, 3
WITH DATA;

CREATE INDEX ON mv_incident_metrics(hour DESC);
CREATE INDEX ON mv_incident_metrics(type, severity);

-- ─── Heatmap data (refreshed every 5 minutes) ────────────────

CREATE MATERIALIZED VIEW IF NOT EXISTS mv_incident_heatmap AS
SELECT
  ROUND(location_lat::NUMERIC, 2) AS lat_cell,
  ROUND(location_lng::NUMERIC, 2) AS lng_cell,
  type,
  COUNT(*) AS incident_count,
  AVG(CASE severity WHEN 'CRITICAL' THEN 4 WHEN 'HIGH' THEN 3 WHEN 'MEDIUM' THEN 2 ELSE 1 END) AS avg_severity_score
FROM incidents
WHERE created_at > NOW() - INTERVAL '7 days'
  AND location_lat IS NOT NULL
GROUP BY 1, 2, 3
WITH DATA;

CREATE INDEX ON mv_incident_heatmap(lat_cell, lng_cell);

-- ─── Partial indexes for hot query paths ─────────────────────

-- Active incidents only (most queries filter by status)
CREATE INDEX IF NOT EXISTS idx_incidents_active
  ON incidents(severity, created_at DESC)
  WHERE status NOT IN ('CLOSED', 'RESOLVED');

-- Available responders by type (dispatch queries)
CREATE INDEX IF NOT EXISTS idx_responders_available_by_type
  ON responders(type, current_lat, current_lng)
  WHERE is_available = TRUE AND status = 'AVAILABLE';

-- Recent IoT anomalies (alert queries)
CREATE INDEX IF NOT EXISTS idx_iot_recent_anomalies
  ON iot_readings(device_id, recorded_at DESC)
  WHERE is_anomalous = TRUE;

-- Unread guidance messages
CREATE INDEX IF NOT EXISTS idx_guidance_unread
  ON guidance_messages(session_id, created_at)
  WHERE is_read = FALSE;

-- ─── Covering indexes (avoid heap fetches) ───────────────────

-- Incident list query (covers all fields needed for list view)
CREATE INDEX IF NOT EXISTS idx_incidents_list_covering
  ON incidents(status, severity, created_at DESC)
  INCLUDE (id, reference_code, type, location_lat, location_lng, assigned_operator_id);

-- Responder location query (covers all fields for dispatch)
CREATE INDEX IF NOT EXISTS idx_responders_dispatch_covering
  ON responders(type, status)
  INCLUDE (id, current_lat, current_lng, capabilities, station_id)
  WHERE is_available = TRUE;

-- ─── Automatic partition management ──────────────────────────

-- Function to create next month's partitions automatically
CREATE OR REPLACE FUNCTION create_monthly_partitions()
RETURNS void AS $$
DECLARE
  next_month DATE := DATE_TRUNC('month', NOW() + INTERVAL '1 month');
  next_month_end DATE := next_month + INTERVAL '1 month';
  month_str TEXT := TO_CHAR(next_month, 'YYYY_MM');
BEGIN
  -- IoT readings partition
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS lifegrid.iot_readings_%s PARTITION OF lifegrid.iot_readings
     FOR VALUES FROM (%L) TO (%L)',
    month_str, next_month, next_month_end
  );

  -- Audit log partition
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS lifegrid.audit_log_%s PARTITION OF lifegrid.audit_log
     FOR VALUES FROM (%L) TO (%L)',
    month_str, next_month, next_month_end
  );

  -- Security events partition
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS lifegrid.security_events_%s PARTITION OF lifegrid.security_events
     FOR VALUES FROM (%L) TO (%L)',
    month_str, next_month, next_month_end
  );

  RAISE NOTICE 'Created partitions for %', month_str;
END;
$$ LANGUAGE plpgsql;

-- ─── Query optimization hints ─────────────────────────────────

-- Tune PostgreSQL for high-concurrency workload
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '8GB';
ALTER SYSTEM SET effective_cache_size = '24GB';
ALTER SYSTEM SET maintenance_work_mem = '2GB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '64MB';
ALTER SYSTEM SET default_statistics_target = 200;
ALTER SYSTEM SET random_page_cost = 1.1;          -- SSD storage
ALTER SYSTEM SET effective_io_concurrency = 200;  -- SSD
ALTER SYSTEM SET work_mem = '64MB';
ALTER SYSTEM SET max_worker_processes = 16;
ALTER SYSTEM SET max_parallel_workers_per_gather = 8;
ALTER SYSTEM SET max_parallel_workers = 16;
ALTER SYSTEM SET max_parallel_maintenance_workers = 4;

-- Enable JIT compilation for complex queries
ALTER SYSTEM SET jit = on;
ALTER SYSTEM SET jit_above_cost = 100000;

-- ─── Scheduled jobs (requires pg_cron) ───────────────────────

-- Refresh materialized views
-- SELECT cron.schedule('*/30 * * * * *', 'SELECT lifegrid.refresh_active_incidents()');
-- SELECT cron.schedule('*/5 * * * * *',  'REFRESH MATERIALIZED VIEW CONCURRENTLY lifegrid.mv_available_responders');
-- SELECT cron.schedule('* * * * *',       'REFRESH MATERIALIZED VIEW CONCURRENTLY lifegrid.mv_incident_metrics');
-- SELECT cron.schedule('*/5 * * * *',     'REFRESH MATERIALIZED VIEW CONCURRENTLY lifegrid.mv_incident_heatmap');

-- Create next month's partitions on the 25th of each month
-- SELECT cron.schedule('0 0 25 * *', 'SELECT lifegrid.create_monthly_partitions()');

-- Data retention cleanup
-- SELECT cron.schedule('0 2 * * *', 'SELECT lifegrid.cleanup_expired_data()');

-- VACUUM and ANALYZE hot tables
-- SELECT cron.schedule('0 3 * * *', 'VACUUM ANALYZE lifegrid.incidents, lifegrid.responders, lifegrid.dispatches');
