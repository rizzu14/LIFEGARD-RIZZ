import React from 'react';
import { WifiOff } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

export function OfflineBanner() {
  const { offlineQueue } = useAppStore();

  return (
    <div
      className="flex items-center gap-2 px-5 py-2 bg-yellow-50 border-b border-yellow-200 text-yellow-700"
      role="alert"
      aria-live="assertive"
    >
      <WifiOff className="w-3 h-3 flex-shrink-0" />
      <span className="text-[10px] font-mono tracking-widest uppercase">
        Offline mode
        {offlineQueue.length > 0 && ` · ${offlineQueue.length} item${offlineQueue.length > 1 ? 's' : ''} queued`}
      </span>
    </div>
  );
}
