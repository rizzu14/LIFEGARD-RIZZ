// ============================================================
// LIFEGRID – Tactical Map v2
// GIS command map with heatmap, flood, traffic, satellite layers
// ============================================================

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  MapContainer, TileLayer, Marker, Popup, Circle,
  CircleMarker, Polyline, useMap, LayerGroup,
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, Crosshair, ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useOperatorStore } from '../../store/operatorStore';
import type { Incident } from '@lifegrid/shared-types';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Icon factories ────────────────────────────────────────────

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ff1744', HIGH: '#ff6d00', MEDIUM: '#ffd600', LOW: '#00c853',
};

const RESPONDER_COLORS: Record<string, string> = {
  AMBULANCE: '#00c853', FIRE: '#ff6d00', POLICE: '#00aaff',
  HAZMAT: '#ffd600', SEARCH_RESCUE: '#fff', MILITARY: '#888',
  MEDICAL_TEAM: '#00c853', CYBER_UNIT: '#aa88ff', DISASTER_MGMT: '#ff8c00',
};

function makeIncidentIcon(severity: string, selected: boolean): L.DivIcon {
  const color = SEVERITY_COLORS[severity] ?? '#888';
  const size = selected ? 18 : 11;
  const pulse = severity === 'CRITICAL' ? 'animation:alert-pulse 1.5s infinite;' : '';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:${size}px;height:${size}px;
      background:${color};
      border:${selected ? '2px' : '1.5px'} solid ${selected ? '#fff' : color};
      border-radius:50%;
      box-shadow:0 0 ${selected ? 14 : 6}px ${color}80;
      ${pulse}
    "></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function makeResponderIcon(type: string, heading?: number): L.DivIcon {
  const color = RESPONDER_COLORS[type] ?? '#fff';
  const rotation = heading !== undefined ? `transform:rotate(${heading}deg);` : '';
  return L.divIcon({
    className: '',
    html: `<div style="
      width:10px;height:10px;
      background:${color};
      border:1.5px solid rgba(0,0,0,0.5);
      border-radius:50%;
      box-shadow:0 0 6px ${color}60;
      ${rotation}
    "></div>`,
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });
}

// ── Map auto-fit ──────────────────────────────────────────────

function MapController({
  incidents, selectedId,
}: { incidents: Incident[]; selectedId: string | null }) {
  const map = useMap();

  useEffect(() => {
    const selected = incidents.find(i => i.id === selectedId);
    if (selected && selected.location.lat !== 0) {
      map.flyTo([selected.location.lat, selected.location.lng], 15, { duration: 1.0 });
    }
  }, [selectedId, incidents, map]);

  return null;
}

// ── Heatmap canvas renderer ───────────────────────────────────

function HeatmapLayer({ points, opacity }: { points: any[]; opacity: number }) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!points.length) return;

    // Create canvas overlay
    const canvas = document.createElement('canvas');
    canvas.className = 'heatmap-canvas';
    canvas.style.opacity = String(opacity);
    map.getContainer().appendChild(canvas);
    canvasRef.current = canvas;

    const render = () => {
      const size = map.getSize();
      canvas.width = size.x;
      canvas.height = size.y;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, size.x, size.y);

      points.forEach(({ lat, lng, weight }) => {
        const pt = map.latLngToContainerPoint([lat, lng]);
        const radius = Math.max(20, weight * 30);
        const gradient = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, radius);
        gradient.addColorStop(0, `rgba(255, 23, 68, ${Math.min(weight * 0.8, 0.9)})`);
        gradient.addColorStop(0.4, `rgba(255, 109, 0, ${Math.min(weight * 0.5, 0.6)})`);
        gradient.addColorStop(1, 'rgba(255, 214, 0, 0)');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, radius, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    render();
    map.on('move zoom', render);

    return () => {
      map.off('move zoom', render);
      canvas.remove();
    };
  }, [map, points, opacity]);

  return null;
}

// ── Main component ────────────────────────────────────────────

