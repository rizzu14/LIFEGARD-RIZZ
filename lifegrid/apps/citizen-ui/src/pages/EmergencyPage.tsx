import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { MapPin, Mic, MicOff, Send, AlertTriangle, ChevronRight, X, Loader } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useIncidentStore } from '../store/incidentStore';
import { useGeolocation } from '../hooks/useGeolocation';
import { IncidentMap } from '../components/map/IncidentMap';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { SeverityBadge } from '../components/ui/SeverityBadge';
import { api } from '../lib/api';

type Step = 'describe' | 'location' | 'confirm' | 'submitted';

const INCIDENT_TYPES = [
  { id: 'MEDICAL',   label: 'Medical',   emoji: '🚑' },
  { id: 'FIRE',      label: 'Fire',      emoji: '🔥' },
  { id: 'SECURITY',  label: 'Security',  emoji: '🚨' },
  { id: 'NATURAL_DISASTER', label: 'Disaster', emoji: '🌊' },
  { id: 'CHEMICAL',  label: 'Chemical',  emoji: '☣️' },
  { id: 'OTHER',     label: 'Other',     emoji: '⚠️' },
];

export default function EmergencyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { location, error: geoError, loading: geoLoading } = useGeolocation();
  const { setActiveIncident } = useIncidentStore();

  const [step, setStep] = useState<Step>('describe');
  const [description, setDescription] = useState('');
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedIncident, setSubmittedIncident] = useState<{ id: string; referenceCode: string } | null>(null);
  const [language, setLanguage] = useState('en');
  const [manualLocation, setManualLocation] = useState('');
  const [charCount, setCharCount] = useState(0);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Auto-focus textarea on mount
  useEffect(() => {
    if (step === 'describe') textareaRef.current?.focus();
  }, [step]);

  // Voice recording
  const toggleRecording = useCallback(async () => {
    if (isRecording) {
      mediaRecorderRef.current?.stop();
      setIsRecording(false);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: 'audio/webm' });
        // In production: send to speech-to-text API
        // For now, set placeholder
        setDescription(prev => prev + ' [Voice input recorded]');
        stream.getTracks().forEach(t => t.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      alert('Microphone access denied. Please type your emergency description.');
    }
  }, [isRecording]);

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length <= 2000) {
      setDescription(val);
      setCharCount(val.length);
    }
  };

  const handleSubmit = async () => {
    if (!description.trim() || description.length < 5) return;

    setIsSubmitting(true);
    try {
      const payload = {
        rawInput: description,
        language,
        source: 'MOBILE_APP',
        location: location ? { lat: location.lat, lng: location.lng } : undefined,
      };

      const response = await api.post('/incidents/report', payload);
      const { incidentId, referenceCode } = response.data.data;

      setActiveIncident(incidentId);
      setSubmittedIncident({ id: incidentId, referenceCode });
      setStep('submitted');
    } catch (err) {
      console.error('Submission failed:', err);
      alert('Failed to submit emergency report. Please call emergency services directly.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="border-b border-[#1a1a1a] px-4 py-3 flex items-center justify-between">
        <button
          onClick={() => navigate('/')}
          className="p-2 hover:bg-[#111] transition-colors"
          aria-label="Back"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[#ff2d2d] animate-pulse-critical" />
          <span className="text-xs font-bold tracking-widest uppercase">Emergency Report</span>
        </div>
        <LanguageSelector value={language} onChange={setLanguage} />
      </header>

      {/* ── Step indicator ─────────────────────────────────── */}
      {step !== 'submitted' && (
        <div className="flex border-b border-[#111]">
          {(['describe', 'location', 'confirm'] as Step[]).map((s, i) => (
            <div
              key={s}
              className={`flex-1 py-2 text-center text-[10px] font-mono tracking-widest uppercase border-b-2 transition-colors ${
                step === s
                  ? 'border-white text-white'
                  : i < ['describe', 'location', 'confirm'].indexOf(step)
                  ? 'border-[#333] text-[#555]'
                  : 'border-transparent text-[#333]'
              }`}
            >
              {i + 1}. {s}
            </div>
          ))}
        </div>
      )}

      {/* ── Content ────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">

          {/* Step 1: Describe */}
          {step === 'describe' && (
            <motion.div
              key="describe"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-6 flex flex-col gap-6"
            >
              <div>
                <h2 className="text-lg font-bold mb-1">What's happening?</h2>
                <p className="text-xs text-[#555]">Describe the emergency in as much detail as possible</p>
              </div>

              {/* Type selector */}
              <div className="grid grid-cols-3 gap-2">
                {INCIDENT_TYPES.map(type => (
                  <button
                    key={type.id}
                    onClick={() => setSelectedType(type.id)}
                    className={`
                      p-3 border text-center transition-all
                      ${selectedType === type.id
                        ? 'border-white bg-white text-black'
                        : 'border-[#222] bg-[#0a0a0a] hover:border-[#444]'
                      }
                    `}
                  >
                    <div className="text-lg mb-1">{type.emoji}</div>
                    <div className="text-[10px] tracking-widest uppercase">{type.label}</div>
                  </button>
                ))}
              </div>

              {/* Text input */}
              <div className="relative">
                <textarea
                  ref={textareaRef}
                  value={description}
                  onChange={handleDescriptionChange}
                  placeholder="Describe what you see, hear, or feel. Include number of people affected, any hazards, and your exact location if known..."
                  className="
                    w-full h-40 bg-[#0a0a0a] border border-[#222]
                    text-white text-sm p-4 resize-none
                    placeholder:text-[#333]
                    focus:outline-none focus:border-[#555]
                    transition-colors
                  "
                  aria-label="Emergency description"
                />
                <div className="absolute bottom-3 right-3 text-[10px] text-[#333] font-mono">
                  {charCount}/2000
                </div>
              </div>

              {/* Voice input */}
              <button
                onClick={toggleRecording}
                className={`
                  flex items-center gap-3 p-4 border transition-all
                  ${isRecording
                    ? 'border-[#ff2d2d] bg-[#ff2d2d]/10 text-[#ff2d2d]'
                    : 'border-[#222] hover:border-[#444] text-[#888]'
                  }
                `}
                aria-label={isRecording ? 'Stop recording' : 'Start voice recording'}
              >
                {isRecording ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                <span className="text-xs tracking-widest uppercase">
                  {isRecording ? 'Recording... Tap to stop' : 'Voice Input'}
                </span>
                {isRecording && (
                  <span className="ml-auto w-2 h-2 rounded-full bg-[#ff2d2d] animate-pulse" />
                )}
              </button>

              <button
                onClick={() => setStep('location')}
                disabled={description.length < 5}
                className="
                  flex items-center justify-center gap-2
                  bg-white text-black py-4 font-bold text-sm tracking-widest uppercase
                  disabled:opacity-30 disabled:cursor-not-allowed
                  hover:bg-[#e0e0e0] transition-colors
                "
              >
                Continue <ChevronRight className="w-4 h-4" />
              </button>
            </motion.div>
          )}

          {/* Step 2: Location */}
          {step === 'location' && (
            <motion.div
              key="location"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="flex flex-col"
            >
              {/* Map */}
              <div className="h-64 border-b border-[#111]">
                <IncidentMap
                  center={location ?? { lat: 40.7128, lng: -74.006 }}
                  zoom={14}
                  markerPosition={location ?? undefined}
                  readonly
                />
              </div>

              <div className="p-6 flex flex-col gap-4">
                {/* GPS status */}
                <div className={`flex items-center gap-3 p-3 border ${
                  location ? 'border-[#00ff88]/30 bg-[#00ff88]/5' : 'border-[#222]'
                }`}>
                  <MapPin className={`w-4 h-4 ${location ? 'text-[#00ff88]' : 'text-[#555]'}`} />
                  <div>
                    <div className="text-xs font-bold">
                      {geoLoading ? 'Acquiring GPS...' : location ? 'Location Acquired' : 'GPS Unavailable'}
                    </div>
                    {location && (
                      <div className="text-[10px] text-[#555] font-mono">
                        {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
                      </div>
                    )}
                  </div>
                  {geoLoading && <Loader className="w-3 h-3 animate-spin ml-auto text-[#555]" />}
                </div>

                {/* Manual address */}
                <div>
                  <label className="text-[10px] text-[#555] tracking-widest uppercase block mb-2">
                    Or describe your location
                  </label>
                  <input
                    type="text"
                    value={manualLocation}
                    onChange={e => setManualLocation(e.target.value)}
                    placeholder="Street address, landmark, or description..."
                    className="
                      w-full bg-[#0a0a0a] border border-[#222] text-white text-sm p-3
                      placeholder:text-[#333] focus:outline-none focus:border-[#555]
                    "
                  />
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep('describe')}
                    className="flex-1 py-3 border border-[#222] text-xs tracking-widest uppercase hover:border-[#444] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setStep('confirm')}
                    className="flex-1 py-3 bg-white text-black text-xs font-bold tracking-widest uppercase hover:bg-[#e0e0e0] transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Confirm */}
          {step === 'confirm' && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="p-6 flex flex-col gap-6"
            >
              <div>
                <h2 className="text-lg font-bold mb-1">Confirm Report</h2>
                <p className="text-xs text-[#555]">Review before submitting to emergency services</p>
              </div>

              {/* Summary */}
              <div className="border border-[#222] divide-y divide-[#111]">
                <div className="p-4">
                  <div className="text-[10px] text-[#555] tracking-widest uppercase mb-2">Type</div>
                  <div className="text-sm">{selectedType ?? 'Not specified'}</div>
                </div>
                <div className="p-4">
                  <div className="text-[10px] text-[#555] tracking-widest uppercase mb-2">Description</div>
                  <div className="text-sm text-[#ccc] leading-relaxed">{description}</div>
                </div>
                <div className="p-4">
                  <div className="text-[10px] text-[#555] tracking-widest uppercase mb-2">Location</div>
                  <div className="text-sm font-mono">
                    {location
                      ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
                      : manualLocation || 'Not provided'
                    }
                  </div>
                </div>
              </div>

              {/* Warning */}
              <div className="flex gap-3 p-4 border border-[#ff2d2d]/30 bg-[#ff2d2d]/5">
                <AlertTriangle className="w-4 h-4 text-[#ff2d2d] flex-shrink-0 mt-0.5" />
                <p className="text-[11px] text-[#888] leading-relaxed">
                  False emergency reports are a criminal offense. Only submit if this is a genuine emergency.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setStep('location')}
                  className="flex-1 py-4 border border-[#222] text-xs tracking-widest uppercase hover:border-[#444] transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="
                    flex-1 py-4 bg-white text-black font-bold text-xs tracking-widest uppercase
                    hover:bg-[#e0e0e0] transition-colors
                    disabled:opacity-50 disabled:cursor-not-allowed
                    flex items-center justify-center gap-2
                  "
                >
                  {isSubmitting ? (
                    <><Loader className="w-4 h-4 animate-spin" /> Submitting...</>
                  ) : (
                    <><Send className="w-4 h-4" /> Submit Emergency</>
                  )}
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 4: Submitted */}
          {step === 'submitted' && submittedIncident && (
            <motion.div
              key="submitted"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="p-6 flex flex-col items-center gap-8 text-center min-h-[60vh] justify-center"
            >
              {/* Success indicator */}
              <div className="relative">
                <div className="w-24 h-24 border-2 border-white rounded-full flex items-center justify-center">
                  <span className="text-3xl">✓</span>
                </div>
                <span className="absolute inset-0 rounded-full border border-white opacity-20 animate-ping" />
              </div>

              <div>
                <h2 className="text-2xl font-bold mb-2">Help is on the way</h2>
                <p className="text-[#888] text-sm">Emergency services have been notified</p>
              </div>

              {/* Reference code */}
              <div className="w-full border border-[#222] p-6 bg-[#0a0a0a]">
                <div className="text-[10px] text-[#555] tracking-widest uppercase mb-3">Reference Code</div>
                <div className="text-2xl font-mono font-bold tracking-widest">
                  {submittedIncident.referenceCode}
                </div>
                <div className="text-[10px] text-[#555] mt-2">Save this code to track your incident</div>
              </div>

              {/* Instructions */}
              <div className="w-full space-y-3 text-left">
                {[
                  'Stay calm and remain at your location if safe',
                  'Keep your phone accessible for responder contact',
                  'Follow any instructions from emergency services',
                  'Do not end this session until help arrives',
                ].map((instruction, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <span className="text-[10px] font-mono text-[#555] mt-0.5">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-sm text-[#888]">{instruction}</span>
                  </div>
                ))}
              </div>

              <button
                onClick={() => navigate(`/track/${submittedIncident.id}`)}
                className="w-full py-4 bg-white text-black font-bold text-xs tracking-widest uppercase hover:bg-[#e0e0e0] transition-colors"
              >
                Track Response
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </div>
  );
}
