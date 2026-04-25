// ============================================================
// LIFEGRID – Operator Call Panel
// Incoming call popup + live transcript + quick actions
//
// Shows when a citizen initiates an emergency call:
//   1. Incoming call popup (full-screen overlay)
//   2. Active call panel (right panel tab)
//   3. Live transcript with AI keyword highlights
//   4. Quick action buttons (dispatch, escalate, transfer)
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, PhoneIncoming, Mic, MicOff,
  Volume2, MapPin, AlertTriangle, Zap, Users,
  ChevronRight, Clock, Wifi, MessageSquare,
} from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { useAuthStore } from '../../store/authStore';
import { useOperatorStore } from '../../store/operatorStore';
import { format } from 'date-fns';

// ── Types ─────────────────────────────────────────────────────

interface IncomingCall {
  sessionId:     string;
  incidentId:    string;
  referenceCode: string;
  citizenId?:    string;
  location?:     { lat: number; lng: number };
  emergencyType: string;
  severity:      string;
  language:      string;
  offer:         RTCSessionDescriptionInit;
  timestamp:     string;
}

interface ActiveCall extends IncomingCall {
  connectedAt:    string;
  durationSeconds: number;
  transcript:     TranscriptEntry[];
  keywords:       KeywordEntry[];
  aiSuggestions:  string[];
  isMuted:        boolean;
}

interface TranscriptEntry {
  id:        string;
  speaker:   'citizen' | 'operator' | 'ai';
  text:      string;
  timestamp: string;
  isFinal:   boolean;
  keywords?: string[];
}

interface KeywordEntry {
  keyword:    string;
  category:   string;
  detectedAt: string;
}

// ── Severity colors ───────────────────────────────────────────

const SEV_COLORS: Record<string, string> = {
  CRITICAL: '#ff1744', HIGH: '#ff6d00', MEDIUM: '#ffd600', LOW: '#00c853',
};

// ── ICE servers ───────────────────────────────────────────────

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

// ── Incoming call popup ───────────────────────────────────────

