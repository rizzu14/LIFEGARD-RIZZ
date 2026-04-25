import React, { useState, useMemo } from 'react';
import { Search, Filter, SortAsc } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import type { Incident, IncidentSeverity } from '@lifegrid/shared-types';

interface IncidentListProps {
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3,
};

const STATUS_COLORS: Record<string, string> = {
  TRIGGERED:  '#ff1744',
  CLASSIFIED: '#ff6d00',
  DISPATCHED: '#ffd600',
  EN_ROUTE:   '#00b0ff',
  ON_SCENE:   '#00c853',
  RESOLVED:   '#555',
  CLOSED:     '#333',
  ESCALATED:  '#ff1744',
};

export function IncidentList({ incidents, selectedId, onSelect }: IncidentListProps) {
  const [search, setSearch] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'time' | 'severity'>('severity');

  const filtered = useMemo(() => {
    let result = [...incidents];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.referenceCode.toLowerCase().includes(q) ||
        i.type.toLowerCase().includes(q) ||
        i.trigger.rawInput.toLowerCase().includes(q) ||
        i.address?.city?.toLowerCase().includes(q),
      );
    }

    if (filterSeverity !== 'ALL') {
      result = result.filter(i => i.severity === filterSeverity);
    }

    result.sort((a, b) => {
      if (sortBy === 'severity') {
        return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
      }
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return result;
  }, [incidents, search, filterSeverity, sortBy]);

  return (
    <div className="panel h-full">
      {/* Header */}
      <div className="panel-header">
        <span className="panel-title">Incidents ({filtered.length})</span>
        <button
          onClick={() => setSortBy(s => s === 'severity' ? 'time' : 'severity')}
          className="p-1 hover:bg-[#111] transition-colors"
          title={`Sort by ${sortBy === 'severity' ? 'time' : 'severity'}`}
        >
          <SortAsc className="w-3 h-3 text-[#555]" />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-[#1a1a1a] flex items-center gap-2">
        <Search className="w-3 h-3 text-[#333] flex-shrink-0" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search incidents..."
          className="flex-1 bg-transparent text-[11px] text-[#888] placeholder:text-[#333] focus:outline-none"
        />
      </div>

      {/* Severity filter */}
      <div className="flex border-b border-[#1a1a1a]">
        {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(sev => (
          <button
            key={sev}
            onClick={() => setFilterSeverity(sev)}
            className={`
              flex-1 py-1.5 text-[8px] font-mono tracking-widest uppercase transition-colors
              ${filterSeverity === sev ? 'text-white bg-[#111]' : 'text-[#333] hover:text-[#666]'}
            `}
          >
            {sev === 'ALL' ? 'ALL' : sev.charAt(0)}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="panel-body">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-[10px] text-[#333] font-mono">
            NO INCIDENTS
          </div>
        ) : (
          filtered.map(incident => (
            <IncidentRow
              key={incident.id}
              incident={incident}
              isSelected={incident.id === selectedId}
              onClick={() => onSelect(incident.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function IncidentRow({
  incident,
  isSelected,
  onClick,
}: {
  incident: Incident;
  isSelected: boolean;
  onClick: () => void;
}) {
  const statusColor = STATUS_COLORS[incident.status] ?? '#555';
  const timeAgo = formatDistanceToNow(new Date(incident.createdAt), { addSuffix: true });

  return (
    <div
      className={`incident-row ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
      aria-selected={isSelected}
    >
      {/* Severity indicator */}
      <div className={`severity-dot ${incident.severity}`} />

      {/* Content */}
      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[9px] font-mono text-[#555] truncate">{incident.referenceCode}</span>
          <span
            className="status-badge flex-shrink-0"
            style={{ borderColor: `${statusColor}40`, color: statusColor }}
          >
            {incident.status.replace('_', ' ')}
          </span>
        </div>
        <div className="text-[11px] text-[#ccc] truncate font-medium">
          {incident.type.replace('_', ' ')}
        </div>
        <div className="text-[9px] text-[#444] truncate mt-0.5">
          {incident.address?.city ?? `${incident.location.lat.toFixed(3)}, ${incident.location.lng.toFixed(3)}`}
        </div>
      </div>

      {/* Time */}
      <div className="text-[8px] font-mono text-[#333] text-right flex-shrink-0">
        {timeAgo.replace(' ago', '')}
      </div>
    </div>
  );
}
