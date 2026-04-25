import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { asyncHandler } from '../utils/asyncHandler';

export const gisRouter = Router();

// GET /gis/layers  — available GIS/satellite layers
gisRouter.get(
  '/layers',
  asyncHandler(async (_req: Request, res: Response) => {
    const layers = [
      {
        layerId: 'osm-standard',
        name: 'OpenStreetMap',
        type: 'ROADS',
        provider: 'OpenStreetMap',
        lastUpdated: new Date().toISOString(),
        resolution: '1m',
        tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        opacity: 1,
        isActive: true,
      },
      {
        layerId: 'esri-satellite',
        name: 'Satellite Imagery',
        type: 'TERRAIN',
        provider: 'ESRI',
        lastUpdated: new Date().toISOString(),
        resolution: '0.5m',
        tileUrl: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        opacity: 1,
        isActive: false,
      },
      {
        layerId: 'opentopomap',
        name: 'Terrain',
        type: 'TERRAIN',
        provider: 'OpenTopoMap',
        lastUpdated: new Date().toISOString(),
        resolution: '10m',
        tileUrl: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        opacity: 1,
        isActive: false,
      },
    ];

    res.json({ success: true, data: layers, timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);

// GET /gis/stations  — responder station locations
gisRouter.get(
  '/stations',
  asyncHandler(async (_req: Request, res: Response) => {
    // In production: fetch from database
    res.json({ success: true, data: [], timestamp: new Date().toISOString(), requestId: uuidv4() });
  }),
);
