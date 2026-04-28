// ============================================================
// LIFEGRID – Home Screen  v4.0  Premium UI
// Apple / Stripe quality · Glassmorphism · Soft gradients
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Wifi, WifiOff, Mic, ChevronRight, Shield, Clock, Activity } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/appStore';
import { useHaptic } from '../hooks/useHaptic';
import { useVoice, speak } from '../hooks/useVoice';
import { useOffline } from '../hooks/useOffline';
import { api } from '../lib/api';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { LiveStatusPanel } from '../components/emergency/LiveStatusPanel';
import { classifyEmergency } from '../hooks/useEmergencyClassifier';
import { v4 as uuidv4 } from 'uuid';

const HOLD_DURATION_MS = 2000;
const CONFIRM_DURATION = 3;

const SUPPORT_MESSAGES = [
  'You are safe. Help is one tap away.',
  'Stay calm. We are ready to assist you.',
  'Emergency support available 24/7.',
  'You are not alone. We are here.',
];

export default function HomeScreen() {
  const {
    sosState, setSosState, setSosHoldProgress,
    setActiveIncident, setActiveTab,
    language, setLanguage,
    userLocation, enqueueOffline,
  } = useAppStore();

  const navigate = useNavigate();
  const { haptic } = useHaptic();
  const { isOnline } = useOffline();

  const holdTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef  = useRef<number>(0);
  const [holdPct, setHoldPct]     = useState(0);
  const [countdown, setCountdown] = useState(CONFIRM_DURATION);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [msgIdx, setMsgIdx] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setMsgIdx(i => (i + 1) % SUPPORT_MESSAGES.length), 5000);
    return () => clearInterval(t);
  }, []);

  const { isListening, isSupported: voiceSupported, toggleListening } = useVoice({
    onResult: ({ transcript, isFinal }) => {
      setVoiceTranscript(transcript);
      if (transcript.length > 3) classifyEmergency(transcript);
      if (isFinal) {
        const lower = transcript.toLowerCase();
        const triggerWords = ['sos', 'emergency', 'help', 'ayuda', 'urgence', 'مساعدة', '救命'];
        if (triggerWords.some(w => lower.includes(w))) { haptic('sos'); beginConfirm(); }
      }
    },
  });

  const startHold = useCallback(() => {
    if (sosState !== 'idle') return;
    haptic('tap'); setSosState('holding'); holdStartRef.current = Date.now();
    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current;
      const pct = Math.min((elapsed / HOLD_DURATION_MS) * 100, 100);
      setHoldPct(pct); setSosHoldProgress(pct);
      if (pct >= 100) { clearInterval(holdTimerRef.current!); haptic('success'); beginConfirm(); }
    }, 16);
  }, [sosState, haptic, setSosState, setSosHoldProgress]);

  const cancelHold = useCallback(() => {
    if (sosState !== 'holding') return;
    clearInterval(holdTimerRef.current!);
    haptic('tap'); setSosState('idle'); setHoldPct(0); setSosHoldProgress(0);
  }, [sosState, haptic, setSosState, setSosHoldProgress]);

  const beginConfirm = useCallback(() => {
    setSosState('confirming'); setCountdown(CONFIRM_DURATION); setHoldPct(0);
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(countdownRef.current!); submitSOS(); return 0; }
        haptic('tick'); return prev - 1;
      });
    }, 1000);
  }, [haptic, setSosState]);

  const cancelConfirm = useCallback(() => {
    clearInterval(countdownRef.current!);
    haptic('tap'); setSosState('idle'); setCountdown(CONFIRM_DURATION); setHoldPct(0);
  }, [haptic, setSosState]);

  const submitSOS = useCallback(async () => {
    setSosState('submitting'); setIsSubmitting(true); haptic('sos');
    const payload = { rawInput: voiceTranscript || 'SOS – Emergency button activated', language, source: 'PANIC_BUTTON', location: userLocation ?? undefined };
    const localRef = `SOS-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*999999).toString().padStart(6,'0')}`;
    const localId  = uuidv4();
    try {
      const res = await Promise.race([
        api.post('/incidents/report', payload),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]) as any;
      const { incidentId, referenceCode } = res.data.data;
      setActiveIncident(incidentId, referenceCode);
      speak('Help is on the way. Stay calm.', language);
    } catch {
      enqueueOffline({ id: localId, type: 'SOS', payload, timestamp: new Date().toISOString(), retries: 0 });
      setActiveIncident(localId, localRef);
      speak('Emergency alert sent. Help is being dispatched. Stay calm.', language);
    }
    setActiveTab('track'); setIsSubmitting(false);
    setTimeout(() => {
      const { initiateCall } = useAppStore.getState();
      const incidentId = useAppStore.getState().activeIncidentId;
      if (incidentId) initiateCall(incidentId);
    }, 800);
  }, [voiceTranscript, language, userLocation, enqueueOffline, setActiveIncident, setActiveTab, setSosState, haptic]);

  useEffect(() => () => {
    clearInterval(holdTimerRef.current!);
    clearInterval(countdownRef.current!);
  }, []);

  const isActive  = sosState === 'active';
  const isIdle    = sosState === 'idle';
  const isWorking = !isIdle && !isActive;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
      background: 'linear-gradient(145deg, #f0f4ff 0%, #f8fafc 40%, #eef2ff 100%)',
      position: 'relative',
    }}>

      {/* ── Ambient background orbs ─────────────────────── */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: '15%', left: '50%', transform: 'translateX(-50%)', width: 400, height: 400, borderRadius: '50%', background: 'radial-gradient(circle, rgba(99,102,241,0.06) 0%, transparent 70%)', }} />
        <div style={{ position: 'absolute', bottom: '20%', right: '-10%', width: 300, height: 300, borderRadius: '50%', background: 'radial-gradient(circle, rgba(34,197,94,0.05) 0%, transparent 70%)', }} />
        <div style={{ position: 'absolute', top: '60%', left: '-5%', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(239,68,68,0.04) 0%, transparent 70%)', }} />
      </div>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{
        height: 60, paddingTop: 'var(--safe-top)',
        display: 'flex', alignItems: 'center',
        paddingLeft: 20, paddingRight: 20, flexShrink: 0,
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(99,102,241,0.08)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.04)',
        position: 'relative', zIndex: 10,
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            boxShadow: '0 2px 8px rgba(49,46,129,0.35)',
          }}>
            <span style={{ fontSize: 10, fontWeight: 900, color: '#fff', letterSpacing: '0.05em' }}>LG</span>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.18em', color: '#1e1b4b', textTransform: 'uppercase' }}>LIFEGRID</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 1 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: isOnline ? '#22c55e' : '#f59e0b', flexShrink: 0, boxShadow: isOnline ? '0 0 4px #22c55e' : 'none' }} />
              <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {isOnline ? 'System Ready' : 'Offline Mode'}
              </span>
            </div>
          </div>
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Network icon */}
          <div style={{
            width: 30, height: 30, borderRadius: 8,
            background: 'rgba(255,255,255,0.8)',
            border: '1px solid rgba(0,0,0,0.06)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            {isOnline
              ? <Wifi style={{ width: 14, height: 14, color: '#22c55e' }} />
              : <WifiOff style={{ width: 14, height: 14, color: '#f59e0b' }} />
            }
          </div>

          {/* Kisan-Kavach pill */}
          <button
            onClick={() => navigate('/kisan')}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              height: 36, padding: '0 12px 0 5px',
              borderRadius: 99,
              background: 'linear-gradient(135deg, rgba(240,253,244,0.95) 0%, rgba(220,252,231,0.95) 100%)',
              border: '1.5px solid rgba(134,239,172,0.7)',
              boxShadow: '0 2px 10px rgba(21,128,61,0.12), inset 0 1px 0 rgba(255,255,255,0.6)',
              cursor: 'pointer', whiteSpace: 'nowrap',
              backdropFilter: 'blur(8px)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={e => { const b = e.currentTarget; b.style.transform = 'translateY(-1px)'; b.style.boxShadow = '0 4px 16px rgba(21,128,61,0.22), inset 0 1px 0 rgba(255,255,255,0.6)'; }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.transform = 'translateY(0)'; b.style.boxShadow = '0 2px 10px rgba(21,128,61,0.12), inset 0 1px 0 rgba(255,255,255,0.6)'; }}
          >
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'linear-gradient(135deg, #16a34a, #15803d)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0, boxShadow: '0 1px 4px rgba(21,128,61,0.3)' }}>🌾</div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#15803d' }}>Kisan-Kavach</span>
              <span style={{ fontSize: 8, color: '#6b7280', fontFamily: 'monospace' }}>Farmer Mode</span>
            </div>
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" style={{ marginLeft: 1 }}>
              <path d="M1.5 3l3 3 3-3" stroke="#6b7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {/* Language */}
          <LanguageSelector value={language} onChange={setLanguage} compact />
        </div>
      </div>

      {/* ── Status strip ───────────────────────────────────── */}
      <div style={{ position: 'relative', zIndex: 9 }}>
        <LiveStatusPanel voiceTranscript={voiceTranscript} />
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', padding: '20px 20px 20px',
        position: 'relative', zIndex: 1,
      }}>

        {/* Active incident banner */}
        <AnimatePresence>
          {isActive && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} style={{ width: '100%', marginBottom: 16 }}>
              <ActiveIncidentBanner />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Status bar */}
        <AnimatePresence>
          {isIdle && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ width: '100%', marginBottom: 16 }}>
              <StatusBar isOnline={isOnline} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── SOS zone ─────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 22, width: '100%', position: 'relative' }}>

          {/* Countdown overlay */}
          <AnimatePresence>
            {sosState === 'confirming' && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: 'rgba(240,244,255,0.97)', backdropFilter: 'blur(12px)' }}>
                <CountdownOverlay countdown={countdown} total={CONFIRM_DURATION} onCancel={cancelConfirm} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Radial glow behind SOS */}
          <div style={{
            position: 'absolute', width: 320, height: 320, borderRadius: '50%',
            background: isActive
              ? 'radial-gradient(circle, rgba(34,197,94,0.14) 0%, transparent 65%)'
              : 'radial-gradient(circle, rgba(239,68,68,0.10) 0%, rgba(99,102,241,0.05) 50%, transparent 70%)',
            pointerEvents: 'none', transition: 'background 0.8s ease',
          }} />

          {/* SOS button container */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 240, height: 240 }}>

            {/* Pulse rings */}
            {(isIdle || sosState === 'holding') && (
              <>
                <div className="sos-ring-calm" style={{ pointerEvents: 'none' }} />
                <div className="sos-ring-calm sos-ring-calm--2" style={{ pointerEvents: 'none' }} />
              </>
            )}

            {/* Hold progress arc */}
            {sosState === 'holding' && (
              <svg style={{ position: 'absolute', transform: 'rotate(-90deg)', pointerEvents: 'none', zIndex: 1 }} width="210" height="210">
                <circle cx="105" cy="105" r="92" fill="none" stroke="rgba(239,68,68,0.08)" strokeWidth="5" />
                <circle cx="105" cy="105" r="92" fill="none" stroke="url(#holdGrad)" strokeWidth="5" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 92}`}
                  strokeDashoffset={`${2 * Math.PI * 92 * (1 - holdPct / 100)}`}
                  style={{ transition: 'stroke-dashoffset 16ms linear' }}
                />
                <defs>
                  <linearGradient id="holdGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#f87171" />
                    <stop offset="100%" stopColor="#ef4444" />
                  </linearGradient>
                </defs>
              </svg>
            )}

            {/* SOS BUTTON */}
            <motion.button
              className={`sos-btn-v4 ${isActive ? 'sos-btn-v4--active' : ''} ${sosState === 'holding' ? 'sos-btn-v4--holding' : ''}`}
              style={{ position: 'relative', zIndex: 2, touchAction: 'none' }}
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); if (sosState === 'idle') startHold(); }}
              onPointerUp={() => { if (sosState === 'holding') cancelHold(); }}
              onPointerLeave={() => { if (sosState === 'holding') cancelHold(); }}
              onPointerCancel={() => { if (sosState === 'holding') cancelHold(); }}
              animate={sosState === 'holding' ? { scale: 1.06 } : { scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22 }}
              aria-label="SOS Emergency Button — hold for 2 seconds"
              aria-pressed={isActive}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  style={{ width: 30, height: 30, border: '3px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%' }} />
              ) : (
                <>
                  <span className="sos-btn-v4__label">SOS</span>
                  <span className="sos-btn-v4__sub">{sosState === 'holding' ? 'HOLD...' : isActive ? 'ACTIVE' : 'HOLD 2s'}</span>
                </>
              )}
            </motion.button>
          </div>

          {/* Instruction text */}
          <motion.p key={sosState} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
            style={{ fontSize: 11, color: '#94a3b8', textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.18em', textTransform: 'uppercase', margin: 0 }}>
            {isIdle    && 'Press and hold to activate'}
            {isWorking && 'Keep holding…'}
            {isActive  && 'Help dispatched · See tracking'}
          </motion.p>

          {/* Support message pill */}
          <AnimatePresence mode="wait">
            {isIdle && (
              <motion.div key={msgIdx} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.45 }}
                style={{
                  padding: '9px 22px',
                  background: 'rgba(255,255,255,0.65)',
                  border: '1px solid rgba(99,102,241,0.12)',
                  borderRadius: 99,
                  backdropFilter: 'blur(12px)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.04)',
                }}>
                <p style={{ fontSize: 12, color: '#475569', textAlign: 'center', margin: 0, fontWeight: 500 }}>
                  {SUPPORT_MESSAGES[msgIdx]}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Action cards ──────────────────────────────────── */}
        <AnimatePresence>
          {isIdle && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}
              style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>

              {/* Voice command */}
              <GlassCard
                icon={isListening ? <VoiceWaveform /> : <Mic style={{ width: 18, height: 18, color: voiceSupported ? '#6366f1' : '#cbd5e1' }} />}
                iconBg={isListening ? 'linear-gradient(135deg, #eef2ff, #e0e7ff)' : 'linear-gradient(135deg, #f8faff, #eef2ff)'}
                iconBorder={isListening ? '#a5b4fc' : '#c7d2fe'}
                iconShadow={isListening ? '0 2px 8px rgba(99,102,241,0.2)' : '0 1px 4px rgba(99,102,241,0.08)'}
                title={isListening ? 'Listening… tap to stop' : 'Voice Command'}
                subtitle={voiceTranscript ? `"${voiceTranscript}"` : voiceSupported ? 'Say "SOS" or "Emergency"' : 'Chrome / Edge only'}
                active={isListening}
                badge={isListening ? <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite', flexShrink: 0 }} /> : undefined}
                onClick={() => { if (!voiceSupported) { alert('Voice input requires Chrome or Edge.'); return; } toggleListening(); }}
              />

              {/* Call emergency */}
              <a href="tel:7780284992" style={{ textDecoration: 'none' }}>
                <GlassCard
                  icon={<Phone style={{ width: 18, height: 18, color: '#16a34a' }} />}
                  iconBg="linear-gradient(135deg, #f0fdf4, #dcfce7)"
                  iconBorder="#86efac"
                  iconShadow="0 2px 8px rgba(34,197,94,0.15)"
                  title="Call Emergency Services"
                  subtitle="7780284992 · Always available"
                  chevron
                />
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Status bar ────────────────────────────────────────────────

function StatusBar({ isOnline }: { isOnline: boolean }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '9px 16px',
      background: isOnline
        ? 'linear-gradient(135deg, rgba(240,253,244,0.9), rgba(220,252,231,0.9))'
        : 'linear-gradient(135deg, rgba(255,251,235,0.9), rgba(254,243,199,0.9))',
      border: `1px solid ${isOnline ? 'rgba(134,239,172,0.5)' : 'rgba(252,211,77,0.5)'}`,
      borderRadius: 14,
      backdropFilter: 'blur(12px)',
      boxShadow: isOnline ? '0 2px 12px rgba(34,197,94,0.08)' : '0 2px 12px rgba(245,158,11,0.08)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative', width: 8, height: 8 }}>
          <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', background: isOnline ? '#22c55e' : '#f59e0b', opacity: 0.25, animation: 'ping 2s ease-out infinite' }} />
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: isOnline ? '#22c55e' : '#f59e0b' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 600, color: isOnline ? '#15803d' : '#92400e' }}>
          {isOnline ? 'Connected to LIFEGRID' : 'Offline — local mode active'}
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <Clock style={{ width: 10, height: 10, color: '#94a3b8' }} />
        <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace' }}>Avg &lt; 5 min</span>
      </div>
    </div>
  );
}

// ── Active incident banner ────────────────────────────────────

function ActiveIncidentBanner() {
  const { activeReferenceCode, setActiveTab } = useAppStore();
  return (
    <motion.button
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
      onClick={() => setActiveTab('track')}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '13px 18px',
        background: 'linear-gradient(135deg, rgba(240,253,244,0.95), rgba(220,252,231,0.95))',
        border: '1.5px solid rgba(134,239,172,0.7)',
        borderRadius: 16,
        boxShadow: '0 4px 20px rgba(34,197,94,0.14)',
        cursor: 'pointer',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
        <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', background: '#22c55e', opacity: 0.25, animation: 'ping 1.5s ease-out infinite' }} />
        <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e' }} />
      </div>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#15803d', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Help Dispatched</div>
        <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#6b7280', marginTop: 1 }}>{activeReferenceCode}</div>
      </div>
      <ChevronRight style={{ width: 16, height: 16, color: '#22c55e' }} />
    </motion.button>
  );
}

// ── Glass card ────────────────────────────────────────────────

function GlassCard({
  icon, iconBg, iconBorder, iconShadow, title, subtitle, active, badge, chevron, onClick,
}: {
  icon: React.ReactNode; iconBg: string; iconBorder: string; iconShadow: string;
  title: string; subtitle: string;
  active?: boolean; badge?: React.ReactNode; chevron?: boolean;
  onClick?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 14,
        padding: '14px 16px',
        background: active
          ? 'rgba(238,242,255,0.92)'
          : hovered ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.80)',
        border: `1.5px solid ${active ? 'rgba(165,180,252,0.6)' : hovered ? 'rgba(99,102,241,0.15)' : 'rgba(148,163,184,0.15)'}`,
        borderRadius: 18,
        boxShadow: hovered
          ? '0 8px 28px rgba(0,0,0,0.08), 0 2px 8px rgba(99,102,241,0.06)'
          : '0 2px 12px rgba(0,0,0,0.04)',
        cursor: onClick ? 'pointer' : 'default',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        transform: hovered ? 'translateY(-1px)' : 'translateY(0)',
        transition: 'all 0.2s ease',
      }}
    >
      <div style={{
        width: 42, height: 42, borderRadius: 13, flexShrink: 0,
        background: iconBg, border: `1.5px solid ${iconBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: iconShadow,
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.01em' }}>{title}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{subtitle}</div>
      </div>
      {badge}
      {chevron && <ChevronRight style={{ width: 15, height: 15, color: '#cbd5e1', flexShrink: 0 }} />}
    </div>
  );
}

