import { Pool } from 'pg';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://lifegrid:lifegrid@localhost:5432/lifegrid',
  max: 10,
});

export const DispatchDB = {
  async createDispatch(dispatch: any): Promise<void> {
    await pool.query(
      `INSERT INTO lifegrid.dispatches
        (id, incident_id, responder_id, dispatched_at, encrypted_channel, route_id, estimated_arrival)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        dispatch.dispatchId, dispatch.incidentId, dispatch.responderId,
        dispatch.dispatchedAt, dispatch.encryptedChannel,
        dispatch.routeId ?? null, dispatch.estimatedArrival,
      ],
    );
  },

  async updateResponderStatus(responderId: string, status: string, incidentId: string): Promise<void> {
    await pool.query(
      `UPDATE lifegrid.responders
       SET status = $1, is_available = FALSE, current_incident_id = $2, updated_at = NOW()
       WHERE id = $3`,
      [status, incidentId, responderId],
    );
  },

  async getResponderLocation(responderId: string): Promise<{ lat: number; lng: number } | null> {
    const row = await pool.query(
      'SELECT current_lat, current_lng FROM lifegrid.responders WHERE id = $1',
      [responderId],
    );
    if (!row.rows[0]) return null;
    return { lat: parseFloat(row.rows[0].current_lat), lng: parseFloat(row.rows[0].current_lng) };
  },
};
