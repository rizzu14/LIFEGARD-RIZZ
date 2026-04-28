// ============================================================
// LIFEGRID – AI Voice Agent Overlay
// Full-screen emergency mode UI that activates on SOS trigger.
// Shows: status · transcript · dispatch · ETA · data panel
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Volume2, VolumeX, X, Phone } from 'lucide-react';
import { useAIVoiceAgent, AgentStatus, DispatchStatus, LangCode } from '../../hooks/useAIVoiceAgent';
import { useAppStore } from '../../store/appStore';

// ── Status label config ───────────────────────────────────────

const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; pulse: boolean }> = {
  idle:       { label: 'Ready',        color: '#94a3b8', pulse: false },
  activating: { label: 'Activating…',  color: '#f59e0b', pulse: true  },
  speaking:   { label: 'AI Speaking…', color: '#3b82f6', pulse: true  },
  listening:  { label: 'Listening…',   color: '#22c55e', pulse: true  },
  processing: { label: 'Processing…',  color: '#8b5cf6', pulse: true  },
  ended:      { label: 'Ended',        color: '#6b7280', pulse: false },
};

const DISPATCH_CONFIG: Record<DispatchStatus, { label: string; color: string; icon: string }> = {
  TRIGGERED:       { label: 'Emergency Triggered',  color: '#ef4444', icon: '🚨' },
  COLLECTING_INFO: { label: 'Collecting Info',       color: '#f59e0b', icon: '📋' },
  DISPATCHING:     { label: 'Dispatching Help',      color: '#3b82f6', icon: '📡' },
  EN_ROUTE:        { label: 'Help En Route',         color: '#22c55e', icon: '🚑' },
  ARRIVED:         { label: 'Help Arrived',          color: '#16a34a', icon: '✅' },
};

function fmtEta(s: number) {
  if (s <= 0) return 'Arriving now';
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// ── Waveform animation ────────────────────────────────────────

function Waveform({ active, color }: { active: boolean; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3, height: 28 }}>
      {[0.4, 0.7, 1.0, 0.8, 0.5, 0.9, 0.6, 0.4, 0.75, 0.55].map((h, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2,
          background: color,
          height: active ? `${h * 100}%` : '20%',
          opacity: active ? 1 : 0.3,
          animation: active ? `voice-wave ${0.5 + i * 0.07}s ease-in-out infinite alternate` : 'none',
          animationDelay: `${i * 0.08}s`,
          transition: 'height 0.3s ease, opacity 0.3s ease',
        }} />
      ))}
    </div>
  );
}

// ── Main overlay ──────────────────────────────────────────────

interface AIVoiceAgentOverlayProps {
  onClose: () => void;
  initialLang?: LangCode;
}

