import { DatabaseManager } from '../DatabaseManager';
import type { Responder, GeoCoordinate, IncidentType, ResponderStatus } from '@lifegrid/shared-types';

export class ResponderRepository {
  static async findAvailable(
    location: GeoCoordinate,
    incidentType: IncidentType,
    radiusKm: number,
  ): Promise<Responder[]> {
    const rows = await DatabaseManager.query<any>(
      `SELECT r.*,
        ST_Distance(r.current_location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) / 1000 AS distance_km
       FROM lifegrid.responders r
       WHERE r.is_available = TRUE
         AND r.status = 'AVAILABLE'
         AND ST_DWithin(
           r.current_location,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
           $3
         )
       ORDER BY distance_km ASC
       LIMIT 20`,
      [location.lat, location.lng, radiusKm * 1000],
    );
    return rows.map(this.mapRow);
  }

  static async findById(id: string): Promise<Responder | null> {
    const row = await DatabaseManager.queryOne<any>(
      'SELECT * FROM lifegrid.responders WHERE id = $1',
      [id],
    );
    return row ? this.mapRow(row) : null;
  }

  static async updateStatus(
    id: string,
    status: ResponderStatus,
    incidentId?: string,
  ): Promise<void> {
    await DatabaseManager.query(
      `UPDATE lifegrid.responders
       SET status = $1, is_available = $2, current_incident_id = $3, updated_at = NOW()
       WHERE id = $4`,
      [status, status === 'AVAILABLE', incidentId ?? null, id],
    );
  }

  static async updateLocation(id: string, location: GeoCoordinate): Promise<void> {
    await DatabaseManager.query(
      `UPDATE lifegrid.responders
       SET current_lat = $1, current_lng = $2,
           current_location = ST_SetSRID(ST_MakePoint($2, $1), 4326),
           last_location_update = NOW()
       WHERE id = $3`,
      [location.lat, location.lng, id],
    );
  }

  static async findAll(): Promise<Responder[]> {
    const rows = await DatabaseManager.query<any>(
      'SELECT * FROM lifegrid.responders ORDER BY status, type',
    );
    return rows.map(this.mapRow);
  }

  private static mapRow(row: any): Responder {
    return {
      id: row.id,
      badgeNumber: row.badge_number,
      name: row.name,
      type: row.type,
      status: row.status,
      currentLocation: { lat: parseFloat(row.current_lat ?? 0), lng: parseFloat(row.current_lng ?? 0) },
      lastLocationUpdate: row.last_location_update?.toISOString(),
      unitId: row.unit_id,
      stationId: row.station_id,
      capabilities: row.capabilities ?? [],
      equipment: row.equipment ?? [],
      certifications: row.certifications ?? [],
      currentIncidentId: row.current_incident_id,
      contactInfo: { phone: row.contact_phone, email: row.contact_email },
      shiftEnd: row.shift_end?.toISOString(),
      isAvailable: row.is_available,
    };
  }
}
