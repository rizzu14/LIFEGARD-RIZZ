// ============================================================
// LIFEGRID – Emergency Map Component
//
// IMPORTANT: This component is ONLY used on the Track screen.
// It is NOT imported on the Home screen.
//
// Leaflet is lazy-loaded — it does NOT load on app open.
// Map only initialises when this component actually mounts.
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/appStore';

// ── Lazy Leaflet loader ───────────────────────────────────────
// Leaflet and react-leaflet are imported dynamically so they
// never execute on the Home screen or app startup.

let leafletLoaded = false;
let L: any = null;
let MapContainer: any = null;
let TileLayer: any = null;
let Marker: any = null;
let Circle: any = null;
let Polyline: any = null;
let useMap: any = null;

async function loadLeaflet() {
  if (leafletLoaded) return;
  const [leaflet, reactLeaflet] = await Promise.all([
    import('leaflet'),
    import('react-leaflet'),
  ]);
  await import('leaflet/dist/leaflet.css');

  L = leaflet.default ?? leaflet;
  MapContainer = reactLeaflet.MapContainer;
  TileLayer    = reactLeaflet.TileLayer;
  Marker       = reactLeaflet.Marker;
  Circle       = reactLeaflet.Circle;
  Polyline     = reactLeaflet.Polyline;
  useMap       = reactLeaflet.useMap;

  // Fix default icons
  delete (L.Icon.Default.prototype as any)._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
    iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
    shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  });

  leafletLoaded = true;
}

// ── Map auto-fit ──────────────────────────────────────────────

function MapFitBounds({ userPos, responderPos }: {
  userPos: [number, number] | null;
  responderPos: [number, number] | null;
}) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (!userPos || !L) return;
    if (responderPos) {
      const bounds = L.latLngBounds([userPos, responderPos]);
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15, animate: true, duration: 1.0 });
      fitted.current = true;
    } else if (!fitted.current) {
      map.flyTo(userPos, 15, { duration: 0.8 });
      fitted.current = true;
    }
  }, [userPos?.[0], userPos?.[1], responderPos?.[0], responderPos?.[1]]);

  return null;
}

// ── Icon factories (created after Leaflet loads) ──────────────

function getUserIcon() {
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">
        <div style="position:absolute;width:36px;height:36px;border-radius:50%;background:#ef4444;opacity:0.15;animation:ping 1.5s ease-out infinite;"></div>
        <div style="width:16px;height:16px;background:#ef4444;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(239,68,68,0.5);position:relative;z-index:1;"></div>
      </div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

function getResponderIcon(type: string) {
  const cfg: Record<string, { color: string; emoji: string }> = {
    AMBULANCE:     { color: '#22c55e', emoji: '🚑' },
    FIRE:          { color: '#f97316', emoji: '🚒' },
    POLICE:        { color: '#3b82f6', emoji: '🚔' },
    HAZMAT:        { color: '#eab308', emoji: '☣️' },
    SEARCH_RESCUE: { color: '#8b5cf6', emoji: '🔍' },
    MILITARY:      { color: '#6b7280', emoji: '⚔️' },
  };
  const { color, emoji } = cfg[type] ?? { color: '#374151', emoji: '🚨' };
  return L.divIcon({
    className: '',
    html: `<div style="width:34px;height:34px;background:#fff;border:2.5px solid ${color};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;box-shadow:0 2px 8px ${color}40;">${emoji}</div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });
}

// ── Main component ────────────────────────────────────────────

interface EmergencyMapProps {
  height?: number;
}

export function EmergencyMap({ height = 200 }: EmergencyMapProps) {
  const { sosState, userLocation, responderPositions } = useAppStore();

  const [ready, setReady]     = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  const isVisible = sosState === 'active' || sosState === 'submitting';

  // Load Leaflet only when map becomes visible
  useEffect(() => {
    if (!isVisible) return;
    loadLeaflet()
      .then(() => setReady(true))
      .catch(() => setMapError(true));
  }, [isVisible]);

  const userPos: [number, number] | null = userLocation
    ? [userLocation.lat, userLocation.lng]
    : null;

  const responder = responderPositions[0];
  const responderPos: [number, number] | null = responder
    ? [responder.lat, responder.lng]
    : null;

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
            background: '#f9fafb',
          }}
        >
          {/* Loading */}
          {!ready && !mapError && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#f9fafb' }}>
              <div style={{ width: 28, height: 28, border: '3px solid #e5e7eb', borderTopColor: '#374151', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              <span style={{ fontSize: 12, color: '#9ca3af' }}>Loading map…</span>
            </div>
          )}

          {/* Error */}
          {mapError && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, background: '#fef2f2' }}>
              <span style={{ fontSize: 20 }}>⚠️</span>
              <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>Map unavailable</span>
              <span style={{ fontSize: 11, color: '#6b7280' }}>Your emergency is still active</span>
            </div>
          )}

          {/* Map — only rendered after Leaflet loads */}
          {ready && !mapError && MapContainer && (
            <MapContainer
              center={userPos ?? [40.7128, -74.006]}
              zoom={14}
              style={{ width: '100%', height: '100%' }}
              zoomControl={false}
              attributionControl={false}
              whenReady={() => setMapLoaded(true)}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                eventHandlers={{ tileerror: () => setMapError(true) }}
              />

              <MapFitBounds userPos={userPos} responderPos={responderPos} />

              {userPos && (
                <>
                  <Marker position={userPos} icon={getUserIcon()} />
                  <Circle
                    center={userPos}
                    radius={80}
                    pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.06, weight: 1 }}
                  />
                </>
              )}

              {responderPos && responder && (
                <Marker position={responderPos} icon={getResponderIcon(responder.type)} />
              )}

              {userPos && responderPos && (
                <Polyline
                  positions={[userPos, responderPos]}
                  pathOptions={{ color: '#374151', weight: 1.5, dashArray: '5 4', opacity: 0.35 }}
                />
              )}
            </MapContainer>
          )}

          {/* Labels */}
          {mapLoaded && (
            <>
              {userPos && (
                <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 1000, background: 'rgba(255,255,255,0.95)', border: '1.5px solid #ef4444', borderRadius: 8, padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>You</span>
                </div>
              )}
              {responderPos && (
                <div style={{ position: 'absolute', bottom: 10, right: 10, zIndex: 1000, background: 'rgba(255,255,255,0.95)', border: '1.5px solid #22c55e', borderRadius: 8, padding: '3px 9px', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e' }} />
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>Responder</span>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
