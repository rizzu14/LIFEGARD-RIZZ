// ============================================================
// LIFEGRID – Live Status Panel
// Dynamic real-time status display below the SOS button.
// Shows: location · emergency type · connection · responder · ETA
//
// States:
//   idle       → hidden (no panel shown)
//   holding    → "Preparing emergency system..."
//   confirming → "Sending SOS..."
//   submitting → "Connecting to control center..."
//   active     → Full live panel with all data
// ============================================================

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Wifi, WifiOff, Radio, Clock, AlertTriangle, CheckCircle, Loader } from 'lucide-react';
import { useAppStore, SOSState } from '../../store/appStore';
import { classifyEmergency, ClassificationResult } from '../../hooks/useEmergencyClassifier';

// ── Connection state config ───────────────────────────────────

const CONNECTION_STATES: Record<string, { label: string; color: string; pulse: boolean }> = {
  idle:        { label: 'Standby',                  color: '#9ca3af', pulse: false },
  holding:     { label: 'Preparing...',             color: '#f59e0b', pulse: true  },
  confirming:  { label: 'Sending SOS...',           color: '#ef4444', pulse: true  },
  submitting:  { label: 'Connecting...',            color: '#3b82f6', pulse: true  },
  active:      { label: 'Help Dispatched',          color: '#22c55e', pulse: false },
  calling:     { label: 'Calling Control Center',  color: '#3b82f6', pulse: true  },
  connected:   { label: 'Connected to Operator',   color: '#22c55e', pulse: false },
  dispatched:  { label: 'Responders Dispatched',   color: '#22c55e', pulse: false },
  resolved:    { label: 'Incident Resolved',       color: '#6b7280', pulse: false },
};

// ── ETA formatter ─────────────────────────────────────────────

