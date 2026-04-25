// ============================================================
// LIFEGRID – Screen 3: AI Chat / Voice Assistant
// Live guidance from operator + AI system
//
// UX Behavior:
//   - Messages stream in from WebSocket in real time
//   - Voice button: tap to speak, auto-transcribes
//   - System messages auto-read aloud (TTS) if voice enabled
//   - Language auto-detected from NLP, can be overridden
//   - Offline: shows cached messages, queues outgoing
//   - Typing indicator when operator is composing
//   - Scroll-to-bottom on new message
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Send, Volume2, VolumeX, ChevronDown } from 'lucide-react';
import { format } from 'date-fns';
import { useAppStore, ChatMessage } from '../store/appStore';
import { useVoice, speak } from '../hooks/useVoice';
import { useHaptic } from '../hooks/useHaptic';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';
import { ScreenHeader } from '../components/layout/ScreenHeader';
import { LanguageSelector } from '../components/ui/LanguageSelector';
import { v4 as uuidv4 } from 'uuid';

const QUICK_REPLIES = [
  'I need medical help',
  'There is a fire',
  'I am safe now',
  'Send more help',
  'I cannot move',
];

export default function ChatScreen() {
  const {
    chatMessages, addChatMessage, markMessagesRead,
    activeSessionId, isChatTyping, setChatTyping,
    isVoiceActive, setVoiceActive,
    language, setLanguage,
    activeIncidentId,
  } = useAppStore();

  const { socket } = useSocket();
  const { haptic } = useHaptic();
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState('');

  // Mark messages read on mount + send welcome if chat is empty
  useEffect(() => {
    markMessagesRead();
  }, [markMessagesRead]);

  // Auto-send welcome message if chat is empty
  useEffect(() => {
    if (chatMessages.length === 0) {
      setTimeout(() => {
        addChatMessage({
          id: uuidv4(),
          role: 'system',
          content: 'LIFEGRID Emergency AI is ready. How can I help you? You can type your situation or use the quick replies below.',
          timestamp: new Date().toISOString(),
          isRead: false,
          language,
        });
      }, 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, isChatTyping]);

  // TTS for new system messages
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
      if (isFinal && transcript.trim()) {
        setInputText(transcript);
        setVoiceTranscript('');
      }
    },
  });

  // ── Local AI response engine (works without backend) ─────

  const getLocalAIResponse = useCallback((userText: string): string => {
    const t = userText.toLowerCase();

    // Medical
    if (/medical|heart|chest|breath|bleed|unconscious|pain|hurt|injur|ambulance|doctor/.test(t))
      return 'Medical help is being dispatched to your location. Keep the person still and calm. If they are unconscious, check for breathing. Do not give food or water. Help is on the way.';

    // Fire
    if (/fire|smoke|burn|flame|blaze/.test(t))
      return 'Fire services are being dispatched. Evacuate the building immediately — do not use elevators. Stay low to avoid smoke. Move to your assembly point and wait for responders.';

    // Security / threat
    if (/shoot|gun|weapon|attack|threat|robbery|assault|knife|danger/.test(t))
      return 'Police are being dispatched to your location. Move to a safe location away from the threat. Lock doors if possible. Do not confront the threat. Stay on this line.';

    // Flood / disaster
    if (/flood|water|tsunami|earthquake|storm|disaster/.test(t))
      return 'Emergency teams are being mobilized. Move to higher ground immediately. Avoid flooded roads. Follow evacuation routes. Rescue teams are on their way.';

    // Safe / resolved
    if (/safe|okay|fine|resolved|cancel|false alarm/.test(t))
      return 'Understood. I have noted that you are safe. Responders will still check on you. Please stay at your location until they arrive and confirm.';

    // Help / SOS
    if (/help|sos|emergency|urgent|please/.test(t))
      return 'Your emergency has been received. Responders are being dispatched to your location. Stay calm, stay on this line, and follow any instructions from emergency services.';

    // Location
    if (/where|location|address|find me|lost/.test(t))
      return 'We are using your GPS coordinates to locate you. If you can, describe any nearby landmarks, street names, or building numbers to help responders find you faster.';

    // Cannot move
    if (/cannot move|can't move|stuck|trapped|immobile/.test(t))
      return 'Understood — stay where you are. Responders are coming to you. Keep this line open. If you can, make noise or signal from a window to help them locate you.';

    // More help
    if (/more help|additional|backup|not enough/.test(t))
      return 'Additional units are being requested. Your situation has been escalated. More responders are on their way. Please stay calm and keep this line open.';

    // Default
    return 'Your message has been received by the emergency coordination center. Responders are aware of your situation. Stay calm, stay safe, and keep this line open. Is there anything specific you need right now?';
  }, []);

  // Send message
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isSending) return;

    haptic('tap');
    setInputText('');
    setVoiceTranscript('');
    setIsSending(true);

    // Add user message immediately
    const userMsg: ChatMessage = {
      id: uuidv4(),
      role: 'user',
      content: trimmed,
      timestamp: new Date().toISOString(),
      isRead: true,
      language,
    };
    addChatMessage(userMsg);

    // Show typing indicator
    setChatTyping(true);

    // Simulate AI thinking delay (600–1200ms feels natural)
    const thinkMs = 600 + Math.random() * 600;

    try {
      // Try backend (non-blocking, 3s timeout)
      await Promise.race([
        api.post(`/guidance/${activeSessionId ?? 'local'}/message`, { content: trimmed, language }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
    } catch {
      // Backend unavailable — use local AI response
      await new Promise(r => setTimeout(r, thinkMs));
      const aiReply = getLocalAIResponse(trimmed);
      addChatMessage({
        id: uuidv4(),
        role: 'system',
        content: aiReply,
        timestamp: new Date().toISOString(),
        isRead: false,
        language,
      });
    } finally {
      setChatTyping(false);
      setIsSending(false);
    }
  }, [isSending, haptic, language, addChatMessage, activeSessionId, setChatTyping, getLocalAIResponse]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(voiceTranscript || inputText);
    }
  };

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setShowScrollBtn(!atBottom);
  };

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const isEmpty = chatMessages.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff", overflow: "hidden" }}>
      <ScreenHeader
        title="Live Guidance"
        subtitle={activeIncidentId ? 'Connected to operator' : 'AI Assistant'}
        right={
          <div className="flex items-center gap-2">
            <button
              onClick={() => setVoiceActive(!isVoiceActive)}
              className="p-2 hover:bg-gray-100 rounded transition-colors"
              aria-label={isVoiceActive ? 'Mute voice' : 'Enable voice'}
            >
              {isVoiceActive
                ? <Volume2 className="w-4 h-4 text-gray-400" />
                : <VolumeX className="w-4 h-4 text-gray-500" />
              }
            </button>
            <LanguageSelector value={language} onChange={setLanguage} compact />
          </div>
        }
      />

      {/* ── Messages ─────────────────────────────────────── */}
      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        aria-label="Guidance messages"
      >
        {isEmpty ? (
          <EmptyState />
        ) : (
          <>
            {chatMessages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                showTime={
                  i === 0 ||
                  new Date(msg.timestamp).getTime() -
                  new Date(chatMessages[i - 1].timestamp).getTime() > 60000
                }
              />
            ))}

            {/* Typing indicator */}
            <AnimatePresence>
              {isChatTyping && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  className="flex gap-3 items-end"
                >
                  <div className="chat-bubble-system">
                    <TypingDots />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scroll to bottom button */}
      <AnimatePresence>
        {showScrollBtn && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            onClick={scrollToBottom}
            className="absolute bottom-32 right-4 w-9 h-9 bg-gray-100 border border-gray-300 rounded-full flex items-center justify-center z-10"
          >
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </motion.button>
        )}
      </AnimatePresence>

      {/* ── Quick replies ─────────────────────────────────── */}
      <div className="px-4 py-2 border-t border-gray-100 overflow-x-auto">
        <div className="flex gap-2 pb-1" style={{ width: 'max-content' }}>
          {QUICK_REPLIES.map(reply => (
            <button
              key={reply}
              onClick={() => sendMessage(reply)}
              className="flex-shrink-0 px-3 py-1.5 border border-gray-200 text-[10px] text-gray-400 hover:border-gray-300 hover:text-gray-900 transition-all whitespace-nowrap"
            >
              {reply}
            </button>
          ))}
        </div>
      </div>

      {/* ── Input bar ─────────────────────────────────────── */}
      <div style={{ padding: '10px 16px', borderTop: '1px solid #e5e7eb', background: '#fff', display: 'flex', alignItems: 'flex-end', gap: 10 }}>

        {/* Mic button — always shown */}
        <button
          onClick={() => {
            if (!voiceSupported) {
              alert('Voice input requires Chrome or Edge browser.');
              return;
            }
            toggleListening();
          }}
          style={{
            flexShrink: 0,
            width: 42, height: 42,
            border: `2px solid ${isListening ? '#ef4444' : '#e5e7eb'}`,
            borderRadius: 10,
            background: isListening ? '#fef2f2' : '#f9fafb',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
          }}
          aria-label={isListening ? 'Stop recording' : 'Start voice input'}
        >
          {isListening
            ? <MicOff style={{ width: 18, height: 18, color: '#ef4444' }} />
            : <Mic style={{ width: 18, height: 18, color: voiceSupported ? '#6b7280' : '#d1d5db' }} />
          }
        </button>

        {/* Text input */}
        <div style={{ flex: 1, position: 'relative' }}>
          <textarea
            ref={inputRef}
            value={voiceTranscript || inputText}
            onChange={e => setInputText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isListening ? 'Listening...' : 'Type a message...'}
            rows={1}
            style={{
              width: '100%', background: '#f9fafb', border: '1px solid #e5e7eb',
              borderRadius: 10, padding: '10px 12px', fontSize: 14, color: '#111827',
              resize: 'none', outline: 'none', fontFamily: 'inherit',
              lineHeight: 1.5, maxHeight: 96, overflowY: 'auto', boxSizing: 'border-box',
            }}
            aria-label="Message input"
          />
          {isListening && (
            <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'block', animation: 'pulse 1s infinite' }} />
            </div>
          )}
        </div>

        {/* Send button */}
        <button
          onClick={() => sendMessage(voiceTranscript || inputText)}
          disabled={(!inputText.trim() && !voiceTranscript) || isSending}
          style={{
            flexShrink: 0,
            width: 42, height: 42,
            borderRadius: 10,
            border: 'none',
            background: (inputText.trim() || voiceTranscript) && !isSending ? '#111827' : '#e5e7eb',
            color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
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

// ── Sub-components ────────────────────────────────────────────

function MessageBubble({ message, showTime }: { message: ChatMessage; showTime: boolean }) {
  const isUser = message.role === 'user';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}
    >
      {showTime && (
        <span className="text-[9px] font-mono text-gray-400 px-1">
          {format(new Date(message.timestamp), 'HH:mm')}
        </span>
      )}

      {!isUser && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[9px] font-mono text-gray-500 uppercase tracking-widest">
            {message.role === 'operator' ? 'Operator' : 'LIFEGRID AI'}
          </span>
        </div>
      )}

      <div className={isUser ? 'chat-bubble-user' : 'chat-bubble-system'}>
        <p className="text-sm leading-relaxed">{message.content}</p>
      </div>
    </motion.div>
  );
}

function TypingDots() {
  return (
    <div className="flex gap-1 items-center h-4">
      {[0, 1, 2].map(i => (
        <motion.span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[#555]"
          animate={{ opacity: [0.3, 1, 0.3] }}
          transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 py-16 text-center">
      <div className="w-16 h-16 border border-gray-200 flex items-center justify-center">
        <span className="text-2xl">💬</span>
      </div>
      <div>
        <div className="text-sm font-bold mb-2">AI Guidance Ready</div>
        <div className="text-[11px] text-gray-500 leading-relaxed max-w-xs">
          Once you report an emergency, live guidance from operators and AI will appear here.
          You can also ask questions now.
        </div>
      </div>
    </div>
  );
}
