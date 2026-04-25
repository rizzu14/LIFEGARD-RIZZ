// ============================================================
// LIFEGRID – AI Suggestions Panel
// Real-time AI decision recommendations for operators
// ============================================================

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, ChevronDown, ChevronUp, Check, X, AlertTriangle, TrendingUp, Route, Users } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useOperatorStore, AISuggestion } from '../../store/operatorStore';
import { api } from '../../lib/api';

const TYPE_ICONS: Record<string, React.ComponentType<any>> = {
  DISPATCH:    Users,
  ESCALATE:    AlertTriangle,
  RESOURCE:    Zap,
  ROUTE:       Route,
  PREDICTION:  TrendingUp,
  DEESCALATE:  Check,
};

const TYPE_COLORS: Record<string, string> = {
  DISPATCH:    '#00aaff',
  ESCALATE:    '#ff1744',
  RESOURCE:    '#ffd600',
  ROUTE:       '#00c853',
  PREDICTION:  '#888',
  DEESCALATE:  '#00c853',
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#ff1744', HIGH: '#ff6d00', MEDIUM: '#ffd600', LOW: '#00c853',
};

// ── Demo suggestions (shown when no real ones exist) ──────────

const DEMO_SUGGESTIONS: AISuggestion[] = [
  {
    id: 'demo-1',
    incidentId: 'inc-001',
    type: 'DISPATCH',
    title: 'Multi-unit dispatch recommended',
    description: 'CRITICAL medical incident at 5th Ave. AI recommends 2× ambulance + 1× police unit. Nearest available: Unit A-12 (1.2km), Unit A-07 (2.1km).',
    confidence: 0.94,
    riskScore: 87,
    priority: 'CRITICAL',
    actions: [
      { id: 'a1', label: 'Accept & Dispatch', type: 'PRIMARY' },
      { id: 'a2', label: 'Modify',            type: 'SECONDARY' },
      { id: 'a3', label: 'Dismiss',           type: 'DISMISS' },
    ],
    timestamp: new Date(Date.now() - 45000).toISOString(),
    isActedOn: false,
    modelVersion: '2.0.0',
    factors: ['AMBULANCE', 'POLICE', 'proximity', 'severity'],
  },
  {
    id: 'demo-2',
    incidentId: 'inc-002',
    type: 'PREDICTION',
    title: 'Flood risk escalation predicted',
    description: 'Rainfall accumulation 142mm/24h. U-Net model predicts 78% flood probability in Zone 4 within 6 hours. Pre-position rescue teams.',
    confidence: 0.78,
    riskScore: 72,
    priority: 'HIGH',
    actions: [
      { id: 'b1', label: 'Pre-position Teams', type: 'PRIMARY' },
      { id: 'b2', label: 'Issue Advisory',     type: 'SECONDARY' },
      { id: 'b3', label: 'Dismiss',            type: 'DISMISS' },
    ],
    timestamp: new Date(Date.now() - 3 * 60000).toISOString(),
    isActedOn: false,
    modelVersion: '2.0.0',
    factors: ['rainfall_142mm', 'river_level_6.2m', 'soil_saturation_88pct'],
  },
  {
    id: 'demo-3',
    incidentId: 'inc-003',
    type: 'ESCALATE',
    title: 'Incident escalation required',
    description: 'Chemical spill at Port Authority. HazMat unit ETA 18min. Risk score 91/100. Recommend activating National Guard standby.',
    confidence: 0.89,
    riskScore: 91,
    priority: 'CRITICAL',
    actions: [
      { id: 'c1', label: 'Escalate to Commander', type: 'PRIMARY' },
      { id: 'c2', label: 'Alert National Guard',  type: 'SECONDARY' },
      { id: 'c3', label: 'Dismiss',               type: 'DISMISS' },
    ],
    timestamp: new Date(Date.now() - 8 * 60000).toISOString(),
    isActedOn: false,
    modelVersion: '2.0.0',
    factors: ['CHEMICAL', 'HAZMAT', 'risk_score_91', 'escalation_flag'],
  },
];

