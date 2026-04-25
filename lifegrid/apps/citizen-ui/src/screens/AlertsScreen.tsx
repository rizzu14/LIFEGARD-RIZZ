// ============================================================
// LIFEGRID – Screen 5: Safety Alerts Dashboard
// Real-time alerts: flood, weather, security, sensor
//
// UX Behavior:
//   - Unread alerts shown with white dot indicator
//   - Tap alert → expand detail sheet with actions
//   - Severity color-coded left border
//   - Filter by source type (top pill row)
//   - Pull-to-refresh (simulated)
//   - Mark all read button in header
//   - Critical alerts show persistent banner at top
// ============================================================

import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, BellOff, Filter, ChevronRight, X, AlertTriangle, Droplets, Wind, Shield, Cpu } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useAppStore, SafetyAlert } from '../store/appStore';
import { useHaptic } from '../hooks/useHaptic';
import { ScreenHeader } from '../components/layout/ScreenHeader';

// ── Source config ─────────────────────────────────────────────

const SOURCE_CONFIG: Record<string, { icon: React.ComponentType<any>; label: string; color: string }> = {
  FLOOD:    { icon: Droplets, label: 'Flood',    color: '#00aaff' },
  WEATHER:  { icon: Wind,     label: 'Weather',  color: '#ffd700' },
  SECURITY: { icon: Shield,   label: 'Security', color: '#ff2d2d' },
  SENSOR:   { icon: Cpu,      label: 'Sensor',   color: '#888' },
  SYSTEM:   { icon: Bell,     label: 'System',   color: '#555' },
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ff2d2d',
  HIGH:     '#ff8c00',
  MEDIUM:   '#ffd700',
  LOW:      '#00ff88',
};

// ── Demo alerts (shown when no real alerts exist) ─────────────

const DEMO_ALERTS: SafetyAlert[] = [
  {
    id: 'demo-1',
    type: 'FLASH_FLOOD',
    severity: 'HIGH',
    title: 'Flash Flood Warning',
    description: 'Flash flood conditions expected in low-lying areas. Avoid crossing flooded roads. Move to higher ground immediately.',
    location: 'Downtown District',
    timestamp: new Date(Date.now() - 5 * 60000).toISOString(),
    isRead: false,
    source: 'FLOOD',
    actions: ['Move to higher ground', 'Avoid flooded roads', 'Call 911 if trapped'],
  },
  {
    id: 'demo-2',
    type: 'SEVERE_THUNDERSTORM',
    severity: 'MEDIUM',
    title: 'Severe Thunderstorm Watch',
    description: 'Severe thunderstorm with damaging winds up to 90km/h and possible hail expected within 2 hours.',
    location: 'Metro Area',
    timestamp: new Date(Date.now() - 22 * 60000).toISOString(),
    isRead: false,
    source: 'WEATHER',
    actions: ['Seek sturdy shelter', 'Avoid trees', 'Secure loose objects'],
  },
  {
    id: 'demo-3',
    type: 'SECURITY',
    severity: 'LOW',
    title: 'Security Advisory',
    description: 'Increased police presence in the Central Park area. Avoid the area if possible.',
    location: 'Central Park',
    timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    isRead: true,
    source: 'SECURITY',
    actions: ['Avoid the area', 'Follow police instructions'],
  },
];

type FilterType = 'ALL' | SafetyAlert['source'];

