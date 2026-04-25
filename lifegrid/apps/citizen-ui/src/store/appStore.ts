// ============================================================
// LIFEGRID – Unified App Store
// Single source of truth for all citizen UI state
// ============================================================

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// ── Types ─────────────────────────────────────────────────────

export type AppTab = 'home' | 'track' | 'chat' | 'report' | 'alerts';

export type SOSState =
  | 'idle'
  | 'holding'
  | 'confirming'
  | 'submitting'
  | 'active'
  | 'resolved';

// ── Call system types ─────────────────────────────────────────

export type CallState =
  | 'idle'
  | 'initiating'    // SOS triggered, setting up WebRTC
  | 'ringing'       // Connecting to operator
  | 'connected'     // Live call active
  | 'on_hold'       // Operator placed on hold
  | 'failed'        // Connection failed
  | 'ended';        // Call ended

export type CallFallbackMode = 'webrtc' | 'voip_retry' | 'alternate_number' | 'text_only';

export interface CallSession {
  sessionId:       string;
  incidentId:      string;
  state:           CallState;
  operatorId?:     string;
  operatorName?:   string;
  operatorAvatar?: string;
  startedAt?:      string;
  connectedAt?:    string;
  endedAt?:        string;
  durationSeconds: number;
  isMuted:         boolean;
  isSpeaker:       boolean;
  signalStrength:  number;   // 0–4 bars
  fallbackMode:    CallFallbackMode;
  retryCount:      number;
  liveTranscript:  TranscriptLine[];
  aiKeywords:      DetectedKeyword[];
  aiSuggestions:   string[];
}

export interface TranscriptLine {
  id:        string;
  speaker:   'citizen' | 'operator' | 'ai';
  text:      string;
  timestamp: string;
  isFinal:   boolean;
  language:  string;
}

export interface DetectedKeyword {
  keyword:       string;
  category:      string;   // 'medical' | 'fire' | 'security' etc.
  confidence:    number;
  detectedAt:    string;
  actionTaken?:  string;
}

export interface ResponderPosition {
  responderId: string;
  type: string;
  lat: number;
  lng: number;
  etaSeconds: number;
  status: string;
  timestamp: string;
}

export interface ChatMessage {
  id: string;
  role: 'system' | 'operator' | 'user' | 'ai';
  content: string;
  timestamp: string;
  audioUrl?: string;
  isRead: boolean;
  language: string;
}

export interface SafetyAlert {
  id: string;
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  location?: string;
  timestamp: string;
  isRead: boolean;
  source: 'FLOOD' | 'WEATHER' | 'SECURITY' | 'SYSTEM' | 'SENSOR';
  actions?: string[];
}

export interface OfflineQueueItem {
  id: string;
  type: 'SOS' | 'REPORT' | 'LOCATION';
  payload: Record<string, unknown>;
  timestamp: string;
  retries: number;
}

interface AppState {
  // Navigation
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;

  // SOS
  sosState: SOSState;
  sosHoldProgress: number;       // 0–100 during hold
  activeIncidentId: string | null;
  activeReferenceCode: string | null;
  setSosState: (state: SOSState) => void;
  setSosHoldProgress: (p: number) => void;
  setActiveIncident: (id: string, code: string) => void;
  clearActiveIncident: () => void;

  // Responders
  responderPositions: ResponderPosition[];
  updateResponderPosition: (pos: ResponderPosition) => void;

  // Chat / guidance
  chatMessages: ChatMessage[];
  activeSessionId: string | null;
  isChatTyping: boolean;
  isVoiceActive: boolean;
  addChatMessage: (msg: ChatMessage) => void;
  setActiveSession: (id: string | null) => void;
  setChatTyping: (v: boolean) => void;
  setVoiceActive: (v: boolean) => void;
  markMessagesRead: () => void;

  // Safety alerts
  safetyAlerts: SafetyAlert[];
  unreadAlertCount: number;
  addAlert: (alert: SafetyAlert) => void;
  markAlertRead: (id: string) => void;
  markAllAlertsRead: () => void;

  // Offline
  isOnline: boolean;
  offlineQueue: OfflineQueueItem[];
  setOnline: (v: boolean) => void;
  enqueueOffline: (item: OfflineQueueItem) => void;
  dequeueOffline: (id: string) => void;

