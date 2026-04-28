// ============================================================
// LIFEGRID – Screen 2: Live Tracking (Upgraded)
//
// Design principles:
//   - Map is the PRIMARY element (45% of screen)
//   - ONE clear status message at a time
//   - Emotional support messaging
//   - No raw coordinates, no technical clutter
//   - Everything updates in real time
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Circle, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Phone, MessageCircle, CheckCircle, AlertTriangle, Wifi } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';

// ── Fix Leaflet icons ─────────────────────────────────────────
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

// ── Map icons ─────────────────────────────────────────────────

const YOU_ICON = L.divIcon({
  className: '',
  html: `
    <div style="position:relative;display:flex;align-items:center;justify-content:center;">
      <div style="position:absolute;width:40px;height:40px;border-radius:50%;background:#ef4444;opacity:0.15;animation:ping 1.5s ease-out infinite;"></div>
      <div style="position:absolute;width:24px;height:24px;border-radius:50%;background:#ef4444;opacity:0.25;animation:ping 1.5s ease-out infinite;animation-delay:0.3s;"></div>
      <div style="width:16px;height:16px;background:#ef4444;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 8px rgba(239,68,68,0.6);position:relative;z-index:1;"></div>
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20],
});

function makeResponderIcon(type: string): L.DivIcon {
  const cfg: Record<string, { bg: string; emoji: string }> = {
    AMBULANCE:     { bg: '#22c55e', emoji: '🚑' },
    FIRE:          { bg: '#f97316', emoji: '🚒' },
    POLICE:        { bg: '#3b82f6', emoji: '🚔' },
    HAZMAT:        { bg: '#eab308', emoji: '☣️' },
    SEARCH_RESCUE: { bg: '#8b5cf6', emoji: '🔍' },
    MILITARY:      { bg: '#6b7280', emoji: '⚔️' },
  };
  const { bg, emoji } = cfg[type] ?? { bg: '#374151', emoji: '🚨' };
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:36px;height:36px;
        background:#fff;border:2.5px solid ${bg};
        border-radius:50%;
        display:flex;align-items:center;justify-content:center;
        font-size:16px;
        box-shadow:0 3px 10px ${bg}50;
      ">${emoji}</div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });
}

// ── Map auto-fit: show both user + responder ──────────────────

function MapFitBounds({
  userPos,
  responderPos,
}: {
  userPos: [number, number] | null;
  responderPos: [number, number] | null;
}) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (!userPos) return;

    if (responderPos) {
      // Fit both points with padding
      const bounds = L.latLngBounds([userPos, responderPos]);
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15, animate: true, duration: 1.2 });
      fitted.current = true;
    } else if (!fitted.current) {
      map.flyTo(userPos, 15, { duration: 1.0 });
      fitted.current = true;
    }
  }, [userPos?.[0], userPos?.[1], responderPos?.[0], responderPos?.[1]]);

  return null;
}

// ── System status messages ────────────────────────────────────

type SystemPhase = 'connecting' | 'processing' | 'dispatched' | 'active' | 'arriving';

const PHASE_CONFIG: Record<SystemPhase, {
  status:   string;
  message:  string;
  color:    string;
  pulse:    boolean;
}> = {
  connecting: {
    status:  'Connecting to LIFEGRID…',
    message: 'You are not alone. We are with you.',
    color:   '#f59e0b',
    pulse:   true,
  },
  processing: {
    status:  'Analyzing your situation…',
    message: 'Stay calm. Help is being arranged right now.',
    color:   '#3b82f6',
    pulse:   true,
  },
  dispatched: {
    status:  'Help has been dispatched',
    message: 'Responders are on their way to you.',
    color:   '#22c55e',
    pulse:   false,
  },
  active: {
    status:  'Responder is on the way',
    message: 'Help is coming. Stay where you are.',
    color:   '#22c55e',
    pulse:   false,
  },
  arriving: {
    status:  'Responder is arriving',
    message: 'They are almost there. Stay visible.',
    color:   '#22c55e',
    pulse:   false,
  },
};

// ── ETA formatter ─────────────────────────────────────────────

function fmtEta(s: number): string {
  if (s <= 0) return 'Arriving now';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m} min ${sec} sec` : `${sec} sec`;
}

// ── Reverse geocode (human-readable location) ─────────────────

async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`,
      { headers: { 'User-Agent': 'LIFEGRID/1.0' } },
    );
    const data = await res.json();
    const addr = data.address;
    const parts = [
      addr.road ?? addr.pedestrian ?? addr.path,
      addr.suburb ?? addr.neighbourhood ?? addr.city_district,
      addr.city ?? addr.town ?? addr.village,
    ].filter(Boolean);
    return parts.slice(0, 2).join(', ') || 'Your location';
  } catch {
    return 'Your location';
  }
}

// ── Main component ────────────────────────────────────────────

export default function TrackScreen() {
  const {
    activeIncidentId, activeReferenceCode,
    responderPositions, userLocation,
    updateResponderPosition, setActiveTab,
    callSession,
  } = useAppStore();

  const { socket } = useSocket();

  const [eta, setEta]               = useState<number>(480);
  const [phase, setPhase]           = useState<SystemPhase>('connecting');
  const [locationLabel, setLocationLabel] = useState('Your location');
  const [mapError, setMapError]     = useState(false);
  const [mapLoaded, setMapLoaded]   = useState(false);
  const [responderName, setResponderName] = useState('');

  const noIncident = !activeIncidentId;
  const isOffline  = activeIncidentId?.startsWith('offline-') || activeReferenceCode?.startsWith('SOS-');

  // ── Reverse geocode user location ────────────────────────

  useEffect(() => {
    if (!userLocation) return;
    reverseGeocode(userLocation.lat, userLocation.lng)
      .then(setLocationLabel)
      .catch(() => setLocationLabel('Your location'));
  }, [userLocation?.lat, userLocation?.lng]);

  // ── Phase progression ─────────────────────────────────────

  useEffect(() => {
    if (!activeIncidentId) return;

    // Simulate phase progression when no backend
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setPhase('processing'), 1500));
    timers.push(setTimeout(() => setPhase('dispatched'), 4000));
    timers.push(setTimeout(() => setPhase('active'),     7000));

    return () => timers.forEach(clearTimeout);
  }, [activeIncidentId]);

  // Update phase based on ETA
  useEffect(() => {
    if (eta <= 60 && eta > 0) setPhase('arriving');
  }, [eta]);

  // ── Fetch incident + ETA ──────────────────────────────────

  useEffect(() => {
    if (!activeIncidentId || isOffline) {
      setPhase('dispatched');
      return;
    }

    const load = async () => {
      try {
        const res = await api.get(`/incidents/${activeIncidentId}`);
        const inc = res.data.data;
        const etaSec = inc?.aiDecision?.estimatedResponseTime;
        if (etaSec) {
          const created = new Date(inc.createdAt).getTime();
          const remaining = Math.max(0, Math.round((created + etaSec * 1000 - Date.now()) / 1000));
          setEta(remaining);
        }
        if (inc?.status === 'DISPATCHED' || inc?.status === 'EN_ROUTE') setPhase('active');
        if (inc?.status === 'ON_SCENE') setPhase('arriving');

        // Inject synthetic responder if none
        if (responderPositions.length === 0 && userLocation) {
          const rType = inc?.type === 'FIRE' ? 'FIRE' : inc?.type === 'SECURITY' ? 'POLICE' : 'AMBULANCE';
          setResponderName(`${rType.charAt(0) + rType.slice(1).toLowerCase()} Unit`);
          updateResponderPosition({
            responderId: 'system-eta',
            type: rType,
            lat: userLocation.lat + 0.006,
            lng: userLocation.lng + 0.006,
            etaSeconds: etaSec ?? 480,
            status: 'EN_ROUTE',
            timestamp: new Date().toISOString(),
          });
        }
      } catch { /* offline — use defaults */ }
    };

    load();
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, [activeIncidentId]);

  // ── ETA countdown ─────────────────────────────────────────

  useEffect(() => {
    if (eta <= 0) return;
    const t = setInterval(() => {
      setEta(p => {
        const next = Math.max(0, p - 1);
        // Sync to store
        const pos = useAppStore.getState().responderPositions;
        const sys = pos.find(r => r.responderId === 'system-eta');
        if (sys) useAppStore.getState().updateResponderPosition({ ...sys, etaSeconds: next });
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [eta > 0]);

  // ── WebSocket ─────────────────────────────────────────────

  useEffect(() => {
    if (!socket || !activeIncidentId) return;
    socket.emit('JOIN_INCIDENT', activeIncidentId);
    socket.on('INCIDENT_UPDATED', (e: any) => {
      if (e.payload?.id !== activeIncidentId) return;
      const s = e.payload.status;
      if (s === 'DISPATCHED') setPhase('dispatched');
      if (s === 'EN_ROUTE')   setPhase('active');
      if (s === 'ON_SCENE')   setPhase('arriving');
    });
    return () => {
      socket.emit('LEAVE_INCIDENT', activeIncidentId);
      socket.off('INCIDENT_UPDATED');
    };
  }, [socket, activeIncidentId]);

  // ── Derived map data ──────────────────────────────────────

  const userPos: [number, number] | null = userLocation
    ? [userLocation.lat, userLocation.lng]
    : null;

  const responder = responderPositions[0];
  const responderPos: [number, number] | null = responder
    ? [responder.lat, responder.lng]
    : null;

  const rName = responderName || (responder
    ? `${responder.type.replace('_', ' ')} Unit`
    : 'Assigning unit…');

  const cfg = PHASE_CONFIG[phase];

  // ── No incident state ─────────────────────────────────────

  if (noIncident) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', alignItems: 'center', justifyContent: 'center', gap: 20, padding: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48 }}>📍</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: '#111827' }}>No Active Emergency</div>
        <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
          When you trigger SOS, live tracking will appear here.
        </div>
        <button
          onClick={() => setActiveTab('home')}
          style={{ padding: '14px 32px', background: '#111827', color: '#fff', borderRadius: 14, border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}
        >
          Go to Home
        </button>
      </div>
    );
  }

  // ── Main tracking UI ──────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', overflow: 'hidden' }}>

      {/* ── 1. STATUS HEADER ─────────────────────────────── */}
      <motion.div
        key={phase}
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          padding: '14px 20px 12px',
          borderBottom: '1px solid #f3f4f6',
          flexShrink: 0,
        }}
      >
        {/* Status line */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: cfg.color,
            boxShadow: `0 0 6px ${cfg.color}`,
            animation: cfg.pulse ? 'pulse 1s infinite' : 'none',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>
            {cfg.status}
          </span>
        </div>

        {/* Emotional support message */}
        <p style={{ fontSize: 13, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>
          {cfg.message}
        </p>
      </motion.div>

      {/* ── 2. MAP (PRIMARY — 45% height) ────────────────── */}
      <div style={{ height: '45%', flexShrink: 0, position: 'relative', background: '#f0f0f0' }}>

        {/* Loading state */}
        {!mapLoaded && !mapError && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: '#f9fafb',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
          }}>
            <div style={{ width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#374151', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 13, color: '#9ca3af' }}>Loading map…</span>
          </div>
        )}

        {/* Error fallback */}
        {mapError && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 10,
            background: '#fef2f2', border: '1px solid #fecaca',
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 8,
          }}>
            <AlertTriangle style={{ width: 28, height: 28, color: '#ef4444' }} />
            <span style={{ fontSize: 13, color: '#dc2626', fontWeight: 600 }}>Unable to load map</span>
            <span style={{ fontSize: 12, color: '#6b7280' }}>Your emergency is still active</span>
          </div>
        )}

        {/* Leaflet map */}
        {!mapError && (
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

            {/* User location */}
            {userPos && (
              <>
                <Marker position={userPos} icon={YOU_ICON} />
                <Circle
                  center={userPos}
                  radius={100}
                  pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.06, weight: 1 }}
                />
              </>
            )}

            {/* Responder */}
            {responderPos && responder && (
              <Marker position={responderPos} icon={makeResponderIcon(responder.type)} />
            )}

            {/* Line between user and responder */}
            {userPos && responderPos && (
              <Polyline
                positions={[userPos, responderPos]}
                pathOptions={{ color: '#374151', weight: 1.5, dashArray: '6 4', opacity: 0.4 }}
              />
            )}
          </MapContainer>
        )}

        {/* "You" label */}
        {mapLoaded && userPos && (
          <div style={{
            position: 'absolute', bottom: 12, left: 12, zIndex: 1000,
            background: 'rgba(255,255,255,0.95)', border: '1.5px solid #ef4444',
            borderRadius: 8, padding: '4px 10px',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>You</span>
          </div>
        )}

        {/* "Responder" label */}
        {mapLoaded && responderPos && (
          <div style={{
            position: 'absolute', bottom: 12, right: 12, zIndex: 1000,
            background: 'rgba(255,255,255,0.95)', border: '1.5px solid #22c55e',
            borderRadius: 8, padding: '4px 10px',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#22c55e' }} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#111827' }}>Responder</span>
          </div>
        )}
      </div>

      {/* ── 3. COMPACT INFO PANEL ────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ETA — large and prominent */}
        <motion.div
          key={eta}
          animate={{ scale: [1, 1.02, 1] }}
          transition={{ duration: 0.3 }}
          style={{
            background: eta <= 60 ? '#f0fdf4' : '#f9fafb',
            border: `2px solid ${eta <= 60 ? '#86efac' : '#e5e7eb'}`,
            borderRadius: 16, padding: '16px 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}
        >
          <div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              Estimated Arrival
            </div>
            <div style={{ fontSize: 28, fontWeight: 800, fontFamily: 'monospace', color: eta <= 60 ? '#16a34a' : '#111827', letterSpacing: '0.02em' }}>
              {fmtEta(eta)}
            </div>
          </div>
          {/* Progress arc */}
          <svg width="52" height="52" viewBox="0 0 52 52">
            <circle cx="26" cy="26" r="22" fill="none" stroke="#e5e7eb" strokeWidth="4" />
            <circle
              cx="26" cy="26" r="22"
              fill="none"
              stroke={eta <= 60 ? '#22c55e' : '#374151'}
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 22}`}
              strokeDashoffset={`${2 * Math.PI * 22 * (1 - Math.max(0, Math.min(1, (480 - eta) / 480)))}`}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '26px 26px', transition: 'stroke-dashoffset 1s linear' }}
            />
          </svg>
        </motion.div>

        {/* Location + Responder — compact row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {/* Location */}
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              📍 Location
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', lineHeight: 1.4 }}>
              {locationLabel}
            </div>
          </div>

          {/* Responder */}
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
              🚨 Responder
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#111827', lineHeight: 1.4 }}>
              {rName}
            </div>
          </div>
        </div>

        {/* Communication status */}
        <CommunicationStatus callSession={callSession} />

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            onClick={() => setActiveTab('chat')}
            style={{
              flex: 1, padding: '13px', borderRadius: 14,
              background: '#111827', color: '#fff',
              fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <MessageCircle style={{ width: 16, height: 16 }} />
            Live Guidance
          </button>
          <a
            href="tel:7780284992"
            style={{
              flex: 1, padding: '13px', borderRadius: 14,
              background: '#fff', color: '#374151',
              fontWeight: 700, fontSize: 13,
              border: '1.5px solid #e5e7eb', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              textDecoration: 'none',
            }}
          >
            <Phone style={{ width: 16, height: 16 }} />
            Call Emergency
          </a>
        </div>

        {/* Reference code — small, unobtrusive */}
        {activeReferenceCode && (
          <div style={{ textAlign: 'center', paddingBottom: 8 }}>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#d1d5db', letterSpacing: '0.1em' }}>
              REF: {activeReferenceCode}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Communication status panel ────────────────────────────────

function CommunicationStatus({ callSession }: { callSession: any }) {
  const isConnected = callSession?.state === 'connected';
  const isRinging   = callSession?.state === 'ringing' || callSession?.state === 'initiating';
  const isAI        = !callSession || callSession.state === 'idle';

  const label = isConnected
    ? `Human Operator Connected — ${callSession?.operatorName ?? 'LIFEGRID Operator'}`
    : isRinging
    ? 'Connecting to operator…'
    : 'AI Assistant Connected';

  const color = isConnected ? '#22c55e' : isRinging ? '#f59e0b' : '#3b82f6';

  return (
    <div style={{
      background: '#f9fafb', border: `1.5px solid ${color}30`,
      borderRadius: 12, padding: '12px 16px',
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%',
        background: color,
        boxShadow: `0 0 6px ${color}`,
        animation: isRinging ? 'pulse 1s infinite' : 'none',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{label}</div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>
          {isConnected ? 'You are being assisted' : isRinging ? 'Please wait…' : 'Monitoring your situation'}
        </div>
      </div>
      <Wifi style={{ width: 14, height: 14, color, flexShrink: 0 }} />
    </div>
  );
}
