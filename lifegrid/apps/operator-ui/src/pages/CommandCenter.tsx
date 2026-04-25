// ============================================================
// LIFEGRID – Command Center v2
// Full 5-module tactical dashboard
//
// Layout (4-column × 4-row grid):
//   Row 1:  TopBar (full width)
//   Row 2:  LeftPanel | MapCenter | MapCenter | RightPanel
//   Row 3:  LeftPanel | MapCenter | MapCenter | RightPanel
//   Row 4:  AnalyticsBar (full width)
//
// Left panel tabs:  Incidents | Priority Queue | Agencies | Log
// Right panel tabs: Detail | AI Suggestions | Comms | Satellite
// ============================================================

import React, { useEffect, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';

import { useOperatorStore } from '../store/operatorStore';
import { useSocket } from '../hooks/useSocket';
import { api } from '../lib/api';

// Layout
import { TopBar }           from '../components/layout/TopBar';
import { AnalyticsBar }     from '../components/panels/AnalyticsBar';

// Left panel
import { IncidentList }     from '../components/panels/IncidentList';
import { PriorityQueue }    from '../components/panels/PriorityQueue';
import { AgencyPanel }      from '../components/panels/AgencyPanel';
import { SystemLog }        from '../components/panels/SystemLog';

// Center
import { TacticalMap }      from '../components/panels/TacticalMap';

// Right panel
import { IncidentDetail }   from '../components/panels/IncidentDetail';
import { AISuggestionsPanel } from '../components/panels/AISuggestionsPanel';
import { CommPanel }        from '../components/panels/CommPanel';
import { SatellitePanel }   from '../components/panels/SatellitePanel';

// Overlays
import { AlertBanner }      from '../components/ui/AlertBanner';
import { BroadcastModal }   from '../components/ui/BroadcastModal';

import type { LeftPanelTab, RightPanelTab } from '../store/operatorStore';

// ── Panel tab configs ─────────────────────────────────────────

const LEFT_TABS: { id: LeftPanelTab; label: string }[] = [
  { id: 'incidents', label: 'Incidents' },
  { id: 'priority',  label: 'Priority'  },
  { id: 'agencies',  label: 'Agencies'  },
  { id: 'log',       label: 'Log'       },
];

const RIGHT_TABS: { id: RightPanelTab; label: string }[] = [
  { id: 'detail',    label: 'Detail'    },
  { id: 'ai',        label: 'AI'        },
  { id: 'comm',      label: 'Comms'     },
  { id: 'satellite', label: 'Satellite' },
];

export default function CommandCenter() {
  const {
    incidents, setIncidents, addIncident, updateIncident,
    selectedIncidentId, setSelectedIncident,
    metrics, setMetrics,
    alertLevel, setAlertLevel,
    addLogEntry, addAISuggestion,
    updateResponderPosition,
    leftPanelTab, setLeftPanelTab,
    rightPanelTab, setRightPanelTab,
    broadcastModalOpen,
    setPriorityQueue, setHeatmapPoints, setFloodZones,
    addCommMessage, commChannels,
  } = useOperatorStore();

  const { socket } = useSocket();

  // ── Data fetching ─────────────────────────────────────────

  const { data: incidentsData } = useQuery({
    queryKey: ['incidents', 'active'],
    queryFn: () => api.get('/incidents?pageSize=100'),
    refetchInterval: 20000,
  });

  const { data: metricsData } = useQuery({
    queryKey: ['metrics'],
    queryFn: () => api.get('/analytics/metrics'),
    refetchInterval: 8000,
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['heatmap'],
    queryFn: () => api.get('/analytics/heatmap'),
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (incidentsData?.data?.data) {
      setIncidents(incidentsData.data.data);
      // Build priority queue from incidents
      const queue = incidentsData.data.data
        .filter((i: any) => !['CLOSED', 'RESOLVED'].includes(i.status))
        .map((i: any, idx: number) => ({
          id: `pq-${i.id}`,
          incidentId: i.id,
          referenceCode: i.referenceCode,
          type: i.type,
          severity: i.severity,
          priorityScore: computePriorityScore(i),
          waitTimeSeconds: Math.round((Date.now() - new Date(i.createdAt).getTime()) / 1000),
          estimatedImpact: i.estimatedAffected ?? 1,
          isAssigned: !!i.assignedOperatorId,
          assignedOperatorId: i.assignedOperatorId,
          createdAt: i.createdAt,
        }))
        .sort((a: any, b: any) => b.priorityScore - a.priorityScore);
      setPriorityQueue(queue);
    }
  }, [incidentsData, setIncidents, setPriorityQueue]);

  useEffect(() => {
    if (metricsData?.data?.data) setMetrics(metricsData.data.data);
  }, [metricsData, setMetrics]);

  useEffect(() => {
    if (heatmapData?.data?.data) {
      setHeatmapPoints(heatmapData.data.data.map((p: any) => ({
        lat: p.location.lat,
        lng: p.location.lng,
        weight: p.weight,
        type: p.incidentType,
      })));
    }
  }, [heatmapData, setHeatmapPoints]);

  // ── WebSocket events ──────────────────────────────────────

  useEffect(() => {
    if (!socket) return;

    socket.on('INCIDENT_CREATED', (event: any) => {
      addIncident(event.payload);
      addLogEntry({ type: 'INCIDENT', severity: event.payload.severity,
        message: `New: ${event.payload.referenceCode} · ${event.payload.type}`,
        timestamp: event.timestamp, incidentId: event.payload.id });

      // Generate AI suggestion for new critical incidents
      if (event.payload.severity === 'CRITICAL' || event.payload.severity === 'HIGH') {
        addAISuggestion({
          id: uuidv4(),
          incidentId: event.payload.id,
          type: 'DISPATCH',
          title: `Dispatch recommendation for ${event.payload.referenceCode}`,
          description: `${event.payload.type} incident classified as ${event.payload.severity}. AI recommends immediate multi-unit dispatch.`,
          confidence: event.payload.aiDecision?.decisionConfidence ?? 0.82,
          riskScore: event.payload.aiDecision?.riskScore ?? 75,
          priority: event.payload.severity as any,
          actions: [
            { id: 'a1', label: 'Accept & Dispatch', type: 'PRIMARY' },
            { id: 'a2', label: 'Modify',            type: 'SECONDARY' },
            { id: 'a3', label: 'Dismiss',           type: 'DISMISS' },
          ],
          timestamp: event.timestamp,
          isActedOn: false,
          modelVersion: event.payload.aiDecision?.modelVersion ?? '2.0.0',
          factors: event.payload.aiDecision?.resourceRequirements?.map((r: any) => r.type) ?? [],
        });
      }
    });

    socket.on('INCIDENT_UPDATED', (event: any) => {
      updateIncident(event.payload.id, event.payload);
    });

    socket.on('RESPONDER_LOCATION_UPDATE', (event: any) => {
      updateResponderPosition({
        responderId: event.payload.responderId,
        type: event.payload.type ?? 'UNKNOWN',
        lat: event.payload.lat,
        lng: event.payload.lng,
        heading: event.payload.heading,
        speed: event.payload.speed,
        status: event.payload.status ?? 'EN_ROUTE',
        incidentId: event.payload.incidentId,
        timestamp: event.timestamp,
      });
    });

    socket.on('DISPATCH_SENT', (event: any) => {
      addLogEntry({ type: 'DISPATCH', severity: 'INFO',
        message: `Dispatch: ${event.payload.incidentId}`,
        timestamp: event.timestamp });
    });

    socket.on('SENSOR_ALERT', (event: any) => {
      addLogEntry({ type: 'SENSOR',
        severity: event.payload.isAlert ? 'HIGH' : 'LOW',
        message: `Sensor: ${event.payload.payload?.deviceType} · ${event.payload.payload?.deviceId}`,
        timestamp: event.timestamp });
    });

    socket.on('ALERT_LEVEL_CHANGE', (event: any) => {
      setAlertLevel(event.payload.level);
      addLogEntry({ type: 'SYSTEM', severity: 'CRITICAL',
        message: `Alert level → ${event.payload.level}`,
        timestamp: event.timestamp });
    });

    socket.on('OPERATOR_BROADCAST', (event: any) => {
      addLogEntry({ type: 'BROADCAST', severity: 'INFO',
        message: `[${event.payload.operatorId}] ${event.payload.message}`,
        timestamp: event.timestamp });
      // Add to all-agencies channel
      addCommMessage('ch-all', {
        id: uuidv4(),
        channelId: 'ch-all',
        senderId: event.payload.operatorId,
        senderName: 'Operator',
        content: event.payload.message,
        timestamp: event.timestamp,
        type: 'ALERT',
        isRead: false,
        priority: 'URGENT',
      });
    });

    socket.on('GUIDANCE_MESSAGE', (event: any) => {
      if (event.payload.incidentId) {
        const channelId = `ch-inc-${event.payload.incidentId}`;
        addCommMessage(channelId, {
          id: uuidv4(),
          channelId,
          senderId: 'citizen',
          senderName: 'Citizen',
          content: event.payload.message?.content ?? '',
          timestamp: event.timestamp,
          type: 'TEXT',
          isRead: false,
          priority: 'NORMAL',
          incidentRef: event.payload.incidentId,
        });
      }
    });

    return () => {
      ['INCIDENT_CREATED','INCIDENT_UPDATED','RESPONDER_LOCATION_UPDATE',
       'DISPATCH_SENT','SENSOR_ALERT','ALERT_LEVEL_CHANGE',
       'OPERATOR_BROADCAST','GUIDANCE_MESSAGE'].forEach(e => socket.off(e));
    };
  }, [socket, addIncident, updateIncident, addLogEntry, addAISuggestion,
      setAlertLevel, updateResponderPosition, addCommMessage]);

  // ── Keyboard shortcuts ────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === '1') setLeftPanelTab('incidents');
      if (e.key === '2') setLeftPanelTab('priority');
      if (e.key === '3') setLeftPanelTab('agencies');
      if (e.key === '4') setLeftPanelTab('log');
      if (e.key === 'q') setRightPanelTab('detail');
      if (e.key === 'w') setRightPanelTab('ai');
      if (e.key === 'e') setRightPanelTab('comm');
      if (e.key === 'r') setRightPanelTab('satellite');
      if (e.key === 'Escape') setSelectedIncident(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setLeftPanelTab, setRightPanelTab, setSelectedIncident]);

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="command-grid">

      {/* ── Row 1: Top bar ─────────────────────────────────── */}
      <div style={{ gridColumn: '1 / -1', gridRow: '1' }}>
        <TopBar
          metrics={metrics}
          alertLevel={alertLevel}
          leftPanelTab={leftPanelTab}
          rightPanelTab={rightPanelTab}
          onLeftTabChange={setLeftPanelTab}
          onRightTabChange={setRightPanelTab}
          leftTabs={LEFT_TABS}
          rightTabs={RIGHT_TABS}
        />
      </div>

      {/* ── Rows 2–3: Left panel ───────────────────────────── */}
      <div style={{ gridRow: '2 / 4', gridColumn: '1' }} className="panel border-r border-[#1a1a1a]">
        <AnimatePresence mode="wait">
          {leftPanelTab === 'incidents' && (
            <motion.div key="incidents" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col">
              <IncidentList incidents={incidents} selectedId={selectedIncidentId} onSelect={setSelectedIncident} />
            </motion.div>
          )}
          {leftPanelTab === 'priority' && (
            <motion.div key="priority" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <PriorityQueue onSelect={setSelectedIncident} />
            </motion.div>
          )}
          {leftPanelTab === 'agencies' && (
            <motion.div key="agencies" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <AgencyPanel />
            </motion.div>
          )}
          {leftPanelTab === 'log' && (
            <motion.div key="log" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <SystemLog />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Rows 2–3: Center map (spans 2 columns) ─────────── */}
      <div style={{ gridRow: '2 / 4', gridColumn: '2 / 4' }} className="relative">
        <TacticalMap
          incidents={incidents}
          selectedIncidentId={selectedIncidentId}
          onIncidentSelect={(id) => {
            setSelectedIncident(id);
            setRightPanelTab('detail');
          }}
        />
        {alertLevel !== 'GREEN' && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[1000] pointer-events-none">
            <AlertBanner level={alertLevel} />
          </div>
        )}
      </div>

      {/* ── Rows 2–3: Right panel ──────────────────────────── */}
      <div style={{ gridRow: '2 / 4', gridColumn: '4' }} className="panel border-l border-[#1a1a1a]">
        <AnimatePresence mode="wait">
          {rightPanelTab === 'detail' && (
            <motion.div key="detail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <IncidentDetail incidentId={selectedIncidentId} />
            </motion.div>
          )}
          {rightPanelTab === 'ai' && (
            <motion.div key="ai" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <AISuggestionsPanel />
            </motion.div>
          )}
          {rightPanelTab === 'comm' && (
            <motion.div key="comm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <CommPanel />
            </motion.div>
          )}
          {rightPanelTab === 'satellite' && (
            <motion.div key="satellite" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full">
              <SatellitePanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Row 4: Analytics bar ───────────────────────────── */}
      <div style={{ gridRow: '4', gridColumn: '1 / -1' }} className="border-t border-[#1a1a1a]">
        <AnalyticsBar metrics={metrics} />
      </div>

      {/* ── Broadcast modal ────────────────────────────────── */}
      <AnimatePresence>
        {broadcastModalOpen && <BroadcastModal />}
      </AnimatePresence>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function computePriorityScore(incident: any): number {
  let score = 0;
  const severityScores: Record<string, number> = { CRITICAL: 40, HIGH: 25, MEDIUM: 12, LOW: 4 };
  score += severityScores[incident.severity] ?? 0;

  const typeScores: Record<string, number> = {
    NUCLEAR: 40, RADIOLOGICAL: 35, BIOLOGICAL: 30, MASS_CASUALTY: 28,
    CHEMICAL: 22, NATURAL_DISASTER: 18, SECURITY: 15, FIRE: 12,
    MEDICAL: 10, INFRASTRUCTURE: 8, CYBER: 8, UNKNOWN: 4,
  };
  score += typeScores[incident.type] ?? 0;

  // Age bonus: older unresolved incidents get higher priority
  const ageMinutes = (Date.now() - new Date(incident.createdAt).getTime()) / 60000;
  score += Math.min(ageMinutes * 0.5, 20);

  return Math.min(Math.round(score), 100);
}
