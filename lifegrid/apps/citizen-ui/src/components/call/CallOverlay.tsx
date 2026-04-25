// ============================================================
// LIFEGRID – Emergency Call Overlay
// Non-blocking floating call UI shown during active calls
//
// States:
//   initiating → "Connecting to LIFEGRID..."
//   ringing    → "Calling control center..." + pulse
//   connected  → Operator name + duration + controls
//   failed     → Fallback options
//   ended      → Summary
// ============================================================

import React, { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, Mic, MicOff, Volume2, VolumeX,
  Wifi, WifiOff, Wifi as WifiLow, AlertTriangle,
  ChevronDown, ChevronUp, MessageSquare,
} from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { useEmergencyCall, formatCallDuration } from '../../hooks/useEmergencyCall';

// ── Signal strength indicator ─────────────────────────────────

function SignalBars({ strength }: { strength: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
      {[1, 2, 3, 4].map(bar => (
        <div
          key={bar}
          style={{
            width: 3,
            height: `${bar * 25}%`,
            borderRadius: 1,
            background: bar <= strength ? '#22c55e' : '#d1d5db',
            transition: 'background 0.3s',
          }}
        />
      ))}
    </div>
  );
}

// ── AI Suggestions strip ──────────────────────────────────────

function AISuggestionsStrip({ suggestions }: { suggestions: string[] }) {
  if (suggestions.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      style={{
        background: '#eff6ff',
        border: '1px solid #bfdbfe',
        borderRadius: 10,
        padding: '10px 14px',
        marginTop: 8,
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, color: '#1d4ed8', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 }}>
        AI Guidance
      </div>
      <p style={{ fontSize: 13, color: '#1e40af', lineHeight: 1.5 }}>
        {suggestions[0]}
      </p>
    </motion.div>
  );
}

// ── Live transcript strip ─────────────────────────────────────

function LiveTranscript({ lines }: { lines: any[] }) {
  const lastFinal = [...lines].reverse().find(l => l.isFinal && l.speaker === 'citizen');
  const interim   = [...lines].reverse().find(l => !l.isFinal && l.speaker === 'citizen');

  if (!lastFinal && !interim) return null;

  return (
    <div style={{
      background: '#f9fafb', border: '1px solid #e5e7eb',
      borderRadius: 8, padding: '8px 12px', marginTop: 8,
    }}>
      <div style={{ fontSize: 9, color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 3 }}>
        Live Transcript
      </div>
      {lastFinal && (
        <p style={{ fontSize: 12, color: '#374151', lineHeight: 1.4 }}>
          "{lastFinal.text}"
        </p>
      )}
      {interim && (
        <p style={{ fontSize: 12, color: '#9ca3af', fontStyle: 'italic', lineHeight: 1.4 }}>
          {interim.text}...
        </p>
      )}
    </div>
  );
}

// ── Detected keywords ─────────────────────────────────────────

