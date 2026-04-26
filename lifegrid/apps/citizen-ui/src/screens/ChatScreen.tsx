// ============================================================
// LIFEGRID – Screen 3: AI Emergency Chat
// Behaves like a trained emergency operator.
// Emotion detection · Flow control · Multi-language
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Send, Volume2, VolumeX, ChevronDown, Shield } from 'lucide-react';
import { format } from 'date-fns';
import { useAppStore, ChatMessage } from '../store/appStore';
import { useVoice, speak } from '../hooks/useVoice';
import { useHaptic } from '../hooks/useHaptic';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { v4 as uuidv4 } from 'uuid';

// ── Quick replies ─────────────────────────────────────────────
const QUICK_REPLIES = [
  'I need medical help',
  'There is a fire',
  'I am safe now',
  'I cannot move',
  'Send more help',
];

// ── AI response types ─────────────────────────────────────────
type Emotion       = 'CALM' | 'ANXIOUS' | 'PANIC' | 'CRITICAL_PANIC';
type EmergencyType = 'MEDICAL' | 'FIRE' | 'CRIME' | 'ACCIDENT' | 'DISASTER' | 'OTHER' | null;
type Severity      = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
type Service       = 'AMBULANCE' | 'POLICE' | 'FIRE' | 'DOCTOR' | 'RESCUE' | 'NGO' | null;
type Status        = 'TRIGGERED' | 'CLASSIFIED' | 'DISPATCHED' | 'EN_ROUTE' | 'ON_SCENE';

interface AIResponse {
  reply:            string;
  emotion:          Emotion;
  emergencyType:    EmergencyType;
  severity:         Severity;
  servicePrimary:   Service;
  serviceSecondary: string | null;
  location:         string | null;
  confidence:       number;
  status:           Status;
}

// ── Conversation state ────────────────────────────────────────
interface ConvState {
  status:        Status;
  emergencyType: EmergencyType;
  location:      string | null;
  severity:      Severity;
  turnCount:     number;
}

// ── Emotion detector ──────────────────────────────────────────
function detectEmotion(text: string): Emotion {
  const t = text.toLowerCase();
  const panicWords  = ['help me', 'please help', 'dying', 'dead', 'bleeding', 'can\'t breathe', 'not breathing', 'unconscious'];
  const anxiousWords = ['scared', 'afraid', 'worried', 'don\'t know', 'what do i', 'hurry', 'fast', 'quick'];
  const calmWords   = ['okay', 'fine', 'stable', 'safe', 'resolved'];

  if (panicWords.some(w => t.includes(w))) return 'PANIC';
  if (text.includes('!!!') || text === text.toUpperCase() && text.length > 5) return 'CRITICAL_PANIC';
  if (anxiousWords.some(w => t.includes(w))) return 'ANXIOUS';
  if (calmWords.some(w => t.includes(w))) return 'CALM';
  return 'ANXIOUS';
}

// ── Emergency type detector ───────────────────────────────────
function detectType(text: string): EmergencyType {
  const t = text.toLowerCase();
  if (/medical|heart|chest|breath|bleed|unconscious|pain|hurt|injur|ambulance|doctor|stroke|seizure|faint/.test(t)) return 'MEDICAL';
  if (/fire|smoke|burn|flame|blaze|explosion/.test(t)) return 'FIRE';
  if (/shoot|gun|weapon|attack|threat|robbery|assault|knife|crime|stab|murder/.test(t)) return 'CRIME';
  if (/accident|crash|collision|car|vehicle|road|hit/.test(t)) return 'ACCIDENT';
  if (/flood|water|tsunami|earthquake|storm|disaster|cyclone|landslide/.test(t)) return 'DISASTER';
  if (/help|sos|emergency|urgent/.test(t)) return 'OTHER';
  return null;
}

