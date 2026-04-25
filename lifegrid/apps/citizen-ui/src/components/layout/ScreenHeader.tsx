// ============================================================
// LIFEGRID – Screen Header
// ============================================================

import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { useHaptic } from '../../hooks/useHaptic';

interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: React.ReactNode;
  transparent?: boolean;
}

export function ScreenHeader({
  title, subtitle, onBack, right, transparent = false,
}: ScreenHeaderProps) {
  const { haptic } = useHaptic();

  const handleBack = () => {
    haptic('tap');
    onBack?.();
  };

  return (
    <div
      className={`status-bar ${transparent ? 'bg-transparent border-transparent' : ''}`}
      role="banner"
    >
      {onBack && (
        <button
          onClick={handleBack}
          className="mr-3 p-2 -ml-2 hover:bg-gray-100 transition-colors rounded"
          aria-label="Go back"
        >
          <ArrowLeft className="w-5 h-5 text-gray-700" />
        </button>
      )}

      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-bold tracking-widest uppercase truncate text-gray-900">{title}</h1>
        {subtitle && (
          <p className="text-[10px] font-mono text-gray-400 tracking-widest truncate">{subtitle}</p>
        )}
      </div>

      {right && <div className="ml-3 flex-shrink-0">{right}</div>}
    </div>
  );
}