// ── Countdown overlay ─────────────────────────────────────────

function CountdownOverlay({ countdown, total, onCancel }: { countdown: number; total: number; onCancel: () => void }) {
  const radius = 64; const circ = 2 * Math.PI * radius;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 28, padding: '0 32px' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="168" height="168">
          <circle cx="84" cy="84" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="6" />
          <circle cx="84" cy="84" r={radius} fill="none" stroke="#ef4444" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={circ} strokeDashoffset={circ - (countdown / total) * circ}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '84px 84px', transition: 'stroke-dashoffset 1s linear' }} />
        </svg>
        <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: 52, fontWeight: 800, fontFamily: 'monospace', color: '#0f172a', lineHeight: 1 }}>{countdown}</span>
          <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#94a3b8', letterSpacing: '0.2em', textTransform: 'uppercase', marginTop: 4 }}>seconds</span>
        </div>
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Sending SOS</div>
        <div style={{ fontSize: 13, color: '#64748b' }}>Emergency services will be notified</div>
      </div>
      <button onClick={onCancel} style={{
        width: '100%', padding: '15px',
        background: 'rgba(255,255,255,0.9)', border: '1.5px solid #e2e8f0',
        borderRadius: 14, fontSize: 13, fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: '#475569', cursor: 'pointer', backdropFilter: 'blur(8px)',
      }}>Cancel</button>
    </div>
  );
}

// ── Voice waveform ────────────────────────────────────────────

function VoiceWaveform() {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 18 }}>
      {[0.3, 0.7, 1.0, 0.6, 0.4, 0.8, 0.5].map((h, i) => (
        <div key={i} style={{
          width: 3, borderRadius: 2, background: '#6366f1',
          height: `${h * 100}%`,
          animation: `voice-wave ${0.6 + i * 0.08}s ease-in-out infinite alternate`,
          animationDelay: `${i * 0.1}s`, transformOrigin: 'bottom',
        }} />
      ))}
    </div>
  );
}
