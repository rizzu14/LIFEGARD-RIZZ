import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers, Crosshair, ZoomIn, ZoomOut } from 'lucide-react';
import type { Incident } from '@lifegrid/shared-types';

// Fix Leaflet default icon
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ff1744',
  HIGH:     '#ff6d00',
  MEDIUM:   '#ffd600',
  LOW:      '#00c853',
};

// Custom incident marker
function createIncidentIcon(severity: string, isSelected: boolean): L.DivIcon {
  const color = SEVERITY_COLORS[severity] ?? '#888';
  const size = isSelected ? 16 : 10;
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width: ${size}px; height: ${size}px;
        background: ${color};
        border: 2px solid ${isSelected ? '#fff' : color};
        border-radius: 50%;
        box-shadow: 0 0 ${isSelected ? '12px' : '6px'} ${color}80;
        ${severity === 'CRITICAL' ? 'animation: alert-pulse 1.5s infinite;' : ''}
      "></div>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

// Responder marker
function createResponderIcon(type: string): L.DivIcon {
  const symbols: Record<string, string> = {
    POLICE: '🚔', FIRE: '🚒', AMBULANCE: '🚑',
    HAZMAT: '☣', SEARCH_RESCUE: '🔍', MILITARY: '⚔',
  };
  return L.divIcon({
    className: '',
    html: `<div style="font-size: 16px; line-height: 1;">${symbols[type] ?? '🚨'}</div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

interface CommandMapProps {
  incidents: Incident[];
  selectedIncidentId: string | null;
  onIncidentSelect: (id: string) => void;
}

const GIS_LAYERS = [
  { id: 'osm',       label: 'Standard',  url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
  { id: 'satellite', label: 'Satellite', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
  { id: 'terrain',   label: 'Terrain',   url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' },
];

export function CommandMap({ incidents, selectedIncidentId, onIncidentSelect }: CommandMapProps) {
  const [activeLayer, setActiveLayer] = useState('osm');
  const [showLayers, setShowLayers] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const mapRef = useRef<L.Map | null>(null);

  const selectedIncident = incidents.find(i => i.id === selectedIncidentId);

  // Pan to selected incident
  useEffect(() => {
    if (selectedIncident && mapRef.current) {
      mapRef.current.flyTo(
        [selectedIncident.location.lat, selectedIncident.location.lng],
        15,
        { duration: 1.2 },
      );
    }
  }, [selectedIncident]);

  const currentLayer = GIS_LAYERS.find(l => l.id === activeLayer) ?? GIS_LAYERS[0];

  return (
    <div className="relative w-full h-full bg-[#050505]">
      <MapContainer
        center={[40.7128, -74.006]}
        zoom={11}
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
        ref={mapRef as any}
      >
        <TileLayer
          url={currentLayer.url}
          attribution=""
          maxZoom={19}
        />

        {/* Incident markers */}
        {incidents.map(incident => (
          <React.Fragment key={incident.id}>
            <Marker
              position={[incident.location.lat, incident.location.lng]}
              icon={createIncidentIcon(incident.severity, incident.id === selectedIncidentId)}
              eventHandlers={{ click: () => onIncidentSelect(incident.id) }}
            >
              <Popup>
                <div style={{ fontFamily: 'monospace', fontSize: '11px', color: '#e8e8e8', background: '#0d0d0d', padding: '8px', minWidth: '180px' }}>
                  <div style={{ color: SEVERITY_COLORS[incident.severity], fontWeight: 'bold', marginBottom: '4px' }}>
                    {incident.severity} · {incident.type.replace('_', ' ')}
                  </div>
                  <div style={{ color: '#888', marginBottom: '2px' }}>{incident.referenceCode}</div>
                  <div style={{ color: '#555', fontSize: '10px' }}>{incident.status}</div>
                </div>
              </Popup>
            </Marker>

            {/* Affected zone circle for CRITICAL */}
            {incident.severity === 'CRITICAL' && (
              <Circle
                center={[incident.location.lat, incident.location.lng]}
                radius={500}
                pathOptions={{
                  color: '#ff1744',
                  fillColor: '#ff1744',
                  fillOpacity: 0.05,
                  weight: 1,
                  dashArray: '4 4',
                }}
              />
            )}
          </React.Fragment>
        ))}
      </MapContainer>

      {/* ── Map controls overlay ──────────────────────────── */}
      <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-1">

        {/* Layer switcher */}
        <div className="relative">
          <button
            onClick={() => setShowLayers(v => !v)}
            className="w-8 h-8 bg-[#0d0d0d] border border-[#1a1a1a] flex items-center justify-center hover:bg-[#1a1a1a] transition-colors"
            title="Map layers"
          >
            <Layers className="w-3.5 h-3.5 text-[#888]" />
          </button>
          {showLayers && (
            <div className="absolute right-0 top-9 bg-[#0d0d0d] border border-[#1a1a1a] min-w-[120px]">
              {GIS_LAYERS.map(layer => (
                <button
                  key={layer.id}
                  onClick={() => { setActiveLayer(layer.id); setShowLayers(false); }}
                  className={`
                    w-full text-left px-3 py-2 text-[9px] font-mono tracking-widest uppercase
                    hover:bg-[#1a1a1a] transition-colors
                    ${activeLayer === layer.id ? 'text-white' : 'text-[#555]'}
                  `}
                >
                  {activeLayer === layer.id && '▶ '}{layer.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Center on incidents */}
        <button
          onClick={() => {
            if (mapRef.current && incidents.length > 0) {
              const bounds = L.latLngBounds(incidents.map(i => [i.location.lat, i.location.lng]));
              mapRef.current.fitBounds(bounds, { padding: [40, 40] });
            }
          }}
          className="w-8 h-8 bg-[#0d0d0d] border border-[#1a1a1a] flex items-center justify-center hover:bg-[#1a1a1a] transition-colors"
          title="Fit all incidents"
        >
          <Crosshair className="w-3.5 h-3.5 text-[#888]" />
        </button>
      </div>

      {/* ── Incident count overlay ────────────────────────── */}
      <div className="absolute bottom-3 left-3 z-[1000] flex gap-2">
        {Object.entries(SEVERITY_COLORS).map(([sev, color]) => {
          const count = incidents.filter(i => i.severity === sev).length;
          if (count === 0) return null;
          return (
            <div
              key={sev}
              className="flex items-center gap-1.5 px-2 py-1 bg-[#0d0d0d] border border-[#1a1a1a]"
            >
              <span className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span className="text-[8px] font-mono" style={{ color }}>{count}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
