import { useRef, useCallback, useState } from 'react';
import { useAppStore } from '../store/appStore';

export interface VoiceResult {
  transcript: string;
  confidence: number;
  isFinal: boolean;
}

interface UseVoiceOptions {
  onResult: (result: VoiceResult) => void;
  onError?: (error: string) => void;
  continuous?: boolean;
}

// Check support once at module level
const SpeechRecognitionAPI =
  (typeof window !== 'undefined' &&
    ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) || null;

export function useVoice({ onResult, onError, continuous = false }: UseVoiceOptions) {
  const { language } = useAppStore();
  const [isListening, setIsListening] = useState(false);
  const isSupported = !!SpeechRecognitionAPI;

  // Keep latest callbacks in refs so recognition instance never needs to be recreated
  const onResultRef = useRef(onResult);
  const onErrorRef  = useRef(onError);
  onResultRef.current = onResult;
  onErrorRef.current  = onError;

  // Single recognition instance, created lazily
  const recognitionRef = useRef<any>(null);

  const getRecognition = useCallback(() => {
    if (!SpeechRecognitionAPI) return null;
    if (recognitionRef.current) return recognitionRef.current;

    const rec = new SpeechRecognitionAPI();
    rec.continuous      = continuous;
    rec.interimResults  = true;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[event.results.length - 1];
      onResultRef.current({
        transcript: result[0].transcript,
        confidence: result[0].confidence,
        isFinal:    result.isFinal,
      });
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      setIsListening(false);
      onErrorRef.current?.(event.error);
    };

    rec.onend = () => setIsListening(false);

    recognitionRef.current = rec;
    return rec;
  }, [continuous]);

  const startListening = useCallback(() => {
    if (isListening) return;
    const rec = getRecognition();
    if (!rec) return;
    try {
      rec.lang = language;
      rec.start();
      setIsListening(true);
    } catch {
      // Already started or other error — just update state
      setIsListening(false);
    }
  }, [isListening, language, getRecognition]);

  const stopListening = useCallback(() => {
    if (!isListening) return;
    try {
      recognitionRef.current?.stop();
    } catch { /* ignore */ }
    setIsListening(false);
  }, [isListening]);

  const toggleListening = useCallback(() => {
    if (isListening) stopListening();
    else startListening();
  }, [isListening, startListening, stopListening]);

  return { isListening, isSupported, startListening, stopListening, toggleListening };
}

// ── Text-to-speech ────────────────────────────────────────────

export function speak(text: string, language = 'en') {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang  = language;
  utterance.rate  = 0.95;
  utterance.pitch = 1.0;
  window.speechSynthesis.speak(utterance);
}