function formatETA(seconds: number): string {
  if (seconds <= 0) return 'Arriving now';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Signal dot ────────────────────────────────────────────────

function StatusDot({ color, pulse }: { color: string; pulse: boolean }) {
  return (
    <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
      {pulse && (
        <div style={{
          position: 'absolute', inset: -4, borderRadius: '50%',
          background: color, opacity: 0.3,
          animation: 'ping 1.5s ease-out infinite',
        }} />
      )}
      <div style={{ width: 8, height: 8, borderRadius: '50%', background: color }} />
    </div>
  );
}

// ── Individual status row ─────────────────────────────────────

function StatusRow({
  icon, label, value, valueColor, loading: isLoading,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  valueColor?: string;
  loading?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #f3f4f6' }}>
      <div style={{ width: 28, height: 28, borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 1 }}>
          {label}
        </div>
        <div style={{ fontSize: 13, fontWeight: 700, color: valueColor ?? '#111827', truncate: true, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isLoading ? (
            <Loader style={{ width: 12, height: 12, color: '#9ca3af', animation: 'spin 1s linear infinite' }} />
          ) : value}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────

interface LiveStatusPanelProps {
  voiceTranscript?: string;
}

export function LiveStatusPanel({ voiceTranscript = '' }: LiveStatusPanelProps) {
  const {
    sosState, activeIncidentId, activeReferenceCode,
    userLocation, responderPositions, callSession,
  } = useAppStore();

  const [eta, setEta] = useState<number>(480);  // 8 min default
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const [connectionLabel, setConnectionLabel] = useState('Standby');
  const etaRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Show panel only when SOS is active ───────────────────

  const shouldShow = sosState !== 'idle' && sosState !== 'resolved';

  // ── AI classification from voice/text ────────────────────

  useEffect(() => {
    if (voiceTranscript && voiceTranscript.length > 3) {
      const result = classifyEmergency(voiceTranscript);
      if (result.type !== 'UNKNOWN') {
        setClassification(result);
      }
    }
  }, [voiceTranscript]);

  // ── Connection state label ────────────────────────────────

  useEffect(() => {
    const callState = callSession?.state;
    if (callState === 'connected')   setConnectionLabel('Connected to Operator');
    else if (callState === 'ringing') setConnectionLabel('Calling Control Center...');
    else if (sosState === 'active')   setConnectionLabel('Help Dispatched');
    else if (sosState === 'submitting') setConnectionLabel('Connecting...');
    else if (sosState === 'confirming') setConnectionLabel('Sending SOS...');
    else if (sosState === 'holding')    setConnectionLabel('Preparing...');
    else setConnectionLabel('Standby');
  }, [sosState, callSession?.state]);

  // ── ETA countdown ─────────────────────────────────────────

  useEffect(() => {
    if (sosState === 'active') {
      // Set initial ETA from responder data if available
      const firstResponder = responderPositions[0];
      if (firstResponder?.etaSeconds) {
        setEta(firstResponder.etaSeconds);
      }

      etaRef.current = setInterval(() => {
        setEta(prev => Math.max(0, prev - 1));
      }, 1000);
    }
    return () => { if (etaRef.current) clearInterval(etaRef.current); };
  }, [sosState, responderPositions]);

  // Update ETA when responder positions change
  useEffect(() => {
    const first = responderPositions[0];
    if (first?.etaSeconds && first.etaSeconds > 0) {
      setEta(first.etaSeconds);
    }
  }, [responderPositions]);

  // ── Derived values ────────────────────────────────────────

  const locationText = userLocation
    ? `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`
    : 'Acquiring GPS...';

  const responder = responderPositions[0];
  const responderText = responder
    ? `${responder.type.replace('_', ' ')} Unit`
    : sosState === 'active' ? 'Assigning unit...' : '—';

  const connState = CONNECTION_STATES[
    callSession?.state === 'connected' ? 'connected' :
    callSession?.state === 'ringing'   ? 'calling'   :
    sosState
  ] ?? CONNECTION_STATES.idle;

  const etaColor = eta <= 60 ? '#22c55e' : eta <= 180 ? '#f59e0b' : '#374151';

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={{
            width: '100%',
            background: '#ffffff',
            border: '2px solid #e5e7eb',
            borderRadius: 16,
            padding: '14px 16px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
          }}
        >
          {/* Panel header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <StatusDot color={connState.color} pulse={connState.pulse} />
              <span style={{ fontSize: 11, fontWeight: 700, color: connState.color, letterSpacing: '0.05em' }}>
                {connectionLabel}
              </span>
            </div>
            {activeReferenceCode && (
              <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#9ca3af', letterSpacing: '0.1em' }}>
                {activeReferenceCode}
              </span>
            )}
          </div>

          {/* Status rows */}
          <div>
            {/* Location */}
            <StatusRow
              icon={<MapPin style={{ width: 13, height: 13, color: '#6b7280' }} />}
              label="Your Location"
              value={locationText}
              loading={!userLocation}
            />

            {/* Emergency type */}
            <StatusRow
              icon={<span style={{ fontSize: 13 }}>{classification?.icon ?? '⚠️'}</span>}
              label="Emergency Type"
              value={classification ? `${classification.label}` : sosState === 'active' ? 'Classifying...' : 'Detecting...'}
              valueColor={classification?.color}
              loading={!classification && sosState === 'active'}
            />

            {/* Connection */}
            <StatusRow
              icon={connState.pulse
                ? <Wifi style={{ width: 13, height: 13, color: connState.color }} />
                : <CheckCircle style={{ width: 13, height: 13, color: connState.color }} />
              }
              label="Connection"
              value={connState.label}
              valueColor={connState.color}
            />

            {/* Responder */}
            <StatusRow
              icon={<Radio style={{ width: 13, height: 13, color: '#6b7280' }} />}
              label="Responder Unit"
              value={responderText}
              loading={sosState === 'active' && !responder}
            />

            {/* ETA */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: '#f9fafb', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Clock style={{ width: 13, height: 13, color: '#6b7280' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 1 }}>
                  Estimated Arrival
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: etaColor, letterSpacing: '0.05em' }}>
                    {sosState === 'active' ? formatETA(eta) : '—'}
                  </span>
                  {sosState === 'active' && eta > 0 && (
                    <div style={{ flex: 1, height: 4, background: '#f3f4f6', borderRadius: 2, overflow: 'hidden' }}>
                      <motion.div
                        style={{ height: '100%', background: etaColor, borderRadius: 2 }}
                        animate={{ width: `${Math.max(5, (eta / 480) * 100)}%` }}
                        transition={{ duration: 1, ease: 'linear' }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* AI confidence indicator */}
          {classification && classification.confidence > 0.5 && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              style={{
                marginTop: 12, padding: '8px 12px',
                background: `${classification.color}10`,
                border: `1px solid ${classification.color}30`,
                borderRadius: 10,
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <span style={{ fontSize: 16 }}>{classification.icon}</span>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: classification.color }}>
                  AI: {classification.label} detected
                </div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>
                  {(classification.confidence * 100).toFixed(0)}% confidence · Specialist units alerted
                </div>
              </div>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
