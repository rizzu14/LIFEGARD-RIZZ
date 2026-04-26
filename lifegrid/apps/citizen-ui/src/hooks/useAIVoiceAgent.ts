// ============================================================
// LIFEGRID – AI Voice Agent  v3
// Clean sequential state machine — no overlapping TTS/STT
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

export type AgentStatus    = 'idle' | 'activating' | 'speaking' | 'listening' | 'processing' | 'ended';
export type DispatchStatus = 'TRIGGERED' | 'COLLECTING_INFO' | 'DISPATCHING' | 'EN_ROUTE' | 'ARRIVED';
export type EmotionType    = 'CALM' | 'ANXIOUS' | 'PANIC' | 'CRITICAL_PANIC';
export type EmergencyType  = 'MEDICAL' | 'FIRE' | 'CRIME' | 'ACCIDENT' | 'DISASTER' | 'OTHER' | null;
export type ServiceType    = 'AMBULANCE' | 'POLICE' | 'FIRE' | 'DOCTOR' | 'RESCUE' | 'NGO' | null;
export type LangCode       = 'en' | 'hi' | 'te';

export interface EmergencyData {
  emergencyType: EmergencyType;
  location:      string | null;
  serviceNeeded: ServiceType;
  severity:      'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  userStatus:    string | null;
  language:      LangCode;
}

export interface AgentMessage {
  id: string; speaker: 'ai' | 'user';
  text: string; timestamp: string; emotion?: EmotionType;
}

export interface AIVoiceAgentState {
  status:         AgentStatus;
  dispatchStatus: DispatchStatus;
  messages:       AgentMessage[];
  emergencyData:  EmergencyData;
  currentEmotion: EmotionType;
  eta:            number;
  isMuted:        boolean;
}

// ── Detectors ─────────────────────────────────────────────────

function detectLang(text: string): LangCode {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';
  return 'en';
}

