import { DatabaseManager } from '../DatabaseManager';
import type { Incident, IncidentStatus, IncidentSeverity } from '@lifegrid/shared-types';

interface FindAllQuery {
  page: number;
  pageSize: number;
  status?: IncidentStatus;
  severity?: IncidentSeverity;
  type?: string;
  from?: string;
  to?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
}

export class IncidentRepository {
  static async create(incident: Incident): Promise<Incident> {
    await DatabaseManager.query(
      `INSERT INTO lifegrid.incidents (
        id, reference_code, status, severity, type, alert_level,
        location_lat, location_lng,
        location,
        trigger_source, trigger_raw_input, trigger_language,
        trigger_timestamp, trigger_device_id, trigger_caller_phone,
        trigger_media_urls, nlp_analysis, ai_decision,
        reported_by, is_public, tags, notes, media_urls,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8,
        ST_SetSRID(ST_MakePoint($8, $7), 4326),
        $9, $10, $11,
        $12, $13, $14,
        $15, $16, $17,
        $18, $19, $20, $21, $22,
        $23, $24
      )`,
      [
        incident.id, incident.referenceCode, incident.status, incident.severity,
        incident.type, incident.alertLevel,
        incident.location.lat, incident.location.lng,
        incident.trigger.source, incident.trigger.rawInput, incident.trigger.language,
        incident.trigger.timestamp, incident.trigger.deviceId ?? null,
        incident.trigger.callerInfo?.phone ?? null,
        incident.trigger.mediaUrls ?? [],
        incident.nlpAnalysis ? JSON.stringify(incident.nlpAnalysis) : null,
        incident.aiDecision ? JSON.stringify(incident.aiDecision) : null,
        incident.reportedBy ?? null, incident.isPublic,
        incident.tags, incident.notes, incident.mediaUrls,
        incident.createdAt, incident.updatedAt,
      ],
    );
    return incident;
  }

  static async findById(id: string): Promise<Incident | null> {
    const row = await DatabaseManager.queryOne<any>(
      `SELECT i.*,
        json_agg(DISTINCT d.*) FILTER (WHERE d.id IS NOT NULL) AS dispatches,
        json_agg(DISTINCT r.*) FILTER (WHERE r.id IS NOT NULL) AS routes,
        json_agg(DISTINCT gs.*) FILTER (WHERE gs.id IS NOT NULL) AS guidance_sessions,
        json_agg(DISTINCT v.*) FILTER (WHERE v.id IS NOT NULL) AS verifications
       FROM lifegrid.incidents i
       LEFT JOIN lifegrid.dispatches d ON d.incident_id = i.id
       LEFT JOIN lifegrid.routes r ON r.incident_id = i.id
       LEFT JOIN lifegrid.guidance_sessions gs ON gs.incident_id = i.id
       LEFT JOIN lifegrid.verifications v ON v.incident_id = i.id
       WHERE i.id = $1
       GROUP BY i.id`,
      [id],
    );
    return row ? this.mapRow(row) : null;
  }

