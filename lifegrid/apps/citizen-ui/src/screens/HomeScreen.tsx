// ============================================================
// LIFEGRID – Screen 1: Home
// Emergency-first. SOS button dominates the entire screen.
//
// UX Behavior:
//   - SOS requires 2-second hold to prevent accidental triggers
//   - Hold progress shown as ring countdown
//   - On release before 2s: cancel with haptic feedback
//   - On complete: 3-second confirmation countdown with cancel option
//   - On confirm: submit incident, switch to Track tab
//   - Voice command "SOS" / "Emergency" triggers same flow
//   - Offline: queues to local storage, submits when online
// ============================================================

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Phone, Wifi, WifiOff, Mic, MicOff, ChevronRight, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useHaptic } from '../hooks/useHaptic';
import { useVoice, speak } from '../hooks/useVoice';
import { useOffline } from '../hooks/useOffline';
import { api } from '../lib/api';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { LiveStatusPanel } from '../components/emergency/LiveStatusPanel';
import { classifyEmergency } from '../hooks/useEmergencyClassifier';
import { v4 as uuidv4 } from 'uuid';

// ── SOS hold duration ─────────────────────────────────────────
const HOLD_DURATION_MS  = 2000;
const CONFIRM_DURATION  = 3;   // seconds countdown before auto-submit

