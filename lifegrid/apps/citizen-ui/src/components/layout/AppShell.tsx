import React, { useEffect, Suspense } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAppStore, AppTab } from '../../store/appStore';
import { BottomNav } from './BottomNav';
import { OfflineBanner } from '../ui/OfflineBanner';
import { useOffline } from '../../hooks/useOffline';
import { useGeolocation } from '../../hooks/useGeolocation';
import { useSocket } from '../../hooks/useSocket';
import { LoadingScreen } from '../ui/LoadingScreen';
import { CallOverlay } from '../call/CallOverlay';
import { useEmergencyCall } from '../../hooks/useEmergencyCall';
import { LiveStatusPanel } from '../emergency/LiveStatusPanel';

const HomeScreen   = React.lazy(() => import('../../screens/HomeScreen'));
const TrackScreen  = React.lazy(() => import('../../screens/TrackScreen'));
const ChatScreen   = React.lazy(() => import('../../screens/ChatScreen'));
const ReportScreen = React.lazy(() => import('../../screens/ReportScreen'));
const AlertsScreen = React.lazy(() => import('../../screens/AlertsScreen'));

const SCREENS: Record<AppTab, React.ComponentType> = {
  home:    HomeScreen,
  track:   TrackScreen,
  chat:    ChatScreen,
  report:  ReportScreen,
  alerts:  AlertsScreen,
};

// Bottom nav height
const NAV_H = 64;

export function AppShell() {
  const { activeTab, setUserLocation, updateResponderPosition, addAlert, addChatMessage } = useAppStore();
  const { isOnline } = useOffline();
  const { location } = useGeolocation();
  const { socket } = useSocket();

  // ── Emergency call engine ─────────────────────────────────
  const { startCall } = useEmergencyCall();

  // Auto-start call when callSession enters 'initiating' state
  useEffect(() => {
    return useAppStore.subscribe(
      (state) => state.callSession,
      (session) => {
        if (session?.state === 'initiating' && session.incidentId) {
          startCall(session.incidentId);
        }
      },
    );
  }, [startCall]);

  useEffect(() => {
    if (location) setUserLocation(location);
  }, [location, setUserLocation]);

  useEffect(() => {
    if (!socket) return;
    socket.on('RESPONDER_LOCATION_UPDATE', (e: any) => {
      updateResponderPosition({
        responderId: e.payload?.responderId ?? '',
        type: e.payload?.type ?? 'UNKNOWN',
        lat: e.payload?.lat ?? 0,
        lng: e.payload?.lng ?? 0,
        etaSeconds: e.payload?.etaSeconds ?? 0,
        status: e.payload?.status ?? 'EN_ROUTE',
        timestamp: e.timestamp,
      });
    });
    socket.on('GUIDANCE_MESSAGE', (e: any) => {
      addChatMessage({
        id: e.payload?.message?.messageId ?? String(Date.now()),
        role: 'system',
        content: e.payload?.message?.content ?? '',
        timestamp: e.timestamp,
        isRead: false,
        language: e.payload?.message?.language ?? 'en',
      });
    });
    socket.on('SENSOR_ALERT', (e: any) => {
      if (e.payload?.isAlert) {
        addAlert({
          id: String(Date.now()),
          type: e.payload?.payload?.deviceType ?? 'SENSOR',
          severity: 'HIGH',
          title: `Sensor Alert: ${e.payload?.payload?.deviceType ?? 'Unknown'}`,
          description: `Anomaly from device ${e.payload?.payload?.deviceId ?? 'unknown'}`,
          timestamp: e.timestamp,
          isRead: false,
          source: 'SENSOR',
        });
      }
    });
    socket.on('SYSTEM_ALERT', (e: any) => {
      addAlert({
        id: String(Date.now()),
        type: 'SYSTEM',
        severity: e.payload?.severity ?? 'MEDIUM',
        title: e.payload?.title ?? 'System Alert',
        description: e.payload?.message ?? '',
        timestamp: e.timestamp,
        isRead: false,
        source: 'SYSTEM',
      });
    });

    // ── Call events ───────────────────────────────────────
    socket.on('CALL_ANSWER', (data: any) => {
      const { updateCallState, updateCallSession } = useAppStore.getState();
      updateCallState('connected');
      updateCallSession({
        operatorId:   data.operatorId,
        operatorName: data.operatorName ?? 'LIFEGRID Operator',
        connectedAt:  new Date().toISOString(),
      });
    });

    socket.on('CALL_OPERATOR_TRANSCRIPT', (data: any) => {
      const { addTranscriptLine } = useAppStore.getState();
      addTranscriptLine({
        id:        data.id ?? String(Date.now()),
        speaker:   'operator',
        text:      data.text,
        timestamp: data.timestamp ?? new Date().toISOString(),
        isFinal:   true,
        language:  data.language ?? 'en',
      });
    });

    socket.on('CALL_AI_SUGGESTION', (data: any) => {
      const { addAISuggestion } = useAppStore.getState();
      addAISuggestion(data.suggestion);
    });

    socket.on('CALL_ENDED_BY_OPERATOR', () => {
      const { endCall } = useAppStore.getState();
      endCall();
    });
    return () => {
      socket.off('RESPONDER_LOCATION_UPDATE');
      socket.off('GUIDANCE_MESSAGE');
      socket.off('SENSOR_ALERT');
      socket.off('SYSTEM_ALERT');
      socket.off('CALL_ANSWER');
      socket.off('CALL_OPERATOR_TRANSCRIPT');
      socket.off('CALL_AI_SUGGESTION');
      socket.off('CALL_ENDED_BY_OPERATOR');
    };
  }, [socket, updateResponderPosition, addChatMessage, addAlert]);

  const Screen = SCREENS[activeTab];

  return (
    // Root: full viewport, flex column, white background
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        overflow: 'hidden',
      }}
    >
      {/* Offline banner (shrinks available space) */}
      {!isOnline && <OfflineBanner />}

      {/* Screen area: fills everything above the nav bar */}
      <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.15 }}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              overflow: 'hidden',
            }}
          >
            <Suspense fallback={<LoadingScreen />}>
              <Screen />
            </Suspense>
          </motion.div>
        </AnimatePresence>

        {/* Floating status pill — only on non-home screens, never blocks UI */}
        {activeTab !== 'home' && <LiveStatusPanel variant="pill" />}
      </div>

      {/* Bottom nav: always at the bottom, never overlaps content */}
      <BottomNav />

      {/* Emergency call overlay — floats above everything */}
      <AnimatePresence>
        <CallOverlay />
      </AnimatePresence>
    </div>
  );
}