export default function AlertsScreen() {
  const { safetyAlerts, markAlertRead, markAllAlertsRead, unreadAlertCount } = useAppStore();
  const { haptic } = useHaptic();

  const [filter, setFilter] = useState<FilterType>('ALL');
  const [selectedAlert, setSelectedAlert] = useState<SafetyAlert | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Use demo alerts if no real alerts
  const allAlerts = safetyAlerts.length > 0 ? safetyAlerts : DEMO_ALERTS;

  const filtered = filter === 'ALL'
    ? allAlerts
    : allAlerts.filter(a => a.source === filter);

  const criticalAlerts = allAlerts.filter(a => a.severity === 'CRITICAL' && !a.isRead);

  const handleAlertTap = (alert: SafetyAlert) => {
    haptic('tap');
    markAlertRead(alert.id);
    setSelectedAlert(alert);
  };

  const handleMarkAllRead = () => {
    haptic('tap');
    markAllAlertsRead();
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await new Promise(r => setTimeout(r, 1000));
    setIsRefreshing(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#fff", overflow: "hidden" }}>
      <ScreenHeader
        title="Safety Alerts"
        subtitle={`${unreadAlertCount} unread`}
        right={
          unreadAlertCount > 0 ? (
            <button
              onClick={handleMarkAllRead}
              className="text-[9px] font-mono text-gray-500 tracking-widest uppercase hover:text-gray-900 transition-colors"
            >
              Mark all read
            </button>
          ) : undefined
        }
      />

      {/* ── Critical banner ───────────────────────────────── */}
      <AnimatePresence>
        {criticalAlerts.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-3 px-5 py-3 bg-red-500/10 border-b border-red-400/30">
              <AlertTriangle className="w-4 h-4 text-red-500 animate-pulse flex-shrink-0" />
              <div className="flex-1">
                <div className="text-[10px] font-bold text-red-500 tracking-widest uppercase">
                  {criticalAlerts.length} Critical Alert{criticalAlerts.length > 1 ? 's' : ''}
                </div>
                <div className="text-[9px] text-gray-400">{criticalAlerts[0].title}</div>
              </div>
              <ChevronRight className="w-4 h-4 text-red-500" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Source filter ─────────────────────────────────── */}
      <div className="px-4 py-3 border-b border-gray-100 overflow-x-auto">
        <div className="flex gap-2" style={{ width: 'max-content' }}>
          {(['ALL', 'FLOOD', 'WEATHER', 'SECURITY', 'SENSOR', 'SYSTEM'] as FilterType[]).map(f => {
            const config = f !== 'ALL' ? SOURCE_CONFIG[f] : null;
            const count = f === 'ALL'
              ? allAlerts.filter(a => !a.isRead).length
              : allAlerts.filter(a => a.source === f && !a.isRead).length;

            return (
              <button
                key={f}
                onClick={() => { haptic('tap'); setFilter(f); }}
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 border text-[9px] font-mono
                  tracking-widest uppercase transition-all whitespace-nowrap
                  ${filter === f ? 'border-gray-900 text-gray-900 bg-gray-100' : 'border-gray-200 text-gray-500 hover:border-gray-300'}
                `}
              >
                {config && <config.icon className="w-3 h-3" />}
                {f}
                {count > 0 && (
                  <span className="w-4 h-4 rounded-full bg-red-500 text-gray-900 text-[8px] flex items-center justify-center">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Alert list ────────────────────────────────────── */}
      <div className="screen-body">
        {isRefreshing && (
          <div className="flex items-center justify-center py-4">
            <div className="w-4 h-4 border border-gray-300 border-t-white rounded-full animate-spin" />
          </div>
        )}

        {filtered.length === 0 ? (
          <EmptyAlerts />
        ) : (
          <div className="divide-y divide-gray-100">
            {filtered.map((alert, i) => (
              <AlertRow
                key={alert.id}
                alert={alert}
                index={i}
                onTap={() => handleAlertTap(alert)}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Alert detail sheet ────────────────────────────── */}
      <AnimatePresence>
        {selectedAlert && (
          <AlertDetailSheet
            alert={selectedAlert}
            onClose={() => setSelectedAlert(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────

function AlertRow({
  alert, index, onTap,
}: { alert: SafetyAlert; index: number; onTap: () => void }) {
  const config = SOURCE_CONFIG[alert.source] ?? SOURCE_CONFIG.SYSTEM;
  const severityColor = SEVERITY_COLORS[alert.severity] ?? '#555';
  const Icon = config.icon;

  return (
    <motion.button
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.04 }}
      onClick={onTap}
      className="w-full flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
      style={{ borderLeft: `3px solid ${severityColor}` }}
    >
      {/* Source icon */}
      <div className="flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4" style={{ color: config.color }} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className={`text-sm font-bold ${!alert.isRead ? 'text-gray-900' : 'text-gray-400'}`}>
            {alert.title}
          </span>
          {!alert.isRead && (
            <span className="w-2 h-2 rounded-full bg-white flex-shrink-0 mt-1.5" />
          )}
        </div>
        <p className="text-[11px] text-gray-500 leading-relaxed line-clamp-2 mb-1.5">
          {alert.description}
        </p>
        <div className="flex items-center gap-3">
          <span
            className="text-[8px] font-mono tracking-widest uppercase px-1.5 py-0.5 border"
            style={{ borderColor: `${severityColor}40`, color: severityColor }}
          >
            {alert.severity}
          </span>
          {alert.location && (
            <span className="text-[9px] text-gray-500 truncate">{alert.location}</span>
          )}
          <span className="text-[9px] text-gray-400 ml-auto flex-shrink-0">
            {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
          </span>
        </div>
      </div>
    </motion.button>
  );
}

function AlertDetailSheet({
  alert, onClose,
}: { alert: SafetyAlert; onClose: () => void }) {
  const config = SOURCE_CONFIG[alert.source] ?? SOURCE_CONFIG.SYSTEM;
  const severityColor = SEVERITY_COLORS[alert.severity] ?? '#555';
  const Icon = config.icon;

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="sheet-overlay" onClick={onClose}
      />
      <motion.div
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="sheet max-h-[80vh] overflow-y-auto"
      >
        <div className="sheet-handle" />

        <div className="px-6 py-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-5">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 border flex items-center justify-center"
                style={{ borderColor: `${severityColor}40` }}
              >
                <Icon className="w-5 h-5" style={{ color: config.color }} />
              </div>
              <div>
                <div className="text-sm font-bold">{alert.title}</div>
                <div
                  className="text-[9px] font-mono tracking-widest uppercase"
                  style={{ color: severityColor }}
                >
                  {alert.severity} · {alert.source}
                </div>
              </div>
            </div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded transition-colors">
              <X className="w-4 h-4 text-gray-500" />
            </button>
          </div>

          {/* Description */}
          <p className="text-sm text-gray-600 leading-relaxed mb-5">{alert.description}</p>

          {/* Location */}
          {alert.location && (
            <div className="flex items-center gap-2 mb-5 text-[11px] text-gray-500">
              <span className="font-mono uppercase tracking-widest">Location:</span>
              <span>{alert.location}</span>
            </div>
          )}

          {/* Recommended actions */}
          {alert.actions && alert.actions.length > 0 && (
            <div className="mb-5">
              <div className="text-[9px] font-mono text-gray-500 tracking-widest uppercase mb-3">
                Recommended Actions
              </div>
              <div className="space-y-2">
                {alert.actions.map((action, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-[9px] font-mono text-gray-500 mt-0.5 flex-shrink-0">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-sm text-gray-600">{action}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timestamp */}
          <div className="text-[9px] font-mono text-gray-400 border-t border-gray-100 pt-4">
            {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function EmptyAlerts() {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center px-8">
      <BellOff className="w-10 h-10 text-gray-300" strokeWidth={1} />
      <div>
        <div className="text-sm font-bold mb-1">No Alerts</div>
        <div className="text-[11px] text-gray-500">
          Safety alerts from flood, weather, and security systems will appear here
        </div>
      </div>
    </div>
  );
}