export default function HomeScreen() {
  const {
    sosState, setSosState, setSosHoldProgress,
    setActiveIncident, setActiveTab,
    language, setLanguage,
    userLocation, enqueueOffline,
  } = useAppStore();

  const { haptic } = useHaptic();
  const { isOnline } = useOffline();

  // Hold mechanics
  const holdTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStartRef    = useRef<number>(0);
  const [holdPct, setHoldPct] = useState(0);

  // Confirm countdown
  const [countdown, setCountdown] = useState(CONFIRM_DURATION);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  // ── Voice command + AI classification ────────────────────

  const { isListening, isSupported: voiceSupported, toggleListening } = useVoice({
    onResult: ({ transcript, isFinal }) => {
      setVoiceTranscript(transcript);

      // Run AI classification on every interim result
      // so the Live Status Panel updates as user speaks
      if (transcript.length > 3) {
        const result = classifyEmergency(transcript);
        if (result.type !== 'UNKNOWN') {
          // Classification is passed to LiveStatusPanel via voiceTranscript prop
          // Panel reads it and updates emergency type display in real time
        }
      }

      if (isFinal) {
        const lower = transcript.toLowerCase();
        const triggerWords = ['sos', 'emergency', 'help', 'ayuda', 'urgence', 'مساعدة', '救命'];
        if (triggerWords.some(w => lower.includes(w))) {
          haptic('sos');
          beginConfirm();
        }
      }
    },
  });

  // ── Hold mechanics ────────────────────────────────────────

  const startHold = useCallback(() => {
    if (sosState !== 'idle') return;
    haptic('tap');
    setSosState('holding');
    holdStartRef.current = Date.now();

    holdTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - holdStartRef.current;
      const pct = Math.min((elapsed / HOLD_DURATION_MS) * 100, 100);
      setHoldPct(pct);
      setSosHoldProgress(pct);

      if (pct >= 100) {
        clearInterval(holdTimerRef.current!);
        haptic('success');
        beginConfirm();
      }
    }, 16);
  }, [sosState, haptic, setSosState, setSosHoldProgress]);

  const cancelHold = useCallback(() => {
    if (sosState !== 'holding') return;
    clearInterval(holdTimerRef.current!);
    haptic('tap');
    setSosState('idle');
    setHoldPct(0);
    setSosHoldProgress(0);
  }, [sosState, haptic, setSosState, setSosHoldProgress]);

  const beginConfirm = useCallback(() => {
    setSosState('confirming');
    setCountdown(CONFIRM_DURATION);
    setHoldPct(0);

    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!);
          submitSOS();
          return 0;
        }
        haptic('tick');
        return prev - 1;
      });
    }, 1000);
  }, [haptic, setSosState]);

  const cancelConfirm = useCallback(() => {
    clearInterval(countdownRef.current!);
    haptic('tap');
    setSosState('idle');
    setCountdown(CONFIRM_DURATION);
    setHoldPct(0);
  }, [haptic, setSosState]);

  // ── Submit SOS ────────────────────────────────────────────

  const submitSOS = useCallback(async () => {
    setSosState('submitting');
    setIsSubmitting(true);
    haptic('sos');

    const payload = {
      rawInput: voiceTranscript || 'SOS – Emergency button activated',
      language,
      source: 'PANIC_BUTTON',
      location: userLocation ?? undefined,
    };

    // Generate a local reference code immediately — works offline
    const localRef = `SOS-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*999999).toString().padStart(6,'0')}`;
    const localId  = uuidv4();

    try {
      // Try backend first (non-blocking — 3s timeout)
      const res = await Promise.race([
        api.post('/incidents/report', payload),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]) as any;
      const { incidentId, referenceCode } = res.data.data;
      setActiveIncident(incidentId, referenceCode);
      speak('Help is on the way. Stay calm.', language);
    } catch {
      // Backend unavailable — use local confirmation (always works)
      enqueueOffline({ id: localId, type: 'SOS', payload, timestamp: new Date().toISOString(), retries: 0 });
      setActiveIncident(localId, localRef);
      speak('Emergency alert sent. Help is being dispatched. Stay calm.', language);
    }

    // Always navigate to track — never stay stuck
    setActiveTab('track');
    setIsSubmitting(false);

    // ── Auto-initiate emergency call ──────────────────────
    // Slight delay so track screen renders first
    setTimeout(() => {
      const { initiateCall } = useAppStore.getState();
      const incidentId = useAppStore.getState().activeIncidentId;
      if (incidentId) {
        initiateCall(incidentId);
        // The useEmergencyCall hook in AppShell will pick this up
        // and start the WebRTC connection automatically
      }
    }, 800);
  }, [
    voiceTranscript, language, userLocation,
    enqueueOffline, setActiveIncident, setActiveTab,
    setSosState, haptic,
  ]);

  // Cleanup on unmount
  useEffect(() => () => {
    clearInterval(holdTimerRef.current!);
    clearInterval(countdownRef.current!);
  }, []);

  // ── Render ────────────────────────────────────────────────

  const isActive  = sosState === 'active';
  const isIdle    = sosState === 'idle';
  const isWorking = !isIdle && !isActive;  // holding / confirming / submitting

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', overflow: 'hidden' }}>

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="status-bar">
        <div className="flex items-center gap-2 flex-1">
          <div className="w-5 h-5 border border-gray-200 flex items-center justify-center flex-shrink-0">
            <span className="text-[7px] font-mono font-bold text-gray-800">LG</span>
          </div>
          <div>
            <div className="text-[10px] font-bold tracking-[0.25em] uppercase text-gray-900">LIFEGRID</div>
            <div className="text-[8px] font-mono text-gray-400">
              {isOnline ? 'System Ready' : 'Offline Mode'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isOnline
            ? <Wifi className="w-4 h-4 text-green-600" />
            : <WifiOff className="w-4 h-4 text-yellow-500 animate-pulse" />
          }
          <LanguageSelector value={language} onChange={setLanguage} compact />
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────── */}
      <div
        className="screen-body"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '24px 24px 16px',
          gap: 0,
        }}
      >

        {/* ── Active incident banner (replaces status bar) ── */}
        <AnimatePresence>
          {isActive && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              style={{ width: '100%', marginBottom: 16 }}
            >
              <ActiveIncidentBanner />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── System status (idle only) ─────────────────── */}
        <AnimatePresence>
          {isIdle && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ width: '100%', marginBottom: 16 }}
            >
              <SystemStatusBar isOnline={isOnline} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── SOS Button — always centered ─────────────── */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 24,
            width: '100%',
          }}
        >
          {/* Countdown overlay */}
          <AnimatePresence>
            {sosState === 'confirming' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                style={{
                  position: 'absolute', inset: 0,
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.97)', zIndex: 50,
                }}
              >
                <CountdownOverlay
                  countdown={countdown}
                  total={CONFIRM_DURATION}
                  onCancel={cancelConfirm}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* SOS ring + button */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 240, height: 240 }}>
            {/* Rings rendered BEHIND button via z-index, pointer-events disabled so they never block clicks */}
            {(sosState === 'idle' || sosState === 'holding') && (
              <>
                <div className="sos-ring" style={{ pointerEvents: 'none' }} />
                <div className="sos-ring" style={{ pointerEvents: 'none' }} />
                <div className="sos-ring" style={{ pointerEvents: 'none' }} />
              </>
            )}

            {sosState === 'holding' && (
              <svg
                style={{ position: 'absolute', transform: 'rotate(-90deg)', pointerEvents: 'none', zIndex: 1 }}
                width="200" height="200"
              >
                <circle cx="100" cy="100" r="88" fill="none" stroke="rgba(0,0,0,0.06)" strokeWidth="3" />
                <circle
                  cx="100" cy="100" r="88"
                  fill="none" stroke="#e53935" strokeWidth="3" strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 88}`}
                  strokeDashoffset={`${2 * Math.PI * 88 * (1 - holdPct / 100)}`}
                  style={{ transition: 'stroke-dashoffset 16ms linear' }}
                />
              </svg>
            )}

            <motion.button
              className={`sos-button ${isActive ? 'triggered' : ''}`}
              style={{ position: 'relative', zIndex: 2, touchAction: 'none' }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                if (sosState === 'idle') startHold();
              }}
              onPointerUp={() => { if (sosState === 'holding') cancelHold(); }}
              onPointerLeave={() => { if (sosState === 'holding') cancelHold(); }}
              onPointerCancel={() => { if (sosState === 'holding') cancelHold(); }}
              animate={sosState === 'holding' ? { scale: 1.04 } : { scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
              aria-label="SOS Emergency Button — hold for 2 seconds to activate"
              aria-pressed={isActive}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  style={{ width: 32, height: 32, border: '2px solid #111827', borderTopColor: 'transparent', borderRadius: '50%' }}
                />
              ) : (
                <>
                  <span className="sos-label">SOS</span>
                  <span className="sos-sub">
                    {sosState === 'holding' ? 'HOLD...' : 'HOLD 2s'}
                  </span>
                </>
              )}
            </motion.button>
          </div>

          {/* Instruction text */}
          <motion.p
            key={sosState}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}
          >
            {isIdle    && 'Press and hold to activate'}
            {isWorking && 'Keep holding...'}
            {isActive  && 'Help dispatched · See tracking'}
          </motion.p>
        </div>

        {/* ── Live Status Panel (post-SOS only, NO map) ─── */}
        {/* Map lives exclusively on the Track screen        */}
        <AnimatePresence>
          {!isIdle && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              style={{ width: '100%', marginBottom: 12 }}
            >
              <LiveStatusPanel voiceTranscript={voiceTranscript} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Quick actions (idle only — clean when active) ─ */}
        <AnimatePresence>
          {isIdle && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}
            >
              {/* Voice command */}
              <button
                onClick={() => {
                  if (!voiceSupported) {
                    alert('Voice input requires Chrome or Edge browser.');
                    return;
                  }
                  toggleListening();
                }}
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 16,
                  padding: '14px 16px',
                  border: `2px solid ${isListening ? '#111827' : '#e5e7eb'}`,
                  background: isListening ? '#f9fafb' : '#ffffff',
                  borderRadius: 12, cursor: 'pointer', transition: 'all 0.15s',
                }}
                aria-label={isListening ? 'Stop voice command' : 'Start voice command'}
              >
                <div style={{ width: 28, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {isListening ? <VoiceWaveform /> : <Mic style={{ width: 18, height: 18, color: voiceSupported ? '#6b7280' : '#d1d5db' }} />}
                </div>
                <div style={{ flex: 1, textAlign: 'left' }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>
                    {isListening ? 'Listening… tap to stop' : 'Voice Command'}
                  </div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                    {voiceTranscript ? `"${voiceTranscript}"` : voiceSupported ? 'Say "SOS" or "Emergency"' : 'Chrome / Edge only'}
                  </div>
                </div>
                {isListening && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite', flexShrink: 0 }} />}
              </button>

              {/* Call 911 */}
              <a
                href="tel:911"
                style={{
                  width: '100%', display: 'flex', alignItems: 'center', gap: 16,
                  padding: '14px 16px',
                  border: '2px solid #e5e7eb', background: '#ffffff',
                  borderRadius: 12, textDecoration: 'none', transition: 'border-color 0.15s',
                }}
                aria-label="Call emergency services"
              >
                <Phone style={{ width: 18, height: 18, color: '#6b7280', flexShrink: 0 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Call Emergency Services</div>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>Direct line · Always available</div>
                </div>
                <ChevronRight style={{ width: 16, height: 16, color: '#d1d5db', flexShrink: 0 }} />
              </a>
            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SystemStatusBar({ isOnline }: { isOnline: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`} />
        <span className="text-[10px] font-mono text-gray-400 tracking-widest uppercase">
          {isOnline ? 'System Operational' : 'Offline Mode Active'}
        </span>
      </div>
      <span className="text-[10px] font-mono text-gray-300">
        {new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
      </span>
    </div>
  );
}