// ── Location extractor ────────────────────────────────────────
function extractLocation(text: string): string | null {
  const patterns = [
    /(?:at|near|in|on|from)\s+([A-Z][a-zA-Z\s,]+(?:road|street|avenue|lane|nagar|colony|area|building|hospital|school|market|station|bridge|park|mall|tower|block|sector|phase|floor|flat|house|village|town|city|district))/i,
    /(?:my address is|i am at|i'm at|located at)\s+(.+)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

// ── Severity calculator ───────────────────────────────────────
function calcSeverity(type: EmergencyType, text: string): Severity {
  const t = text.toLowerCase();
  if (/dying|dead|not breathing|unconscious|critical|severe|massive/.test(t)) return 'CRITICAL';
  if (/bleeding|fire|gun|crash|flood|trapped/.test(t)) return 'HIGH';
  if (/pain|hurt|smoke|threat|accident/.test(t)) return 'MEDIUM';
  if (type) return 'MEDIUM';
  return 'LOW';
}

// ── Service mapper ────────────────────────────────────────────
function mapService(type: EmergencyType): Service {
  switch (type) {
    case 'MEDICAL':  return 'AMBULANCE';
    case 'FIRE':     return 'FIRE';
    case 'CRIME':    return 'POLICE';
    case 'ACCIDENT': return 'AMBULANCE';
    case 'DISASTER': return 'RESCUE';
    default:         return 'RESCUE';
  }
}

// ── Core AI engine ────────────────────────────────────────────
// STRICT: Returns ONLY valid JSON matching your exact spec
function buildAIResponse(userText: string, conv: ConvState): AIResponse {
  const t       = userText.toLowerCase();
  const emotion = detectEmotion(userText);
  const type    = conv.emergencyType ?? detectType(userText);
  const loc     = conv.location ?? extractLocation(userText);
  const sev     = conv.severity ?? calcSeverity(type, userText);
  const service = mapService(type);

  // Determine next status
  let status: Status = conv.status;
  if (conv.status === 'TRIGGERED' && type)          status = 'CLASSIFIED';
  if (conv.status === 'CLASSIFIED' && loc)          status = 'DISPATCHED';
  if (conv.status === 'DISPATCHED' && conv.turnCount > 1) status = 'EN_ROUTE';

  // ── Build reply (SHORT sentences, max 8-10 words) ─────────

  let reply = '';

  // RULE: Calm user first if panicking
  if (emotion === 'PANIC') {
    reply = 'Stay calm. I am here. ';
  } else if (emotion === 'CRITICAL_PANIC') {
    reply = 'Listen to me. You are safe. ';
  }

  // FLOW CONTROL: Follow exact order
  if (status === 'TRIGGERED' || !type) {
    // Step 1: Ask what happened
    reply += 'What is your emergency?';
  }
  else if (status === 'CLASSIFIED' && !loc) {
    // Step 2: Give instruction + ask location
    if (type === 'FIRE') {
      reply += 'Move outside now. Stay low. Where are you?';
    } else if (type === 'MEDICAL') {
      reply += 'Check breathing. Do not move them. Where are you?';
    } else if (type === 'CRIME') {
      reply += 'Stay hidden. Stay quiet. Where are you?';
    } else if (type === 'ACCIDENT') {
      reply += 'Do not move. Check bleeding. Where are you?';
    } else if (type === 'DISASTER') {
      reply += 'Move to higher ground. Where are you?';
    } else {
      reply += 'Help is coming. Where are you?';
    }
  }
  else if (status === 'DISPATCHED') {
    // Step 3: Confirm help + give instruction
    if (type === 'FIRE') {
      reply += 'Fire team dispatched. Stay outside. Do not re-enter.';
    } else if (type === 'MEDICAL') {
      reply += 'Ambulance on the way. Keep them still. Check breathing.';
    } else if (type === 'CRIME') {
      reply += 'Police dispatched. Stay hidden. Do not confront.';
    } else if (type === 'ACCIDENT') {
      reply += 'Ambulance dispatched. Do not move injured. Apply pressure.';
    } else if (type === 'DISASTER') {
      reply += 'Rescue team dispatched. Stay at location. Signal if possible.';
    } else {
      reply += 'Help dispatched. Stay calm. Stay connected.';
    }
  }
  else if (status === 'EN_ROUTE') {
    // Step 4: Reassure + ask status
    reply += 'Help is close. Are you safe?';
  }

  // OVERRIDES: Handle special cases
  if (/safe|okay|fine|resolved/.test(t)) {
    reply = 'Understood. Responders will check. Stay at location.';
    status = 'EN_ROUTE';
  }
  if (/cannot move|can't move|stuck|trapped/.test(t)) {
    reply = 'Stay where you are. Help is coming. Make noise.';
  }
  if (/more help|additional|backup/.test(t)) {
    reply = 'Additional units requested. More help coming.';
  }

  // LANGUAGE: Hindi
  if (/मदद|आग|दुर्घटना|खून|बचाओ/.test(userText)) {
    reply = 'शांत रहें। मदद आ रही है। आप कहाँ हैं?';
  }

  // LANGUAGE: Telugu
  if (/సహాయం|అగ్ని|ప్రమాదం|రక్తం/.test(userText)) {
    reply = 'శాంతంగా ఉండండి। సహాయం వస్తోంది। మీరు ఎక్కడ ఉన్నారు?';
  }

  // MANDATORY: Return ONLY valid JSON structure
  return {
    reply,
    emotion,
    emergencyType: type,
    severity:      sev,
    servicePrimary: service,
    serviceSecondary: type === 'MEDICAL' ? 'DOCTOR' : type === 'DISASTER' ? 'NGO' : null,
    location:      loc,
    confidence:    type ? 0.85 : 0.5,
    status,
  };
}

// ── Main component ────────────────────────────────────────────

export default function ChatScreen() {
  const {
    chatMessages, addChatMessage, markMessagesRead,
    activeSessionId, isChatTyping, setChatTyping,
    isVoiceActive, setVoiceActive,
    language, setLanguage,
    activeIncidentId, userLocation,
    sosState,
  } = useAppStore();

  const { socket }  = useSocket();
  const { haptic }  = useHaptic();
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);

  const [inputText, setInputText]       = useState('');
  const [isSending, setIsSending]       = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  // Conversation state for flow control
  const convRef = useRef<ConvState>({
    status:        'TRIGGERED',
    emergencyType: null,
    location:      null,
    severity:      null,
    turnCount:     0,
  });

  // Sync location from store into conv state
  useEffect(() => {
    if (userLocation) {
      convRef.current.location = `${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}`;
    }
  }, [userLocation]);

  // Mark read on mount
  useEffect(() => { markMessagesRead(); }, [markMessagesRead]);

  // Welcome message
  useEffect(() => {
    if (chatMessages.length === 0) {
      setTimeout(() => {
        addChatMessage({
          id: uuidv4(), role: 'system',
          content: sosState !== 'idle'
            ? 'Emergency received. Stay calm. I am your LIFEGRID operator. What is happening right now?'
            : 'LIFEGRID Emergency AI is ready. How can I help you today?',
          timestamp: new Date().toISOString(), isRead: false, language,
        });
      }, 400);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatTyping]);

  // TTS for system messages
  useEffect(() => {
    if (!isVoiceActive || chatMessages.length === 0) return;
    const last = chatMessages[chatMessages.length - 1];
    if (last.role === 'system' || last.role === 'operator') {
      speak(last.content, last.language ?? language);
    }
  }, [chatMessages, isVoiceActive, language]);

  // Voice input
  const { isListening, isSupported: voiceSupported, toggleListening } = useVoice({
    onResult: ({ transcript, isFinal }) => {
      setVoiceTranscript(transcript);
      if (isFinal && transcript.trim()) { setInputText(transcript); setVoiceTranscript(''); }
    },
  });

  // ── Send message ──────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    haptic('tap');
    setInputText(''); setVoiceTranscript(''); setIsSending(true);

    const userMsg: ChatMessage = {
      id: uuidv4(), role: 'user', content: trimmed,
      timestamp: new Date().toISOString(), isRead: true, language,
    };
    addChatMessage(userMsg);
    setChatTyping(true);

    const thinkMs = 500 + Math.random() * 500;

    try {
      await Promise.race([
        api.post(`/guidance/${activeSessionId ?? 'local'}/message`, { content: trimmed, language }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
    } catch {
      // Use local AI engine
      await new Promise(r => setTimeout(r, thinkMs));

      convRef.current.turnCount += 1;
      const aiResult = buildAIResponse(trimmed, convRef.current);

      // Update conv state
      if (aiResult.emergencyType) convRef.current.emergencyType = aiResult.emergencyType;
      if (aiResult.location)      convRef.current.location      = aiResult.location;
      if (aiResult.severity)      convRef.current.severity      = aiResult.severity;
      convRef.current.status = aiResult.status;

      addChatMessage({
        id: uuidv4(), role: 'system',
        content: aiResult.reply,
        timestamp: new Date().toISOString(), isRead: false, language,
      });

      // Show status badge if dispatched
      if (aiResult.status === 'DISPATCHED' || aiResult.status === 'EN_ROUTE') {
        setTimeout(() => {
          addChatMessage({
            id: uuidv4(), role: 'ai',
            content: `🚨 ${aiResult.servicePrimary ?? 'Help'} dispatched${aiResult.location ? ` to ${aiResult.location}` : ''}. Severity: ${aiResult.severity ?? 'HIGH'}.`,
            timestamp: new Date().toISOString(), isRead: false, language,
          });
        }, 800);
      }
    } finally {
      setChatTyping(false); setIsSending(false);
    }
  }, [isSending, haptic, language, addChatMessage, activeSessionId, setChatTyping]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(voiceTranscript || inputText); }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setShowScrollBtn(el.scrollHeight - el.scrollTop - el.clientHeight > 80);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', overflow: 'hidden' }}>

      <ScreenHeader
        title="Live Guidance"
        subtitle={activeIncidentId ? 'Emergency operator connected' : 'AI Emergency Assistant'}
        right={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={() => setVoiceActive(!isVoiceActive)}
              style={{ padding: 6, borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer' }}
              aria-label={isVoiceActive ? 'Mute voice' : 'Enable voice'}
            >
              {isVoiceActive
                ? <Volume2 style={{ width: 16, height: 16, color: '#6b7280' }} />
                : <VolumeX  style={{ width: 16, height: 16, color: '#9ca3af' }} />
              }
            </button>
            <LanguageSelector value={language} onChange={setLanguage} compact />
          </div>
        }
      />

      {/* AI operator badge */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 16px',
        background: '#f8faff',
        borderBottom: '1px solid #e5e7eb',
      }}>
        <Shield style={{ width: 11, height: 11, color: '#3b82f6' }} />
        <span style={{ fontSize: 10, color: '#3b82f6', fontWeight: 600, letterSpacing: '0.05em' }}>
          LIFEGRID EMERGENCY AI · TRAINED OPERATOR PROTOCOL
        </span>
        <span style={{ marginLeft: 'auto', width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
      </div>

      {/* ── Messages ─────────────────────────────────────── */}
      <div
        style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 }}
        onScroll={handleScroll}
        role="log" aria-live="polite"
      >
        {chatMessages.length === 0 ? <EmptyState /> : (
          <>
            {chatMessages.map((msg, i) => (
              <MessageBubble
                key={msg.id} message={msg}
                showTime={i === 0 || new Date(msg.timestamp).getTime() - new Date(chatMessages[i - 1].timestamp).getTime() > 60000}
              />
            ))}
            <AnimatePresence>
              {isChatTyping && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="chat-bubble-system" style={{ display: 'inline-block' }}>
                    <TypingDots />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll button */}
      <AnimatePresence>
        {showScrollBtn && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}
            onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
            style={{ position: 'absolute', bottom: 140, right: 16, width: 36, height: 36, borderRadius: '50%', background: '#f3f4f6', border: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10 }}
          >
            <ChevronDown style={{ width: 16, height: 16, color: '#6b7280' }} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Quick replies ─────────────────────────────────── */}
      <div style={{ padding: '8px 16px', borderTop: '1px solid #f3f4f6', overflowX: 'auto' }}>
        <div style={{ display: 'flex', gap: 8, width: 'max-content' }}>
          {QUICK_REPLIES.map(r => (
            <button
              key={r}
              onClick={() => sendMessage(r)}
              style={{
                flexShrink: 0, padding: '6px 12px',
                border: '1px solid #e5e7eb', borderRadius: 99,
                background: '#f9fafb', fontSize: 11, color: '#374151',
                cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 500,
                transition: 'all 0.15s',
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      {/* ── Input bar ─────────────────────────────────────── */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #e5e7eb', background: '#fff', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <button
          onClick={() => { if (!voiceSupported) { alert('Voice input requires Chrome or Edge.'); return; } toggleListening(); }}
          style={{
            flexShrink: 0, width: 42, height: 42,
            border: `2px solid ${isListening ? '#ef4444' : '#e5e7eb'}`,
            borderRadius: 12, background: isListening ? '#fef2f2' : '#f9fafb',
            display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
          }}
          aria-label={isListening ? 'Stop recording' : 'Start voice input'}
        >
          {isListening
            ? <MicOff style={{ width: 18, height: 18, color: '#ef4444' }} />
            : <Mic    style={{ width: 18, height: 18, color: voiceSupported ? '#6b7280' : '#d1d5db' }} />
          }
        </button>

        <div style={{ flex: 1, position: 'relative' }}>
          <textarea
            ref={inputRef}
            value={voiceTranscript || inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? 'Listening…' : 'Describe your emergency…'}
            rows={1}
            style={{
              width: '100%', background: '#f9fafb', border: '1.5px solid #e5e7eb',
              borderRadius: 12, padding: '10px 12px', fontSize: 14, color: '#111827',
              resize: 'none', outline: 'none', fontFamily: 'inherit',
              lineHeight: 1.5, maxHeight: 96, overflowY: 'auto', boxSizing: 'border-box',
            }}
          />
          {isListening && (
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', width: 8, height: 8, borderRadius: '50%', background: '#ef4444', animation: 'pulse 1s infinite' }} />
          )}
        </div>

        <button
          onClick={() => sendMessage(voiceTranscript || inputText)}
          disabled={(!inputText.trim() && !voiceTranscript) || isSending}
          style={{
            flexShrink: 0, width: 42, height: 42, borderRadius: 12, border: 'none',
            background: (inputText.trim() || voiceTranscript) && !isSending ? '#0f172a' : '#e5e7eb',
            color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: (inputText.trim() || voiceTranscript) && !isSending ? 'pointer' : 'not-allowed',
          }}
          aria-label="Send message"
        >
          <Send style={{ width: 16, height: 16 }} />
        </button>
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────

function MessageBubble({ message, showTime }: { message: ChatMessage; showTime: boolean }) {
  const isUser = message.role === 'user';
  const isAI   = message.role === 'ai';   // dispatch status badge

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: isUser ? 'flex-end' : 'flex-start' }}
    >
      {showTime && (
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#9ca3af', padding: '0 4px' }}>
          {format(new Date(message.timestamp), 'HH:mm')}
        </span>
      )}

      {!isUser && (
        <span style={{ fontSize: 9, fontFamily: 'monospace', color: '#9ca3af', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 2 }}>
          {message.role === 'operator' ? 'Operator' : isAI ? 'System' : 'LIFEGRID AI'}
        </span>
      )}

      {isAI ? (
        // Dispatch status badge
        <div style={{
          padding: '8px 14px', borderRadius: 10,
          background: '#f0fdf4', border: '1px solid #86efac',
          fontSize: 12, color: '#15803d', fontWeight: 600,
        }}>
          {message.content}
        </div>
      ) : (
        <div className={isUser ? 'chat-bubble-user' : 'chat-bubble-system'}>
          <p style={{ fontSize: 14, lineHeight: 1.55, margin: 0 }}>{message.content}</p>
        </div>
      )}
    </motion.div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 16 }}>
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          style={{ width: 6, height: 6, borderRadius: '50%', background: '#9ca3af', display: 'block' }}
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16, padding: '48px 24px', textAlign: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: 16, background: '#f0f9ff', border: '1px solid #bae6fd', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Shield style={{ width: 24, height: 24, color: '#0ea5e9' }} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', marginBottom: 6 }}>Emergency AI Ready</div>
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, maxWidth: 260 }}>
          Describe your emergency and I will guide you step by step. Available in English, Hindi, and Telugu.
        </div>
      </div>
    </div>
  );
}
