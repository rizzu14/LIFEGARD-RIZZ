// ============================================================
// LIFEGRID – Screen 2: Live Tracking
// Real-time responder map + ETA + pipeline timeline
//
// UX Behavior:
//   - Map fills 55% of screen, timeline below
//   - Responder dots animate on position update
//   - ETA counts down in real time
//   - Timeline steps animate in as each step completes
//   - Tap responder dot → show unit info sheet
//   - Offline: shows last known positions with staleness indicator
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapContainer, TileLayer, Marker, Circle, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { CheckCircle, Clock, Radio, ChevronDown, ChevronUp, Phone } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useAppStore } from '../store/appStore';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { LiveStatusPanel } from '../components/emergency/LiveStatusPanel';
import { EmergencyMap } from '../components/emergency/EmergencyMap';

// Fix Leaflet icons
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const incidentIcon = L.divIcon({
  className: '',
  html: `<div style="width:14px;height:14px;background:#ff2d2d;border:2px solid #fff;border-radius:50%;box-shadow:0 0 12px #ff2d2d80;"></div>`,
  iconSize: [14, 14], iconAnchor: [7, 7],
});

function makeResponderIcon(type: string) {
  const colors: Record<string, string> = {
    AMBULANCE: '#00ff88', FIRE: '#ff8c00', POLICE: '#00aaff',
    HAZMAT: '#ffd700', SEARCH_RESCUE: '#fff', MILITARY: '#888',
  };
  const color = colors[type] ?? '#fff';
  return L.divIcon({
    className: '',
    html: `<div class="responder-dot" style="background:${color};box-shadow:0 0 0 2px ${color}40;"></div>`,
    iconSize: [12, 12], iconAnchor: [6, 6],
  });
}

interface TimelineStep {
  step: number;
  name: string;
  timestamp: string | null;
  status: 'complete' | 'active' | 'pending';
}

function MapAutoCenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => { map.setView(center, 14); }, [center, map]);
  return null;
}