  // Language
  language: string;
  setLanguage: (lang: string) => void;

  // Location
  userLocation: { lat: number; lng: number; accuracy: number } | null;
  setUserLocation: (loc: { lat: number; lng: number; accuracy: number } | null) => void;

  // Incident history
  reportedIncidents: string[];

  // ── Call system ──────────────────────────────────────────
  callSession: CallSession | null;
  isCallOverlayVisible: boolean;
  initiateCall: (incidentId: string) => void;
  updateCallState: (state: CallState) => void;
  updateCallSession: (updates: Partial<CallSession>) => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  addTranscriptLine: (line: TranscriptLine) => void;
  addDetectedKeyword: (kw: DetectedKeyword) => void;
  addAISuggestion: (suggestion: string) => void;
  setCallOverlayVisible: (v: boolean) => void;
  updateSignalStrength: (bars: number) => void;
}

export const useAppStore = create<AppState>()(
  subscribeWithSelector(
    persist(
      immer((set, get) => ({
        // ── Navigation ──────────────────────────────────────
        activeTab: 'home',
        setActiveTab: (tab) => set((s) => { s.activeTab = tab; }),

        // ── SOS ─────────────────────────────────────────────
        sosState: 'idle',
        sosHoldProgress: 0,
        activeIncidentId: null,
        activeReferenceCode: null,

        setSosState: (state) => set((s) => { s.sosState = state; }),
        setSosHoldProgress: (p) => set((s) => { s.sosHoldProgress = p; }),

        setActiveIncident: (id, code) => set((s) => {
          s.activeIncidentId = id;
          s.activeReferenceCode = code;
          s.sosState = 'active';
          if (!s.reportedIncidents.includes(id)) {
            s.reportedIncidents.push(id);
          }
        }),

        clearActiveIncident: () => set((s) => {
          s.activeIncidentId = null;
          s.activeReferenceCode = null;
          s.sosState = 'idle';
          s.sosHoldProgress = 0;
          s.responderPositions = [];
        }),

        // ── Responders ──────────────────────────────────────
        responderPositions: [],
        updateResponderPosition: (pos) => set((s) => {
          const idx = s.responderPositions.findIndex(r => r.responderId === pos.responderId);
          if (idx >= 0) {
            s.responderPositions[idx] = pos;
          } else {
            s.responderPositions.push(pos);
          }
        }),

        // ── Chat ─────────────────────────────────────────────
        chatMessages: [],
        activeSessionId: null,
        isChatTyping: false,
        isVoiceActive: false,

        addChatMessage: (msg) => set((s) => {
          s.chatMessages.push(msg);
          // Keep last 100 messages
          if (s.chatMessages.length > 100) {
            s.chatMessages = s.chatMessages.slice(-100);
          }
        }),

        setActiveSession: (id) => set((s) => { s.activeSessionId = id; }),
        setChatTyping: (v) => set((s) => { s.isChatTyping = v; }),
        setVoiceActive: (v) => set((s) => { s.isVoiceActive = v; }),

        markMessagesRead: () => set((s) => {
          s.chatMessages.forEach(m => { m.isRead = true; });
        }),

        // ── Safety alerts ────────────────────────────────────
        safetyAlerts: [],
        unreadAlertCount: 0,

        addAlert: (alert) => set((s) => {
          s.safetyAlerts.unshift(alert);
          if (!alert.isRead) s.unreadAlertCount += 1;
          if (s.safetyAlerts.length > 50) {
            s.safetyAlerts = s.safetyAlerts.slice(0, 50);
          }
        }),

        markAlertRead: (id) => set((s) => {
          const alert = s.safetyAlerts.find(a => a.id === id);
          if (alert && !alert.isRead) {
            alert.isRead = true;
            s.unreadAlertCount = Math.max(0, s.unreadAlertCount - 1);
          }
        }),

        markAllAlertsRead: () => set((s) => {
          s.safetyAlerts.forEach(a => { a.isRead = true; });
          s.unreadAlertCount = 0;
        }),

        // ── Offline ──────────────────────────────────────────
        isOnline: navigator.onLine,
        offlineQueue: [],

        setOnline: (v) => set((s) => { s.isOnline = v; }),

        enqueueOffline: (item) => set((s) => {
          s.offlineQueue.push(item);
        }),

        dequeueOffline: (id) => set((s) => {
          s.offlineQueue = s.offlineQueue.filter(i => i.id !== id);
        }),

        // ── Language ─────────────────────────────────────────
        language: navigator.language.split('-')[0] ?? 'en',
        setLanguage: (lang) => set((s) => { s.language = lang; }),

        // ── Location ─────────────────────────────────────────
        userLocation: null,
        setUserLocation: (loc) => set((s) => { s.userLocation = loc; }),

        // ── History ──────────────────────────────────────────
        reportedIncidents: [],

        // ── Call system ──────────────────────────────────────
        callSession: null,
        isCallOverlayVisible: false,

        initiateCall: (incidentId) => set((s) => {
          s.callSession = {
            sessionId:       `call-${Date.now()}`,
            incidentId,
            state:           'initiating',
            durationSeconds: 0,
            isMuted:         false,
            isSpeaker:       true,
            signalStrength:  4,
            fallbackMode:    'webrtc',
            retryCount:      0,
            liveTranscript:  [],
            aiKeywords:      [],
            aiSuggestions:   [],
          };
          s.isCallOverlayVisible = true;
        }),

        updateCallState: (state) => set((s) => {
          if (s.callSession) {
            s.callSession.state = state;
            if (state === 'connected' && !s.callSession.connectedAt) {
              s.callSession.connectedAt = new Date().toISOString();
            }
            if (state === 'ended' || state === 'failed') {
              s.callSession.endedAt = new Date().toISOString();
            }
          }
        }),

        updateCallSession: (updates) => set((s) => {
          if (s.callSession) Object.assign(s.callSession, updates);
        }),

        endCall: () => set((s) => {
          if (s.callSession) {
            s.callSession.state = 'ended';
            s.callSession.endedAt = new Date().toISOString();
          }
          s.isCallOverlayVisible = false;
        }),

        toggleMute: () => set((s) => {
          if (s.callSession) s.callSession.isMuted = !s.callSession.isMuted;
        }),

        toggleSpeaker: () => set((s) => {
          if (s.callSession) s.callSession.isSpeaker = !s.callSession.isSpeaker;
        }),

        addTranscriptLine: (line) => set((s) => {
          if (!s.callSession) return;
          const existing = s.callSession.liveTranscript.findIndex(t => t.id === line.id);
          if (existing >= 0) {
            s.callSession.liveTranscript[existing] = line;
          } else {
            s.callSession.liveTranscript.push(line);
            if (s.callSession.liveTranscript.length > 200) {
              s.callSession.liveTranscript = s.callSession.liveTranscript.slice(-200);
            }
          }
        }),

        addDetectedKeyword: (kw) => set((s) => {
          if (!s.callSession) return;
          s.callSession.aiKeywords.push(kw);
          if (s.callSession.aiKeywords.length > 50) {
            s.callSession.aiKeywords = s.callSession.aiKeywords.slice(-50);
          }
        }),

        addAISuggestion: (suggestion) => set((s) => {
          if (!s.callSession) return;
          if (!s.callSession.aiSuggestions.includes(suggestion)) {
            s.callSession.aiSuggestions.unshift(suggestion);
            if (s.callSession.aiSuggestions.length > 5) {
              s.callSession.aiSuggestions = s.callSession.aiSuggestions.slice(0, 5);
            }
          }
        }),

        setCallOverlayVisible: (v) => set((s) => { s.isCallOverlayVisible = v; }),

        updateSignalStrength: (bars) => set((s) => {
          if (s.callSession) s.callSession.signalStrength = bars;
        }),
      })),
      {
        name: 'lifegrid-app-v2',
        // Only persist non-ephemeral state
        partialize: (state) => ({
          language: state.language,
          reportedIncidents: state.reportedIncidents,
          safetyAlerts: state.safetyAlerts.slice(0, 20),
          offlineQueue: state.offlineQueue,
        }),
      },
    ),
  ),
);
