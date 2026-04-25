import axios from 'axios';
import type { GeoCoordinate, RouteOptimization, IncidentType, IncidentSeverity } from '@lifegrid/shared-types';
import { logger } from '../utils/logger';

const OSRM_URL = process.env.OSRM_URL ?? 'http://router.project-osrm.org';

interface RouteRequest {
  origin: GeoCoordinate;
  destination: GeoCoordinate;
  incidentType: IncidentType;
  severity: IncidentSeverity;
  avoidZones: any[];
}

export class RouteService {
  static async optimize(request: RouteRequest): Promise<RouteOptimization> {
    try {
      // OSRM routing API
      const url = `${OSRM_URL}/route/v1/driving/${request.origin.lng},${request.origin.lat};${request.destination.lng},${request.destination.lat}`;
      const response = await axios.get(url, {
        params: {
          overview: 'full',
          geometries: 'geojson',
          steps: true,
          alternatives: 2,
        },
        timeout: 5000,
      });

      const route = response.data.routes[0];
      const alternates = response.data.routes.slice(1);

      // Emergency vehicles get priority routing (simulated traffic factor)
      const trafficFactor = request.severity === 'CRITICAL' ? 0.7 : 0.85;

      return {
        routeId: '',  // set by caller
        responderId: '',  // set by caller
        origin: request.origin,
        destination: request.destination,
        waypoints: route.geometry.coordinates.map(([lng, lat]: number[]) => ({ lat, lng })),
        distanceKm: route.distance / 1000,
        estimatedMinutes: Math.round((route.duration * trafficFactor) / 60),
        trafficFactor,
        alternateRoutes: alternates.map((alt: any, i: number) => ({
          routeId: `alt-${i + 1}`,
          distanceKm: alt.distance / 1000,
          estimatedMinutes: Math.round((alt.duration * trafficFactor) / 60),
          reason: 'Alternative route',
        })),
        gisLayers: ['roads', 'hospitals', 'stations'],
      };
    } catch (err) {
      logger.warn('[RouteService] OSRM unavailable, using direct route');
      return this.directRoute(request);
    }
  }

  private static directRoute(request: RouteRequest): RouteOptimization {
    const distKm = this.haversineKm(request.origin, request.destination);
    const speedKmh = request.severity === 'CRITICAL' ? 80 : 60;

    return {
      routeId: '',
      responderId: '',
      origin: request.origin,
      destination: request.destination,
      waypoints: [request.origin, request.destination],
      distanceKm: distKm,
      estimatedMinutes: Math.round((distKm / speedKmh) * 60),
      trafficFactor: 1.0,
      alternateRoutes: [],
      gisLayers: [],
    };
  }

  private static haversineKm(a: GeoCoordinate, b: GeoCoordinate): number {
    const R = 6371;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
}
