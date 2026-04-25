// ============================================================
// LIFEGRID – Responder Fetcher (AI Processing Service)
// ============================================================

import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://lifegrid:lifegrid@localhost:5432/lifegrid',
  max: 10,
});

const TYPE_MAP: Record<string, string[]> = {
  MEDICAL:          ['AMBULANCE', 'MEDICAL_TEAM'],
  FIRE:             ['FIRE', 'AMBULANCE'],
  NATURAL_DISASTER: ['SEARCH_RESCUE', 'DISASTER_MGMT', 'MILITARY'],
  SECURITY:         ['POLICE'],
  INFRASTRUCTURE:   ['FIRE', 'POLICE'],
  CHEMICAL:         ['HAZMAT', 'FIRE', 'AMBULANCE'],
  BIOLOGICAL:       ['HAZMAT', 'MEDICAL_TEAM'],
  RADIOLOGICAL:     ['HAZMAT', 'MILITARY'],
  NUCLEAR:          ['HAZMAT', 'MILITARY', 'DISASTER_MGMT'],
  CYBER:            ['CYBER_UNIT'],
  MASS_CASUALTY:    ['AMBULANCE', 'POLICE', 'FIRE', 'MEDICAL_TEAM', 'MILITARY'],
  UNKNOWN:          ['POLICE', 'AMBULANCE'],
};

export const ResponderFetcher = {
  async findAvailable(
    location: { lat: number; lng: number },
    incidentType: string,
    radiusKm: number,
  ): Promise<any[]> {
    try {
      const rows = await pool.query(
        `SELECT id, type, status, current_lat, current_lng, capabilities, equipment
         FROM lifegrid.responders
         WHERE is_available = TRUE
           AND status = 'AVAILABLE'
           AND ST_DWithin(
             current_location,
             ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
             $3
           )
         ORDER BY ST_Distance(
           current_location,
           ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography
         ) ASC
         LIMIT 20`,
        [location.lat, location.lng, radiusKm * 1000],
      );

      return rows.rows.map(r => ({
        id: r.id,
        type: r.type,
        status: r.status,
        currentLocation: { lat: parseFloat(r.current_lat), lng: parseFloat(r.current_lng) },
        capabilities: r.capabilities ?? [],
        equipment: r.equipment ?? [],
        isAvailable: true,
      }));
    } catch {
      return [];
    }
  },
};
