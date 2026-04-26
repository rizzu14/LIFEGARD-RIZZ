// ============================================================
// LIFEGRID – AI Voice Agent Hook
// Full real-time voice conversation loop:
//   SpeechRecognition → AI Engine → SpeechSynthesis → repeat
//
// Follows exact operator protocol:
//   TRIGGERED → COLLECTING_INFO → DISPATCHING → EN_ROUTE → ARRIVED
// ============================================================

import { useRef, useState, useCallback, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

// ── Types ─────────────────────────────────────────────────────

export type AgentStatus =
  | 'idle'
  | 'activating'
  | 'speaking'
  | 'listening'
  | 'processing'
  | 'ended';

export type DispatchStatus =
  | 'TRIGGERED'
  | 'COLLECTING_INFO'
  | 'DISPATCHING'
  | 'EN_ROUTE'
  | 'ARRIVED';

export type EmotionType = 'CALM' | 'ANXIOUS' | 'PANIC' | 'CRITICAL_PANIC';
export type EmergencyType = 'MEDICAL' | 'FIRE' | 'CRIME' | 'ACCIDENT' | 'DISASTER' | 'OTHER' | null;
export type ServiceType = 'AMBULANCE' | 'POLICE' | 'FIRE' | 'DOCTOR' | 'RESCUE' | 'NGO' | null;
export type LangCode = 'en' | 'hi' | 'te';

export interface EmergencyData {
  emergencyType: EmergencyType;
  location:      string | null;
  serviceNeeded: ServiceType;
  severity:      'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  userStatus:    string | null;
  language:      LangCode;
}

export interface AgentMessage {
  id:        string;
  speaker:   'ai' | 'user';
  text:      string;
  timestamp: string;
  emotion?:  EmotionType;
}

export interface AIVoiceAgentState {
  status:         AgentStatus;
  dispatchStatus: DispatchStatus;
  messages:       AgentMessage[];
  emergencyData:  EmergencyData;
  currentEmotion: EmotionType;
  eta:            number;          // seconds
  isMuted:        boolean;
}

// ── Language detection ────────────────────────────────────────

function detectLang(text: string): LangCode {
  if (/[\u0900-\u097F]/.test(text)) return 'hi';   // Hindi
  if (/[\u0C00-\u0C7F]/.test(text)) return 'te';   // Telugu
  return 'en';
}

// ── Emotion detection ─────────────────────────────────────────

function detectEmotion(text: string): EmotionType {
  const t = text.toLowerCase();
  if (/dying|dead|not breathing|unconscious|bleeding badly|can't breathe/.test(t)) return 'CRITICAL_PANIC';
  if (/help me|please help|scared|afraid|hurry|fast|quick|panic/.test(t))          return 'PANIC';
  if (/worried|don't know|what do i|not sure/.test(t))                             return 'ANXIOUS';
  return 'CALM';
}

// ── Emergency type detection ──────────────────────────────────

function detectType(text: string): EmergencyType {
  const t = text.toLowerCase();
  if (/medical|heart|chest|breath|bleed|unconscious|pain|hurt|injur|ambulance|doctor|stroke|seizure|faint|attack/.test(t)) return 'MEDICAL';
  if (/fire|smoke|burn|flame|blaze|explosion/.test(t))                                                                      return 'FIRE';
  if (/shoot|gun|weapon|attack|threat|robbery|assault|knife|crime|stab|murder|thief/.test(t))                               return 'CRIME';
  if (/accident|crash|collision|car|vehicle|road|hit|fell|fall/.test(t))                                                    return 'ACCIDENT';
  if (/flood|water|tsunami|earthquake|storm|disaster|cyclone|landslide/.test(t))                                            return 'DISASTER';
  // Hindi
  if (/आग|दुर्घटना|खून|बचाओ|मदद|दर्द/.test(text)) return 'MEDICAL';
  // Telugu
  if (/అగ్ని|ప్రమాదం|రక్తం|సహాయం/.test(text)) return 'MEDICAL';
  return null;
}

// ── Service mapper ────────────────────────────────────────────

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

// ── Location extractor ────────────────────────────────────────

function extractLocation(text: string): string | null {
  const m = text.match(
    /(?:at|near|in|on|from|i(?:'m| am) at)\s+([A-Za-z0-9\s,.-]{4,60})/i
  );
  return m ? m[1].trim() : null;
}

// ── Severity ──────────────────────────────────────────────────

function calcSeverity(type: EmergencyType, text: string) {
  const t = text.toLowerCase();
  if (/dying|dead|not breathing|unconscious|critical|severe|massive/.test(t)) return 'CRITICAL' as const;
  if (/bleeding|fire|gun|crash|flood|trapped/.test(t))                        return 'HIGH'     as const;
  if (/pain|hurt|smoke|threat|accident/.test(t))                              return 'MEDIUM'   as const;
  if (type) return 'MEDIUM' as const;
  return 'LOW' as const;
}

// ── Multilingual script ───────────────────────────────────────

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
    calm:        'Stay calm. You are not alone. Help is on the way.',
    medical:     'Keep the person still. Check if they are breathing. Do not give food or water.',
    fire:        'Move outside immediately. Stay low. Do not use elevators.',
    crime:       'Stay hidden. Stay quiet. Do not confront anyone.',
    accident:    'Do not move. Stay still. Apply pressure to any wounds.',
    disaster:    'Move to higher ground if possible. Stay away from water.',
    reassure:    'You are not alone. Stay with me. Help is coming.',
  },
  hi: {
    activate:    'आपातकाल का पता चला। शांत रहें। मैं आपकी मदद के लिए यहाँ हूँ।',
    askType:     'क्या हुआ है? चिकित्सा, आग, दुर्घटना, अपराध, या आपदा?',
    askLocation: 'कृपया अपना स्थान या नजदीकी पहचान बताएं।',
    askService:  'क्या आपको एम्बुलेंस, पुलिस, या बचाव दल चाहिए?',
    askSafe:     'क्या आप अभी सुरक्षित हैं?',
    dispatching: (svc: string) => `${svc} आपके स्थान पर भेजी जा रही है।`,
    enRoute:     (svc: string, eta: number) => `${svc} रास्ते में है। अनुमानित समय: ${Math.ceil(eta / 60)} मिनट।`,
    arrived:     'मदद पहुँच गई है। दिखाई दें। आप अब सुरक्षित हैं।',
    calm:        'शांत रहें। आप अकेले नहीं हैं। मदद आ रही है।',
    medical:     'व्यक्ति को हिलाएं नहीं। सांस जांचें। खाना-पानी न दें।',
    fire:        'तुरंत बाहर निकलें। नीचे झुककर चलें। लिफ्ट का उपयोग न करें।',
    crime:       'छुपे रहें। शांत रहें। किसी से न उलझें।',
    accident:    'हिलें नहीं। घाव पर दबाव डालें।',
    disaster:    'ऊंची जगह पर जाएं। पानी से दूर रहें।',
    reassure:    'आप अकेले नहीं हैं। मेरे साथ रहें। मदद आ रही है।',
  },
  te: {
    activate:    'అత్యవసర పరిస్థితి గుర్తించబడింది. శాంతంగా ఉండండి. నేను మీకు సహాయం చేయడానికి ఇక్కడ ఉన్నాను.',
    askType:     'ఏమి జరిగింది? వైద్య, అగ్ని, ప్రమాదం, నేరం, లేదా విపత్తు?',
    askLocation: 'దయచేసి మీ స్థానం లేదా సమీప గుర్తు చెప్పండి.',
    askService:  'మీకు అంబులెన్స్, పోలీసు, లేదా రెస్క్యూ అవసరమా?',
    askSafe:     'మీరు ఇప్పుడు సురక్షితంగా ఉన్నారా?',
    dispatching: (svc: string) => `${svc} మీ స్థానానికి పంపబడుతోంది.`,
    enRoute:     (svc: string, eta: number) => `${svc} దారిలో ఉంది. అంచనా సమయం: ${Math.ceil(eta / 60)} నిమిషాలు.`,
    arrived:     'సహాయం వచ్చింది. కనిపించండి. మీరు ఇప్పుడు సురక్షితంగా ఉన్నారు.',
    calm:        'శాంతంగా ఉండండి. మీరు ఒంటరిగా లేరు. సహాయం వస్తోంది.',
    medical:     'వ్యక్తిని కదలించవద్దు. శ్వాస తనిఖీ చేయండి. ఆహారం ఇవ్వవద్దు.',
    fire:        'వెంటనే బయటకు వెళ్ళండి. వంగి నడవండి. లిఫ్ట్ వాడవద్దు.',
    crime:       'దాక్కోండి. నిశ్శబ్దంగా ఉండండి. ఎవరినీ ఎదుర్కోవద్దు.',
    accident:    'కదలవద్దు. గాయాలపై ఒత్తిడి వేయండి.',
    disaster:    'ఎత్తైన ప్రదేశానికి వెళ్ళండి. నీటికి దూరంగా ఉండండి.',
    reassure:    'మీరు ఒంటరిగా లేరు. నాతో ఉండండి. సహాయం వస్తోంది.',
  },
};

// ── TTS ───────────────────────────────────────────────────────

const LANG_BCP47: Record<LangCode, string> = {
  en: 'en-US',
  hi: 'hi-IN',
  te: 'te-IN',
};

function tts(text: string, lang: LangCode, onEnd?: () => void): void {
  if (!window.speechSynthesis) { onEnd?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang  = LANG_BCP47[lang];
  u.rate  = 0.92;
  u.pitch = 1.0;
  u.volume = 1.0;
  if (onEnd) u.onend = onEnd;
  window.speechSynthesis.speak(u);
}

// ── STT ───────────────────────────────────────────────────────

const SpeechRecognitionAPI =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null;

// ── Hook ──────────────────────────────────────────────────────

export function useAIVoiceAgent() {
  const [state, setState] = useState<AIVoiceAgentState>({
    status:         'idle',
    dispatchStatus: 'TRIGGERED',
    messages:       [],
    emergencyData: {
      emergencyType: null,
      location:      null,
      serviceNeeded: null,
      severity:      null,
      userStatus:    null,
      language:      'en',
    },
    currentEmotion: 'CALM',
    eta:            480,
    isMuted:        false,
  });

  const recRef      = useRef<any>(null);
  const activeRef   = useRef(false);
  const convRef     = useRef({
    step:          0,   // 0=type 1=location 2=service 3=safe 4=done
    lang:          'en' as LangCode,
    type:          null as EmergencyType,
    location:      null as string | null,
    service:       null as ServiceType,
    userStatus:    null as string | null,
  });
  const etaRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const mutedRef    = useRef(false);

  // ── Helpers ─────────────────────────────────────────────

  const addMsg = useCallback((speaker: 'ai' | 'user', text: string, emotion?: EmotionType) => {
    setState(s => ({
      ...s,
      messages: [...s.messages, { id: uuidv4(), speaker, text, timestamp: new Date().toISOString(), emotion }],
    }));
  }, []);

  const setStatus = useCallback((status: AgentStatus) => {
    setState(s => ({ ...s, status }));
  }, []);

  const setDispatch = useCallback((dispatchStatus: DispatchStatus) => {
    setState(s => ({ ...s, dispatchStatus }));
  }, []);

  const updateData = useCallback((patch: Partial<EmergencyData>) => {
    setState(s => ({ ...s, emergencyData: { ...s.emergencyData, ...patch } }));
  }, []);

  // ── Speak + then listen ──────────────────────────────────

  const speakThenListen = useCallback((text: string, lang: LangCode) => {
    if (!activeRef.current) return;
    setStatus('speaking');
    addMsg('ai', text);

    if (mutedRef.current) {
      // Muted — skip TTS, go straight to listening
      setTimeout(() => startListening(lang), 300);
      return;
    }

    tts(text, lang, () => {
      if (!activeRef.current) return;
      setTimeout(() => startListening(lang), 400);
    });
  }, []);

  // ── Start listening ──────────────────────────────────────

  const startListening = useCallback((lang: LangCode) => {
    if (!activeRef.current || !SpeechRecognitionAPI) {
      setStatus('processing');
      return;
    }
    setStatus('listening');

    if (recRef.current) {
      try { recRef.current.stop(); } catch { /* ignore */ }
    }

    const rec = new SpeechRecognitionAPI();
    rec.lang           = LANG_BCP47[lang];
    rec.continuous     = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript;
      if (transcript.trim()) processUserInput(transcript);
    };

    rec.onerror = () => {
      // On error, re-ask the same question
      if (activeRef.current) {
        setTimeout(() => askCurrentStep(), 1000);
      }
    };

    rec.onend = () => {
      if (activeRef.current && state.status === 'listening') {
        // Silence — re-ask
        setTimeout(() => askCurrentStep(), 800);
      }
    };

    recRef.current = rec;
    try { rec.start(); } catch { /* already started */ }
  }, [state.status]);

  // ── Ask current step ─────────────────────────────────────

  const askCurrentStep = useCallback(() => {
    if (!activeRef.current) return;
    const lang = convRef.current.lang;
    const s    = SCRIPTS[lang];
    const step = convRef.current.step;

    if (step === 0) speakThenListen(s.askType, lang);
    else if (step === 1) speakThenListen(s.askLocation, lang);
    else if (step === 2) speakThenListen(s.askService, lang);
    else if (step === 3) speakThenListen(s.askSafe, lang);
  }, [speakThenListen]);

  // ── Process user input ───────────────────────────────────

  const processUserInput = useCallback((text: string) => {
    if (!activeRef.current) return;
    setStatus('processing');

    // Detect language from first real input
    const detectedLang = detectLang(text);
    if (convRef.current.step === 0 || detectedLang !== 'en') {
      convRef.current.lang = detectedLang;
      updateData({ language: detectedLang });
    }

    const lang    = convRef.current.lang;
    const s       = SCRIPTS[lang];
    const emotion = detectEmotion(text);
    addMsg('user', text, emotion);
    setState(prev => ({ ...prev, currentEmotion: emotion }));

    // Extract data
    const type     = detectType(text);
    const location = extractLocation(text);
    const service  = mapService(type);
    const severity = calcSeverity(type, text);

    if (type     && !convRef.current.type)     { convRef.current.type = type;         updateData({ emergencyType: type, serviceNeeded: service, severity }); }
    if (location && !convRef.current.location) { convRef.current.location = location; updateData({ location }); }

    // Emotional reassurance first if panicking
    const reassure = (emotion === 'PANIC' || emotion === 'CRITICAL_PANIC') ? s.calm + ' ' : '';

    // Advance step
    const step = convRef.current.step;

    if (step === 0) {
      // Got emergency type
      convRef.current.step = 1;
      const instruction = type === 'MEDICAL' ? s.medical
        : type === 'FIRE'     ? s.fire
        : type === 'CRIME'    ? s.crime
        : type === 'ACCIDENT' ? s.accident
        : type === 'DISASTER' ? s.disaster
        : '';
      const reply = reassure + (instruction ? instruction + ' ' : '') + s.askLocation;
      setDispatch('COLLECTING_INFO');
      speakThenListen(reply, lang);
    }
    else if (step === 1) {
      // Got location
      convRef.current.step = 2;
      speakThenListen(reassure + s.askService, lang);
    }
    else if (step === 2) {
      // Got service
      convRef.current.step = 3;
      const svcText = text.toLowerCase().includes('ambulance') ? 'Ambulance'
        : text.toLowerCase().includes('police') ? 'Police'
        : text.toLowerCase().includes('fire')   ? 'Fire team'
        : 'Rescue team';
      convRef.current.service = service;
      updateData({ serviceNeeded: service });
      setDispatch('DISPATCHING');
      speakThenListen(reassure + s.dispatching(svcText) + ' ' + s.askSafe, lang);
    }
    else if (step === 3) {
      // Got safety status
      convRef.current.step = 4;
      convRef.current.userStatus = text;
      updateData({ userStatus: text });
      setDispatch('EN_ROUTE');

      // Start ETA countdown
      const etaSeconds = 480;
      setState(s => ({ ...s, eta: etaSeconds }));
      if (etaRef.current) clearInterval(etaRef.current);
      etaRef.current = setInterval(() => {
        setState(prev => {
          const next = Math.max(0, prev.eta - 1);
          if (next === 0) {
            clearInterval(etaRef.current!);
            setDispatch('ARRIVED');
          }
          return { ...prev, eta: next };
        });
      }, 1000);

      const svcLabel = convRef.current.service ?? 'Help';
      const reply = s.enRoute(svcLabel, etaSeconds) + ' ' + s.reassure;
      speakThenListen(reply, lang);
    }
    else {
      // Conversation complete — keep reassuring
      setStatus('listening');
      const reply = s.reassure;
      speakThenListen(reply, lang);
    }
  }, [addMsg, updateData, setDispatch, speakThenListen]);

  // ── Start agent ──────────────────────────────────────────

  const startAgent = useCallback((userLang = 'en' as LangCode) => {
    if (activeRef.current) return;
    activeRef.current = true;
    convRef.current = { step: 0, lang: userLang, type: null, location: null, service: null, userStatus: null };

    setState({
      status:         'activating',
      dispatchStatus: 'TRIGGERED',
      messages:       [],
      emergencyData:  { emergencyType: null, location: null, serviceNeeded: null, severity: null, userStatus: null, language: userLang },
      currentEmotion: 'CALM',
      eta:            480,
      isMuted:        false,
    });

    const s = SCRIPTS[userLang];
    setTimeout(() => {
      if (!activeRef.current) return;
      setStatus('speaking');
      addMsg('ai', s.activate);
      tts(s.activate, userLang, () => {
        if (!activeRef.current) return;
        setTimeout(() => speakThenListen(s.askType, userLang), 400);
      });
    }, 600);
  }, [addMsg, speakThenListen]);

  // ── Stop agent ───────────────────────────────────────────

  const stopAgent = useCallback(() => {
    activeRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    window.speechSynthesis?.cancel();
    if (etaRef.current) clearInterval(etaRef.current);
    setState(s => ({ ...s, status: 'ended' }));
  }, []);

  // ── Toggle mute ──────────────────────────────────────────

  const toggleMute = useCallback(() => {
    mutedRef.current = !mutedRef.current;
    setState(s => ({ ...s, isMuted: mutedRef.current }));
    if (mutedRef.current) window.speechSynthesis?.cancel();
  }, []);

  // Cleanup
  useEffect(() => () => {
    activeRef.current = false;
    try { recRef.current?.stop(); } catch { /* ignore */ }
    window.speechSynthesis?.cancel();
    if (etaRef.current) clearInterval(etaRef.current);
  }, []);

  return { state, startAgent, stopAgent, toggleMute };
}