function detectEmotion(text: string): EmotionType {
  const t = text.toLowerCase();
  if (/dying|dead|not breathing|unconscious|can't breathe/.test(t)) return 'CRITICAL_PANIC';
  if (/help me|please help|scared|afraid|hurry|panic/.test(t))      return 'PANIC';
  if (/worried|don't know|not sure/.test(t))                        return 'ANXIOUS';
  return 'CALM';
}

function detectType(text: string): EmergencyType {
  const t = text.toLowerCase();
  if (/medical|heart|chest|breath|bleed|unconscious|pain|hurt|injur|ambulance|doctor|stroke|seizure|faint/.test(t)) return 'MEDICAL';
  if (/fire|smoke|burn|flame|blaze|explosion/.test(t))   return 'FIRE';
  if (/shoot|gun|weapon|robbery|assault|knife|crime|stab|murder|thief/.test(t)) return 'CRIME';
  if (/accident|crash|collision|car|vehicle|road|hit|fell|fall/.test(t)) return 'ACCIDENT';
  if (/flood|water|tsunami|earthquake|storm|disaster|cyclone/.test(t)) return 'DISASTER';
  if (/help|sos|emergency/.test(t)) return 'OTHER';
  return null;
}

function mapService(type: EmergencyType): ServiceType {
  switch (type) {
    case 'MEDICAL':  return 'AMBULANCE';
    case 'FIRE':     return 'FIRE';
    case 'CRIME':    return 'POLICE';
    case 'ACCIDENT': return 'AMBULANCE';
    case 'DISASTER': return 'RESCUE';
    default:         return 'RESCUE';
  }
}

function extractLocation(text: string): string | null {
  const m = text.match(/(?:at|near|in|on|from|i(?:'m| am) at)\s+([A-Za-z0-9\s,.-]{4,60})/i);
  return m ? m[1].trim() : null;
}

function calcSeverity(type: EmergencyType, text: string) {
  const t = text.toLowerCase();
  if (/dying|dead|not breathing|unconscious|critical|severe/.test(t)) return 'CRITICAL' as const;
  if (/bleeding|fire|gun|crash|flood|trapped/.test(t))                return 'HIGH'     as const;
  if (/pain|hurt|smoke|threat|accident/.test(t))                      return 'MEDIUM'   as const;
  return type ? 'MEDIUM' as const : 'LOW' as const;
}

// ── Scripts ───────────────────────────────────────────────────

const SC = {
  en: {
    activate:    'Emergency detected. Stay calm. I am here to help you.',
    askType:     'What is the emergency? Medical, Fire, Accident, Crime, or Disaster?',
    askLocation: 'Please tell me your location or a nearby landmark.',
    askService:  'Do you need an ambulance, police, fire team, or rescue?',
    askSafe:     'Are you safe right now?',
    dispatching: (s: string) => `${s} is being dispatched to your location.`,
    enRoute:     (s: string, m: number) => `${s} is on the way. Estimated arrival: ${m} minutes.`,
    arrived:     'Help has arrived. You are safe now.',
    calm:        'Stay calm. You are not alone. ',
    medical:     'Keep the person still. Check breathing. ',
    fire:        'Move outside now. Stay low. ',
    crime:       'Stay hidden. Stay quiet. ',
    accident:    'Do not move. Apply pressure to wounds. ',
    disaster:    'Move to higher ground. ',
    reassure:    'Help is on the way. Stay with me.',
  },
  hi: {
    activate:    'आपातकाल का पता चला। शांत रहें। मैं यहाँ हूँ।',
    askType:     'क्या हुआ? चिकित्सा, आग, दुर्घटना, अपराध, या आपदा?',
    askLocation: 'अपना स्थान बताएं।',
    askService:  'एम्बुलेंस, पुलिस, या बचाव दल चाहिए?',
    askSafe:     'क्या आप सुरक्षित हैं?',
    dispatching: (s: string) => `${s} भेजी जा रही है।`,
    enRoute:     (s: string, m: number) => `${s} रास्ते में है। ${m} मिनट में पहुँचेगी।`,
    arrived:     'मदद आ गई। आप सुरक्षित हैं।',
    calm:        'शांत रहें। आप अकेले नहीं हैं। ',
    medical:     'व्यक्ति को हिलाएं नहीं। सांस जांचें। ',
    fire:        'बाहर निकलें। नीचे झुकें। ',
    crime:       'छुपे रहें। शांत रहें। ',
    accident:    'हिलें नहीं। घाव पर दबाव डालें। ',
    disaster:    'ऊंची जगह जाएं। ',
    reassure:    'मदद आ रही है। मेरे साथ रहें।',
  },
  te: {
    activate:    'అత్యవసర పరిస్థితి. శాంతంగా ఉండండి. నేను ఇక్కడ ఉన్నాను.',
    askType:     'ఏమి జరిగింది? వైద్య, అగ్ని, ప్రమాదం, నేరం, విపత్తు?',
    askLocation: 'మీ స్థానం చెప్పండి.',
    askService:  'అంబులెన్స్, పోలీసు, లేదా రెస్క్యూ కావాలా?',
    askSafe:     'మీరు సురక్షితంగా ఉన్నారా?',
    dispatching: (s: string) => `${s} పంపబడుతోంది.`,
    enRoute:     (s: string, m: number) => `${s} దారిలో ఉంది. ${m} నిమిషాలు.`,
    arrived:     'సహాయం వచ్చింది. మీరు సురక్షితంగా ఉన్నారు.',
    calm:        'శాంతంగా ఉండండి. మీరు ఒంటరిగా లేరు. ',
    medical:     'కదలించవద్దు. శ్వాస తనిఖీ చేయండి. ',
    fire:        'బయటకు వెళ్ళండి. వంగి నడవండి. ',
    crime:       'దాక్కోండి. నిశ్శబ్దంగా ఉండండి. ',
    accident:    'కదలవద్దు. గాయాలపై ఒత్తిడి వేయండి. ',
    disaster:    'ఎత్తైన ప్రదేశానికి వెళ్ళండి. ',
    reassure:    'సహాయం వస్తోంది. నాతో ఉండండి.',
  },
};

const LANG_BCP47: Record<LangCode, string> = { en: 'en-US', hi: 'hi-IN', te: 'te-IN' };

// ── TTS — guaranteed single-fire callback ─────────────────────

function speakText(text: string, lang: LangCode, onDone: () => void): void {
  if (!window.speechSynthesis) { setTimeout(onDone, 200); return; }

  // Cancel any ongoing speech first
  window.speechSynthesis.cancel();

  // Wait for cancel to settle, then speak
  setTimeout(() => {
    const u    = new SpeechSynthesisUtterance(text);
    u.lang     = LANG_BCP47[lang];
    u.rate     = 0.88;
    u.pitch    = 1.0;
    u.volume   = 1.0;

    let fired = false;
    const fire = () => { if (!fired) { fired = true; onDone(); } };

    // Fallback: estimate duration + 800ms buffer
    const fallbackMs = Math.max(2000, text.length * 70 + 800);
    const timer = setTimeout(fire, fallbackMs);

    u.onend   = () => { clearTimeout(timer); setTimeout(fire, 300); };
    u.onerror = () => { clearTimeout(timer); setTimeout(fire, 300); };

    window.speechSynthesis.speak(u);
  }, 150);
}

// ── STT ───────────────────────────────────────────────────────

const SpeechRecognitionCtor: any =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

// ── Hook ──────────────────────────────────────────────────────

export function useAIVoiceAgent() {
  const [state, setState] = useState<AIVoiceAgentState>({
    status: 'idle', dispatchStatus: 'TRIGGERED', messages: [],
    emergencyData: { emergencyType: null, location: null, serviceNeeded: null, severity: null, userStatus: null, language: 'en' },
    currentEmotion: 'CALM', eta: 480, isMuted: false,
  });

  // All logic lives in refs — zero stale closure risk
  const alive    = useRef(false);
  const muted    = useRef(false);
  const recRef   = useRef<any>(null);
  const etaTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const conv = useRef({
    step: 0, lang: 'en' as LangCode,
    type: null as EmergencyType,
    location: null as string | null,
    service: null as ServiceType,
  });

  // ── Tiny state helpers ───────────────────────────────────

  const setStatus   = (s: AgentStatus)    => setState(p => ({ ...p, status: s }));
  const setDispatch = (d: DispatchStatus) => setState(p => ({ ...p, dispatchStatus: d }));
  const pushMsg     = (speaker: 'ai' | 'user', text: string, emotion?: EmotionType) =>
    setState(p => ({ ...p, messages: [...p.messages, { id: uuidv4(), speaker, text, timestamp: new Date().toISOString(), emotion }] }));
  const patchData   = (patch: Partial<EmergencyData>) =>
    setState(p => ({ ...p, emergencyData: { ...p.emergencyData, ...patch } }));

  // ── Kill recognition ─────────────────────────────────────

  const killRec = () => {
    if (recRef.current) {
      try { recRef.current.onresult = null; recRef.current.onerror = null; recRef.current.onend = null; recRef.current.abort(); } catch { /* ignore */ }
      recRef.current = null;
    }
  };

  // ── SPEAK then call onDone ───────────────────────────────

  const say = (text: string, onDone: () => void) => {
    if (!alive.current) return;
    setStatus('speaking');
    pushMsg('ai', text);

    if (muted.current) {
      setTimeout(() => { if (alive.current) onDone(); }, 400);
      return;
    }

    speakText(text, conv.current.lang, () => {
      if (alive.current) onDone();
    });
  };

  // ── LISTEN — starts fresh recognition ───────────────────

  const listen = () => {
    if (!alive.current) return;

    killRec();
    setStatus('listening');

    if (!SpeechRecognitionCtor) return; // no STT — user must type

    const lang = conv.current.lang;
    const rec: any = new SpeechRecognitionCtor();
    rec.lang            = LANG_BCP47[lang];
    rec.continuous      = false;
    rec.interimResults  = false;
    rec.maxAlternatives = 1;

    let handled = false;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      if (handled) return;
      handled = true;
      killRec();
      const text = e.results[0][0].transcript.trim();
      if (text) {
        handleInput(text);
      } else {
        // Empty result — listen again
        setTimeout(() => { if (alive.current) listen(); }, 300);
      }
    };

    rec.onerror = (e: any) => {
      if (handled) return;
      handled = true;
      killRec();
      if (!alive.current) return;

      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        pushMsg('ai', 'Microphone blocked. Please type your response below.');
        setStatus('listening');
        return;
      }
      // network / aborted / no-speech — just re-listen silently
      setTimeout(() => { if (alive.current) listen(); }, 600);
    };

    rec.onend = () => {
      if (handled) return;
      // No result and no error — re-listen
      setTimeout(() => { if (alive.current) listen(); }, 300);
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch {
      setTimeout(() => { if (alive.current) listen(); }, 800);
    }
  };

  // ── Handle user input (voice or typed) ──────────────────

  const handleInput = (text: string) => {
    if (!alive.current) return;
    setStatus('processing');

    const dl = detectLang(text);
    if (dl !== 'en') { conv.current.lang = dl; patchData({ language: dl }); }

    const lang    = conv.current.lang;
    const sc      = SC[lang];
    const emotion = detectEmotion(text);
    pushMsg('user', text, emotion);
    setState(p => ({ ...p, currentEmotion: emotion }));

    const type     = detectType(text);
    const location = extractLocation(text);
    const service  = mapService(type);
    const severity = calcSeverity(type, text);

    if (type     && !conv.current.type)     { conv.current.type = type;         patchData({ emergencyType: type, serviceNeeded: service, severity }); }
    if (location && !conv.current.location) { conv.current.location = location; patchData({ location }); }

    const calm = (emotion === 'PANIC' || emotion === 'CRITICAL_PANIC') ? sc.calm : '';
    const step = conv.current.step;

    if (step === 0) {
      conv.current.step = 1;
      const inst = type === 'MEDICAL' ? sc.medical : type === 'FIRE' ? sc.fire
        : type === 'CRIME' ? sc.crime : type === 'ACCIDENT' ? sc.accident
        : type === 'DISASTER' ? sc.disaster : '';
      setDispatch('COLLECTING_INFO');
      say(calm + inst + sc.askLocation, listen);
    }
    else if (step === 1) {
      conv.current.step = 2;
      say(calm + sc.askService, listen);
    }
    else if (step === 2) {
      conv.current.step = 3;
      const svcLabel = /ambulance/i.test(text) ? 'Ambulance'
        : /police/i.test(text) ? 'Police'
        : /fire/i.test(text)   ? 'Fire team'
        : 'Rescue team';
      conv.current.service = service;
      patchData({ serviceNeeded: service });
      setDispatch('DISPATCHING');
      say(calm + sc.dispatching(svcLabel) + ' ' + sc.askSafe, listen);
    }
    else if (step === 3) {
      conv.current.step = 4;
      patchData({ userStatus: text });
      setDispatch('EN_ROUTE');

      // Start ETA countdown
      setState(p => ({ ...p, eta: 480 }));
      if (etaTimer.current) clearInterval(etaTimer.current);
      etaTimer.current = setInterval(() => {
        setState(p => {
          const next = Math.max(0, p.eta - 1);
          if (next === 0) { clearInterval(etaTimer.current!); setDispatch('ARRIVED'); }
          return { ...p, eta: next };
        });
      }, 1000);

      const mins = Math.ceil(480 / 60);
      say(sc.enRoute(conv.current.service ?? 'Help', mins) + ' ' + sc.reassure, listen);
    }
    else {
      say(sc.reassure, listen);
    }
  };

  // ── Public API ───────────────────────────────────────────

  const startAgent = useCallback((lang: LangCode = 'en') => {
    if (alive.current) return;
    alive.current = true;
    muted.current = false;
    conv.current  = { step: 0, lang, type: null, location: null, service: null };

    setState({
      status: 'activating', dispatchStatus: 'TRIGGERED', messages: [],
      emergencyData: { emergencyType: null, location: null, serviceNeeded: null, severity: null, userStatus: null, language: lang },
      currentEmotion: 'CALM', eta: 480, isMuted: false,
    });

    // Step 1: greet, then ask type
    setTimeout(() => {
      if (!alive.current) return;
      say(SC[lang].activate, () => {
        if (alive.current) say(SC[lang].askType, listen);
      });
    }, 600);
  }, []);

  const stopAgent = useCallback(() => {
    alive.current = false;
    killRec();
    window.speechSynthesis?.cancel();
    if (etaTimer.current) clearInterval(etaTimer.current);
    setState(p => ({ ...p, status: 'ended' }));
  }, []);

  const toggleMute = useCallback(() => {
    muted.current = !muted.current;
    setState(p => ({ ...p, isMuted: muted.current }));
    if (muted.current) window.speechSynthesis?.cancel();
  }, []);

  // submitText — for manual text input fallback
  const submitText = useCallback((text: string) => {
    if (!alive.current || !text.trim()) return;
    killRec();
    handleInput(text.trim());
  }, []);

  useEffect(() => () => {
    alive.current = false;
    killRec();
    window.speechSynthesis?.cancel();
    if (etaTimer.current) clearInterval(etaTimer.current);
  }, []);

  return { state, startAgent, stopAgent, toggleMute, submitText };
}
