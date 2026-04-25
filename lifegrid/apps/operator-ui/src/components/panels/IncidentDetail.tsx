import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Send, User, MapPin, Clock, Zap, Radio, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { formatDistanceToNow, format } from 'date-fns';
import { api } from '../../lib/api';
import type { Incident } from '@lifegrid/shared-types';

interface IncidentDetailProps {
  incidentId: string | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ff1744', HIGH: '#ff6d00', MEDIUM: '#ffd600', LOW: '#00c853',
};

export function IncidentDetail({ incidentId }: IncidentDetailProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const [expandedSection, setExpandedSection] = useState<string | null>('overview');

  const { data, isLoading } = useQuery({
    queryKey: ['incident', incidentId],
    queryFn: () => api.get(`/incidents/${incidentId}`),
    enabled: !!incidentId,
    refetchInterval: 15000,
  });

  const { data: timelineData } = useQuery({
    queryKey: ['incident-timeline', incidentId],
    queryFn: () => api.get(`/incidents/${incidentId}/timeline`),
    enabled: !!incidentId,
  });

  const addNoteMutation = useMutation({
    mutationFn: (noteText: string) =>
      api.patch(`/incidents/${incidentId}`, { notes: noteText }),
    onSuccess: () => {
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
    },
  });

  const verifyMutation = useMutation({
    mutationFn: () =>
      api.post(`/incidents/${incidentId}/verify`, { method: 'OPERATOR_CONFIRM' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['incident', incidentId] });
    },
  });

  if (!incidentId) {
    return (
      <div className="panel h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-[10px] font-mono text-[#222] tracking-widest uppercase mb-2">
            No Incident Selected
          </div>
          <div className="text-[9px] text-[#1a1a1a]">Select an incident from the list</div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="panel h-full flex items-center justify-center">
        <div className="text-[9px] font-mono text-[#333] animate-pulse">LOADING...</div>
      </div>
    );
  }

  const incident: Incident = data?.data?.data;
  if (!incident) return null;

  const severityColor = SEVERITY_COLORS[incident.severity] ?? '#888';
  const timeline = timelineData?.data?.data ?? [];

  const toggleSection = (section: string) =>
    setExpandedSection(prev => prev === section ? null : section);

  return (
    <div className="panel h-full flex flex-col">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="panel-header flex-col items-start gap-1">
        <div className="flex items-center justify-between w-full">
          <span className="panel-title">Incident Detail</span>
          <span
            className="text-[8px] font-mono px-2 py-0.5 border"
            style={{ borderColor: `${severityColor}40`, color: severityColor }}
          >
            {incident.severity}
          </span>
        </div>
        <div className="text-[9px] font-mono text-[#555]">{incident.referenceCode}</div>
      </div>

      {/* ── Scrollable body ─────────────────────────────────── */}
      <div className="panel-body flex flex-col">

        {/* Status bar */}
        <div className="px-3 py-2 border-b border-[#1a1a1a] flex items-center justify-between bg-[#080808]">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: severityColor }} />
            <span className="text-[10px] font-bold">{incident.type.replace('_', ' ')}</span>
          </div>
          <span className="text-[8px] font-mono text-[#555]">
            {formatDistanceToNow(new Date(incident.createdAt), { addSuffix: true })}
          </span>
        </div>

        {/* ── Overview section ─────────────────────────────── */}
        <Section
          title="Overview"
          id="overview"
          expanded={expandedSection === 'overview'}
          onToggle={() => toggleSection('overview')}
        >
          <div className="space-y-2">
            <InfoRow icon={MapPin} label="Location">
              {incident.address?.formatted ?? `${incident.location.lat.toFixed(5)}, ${incident.location.lng.toFixed(5)}`}
            </InfoRow>
            <InfoRow icon={Clock} label="Reported">
              {format(new Date(incident.createdAt), 'HH:mm:ss · dd MMM yyyy')}
            </InfoRow>
            <InfoRow icon={Radio} label="Source">
              {incident.trigger.source.replace('_', ' ')}
            </InfoRow>
            {incident.assignedOperatorId && (
              <InfoRow icon={User} label="Operator">
                {incident.assignedOperatorId}
              </InfoRow>
            )}
          </div>

          {/* Raw description */}
          <div className="mt-3 p-3 bg-[#080808] border border-[#1a1a1a]">
            <div className="text-[8px] font-mono text-[#333] tracking-widest uppercase mb-2">Report</div>
            <p className="text-[10px] text-[#888] leading-relaxed">{incident.trigger.rawInput}</p>
          </div>
        </Section>

        {/* ── AI Analysis ──────────────────────────────────── */}
        {incident.nlpAnalysis && (
          <Section
            title="AI Analysis"
            id="ai"
            expanded={expandedSection === 'ai'}
            onToggle={() => toggleSection('ai')}
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-[#555]">Classification</span>
                <span className="text-[9px] font-mono text-white">{incident.nlpAnalysis.classifiedType}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-[#555]">Confidence</span>
                <div className="flex items-center gap-2">
                  <div className="w-20 h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-white rounded-full"
                      style={{ width: `${incident.nlpAnalysis.classificationConfidence * 100}%` }}
                    />
                  </div>
                  <span className="text-[9px] font-mono text-[#888]">
                    {Math.round(incident.nlpAnalysis.classificationConfidence * 100)}%
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-[#555]">Sentiment</span>
                <span className={`text-[9px] font-mono ${
                  incident.nlpAnalysis.sentiment === 'PANIC' ? 'text-[#ff1744]' : 'text-[#888]'
                }`}>
                  {incident.nlpAnalysis.sentiment}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] text-[#555]">Language</span>
                <span className="text-[9px] font-mono text-[#888]">{incident.nlpAnalysis.detectedLanguage.toUpperCase()}</span>
              </div>
            </div>

            {incident.aiDecision && (
              <div className="mt-3 pt-3 border-t border-[#1a1a1a] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-[#555]">Risk Score</span>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-1 bg-[#1a1a1a] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${incident.aiDecision.riskScore}%`,
                          background: incident.aiDecision.riskScore > 70 ? '#ff1744' : incident.aiDecision.riskScore > 40 ? '#ff6d00' : '#00c853',
                        }}
                      />
                    </div>
                    <span className="text-[9px] font-mono text-[#888]">{incident.aiDecision.riskScore}/100</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-[#555]">ETA</span>
                  <span className="text-[9px] font-mono text-[#888]">
                    {Math.round(incident.aiDecision.estimatedResponseTime / 60)}m
                  </span>
                </div>
                {incident.aiDecision.escalationRequired && (
                  <div className="flex items-center gap-2 p-2 border border-[#ff1744]/30 bg-[#ff1744]/5">
                    <Zap className="w-3 h-3 text-[#ff1744]" />
                    <span className="text-[9px] text-[#ff1744]">Escalation Required</span>
                  </div>
                )}
              </div>
            )}
          </Section>
        )}

        {/* ── Dispatches ───────────────────────────────────── */}
        {incident.dispatches.length > 0 && (
          <Section
            title={`Dispatches (${incident.dispatches.length})`}
            id="dispatches"
            expanded={expandedSection === 'dispatches'}
            onToggle={() => toggleSection('dispatches')}
          >
            <div className="space-y-2">
              {incident.dispatches.map((d, i) => (
                <div key={d.dispatchId} className="p-2 bg-[#080808] border border-[#1a1a1a]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[9px] font-mono text-[#888]">Unit {i + 1}</span>
                    <span className={`text-[8px] font-mono ${d.arrivedAt ? 'text-[#00c853]' : d.acknowledgedAt ? 'text-[#00b0ff]' : 'text-[#ffd600]'}`}>
                      {d.arrivedAt ? 'ON SCENE' : d.acknowledgedAt ? 'EN ROUTE' : 'DISPATCHED'}
                    </span>
                  </div>
                  <div className="text-[8px] text-[#444] font-mono">
                    ETA: {format(new Date(d.estimatedArrival), 'HH:mm:ss')}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Timeline ─────────────────────────────────────── */}
        <Section
          title="Pipeline Status"
          id="timeline"
          expanded={expandedSection === 'timeline'}
          onToggle={() => toggleSection('timeline')}
        >
          <div className="space-y-1">
            {timeline.map((step: any) => (
              <div key={step.step} className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  step.status === 'complete' ? 'bg-white' :
                  step.status === 'active' ? 'bg-[#ffd600] animate-pulse' : 'bg-[#1a1a1a]'
                }`} />
                <span className={`text-[9px] flex-1 ${step.status === 'pending' ? 'text-[#333]' : 'text-[#888]'}`}>
                  {step.name}
                </span>
                {step.timestamp && (
                  <span className="text-[8px] font-mono text-[#333]">
                    {format(new Date(step.timestamp), 'HH:mm')}
                  </span>
                )}
              </div>
            ))}
          </div>
        </Section>

        {/* ── Notes ────────────────────────────────────────── */}
        <Section
          title="Notes"
          id="notes"
          expanded={expandedSection === 'notes'}
          onToggle={() => toggleSection('notes')}
        >
          <div className="space-y-1 mb-3">
            {incident.notes.length === 0 ? (
              <div className="text-[9px] text-[#333]">No notes yet</div>
            ) : (
              incident.notes.map((note, i) => (
                <div key={i} className="text-[9px] text-[#666] p-2 bg-[#080808] border border-[#1a1a1a] leading-relaxed">
                  {note}
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={note}
              onChange={e => setNote(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && note.trim() && addNoteMutation.mutate(note)}
              placeholder="Add note..."
              className="flex-1 bg-[#080808] border border-[#1a1a1a] text-[10px] text-[#888] px-2 py-1.5 placeholder:text-[#333] focus:outline-none focus:border-[#333]"
            />
            <button
              onClick={() => note.trim() && addNoteMutation.mutate(note)}
              disabled={!note.trim() || addNoteMutation.isPending}
              className="px-2 py-1.5 border border-[#1a1a1a] hover:border-[#333] disabled:opacity-30 transition-colors"
            >
              <Send className="w-3 h-3 text-[#555]" />
            </button>
          </div>
        </Section>

        {/* ── Actions ──────────────────────────────────────── */}
        <div className="p-3 border-t border-[#1a1a1a] mt-auto">
          <button
            onClick={() => verifyMutation.mutate()}
            disabled={incident.status === 'CLOSED' || verifyMutation.isPending}
            className="
              w-full flex items-center justify-center gap-2
              py-2.5 border border-[#333] text-[9px] font-mono tracking-widest uppercase
              hover:border-white hover:text-white transition-colors
              disabled:opacity-30 disabled:cursor-not-allowed
            "
          >
            <CheckCircle className="w-3 h-3" />
            {incident.status === 'CLOSED' ? 'Incident Closed' : 'Verify & Close'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function Section({
  title, id, expanded, onToggle, children,
}: {
  title: string;
  id: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-[#1a1a1a]">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-[#080808] transition-colors"
      >
        <span className="text-[9px] font-mono text-[#555] tracking-widest uppercase">{title}</span>
        {expanded ? <ChevronUp className="w-3 h-3 text-[#333]" /> : <ChevronDown className="w-3 h-3 text-[#333]" />}
      </button>
      {expanded && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3 h-3 text-[#333] mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-[8px] text-[#333] tracking-widest uppercase mb-0.5">{label}</div>
        <div className="text-[10px] text-[#888] truncate">{children}</div>
      </div>
    </div>
  );
}
