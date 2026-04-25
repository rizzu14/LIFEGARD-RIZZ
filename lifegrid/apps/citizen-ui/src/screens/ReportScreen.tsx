import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MapPin, Mic, MicOff, ChevronRight, ChevronLeft,
  AlertTriangle, Loader, Check, CheckCircle2,
} from 'lucide-react';
import { useAppStore } from '../store/appStore';
import { useVoice } from '../hooks/useVoice';
import { useHaptic } from '../hooks/useHaptic';
import { useGeolocation } from '../hooks/useGeolocation';
import { useOffline } from '../hooks/useOffline';
import { api } from '../lib/api';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { v4 as uuidv4 } from 'uuid';

// ── Incident types ────────────────────────────────────────────

const INCIDENT_TYPES = [
  { id: 'MEDICAL',          label: 'Medical',  icon: '🚑', accent: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
  { id: 'FIRE',             label: 'Fire',     icon: '🔥', accent: '#ea580c', bg: '#fff7ed', border: '#fdba74' },
  { id: 'SECURITY',         label: 'Security', icon: '🚨', accent: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
  { id: 'NATURAL_DISASTER', label: 'Disaster', icon: '🌊', accent: '#0284c7', bg: '#f0f9ff', border: '#7dd3fc' },
  { id: 'CHEMICAL',         label: 'Chemical', icon: '☣️', accent: '#ca8a04', bg: '#fefce8', border: '#fde047' },
  { id: 'INFRASTRUCTURE',   label: 'Utility',  icon: '⚡', accent: '#d97706', bg: '#fffbeb', border: '#fcd34d' },
  { id: 'MISSING_PERSON',   label: 'Missing',  icon: '👤', accent: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
  { id: 'UNKNOWN',          label: 'Other',    icon: '⚠️', accent: '#6b7280', bg: '#f9fafb', border: '#d1d5db' },
];

type Step = 0 | 1 | 2 | 3;

interface ReportDraft {
  type: string | null;
  description: string;
  location: { lat: number; lng: number } | null;
  manualAddress: string;
  mediaUrls: string[];
}

// ── Main component ────────────────────────────────────────────

export default function ReportScreen() {
  const { language, setActiveIncident, setActiveTab, enqueueOffline } = useAppStore();
  const { haptic } = useHaptic();
  const { location: gpsLocation } = useGeolocation();
  const { isOnline } = useOffline();

  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<ReportDraft>({
    type: null, description: '', location: null, manualAddress: '', mediaUrls: [],
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string; code: string } | null>(null);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  const { isListening, isSupported: voiceSupported, toggleListening } = useVoice({
    onResult: ({ transcript, isFinal }) => {
      setVoiceTranscript(transcript);
      if (isFinal) {
        setDraft(d => ({ ...d, description: d.description + (d.description ? ' ' : '') + transcript }));
        setVoiceTranscript('');
      }
    },
  });

  const canAdvance = useCallback((): boolean => {
    if (step === 0) return !!draft.type;
    if (step === 1) return draft.description.trim().length >= 5;
    if (step === 2) return true; // Always allow — GPS is optional, manual address is optional
    return true;
  }, [step, draft, gpsLocation]);

  const advance = () => {
    if (!canAdvance()) return;
    haptic('tap');
    setStep(s => Math.min(s + 1, 3) as Step);
  };

  const back = () => {
    haptic('tap');
    setStep(s => Math.max(s - 1, 0) as Step);
  };

  const submit = async () => {
    setIsSubmitting(true);
    haptic('success');
    const payload = {
      rawInput: draft.description || `${draft.type} emergency reported`,
      language,
      source: 'MOBILE_APP',
      location: draft.location ?? gpsLocation ?? undefined,
    };
    try {
      if (!isOnline) {
        enqueueOffline({ id: uuidv4(), type: 'REPORT', payload, timestamp: new Date().toISOString(), retries: 0 });
        setSubmitted({ id: `offline-${Date.now()}`, code: 'QUEUED' });
      } else {
        const res = await api.post('/incidents/report', payload);
        const { incidentId, referenceCode } = res.data.data;
        setActiveIncident(incidentId, referenceCode);
        setSubmitted({ id: incidentId, code: referenceCode });
      }
    } catch {
      haptic('error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Submitted state ───────────────────────────────────────

  if (submitted) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', overflow: 'hidden' }}>
        <ScreenHeader title="Report Submitted" />
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24, textAlign: 'center' }}>
          <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
            <CheckCircle2 style={{ width: 80, height: 80, color: '#22c55e' }} />
          </motion.div>

          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>
              {submitted.code === 'QUEUED' ? 'Queued for Submission' : 'Report Received'}
            </div>
            <div style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6 }}>
              {submitted.code === 'QUEUED'
                ? 'Your report will be submitted when connection is restored.'
                : 'Emergency services have been notified. Help is on the way.'}
            </div>
          </div>

          {submitted.code !== 'QUEUED' && (
            <div style={{ width: '100%', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, background: '#f9fafb' }}>
              <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#9ca3af', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 8 }}>Reference Code</div>
              <div style={{ fontSize: 24, fontFamily: 'monospace', fontWeight: 700, color: '#111827', letterSpacing: '0.15em' }}>{submitted.code}</div>
            </div>
          )}

          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
            <button
              onClick={() => setActiveTab('track')}
              style={{ width: '100%', padding: '16px', background: '#111827', color: '#fff', fontWeight: 700, fontSize: 14, borderRadius: 12, border: 'none', cursor: 'pointer' }}
            >
              Track Response
            </button>
            <button
              onClick={() => { setSubmitted(null); setStep(0); setDraft({ type: null, description: '', location: null, manualAddress: '', mediaUrls: [] }); }}
              style={{ width: '100%', padding: '16px', background: '#fff', color: '#374151', fontWeight: 500, fontSize: 14, borderRadius: 12, border: '1px solid #e5e7eb', cursor: 'pointer' }}
            >
              New Report
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', overflow: 'hidden' }}>

      {/* Header */}
      <ScreenHeader
        title="Report Incident"
        onBack={step > 0 ? back : undefined}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {[0, 1, 2, 3].map(i => (
              <div
                key={i}
                style={{
                  width: i === step ? 20 : 6,
                  height: 6,
                  borderRadius: 3,
                  background: i === step ? '#111827' : i < step ? '#6b7280' : '#d1d5db',
                  transition: 'all 0.3s',
                }}
              />
            ))}
          </div>
        }
      />

      {/* Progress bar */}
      <div style={{ height: 3, background: '#f3f4f6', flexShrink: 0 }}>
        <motion.div
          style={{ height: '100%', background: '#111827' }}
          animate={{ width: `${((step + 1) / 4) * 100}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Scrollable step content */}
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.18 }}
          >
            {step === 0 && <StepType draft={draft} setDraft={setDraft} />}
            {step === 1 && (
              <StepDescribe
                draft={draft} setDraft={setDraft}
                voiceTranscript={voiceTranscript}
                isListening={isListening}
                voiceSupported={voiceSupported}
                toggleListening={toggleListening}
              />
            )}
            {step === 2 && <StepLocation draft={draft} setDraft={setDraft} gpsLocation={gpsLocation} />}
            {step === 3 && <StepConfirm draft={draft} gpsLocation={gpsLocation} isOnline={isOnline} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation — always visible at bottom */}
      <div style={{ padding: '12px 20px', borderTop: '1px solid #f3f4f6', background: '#fff', display: 'flex', gap: 12, flexShrink: 0 }}>
        {step > 0 && (
          <button
            onClick={back}
            style={{ width: 52, height: 52, border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
            aria-label="Go back"
          >
            <ChevronLeft style={{ width: 20, height: 20, color: '#4b5563' }} />
          </button>
        )}

        {step < 3 ? (
          <button
            onClick={advance}
            disabled={!canAdvance()}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 12,
              border: 'none',
              background: canAdvance() ? '#111827' : '#e5e7eb',
              color: canAdvance() ? '#ffffff' : '#9ca3af',
              fontWeight: 700,
              fontSize: 14,
              cursor: canAdvance() ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            Continue
            <ChevronRight style={{ width: 16, height: 16 }} />
          </button>
        ) : (
          <button
            onClick={submit}
            disabled={isSubmitting}
            style={{
              flex: 1,
              height: 52,
              borderRadius: 12,
              border: 'none',
              background: isSubmitting ? '#fca5a5' : '#dc2626',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: 14,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            {isSubmitting ? (
              <>
                <Loader style={{ width: 16, height: 16, animation: 'spin 1s linear infinite' }} />
                Submitting...
              </>
            ) : (
              <>
                <AlertTriangle style={{ width: 16, height: 16 }} />
                Submit Emergency
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Step 1: Type selection ────────────────────────────────────

function StepType({
  draft, setDraft,
}: { draft: ReportDraft; setDraft: React.Dispatch<React.SetStateAction<ReportDraft>> }) {
  return (
    <div style={{ padding: '24px 20px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 4 }}>What's happening?</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>Select the type of emergency</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {INCIDENT_TYPES.map(type => {
          const isSelected = draft.type === type.id;
          return (
            <button
              key={type.id}
              onClick={() => setDraft(d => ({ ...d, type: type.id }))}
              style={{
                position: 'relative',
                padding: '20px 12px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 10,
                borderRadius: 16,
                border: `2px solid ${isSelected ? type.accent : '#e5e7eb'}`,
                background: isSelected ? type.bg : '#ffffff',
                cursor: 'pointer',
                transition: 'all 0.15s',
                boxShadow: isSelected ? `0 0 0 3px ${type.accent}20` : 'none',
              }}
            >
              {isSelected && (
                <div style={{
                  position: 'absolute', top: 8, right: 8,
                  width: 20, height: 20, borderRadius: '50%',
                  background: type.accent,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Check style={{ width: 12, height: 12, color: '#fff' }} strokeWidth={3} />
                </div>
              )}
              <span style={{ fontSize: 32 }}>{type.icon}</span>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: isSelected ? type.accent : '#374151',
              }}>
                {type.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Step 2: Describe ──────────────────────────────────────────

function StepDescribe({
  draft, setDraft, voiceTranscript, isListening, voiceSupported, toggleListening,
}: {
  draft: ReportDraft;
  setDraft: React.Dispatch<React.SetStateAction<ReportDraft>>;
  voiceTranscript: string;
  isListening: boolean;
  voiceSupported: boolean;
  toggleListening: () => void;
}) {
  return (
    <div style={{ padding: '24px 20px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Describe the emergency</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>Include number of people, any hazards, and your exact location</p>

      {/* Mic button — always shown, graceful fallback */}
      <button
        onClick={() => {
          if (!voiceSupported) {
            alert('Voice input requires Chrome or Edge browser.');
            return;
          }
          toggleListening();
        }}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', borderRadius: 12, marginBottom: 16,
          border: `2px solid ${isListening ? '#dc2626' : '#e5e7eb'}`,
          background: isListening ? '#fef2f2' : '#f9fafb',
          cursor: 'pointer',
        }}
      >
        {isListening
          ? <MicOff style={{ width: 20, height: 20, color: '#dc2626', flexShrink: 0 }} />
          : <Mic style={{ width: 20, height: 20, color: voiceSupported ? '#9ca3af' : '#d1d5db', flexShrink: 0 }} />
        }
        <span style={{ fontSize: 14, fontWeight: 500, color: isListening ? '#dc2626' : '#374151' }}>
          {isListening ? 'Tap to stop recording' : voiceSupported ? 'Tap to speak' : 'Voice (Chrome/Edge only)'}
        </span>
        {isListening && <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: '#dc2626', animation: 'pulse 1s infinite' }} />}
      </button>

      {voiceTranscript && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 10, border: '1px solid #bfdbfe', background: '#eff6ff' }}>
          <p style={{ fontSize: 13, color: '#1d4ed8', fontStyle: 'italic' }}>"{voiceTranscript}"</p>
        </div>
      )}

      <div style={{ position: 'relative' }}>
        <textarea
          value={draft.description}
          onChange={e => setDraft(d => ({ ...d, description: e.target.value.slice(0, 2000) }))}
          placeholder="Describe what you see, hear, or feel. Include number of people affected, any hazards, and your exact location if known..."
          rows={7}
          style={{
            width: '100%', background: '#f9fafb', border: '2px solid #e5e7eb',
            borderRadius: 12, padding: '14px 16px', fontSize: 14, color: '#111827',
            resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
          }}
        />
        <div style={{ position: 'absolute', bottom: 10, right: 12, fontSize: 10, fontFamily: 'monospace', color: '#9ca3af' }}>
          {draft.description.length}/2000
        </div>
      </div>
    </div>
  );
}

// ── Step 3: Location ──────────────────────────────────────────

function StepLocation({
  draft, setDraft, gpsLocation,
}: {
  draft: ReportDraft;
  setDraft: React.Dispatch<React.SetStateAction<ReportDraft>>;
  gpsLocation: { lat: number; lng: number; accuracy: number } | null;
}) {
  const hasGPS = !!gpsLocation;
  const hasManualLocation = draft.location !== null;
  const locationAcquired = hasGPS || hasManualLocation;

  const requestGPS = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDraft(d => ({
          ...d,
          location: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        }));
      },
      () => { /* user denied — that's fine, they can type address */ },
      { enableHighAccuracy: false, timeout: 8000 },
    );
  };

  return (
    <div style={{ padding: '24px 20px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Your location</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>Help responders find you faster</p>

      {/* GPS status card */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '16px',
        borderRadius: 14, marginBottom: 16,
        border: `2px solid ${locationAcquired ? '#86efac' : '#e5e7eb'}`,
        background: locationAcquired ? '#f0fdf4' : '#f9fafb',
      }}>
        <div style={{
          width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
          background: locationAcquired ? '#dcfce7' : '#f3f4f6',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <MapPin style={{ width: 22, height: 22, color: locationAcquired ? '#16a34a' : '#9ca3af' }} />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: locationAcquired ? '#15803d' : '#374151' }}>
            {locationAcquired ? 'Location Acquired ✓' : 'Location not yet available'}
          </div>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#6b7280', marginTop: 2 }}>
            {hasGPS
              ? `${gpsLocation.lat.toFixed(5)}, ${gpsLocation.lng.toFixed(5)} ±${Math.round(gpsLocation.accuracy)}m`
              : hasManualLocation
              ? `${draft.location!.lat.toFixed(5)}, ${draft.location!.lng.toFixed(5)}`
              : 'Tap the button below to share your location'}
          </div>
        </div>
        {locationAcquired && <Check style={{ width: 20, height: 20, color: '#22c55e', flexShrink: 0 }} />}
      </div>

      {/* Allow location button — only shown when not yet acquired */}
      {!locationAcquired && (
        <button
          onClick={requestGPS}
          style={{
            width: '100%', padding: '14px 16px', marginBottom: 20,
            borderRadius: 12, border: '2px solid #3b82f6',
            background: '#eff6ff', color: '#1d4ed8',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          <MapPin style={{ width: 16, height: 16 }} />
          Allow Location Access
        </button>
      )}

      {/* Manual address */}
      <label style={{ fontSize: 11, fontWeight: 600, color: '#6b7280', letterSpacing: '0.1em', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
        Or type your address
      </label>
      <input
        type="text"
        value={draft.manualAddress}
        onChange={e => setDraft(d => ({ ...d, manualAddress: e.target.value }))}
        placeholder="Street address, landmark, building name..."
        style={{
          width: '100%', background: '#f9fafb', border: '2px solid #e5e7eb',
          borderRadius: 12, padding: '12px 16px', fontSize: 14, color: '#111827',
          outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box',
        }}
      />

      {/* Skip note */}
      <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 12, textAlign: 'center' }}>
        Location is optional — you can continue without it
      </p>
    </div>
  );
}

// ── Step 4: Confirm ───────────────────────────────────────────

function StepConfirm({
  draft, gpsLocation, isOnline,
}: {
  draft: ReportDraft;
  gpsLocation: { lat: number; lng: number; accuracy: number } | null;
  isOnline: boolean;
}) {
  const type = INCIDENT_TYPES.find(t => t.id === draft.type);

  return (
    <div style={{ padding: '24px 20px' }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Confirm Report</h2>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>Review before submitting to emergency services</p>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 14, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: type?.bg ?? '#f9fafb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0 }}>
            {type?.icon ?? '⚠️'}
          </div>
          <div>
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.15em' }}>Type</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{type?.label ?? 'Unknown'}</div>
          </div>
        </div>

        <div style={{ padding: '14px 16px', borderBottom: '1px solid #f3f4f6' }}>
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>Description</div>
          <div style={{ fontSize: 14, color: draft.description ? '#374151' : '#9ca3af', fontStyle: draft.description ? 'normal' : 'italic', lineHeight: 1.5 }}>
            {draft.description || 'No description provided'}
          </div>
        </div>

        <div style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: 6 }}>Location</div>
          <div style={{ fontSize: 13, fontFamily: 'monospace', color: '#374151' }}>
            {gpsLocation
              ? `${gpsLocation.lat.toFixed(5)}, ${gpsLocation.lng.toFixed(5)}`
              : draft.manualAddress || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not provided</span>
            }
          </div>
        </div>
      </div>

      {!isOnline && (
        <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 12, border: '1px solid #fde68a', background: '#fffbeb', marginBottom: 16 }}>
          <AlertTriangle style={{ width: 16, height: 16, color: '#d97706', flexShrink: 0, marginTop: 2 }} />
          <p style={{ fontSize: 13, color: '#92400e', lineHeight: 1.5 }}>
            You're offline. Your report will be queued and submitted automatically when connection is restored.
          </p>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, padding: '14px 16px', borderRadius: 12, border: '1px solid #fecaca', background: '#fef2f2' }}>
        <AlertTriangle style={{ width: 16, height: 16, color: '#dc2626', flexShrink: 0, marginTop: 2 }} />
        <p style={{ fontSize: 13, color: '#991b1b', lineHeight: 1.5 }}>
          False emergency reports are a criminal offense. Only submit genuine emergencies.
        </p>
      </div>
    </div>
  );
}
