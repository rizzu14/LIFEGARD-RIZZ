import React from 'react';

const COLORS: Record<string, { border: string; text: string; bg: string }> = {
  CRITICAL: { border: '#fca5a5', text: '#dc2626', bg: '#fef2f2' },
  HIGH:     { border: '#fdba74', text: '#ea580c', bg: '#fff7ed' },
  MEDIUM:   { border: '#fcd34d', text: '#d97706', bg: '#fffbeb' },
  LOW:      { border: '#86efac', text: '#16a34a', bg: '#f0fdf4' },
};

interface SeverityBadgeProps {
  severity: string;
  size?: 'sm' | 'md';
}

export function SeverityBadge({ severity, size = 'sm' }: SeverityBadgeProps) {
  const colors = COLORS[severity] ?? { border: '#e5e7eb', text: '#6b7280', bg: '#f9fafb' };
  const textSize = size === 'sm' ? 'text-[9px]' : 'text-xs';

  return (
    <span
      className={`${textSize} font-mono font-bold tracking-widest uppercase px-2 py-0.5 border rounded`}
      style={{ borderColor: colors.border, color: colors.text, background: colors.bg }}
    >
      {severity}
    </span>
  );
}