interface TacticalMapProps {
  incidents: Incident[];
  selectedIncidentId: string | null;
  onIncidentSelect: (id: string) => void;
}

const TILE_LAYERS = {
  standard:  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  terrain:   'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
};

export function TacticalMap({ incidents, selectedIncidentId, onIncidentSelect }: TacticalMapProps) {
  const {
    mapLayers, toggleLayer, setLayerOpacity,
    heatmapPoints, floodZones, responderPositions,
  } = useOperatorStore();

  const mapRef = useRef<L.Map | null>(null);
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [basemap, setBasemap] = useState<'standard' | 'satellite' | 'terrain'>('standard');
  const [measureMode, setMeasureMode] = useState(false);

  const heatmapLayer  = mapLayers.find(l => l.id === 'heatmap')!;
  const floodLayer    = mapLayers.find(l => l.id === 'flood')!;
  const trafficLayer  = mapLayers.find(l => l.id === 'traffic')!;
  const evacuLayer    = mapLayers.find(l => l.id === 'evacuation')!;

  const fitAll = useCallback(() => {
    if (!mapRef.current || incidents.length === 0) return;
    const valid = incidents.filter(i => i.location.lat !== 0);
    if (valid.length === 0) return;
    const bounds = L.latLngBounds(valid.map(i => [i.location.lat, i.location.lng]));
    mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }, [incidents]);

  return (
    <div className="relative w-full h-full bg-[#030303]">

      {/* ── Leaflet map ──────────────────────────────────── */}
      <MapContainer
        center={[40.7128, -74.006]}
        zoom={11}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
        attributionControl={false}
        ref={mapRef as any}
        className={measureMode ? 'map-crosshair' : ''}
      >
        {/* Base tile layer */}
        <TileLayer url={TILE_LAYERS[basemap]} maxZoom={19} />

        {/* Map controller */}
        <MapController incidents={incidents} selectedId={selectedIncidentId} />

        {/* ── Heatmap layer ─────────────────────────────── */}
        {heatmapLayer.isVisible && heatmapPoints.length > 0 && (
          <HeatmapLayer points={heatmapPoints} opacity={heatmapLayer.opacity} />
        )}

        {/* ── Flood zones ───────────────────────────────── */}
        {floodLayer.isVisible && (
          <LayerGroup>
            {floodZones.map(zone => (
              <Circle
                key={zone.id}
                center={[zone.centerLat, zone.centerLng]}
                radius={zone.radiusM}
                pathOptions={{
                  color: '#00aaff',
                  fillColor: '#00aaff',
                  fillOpacity: zone.probability * floodLayer.opacity * 0.5,
                  weight: 1,
                  dashArray: '4 4',
                }}
              >
                <Popup>
                  <div className="text-[10px] font-mono">
                    <div style={{ color: '#00aaff' }}>FLOOD ZONE · {zone.riskLevel}</div>
                    <div>Probability: {(zone.probability * 100).toFixed(0)}%</div>
                    <div>Population: ~{zone.estimatedPopulation.toLocaleString()}</div>
                  </div>
                </Popup>
              </Circle>
            ))}
          </LayerGroup>
        )}

        {/* ── Evacuation routes (simulated) ─────────────── */}
        {evacuLayer.isVisible && (
          <LayerGroup>
            {incidents.filter(i => i.severity === 'CRITICAL').map(i => (
              <Circle
                key={`evac-${i.id}`}
                center={[i.location.lat, i.location.lng]}
                radius={2000}
                pathOptions={{
                  color: '#ffd600',
                  fillColor: 'transparent',
                  weight: 2,
                  dashArray: '8 4',
                  opacity: 0.6,
                }}
              />
            ))}
          </LayerGroup>
        )}

        {/* ── Incident markers ──────────────────────────── */}
        <LayerGroup>
          {incidents.map(incident => (
            <React.Fragment key={incident.id}>
              <Marker
                position={[incident.location.lat, incident.location.lng]}
                icon={makeIncidentIcon(incident.severity, incident.id === selectedIncidentId)}
                eventHandlers={{ click: () => onIncidentSelect(incident.id) }}
                zIndexOffset={incident.id === selectedIncidentId ? 1000 : 0}
              >
                <Popup>
                  <div style={{ fontFamily: 'monospace', fontSize: '10px', minWidth: '180px' }}>
                    <div style={{ color: SEVERITY_COLORS[incident.severity], fontWeight: 'bold', marginBottom: '4px' }}>
                      {incident.severity} · {incident.type.replace('_', ' ')}
                    </div>
                    <div style={{ color: '#888', marginBottom: '2px' }}>{incident.referenceCode}</div>
                    <div style={{ color: '#555' }}>{incident.status.replace('_', ' ')}</div>
                    {incident.aiDecision && (
                      <div style={{ color: '#555', marginTop: '4px' }}>
                        Risk: {incident.aiDecision.riskScore}/100
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>

              {/* Affected zone for CRITICAL */}
              {incident.severity === 'CRITICAL' && (
                <Circle
                  center={[incident.location.lat, incident.location.lng]}
                  radius={800}
                  pathOptions={{
                    color: '#ff1744',
                    fillColor: '#ff1744',
                    fillOpacity: 0.04,
                    weight: 1,
                    dashArray: '3 3',
                  }}
                />
              )}
            </React.Fragment>
          ))}
        </LayerGroup>

        {/* ── Responder positions ────────────────────────── */}
        <LayerGroup>
          {responderPositions.map(r => (
            <Marker
              key={r.responderId}
              position={[r.lat, r.lng]}
              icon={makeResponderIcon(r.type, r.heading)}
              zIndexOffset={500}
            >
              <Popup>
                <div style={{ fontFamily: 'monospace', fontSize: '10px' }}>
                  <div style={{ color: RESPONDER_COLORS[r.type] ?? '#fff', fontWeight: 'bold' }}>
                    {r.type.replace('_', ' ')}
                  </div>
                  <div style={{ color: '#888' }}>{r.status.replace('_', ' ')}</div>
                  {r.incidentId && <div style={{ color: '#555' }}>→ {r.incidentId.slice(0, 8)}</div>}
                </div>
              </Popup>
            </Marker>
          ))}
        </LayerGroup>
      </MapContainer>

      {/* ── Layer control panel ──────────────────────────── */}
      <div className="layer-control">
        <button
          onClick={() => setShowLayerPanel(v => !v)}
          className={`layer-btn ${showLayerPanel ? 'active' : ''}`}
          title="Map layers"
        >
          <Layers className="w-3 h-3" />
          <span>Layers</span>
        </button>

        <AnimatePresence>
          {showLayerPanel && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="flex flex-col gap-px mt-1"
            >
              {/* Basemap selector */}
              <div className="layer-btn" style={{ cursor: 'default', color: '#333' }}>
                <span>BASEMAP</span>
              </div>
              {(['standard', 'satellite', 'terrain'] as const).map(b => (
                <button
                  key={b}
                  onClick={() => setBasemap(b)}
                  className={`layer-btn ${basemap === b ? 'active' : ''}`}
                >
                  <span className="layer-dot" style={{ background: basemap === b ? '#fff' : '#333' }} />
                  {b.charAt(0).toUpperCase() + b.slice(1)}
                </button>
              ))}

              {/* Overlay layers */}
              <div className="layer-btn mt-1" style={{ cursor: 'default', color: '#333' }}>
                <span>OVERLAYS</span>
              </div>
              {mapLayers.map(layer => (
                <button
                  key={layer.id}
                  onClick={() => toggleLayer(layer.id)}
                  className={`layer-btn ${layer.isVisible ? 'active' : ''}`}
                >
                  <span
                    className="layer-dot"
                    style={{ background: layer.isVisible ? (layer.color ?? '#fff') : '#333' }}
                  />
                  {layer.name}
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Map controls ─────────────────────────────────── */}
      <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-1">
        <button
          onClick={() => mapRef.current?.zoomIn()}
          className="w-7 h-7 bg-[#0d0d0d] border border-[#1a1a1a] flex items-center justify-center hover:bg-[#1a1a1a] transition-colors"
          title="Zoom in"
        >
          <ZoomIn className="w-3 h-3 text-[#888]" />
        </button>
        <button
          onClick={() => mapRef.current?.zoomOut()}
          className="w-7 h-7 bg-[#0d0d0d] border border-[#1a1a1a] flex items-center justify-center hover:bg-[#1a1a1a] transition-colors"
          title="Zoom out"
        >
          <ZoomOut className="w-3 h-3 text-[#888]" />
        </button>
        <button
          onClick={fitAll}
          className="w-7 h-7 bg-[#0d0d0d] border border-[#1a1a1a] flex items-center justify-center hover:bg-[#1a1a1a] transition-colors"
          title="Fit all incidents"
        >
          <Crosshair className="w-3 h-3 text-[#888]" />
        </button>
        <button
          onClick={() => mapRef.current?.setView([40.7128, -74.006], 11)}
          className="w-7 h-7 bg-[#0d0d0d] border border-[#1a1a1a] flex items-center justify-center hover:bg-[#1a1a1a] transition-colors"
          title="Reset view"
        >
          <RotateCcw className="w-3 h-3 text-[#888]" />
        </button>
      </div>

      {/* ── Incident count legend ─────────────────────────── */}
      <div className="absolute bottom-3 left-3 z-[1000] flex gap-1.5">
        {Object.entries(SEVERITY_COLORS).map(([sev, color]) => {
          const count = incidents.filter(i => i.severity === sev).length;
          if (count === 0) return null;
          return (
            <div key={sev} className="flex items-center gap-1 px-2 py-1 bg-[#0d0d0d]/90 border border-[#1a1a1a]">
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span className="text-[8px] font-mono" style={{ color }}>{count}</span>
            </div>
          );
        })}
        {responderPositions.length > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-[#0d0d0d]/90 border border-[#1a1a1a]">
            <span className="w-2 h-2 rounded-full bg-white" />
            <span className="text-[8px] font-mono text-white">{responderPositions.length} units</span>
          </div>
        )}
      </div>

      {/* ── Flood legend (when active) ────────────────────── */}
      {floodLayer.isVisible && floodZones.length > 0 && (
        <div className="flood-legend">
          <div className="text-[7px] font-mono text-[#444] tracking-widest uppercase mb-2">Flood Risk</div>
          {[['HIGH', '#00aaff', 0.8], ['MEDIUM', '#00aaff', 0.5], ['LOW', '#00aaff', 0.2]].map(([label, color, opacity]) => (
            <div key={label as string} className="flex items-center gap-2 mb-1">
              <div className="w-3 h-3 rounded-sm" style={{ background: color as string, opacity: opacity as number }} />
              <span className="text-[8px] font-mono text-[#555]">{label as string}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Coordinate display ───────────────────────────── */}
      <div className="absolute bottom-3 right-3 z-[1000]">
        <CoordinateDisplay mapRef={mapRef} />
      </div>
    </div>
  );
}

// ── Coordinate display ────────────────────────────────────────

function CoordinateDisplay({ mapRef }: { mapRef: React.RefObject<L.Map | null> }) {
  const [coords, setCoords] = useState<{ lat: number; lng: number; zoom: number } | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const update = () => {
      const c = map.getCenter();
      setCoords({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    };

    update();
    map.on('move zoom', update);
    return () => { map.off('move zoom', update); };
  }, [mapRef]);

  if (!coords) return null;

  return (
    <div className="bg-[#0d0d0d]/90 border border-[#1a1a1a] px-2 py-1">
      <span className="text-[8px] font-mono text-[#333] tabular-nums">
        {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)} · Z{coords.zoom}
      </span>
    </div>
  );
}
