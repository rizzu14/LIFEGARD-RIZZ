import { DatabaseManager } from '../database/DatabaseManager';
import { logger } from '../utils/logger';
import type { Incident } from '@lifegrid/shared-types';

export class AuditService {
  static async log(
    entityType: string,
    entityId: string,
    action: string,
    actorId?: string,
    actorRole?: string,
    oldValue?: unknown,
    newValue?: unknown,
  ): Promise<void> {
    try {
      await DatabaseManager.query(
        `INSERT INTO lifegrid.audit_log
          (entity_type, entity_id, action, actor_id, actor_role, old_value, new_value, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [
          entityType, entityId, action, actorId ?? null, actorRole ?? null,
          oldValue ? JSON.stringify(oldValue) : null,
          newValue ? JSON.stringify(newValue) : null,
        ],
      );
    } catch (err) {
      logger.error('[AuditService] Failed to write audit log:', err);
    }
  }

  static async logPipelineCompletion(
    incident: Incident,
    stepTimings: Record<string, number>,
    errors: any[],
  ): Promise<void> {
    await this.log(
      'INCIDENT', incident.id, 'PIPELINE_COMPLETE',
      undefined, undefined,
      undefined,
      { stepTimings, errors, referenceCode: incident.referenceCode },
    );
  }

  static async logIncidentClosure(incident: Incident): Promise<void> {
    await this.log(
      'INCIDENT', incident.id, 'INCIDENT_CLOSED',
      incident.assignedOperatorId, 'OPERATOR',
      undefined,
      { closedAt: incident.closedAt, verifications: incident.verifications.length },
    );
  }
}
