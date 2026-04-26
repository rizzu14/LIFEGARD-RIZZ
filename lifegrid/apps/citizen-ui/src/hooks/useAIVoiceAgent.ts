// ============================================================
// LIFEGRID – AI Voice Agent Hook  v2
// Fixed: stale closures, recognition loop, TTS fallback
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

// ── Types ─────────────────────────────────────────────────────

export type AgentStatus =
  | 'idle' | 'activating' | 'speaking' | 'listening' | 'processing' | 'ended';

export type DispatchStatus =
  | 'TRIGGERED' | 'COLLECTING_INFO' | 'DISPATCHING' | 'EN_ROUTE' | 'ARRIVED';

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
  if (/dying|dead|not breathing|unconscious|bleeding badly|can't breathe/.test(t)) return 'CRITICAL_PANIC';
  if (/help me|please help|scared|afraid|hurry|fast|panic/.test(t))                return 'PANIC';
  if (/worried|don't know|what do i|not sure/.test(t))                             return 'ANXIOUS';
  return 'CALM';
}

function detectType(text: string): EmergencyType {
  const t = text.toLowerCase();
  if (/medical|heart|chest|breath|bleed|unconscious|pain|hurt|injur|ambulance|doctor|stroke|seizure|faint|attack/.test(t)) return 'MEDICAL';
  if (/fire|smoke|burn|flame|blaze|explosion/.test(t))   return 'FIRE';
  if (/shoot|gun|weapon|attack|threat|robbery|assault|knife|crime|stab|murder|thief/.test(t)) return 'CRIME';
  if (/accident|crash|collision|car|vehicle|road|hit|fell|fall/.test(t)) return 'ACCIDENT';
  if (/flood|water|tsunami|earthquake|storm|disaster|cyclone|landslide/.test(t)) return 'DISASTER';
  if (/help|sos|emergency/.test(t)) return 'OTHER';
  if (/आग|दुर्घटना|खून|बचाओ|मदद|दर्द/.test(text)) return 'MEDICAL';
  if (/అగ్ని|ప్రమాదం|రక్తం|సహాయం/.test(text)) return 'MEDICAL';
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
  if (/dying|dead|not breathing|unconscious|critical|severe|massive/.test(t)) return 'CRITICAL' as const;
  if (/bleeding|fire|gun|crash|flood|trapped/.test(t))                        return 'HIGH'     as const;
  if (/pain|hurt|smoke|threat|accident/.test(t))                              return 'MEDIUM'   as const;
  return type ? 'MEDIUM' as const : 'LOW' as const;
}

// ── Scripts ───────────────────────────────────────────────────

const SCRIPTS = {
  en: {
    activate:    'Emergency detected. Stay calm. I am here to help you.',
    askType:     'What is the emergency? Medical, Fire, Accident, Crime, or Disaster?',
    askLocation: 'Please tell me your location or a nearby landmark.',
    askService:  'Do you need an ambulance, police, fire team, or rescue?',
    askSafe:     'Are you safe right now?',
    dispatching: (svc: string) => `${svc} is being dispatched to your location now.`,
    enRoute:     (svc: string, eta: number) => `${svc} is on the way. Estimated arrival: ${Math.ceil(eta / 60)} minutes.`,
    arrived:     'Help has arrived. Stay visible. You are safe now.',
    calm:        'Stay calm. You are not alone. ',
    medical:     'Keep the person still. Check if they are breathing. ',
    fire:        'Move outside immediately. Stay low. ',
    crime:       'Stay hidden. Stay quiet. ',
    accident:    'Do not move. Apply pressure to any wounds. ',
    disaster:    'Move to higher ground if possible. ',
    reassure:    'You are not alone. Stay with me. Help is coming.',
    noInput:     'I did not hear you. Please speak clearly.',
  },
  hi: {
    activate:    'आपातकाल का पता चला। शांत रहें। मैं आपकी मदद के लिए यहाँ हूँ।',
    askType:     'क्या हुआ है? चिकित्सा, आग, दुर्घटना, अपराध, या आपदा?',
    askLocation: 'कृपया अपना स्थान या नजदीकी पहचान बताएं।',
    askService:  'क्या आपको एम्बुलेंस, पुलिस, या बचाव दल चाहिए?',
    askSafe:     'क्या आप अभी सुरक्षित हैं?',
    dispatching: (svc: string) => `${svc} आपके स्थान पर भेजी जा रही है।`,
    enRoute:     (svc: string, eta: number) => `${svc} रास्ते में है। अनुमानित समय: ${Math.ceil(eta / 60)} मिनट।`,
    arrived:     'मदद पहुँच गई है। आप अब सुरक्षित हैं।',
    calm:        'शांत रहें। आप अकेले नहीं हैं। ',
    medical:     'व्यक्ति को हिलाएं नहीं। सांस जांचें। ',
    fire:        'तुरंत बाहर निकलें। नीचे झुककर चलें। ',
    crime:       'छुपे रहें। शांत रहें। ',
    accident:    'हिलें नहीं। घाव पर दबाव डालें। ',
    disaster:    'ऊंची जगह पर जाएं। ',
    reassure:    'आप अकेले नहीं हैं। मेरे साथ रहें।',
    noInput:     'मैंने नहीं सुना। कृपया स्पष्ट बोलें।',
  },
  te: {
    activate:    'అత్యవసర పరిస్థితి గుర్తించబడింది. శాంతంగా ఉండండి. నేను మీకు సహాయం చేయడానికి ఇక్కడ ఉన్నాను.',
    askType:     'ఏమి జరిగింది? వైద్య, అగ్ని, ప్రమాదం, నేరం, లేదా విపత్తు?',
    askLocation: 'దయచేసి మీ స్థానం లేదా సమీప గుర్తు చెప్పండి.',
    askService:  'మీకు అంబులెన్స్, పోలీసు, లేదా రెస్క్యూ అవసరమా?',
    askSafe:     'మీరు ఇప్పుడు సురక్షితంగా ఉన్నారా?',
    dispatching: (svc: string) => `${svc} మీ స్థానానికి పంపబడుతోంది.`,
    enRoute:     (svc: string, eta: number) => `${svc} దారిలో ఉంది. అంచనా సమయం: ${Math.ceil(eta / 60)} నిమిషాలు.`,
    arrived:     'సహాయం వచ్చింది. మీరు ఇప్పుడు సురక్షితంగా ఉన్నారు.',
    calm:        'శాంతంగా ఉండండి. మీరు ఒంటరిగా లేరు. ',
    medical:     'వ్యక్తిని కదలించవద్దు. శ్వాస తనిఖీ చేయండి. ',
    fire:        'వెంటనే బయటకు వెళ్ళండి. వంగి నడవండి. ',
    crime:       'దాక్కోండి. నిశ్శబ్దంగా ఉండండి. ',
    accident:    'కదలవద్దు. గాయాలపై ఒత్తిడి వేయండి. ',
    disaster:    'ఎత్తైన ప్రదేశానికి వెళ్ళండి. ',
    reassure:    'మీరు ఒంటరిగా లేరు. నాతో ఉండండి.',
    noInput:     'నేను వినలేదు. దయచేసి స్పష్టంగా మాట్లాడండి.',
  },
};

// ── TTS with guaranteed callback ──────────────────────────────

const LANG_BCP47: Record<LangCode, string> = { en: 'en-US', hi: 'hi-IN', te: 'te-IN' };

function tts(text: string, lang: LangCode, onEnd: () => void): void {
  if (!window.speechSynthesis) { setTimeout(onEnd, 100); return; }

  window.speechSynthesis.cancel();

  // Small delay so cancel() settles
  setTimeout(() => {
    const u    = new SpeechSynthesisUtterance(text);
    u.lang     = LANG_BCP47[lang];
    u.rate     = 0.90;
    u.pitch    = 1.0;
    u.volume   = 1.0;

    // Guaranteed fallback — Chrome sometimes drops onend
    const estimatedMs = Math.max(1500, text.length * 65);
    const fallback    = setTimeout(onEnd, estimatedMs);

    u.onend = () => { clearTimeout(fallback); onEnd(); };
    u.onerror = () => { clearTimeout(fallback); onEnd(); };

    window.speechSynthesis.speak(u);
  }, 120);
}

// ── STT ───────────────────────────────────────────────────────

const SpeechRecognitionAPI: any =
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

  // All mutable state in refs to avoid stale closures
  const activeRef   = useRef(false);
  const mutedRef    = useRef(false);
  const recRef      = useRef<any>(null);
  const etaRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusRef   = useRef<AgentStatus>('idle');

  const convRef = useRef({
    step: 0, lang: 'en' as LangCode,
    type: null as EmergencyType, location: null as string | null,
    service: null as ServiceType, userStatus: null as string | null,
  });

  // ── State setters (use refs to avoid stale reads) ────────

  const setAgentStatus = (s: AgentStatus) => {
    statusRef.current = s;
    setState(prev => ({ ...prev, status: s }));
  };

  const setDispatch = (d: DispatchStatus) =>
    setState(prev => ({ ...prev, dispatchStatus: d }));

  const addMsg = (speaker: 'ai' | 'user', text: string, emotion?: EmotionType) =>
    setState(prev => ({
      ...prev,
      messages: [...prev.messages, { id: uuidv4(), speaker, text, timestamp: new Date().toISOString(), emotion }],
    }));

  const patchData = (patch: Partial<EmergencyData>) =>
    setState(prev => ({ ...prev, emergencyData: { ...prev.emergencyData, ...patch } }));

  // ── Stop recognition safely ──────────────────────────────

  const stopRec = () => {
    if (recRef.current) {
      try { recRef.current.abort(); } catch { /* ignore */ }
      recRef.current = null;
    }
  };

  // ── Core: speak then listen ──────────────────────────────
  // Uses plain functions (not useCallback) so they always read fresh refs

  function listen(lang: LangCode) {
    if (!activeRef.current) return;

    stopRec();
    setAgentStatus('listening');

    if (!SpeechRecognitionAPI) {
      // No STT support — show manual input fallback
      return;
    }

    const rec: any = new SpeechRecognitionAPI();
    rec.lang            = LANG_BCP47[lang];
    rec.continuous      = false;
    rec.interimResults  = true;   // show interim so user sees feedback
    rec.maxAlternatives = 1;

    let gotResult = false;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const result = e.results[e.results.length - 1];
      if (result.isFinal) {
        gotResult = true;
        const transcript = result[0].transcript.trim();
        if (transcript) {
          handleUserInput(transcript);
        } else {
          // Empty final — re-listen
          setTimeout(() => { if (activeRef.current) listen(lang); }, 500);
        }
      }
    };

    rec.onerror = (e: any) => {
      console.warn('STT error:', e.error);
      if (!activeRef.current) return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        // Mic permission denied — show message
        addMsg('ai', 'Microphone access denied. Please type your response or allow mic access.');
        setAgentStatus('listening');
        return;
      }
      // Other errors — retry after short delay
      setTimeout(() => { if (activeRef.current) listen(lang); }, 1200);
    };

    rec.onend = () => {
      if (!activeRef.current) return;
      if (!gotResult) {
        // Nothing heard — re-listen immediately (no re-ask, just keep listening)
        setTimeout(() => { if (activeRef.current) listen(lang); }, 400);
      }
    };

    recRef.current = rec;
    try {
      rec.start();
    } catch (err) {
      console.warn('STT start error:', err);
      setTimeout(() => { if (activeRef.current) listen(lang); }, 800);
    }
  }

  function say(text: string, lang: LangCode, then?: () => void) {
    if (!activeRef.current) return;
    setAgentStatus('speaking');
    addMsg('ai', text);

    if (mutedRef.current) {
      setTimeout(() => { if (activeRef.current) then?.(); }, 300);
      return;
    }

    tts(text, lang, () => {
      if (!activeRef.current) return;
      setTimeout(() => { if (activeRef.current) then?.(); }, 300);
    });
  }

  // ── Conversation steps ───────────────────────────────────

  function askStep() {
    if (!activeRef.current) return;
    const lang = convRef.current.lang;
    const sc   = SCRIPTS[lang];
    const step = convRef.current.step;

    if      (step === 0) say(sc.askType,     lang, () => listen(lang));
    else if (step === 1) say(sc.askLocation, lang, () => listen(lang));
    else if (step === 2) say(sc.askService,  lang, () => listen(lang));
    else if (step === 3) say(sc.askSafe,     lang, () => listen(lang));
    else                 say(sc.reassure,    lang, () => listen(lang));
  }

  function handleUserInput(text: string) {
    if (!activeRef.current) return;
    setAgentStatus('processing');

    const detectedLang = detectLang(text);
    if (detectedLang !== 'en') {
      convRef.current.lang = detectedLang;
      patchData({ language: detectedLang });
    }

    const lang    = convRef.current.lang;
    const sc      = SCRIPTS[lang];
    const emotion = detectEmotion(text);
    addMsg('user', text, emotion);
    setState(prev => ({ ...prev, currentEmotion: emotion }));

    const type     = detectType(text);
    const location = extractLocation(text);
    const service  = mapService(type);
    const severity = calcSeverity(type, text);

    if (type     && !convRef.current.type)     { convRef.current.type = type;         patchData({ emergencyType: type, serviceNeeded: service, severity }); }
    if (location && !convRef.current.location) { convRef.current.location = location; patchData({ location }); }

    const calm = (emotion === 'PANIC' || emotion === 'CRITICAL_PANIC') ? sc.calm : '';
    const step = convRef.current.step;

    if (step === 0) {
      convRef.current.step = 1;
      const inst = type === 'MEDICAL' ? sc.medical : type === 'FIRE' ? sc.fire
        : type === 'CRIME' ? sc.crime : type === 'ACCIDENT' ? sc.accident
        : type === 'DISASTER' ? sc.disaster : '';
      setDispatch('COLLECTING_INFO');
      say(calm + inst + sc.askLocation, lang, () => listen(lang));
    }
    else if (step === 1) {
      convRef.current.step = 2;
      say(calm + sc.askService, lang, () => listen(lang));
    }
    else if (step === 2) {
      convRef.current.step = 3;
      const svcLabel = text.toLowerCase().includes('ambulance') ? 'Ambulance'
        : text.toLowerCase().includes('police') ? 'Police'
        : text.toLowerCase().includes('fire')   ? 'Fire team'
        : 'Rescue team';
      convRef.current.service = service;
      patchData({ serviceNeeded: service });
      setDispatch('DISPATCHING');
      say(calm + sc.dispatching(svcLabel) + ' ' + sc.askSafe, lang, () => listen(lang));
    }
    else if (step === 3) {
      convRef.current.step = 4;
      convRef.current.userStatus = text;
      patchData({ userStatus: text });
      setDispatch('EN_ROUTE');

      // Start ETA countdown
      const etaStart = 480;
      setState(prev => ({ ...prev, eta: etaStart }));
      if (etaRef.current) clearInterval(etaRef.current);
      etaRef.current = setInterval(() => {
        setState(prev => {
          const next = Math.max(0, prev.eta - 1);
          if (next === 0) { clearInterval(etaRef.current!); setDispatch('ARRIVED'); }
          return { ...prev, eta: next };
        });
      }, 1000);

      say(sc.enRoute(convRef.current.service ?? 'Help', etaStart) + ' ' + sc.reassure, lang, () => listen(lang));
    }
    else {
      // Keep listening for any follow-up
      say(sc.reassure, lang, () => listen(lang));
    }
  }

  // ── Public: start ────────────────────────────────────────

  const startAgent = useCallback((userLang: LangCode = 'en') => {
    if (activeRef.current) return;
    activeRef.current = true;
    mutedRef.current  = false;
    convRef.current   = { step: 0, lang: userLang, type: null, location: null, service: null, userStatus: null };

    setState({
      status: 'activating', dispatchStatus: 'TRIGGERED', messages: [],
      emergencyData: { emergencyType: null, location: null, serviceNeeded: null, severity: null, userStatus: null, language: userLang },
      currentEmotion: 'CALM', eta: 480, isMuted: false,
    });

    const sc = SCRIPTS[userLang];
    setTimeout(() => {
      if (!activeRef.current) return;
      say(sc.activate, userLang, () => {
        setTimeout(() => { if (activeRef.current) askStep(); }, 200);
      });
    }, 500);
  }, []);

  // ── Public: stop ─────────────────────────────────────────

  const stopAgent = useCallback(() => {
    activeRef.current = false;
    stopRec();
    window.speechSynthesis?.cancel();
    if (etaRef.current) clearInterval(etaRef.current);
    setState(prev => ({ ...prev, status: 'ended' }));
  }, []);

  // ── Public: toggle mute ──────────────────────────────────

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setState(prev => ({ ...prev, isMuted: mutedRef.current }));
    if (mutedRef.current) window.speechSynthesis?.cancel();
  }, []);

  // ── Public: manual text input (fallback) ─────────────────

  const submitText = useCallback((text: string) => {
    if (!activeRef.current || !text.trim()) return;
    stopRec();
    handleUserInput(text.trim());
  }, []);

  // Cleanup
  useEffect(() => () => {
    activeRef.current = false;
    stopRec();
    window.speechSynthesis?.cancel();
    if (etaRef.current) clearInterval(etaRef.current);
  }, []);

  return { state, startAgent, stopAgent, toggleMute, submitText };
}
