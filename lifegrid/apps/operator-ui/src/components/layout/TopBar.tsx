// ============================================================
// LIFEGRID – Command Center Top Bar v2
// Dual panel tab control + live metrics + alert level
// ============================================================

import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, Radio, Megaphone } from 'lucide-react';
import { useSocket } from '../../hooks/useSocket';
import { useAuthStore } from '../../store/authStore';
import { useOperatorStore, LeftPanelTab, RightPanelTab } from '../../store/operatorStore';
import type { SystemMetrics, AlertLevel } from '@lifegrid/shared-types';

interface TopBarProps {
  metrics: SystemMetrics | null;
  alertLevel: AlertLevel;
  leftPanelTab: LeftPanelTab;
  rightPanelTab: RightPanelTab;
  onLeftTabChange: (tab: LeftPanelTab) => void;
  onRightTabChange: (tab: RightPanelTab) => void;
  leftTabs: { id: LeftPanelTab; label: string }[];
  rightTabs: { id: RightPanelTab; label: string }[];
}

const ALERT_COLORS: Record<string, string> = {
  GREEN:  '#00c853',
  YELLOW: '#ffd600',
  ORANGE: '#ff6d00',
  RED:    '#ff1744',
  BLACK:  '#ffffff',
};

const ALERT_LABELS: Record<string, string> = {
  GREEN:  'NORMAL',
  YELLOW: 'ELEVATED',
  ORANGE: 'HIGH ALERT',
  RED:    'CRITICAL',
  BLACK:  'CATASTROPHE',
};

