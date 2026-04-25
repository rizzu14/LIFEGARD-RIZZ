// ============================================================
// LIFEGRID – Operator Store v2
// Full command center state management
// ============================================================

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Incident, SystemMetrics, AlertLevel, Responder } from '@lifegrid/shared-types';

// ── Types ─────────────────────────────────────────────────────

export interface LogEntry {
  id: string;
  type: 'INCIDENT' | 'DISPATCH' | 'SENSOR' | 'SYSTEM' | 'BROADCAST' | 'AI' | 'AGENCY' | 'COMM';
  severity: string;
  message: string;
  timestamp: string;
  incidentId?: string;
  agencyId?: string;
}

export interface AISuggestion {
  id: string;
  incidentId: string;
  type: 'DISPATCH' | 'ESCALATE' | 'RESOURCE' | 'ROUTE' | 'PREDICTION' | 'DEESCALATE';
  title: string;
  description: string;
  confidence: number;       // 0–1
  riskScore: number;        // 0–100
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  actions: AISuggestionAction[];
  timestamp: string;
  isActedOn: boolean;
  modelVersion: string;
  factors: string[];
}

export interface AISuggestionAction {
  id: string;
  label: string;
  type: 'PRIMARY' | 'SECONDARY' | 'DISMISS';
  endpoint?: string;
  payload?: Record<string, unknown>;
}

export interface Agency {
  id: string;
  name: string;
  shortName: string;
  type: 'POLICE' | 'FIRE' | 'EMS' | 'MILITARY' | 'HAZMAT' | 'DISASTER_MGMT' | 'CYBER' | 'COAST_GUARD';
  status: 'ONLINE' | 'BUSY' | 'OFFLINE' | 'STANDBY';
  commanderName: string;
  contactFrequency?: string;
  availableUnits: number;
  deployedUnits: number;
  location: string;
  lastContact: string;
  color: string;
}

export interface CommMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  senderAgency?: string;
  content: string;
  timestamp: string;
  type: 'TEXT' | 'ALERT' | 'STATUS' | 'COMMAND';
  isRead: boolean;
  priority: 'NORMAL' | 'URGENT' | 'EMERGENCY';
  incidentRef?: string;
}

export interface CommChannel {
  id: string;
  name: string;
  type: 'AGENCY' | 'INCIDENT' | 'BROADCAST' | 'ENCRYPTED';
  participants: string[];
  unreadCount: number;
  lastMessage?: string;
  lastMessageTime?: string;
  isActive: boolean;
  frequency?: string;
}

export interface MapLayer {
  id: string;
  name: string;
  type: 'HEATMAP' | 'FLOOD' | 'TRAFFIC' | 'SATELLITE' | 'WEATHER' | 'NDVI' | 'POPULATION' | 'EVACUATION';
  isVisible: boolean;
  opacity: number;
  color?: string;
  data?: unknown;
  lastUpdated?: string;
}

export interface HeatmapPoint {
  lat: number;
  lng: number;
  weight: number;
  type: string;
}

export interface FloodZone {
  id: string;
  centerLat: number;
  centerLng: number;
  radiusM: number;
  probability: number;
  riskLevel: string;
  estimatedPopulation: number;
}

export interface PriorityQueueItem {
  id: string;
  incidentId: string;
  referenceCode: string;
  type: string;
  severity: string;
  priorityScore: number;    // 0–100, computed
  waitTimeSeconds: number;
  estimatedImpact: number;  // affected persons
  isAssigned: boolean;
  assignedOperatorId?: string;
  createdAt: string;
}

export interface ResponderPosition {
  responderId: string;
  type: string;
  lat: number;
  lng: number;
  heading?: number;
  speed?: number;
  status: string;
  incidentId?: string;
  timestamp: string;
}

export type LeftPanelTab = 'incidents' | 'priority' | 'agencies' | 'log';
export type RightPanelTab = 'detail' | 'ai' | 'comm' | 'satellite';

// ── Store ─────────────────────────────────────────────────────