function IncomingCallPopup({
  call,
  onAccept,
  onDecline,
}: {
  call: IncomingCall;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(p => p + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-decline after 30s if not answered
  useEffect(() => {
    if (elapsed >= 30) onDecline();
  }, [elapsed, onDecline]);

  const sevColor = SEV_COLORS[call.severity] ?? '#888';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        background: 'rgba(0,0,0,0.85)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{
        background: '#0d0d0d', border: `2px solid ${sevColor}60`,
        borderRadius: 20, padding: 28, width: 340, maxWidth: '90vw',
        boxShadow: `0 0 40px ${sevColor}20`,
      }}>
        {/* Pulsing ring */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <div style={{ position: 'relative', width: 80, height: 80 }}>
            <div style={{
              position: 'absolute', inset: -8, borderRadius: '50%',
              border: `2px solid ${sevColor}40`,
              animation: 'ping 1.5s ease-out infinite',
            }} />
            <div style={{
              width: 80, height: 80, borderRadius: '50%',
              background: `${sevColor}20`, border: `2px solid ${sevColor}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <PhoneIncoming style={{ width: 32, height: 32, color: sevColor }} />
            </div>
          </div>
        </div>

        {/* Call info */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#555', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 6 }}>
            Incoming Emergency Call
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: '#e8e8e8', marginBottom: 4 }}>
            {call.referenceCode}
          </div>
          <div style={{
            display: 'inline-block', fontSize: 10, fontWeight: 700,
            padding: '3px 10px', borderRadius: 20,
            border: `1px solid ${sevColor}40`, color: sevColor,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            {call.severity} · {call.emergencyType.replace('_', ' ')}
          </div>
        </div>

        {/* Location */}
        {call.location && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#1a1a1a', borderRadius: 10, padding: '8px 12px', marginBottom: 16,
          }}>
            <MapPin style={{ width: 14, height: 14, color: '#555', flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#888' }}>
              {call.location.lat.toFixed(4)}, {call.location.lng.toFixed(4)}
            </span>
          </div>
        )}

        {/* Auto-decline timer */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ height: 2, background: '#1a1a1a', borderRadius: 1, overflow: 'hidden' }}>
            <div style={{
              height: '100%', background: sevColor,
              width: `${((30 - elapsed) / 30) * 100}%`,
              transition: 'width 1s linear',
            }} />
          </div>
          <div style={{ fontSize: 10, color: '#555', textAlign: 'center', marginTop: 4, fontFamily: 'monospace' }}>
            Auto-decline in {30 - elapsed}s
          </div>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={onDecline}
            style={{
              flex: 1, height: 52, borderRadius: 14,
              background: '#1a1a1a', border: '1px solid #333',
              color: '#888', fontWeight: 700, fontSize: 13, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <PhoneOff style={{ width: 18, height: 18 }} />
            Decline
          </button>
          <button
            onClick={onAccept}
            style={{
              flex: 2, height: 52, borderRadius: 14,
              background: '#00c853', border: 'none',
              color: '#000', fontWeight: 800, fontSize: 14, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}
          >
            <Phone style={{ width: 18, height: 18 }} />
            Accept Call
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Active call panel ─────────────────────────────────────────

function ActiveCallPanel({
  call,
  onEnd,
  onDispatch,
  onEscalate,
}: {
  call: ActiveCall;
  onEnd: () => void;
  onDispatch: () => void;
  onEscalate: () => void;
}) {
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const sevColor = SEV_COLORS[call.severity] ?? '#888';

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [call.transcript]);

  const formatDuration = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  return (
    <div className="panel h-full" style={{ display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <div className="panel-header" style={{ background: `${sevColor}10`, borderBottom: `1px solid ${sevColor}30` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#00c853', boxShadow: '0 0 6px #00c853' }} />
          <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#888', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
            Live Call
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Clock style={{ width: 12, height: 12, color: '#555' }} />
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#888' }}>
            {formatDuration(call.durationSeconds)}
          </span>
        </div>
      </div>

      {/* Incident info */}
      <div style={{ padding: '10px 12px', borderBottom: '1px solid #1a1a1a', background: '#080808' }}>
        <div style={{ display: 'flex', items: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#555' }}>{call.referenceCode}</span>
          <span style={{
            fontSize: 8, fontWeight: 700, padding: '2px 8px',
            border: `1px solid ${sevColor}40`, color: sevColor,
            letterSpacing: '0.1em', textTransform: 'uppercase',
          }}>
            {call.severity}
          </span>
        </div>
        <div style={{ fontSize: 12, color: '#ccc', fontWeight: 600 }}>
          {call.emergencyType.replace('_', ' ')}
        </div>
        {call.location && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
            <MapPin style={{ width: 10, height: 10, color: '#555' }} />
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#555' }}>
              {call.location.lat.toFixed(4)}, {call.location.lng.toFixed(4)}
            </span>
          </div>
        )}
      </div>

      {/* AI suggestions */}
      {call.aiSuggestions.length > 0 && (
        <div style={{ padding: '8px 12px', borderBottom: '1px solid #1a1a1a', background: '#0a0a00' }}>
          <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#ffd600', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 4 }}>
            ⚡ AI Decision Support
          </div>
          <p style={{ fontSize: 11, color: '#ccc', lineHeight: 1.5 }}>
            {call.aiSuggestions[0]}
          </p>
        </div>
      )}

      {/* Detected keywords */}
      {call.keywords.length > 0 && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid #1a1a1a', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {call.keywords.slice(-4).map((kw, i) => (
            <span key={i} style={{
              fontSize: 9, fontWeight: 700, padding: '2px 8px',
              borderRadius: 20, background: '#ff174420', color: '#ff1744',
              border: '1px solid #ff174440',
            }}>
              ⚠ {kw.keyword}
            </span>
          ))}
        </div>
      )}

      {/* Live transcript */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px' }}>
        <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#333', letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8 }}>
          Live Transcript
        </div>
        {call.transcript.length === 0 ? (
          <div style={{ fontSize: 10, color: '#333', textAlign: 'center', paddingTop: 20 }}>
            Waiting for speech...
          </div>
        ) : (
          call.transcript.map((line, i) => (
            <div key={line.id} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#444', marginBottom: 2 }}>
                {line.speaker === 'citizen' ? '👤 CITIZEN' : line.speaker === 'operator' ? '🎧 OPERATOR' : '🤖 AI'}
                {' · '}{format(new Date(line.timestamp), 'HH:mm:ss')}
              </div>
              <div style={{
                fontSize: 11, color: line.isFinal ? '#ccc' : '#666',
                fontStyle: line.isFinal ? 'normal' : 'italic',
                lineHeight: 1.5,
                background: line.speaker === 'citizen' ? '#0d0d0d' : '#080808',
                padding: '6px 10px', borderRadius: 8,
                borderLeft: `2px solid ${line.speaker === 'citizen' ? '#333' : '#1a1a1a'}`,
              }}>
                {line.text}{!line.isFinal && '...'}
              </div>
            </div>
          ))
        )}
        <div ref={transcriptEndRef} />
      </div>

      {/* Quick actions */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid #1a1a1a', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={onDispatch}
            style={{
              flex: 1, padding: '8px', borderRadius: 10,
              background: '#00c85320', border: '1px solid #00c85340',
              color: '#00c853', fontSize: 10, fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >
            <Zap style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />
            Dispatch
          </button>
          <button
            onClick={onEscalate}
            style={{
              flex: 1, padding: '8px', borderRadius: 10,
              background: '#ff174420', border: '1px solid #ff174440',
              color: '#ff1744', fontSize: 10, fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase',
            }}
          >
            <AlertTriangle style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />
            Escalate
          </button>
        </div>
        <button
          onClick={onEnd}
          style={{
            width: '100%', padding: '10px', borderRadius: 10,
            background: '#1a1a1a', border: '1px solid #333',
            color: '#888', fontSize: 11, fontWeight: 700,
            cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}
        >
          <PhoneOff style={{ width: 14, height: 14 }} />
          End Call
        </button>
      </div>
    </div>
  );
}

// ── Main CallPanel component ──────────────────────────────────

export function CallPanel() {
  const { socket } = useSocket();
  const { user } = useAuthStore();
  const { addLogEntry, setRightPanelTab, incidents } = useOperatorStore();

  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeCall, setActiveCall]     = useState<ActiveCall | null>(null);

  const pcRef          = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const durationRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const recognitionRef = useRef<any>(null);

  // ── Listen for incoming calls ─────────────────────────────

  useEffect(() => {
    if (!socket) return;

    socket.on('CALL_INITIATE', (data: IncomingCall) => {
      setIncomingCall(data);
      addLogEntry({
        type: 'COMM',
        severity: data.severity,
        message: `Incoming call: ${data.referenceCode} · ${data.emergencyType}`,
        timestamp: new Date().toISOString(),
        incidentId: data.incidentId,
      });
    });

    socket.on('CALL_ICE_CANDIDATE', async (data: any) => {
      if (pcRef.current && data.candidate) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
      }
    });

    socket.on('CALL_KEYWORD_DETECTED', (data: any) => {
      setActiveCall(prev => {
        if (!prev || prev.sessionId !== data.sessionId) return prev;
        return {
          ...prev,
          keywords: [...prev.keywords, data.keyword],
          aiSuggestions: [data.keyword.actionTaken ?? '', ...prev.aiSuggestions].slice(0, 5),
        };
      });
    });

    socket.on('CALL_END', (data: any) => {
      if (activeCall?.sessionId === data.sessionId) {
        handleEndCall();
      }
    });

    return () => {
      socket.off('CALL_INITIATE');
      socket.off('CALL_ICE_CANDIDATE');
      socket.off('CALL_KEYWORD_DETECTED');
      socket.off('CALL_END');
    };
  }, [socket, activeCall, addLogEntry]);

  // ── Accept call ───────────────────────────────────────────

  const handleAccept = useCallback(async () => {
    if (!incomingCall || !socket) return;

    try {
      // Get operator microphone
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });
      localStreamRef.current = stream;

      // Create peer connection
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      pcRef.current = pc;

      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      // Handle citizen audio
      pc.ontrack = (event) => {
        if (!remoteAudioRef.current) {
          remoteAudioRef.current = new Audio();
          remoteAudioRef.current.autoplay = true;
        }
        remoteAudioRef.current.srcObject = event.streams[0];
      };

      // ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit('CALL_ICE_CANDIDATE', {
            sessionId: incomingCall.sessionId,
            incidentId: incomingCall.incidentId,
            candidate: event.candidate,
          });
        }
      };

      // Set remote offer and create answer
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Send answer to citizen
      socket.emit('CALL_ANSWER', {
        sessionId:    incomingCall.sessionId,
        incidentId:   incomingCall.incidentId,
        answer,
        operatorId:   user?.id ?? 'operator',
        operatorName: user?.name ?? 'LIFEGRID Operator',
      });

      // Create active call state
      const call: ActiveCall = {
        ...incomingCall,
        connectedAt:     new Date().toISOString(),
        durationSeconds: 0,
        transcript:      [],
        keywords:        [],
        aiSuggestions:   [`Connected to ${incomingCall.emergencyType.replace('_', ' ')} emergency. Incident ${incomingCall.referenceCode}.`],
        isMuted:         false,
      };

      setActiveCall(call);
      setIncomingCall(null);
      setRightPanelTab('comm');

      // Start duration timer
      durationRef.current = setInterval(() => {
        setActiveCall(prev => prev ? { ...prev, durationSeconds: prev.durationSeconds + 1 } : prev);
      }, 1000);

      // Start operator transcription
      startOperatorTranscription(incomingCall.sessionId);

      addLogEntry({
        type: 'COMM',
        severity: 'INFO',
        message: `Call accepted: ${incomingCall.referenceCode} · ${user?.name}`,
        timestamp: new Date().toISOString(),
        incidentId: incomingCall.incidentId,
      });

    } catch (err) {
      console.error('[Operator Call] Accept failed:', err);
      setIncomingCall(null);
    }
  }, [incomingCall, socket, user, addLogEntry, setRightPanelTab]);

  // ── Operator transcription ────────────────────────────────

  const startOperatorTranscription = useCallback((sessionId: string) => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const rec = new SpeechRecognition();
    rec.continuous     = true;
    rec.interimResults = true;
    recognitionRef.current = rec;

    let currentId = `op-${Date.now()}`;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.results.length - 1];
      const line: TranscriptEntry = {
        id:        currentId,
        speaker:   'operator',
        text:      result[0].transcript,
        timestamp: new Date().toISOString(),
        isFinal:   result.isFinal,
      };

      setActiveCall(prev => {
        if (!prev) return prev;
        const existing = prev.transcript.findIndex(t => t.id === currentId);
        const updated = [...prev.transcript];
        if (existing >= 0) updated[existing] = line;
        else updated.push(line);
        return { ...prev, transcript: updated.slice(-100) };
      });

      // Send to citizen
      if (socket && result.isFinal) {
        socket.emit('CALL_OPERATOR_TRANSCRIPT', {
          sessionId,
          id:        currentId,
          text:      result[0].transcript,
          timestamp: new Date().toISOString(),
          language:  'en',
        });
        currentId = `op-${Date.now()}`;
      }
    };

    rec.onerror = () => {};
    rec.onend   = () => {
      if (activeCall) setTimeout(() => rec.start(), 200);
    };
    rec.start();
  }, [socket, activeCall]);

  // ── End call ──────────────────────────────────────────────

  const handleEndCall = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    pcRef.current?.close();
    recognitionRef.current?.stop();
    if (durationRef.current) clearInterval(durationRef.current);

    if (socket && activeCall) {
      socket.emit('CALL_ENDED_BY_OPERATOR', {
        sessionId:  activeCall.sessionId,
        incidentId: activeCall.incidentId,
        duration:   activeCall.durationSeconds,
      });
    }

    addLogEntry({
      type: 'COMM',
      severity: 'INFO',
      message: `Call ended: ${activeCall?.referenceCode} · ${activeCall?.durationSeconds}s`,
      timestamp: new Date().toISOString(),
      incidentId: activeCall?.incidentId,
    });

    setActiveCall(null);
  }, [socket, activeCall, addLogEntry]);

  // ── Dispatch from call ────────────────────────────────────

  const handleDispatch = useCallback(() => {
    if (!activeCall) return;
    addLogEntry({
      type: 'DISPATCH',
      severity: activeCall.severity,
      message: `Dispatch triggered from call: ${activeCall.referenceCode}`,
      timestamp: new Date().toISOString(),
      incidentId: activeCall.incidentId,
    });
    if (socket) {
      socket.emit('CALL_DISPATCH_TRIGGERED', {
        incidentId: activeCall.incidentId,
        sessionId:  activeCall.sessionId,
        operatorId: user?.id,
      });
    }
  }, [activeCall, socket, user, addLogEntry]);

  // ── Escalate ──────────────────────────────────────────────

  const handleEscalate = useCallback(() => {
    if (!activeCall) return;
    addLogEntry({
      type: 'COMM',
      severity: 'CRITICAL',
      message: `Escalated from call: ${activeCall.referenceCode}`,
      timestamp: new Date().toISOString(),
      incidentId: activeCall.incidentId,
    });
    if (socket) {
      socket.emit('CALL_ESCALATED', {
        incidentId: activeCall.incidentId,
        sessionId:  activeCall.sessionId,
        operatorId: user?.id,
      });
    }
  }, [activeCall, socket, user, addLogEntry]);

  // ── Render ────────────────────────────────────────────────

  return (
    <>
      {/* Incoming call popup */}
      <AnimatePresence>
        {incomingCall && (
          <IncomingCallPopup
            call={incomingCall}
            onAccept={handleAccept}
            onDecline={() => setIncomingCall(null)}
          />
        )}
      </AnimatePresence>

      {/* Active call panel */}
      {activeCall ? (
        <ActiveCallPanel
          call={activeCall}
          onEnd={handleEndCall}
          onDispatch={handleDispatch}
          onEscalate={handleEscalate}
        />
      ) : (
        <div className="panel h-full flex items-center justify-center">
          <div style={{ textAlign: 'center' }}>
            <Phone style={{ width: 32, height: 32, color: '#1a1a1a', margin: '0 auto 12px' }} />
            <div style={{ fontSize: 10, fontFamily: 'monospace', color: '#333', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
              No Active Call
            </div>
            <div style={{ fontSize: 9, color: '#222', marginTop: 4 }}>
              Incoming calls appear here
            </div>
          </div>
        </div>
      )}
    </>
  );
}
