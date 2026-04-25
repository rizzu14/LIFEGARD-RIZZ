import React from 'react';
import { AlertTriangle } from 'lucide-react';
import type { AlertLevel } from '@lifegrid/shared-types';

const LEVEL_CONFIG: Record<string, { label: string; color: string; pulse: boolean }> = {
  GREEN:  { label: 'NORMAL OPERATIONS',     color: '#00c853', pulse: false },
  YELLOW: { label: 'ELEVATED READINESS',    color: '#ffd600', pulse: false },
  ORANGE: { label: 'HIGH ALERT',            color: '#ff6d00', pulse: true },
  RED:    { label: 'CRITICAL EMERGENCY',    color: '#ff1744', pulse: true },
  BLACK:  { label: 'NATIONAL CATASTROPHE',  color: '#ffffff', pulse: true },
};

export function AlertBanner({ level }: { level: AlertLevel }) {
  const config = LEVEL_CONFIG[level] ?? LEVEL_CONFIG.GREEN;

  return (
    <div
      className={`flex items-center gap-2 px-4 py-2 border ${config.pulse ? 'animate-alert-pulse' : ''}`}
      style={{
        borderColor: `${config.color}60`,
        background: `${config.color}10`,
        color: config.color,
      }}
    >
      <AlertTriangle className="w-3 h-3" />
      <span className="text-[9px] font-mono font-bold tracking-[0.3em] uppercase">
        ALERT LEVEL {level}: {config.label}
      </span>
    </div>
  );
}