interface OperatorState {
  // Incidents
  incidents: Incident[];
  selectedIncidentId: string | null;
  setIncidents: (incidents: Incident[]) => void;
  addIncident: (incident: Incident) => void;
  updateIncident: (id: string, updates: Partial<Incident>) => void;
  setSelectedIncident: (id: string | null) => void;

  // Metrics
  metrics: SystemMetrics | null;
  setMetrics: (metrics: SystemMetrics) => void;

  // Alert level
  alertLevel: AlertLevel;
  setAlertLevel: (level: AlertLevel) => void;

  // System log
  logEntries: LogEntry[];
  addLogEntry: (entry: Omit<LogEntry, 'id'>) => void;
  clearLog: () => void;

  // AI suggestions
  aiSuggestions: AISuggestion[];
  addAISuggestion: (s: AISuggestion) => void;
  markSuggestionActedOn: (id: string) => void;
  dismissSuggestion: (id: string) => void;

  // Agencies
  agencies: Agency[];
  setAgencies: (agencies: Agency[]) => void;
  updateAgencyStatus: (id: string, status: Agency['status']) => void;

  // Communications
  commChannels: CommChannel[];
  commMessages: Record<string, CommMessage[]>;  // channelId → messages
  activeChannelId: string | null;
  addCommMessage: (channelId: string, msg: CommMessage) => void;
  setActiveChannel: (id: string | null) => void;
  markChannelRead: (channelId: string) => void;

  // Map layers
  mapLayers: MapLayer[];
  toggleLayer: (id: string) => void;
  setLayerOpacity: (id: string, opacity: number) => void;
  updateLayerData: (id: string, data: unknown) => void;

  // Heatmap
  heatmapPoints: HeatmapPoint[];
  setHeatmapPoints: (points: HeatmapPoint[]) => void;

  // Flood zones
  floodZones: FloodZone[];
  setFloodZones: (zones: FloodZone[]) => void;

  // Priority queue
  priorityQueue: PriorityQueueItem[];
  setPriorityQueue: (items: PriorityQueueItem[]) => void;
  updatePriorityItem: (id: string, updates: Partial<PriorityQueueItem>) => void;

  // Responder positions
  responderPositions: ResponderPosition[];
  updateResponderPosition: (pos: ResponderPosition) => void;

  // Responders list
  responders: Responder[];
  setResponders: (responders: Responder[]) => void;

  // Panel tabs
  leftPanelTab: LeftPanelTab;
  rightPanelTab: RightPanelTab;
  setLeftPanelTab: (tab: LeftPanelTab) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;

  // Broadcast modal
  broadcastModalOpen: boolean;
  setBroadcastModalOpen: (v: boolean) => void;
}

// ── Default map layers ────────────────────────────────────────

const DEFAULT_LAYERS: MapLayer[] = [
  { id: 'heatmap',    name: 'Crisis Heatmap',    type: 'HEATMAP',    isVisible: false, opacity: 0.7, color: '#ff1744' },
  { id: 'flood',      name: 'Flood Zones',       type: 'FLOOD',      isVisible: false, opacity: 0.6, color: '#00aaff' },
  { id: 'traffic',    name: 'Traffic',           type: 'TRAFFIC',    isVisible: false, opacity: 0.5, color: '#ffd600' },
  { id: 'satellite',  name: 'Satellite',         type: 'SATELLITE',  isVisible: false, opacity: 1.0 },
  { id: 'weather',    name: 'Weather',           type: 'WEATHER',    isVisible: false, opacity: 0.5, color: '#888' },
  { id: 'ndvi',       name: 'Vegetation',        type: 'NDVI',       isVisible: false, opacity: 0.6, color: '#00c853' },
  { id: 'population', name: 'Population',        type: 'POPULATION', isVisible: false, opacity: 0.4, color: '#fff' },
  { id: 'evacuation', name: 'Evacuation Routes', type: 'EVACUATION', isVisible: false, opacity: 0.8, color: '#ffd600' },
];

// ── Default agencies ──────────────────────────────────────────