  static async findAll(query: FindAllQuery): Promise<{ incidents: Incident[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    if (query.status) {
      conditions.push(`i.status = $${paramIdx++}`);
      params.push(query.status);
    }
    if (query.severity) {
      conditions.push(`i.severity = $${paramIdx++}`);
      params.push(query.severity);
    }
    if (query.type) {
      conditions.push(`i.type = $${paramIdx++}`);
      params.push(query.type);
    }
    if (query.from) {
      conditions.push(`i.created_at >= $${paramIdx++}`);
      params.push(query.from);
    }
    if (query.to) {
      conditions.push(`i.created_at <= $${paramIdx++}`);
      params.push(query.to);
    }
    if (query.lat && query.lng && query.radiusKm) {
      conditions.push(`ST_DWithin(i.location, ST_SetSRID(ST_MakePoint($${paramIdx++}, $${paramIdx++}), 4326)::geography, $${paramIdx++})`);
      params.push(query.lng, query.lat, query.radiusKm * 1000);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = (query.page - 1) * query.pageSize;

    const [rows, countResult] = await Promise.all([
      DatabaseManager.query<any>(
        `SELECT i.* FROM lifegrid.incidents i ${where}
         ORDER BY
           CASE i.severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
           i.created_at DESC
         LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
        [...params, query.pageSize, offset],
      ),
      DatabaseManager.queryOne<{ count: string }>(
        `SELECT COUNT(*) FROM lifegrid.incidents i ${where}`,
        params,
      ),
    ]);

    return {
      incidents: rows.map(this.mapRow),
      total: parseInt(countResult?.count ?? '0', 10),
    };
  }

  static async update(id: string, updates: Partial<Incident>): Promise<Incident> {
    const setClauses: string[] = [];
    const params: any[] = [];
    let paramIdx = 1;

    const fieldMap: Record<string, string> = {
      status: 'status',
      severity: 'severity',
      alertLevel: 'alert_level',
      nlpAnalysis: 'nlp_analysis',
      aiDecision: 'ai_decision',
      assignedOperatorId: 'assigned_operator_id',
      closedAt: 'closed_at',
      closureReport: 'closure_report',
      notes: 'notes',
      tags: 'tags',
    };

    for (const [key, col] of Object.entries(fieldMap)) {
      if (key in updates) {
        const val = (updates as any)[key];
        setClauses.push(`${col} = $${paramIdx++}`);
        params.push(typeof val === 'object' && val !== null && !Array.isArray(val)
          ? JSON.stringify(val)
          : val,
        );
      }
    }

    if (setClauses.length === 0) {
      return (await this.findById(id))!;
    }

    setClauses.push(`updated_at = NOW()`);
    params.push(id);

    await DatabaseManager.query(
      `UPDATE lifegrid.incidents SET ${setClauses.join(', ')} WHERE id = $${paramIdx}`,
      params,
    );

    return (await this.findById(id))!;
  }

  static async getSummaryStats(): Promise<Record<string, unknown>> {
    const stats = await DatabaseManager.queryOne<any>(
      `SELECT
        COUNT(*) FILTER (WHERE status NOT IN ('CLOSED', 'RESOLVED')) AS active_incidents,
        COUNT(*) FILTER (WHERE severity = 'CRITICAL' AND status NOT IN ('CLOSED', 'RESOLVED')) AS critical_incidents,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS incidents_24h,
        COUNT(*) FILTER (WHERE status = 'CLOSED' AND closed_at > NOW() - INTERVAL '24 hours') AS resolved_24h,
        AVG(EXTRACT(EPOCH FROM (closed_at - created_at))) FILTER (WHERE status = 'CLOSED') AS avg_resolution_seconds
       FROM lifegrid.incidents`,
    );
    return stats ?? {};
  }

  private static mapRow(row: any): Incident {
    return {
      id: row.id,
      referenceCode: row.reference_code,
      status: row.status,
      severity: row.severity,
      type: row.type,
      alertLevel: row.alert_level,
      trigger: {
        source: row.trigger_source,
        rawInput: row.trigger_raw_input,
        language: row.trigger_language,
        timestamp: row.trigger_timestamp?.toISOString(),
        deviceId: row.trigger_device_id,
        callerInfo: row.trigger_caller_phone ? { phone: row.trigger_caller_phone } : undefined,
        mediaUrls: row.trigger_media_urls,
      },
      nlpAnalysis: row.nlp_analysis,
      aiDecision: row.ai_decision,
      dispatches: row.dispatches ?? [],
      routes: row.routes ?? [],
      guidanceSessions: row.guidance_sessions ?? [],
      verifications: row.verifications ?? [],
      location: { lat: parseFloat(row.location_lat), lng: parseFloat(row.location_lng) },
      address: row.address_formatted ? {
        formatted: row.address_formatted,
        city: row.address_city,
        state: row.address_state,
        country: row.address_country,
      } : undefined,
      reportedBy: row.reported_by,
      assignedOperatorId: row.assigned_operator_id,
      assignedCommanderId: row.assigned_commander_id,
      isPublic: row.is_public,
      tags: row.tags ?? [],
      notes: row.notes ?? [],
      mediaUrls: row.media_urls ?? [],
      closedAt: row.closed_at?.toISOString(),
      closureReport: row.closure_report,
      createdAt: row.created_at?.toISOString(),
      updatedAt: row.updated_at?.toISOString(),
    };
  }
}
