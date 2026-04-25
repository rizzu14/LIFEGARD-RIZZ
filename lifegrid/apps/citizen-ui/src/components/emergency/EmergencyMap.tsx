// ============================================================
// LIFEGRID – Emergency Map Component
// Embedded map that appears during emergency mode.
// Shows user location + responder positions in real time.
// Minimal black & white compatible design.
// ============================================================

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useAppStore } from '../../store/appStore';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Custom icons ──────────────────────────────────────────────

const userIcon = L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:20px;height:20px;">
      <div style="position:absolute;inset:-6px;border-radius:50%;background:#ef4444;opacity:0.2;animation:ping 1.5s ease-out infinite;"></div>
      <div style="width:20px;height:20px;background:#ef4444;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(239,68,68,0.5);"></div>
    </div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

function makeResponderIcon(type: string): L.DivIcon {
  const config: Record<string, { color: string; emoji: string }> = {
    AMBULANCE:     { color: '#22c55e', emoji: '🚑' },
    FIRE:          { color: '#f97316', emoji: '🚒' },
    POLICE:        { color: '#3b82f6', emoji: '🚔' },
    HAZMAT:        { color: '#eab308', emoji: '☣️' },
    SEARCH_RESCUE: { color: '#8b5cf6', emoji: '🔍' },
    MILITARY:      { color: '#6b7280', emoji: '⚔️' },
  };
  const { color, emoji } = config[type] ?? { color: '#374151', emoji: '🚨' };

  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:32px;height:32px;
        background:#fff;
        border:2px solid ${color};
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:14px;
        box-shadow:0 2px 8px ${color}40;
      ">${emoji}</div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
  });
}

// ── Auto-center on location change ───────────────────────────

function MapController({ center }: { center: [number, number] }) {
  const map = useMap();
  const prevCenter = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!prevCenter.current ||
        Math.abs(prevCenter.current[0] - center[0]) > 0.0001 ||
        Math.abs(prevCenter.current[1] - center[1]) > 0.0001) {
      map.flyTo(center, 15, { duration: 1.2, easeLinearity: 0.5 });
      prevCenter.current = center;
    }
  }, [center, map]);

  return null;
}

// ── Main component ────────────────────────────────────────────

interface EmergencyMapProps {
  height?: number;
}

export function EmergencyMap({ height = 200 }: EmergencyMapProps) {
  const { sosState, userLocation, responderPositions } = useAppStore();

  const isVisible = sosState === 'active' || sosState === 'submitting';

  const center: [number, number] = userLocation
    ? [userLocation.lat, userLocation.lng]
    : [40.7128, -74.006];  // Default: NYC

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.4, ease: [0.0, 0.0, 0.2, 1] }}
          style={{
            width: '100%',
            borderRadius: 16,
            overflow: 'hidden',
            border: '2px solid #e5e7eb',
            position: 'relative',
            flexShrink: 0,
          }}
        >
          {/* Map label */}
          <div style={{
            position: 'absolute', top: 10, left: 10, zIndex: 1000,
            background: 'rgba(255,255,255,0.92)',
            border: '1px solid #e5e7eb',
            borderRadius: 8, padding: '4px 10px',
            display: 'flex', alignItems: 'center', gap: 6,
            backdropFilter: 'blur(4px)',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1s infinite' }} />
            <span style={{ fontSize: 10, fontWeight: 700, color: '#374151', letterSpacing: '0.05em' }}>
              LIVE
            </span>
          </div>

          {/* Responder count badge */}
          {responderPositions.length > 0 && (
            <div style={{
              position: 'absolute', top: 10, right: 10, zIndex: 1000,
              background: '#111827', color: '#fff',
              borderRadius: 8, padding: '4px 10px',
              fontSize: 10, fontWeight: 700,
            }}>
              {responderPositions.length} unit{responderPositions.length > 1 ? 's' : ''} en route
            </div>
          )}

          <MapContainer
            center={center}
            zoom={15}
            style={{ width: '100%', height: '100%' }}
            zoomControl={false}
            attributionControl={false}
            dragging={false}
            scrollWheelZoom={false}
            doubleClickZoom={false}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              maxZoom={19}
            />

            <MapController center={center} />

            {/* User location */}
            {userLocation && (
              <>
                <Marker position={[userLocation.lat, userLocation.lng]} icon={userIcon} />
                <Circle
                  center={[userLocation.lat, userLocation.lng]}
                  radius={80}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.08, weight: 1 }}
                />
              </>
            )}

            {/* Responder positions */}
            {responderPositions.map(r => (
              <Marker
                key={r.responderId}
                position={[r.lat, r.lng]}
                icon={makeResponderIcon(r.type)}
              />
            ))}
          </MapContainer>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
