// ============================================================
// LIFEGRID – Multi-Agency Coordination Panel
// ============================================================

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Radio, ChevronDown, ChevronUp, Phone, MessageSquare } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useOperatorStore, Agency } from '../../store/operatorStore';

const STATUS_COLORS: Record<string, string> = {
  ONLINE:  '#00c853',
  BUSY:    '#ffd600',
  OFFLINE: '#333',
  STANDBY: '#888',
};

const STATUS_LABELS: Record<string, string> = {
  ONLINE:  'Online',
  BUSY:    'Busy',
  OFFLINE: 'Offline',
  STANDBY: 'Standby',
};

const TYPE_LABELS: Record<string, string> = {
  POLICE:       'Police',
  FIRE:         'Fire',
  EMS:          'EMS',
  MILITARY:     'Military',
  HAZMAT:       'HazMat',
  DISASTER_MGMT:'FEMA',
  CYBER:        'Cyber',
  COAST_GUARD:  'Coast Guard',
};

export function AgencyPanel() {
  const { agencies, updateAgencyStatus, setActiveChannel, setRightPanelTab } = useOperatorStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const onlineCount  = agencies.filter(a => a.status === 'ONLINE').length;
  const busyCount    = agencies.filter(a => a.status === 'BUSY').length;
  const standbyCount = agencies.filter(a => a.status === 'STANDBY').length;

  const openComm = (agencyId: string) => {
    const channelId = `ch-${agencyId}`;
    setActiveChannel(channelId);
    setRightPanelTab('comm');
  };

  return (
    <div className="panel h-full">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Radio className="w-3 h-3 text-[#888]" />
          <span className="panel-title">Agencies ({agencies.length})</span>
        </div>
        <div className="flex items-center gap-2 text-[8px] font-mono">
          <span style={{ color: STATUS_COLORS.ONLINE }}>{onlineCount}</span>
          <span className="text-[#222]">/</span>
          <span style={{ color: STATUS_COLORS.BUSY }}>{busyCount}</span>
          <span className="text-[#222]">/</span>
          <span style={{ color: STATUS_COLORS.STANDBY }}>{standbyCount}</span>
        </div>
      </div>

      {/* Summary bar */}
      <div className="flex border-b border-[#1a1a1a]">
        {[
          { label: 'ONLINE',  count: onlineCount,  color: STATUS_COLORS.ONLINE },
          { label: 'BUSY',    count: busyCount,    color: STATUS_COLORS.BUSY },
          { label: 'STANDBY', count: standbyCount, color: STATUS_COLORS.STANDBY },
        ].map(({ label, count, color }) => (
          <div key={label} className="flex-1 flex flex-col items-center py-2 border-r border-[#0d0d0d] last:border-r-0">
            <span className="text-[14px] font-mono font-bold" style={{ color }}>{count}</span>
            <span className="text-[7px] font-mono text-[#333] tracking-widest uppercase">{label}</span>
          </div>
        ))}
      </div>

      <div className="panel-body">
        {agencies.map((agency, i) => (
          <AgencyRow
            key={agency.id}
            agency={agency}
            index={i}
            isExpanded={expandedId === agency.id}
            onToggle={() => setExpandedId(expandedId === agency.id ? null : agency.id)}
            onComm={() => openComm(agency.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Agency row ────────────────────────────────────────────────

function AgencyRow({
  agency, index, isExpanded, onToggle, onComm,
}: {
  agency: Agency;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
  onComm: () => void;
}) {
  const statusColor = STATUS_COLORS[agency.status] ?? '#333';
  const totalUnits = agency.availableUnits + agency.deployedUnits;
  const deployedPct = totalUnits > 0 ? (agency.deployedUnits / totalUnits) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.04 }}
      className="border-b border-[#0d0d0d]"
    >
      {/* Header row */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-[#080808] transition-colors text-left"
      >
        {/* Agency color + status */}
        <div className="flex flex-col items-center gap-1 flex-shrink-0">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: agency.color, boxShadow: `0 0 4px ${agency.color}60` }}
          />
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{ background: statusColor }}
          />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-bold text-[#ccc] truncate">{agency.shortName}</span>
            <span
              className="text-[7px] font-mono tracking-widest uppercase px-1 border flex-shrink-0"
              style={{ borderColor: `${statusColor}40`, color: statusColor }}
            >
              {STATUS_LABELS[agency.status]}
            </span>
          </div>
          <div className="text-[8px] text-[#444] truncate">{agency.name}</div>
        </div>

        {/* Unit count */}
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] font-mono font-bold text-[#888]">
            {agency.availableUnits}<span className="text-[#333]">/{totalUnits}</span>
          </div>
          <div className="text-[7px] font-mono text-[#333]">avail</div>
        </div>

        {isExpanded
          ? <ChevronUp className="w-3 h-3 text-[#333] flex-shrink-0" />
          : <ChevronDown className="w-3 h-3 text-[#333] flex-shrink-0" />
        }
      </button>

      {/* Expanded detail */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 space-y-2">
              {/* Deployment bar */}
              <div>
                <div className="flex justify-between text-[8px] font-mono text-[#444] mb-1">
                  <span>Deployment</span>
                  <span>{agency.deployedUnits}/{totalUnits} units</span>
                </div>
                <div className="h-1 bg-[#1a1a1a] overflow-hidden">
                  <div
                    className="h-full transition-all duration-500"
                    style={{
                      width: `${deployedPct}%`,
                      background: deployedPct > 80 ? '#ff1744' : deployedPct > 50 ? '#ffd600' : '#00c853',
                    }}
                  />
                </div>
              </div>

              {/* Details */}
              <div className="space-y-1 text-[9px]">
                <div className="flex justify-between">
                  <span className="text-[#444]">Commander</span>
                  <span className="text-[#888]">{agency.commanderName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#444]">Location</span>
                  <span className="text-[#888] truncate max-w-[120px]">{agency.location}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#444]">Last contact</span>
                  <span className="text-[#888]">
                    {formatDistanceToNow(new Date(agency.lastContact), { addSuffix: true })}
                  </span>
                </div>
                {agency.contactFrequency && (
                  <div className="flex justify-between">
                    <span className="text-[#444]">Frequency</span>
                    <span className="text-[#888] font-mono">{agency.contactFrequency}</span>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={onComm}
                  className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-[#1a1a1a] text-[8px] font-mono text-[#555] hover:border-[#333] hover:text-white transition-all tracking-widest uppercase"
                >
                  <MessageSquare className="w-3 h-3" />
                  Message
                </button>
                {agency.contactFrequency && (
                  <button className="flex-1 flex items-center justify-center gap-1.5 py-1.5 border border-[#1a1a1a] text-[8px] font-mono text-[#555] hover:border-[#333] hover:text-white transition-all tracking-widest uppercase">
                    <Phone className="w-3 h-3" />
                    Call
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