export function AISuggestionsPanel() {
  const { aiSuggestions, markSuggestionActedOn, dismissSuggestion, addLogEntry } = useOperatorStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingOn, setActingOn] = useState<string | null>(null);

  const suggestions = aiSuggestions.length > 0 ? aiSuggestions : DEMO_SUGGESTIONS;
  const pending = suggestions.filter(s => !s.isActedOn);
  const actedOn = suggestions.filter(s => s.isActedOn);

  const handleAction = async (suggestion: AISuggestion, actionId: string) => {
    const action = suggestion.actions.find(a => a.id === actionId);
    if (!action) return;

    if (action.type === 'DISMISS') {
      dismissSuggestion(suggestion.id);
      return;
    }

    setActingOn(suggestion.id);
    try {
      if (action.endpoint) {
        await api.post(action.endpoint, action.payload ?? {});
      }
      markSuggestionActedOn(suggestion.id);
      addLogEntry({
        type: 'AI',
        severity: 'INFO',
        message: `AI suggestion acted on: ${suggestion.title} · ${action.label}`,
        timestamp: new Date().toISOString(),
        incidentId: suggestion.incidentId,
      });
    } catch {
      // Silently handle
    } finally {
      setActingOn(null);
    }
  };

  return (
    <div className="panel h-full">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Zap className="w-3 h-3 text-[#ffd600]" />
          <span className="panel-title">AI Suggestions</span>
        </div>
        <div className="flex items-center gap-2">
          {pending.length > 0 && (
            <span className="text-[8px] font-mono text-[#ffd600] border border-[#ffd600]/30 px-1.5 py-0.5">
              {pending.length} pending
            </span>
          )}
          <span className="text-[7px] font-mono text-[#222]">v{DEMO_SUGGESTIONS[0]?.modelVersion}</span>
        </div>
      </div>

      <div className="panel-body">
        {pending.length === 0 && actedOn.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            {/* Pending suggestions */}
            {pending.map((s, i) => (
              <SuggestionCard
                key={s.id}
                suggestion={s}
                index={i}
                isExpanded={expandedId === s.id}
                isActing={actingOn === s.id}
                onToggle={() => setExpandedId(expandedId === s.id ? null : s.id)}
                onAction={(actionId) => handleAction(s, actionId)}
              />
            ))}

            {/* Acted-on (collapsed) */}
            {actedOn.length > 0 && (
              <div className="border-t border-[#0d0d0d] mt-1">
                <div className="px-3 py-2 text-[8px] font-mono text-[#222] tracking-widest uppercase">
                  Completed ({actedOn.length})
                </div>
                {actedOn.slice(0, 5).map(s => (
                  <div key={s.id} className="flex items-center gap-2 px-3 py-2 border-b border-[#0d0d0d] opacity-40">
                    <Check className="w-3 h-3 text-[#00c853]" />
                    <span className="text-[9px] text-[#555] truncate">{s.title}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Suggestion card ───────────────────────────────────────────

function SuggestionCard({
  suggestion, index, isExpanded, isActing, onToggle, onAction,
}: {
  suggestion: AISuggestion;
  index: number;
  isExpanded: boolean;
  isActing: boolean;
  onToggle: () => void;
  onAction: (actionId: string) => void;
}) {
  const Icon = TYPE_ICONS[suggestion.type] ?? Zap;
  const typeColor = TYPE_COLORS[suggestion.type] ?? '#888';
  const priorityColor = PRIORITY_COLORS[suggestion.priority] ?? '#888';
  const confidenceClass = suggestion.confidence > 0.8 ? 'confidence-high' : suggestion.confidence > 0.6 ? 'confidence-medium' : 'confidence-low';

  return (
    <motion.div
      initial={{ opacity: 0, x: 8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`ai-card ${confidenceClass} border-b border-[#0d0d0d]`}
    >
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-start gap-2 text-left"
      >
        <Icon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: typeColor }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className="text-[7px] font-mono tracking-widest uppercase px-1 border"
              style={{ borderColor: `${priorityColor}40`, color: priorityColor }}
            >
              {suggestion.priority}
            </span>
            <span className="text-[7px] font-mono text-[#333]">
              {formatDistanceToNow(new Date(suggestion.timestamp), { addSuffix: true })}
            </span>
          </div>
          <div className="text-[10px] font-bold text-[#ccc] leading-tight">{suggestion.title}</div>
        </div>
        {isExpanded
          ? <ChevronUp className="w-3 h-3 text-[#333] flex-shrink-0 mt-0.5" />
          : <ChevronDown className="w-3 h-3 text-[#333] flex-shrink-0 mt-0.5" />
        }
      </button>

      {/* Confidence bar */}
      <div className="ai-confidence-bar mt-2">
        <div
          className="ai-confidence-fill"
          style={{ width: `${suggestion.confidence * 100}%` }}
        />
      </div>
      <div className="flex items-center justify-between mt-1">
        <span className="text-[7px] font-mono text-[#333]">
          Confidence: {(suggestion.confidence * 100).toFixed(0)}%
        </span>
        <span className="text-[7px] font-mono text-[#333]">
          Risk: {suggestion.riskScore}/100
        </span>
      </div>

      {/* Expanded content */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <p className="text-[10px] text-[#666] leading-relaxed mt-3 mb-3">
              {suggestion.description}
            </p>

            {/* Factors */}
            {suggestion.factors.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-3">
                {suggestion.factors.map(f => (
                  <span key={f} className="text-[7px] font-mono text-[#333] border border-[#1a1a1a] px-1.5 py-0.5">
                    {f}
                  </span>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex flex-col gap-1.5">
              {suggestion.actions.map(action => (
                <button
                  key={action.id}
                  onClick={() => onAction(action.id)}
                  disabled={isActing}
                  className={`
                    w-full py-2 text-[9px] font-mono tracking-widest uppercase
                    transition-all disabled:opacity-50
                    ${action.type === 'PRIMARY'
                      ? 'bg-white text-black hover:bg-[#e0e0e0]'
                      : action.type === 'DISMISS'
                      ? 'border border-[#1a1a1a] text-[#444] hover:border-[#333] hover:text-[#888]'
                      : 'border border-[#333] text-[#888] hover:border-white hover:text-white'
                    }
                  `}
                >
                  {isActing && action.type === 'PRIMARY' ? 'Processing...' : action.label}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-40 gap-3">
      <Zap className="w-6 h-6 text-[#1a1a1a]" />
      <span className="text-[9px] font-mono text-[#222] tracking-widest uppercase">No pending suggestions</span>
    </div>
  );
}