export function TopBar({
  metrics, alertLevel,
  leftPanelTab, rightPanelTab,
  onLeftTabChange, onRightTabChange,
  leftTabs, rightTabs,
}: TopBarProps) {
  const { connected } = useSocket();
  const { user } = useAuthStore();
  const { setBroadcastModalOpen, aiSuggestions, commChannels } = useOperatorStore();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const alertColor = ALERT_COLORS[alertLevel] ?? '#888';
  const unreadComm = commChannels.reduce((sum, c) => sum + c.unreadCount, 0);
  const pendingAI  = aiSuggestions.filter(s => !s.isActedOn).length;

  return (
    <div className="h-12 border-b border-[#1a1a1a] flex items-center bg-[#030303] select-none">

      {/* ── Brand ──────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 border-r border-[#1a1a1a] h-full">
        <div className="w-5 h-5 border border-[#2a2a2a] flex items-center justify-center flex-shrink-0">
          <span className="text-[7px] font-mono font-bold text-white">LG</span>
        </div>
        <div className="hidden xl:block">
          <div className="text-[9px] font-mono font-bold tracking-[0.25em] uppercase text-white leading-none">LIFEGRID</div>
          <div className="text-[7px] font-mono text-[#2a2a2a] tracking-widest leading-none mt-0.5">COMMAND CENTER</div>
        </div>
      </div>

      {/* ── Alert level ────────────────────────────────────── */}
      <div
        className={`flex items-center gap-2 px-3 h-full border-r border-[#1a1a1a] alert-banner-${alertLevel}`}
        style={{ borderRightColor: '#1a1a1a' }}
      >
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{
            background: alertColor,
            boxShadow: alertLevel !== 'GREEN' ? `0 0 6px ${alertColor}80` : 'none',
          }}
        />
        <div className="hidden sm:block">
          <div className="text-[7px] font-mono text-[#444] tracking-widest uppercase leading-none">Alert</div>
          <div className="text-[9px] font-mono font-bold tracking-widest uppercase leading-none" style={{ color: alertColor }}>
            {ALERT_LABELS[alertLevel]}
          </div>
        </div>
      </div>

      {/* ── Live metrics ───────────────────────────────────── */}
      <div className="flex items-center border-r border-[#1a1a1a] h-full">
        {[
          { label: 'ACTIVE',    value: metrics?.activeIncidents   ?? '—', color: '#e8e8e8' },
          { label: 'CRITICAL',  value: metrics?.criticalIncidents ?? '—', color: '#ff1744' },
          { label: 'AVAIL',     value: metrics?.availableResponders ?? '—', color: '#00c853' },
          { label: 'DEPLOYED',  value: metrics?.dispatchedResponders ?? '—', color: '#00aaff' },
          { label: 'AVG ETA',   value: metrics?.avgResponseTimeSeconds ? `${Math.round(metrics.avgResponseTimeSeconds / 60)}m` : '—', color: '#888' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex flex-col justify-center px-3 h-full border-r border-[#0d0d0d] last:border-r-0">
            <span className="text-[7px] font-mono text-[#2a2a2a] tracking-widest uppercase leading-none">{label}</span>
            <span className="text-[13px] font-mono font-bold leading-tight tabular-nums" style={{ color }}>{value}</span>
          </div>
        ))}
      </div>

      {/* ── Left panel tabs ────────────────────────────────── */}
      <div className="flex items-center h-full border-r border-[#1a1a1a] px-1">
        <span className="text-[7px] font-mono text-[#222] tracking-widest uppercase px-2 hidden lg:block">LEFT</span>
        {leftTabs.map(({ id, label }, i) => (
          <button
            key={id}
            onClick={() => onLeftTabChange(id)}
            className={`
              flex items-center gap-1 px-2.5 h-8 text-[8px] font-mono tracking-widest uppercase
              transition-colors border-b-2 relative
              ${leftPanelTab === id
                ? 'border-white text-white'
                : 'border-transparent text-[#333] hover:text-[#666]'
              }
            `}
            title={`${label} [${i + 1}]`}
          >
            {label}
            <span className="kbd hidden xl:inline">{i + 1}</span>
          </button>
        ))}
      </div>

      {/* ── Spacer ─────────────────────────────────────────── */}
      <div className="flex-1" />

      {/* ── Right panel tabs ───────────────────────────────── */}
      <div className="flex items-center h-full border-l border-[#1a1a1a] px-1">
        {rightTabs.map(({ id, label }, i) => {
          const badge = id === 'ai' ? pendingAI : id === 'comm' ? unreadComm : 0;
          const keys = ['q', 'w', 'e', 'r'];
          return (
            <button
              key={id}
              onClick={() => onRightTabChange(id)}
              className={`
                flex items-center gap-1.5 px-2.5 h-8 text-[8px] font-mono tracking-widest uppercase
                transition-colors border-b-2 relative
                ${rightPanelTab === id
                  ? 'border-white text-white'
                  : 'border-transparent text-[#333] hover:text-[#666]'
                }
              `}
              title={`${label} [${keys[i]}]`}
            >
              {label}
              {badge > 0 && (
                <span className="w-3.5 h-3.5 rounded-full bg-[#ff1744] text-white text-[7px] flex items-center justify-center font-bold">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
              <span className="kbd hidden xl:inline">{keys[i]}</span>
            </button>
          );
        })}
        <span className="text-[7px] font-mono text-[#222] tracking-widest uppercase px-2 hidden lg:block">RIGHT</span>
      </div>

      {/* ── Actions ────────────────────────────────────────── */}
      <div className="flex items-center gap-1 px-2 border-l border-[#1a1a1a] h-full">
        <button
          onClick={() => setBroadcastModalOpen(true)}
          className="flex items-center gap-1.5 px-2 h-7 border border-[#1a1a1a] hover:border-[#333] text-[8px] font-mono text-[#555] hover:text-white transition-all tracking-widest uppercase"
          title="Broadcast to all agencies"
        >
          <Megaphone className="w-3 h-3" />
          <span className="hidden lg:inline">Broadcast</span>
        </button>
      </div>

      {/* ── Status + clock ─────────────────────────────────── */}
      <div className="flex items-center gap-3 px-3 border-l border-[#1a1a1a] h-full">
        <div className="flex items-center gap-1.5">
          {connected
            ? <Wifi className="w-3 h-3 text-[#00c853]" />
            : <WifiOff className="w-3 h-3 text-[#ff1744] animate-pulse" />
          }
          <span className={`text-[8px] font-mono ${connected ? 'text-[#00c853]' : 'text-[#ff1744]'}`}>
            {connected ? 'LIVE' : 'OFFLINE'}
          </span>
        </div>

        <div className="text-[9px] font-mono text-[#444] tabular-nums">
          {time.toLocaleTimeString('en-US', { hour12: false })}
        </div>

        <div className="flex items-center gap-1.5 pl-2 border-l border-[#1a1a1a]">
          <div className="w-5 h-5 border border-[#222] flex items-center justify-center">
            <span className="text-[8px] font-mono text-[#666]">
              {user?.name?.charAt(0).toUpperCase() ?? 'O'}
            </span>
          </div>
          <div className="hidden xl:block">
            <div className="text-[8px] font-mono text-[#666] leading-none">{user?.name ?? 'OPERATOR'}</div>
            <div className="text-[7px] font-mono text-[#2a2a2a] leading-none">{user?.role}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
