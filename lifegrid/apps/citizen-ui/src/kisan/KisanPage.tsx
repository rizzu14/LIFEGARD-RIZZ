// ============================================================
// KISAN-KAVACH — Farmer Guardian Page
// Route: /kisan
// Theme: Amber / Green / Earth tones
// ============================================================

import React, { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import {
  Leaf, Shield, MapPin, Mic, Volume2, Radio,
  CloudRain, Sun, Thermometer, Wind, ArrowLeft,
  CheckCircle, AlertTriangle, Wifi, WifiOff,
} from 'lucide-react';
import {
  calculateAgriRisk, MOCK_FARMER, SEVERITY_COLORS,
  cacheStatus, getCachedStatus,
  WeatherCondition, CropStage, FarmerProfile, AgriRiskResult,
} from './kisanEngine';

// Lazy-load map to avoid loading Leaflet on app open
const CropMap = lazy(() => import('./CropMap'));

// ── Weather options ───────────────────────────────────────────

const WEATHER_OPTIONS: WeatherCondition[] = [
  'Clear', 'Cloudy', 'Light Rain', 'Heavy Rain', 'Heatwave', 'Storm', 'Frost', 'Drought',
];

const STAGE_OPTIONS: CropStage[] = ['Sowing', 'Growing', 'Harvesting'];

const WEATHER_ICONS: Record<WeatherCondition, string> = {
  'Clear': '☀️', 'Cloudy': '☁️', 'Light Rain': '🌦️', 'Heavy Rain': '🌧️',
  'Heatwave': '🌡️', 'Storm': '⛈️', 'Frost': '❄️', 'Drought': '🏜️',
};

// ── TTS helper ────────────────────────────────────────────────

function announce(text: string, lang = 'en-IN') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = lang; u.rate = 0.88; u.volume = 1;
  window.speechSynthesis.speak(u);
}

// ── Critical flash animation ──────────────────────────────────

function CriticalAlert({ risk }: { risk: AgriRiskResult }) {
  const [flash, setFlash] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setFlash(f => !f), 600);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: flash ? '#fef2f2' : '#fff',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        padding: 32, textAlign: 'center',
        transition: 'background 0.3s',
      }}
    >
      <motion.div
        animate={{ scale: flash ? 1.15 : 1 }}
        transition={{ duration: 0.3 }}
        style={{ fontSize: 96, marginBottom: 24 }}
      >
        {risk.icon}
      </motion.div>
      <div style={{ fontSize: 28, fontWeight: 900, color: '#dc2626', marginBottom: 12, lineHeight: 1.2 }}>
        {risk.title}
      </div>
      <div style={{ fontSize: 18, color: '#374151', lineHeight: 1.6, marginBottom: 32 }}>
        {risk.action}
      </div>
      <div style={{ fontSize: 16, color: '#6b7280', marginBottom: 8 }}>{risk.actionHi}</div>
      <div style={{ fontSize: 16, color: '#6b7280', marginBottom: 40 }}>{risk.actionTe}</div>
      <button
        onClick={() => window.speechSynthesis?.cancel()}
        style={{
          padding: '16px 40px', background: '#dc2626', color: '#fff',
          borderRadius: 99, border: 'none', fontSize: 16, fontWeight: 700,
          cursor: 'pointer', boxShadow: '0 4px 20px rgba(220,38,38,0.4)',
        }}
      >
        I Understand — Dismiss
      </button>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────

