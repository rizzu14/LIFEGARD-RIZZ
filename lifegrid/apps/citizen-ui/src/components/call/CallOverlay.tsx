// ============================================================
// LIFEGRID – Emergency Call Overlay  v2
// Buttons call store actions directly — no hook dependency
// ============================================================

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PhoneOff, Mic, MicOff, Volume2, VolumeX, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useEmergencyCall, formatCallDuration } from '../../hooks/useEmergencyCall';

export function CallOverlay() {
  const {
    callSession,
    isCallOverlayVisible,
    setActiveTab,
    // Store actions — always work regardless of hook state
    toggleMute:    storeMute,
    toggleSpeaker: storeSpeaker,
    endCall:       storeEnd,
  } = useAppStore();

  const { endCall: hookEnd } = useEmergencyCall();

  const [expanded, setExpanded] = React.useState(true);

  if (!isCallOverlayVisible || !callSession) return null;

  const {
    state, operatorName, durationSeconds,
    isMuted, isSpeaker, signalStrength,
    aiSuggestions, liveTranscript, aiKeywords,
    fallbackMode, retryCount,
  } = callSession;

  const isConnected = state === 'connected';
  const isRinging   = state === 'ringing' || state === 'initiating';
  const isFailed    = state === 'failed';

  const statusText = {
    initiating: 'Connecting to LIFEGRID…',
    ringing:    'Calling control center…',
    connected:  operatorName ?? 'LIFEGRID Control Center',
    on_hold:    'On hold…',
    failed:     'Connection failed',
    ended:      'Call ended',
  }[state] ?? 'Connecting…';

  const statusColor = isConnected ? '#22c55e' : isRinging ? '#3b82f6' : isFailed ? '#ef4444' : '#f59e0b';

  // ── Button handlers — direct store calls ─────────────────
  const handleMute    = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); storeMute(); };
  const handleSpeaker = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); storeSpeaker(); };
  const handleChat    = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); setActiveTab('chat'); };
  const handleEnd     = (e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); storeEnd(); hookEnd(); };

  return (
    <motion.div
      initial={{ y: 120, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 120, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
      style={{
        position: 'fixed',
        bottom: 72,
        left: 12, right: 12,
        zIndex: 400,
        background: '#fff',
        borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,0.16)',
        border: `2px solid ${statusColor}35`,
        overflow: 'visible',   // don't clip buttons
      }}
    >
      {/* ── Header — tap to collapse ──────────────────────── */}
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          padding: '12px 16px',
          display: 'flex', alignItems: 'center', gap: 12,
          background: isConnected ? '#f0fdf4' : isRinging ? '#eff6ff' : '#f9fafb',
          borderRadius: expanded ? '18px 18px 0 0' : 18,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{
          width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
          background: statusColor,
          boxShadow: `0 0 6px ${statusColor}`,
          animation: isRinging ? 'pulse 1s infinite' : 'none',
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{statusText}</div>
          {isRinging && <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 1 }}>Routing to nearest operator…</div>}
          {isConnected && <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace', marginTop: 1 }}>{formatCallDuration(durationSeconds)}</div>}
        </div>
        {expanded
          ? <ChevronDown style={{ width: 15, height: 15, color: '#9ca3af', flexShrink: 0 }} />
          : <ChevronUp   style={{ width: 15, height: 15, color: '#9ca3af', flexShrink: 0 }} />
        }
      </div>

      {/* ── Expanded controls ─────────────────────────────── */}
      {expanded && (
        <div style={{ padding: '12px 14px 16px' }}>

          {/* AI suggestion */}
          {aiSuggestions.length > 0 && (
            <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 10, padding: '8px 12px', marginBottom: 10 }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#1d4ed8', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>AI Guidance</div>
              <p style={{ fontSize: 12, color: '#1e40af', lineHeight: 1.5, margin: 0 }}>{aiSuggestions[0]}</p>
            </div>
          )}

          {/* ── 4 control buttons ─────────────────────────── */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>

            {/* MUTE */}
            <button
              onPointerDown={handleMute}
              style={{
                height: 56, borderRadius: 14,
                border: `2px solid ${isMuted ? '#ef4444' : '#e2e8f0'}`,
                background: isMuted ? '#fef2f2' : '#f8faff',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
              }}
            >
              {isMuted
                ? <MicOff style={{ width: 20, height: 20, color: '#ef4444' }} />
                : <Mic    style={{ width: 20, height: 20, color: '#374151' }} />
              }
              <span style={{ fontSize: 9, fontWeight: 700, color: isMuted ? '#ef4444' : '#64748b', letterSpacing: '0.06em' }}>
                {isMuted ? 'UNMUTE' : 'MUTE'}
              </span>
            </button>

            {/* SPEAKER */}
            <button
              onPointerDown={handleSpeaker}
              style={{
                height: 56, borderRadius: 14,
                border: `2px solid ${isSpeaker ? '#3b82f6' : '#e2e8f0'}`,
                background: isSpeaker ? '#eff6ff' : '#f8faff',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
              }}
            >
              {isSpeaker
                ? <Volume2 style={{ width: 20, height: 20, color: '#3b82f6' }} />
                : <VolumeX style={{ width: 20, height: 20, color: '#374151' }} />
              }
              <span style={{ fontSize: 9, fontWeight: 700, color: isSpeaker ? '#3b82f6' : '#64748b', letterSpacing: '0.06em' }}>
                {isSpeaker ? 'SPEAKER' : 'EARPIECE'}
              </span>
            </button>

            {/* CHAT */}
            <button
              onPointerDown={handleChat}
              style={{
                height: 56, borderRadius: 14,
                border: '2px solid #e2e8f0', background: '#f8faff',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
              }}
            >
              <MessageSquare style={{ width: 20, height: 20, color: '#374151' }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em' }}>CHAT</span>
            </button>

            {/* END */}
            <button
              onPointerDown={handleEnd}
              style={{
                height: 56, borderRadius: 14,
                border: 'none',
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                boxShadow: '0 4px 14px rgba(220,38,38,0.4)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', gap: 4,
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
              }}
            >
              <PhoneOff style={{ width: 20, height: 20, color: '#fff' }} />
              <span style={{ fontSize: 9, fontWeight: 700, color: '#fff', letterSpacing: '0.06em' }}>END</span>
            </button>
          </div>

          {/* Fallback: call 911 if failed */}
          {isFailed && (
            <a href="tel:911" style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              marginTop: 10, padding: '13px',
              background: '#111827', color: '#fff', borderRadius: 12,
              fontSize: 13, fontWeight: 700, textDecoration: 'none',
            }}>
              📞 Call Emergency Services (911)
            </a>
          )}
        </div>
      )}
    </motion.div>
  );
}