export function AIVoiceAgentOverlay({ onClose, initialLang = 'en' }: AIVoiceAgentOverlayProps) {
  const { state, startAgent, stopAgent, toggleMute, submitText } = useAIVoiceAgent();
  const { setActiveTab } = useAppStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [textInput, setTextInput] = React.useState('');
  const noSTT = typeof window !== 'undefined' && !((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  // Auto-start on mount
  useEffect(() => {
    startAgent(initialLang);
    return () => stopAgent();
  }, []);

  // Auto-scroll messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.messages]);

  const statusCfg   = STATUS_CONFIG[state.status];
  const dispatchCfg = DISPATCH_CONFIG[state.dispatchStatus];
  const { emergencyData, eta, isMuted, currentEmotion } = state;

  const handleClose = () => {
    stopAgent();
    onClose();
  };

  const handleTrack = () => {
    stopAgent();
    setActiveTab('track');
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 500,
        background: 'linear-gradient(160deg, #0a0f1e 0%, #0d1117 60%, #0a0f1e 100%)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ── Top bar ─────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        flexShrink: 0,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: 14 }}>🛡️</span>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#fff', letterSpacing: '0.2em' }}>LIFEGRID AI</div>
            <div style={{ fontSize: 9, color: '#ef4444', fontFamily: 'monospace', letterSpacing: '0.1em' }}>EMERGENCY OPERATOR</div>
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={toggleMute}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: isMuted ? 'rgba(239,68,68,0.2)' : 'rgba(255,255,255,0.08)',
              border: `1px solid ${isMuted ? 'rgba(239,68,68,0.4)' : 'rgba(255,255,255,0.12)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted
              ? <VolumeX style={{ width: 15, height: 15, color: '#ef4444' }} />
              : <Volume2 style={{ width: 15, height: 15, color: '#94a3b8' }} />
            }
          </button>
          <button
            onClick={handleClose}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Close"
          >
            <X style={{ width: 15, height: 15, color: '#94a3b8' }} />
          </button>
        </div>
      </div>

      {/* ── Dispatch status bar ──────────────────────────── */}
      <motion.div
        key={state.dispatchStatus}
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 20px',
          background: `${dispatchCfg.color}12`,
          borderBottom: `1px solid ${dispatchCfg.color}25`,
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 16 }}>{dispatchCfg.icon}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: dispatchCfg.color, letterSpacing: '0.04em' }}>
          {dispatchCfg.label}
        </span>
        {(state.dispatchStatus === 'EN_ROUTE' || state.dispatchStatus === 'DISPATCHING') && (
          <span style={{
            marginLeft: 'auto',
            fontSize: 13, fontFamily: 'monospace', fontWeight: 800,
            color: eta <= 60 ? '#22c55e' : '#f59e0b',
            background: 'rgba(255,255,255,0.06)',
            padding: '3px 10px', borderRadius: 99,
          }}>
            ETA {fmtEta(eta)}
          </span>
        )}
        {state.dispatchStatus === 'ARRIVED' && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: '#22c55e', fontWeight: 700 }}>
            Help is here ✓
          </span>
        )}
      </motion.div>

      {/* ── Agent status indicator ───────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 12, padding: '20px 20px 12px', flexShrink: 0,
      }}>
        {/* Pulsing orb */}
        <div style={{ position: 'relative', width: 56, height: 56, flexShrink: 0 }}>
          {statusCfg.pulse && (
            <div style={{
              position: 'absolute', inset: -8, borderRadius: '50%',
              background: statusCfg.color, opacity: 0.12,
              animation: 'ping 1.5s ease-out infinite',
            }} />
          )}
          <div style={{
            width: 56, height: 56, borderRadius: '50%',
            background: `${statusCfg.color}18`,
            border: `2px solid ${statusCfg.color}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {state.status === 'listening'
              ? <Mic style={{ width: 22, height: 22, color: statusCfg.color }} />
              : state.status === 'speaking' || state.status === 'activating'
              ? <Volume2 style={{ width: 22, height: 22, color: statusCfg.color }} />
              : <span style={{ fontSize: 20 }}>🤖</span>
            }
          </div>
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            {statusCfg.pulse && (
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusCfg.color, animation: 'pulse 1s infinite' }} />
            )}
            <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>{statusCfg.label}</span>
          </div>
          <Waveform
            active={state.status === 'speaking' || state.status === 'listening'}
            color={statusCfg.color}
          />
        </div>
      </div>

      {/* ── Transcript ───────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '8px 20px 12px',
        display: 'flex', flexDirection: 'column', gap: 10,
      }}>
        <AnimatePresence initial={false}>
          {state.messages.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                display: 'flex',
                justifyContent: msg.speaker === 'user' ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                maxWidth: '82%',
                padding: '10px 14px',
                borderRadius: msg.speaker === 'user' ? '16px 4px 16px 16px' : '4px 16px 16px 16px',
                background: msg.speaker === 'user'
                  ? 'rgba(59,130,246,0.18)'
                  : 'rgba(255,255,255,0.07)',
                border: msg.speaker === 'user'
                  ? '1px solid rgba(59,130,246,0.3)'
                  : '1px solid rgba(255,255,255,0.08)',
              }}>
                {msg.speaker === 'ai' && (
                  <div style={{ fontSize: 9, color: '#3b82f6', fontFamily: 'monospace', letterSpacing: '0.1em', marginBottom: 4, textTransform: 'uppercase' }}>
                    LIFEGRID AI
                  </div>
                )}
                <p style={{ fontSize: 13, color: '#f1f5f9', lineHeight: 1.55, margin: 0 }}>
                  {msg.text}
                </p>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <div ref={messagesEndRef} />
      </div>

      {/* ── Emergency data panel ─────────────────────────── */}
      {(emergencyData.emergencyType || emergencyData.location) && (
        <div style={{
          margin: '0 16px 12px',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 14, padding: '12px 16px',
          display: 'flex', flexWrap: 'wrap', gap: 8,
          flexShrink: 0,
        }}>
          {emergencyData.emergencyType && (
            <DataChip icon="🚨" label="Type" value={emergencyData.emergencyType} color="#ef4444" />
          )}
          {emergencyData.location && (
            <DataChip icon="📍" label="Location" value={emergencyData.location} color="#3b82f6" />
          )}
          {emergencyData.serviceNeeded && (
            <DataChip icon="🚑" label="Service" value={emergencyData.serviceNeeded} color="#22c55e" />
          )}
          {emergencyData.severity && (
            <DataChip icon="⚠️" label="Severity" value={emergencyData.severity} color="#f59e0b" />
          )}
        </div>
      )}

      {/* ── Bottom actions ───────────────────────────────── */}
      <div style={{
        padding: '12px 20px 20px',
        borderTop: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
      }}>

        {/* Text input fallback — always shown when listening */}
        {(state.status === 'listening' || noSTT) && (
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={textInput}
              onChange={e => setTextInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && textInput.trim()) {
                  submitText(textInput);
                  setTextInput('');
                }
              }}
              placeholder={noSTT ? 'Type your response…' : 'Or type here if mic not working…'}
              style={{
                flex: 1, padding: '10px 14px',
                background: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 12, color: '#f1f5f9',
                fontSize: 13, outline: 'none',
                fontFamily: 'inherit',
              }}
            />
            <button
              onClick={() => { if (textInput.trim()) { submitText(textInput); setTextInput(''); } }}
              style={{
                padding: '10px 16px', borderRadius: 12,
                background: 'rgba(59,130,246,0.2)',
                border: '1px solid rgba(59,130,246,0.3)',
                color: '#60a5fa', fontWeight: 700, fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Send
            </button>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleTrack}
            style={{
              flex: 1, padding: '13px',
              background: 'rgba(34,197,94,0.15)',
              border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: 14, color: '#22c55e',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            📍 Track Responder
          </button>
          <a
            href="tel:7780284992"
            style={{
              flex: 1, padding: '13px',
              background: 'rgba(239,68,68,0.12)',
              border: '1px solid rgba(239,68,68,0.25)',
              borderRadius: 14, color: '#ef4444',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              textDecoration: 'none',
            }}
          >
            <Phone style={{ width: 15, height: 15 }} />
            Call Emergency
          </a>
        </div>
      </div>
    </motion.div>
  );
}

// ── Data chip ─────────────────────────────────────────────────

function DataChip({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 99,
      background: `${color}12`, border: `1px solid ${color}25`,
    }}>
      <span style={{ fontSize: 11 }}>{icon}</span>
      <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', textTransform: 'uppercase' }}>{label}:</span>
      <span style={{ fontSize: 11, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
