// ============================================================
// LIFEGRID – Route Optimizer
// OSRM integration with emergency vehicle priority
// ============================================================

import axios from 'axios';

const OSRM_URL = process.env.OSRM_URL ?? 'http://router.project-osrm.org';

interface RouteRequest {
  origin:      { lat: number; lng: number };
  destination: { lat: number; lng: number };
  severity:    string;
  incidentType: string;
}

export const RouteOptimizer = {
  async optimize(req: RouteRequest): Promise<any> {
    try {
      const url = `${OSRM_URL}/route/v1/driving/${req.origin.lng},${req.origin.lat};${req.destination.lng},${req.destination.lat}`;
      const res = await axios.get(url, {
        params: { overview: 'full', geometries: 'geojson', steps: false, alternatives: 2 },
        timeout: 5000,
      });

      const route = res.data.routes[0];
      const alts  = res.data.routes.slice(1);

      // Emergency vehicles get speed boost
      const speedFactor = req.severity === 'CRITICAL' ? 0.70
        : req.severity === 'HIGH' ? 0.80 : 0.90;

      return {
        origin:           req.origin,
        destination:      req.destination,
        waypoints:        route.geometry.coordinates.map(([lng, lat]: number[]) => ({ lat, lng })),
        distanceKm:       route.distance / 1000,
        estimatedMinutes: Math.round((route.duration * speedFactor) / 60),
        trafficFactor:    speedFactor,
        alternateRoutes:  alts.map((a: any, i: number) => ({
          routeId:          `alt-${i + 1}`,
          distanceKm:       a.distance / 1000,
          estimatedMinutes: Math.round((a.duration * speedFactor) / 60),
          reason:           'Alternative route',
        })),
        gisLayers: ['roads', 'hospitals', 'stations'],
      };
    } catch {
      // Direct route fallback
      const dist = haversineKm(req.origin, req.destination);
      const speed = req.severity === 'CRITICAL' ? 80 : 60;
      return {
        origin:           req.origin,
        destination:      req.destination,
        waypoints:        [req.origin, req.destination],
        distanceKm:       dist,
        estimatedMinutes: Math.round((dist / speed) * 60),
        trafficFactor:    1.0,
        alternateRoutes:  [],
        gisLayers:        [],
      };
    }
  },
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
