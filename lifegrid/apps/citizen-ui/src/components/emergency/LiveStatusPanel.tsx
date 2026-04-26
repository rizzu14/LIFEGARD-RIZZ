// ============================================================
// LIFEGRID – Live Status Strip  (non-blocking)
//
// A slim top strip that shows connection/dispatch status.
// Never covers buttons. Auto-updates. No user interaction needed.
// Tap to expand for a compact detail pill.
// ============================================================

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/appStore';
import { classifyEmergency, ClassificationResult } from '../../hooks/useEmergencyClassifier';

// ── Status phases ─────────────────────────────────────────────

type Phase = 'connecting' | 'processing' | 'dispatched' | 'active' | 'arriving';

function getPhase(sosState: string, eta: number, callState?: string): Phase {
  if (sosState === 'holding' || sosState === 'confirming' || sosState === 'submitting') return 'connecting';
  if (sosState === 'active') {
    if (callState === 'connected') return 'active';
    if (eta <= 60) return 'arriving';
    return 'dispatched';
  }
  return 'connecting';
}

const PHASE_CONFIG: Record<Phase, { label: string; sub: string; dot: string; pulse: boolean }> = {
  connecting:  { label: 'Connecting…',        sub: 'Reaching LIFEGRID',         dot: '#f59e0b', pulse: true  },
  processing:  { label: 'Processing…',        sub: 'Analyzing situation',        dot: '#3b82f6', pulse: true  },
  dispatched:  { label: 'Help dispatched',    sub: 'Responder on the way',       dot: '#22c55e', pulse: false },
  active:      { label: 'Operator connected', sub: 'Live assistance active',     dot: '#22c55e', pulse: true  },
  arriving:    { label: 'Arriving soon',      sub: 'Stay calm, help is close',   dot: '#22c55e', pulse: true  },
};

function formatETA(s: number) {
  if (s <= 0) return 'Now';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ── Component ─────────────────────────────────────────────────

interface LiveStatusPanelProps {
  voiceTranscript?: string;
}

export function LiveStatusPanel({ voiceTranscript = '' }: LiveStatusPanelProps) {
  const { sosState, userLocation, responderPositions, callSession, activeReferenceCode } = useAppStore();

  const [eta, setEta] = useState(480);
  const [expanded, setExpanded] = useState(false);
  const [classification, setClassification] = useState<ClassificationResult | null>(null);
  const etaRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const shouldShow = sosState !== 'idle' && sosState !== 'resolved';

  // AI classification
  useEffect(() => {
    if (voiceTranscript.length > 3) {
      const r = classifyEmergency(voiceTranscript);
      if (r.type !== 'UNKNOWN') setClassification(r);
    }
  }, [voiceTranscript]);

  // ETA countdown
  useEffect(() => {
    if (etaRef.current) clearInterval(etaRef.current);
    if (sosState === 'active') {
      const first = responderPositions[0];
      if (first?.etaSeconds) setEta(first.etaSeconds);
      etaRef.current = setInterval(() => setEta(p => Math.max(0, p - 1)), 1000);
    }
    return () => { if (etaRef.current) clearInterval(etaRef.current); };
  }, [sosState, responderPositions]);

  useEffect(() => {
    const first = responderPositions[0];
    if (first?.etaSeconds && first.etaSeconds > 0) setEta(first.etaSeconds);
  }, [responderPositions]);

  const phase = getPhase(sosState, eta, callSession?.state);
  const cfg   = PHASE_CONFIG[phase];

  const locationText = userLocation
    ? `${userLocation.lat.toFixed(3)}, ${userLocation.lng.toFixed(3)}`
    : 'Locating…';

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
          style={{ width: '100%' }}
        >
          {/* ── Slim strip ─────────────────────────────────── */}
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 16px',
              background: '#f9fafb',
              borderTop: '1px solid #e5e7eb',
              borderBottom: expanded ? 'none' : '1px solid #e5e7eb',
              cursor: 'pointer',
              textAlign: 'left',
            }}
            aria-label="Status strip — tap to expand"
          >
            {/* Dot */}
            <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
              {cfg.pulse && (
                <div style={{
                  position: 'absolute', inset: -3, borderRadius: '50%',
                  background: cfg.dot, opacity: 0.3,
                  animation: 'ping 1.5s ease-out infinite',
                  pointerEvents: 'none',
                }} />
              )}
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: cfg.dot }} />
            </div>

            {/* Label */}
            <span style={{ fontSize: 11, fontWeight: 700, color: '#111827', letterSpacing: '0.03em', flex: 1 }}>
              {cfg.label}
            </span>

            {/* ETA chip (active only) */}
            {sosState === 'active' && (
              <span style={{
                fontSize: 10, fontFamily: 'monospace', fontWeight: 700,
                color: eta <= 60 ? '#16a34a' : '#374151',
                background: eta <= 60 ? '#dcfce7' : '#f3f4f6',
                padding: '2px 7px', borderRadius: 99,
              }}>
                {formatETA(eta)}
              </span>
            )}

            {/* Expand chevron */}
            <svg
              width="12" height="12" viewBox="0 0 12 12" fill="none"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
            >
              <path d="M2 4l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* ── Expanded detail pill ────────────────────────── */}
          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{ overflow: 'hidden', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}
              >
                <div style={{ padding: '10px 16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>

                  {/* Sub-message */}
                  <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>{cfg.sub}</p>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                    {/* Location */}
                    <DetailChip label="📍" value={locationText} />

                    {/* Emergency type */}
                    {classification && (
                      <DetailChip label={classification.icon} value={classification.label} />
                    )}

                    {/* Responder */}
                    {responderPositions[0] && (
                      <DetailChip
                        label="🚑"
                        value={responderPositions[0].type.replace('_', ' ')}
                      />
                    )}

                    {/* Ref code */}
                    {activeReferenceCode && (
                      <DetailChip label="🔖" value={activeReferenceCode} mono />
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ── Small detail chip ─────────────────────────────────────────

function DetailChip({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 99,
      background: '#ffffff', border: '1px solid #e5e7eb',
      fontSize: 10, color: '#374151',
      fontFamily: mono ? 'monospace' : 'inherit',
    }}>
      <span>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