const DEFAULT_AGENCIES: Agency[] = [
  { id: 'nypd',   name: 'New York Police Dept',    shortName: 'NYPD',   type: 'POLICE',       status: 'ONLINE',   commanderName: 'Cmdr. Rodriguez', availableUnits: 24, deployedUnits: 8,  location: 'HQ – Manhattan',    lastContact: new Date().toISOString(), color: '#00aaff' },
  { id: 'fdny',   name: 'Fire Dept New York',      shortName: 'FDNY',   type: 'FIRE',         status: 'BUSY',     commanderName: 'Chief Williams',  availableUnits: 12, deployedUnits: 5,  location: 'Station 1 – Bronx', lastContact: new Date().toISOString(), color: '#ff6d00' },
  { id: 'ems',    name: 'Emergency Medical Svc',   shortName: 'EMS',    type: 'EMS',          status: 'ONLINE',   commanderName: 'Dr. Chen',        availableUnits: 18, deployedUnits: 11, location: 'Central Dispatch',  lastContact: new Date().toISOString(), color: '#00c853' },
  { id: 'hazmat', name: 'HazMat Response Unit',    shortName: 'HAZMAT', type: 'HAZMAT',       status: 'STANDBY',  commanderName: 'Lt. Patel',       availableUnits: 4,  deployedUnits: 0,  location: 'Depot – Queens',    lastContact: new Date().toISOString(), color: '#ffd600' },
  { id: 'ng',     name: 'National Guard',          shortName: 'NATGRD', type: 'MILITARY',     status: 'STANDBY',  commanderName: 'Col. Thompson',   availableUnits: 50, deployedUnits: 0,  location: 'Base – Brooklyn',   lastContact: new Date().toISOString(), color: '#888' },
  { id: 'fema',   name: 'FEMA Disaster Mgmt',      shortName: 'FEMA',   type: 'DISASTER_MGMT',status: 'ONLINE',   commanderName: 'Dir. Martinez',   availableUnits: 8,  deployedUnits: 2,  location: 'Regional Office',   lastContact: new Date().toISOString(), color: '#fff' },
];

// ── Default comm channels ─────────────────────────────────────

const DEFAULT_CHANNELS: CommChannel[] = [
  { id: 'ch-all',       name: 'All Agencies',     type: 'BROADCAST',  participants: [], unreadCount: 0, isActive: true },
  { id: 'ch-nypd',      name: 'NYPD Direct',      type: 'AGENCY',     participants: ['nypd'], unreadCount: 2, isActive: true },
  { id: 'ch-fdny',      name: 'FDNY Direct',      type: 'AGENCY',     participants: ['fdny'], unreadCount: 0, isActive: true },
  { id: 'ch-ems',       name: 'EMS Direct',       type: 'AGENCY',     participants: ['ems'],  unreadCount: 1, isActive: true },
  { id: 'ch-encrypted', name: 'Secure Channel',   type: 'ENCRYPTED',  participants: [], unreadCount: 0, isActive: false },
];

// ── Store implementation ──────────────────────────────────────

