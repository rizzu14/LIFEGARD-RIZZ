// ============================================================
// LIFEGRID – Analytics Bar v2
// Bottom-row data visualization: sparklines + charts + metrics
// ============================================================

import React, { useMemo } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import type { SystemMetrics } from '@lifegrid/shared-types';
import { useOperatorStore } from '../../store/operatorStore';

interface AnalyticsBarProps {
  metrics: SystemMetrics | null;
}

// ── Synthetic time-series data ────────────────────────────────

const generateHourlyData = () =>
  Array.from({ length: 24 }, (_, i) => ({
    h: `${String(i).padStart(2, '0')}:00`,
    incidents: Math.floor(Math.random() * 14 + 1),
    critical:  Math.floor(Math.random() * 4),
    resolved:  Math.floor(Math.random() * 12),
    responders: Math.floor(Math.random() * 20 + 10),
  }));

const hourlyData = generateHourlyData();

const typeData = [
  { type: 'MED',  count: 42, color: '#00c853' },
  { type: 'FIRE', count: 18, color: '#ff6d00' },
  { type: 'SEC',  count: 31, color: '#00aaff' },
  { type: 'DIS',  count: 7,  color: '#ffd600' },
  { type: 'CHM',  count: 3,  color: '#ff1744' },
  { type: 'OTH',  count: 12, color: '#555' },
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#0d0d0d] border border-[#1a1a1a] px-2 py-1.5">
      <div className="text-[7px] font-mono text-[#444] mb-1">{label}</div>
      {payload.map((p: any) => (
        <div key={p.name} className="text-[8px] font-mono" style={{ color: p.color ?? '#888' }}>
          {p.name}: {p.value}
        </div>
      ))}
    </div>
  );
};

export function AnalyticsBar({ metrics }: AnalyticsBarProps) {
  const { incidents, responders } = useOperatorStore();

  const activeByType = useMemo(() => {
    const counts: Record<string, number> = {};
    incidents.filter(i => !['CLOSED', 'RESOLVED'].includes(i.status)).forEach(i => {
      counts[i.type] = (counts[i.type] ?? 0) + 1;
    });
    return Object.entries(counts).map(([type, count]) => ({ type: type.slice(0, 4), count }));
  }, [incidents]);

  const respondersByStatus = useMemo(() => {
    const counts: Record<string, number> = {};
    responders.forEach(r => { counts[r.status] = (counts[r.status] ?? 0) + 1; });
    return counts;
  }, [responders]);

  return (
    <div className="h-full flex bg-[#030303] border-t border-[#1a1a1a]">

      {/* ── KPI metrics ──────────────────────────────────── */}
      <div className="flex border-r border-[#1a1a1a]">
        {[
          { label: '24H INC',   value: metrics?.incidentsLast24h  ?? 0,  color: '#e8e8e8' },
          { label: '24H RES',   value: metrics?.resolvedLast24h   ?? 0,  color: '#00c853' },
          { label: 'AVG RES',   value: metrics?.avgResponseTimeSeconds ? `${Math.round(metrics.avgResponseTimeSeconds / 60)}m` : '—', color: '#888' },
          { label: 'DEPLOYED',  value: metrics?.dispatchedResponders ?? 0, color: '#00aaff' },
        ].map(({ label, value, color }) => (
          <div key={label} className="metric-card min-w-[72px]">
            <div className="metric-label">{label}</div>
            <div className="metric-value" style={{ color, fontSize: '18px' }}>{value}</div>
          </div>
        ))}
      </div>

      {/* ── 24h incident flow ─────────────────────────────── */}
      <div className="flex-1 border-r border-[#1a1a1a] p-2 min-w-0">
        <div className="text-[7px] font-mono text-[#222] tracking-widest uppercase mb-1">24H INCIDENT FLOW</div>
        <ResponsiveContainer width="100%" height="75%">
          <AreaChart data={hourlyData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <defs>
              <linearGradient id="incGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#fff" stopOpacity={0.08} />
                <stop offset="95%" stopColor="#fff" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="critGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#ff1744" stopOpacity={0.15} />
                <stop offset="95%" stopColor="#ff1744" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="h" tick={{ fontSize: 6, fill: '#222', fontFamily: 'monospace' }}
              tickLine={false} axisLine={false} interval={5} />
            <YAxis tick={{ fontSize: 6, fill: '#222', fontFamily: 'monospace' }}
              tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="incidents" stroke="#333" strokeWidth={1}
              fill="url(#incGrad)" name="Total" />
            <Area type="monotone" dataKey="critical" stroke="#ff1744" strokeWidth={1}
              fill="url(#critGrad)" name="Critical" />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Incident by type ──────────────────────────────── */}
      <div className="w-44 border-r border-[#1a1a1a] p-2">
        <div className="text-[7px] font-mono text-[#222] tracking-widest uppercase mb-1">BY TYPE</div>
        <ResponsiveContainer width="100%" height="75%">
          <BarChart data={activeByType.length > 0 ? activeByType : typeData}
            margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
            <XAxis dataKey="type" tick={{ fontSize: 6, fill: '#333', fontFamily: 'monospace' }}
              tickLine={false} axisLine={false} />
            <YAxis tick={{ fontSize: 6, fill: '#222', fontFamily: 'monospace' }}
              tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Bar dataKey="count" name="Count" radius={[1, 1, 0, 0]}>
              {(activeByType.length > 0 ? activeByType : typeData).map((entry, i) => (
                <Cell key={i} fill={entry.color ?? '#333'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* ── Responder availability ────────────────────────── */}
      <div className="w-44 border-r border-[#1a1a1a] p-2">
        <div className="text-[7px] font-mono text-[#222] tracking-widest uppercase mb-1">RESPONDERS</div>
        <div className="space-y-1.5 mt-2">
          {[
            { label: 'Available',  key: 'AVAILABLE',  color: '#00c853' },
            { label: 'Dispatched', key: 'DISPATCHED',  color: '#ffd600' },
            { label: 'En Route',   key: 'EN_ROUTE',    color: '#00aaff' },
            { label: 'On Scene',   key: 'ON_SCENE',    color: '#ff6d00' },
          ].map(({ label, key, color }) => {
            const count = respondersByStatus[key] ?? Math.floor(Math.random() * 15);
            const total = Math.max(Object.values(respondersByStatus).reduce((a, b) => a + b, 0), 40);
            const pct = (count / total) * 100;
            return (
              <div key={key}>
                <div className="flex justify-between text-[7px] font-mono mb-0.5">
                  <span style={{ color }}>{label}</span>
                  <span className="text-[#333]">{count}</span>
                </div>
                <div className="h-1 bg-[#0d0d0d] overflow-hidden">
                  <div className="h-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Response time trend ───────────────────────────── */}
      <div className="w-44 p-2">
        <div className="text-[7px] font-mono text-[#222] tracking-widest uppercase mb-1">RESPONSE TIME (min)</div>
        <ResponsiveContainer width="100%" height="75%">
          <LineChart
            data={hourlyData.slice(-12).map(d => ({ h: d.h, eta: Math.floor(Math.random() * 8 + 4) }))}
            margin={{ top: 0, right: 0, bottom: 0, left: -20 }}
          >
            <XAxis dataKey="h" tick={{ fontSize: 6, fill: '#222', fontFamily: 'monospace' }}
              tickLine={false} axisLine={false} interval={3} />
            <YAxis tick={{ fontSize: 6, fill: '#222', fontFamily: 'monospace' }}
              tickLine={false} axisLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Line type="monotone" dataKey="eta" stroke="#888" strokeWidth={1}
              dot={false} name="ETA" />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