function KeywordBadges({ keywords }: { keywords: any[] }) {
  if (keywords.length === 0) return null;
  const recent = keywords.slice(-3);
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      {recent.map((kw, i) => (
        <span key={i} style={{
          fontSize: 10, fontWeight: 700, padding: '2px 8px',
          borderRadius: 20, background: '#fef2f2', color: '#dc2626',
          border: '1px solid #fecaca',
        }}>
          ⚠ {kw.keyword}
        </span>
      ))}
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────

export function CallOverlay() {
  const {
    callSession, isCallOverlayVisible,
    setCallOverlayVisible, setActiveTab,
  } = useAppStore();

  const { endCall, toggleMute, toggleSpeaker } = useEmergencyCall();
  const [expanded, setExpanded] = React.useState(true);

  if (!isCallOverlayVisible || !callSession) return null;

  const { state, operatorName, durationSeconds, isMuted, isSpeaker,
          signalStrength, aiSuggestions, liveTranscript, aiKeywords,
          fallbackMode, retryCount } = callSession;

  const isConnected  = state === 'connected';
  const isRinging    = state === 'ringing' || state === 'initiating';
  const isFailed     = state === 'failed';
  const isEnded      = state === 'ended';

  // Status text
  const statusText = {
    initiating: 'Connecting to LIFEGRID...',
    ringing:    'Calling control center...',
    connected:  operatorName ?? 'LIFEGRID Control Center',
    on_hold:    'On hold...',
    failed:     'Connection failed',
    ended:      'Call ended',
  }[state] ?? 'Connecting...';

  const statusColor = {
    initiating: '#f59e0b',
    ringing:    '#3b82f6',
    connected:  '#22c55e',
    on_hold:    '#f59e0b',
    failed:     '#ef4444',
    ended:      '#6b7280',
  }[state] ?? '#6b7280';

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 35 }}
      style={{
        position: 'fixed',
        bottom: 72,   // Above bottom nav
        left: 12,
        right: 12,
        zIndex: 300,
        background: '#ffffff',
        borderRadius: 20,
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
        border: `2px solid ${statusColor}40`,
        overflow: 'hidden',
      }}
    >
      {/* ── Compact header (always visible) ──────────────── */}
      <div
        style={{
          padding: '12px 16px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          background: isConnected ? '#f0fdf4' : isRinging ? '#eff6ff' : isFailed ? '#fef2f2' : '#f9fafb',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Status dot */}
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          background: statusColor,
          boxShadow: isConnected ? `0 0 8px ${statusColor}` : 'none',
          animation: isRinging ? 'pulse 1s infinite' : 'none',
          flexShrink: 0,
        }} />

        {/* Status text */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', truncate: true }}>
            {statusText}
          </div>
          {isConnected && (
            <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
              {formatCallDuration(durationSeconds)}
            </div>
          )}
          {isRinging && (
            <div style={{ fontSize: 11, color: '#3b82f6' }}>
              Routing to nearest operator...
            </div>
          )}
        </div>

        {/* Signal strength */}
        {isConnected && <SignalBars strength={signalStrength} />}

        {/* Expand/collapse */}
        {expanded
          ? <ChevronDown style={{ width: 16, height: 16, color: '#9ca3af', flexShrink: 0 }} />
          : <ChevronUp   style={{ width: 16, height: 16, color: '#9ca3af', flexShrink: 0 }} />
        }
      </div>

      {/* ── Expanded content ──────────────────────────────── */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ padding: '12px 16px 16px' }}>

              {/* AI suggestions */}
              <AISuggestionsStrip suggestions={aiSuggestions} />

              {/* Detected keywords */}
              <KeywordBadges keywords={aiKeywords} />

              {/* Live transcript */}
              {isConnected && <LiveTranscript lines={liveTranscript} />}

              {/* Fallback info */}
              {isFailed && retryCount > 0 && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca',
                  borderRadius: 10, padding: '10px 14px', marginTop: 8,
                }}>
                  <div style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
                    {fallbackMode === 'voip_retry'       && '🔄 Retrying with backup servers...'}
                    {fallbackMode === 'alternate_number' && '📞 Switching to backup line'}
                    {fallbackMode === 'text_only'        && '💬 Text mode active — type below'}
                  </div>
                </div>
              )}

              {/* Call controls */}
              <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>

                {/* Mute */}
                <button
                  onClick={toggleMute}
                  style={{
                    flex: 1, height: 48, borderRadius: 14,
                    border: `2px solid ${isMuted ? '#ef4444' : '#e5e7eb'}`,
                    background: isMuted ? '#fef2f2' : '#f9fafb',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 3,
                    cursor: 'pointer',
                  }}
                >
                  {isMuted
                    ? <MicOff style={{ width: 18, height: 18, color: '#ef4444' }} />
                    : <Mic    style={{ width: 18, height: 18, color: '#374151' }} />
                  }
                  <span style={{ fontSize: 9, color: isMuted ? '#ef4444' : '#6b7280', fontWeight: 600 }}>
                    {isMuted ? 'UNMUTE' : 'MUTE'}
                  </span>
                </button>

                {/* Speaker */}
                <button
                  onClick={toggleSpeaker}
                  style={{
                    flex: 1, height: 48, borderRadius: 14,
                    border: `2px solid ${isSpeaker ? '#3b82f6' : '#e5e7eb'}`,
                    background: isSpeaker ? '#eff6ff' : '#f9fafb',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 3,
                    cursor: 'pointer',
                  }}
                >
                  {isSpeaker
                    ? <Volume2  style={{ width: 18, height: 18, color: '#3b82f6' }} />
                    : <VolumeX  style={{ width: 18, height: 18, color: '#374151' }} />
                  }
                  <span style={{ fontSize: 9, color: isSpeaker ? '#3b82f6' : '#6b7280', fontWeight: 600 }}>
                    {isSpeaker ? 'SPEAKER' : 'EARPIECE'}
                  </span>
                </button>

                {/* Chat fallback */}
                <button
                  onClick={() => setActiveTab('chat')}
                  style={{
                    flex: 1, height: 48, borderRadius: 14,
                    border: '2px solid #e5e7eb', background: '#f9fafb',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 3,
                    cursor: 'pointer',
                  }}
                >
                  <MessageSquare style={{ width: 18, height: 18, color: '#374151' }} />
                  <span style={{ fontSize: 9, color: '#6b7280', fontWeight: 600 }}>CHAT</span>
                </button>

                {/* End call */}
                <button
                  onClick={endCall}
                  style={{
                    flex: 1, height: 48, borderRadius: 14,
                    border: 'none', background: '#dc2626',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 3,
                    cursor: 'pointer',
                  }}
                >
                  <PhoneOff style={{ width: 18, height: 18, color: '#fff' }} />
                  <span style={{ fontSize: 9, color: '#fff', fontWeight: 600 }}>END</span>
                </button>
              </div>

              {/* Alternate number fallback */}
              {isFailed && fallbackMode === 'alternate_number' && (
                <a
                  href="tel:911"
                  style={{
                    display: 'block', marginTop: 10, padding: '12px',
                    background: '#111827', color: '#fff', borderRadius: 12,
                    textAlign: 'center', fontSize: 14, fontWeight: 700,
                    textDecoration: 'none',
                  }}
                >
                  📞 Call Emergency Services (911)
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
