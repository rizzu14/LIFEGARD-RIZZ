// ============================================================
// LIFEGRID – Offline Detection + Queue Sync Hook
// ============================================================

import { useEffect, useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { api } from '../lib/api';

export function useOffline() {
  const { isOnline, setOnline, offlineQueue, dequeueOffline } = useAppStore();

  // Listen for network changes
  useEffect(() => {
    const handleOnline  = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener('online',  handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online',  handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [setOnline]);

  // Flush offline queue when back online
  const flushQueue = useCallback(async () => {
    if (!isOnline || offlineQueue.length === 0) return;

    for (const item of offlineQueue) {
      try {
        if (item.type === 'SOS' || item.type === 'REPORT') {
          await api.post('/incidents/report', item.payload);
        } else if (item.type === 'LOCATION') {
          await api.patch(`/responders/${item.payload.responderId}/location`, item.payload);
        }
        dequeueOffline(item.id);
      } catch {
        // Leave in queue for next attempt
      }
    }
  }, [isOnline, offlineQueue, dequeueOffline]);

  useEffect(() => {
    if (isOnline) {
      flushQueue();
    }
  }, [isOnline, flushQueue]);

  return { isOnline, queueLength: offlineQueue.length };
}