export default function KisanPage() {
  const navigate = useNavigate();

  // Auth state
  const [step, setStep]           = useState<'login' | 'otp' | 'dashboard'>('login');
  const [aadhaar, setAadhaar]     = useState('');
  const [otp, setOtp]             = useState('');
  const [otpSent, setOtpSent]     = useState(false);
  const [farmer, setFarmer]       = useState<FarmerProfile | null>(null);

  // Dashboard state
  const [weather, setWeather]     = useState<WeatherCondition>('Heavy Rain');
  const [cropStage, setCropStage] = useState<CropStage>('Harvesting');
  const [risk, setRisk]           = useState<AgriRiskResult | null>(null);
  const [showCritical, setShowCritical] = useState(false);
  const [showMap, setShowMap]     = useState(false);
  const [broadcastSent, setBroadcastSent] = useState(false);
  const [isOnline, setIsOnline]   = useState(navigator.onLine);

  // Online/offline
  useEffect(() => {
    const on  = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Load cached status on mount
  useEffect(() => {
    const cached = getCachedStatus();
    if (cached?.farmer) {
      setFarmer(cached.farmer);
      setWeather(cached.weather ?? 'Heavy Rain');
      setCropStage(cached.cropStage ?? 'Harvesting');
    }
  }, []);

  // Recalculate risk whenever weather/stage changes
  useEffect(() => {
    if (!farmer) return;
    const r = calculateAgriRisk(weather, cropStage, farmer.cropType);
    setRisk(r);
    cacheStatus({ farmer, weather, cropStage, risk: r });

    if (r.severity === 'CRITICAL') {
      setShowCritical(true);
      setTimeout(() => announce(r.voiceAlert, 'en-IN'), 500);
      setTimeout(() => announce(r.actionHi, 'hi-IN'), 5000);
      setTimeout(() => announce(r.actionTe, 'te-IN'), 10000);
    }
  }, [weather, cropStage, farmer]);

  // ── Login flow ─────────────────────────────────────────────

  const handleSendOtp = () => {
    if (aadhaar.replace(/\s/g, '').length < 12) return;
    setOtpSent(true);
    setStep('otp');
    announce('OTP sent to your registered mobile number.', 'en-IN');
  };

  const handleVerifyOtp = () => {
    if (otp.length < 4) return;
    // Mock: any OTP works
    const f = { ...MOCK_FARMER, aadhaar: aadhaar.replace(/\s/g, '').slice(0, 4) + '-****-****' };
    setFarmer(f);
    setStep('dashboard');
    setTimeout(() => {
      announce(`Welcome ${f.name}. Your ${f.cropType} field status is being loaded.`, 'en-IN');
    }, 600);
  };

  const handleBroadcast = () => {
    setBroadcastSent(true);
    announce('Alert broadcast sent to Village Common Service Center.', 'en-IN');
    setTimeout(() => setBroadcastSent(false), 4000);
  };

  // ── Render: Login ──────────────────────────────────────────

  if (step === 'login' || step === 'otp') {
    return (
      <div style={{
        minHeight: '100vh', background: 'linear-gradient(160deg, #f0fdf4 0%, #fefce8 50%, #f0fdf4 100%)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: 24,
      }}>
        {/* Back */}
        <button onClick={() => navigate('/')} style={{ position: 'absolute', top: 20, left: 20, background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#15803d', fontWeight: 600, fontSize: 14 }}>
          <ArrowLeft style={{ width: 18, height: 18 }} /> Back
        </button>

        {/* Logo */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>🌾</div>
          <div style={{ fontSize: 26, fontWeight: 900, color: '#15803d', letterSpacing: '0.05em' }}>KISAN-KAVACH</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>किसान कवच · రైతు రక్ష</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 6 }}>AI-Powered Agricultural Guardian</div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          style={{
            width: '100%', maxWidth: 380,
            background: 'rgba(255,255,255,0.9)',
            border: '2px solid #bbf7d0',
            borderRadius: 24, padding: 28,
            boxShadow: '0 8px 40px rgba(21,128,61,0.10)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {step === 'login' ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#15803d', marginBottom: 20, textAlign: 'center' }}>
                Login with Aadhaar
              </div>

              <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', letterSpacing: '0.08em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                Aadhaar Number
              </label>
              <input
                type="tel" maxLength={14}
                value={aadhaar}
                onChange={e => setAadhaar(e.target.value.replace(/[^\d\s]/g, ''))}
                placeholder="XXXX XXXX XXXX"
                style={{
                  width: '100%', padding: '16px', fontSize: 20, fontFamily: 'monospace',
                  letterSpacing: '0.2em', textAlign: 'center',
                  border: '2px solid #d1fae5', borderRadius: 14,
                  background: '#f0fdf4', outline: 'none', boxSizing: 'border-box',
                  marginBottom: 20,
                }}
              />

              <button
                onClick={handleSendOtp}
                disabled={aadhaar.replace(/\s/g, '').length < 12}
                style={{
                  width: '100%', padding: '18px',
                  background: aadhaar.replace(/\s/g, '').length >= 12
                    ? 'linear-gradient(135deg, #16a34a, #15803d)'
                    : '#e5e7eb',
                  color: aadhaar.replace(/\s/g, '').length >= 12 ? '#fff' : '#9ca3af',
                  border: 'none', borderRadius: 14,
                  fontSize: 16, fontWeight: 700, cursor: 'pointer',
                  boxShadow: aadhaar.replace(/\s/g, '').length >= 12 ? '0 4px 16px rgba(21,128,61,0.3)' : 'none',
                }}
              >
                Send OTP →
              </button>

              <p style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 16 }}>
                Powered by AgriStack · Data is secure
              </p>
            </>
          ) : (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#15803d', marginBottom: 8, textAlign: 'center' }}>
                Enter OTP
              </div>
              <div style={{ fontSize: 12, color: '#6b7280', textAlign: 'center', marginBottom: 20 }}>
                Sent to registered mobile
              </div>

              <input
                type="tel" maxLength={6}
                value={otp}
                onChange={e => setOtp(e.target.value.replace(/\D/g, ''))}
                placeholder="• • • • • •"
                style={{
                  width: '100%', padding: '16px', fontSize: 28, fontFamily: 'monospace',
                  letterSpacing: '0.4em', textAlign: 'center',
                  border: '2px solid #d1fae5', borderRadius: 14,
                  background: '#f0fdf4', outline: 'none', boxSizing: 'border-box',
                  marginBottom: 20,
                }}
              />

              <button
                onClick={handleVerifyOtp}
                style={{
                  width: '100%', padding: '18px',
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff', border: 'none', borderRadius: 14,
                  fontSize: 16, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 4px 16px rgba(21,128,61,0.3)',
                  marginBottom: 12,
                }}
              >
                ✓ Verify & Enter
              </button>

              <button onClick={() => setStep('login')} style={{ width: '100%', padding: '12px', background: 'none', border: '1px solid #d1fae5', borderRadius: 12, color: '#6b7280', fontSize: 13, cursor: 'pointer' }}>
                ← Change Aadhaar
              </button>
            </>
          )}
        </motion.div>
      </div>
    );
  }

  // ── Render: Dashboard ──────────────────────────────────────

  if (!farmer || !risk) return null;
  const sc = SEVERITY_COLORS[risk.severity];

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(160deg, #f0fdf4 0%, #fefce8 60%, #f0fdf4 100%)', paddingBottom: 32 }}>

      {/* Critical full-screen alert */}
      <AnimatePresence>
        {showCritical && risk.severity === 'CRITICAL' && (
          <div onClick={() => setShowCritical(false)}>
            <CriticalAlert risk={risk} />
          </div>
        )}
      </AnimatePresence>

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid #d1fae5',
        padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: 12,
        position: 'sticky', top: 0, zIndex: 50,
      }}>
        <button onClick={() => navigate('/')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
          <ArrowLeft style={{ width: 20, height: 20, color: '#15803d' }} />
        </button>
        <div style={{ fontSize: 18, marginRight: 4 }}>🌾</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: '#15803d', letterSpacing: '0.05em' }}>KISAN-KAVACH</div>
          <div style={{ fontSize: 10, color: '#6b7280', fontFamily: 'monospace' }}>{farmer.village}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {isOnline
            ? <Wifi style={{ width: 14, height: 14, color: '#22c55e' }} />
            : <WifiOff style={{ width: 14, height: 14, color: '#f59e0b' }} />
          }
          <span style={{ fontSize: 10, color: isOnline ? '#15803d' : '#92400e', fontWeight: 600 }}>
            {isOnline ? 'Live' : 'Cached'}
          </span>
        </div>
      </div>

      <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Farmer profile card ─────────────────────────── */}
        <div style={{
          background: 'rgba(255,255,255,0.9)', border: '1.5px solid #d1fae5',
          borderRadius: 20, padding: '16px 20px',
          display: 'flex', alignItems: 'center', gap: 14,
          boxShadow: '0 2px 16px rgba(21,128,61,0.08)',
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%',
            background: 'linear-gradient(135deg, #16a34a, #15803d)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, flexShrink: 0,
          }}>👨‍🌾</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: '#15803d' }}>{farmer.name}</div>
            <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
              {farmer.cropType} · {farmer.acres} acres · {farmer.aadhaar}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
              <MapPin style={{ width: 11, height: 11, color: '#6b7280' }} />
              <span style={{ fontSize: 11, color: '#6b7280' }}>{farmer.village}</span>
            </div>
          </div>
        </div>

        {/* ── Risk status card ────────────────────────────── */}
        <motion.div
          key={risk.severity}
          initial={{ scale: 0.97, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          style={{
            background: sc.bg, border: `2px solid ${sc.border}`,
            borderRadius: 20, padding: '20px',
            boxShadow: `0 4px 24px ${sc.badge}20`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 40 }}>{risk.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{
                  fontSize: 10, fontWeight: 800, padding: '3px 10px',
                  borderRadius: 99, background: sc.badge, color: '#fff',
                  letterSpacing: '0.08em',
                }}>
                  {risk.severity}
                </span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, color: sc.text, lineHeight: 1.3 }}>
                {risk.title}
              </div>
            </div>
          </div>

          <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, marginBottom: 10 }}>
            {risk.action}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5, marginBottom: 6 }}>
            {risk.actionHi}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5, marginBottom: 16 }}>
            {risk.actionTe}
          </div>

          {/* Voice announce button */}
          <button
            onClick={() => {
              announce(risk.voiceAlert, 'en-IN');
              setTimeout(() => announce(risk.actionHi, 'hi-IN'), 4000);
              setTimeout(() => announce(risk.actionTe, 'te-IN'), 8000);
            }}
            style={{
              width: '100%', padding: '13px',
              background: 'rgba(255,255,255,0.8)',
              border: `1.5px solid ${sc.border}`,
              borderRadius: 12, fontSize: 13, fontWeight: 700,
              color: sc.text, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Volume2 style={{ width: 16, height: 16 }} />
            Announce Alert (EN / हिं / తె)
          </button>
        </motion.div>

        {/* ── Weather selector ────────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.9)', border: '1.5px solid #d1fae5', borderRadius: 20, padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            Current Weather
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {WEATHER_OPTIONS.map(w => (
              <button
                key={w}
                onClick={() => setWeather(w)}
                style={{
                  padding: '10px 4px',
                  borderRadius: 12,
                  border: `2px solid ${weather === w ? '#16a34a' : '#e5e7eb'}`,
                  background: weather === w ? '#f0fdf4' : '#fff',
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 4,
                }}
              >
                <span style={{ fontSize: 20 }}>{WEATHER_ICONS[w]}</span>
                <span style={{ fontSize: 9, fontWeight: 600, color: weather === w ? '#15803d' : '#6b7280', textAlign: 'center', lineHeight: 1.2 }}>{w}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Crop stage selector ─────────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.9)', border: '1.5px solid #d1fae5', borderRadius: 20, padding: '16px 20px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            Crop Stage — {farmer.cropType}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            {STAGE_OPTIONS.map((s, i) => (
              <button
                key={s}
                onClick={() => setCropStage(s)}
                style={{
                  padding: '14px 8px',
                  borderRadius: 14,
                  border: `2px solid ${cropStage === s ? '#16a34a' : '#e5e7eb'}`,
                  background: cropStage === s ? '#f0fdf4' : '#fff',
                  cursor: 'pointer',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', gap: 6,
                }}
              >
                <span style={{ fontSize: 24 }}>{['🌱', '🌿', '🌾'][i]}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: cropStage === s ? '#15803d' : '#374151' }}>{s}</span>
              </button>
            ))}
          </div>
        </div>

        {/* ── Satellite Crop-Watch map ─────────────────────── */}
        <div style={{ background: 'rgba(255,255,255,0.9)', border: '1.5px solid #d1fae5', borderRadius: 20, overflow: 'hidden' }}>
          <div
            onClick={() => setShowMap(v => !v)}
            style={{
              padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 10,
              cursor: 'pointer',
            }}
          >
            <MapPin style={{ width: 18, height: 18, color: '#16a34a' }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>Satellite Crop-Watch</div>
              <div style={{ fontSize: 11, color: '#6b7280' }}>{farmer.acres} acres · NDVI overlay · {farmer.village}</div>
            </div>
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>{showMap ? 'Hide ▲' : 'View ▼'}</span>
          </div>

          <AnimatePresence>
            {showMap && (
              <motion.div
                initial={{ height: 0 }} animate={{ height: 280 }} exit={{ height: 0 }}
                style={{ overflow: 'hidden' }}
              >
                <Suspense fallback={
                  <div style={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0fdf4' }}>
                    <div style={{ fontSize: 13, color: '#6b7280' }}>Loading map…</div>
                  </div>
                }>
                  <CropMap lat={farmer.lat} lng={farmer.lng} acres={farmer.acres} cropType={farmer.cropType} />
                </Suspense>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Broadcast to village ─────────────────────────── */}
        <button
          onClick={handleBroadcast}
          style={{
            width: '100%', padding: '18px',
            background: broadcastSent
              ? 'linear-gradient(135deg, #16a34a, #15803d)'
              : 'linear-gradient(135deg, #d97706, #b45309)',
            color: '#fff', border: 'none', borderRadius: 18,
            fontSize: 15, fontWeight: 800, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            boxShadow: broadcastSent
              ? '0 4px 20px rgba(21,128,61,0.35)'
              : '0 4px 20px rgba(180,83,9,0.35)',
            transition: 'all 0.3s',
          }}
        >
          {broadcastSent ? (
            <><CheckCircle style={{ width: 20, height: 20 }} /> Alert Sent to Village CSC!</>
          ) : (
            <><Radio style={{ width: 20, height: 20 }} /> Broadcast to Village</>
          )}
        </button>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: '#9ca3af', fontFamily: 'monospace' }}>
            KISAN-KAVACH · Powered by LIFEGRID · AgriStack
          </div>
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
            {isOnline ? '🟢 Live data' : '🟡 Showing cached data from last sync'}
          </div>
        </div>
      </div>
    </div>
  );
}
