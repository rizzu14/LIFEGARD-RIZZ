// ============================================================
// LIFEGRID – Live Status Indicator
//
// HOME screen  → slim strip below the header (full-width)
// OTHER screens → floating pill (top-right corner, never blocks UI)
//
// Auto-updates. Tap to expand details. Never covers buttons.
// ============================================================

import React, { useEffect, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAppStore } from '../../store/appStore';
import { classifyEmergency, ClassificationResult } from '../../hooks/useEmergencyClassifier';

// ── Phase config ──────────────────────────────────────────────

type Phase = 'connecting' | 'dispatched' | 'active' | 'arriving';

function getPhase(sosState: string, eta: number, callState?: string): Phase {
  if (sosState === 'holding' || sosState === 'confirming' || sosState === 'submitting') return 'connecting';
  if (sosState === 'active') {
    if (callState === 'connected') return 'active';
    if (eta <= 60) return 'arriving';
    return 'dispatched';
  }
  return 'connecting';
}

const PHASE: Record<Phase, { label: string; sub: string; dot: string; pulse: boolean }> = {
  connecting: { label: 'Connecting',      sub: 'Reaching LIFEGRID…',       dot: '#f59e0b', pulse: true  },
  dispatched: { label: 'Help dispatched', sub: 'Responder on the way',      dot: '#22c55e', pulse: false },
  active:     { label: 'Operator live',   sub: 'Live assistance active',    dot: '#22c55e', pulse: true  },
  arriving:   { label: 'Arriving soon',   sub: 'Stay calm, help is close',  dot: '#22c55e', pulse: true  },
};

function formatETA(s: number) {
  if (s <= 0) return 'Now';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ── Pulsing dot ───────────────────────────────────────────────

function Dot({ color, pulse, size = 8 }: { color: string; pulse: boolean; size?: number }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {pulse && (
        <div style={{
          position: 'absolute', inset: -(size * 0.4),
          borderRadius: '50%', background: color, opacity: 0.25,
          animation: 'ping 1.5s ease-out infinite',
          pointerEvents: 'none',
        }} />
      )}
      <div style={{ width: size, height: size, borderRadius: '50%', background: color }} />
    </div>
  );
}

// ── Detail chip ───────────────────────────────────────────────

function Chip({ icon, value, mono }: { icon: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 99,
      background: 'rgba(255,255,255,0.9)', border: '1px solid #e5e7eb',
      fontSize: 10, color: '#374151',
      fontFamily: mono ? 'monospace' : 'inherit',
      backdropFilter: 'blur(4px)',
    }}>
      <span>{icon}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Props ─────────────────────────────────────────────────────

interface LiveStatusPanelProps {
  voiceTranscript?: string;
  /** 'strip' = full-width below header (HomeScreen)
   *  'pill'  = floating corner badge (all other screens) */
  variant?: 'strip' | 'pill';
}

// ── Main component ────────────────────────────────────────────

export function LiveStatusPanel({ voiceTranscript = '', variant = 'strip' }: LiveStatusPanelProps) {
  const { sosState, userLocation, responderPositions, callSession, activeReferenceCode } = useAppStore();

  const [eta, setEta]                   = useState(480);
  const [expanded, setExpanded]         = useState(false);
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
  const cfg   = PHASE[phase];
  const locationText = userLocation
    ? `${userLocation.lat.toFixed(3)}, ${userLocation.lng.toFixed(3)}`
    : 'Locating…';

  // ── PILL variant (floating, non-blocking) ─────────────────

  if (variant === 'pill') {
    return (
      <AnimatePresence>
        {shouldShow && (
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.85, y: -8 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              zIndex: 40,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 6,
              pointerEvents: 'auto',
            }}
          >
            {/* Compact pill button */}
            <button
              onClick={() => setExpanded(e => !e)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '6px 12px 6px 10px',
                borderRadius: 99,
                background: 'rgba(255,255,255,0.96)',
                border: `1.5px solid ${cfg.dot}40`,
                boxShadow: `0 2px 12px rgba(0,0,0,0.10), 0 0 0 3px ${cfg.dot}18`,
                cursor: 'pointer',
                backdropFilter: 'blur(8px)',
                WebkitBackdropFilter: 'blur(8px)',
                transition: 'box-shadow 0.2s',
              }}
              aria-label="Emergency status — tap to expand"
            >
              <Dot color={cfg.dot} pulse={cfg.pulse} size={7} />
              <span style={{
                fontSize: 11, fontWeight: 700, color: '#111827',
                letterSpacing: '0.02em', whiteSpace: 'nowrap',
              }}>
                {cfg.label}
              </span>
              {sosState === 'active' && (
                <span style={{
                  fontSize: 10, fontFamily: 'monospace', fontWeight: 700,
                  color: eta <= 60 ? '#16a34a' : '#374151',
                  background: eta <= 60 ? '#dcfce7' : '#f3f4f6',
                  padding: '1px 6px', borderRadius: 99, marginLeft: 2,
                }}>
                  {formatETA(eta)}
                </span>
              )}
              <svg
                width="10" height="10" viewBox="0 0 10 10" fill="none"
                style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
              >
                <path d="M2 3.5l3 3 3-3" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>

            {/* Expanded detail card */}
            <AnimatePresence>
              {expanded && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.92, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.92, y: -6 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    background: 'rgba(255,255,255,0.97)',
                    border: '1px solid #e5e7eb',
                    borderRadius: 14,
                    padding: '12px 14px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    minWidth: 200,
                    maxWidth: 240,
                  }}
                >
                  {/* Status line */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <Dot color={cfg.dot} pulse={cfg.pulse} size={8} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#111827' }}>{cfg.label}</span>
                  </div>
                  <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 10px', lineHeight: 1.4 }}>{cfg.sub}</p>

                  {/* Chips */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                    <Chip icon="📍" value={locationText} />
                    {classification && <Chip icon={classification.icon} value={classification.label} />}
                    {responderPositions[0] && (
                      <Chip icon="🚑" value={responderPositions[0].type.replace('_', ' ')} />
                    )}
                    {activeReferenceCode && <Chip icon="🔖" value={activeReferenceCode} mono />}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  // ── STRIP variant (full-width, HomeScreen only) ───────────

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          style={{ width: '100%', overflow: 'hidden' }}
        >
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '8px 16px',
              background: '#f9fafb',
              borderTop: '1px solid #e5e7eb',
              borderBottom: expanded ? 'none' : '1px solid #e5e7eb',
              cursor: 'pointer',
              textAlign: 'left',
            }}
          >
            <Dot color={cfg.dot} pulse={cfg.pulse} />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#111827', flex: 1, letterSpacing: '0.02em' }}>
              {cfg.label}
            </span>
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
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"
              style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}>
              <path d="M2 4l4 4 4-4" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

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
                  <p style={{ fontSize: 11, color: '#6b7280', margin: 0 }}>{cfg.sub}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                    <Chip icon="📍" value={locationText} />
                    {classification && <Chip icon={classification.icon} value={classification.label} />}
                    {responderPositions[0] && (
                      <Chip icon="🚑" value={responderPositions[0].type.replace('_', ' ')} />
                    )}
                    {activeReferenceCode && <Chip icon="🔖" value={activeReferenceCode} mono />}
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
