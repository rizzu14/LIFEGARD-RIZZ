// ============================================================
// LIFEGRID – Alert Priority Queue
// AI-scored incident prioritization system
// ============================================================

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowUp, Clock, Users, User } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useOperatorStore } from '../../store/operatorStore';
import { useAuthStore } from '../../store/authStore';
import { api } from '../../lib/api';

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ff1744', HIGH: '#ff6d00', MEDIUM: '#ffd600', LOW: '#00c853',
};

const SCORE_COLOR = (score: number) =>
  score >= 80 ? '#ff1744' : score >= 60 ? '#ff6d00' : score >= 40 ? '#ffd600' : '#00c853';

interface PriorityQueueProps {
  onSelect: (id: string) => void;
}

export function PriorityQueue({ onSelect }: PriorityQueueProps) {
  const { priorityQueue, updatePriorityItem, addLogEntry } = useOperatorStore();
  const { user } = useAuthStore();

  const sorted = useMemo(() =>
    [...priorityQueue].sort((a, b) => b.priorityScore - a.priorityScore),
    [priorityQueue],
  );

  const handleAssign = async (itemId: string, incidentId: string) => {
    try {
      await api.patch(`/incidents/${incidentId}`, {
        assignedOperatorId: user?.id,
        notes: `Assigned by ${user?.name ?? 'operator'} via priority queue`,
      });
      updatePriorityItem(itemId, { isAssigned: true, assignedOperatorId: user?.id });
      addLogEntry({
        type: 'INCIDENT',
        severity: 'INFO',
        message: `Incident ${incidentId.slice(0, 8)} assigned to ${user?.name ?? 'operator'}`,
        timestamp: new Date().toISOString(),
        incidentId,
      });
    } catch {
      // Silently handle
    }
  };

  return (
    <div className="panel h-full">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <ArrowUp className="w-3 h-3 text-[#ff1744]" />
          <span className="panel-title">Priority Queue</span>
        </div>
        <span className="text-[8px] font-mono text-[#333]">{sorted.length} items</span>
      </div>

      <div className="panel-body">
        {sorted.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-[9px] font-mono text-[#222]">
            QUEUE EMPTY
          </div>
        ) : (
          sorted.map((item, i) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.03 }}
              className="priority-item"
              onClick={() => onSelect(item.incidentId)}
            >
              {/* Priority bar */}
              <div
                className="priority-bar"
                style={{ background: SCORE_COLOR(item.priorityScore) }}
              />

              {/* Content */}
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span
                    className="text-[7px] font-mono tracking-widest uppercase px-1 border"
                    style={{
                      borderColor: `${SEVERITY_COLORS[item.severity]}40`,
                      color: SEVERITY_COLORS[item.severity],
                    }}
                  >
                    {item.severity}
                  </span>
                  <span className="text-[8px] font-mono text-[#555] truncate">{item.referenceCode}</span>
                </div>

                <div className="text-[10px] text-[#ccc] truncate mb-1">
                  {item.type.replace('_', ' ')}
                </div>

                <div className="flex items-center gap-3 text-[8px] font-mono text-[#444]">
                  <span className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {Math.round(item.waitTimeSeconds / 60)}m
                  </span>
                  {item.estimatedImpact > 1 && (
                    <span className="flex items-center gap-1">
                      <Users className="w-2.5 h-2.5" />
                      ~{item.estimatedImpact}
                    </span>
                  )}
                  {item.isAssigned && (
                    <span className="flex items-center gap-1 text-[#00c853]">
                      <User className="w-2.5 h-2.5" />
                      Assigned
                    </span>
                  )}
                </div>
              </div>

              {/* Score + assign */}
              <div className="flex flex-col items-end gap-1.5">
                <div className="text-center">
                  <div
                    className="text-[13px] font-mono font-bold tabular-nums leading-none"
                    style={{ color: SCORE_COLOR(item.priorityScore) }}
                  >
                    {item.priorityScore}
                  </div>
                  <div className="text-[7px] font-mono text-[#333]">score</div>
                </div>

                {!item.isAssigned && (
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAssign(item.id, item.incidentId); }}
                    className="text-[7px] font-mono text-[#555] border border-[#1a1a1a] px-1.5 py-0.5 hover:border-[#333] hover:text-white transition-all"
                  >
                    Assign
                  </button>
                )}
              </div>
            </motion.div>
          ))
        )}
      </div>
    </div>
  );
}
