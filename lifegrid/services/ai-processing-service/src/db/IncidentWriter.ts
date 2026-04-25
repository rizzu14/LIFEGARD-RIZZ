// ============================================================
// LIFEGRID – Incident Writer (AI Processing Service)
// Writes incident records to PostgreSQL
// ============================================================

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://lifegrid:lifegrid@localhost:5432/lifegrid',
  max: 10,
});

export const IncidentWriter = {
  async createInitial(data: {
    id: string;
    referenceCode: string;
    trigger: any;
  }): Promise<any> {
    const { id, referenceCode, trigger } = data;
    const location = trigger.sensorData?.location ?? { lat: 0, lng: 0 };

    await pool.query(
      `INSERT INTO lifegrid.incidents (
        id, reference_code, status, severity, type, alert_level,
        location_lat, location_lng,
        location,
        trigger_source, trigger_raw_input, trigger_language,
        trigger_timestamp, trigger_device_id,
        created_at, updated_at
      ) VALUES (
        $1, $2, 'TRIGGERED', 'MEDIUM', 'UNKNOWN', 'YELLOW',
        $3, $4,
        ST_SetSRID(ST_MakePoint($4, $3), 4326),
        $5, $6, $7, $8, $9,
        NOW(), NOW()
      ) ON CONFLICT (id) DO NOTHING`,
      [
        id, referenceCode,
        location.lat, location.lng,
        trigger.source, trigger.rawInput, trigger.language,
        trigger.timestamp, trigger.deviceId ?? null,
      ],
    );

    return { id, referenceCode };
  },

  async updateNLP(incidentId: string, nlp: any): Promise<void> {
    await pool.query(
      `UPDATE lifegrid.incidents
       SET nlp_analysis = $1,
           type = $2,
           status = 'CLASSIFIED',
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify(nlp), nlp.classified_type ?? 'UNKNOWN', incidentId],
    );
  },

  async updateAIDecision(incidentId: string, decision: any): Promise<void> {
    const severity = decision.risk_score >= 80 ? 'CRITICAL'
      : decision.risk_score >= 60 ? 'HIGH'
      : decision.risk_score >= 30 ? 'MEDIUM' : 'LOW';

    const alertLevel = severity === 'CRITICAL' ? 'RED'
      : severity === 'HIGH' ? 'ORANGE'
      : severity === 'MEDIUM' ? 'YELLOW' : 'GREEN';

    await pool.query(
      `UPDATE lifegrid.incidents
       SET ai_decision = $1,
           severity = $2,
           alert_level = $3,
           status = 'DISPATCHED',
           updated_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(decision), severity, alertLevel, incidentId],
    );
  },
};