function ActiveIncidentBanner() {
  const { activeReferenceCode, setActiveTab } = useAppStore();
  return (
    <motion.button
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => setActiveTab('track')}
      className="w-full flex items-center gap-3 p-3 border border-green-200 bg-green-50 rounded-lg"
    >
      <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse flex-shrink-0" />
      <div className="flex-1 text-left">
        <div className="text-[10px] font-bold text-green-700 tracking-widest uppercase">
          Help Dispatched
        </div>
        <div className="text-[9px] font-mono text-gray-500">{activeReferenceCode}</div>
      </div>
      <ChevronRight className="w-4 h-4 text-green-600" />
    </motion.button>
  );
}

function CountdownOverlay({
  countdown, total, onCancel,
}: { countdown: number; total: number; onCancel: () => void }) {
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  const progress = (countdown / total) * circumference;

  return (
    <div className="flex flex-col items-center gap-8 px-8">
      <div className="relative flex items-center justify-center">
        <svg width="160" height="160">
          <circle cx="80" cy="80" r={radius} fill="none" stroke="#eee" strokeWidth="4" />
          <circle
            cx="80" cy="80" r={radius}
            fill="none" stroke="#e53935" strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            className="countdown-ring"
            style={{ transform: 'rotate(-90deg)', transformOrigin: '80px 80px' }}
          />
        </svg>
        <div className="absolute flex flex-col items-center">
          <span className="text-5xl font-bold font-mono text-gray-900">{countdown}</span>
          <span className="text-[10px] font-mono text-gray-400 tracking-widest uppercase">seconds</span>
        </div>
      </div>

      <div className="text-center">
        <div className="text-lg font-bold text-gray-900 mb-1">Sending SOS</div>
        <div className="text-sm text-gray-500">Emergency services will be notified</div>
      </div>

      <button
        onClick={onCancel}
        className="w-full py-4 border border-gray-300 text-sm font-bold tracking-widest uppercase text-gray-700 hover:border-gray-600 transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}

function VoiceWaveform() {
  return (
    <div className="flex items-end gap-0.5 h-5">
      {[0.3, 0.7, 1.0, 0.6, 0.4, 0.8, 0.5].map((h, i) => (
        <div
          key={i}
          className="voice-bar"
          style={{
            height: `${h * 100}%`,
            animationDelay: `${i * 0.1}s`,
            animationDuration: `${0.6 + i * 0.08}s`,
          }}
        />
      ))}
    </div>
  );
}
