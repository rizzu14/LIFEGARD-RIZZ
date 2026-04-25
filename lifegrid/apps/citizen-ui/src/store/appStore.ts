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
  | 'holding'      // user is long-pressing
  | 'confirming'   // 3-second countdown
  | 'submitting'   // API call in flight
  | 'active'       // incident created, help dispatched
  | 'resolved';    // incident closed

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