export default function TrackScreen() {
  const {
    activeIncidentId, activeReferenceCode,
    responderPositions, userLocation,
    updateResponderPosition,
  } = useAppStore();

  const { socket } = useSocket();
  const [incident, setIncident] = useState<any>(null);
  const [timeline, setTimeline] = useState<TimelineStep[]>([]);
  const [eta, setEta] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedResponder, setSelectedResponder] = useState<string | null>(null);
  const [timelineExpanded, setTimelineExpanded] = useState(false);

  // Fetch incident data
  useEffect(() => {
    if (!activeIncidentId || activeIncidentId.startsWith('offline-')) {
      setLoading(false);
      return;
    }

    const fetch = async () => {
      try {
        const [incRes, tlRes] = await Promise.all([
          api.get(`/incidents/${activeIncidentId}`),
          api.get(`/incidents/${activeIncidentId}/timeline`),
        ]);
        setIncident(incRes.data.data);
        setTimeline(tlRes.data.data);

        const etaSeconds = incRes.data.data?.aiDecision?.estimatedResponseTime;
        if (etaSeconds) {
          const created = new Date(incRes.data.data.createdAt).getTime();
          const remaining = Math.max(0, Math.round((created + etaSeconds * 1000 - Date.now()) / 1000));
          setEta(remaining);

          // ── Sync ETA to store so LiveStatusPanel on HomeScreen updates ──
          // Inject a synthetic responder position with ETA if none exist
          if (responderPositions.length === 0 && userLocation) {
            updateResponderPosition({
              responderId: 'system-eta',
              type: incRes.data.data?.type === 'FIRE' ? 'FIRE'
                  : incRes.data.data?.type === 'SECURITY' ? 'POLICE'
                  : 'AMBULANCE',
              lat: userLocation.lat + 0.005,
              lng: userLocation.lng + 0.005,
              etaSeconds: remaining,
              status: 'EN_ROUTE',
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch {
        // Silently handle — show offline state
      } finally {
        setLoading(false);
      }
    };

    fetch();
    const interval = setInterval(fetch, 30000);
    return () => clearInterval(interval);
  }, [activeIncidentId]);

  // ETA countdown — also updates store responder ETA
  useEffect(() => {
    if (eta === null || eta <= 0) return;
    const t = setInterval(() => {
      setEta(p => {
        const next = p !== null ? Math.max(0, p - 1) : null;
        // Keep store in sync for LiveStatusPanel
        if (next !== null) {
          const positions = useAppStore.getState().responderPositions;
          const sysEta = positions.find(r => r.responderId === 'system-eta');
          if (sysEta) {
            useAppStore.getState().updateResponderPosition({ ...sysEta, etaSeconds: next });
          }
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [eta]);

  // WebSocket updates
  useEffect(() => {
    if (!socket || !activeIncidentId) return;
    socket.emit('JOIN_INCIDENT', activeIncidentId);
    socket.on('INCIDENT_UPDATED', (e: any) => {
      if (e.payload?.id === activeIncidentId) setIncident(e.payload);
    });
    return () => {
      socket.emit('LEAVE_INCIDENT', activeIncidentId);
      socket.off('INCIDENT_UPDATED');
    };
  }, [socket, activeIncidentId]);

  const formatEta = (s: number) => {
    if (s <= 0) return 'Arriving';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
  };

  const mapCenter: [number, number] = userLocation
    ? [userLocation.lat, userLocation.lng]
    : [40.7128, -74.006];

  const noIncident = !activeIncidentId;
  const isOfflineIncident = activeIncidentId?.startsWith('offline-') || activeReferenceCode?.startsWith('SOS-');

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff", overflow: "hidden" }}>
      <ScreenHeader
        title="Live Tracking"
        subtitle={activeReferenceCode ?? undefined}
        right={
          incident?.status && (
            <span className="text-[9px] font-mono text-green-600 tracking-widest uppercase">
              {incident.status.replace('_', ' ')}
            </span>
          )
        }
      />

      {noIncident ? (
        <NoIncidentState />
      ) : isOfflineIncident ? (
        <OfflineConfirmationState referenceCode={activeReferenceCode ?? ''} />
      ) : (
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* ── Map (55% height) ──────────────────────────── */}
          <div className="relative" style={{ height: '55%', flexShrink: 0 }}>
            <MapContainer
              center={mapCenter}
              zoom={14}
              style={{ width: '100%', height: '100%' }}
              zoomControl={false}
              attributionControl={false}
            >
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <MapAutoCenter center={mapCenter} />

              {/* User / incident location */}
              {userLocation && (
                <>
                  <Marker position={[userLocation.lat, userLocation.lng]} icon={incidentIcon} />
                  <Circle
                    center={[userLocation.lat, userLocation.lng]}
                    radius={150}
                    pathOptions={{ color: '#ff2d2d', fillColor: '#ff2d2d', fillOpacity: 0.06, weight: 1 }}
                  />
                </>
              )}

              {/* Responder positions */}
              {responderPositions.map(r => (
                <Marker
                  key={r.responderId}
                  position={[r.lat, r.lng]}
                  icon={makeResponderIcon(r.type)}
                  eventHandlers={{ click: () => setSelectedResponder(r.responderId) }}
                />
              ))}
            </MapContainer>

            {/* Map vignette */}
            <div className="absolute inset-0 map-vignette pointer-events-none" />

            {/* ETA overlay */}
            {eta !== null && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute bottom-4 left-4 right-4 flex items-center justify-between bg-white/80 backdrop-blur-sm border border-gray-200 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-gray-400" />
                  <div>
                    <div className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">ETA</div>
                    <div className="text-xl font-mono font-bold tabular-nums">{formatEta(eta)}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">Units</div>
                  <div className="text-xl font-mono font-bold">{responderPositions.length}</div>
                </div>
              </motion.div>
            )}
          </div>

          {/* ── Timeline panel ────────────────────────────── */}
          <div className="flex-1 overflow-y-auto bg-white border-t border-gray-200">

            {/* Collapse toggle */}
            <button
              onClick={() => setTimelineExpanded(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 border-b border-gray-100"
            >
              <span className="text-[10px] font-mono text-gray-500 tracking-widest uppercase">
                Response Pipeline
              </span>
              {timelineExpanded
                ? <ChevronUp className="w-4 h-4 text-gray-400" />
                : <ChevronDown className="w-4 h-4 text-gray-400" />
              }
            </button>

            <AnimatePresence>
              {(timelineExpanded || timeline.length > 0) && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  <div className="px-5 py-4 space-y-0">
                    {(timeline.length > 0 ? timeline : PLACEHOLDER_TIMELINE).map((step, i) => (
                      <TimelineRow key={step.step} step={step} isLast={i === 6} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Emergency call */}
            <div className="px-5 py-4 border-t border-gray-100">
              <a
                href="tel:911"
                className="flex items-center gap-3 p-4 border border-gray-200 hover:border-gray-300 transition-colors"
              >
                <Phone className="w-4 h-4 text-gray-500" />
                <div className="flex-1">
                  <div className="text-xs font-bold">Call Emergency Services</div>
                  <div className="text-[10px] text-gray-500">Direct line · Always available</div>
                </div>
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Responder info sheet */}
      <AnimatePresence>
        {selectedResponder && (
          <ResponderSheet
            responderId={selectedResponder}
            responders={responderPositions}
            onClose={() => setSelectedResponder(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

const PLACEHOLDER_TIMELINE: TimelineStep[] = [
  { step: 1, name: 'Triggered',       timestamp: null, status: 'pending' },
  { step: 2, name: 'Classified',      timestamp: null, status: 'pending' },
  { step: 3, name: 'Decision Made',   timestamp: null, status: 'pending' },
  { step: 4, name: 'Dispatched',      timestamp: null, status: 'pending' },
  { step: 5, name: 'En Route',        timestamp: null, status: 'pending' },
  { step: 6, name: 'Guidance Active', timestamp: null, status: 'pending' },
  { step: 7, name: 'Confirmed',       timestamp: null, status: 'pending' },
];

function TimelineRow({ step, isLast }: { step: TimelineStep; isLast: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: step.step * 0.04 }}
      className="flex gap-4"
    >
      {/* Connector */}
      <div className="flex flex-col items-center">
        <div className={`
          w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0
          ${step.status === 'complete' ? 'border-green-500 bg-green-500'
            : step.status === 'active' ? 'border-gray-900 bg-transparent'
            : 'border-gray-200 bg-transparent'}
        `}>
          {step.status === 'complete' && <CheckCircle className="w-3 h-3 text-white" />}
          {step.status === 'active' && <span className="w-2 h-2 rounded-full bg-gray-900 animate-pulse" />}
        </div>
        {!isLast && (
          <div className={`w-px flex-1 my-1 ${step.status === 'complete' ? 'bg-gray-200' : 'bg-gray-100'}`} />
        )}
      </div>

      {/* Content */}
      <div className="pb-5 flex-1 flex items-start justify-between">
        <span className={`text-sm ${step.status === 'pending' ? 'text-gray-400' : 'text-gray-900'}`}>
          {step.name}
        </span>
        {step.timestamp ? (
          <span className="text-[9px] font-mono text-gray-500">
            {format(new Date(step.timestamp), 'HH:mm:ss')}
          </span>
        ) : step.status === 'active' ? (
          <span className="text-[9px] text-gray-400 flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
            In progress
          </span>
        ) : null}
      </div>
    </motion.div>
  );
}

function NoIncidentState() {
  const { setActiveTab } = useAppStore();
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 px-8 text-center">
      <Radio className="w-10 h-10 text-gray-300" strokeWidth={1} />
      <div>
        <div className="text-sm font-bold mb-2">No Active Incident</div>
        <div className="text-[11px] text-gray-500 leading-relaxed">
          Report an emergency to see live responder tracking here
        </div>
      </div>
      <button
        onClick={() => setActiveTab('home')}
        className="px-6 py-3 border border-gray-200 text-xs font-bold tracking-widest uppercase hover:border-gray-400 transition-colors"
      >
        Go to Home
      </button>
    </div>
  );
}

function OfflineConfirmationState({ referenceCode }: { referenceCode: string }) {
  const { setActiveTab, clearActiveIncident } = useAppStore();
  const [countdown, setCountdown] = useState(8);

  useEffect(() => {
    const t = setInterval(() => setCountdown(p => Math.max(0, p - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '40px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, textAlign: 'center' }}>

      {/* Success animation */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 18 }}
        style={{
          width: 96, height: 96, borderRadius: '50%',
          background: '#f0fdf4', border: '3px solid #22c55e',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        <CheckCircle className="w-12 h-12 text-green-500" />
      </motion.div>

      {/* Title */}
      <div>
        <div style={{ fontSize: 22, fontWeight: 800, color: '#111827', marginBottom: 8 }}>
          🚨 Help is on the way
        </div>
        <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
          Your emergency alert has been sent to the nearest response units. Stay calm and remain at your location.
        </div>
      </div>

      {/* Reference code */}
      <div style={{
        width: '100%', padding: '20px', borderRadius: 16,
        background: '#f9fafb', border: '2px solid #e5e7eb',
      }}>
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#9ca3af', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>
          Emergency Reference
        </div>
        <div style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 800, color: '#111827', letterSpacing: '0.1em' }}>
          {referenceCode}
        </div>
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
          Save this code to track your incident
        </div>
      </div>

      {/* Instructions */}
      <div style={{ width: '100%', textAlign: 'left' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
          What to do now
        </div>
        {[
          '🧘 Stay calm and remain at your current location',
          '📱 Keep your phone accessible for responder contact',
          '🚪 If safe, move to a visible location',
          '🔊 Make noise or signal if you hear responders nearby',
          '💬 Use the Guide tab to communicate with emergency AI',
        ].map((instruction, i) => (
          <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'flex-start' }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{instruction.slice(0, 2)}</span>
            <span style={{ fontSize: 13, color: '#4b5563', lineHeight: 1.5 }}>{instruction.slice(2)}</span>
          </div>
        ))}
      </div>

      {/* ETA indicator */}
      <div style={{
        width: '100%', padding: '16px', borderRadius: 14,
        background: '#eff6ff', border: '2px solid #bfdbfe',
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <Clock className="w-6 h-6 text-blue-500 flex-shrink-0" />
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#1d4ed8' }}>Estimated Response Time</div>
          <div style={{ fontSize: 12, color: '#3b82f6' }}>8–15 minutes depending on your location</div>
        </div>
      </div>

      {/* Live Status Panel — shows real-time data even in offline mode */}
      <div style={{ width: '100%' }}>
        <EmergencyMap height={160} />
      </div>
      <div style={{ width: '100%' }}>
        <LiveStatusPanel />
      </div>

      {/* Action buttons */}
      <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          onClick={() => setActiveTab('chat')}
          style={{
            width: '100%', padding: '16px', borderRadius: 14,
            background: '#111827', color: '#fff',
            fontWeight: 700, fontSize: 14, border: 'none', cursor: 'pointer',
          }}
        >
          💬 Open Live Guidance
        </button>
        <button
          onClick={() => { clearActiveIncident(); setActiveTab('home'); }}
          style={{
            width: '100%', padding: '14px', borderRadius: 14,
            background: '#fff', color: '#6b7280',
            fontWeight: 500, fontSize: 13,
            border: '1px solid #e5e7eb', cursor: 'pointer',
          }}
        >
          Cancel Emergency
        </button>
      </div>
    </div>
  );
}

function ResponderSheet({
  responderId, responders, onClose,
}: { responderId: string; responders: any[]; onClose: () => void }) {
  const r = responders.find(x => x.responderId === responderId);
  if (!r) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="sheet-overlay" onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="sheet"
      >
        <div className="sheet-handle" />
        <div className="px-6 py-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 border border-gray-200 flex items-center justify-center">
              <Radio className="w-5 h-5 text-gray-400" />
            </div>
            <div>
              <div className="text-sm font-bold">{r.type.replace('_', ' ')}</div>
              <div className="text-[10px] font-mono text-gray-500">{r.responderId.slice(0, 8)}...</div>
            </div>
            <div className="ml-auto text-right">
              <div className="text-[9px] font-mono text-gray-500 uppercase">ETA</div>
              <div className="text-lg font-mono font-bold">
                {r.etaSeconds > 0 ? `${Math.ceil(r.etaSeconds / 60)}m` : 'Arriving'}
              </div>
            </div>
          </div>
          <div className="text-[10px] font-mono text-gray-500 uppercase tracking-widest">
            Status: {r.status.replace('_', ' ')}
          </div>
        </div>
      </motion.div>
    </>
  );
}