export const useOperatorStore = create<OperatorState>()(
  subscribeWithSelector(
    immer((set, get) => ({
      // Incidents
      incidents: [],
      selectedIncidentId: null,

      setIncidents: (incidents) => set((s) => { s.incidents = incidents; }),

      addIncident: (incident) => set((s) => {
        if (!s.incidents.some(i => i.id === incident.id)) {
          s.incidents.unshift(incident);
          if (s.incidents.length > 200) s.incidents = s.incidents.slice(0, 200);
        }
      }),

      updateIncident: (id, updates) => set((s) => {
        const idx = s.incidents.findIndex(i => i.id === id);
        if (idx !== -1) s.incidents[idx] = { ...s.incidents[idx], ...updates };
      }),

      setSelectedIncident: (id) => set((s) => { s.selectedIncidentId = id; }),

      // Metrics
      metrics: null,
      setMetrics: (metrics) => set((s) => { s.metrics = metrics; }),

      // Alert level
      alertLevel: 'GREEN',
      setAlertLevel: (level) => set((s) => { s.alertLevel = level; }),

      // Log
      logEntries: [],
      addLogEntry: (entry) => set((s) => {
        s.logEntries.push({ ...entry, id: `${Date.now()}-${Math.random()}` });
        if (s.logEntries.length > 500) s.logEntries = s.logEntries.slice(-500);
      }),
      clearLog: () => set((s) => { s.logEntries = []; }),

      // AI suggestions
      aiSuggestions: [],
      addAISuggestion: (suggestion) => set((s) => {
        s.aiSuggestions.unshift(suggestion);
        if (s.aiSuggestions.length > 50) s.aiSuggestions = s.aiSuggestions.slice(0, 50);
      }),
      markSuggestionActedOn: (id) => set((s) => {
        const s_ = s.aiSuggestions.find(x => x.id === id);
        if (s_) s_.isActedOn = true;
      }),
      dismissSuggestion: (id) => set((s) => {
        s.aiSuggestions = s.aiSuggestions.filter(x => x.id !== id);
      }),

      // Agencies
      agencies: DEFAULT_AGENCIES,
      setAgencies: (agencies) => set((s) => { s.agencies = agencies; }),
      updateAgencyStatus: (id, status) => set((s) => {
        const a = s.agencies.find(x => x.id === id);
        if (a) a.status = status;
      }),

      // Communications
      commChannels: DEFAULT_CHANNELS,
      commMessages: {},
      activeChannelId: 'ch-all',

      addCommMessage: (channelId, msg) => set((s) => {
        if (!s.commMessages[channelId]) s.commMessages[channelId] = [];
        s.commMessages[channelId].push(msg);
        if (s.commMessages[channelId].length > 200) {
          s.commMessages[channelId] = s.commMessages[channelId].slice(-200);
        }
        const ch = s.commChannels.find(c => c.id === channelId);
        if (ch && channelId !== s.activeChannelId) {
          ch.unreadCount += 1;
        }
        if (ch) {
          ch.lastMessage = msg.content.slice(0, 60);
          ch.lastMessageTime = msg.timestamp;
        }
      }),

      setActiveChannel: (id) => set((s) => { s.activeChannelId = id; }),

      markChannelRead: (channelId) => set((s) => {
        const ch = s.commChannels.find(c => c.id === channelId);
        if (ch) ch.unreadCount = 0;
      }),

      // Map layers
      mapLayers: DEFAULT_LAYERS,
      toggleLayer: (id) => set((s) => {
        const l = s.mapLayers.find(x => x.id === id);
        if (l) l.isVisible = !l.isVisible;
      }),
      setLayerOpacity: (id, opacity) => set((s) => {
        const l = s.mapLayers.find(x => x.id === id);
        if (l) l.opacity = opacity;
      }),
      updateLayerData: (id, data) => set((s) => {
        const l = s.mapLayers.find(x => x.id === id);
        if (l) { l.data = data; l.lastUpdated = new Date().toISOString(); }
      }),

      // Heatmap
      heatmapPoints: [],
      setHeatmapPoints: (points) => set((s) => { s.heatmapPoints = points; }),

      // Flood zones
      floodZones: [],
      setFloodZones: (zones) => set((s) => { s.floodZones = zones; }),

      // Priority queue
      priorityQueue: [],
      setPriorityQueue: (items) => set((s) => { s.priorityQueue = items; }),
      updatePriorityItem: (id, updates) => set((s) => {
        const idx = s.priorityQueue.findIndex(x => x.id === id);
        if (idx !== -1) s.priorityQueue[idx] = { ...s.priorityQueue[idx], ...updates };
      }),

      // Responder positions
      responderPositions: [],
      updateResponderPosition: (pos) => set((s) => {
        const idx = s.responderPositions.findIndex(r => r.responderId === pos.responderId);
        if (idx >= 0) s.responderPositions[idx] = pos;
        else s.responderPositions.push(pos);
      }),

      // Responders
      responders: [],
      setResponders: (responders) => set((s) => { s.responders = responders; }),

      // Panel tabs
      leftPanelTab: 'incidents',
      rightPanelTab: 'detail',
      setLeftPanelTab: (tab) => set((s) => { s.leftPanelTab = tab; }),
      setRightPanelTab: (tab) => set((s) => { s.rightPanelTab = tab; }),

      // Broadcast modal
      broadcastModalOpen: false,
      setBroadcastModalOpen: (v) => set((s) => { s.broadcastModalOpen = v; }),
    })),
  ),
);
