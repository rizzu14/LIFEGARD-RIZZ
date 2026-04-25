// ============================================================
// LIFEGRID – Satellite Monitoring Panel
// Real-time satellite data layers + NDVI + weather + flood
// ============================================================

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Satellite, RefreshCw, TrendingUp, Droplets, Wind, Leaf, Eye, EyeOff } from 'lucide-react';
import { useOperatorStore } from '../../store/operatorStore';
import { api } from '../../lib/api';
import { useQuery } from '@tanstack/react-query';

// ── Satellite data types ──────────────────────────────────────

interface SatelliteReading {
  label: string;
  value: string | number;
  unit?: string;
  status: 'NORMAL' | 'ELEVATED' | 'CRITICAL';
  trend?: 'UP' | 'DOWN' | 'STABLE';
}

interface SatelliteSource {
  id: string;
  name: string;
  shortName: string;
  type: 'OPTICAL' | 'SAR' | 'WEATHER' | 'THERMAL';
  lastUpdate: string;
  resolution: string;
  coverage: string;
  isActive: boolean;
  readings: SatelliteReading[];
}

// ── Demo satellite data ───────────────────────────────────────

const DEMO_SOURCES: SatelliteSource[] = [
  {
    id: 'sentinel-2',
    name: 'Sentinel-2 Optical',
    shortName: 'S2',
    type: 'OPTICAL',
    lastUpdate: new Date(Date.now() - 12 * 60000).toISOString(),
    resolution: '10m',
    coverage: 'Regional',
    isActive: true,
    readings: [
      { label: 'NDVI Mean',    value: 0.31, status: 'ELEVATED', trend: 'DOWN' },
      { label: 'NDWI Mean',    value: 0.42, status: 'CRITICAL', trend: 'UP' },
      { label: 'EVI',          value: 0.28, status: 'ELEVATED', trend: 'DOWN' },
      { label: 'Cloud Cover',  value: '34%', status: 'NORMAL' },
    ],
  },
  {
    id: 'sentinel-1',
    name: 'Sentinel-1 SAR',
    shortName: 'S1',
    type: 'SAR',
    lastUpdate: new Date(Date.now() - 6 * 60000).toISOString(),
    resolution: '5m',
    coverage: 'Regional',
    isActive: true,
    readings: [
      { label: 'Flood Extent', value: '12.4 km²', status: 'CRITICAL', trend: 'UP' },
      { label: 'SAR-VV',       value: '-8.2 dB', status: 'ELEVATED' },
      { label: 'SAR-VH',       value: '-14.1 dB', status: 'NORMAL' },
      { label: 'Coherence',    value: 0.72, status: 'NORMAL' },
    ],
  },
  {
    id: 'goes-16',
    name: 'GOES-16 Weather',
    shortName: 'G16',
    type: 'WEATHER',
    lastUpdate: new Date(Date.now() - 2 * 60000).toISOString(),
    resolution: '2km',
    coverage: 'Continental',
    isActive: true,
    readings: [
      { label: 'CAPE',         value: '2840 J/kg', status: 'CRITICAL', trend: 'UP' },
      { label: 'Precip Water', value: '48mm', status: 'ELEVATED', trend: 'UP' },
      { label: 'Cloud Top T',  value: '-62°C', status: 'CRITICAL' },
      { label: 'Wind Shear',   value: '28 m/s', status: 'ELEVATED' },
    ],
  },
  {
    id: 'landsat-9',
    name: 'Landsat-9 Thermal',
    shortName: 'L9',
    type: 'THERMAL',
    lastUpdate: new Date(Date.now() - 45 * 60000).toISOString(),
    resolution: '30m',
    coverage: 'Regional',
    isActive: false,
    readings: [
      { label: 'LST Mean',     value: '38.4°C', status: 'ELEVATED', trend: 'UP' },
      { label: 'Hot Spots',    value: 3, status: 'ELEVATED' },
      { label: 'Urban Heat',   value: '+6.2°C', status: 'ELEVATED' },
    ],
  },
];

const STATUS_COLORS: Record<string, string> = {
  NORMAL:   '#00c853',
  ELEVATED: '#ffd600',
  CRITICAL: '#ff1744',
};

const TYPE_ICONS: Record<string, React.ComponentType<any>> = {
  OPTICAL: Eye,
  SAR:     Satellite,
  WEATHER: Wind,
  THERMAL: TrendingUp,
};

const TREND_SYMBOLS: Record<string, string> = {
  UP: '↑', DOWN: '↓', STABLE: '→',
};

export function SatellitePanel() {
  const { mapLayers, toggleLayer, updateLayerData, setFloodZones } = useOperatorStore();
  const [selectedSource, setSelectedSource] = useState<string>('sentinel-2');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const source = DEMO_SOURCES.find(s => s.id === selectedSource) ?? DEMO_SOURCES[0];

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      // In production: trigger satellite data refresh
      await new Promise(r => setTimeout(r, 1200));
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleFloodAnalysis = async () => {
    try {
      const res = await api.post('/ai/flood/predict', {
        location: { lat: 40.7128, lng: -74.006 },
        radiusKm: 20,
        rainfallMm24h: 142,
        riverLevelM: 6.2,
        soilMoisturePct: 88,
      });
      if (res.data?.data?.riskZones) {
        setFloodZones(res.data.data.riskZones.map((z: any, i: number) => ({
          id: `fz-${i}`,
          centerLat: z.centerLat ?? z.center_lat,
          centerLng: z.centerLng ?? z.center_lng,
          radiusM: z.radiusM ?? z.radius_m,
          probability: z.probability,
          riskLevel: z.riskLevel ?? z.risk_level,
          estimatedPopulation: z.estimatedPopulation ?? z.estimated_population,
        })));
        // Enable flood layer
        const floodLayer = mapLayers.find(l => l.id === 'flood');
        if (floodLayer && !floodLayer.isVisible) toggleLayer('flood');
      }
    } catch {
      // Use demo data
      setFloodZones([
        { id: 'fz-1', centerLat: 40.71, centerLng: -74.01, radiusM: 800, probability: 0.82, riskLevel: 'HIGH', estimatedPopulation: 4200 },
        { id: 'fz-2', centerLat: 40.72, centerLng: -73.99, radiusM: 500, probability: 0.61, riskLevel: 'MEDIUM', estimatedPopulation: 1800 },
      ]);
      const floodLayer = mapLayers.find(l => l.id === 'flood');
      if (floodLayer && !floodLayer.isVisible) toggleLayer('flood');
    }
  };

  return (
    <div className="panel h-full">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Satellite className="w-3 h-3 text-[#888]" />
          <span className="panel-title">Satellite Monitor</span>
        </div>
        <button
          onClick={handleRefresh}
          className="p-1 hover:bg-[#111] transition-colors"
          title="Refresh satellite data"
        >
          <RefreshCw className={`w-3 h-3 text-[#555] ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="panel-body">

        {/* ── Source selector ───────────────────────────── */}
        <div className="flex border-b border-[#1a1a1a]">
          {DEMO_SOURCES.map(s => {
            const Icon = TYPE_ICONS[s.type] ?? Satellite;
            return (
              <button
                key={s.id}
                onClick={() => setSelectedSource(s.id)}
                className={`
                  flex-1 flex flex-col items-center gap-0.5 py-2 border-b-2 transition-colors
                  ${selectedSource === s.id ? 'border-white text-white' : 'border-transparent text-[#333] hover:text-[#666]'}
                `}
              >
                <Icon className="w-3 h-3" />
                <span className="text-[7px] font-mono tracking-widest">{s.shortName}</span>
                {!s.isActive && <span className="w-1 h-1 rounded-full bg-[#333]" />}
              </button>
            );
          })}
        </div>

        {/* ── Source info ───────────────────────────────── */}
        <div className="px-3 py-2 border-b border-[#1a1a1a] bg-[#080808]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-bold">{source.name}</span>
            <span className={`text-[8px] font-mono ${source.isActive ? 'text-[#00c853]' : 'text-[#333]'}`}>
              {source.isActive ? 'ACTIVE' : 'INACTIVE'}
            </span>
          </div>
          <div className="flex gap-3 text-[8px] font-mono text-[#444]">
            <span>Res: {source.resolution}</span>
            <span>Coverage: {source.coverage}</span>
            <span className="ml-auto">
              {new Date(source.lastUpdate).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>

        {/* ── Readings ──────────────────────────────────── */}
        <div className="divide-y divide-[#0d0d0d]">
          {source.readings.map((reading, i) => (
            <motion.div
              key={reading.label}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.04 }}
              className="flex items-center justify-between px-3 py-2.5"
            >
              <span className="text-[9px] text-[#555]">{reading.label}</span>
              <div className="flex items-center gap-2">
                {reading.trend && (
                  <span
                    className="text-[9px] font-mono"
                    style={{ color: reading.trend === 'UP' ? '#ff1744' : reading.trend === 'DOWN' ? '#00c853' : '#555' }}
                  >
                    {TREND_SYMBOLS[reading.trend]}
                  </span>
                )}
                <span
                  className="text-[10px] font-mono font-bold tabular-nums"
                  style={{ color: STATUS_COLORS[reading.status] }}
                >
                  {reading.value}{reading.unit ? ` ${reading.unit}` : ''}
                </span>
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: STATUS_COLORS[reading.status] }}
                />
              </div>
            </motion.div>
          ))}
        </div>

        {/* ── Layer toggles ─────────────────────────────── */}
        <div className="px-3 py-3 border-t border-[#1a1a1a]">
          <div className="text-[8px] font-mono text-[#333] tracking-widest uppercase mb-2">Map Overlays</div>
          <div className="space-y-1.5">
            {mapLayers.map(layer => (
              <div key={layer.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ background: layer.isVisible ? (layer.color ?? '#fff') : '#1a1a1a' }}
                  />
                  <span className="text-[9px] text-[#666]">{layer.name}</span>
                </div>
                <button
                  onClick={() => toggleLayer(layer.id)}
                  className={`
                    w-7 h-4 border transition-all relative
                    ${layer.isVisible ? 'border-white bg-white/10' : 'border-[#1a1a1a]'}
                  `}
                >
                  <span
                    className="absolute top-0.5 w-3 h-3 bg-white transition-all"
                    style={{ left: layer.isVisible ? '14px' : '2px' }}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* ── Quick analysis actions ────────────────────── */}
        <div className="px-3 py-3 border-t border-[#1a1a1a] space-y-2">
          <div className="text-[8px] font-mono text-[#333] tracking-widest uppercase mb-2">Quick Analysis</div>

          <button
            onClick={handleFloodAnalysis}
            className="w-full flex items-center gap-2 px-3 py-2 border border-[#1a1a1a] hover:border-[#00aaff]/40 text-[9px] font-mono text-[#555] hover:text-[#00aaff] transition-all"
          >
            <Droplets className="w-3 h-3" />
            Run Flood Prediction
          </button>

          <button
            onClick={() => {
              const ndviLayer = mapLayers.find(l => l.id === 'ndvi');
              if (ndviLayer && !ndviLayer.isVisible) toggleLayer('ndvi');
            }}
            className="w-full flex items-center gap-2 px-3 py-2 border border-[#1a1a1a] hover:border-[#00c853]/40 text-[9px] font-mono text-[#555] hover:text-[#00c853] transition-all"
          >
            <Leaf className="w-3 h-3" />
            Show Vegetation Index
          </button>

          <button
            onClick={() => {
              const heatLayer = mapLayers.find(l => l.id === 'heatmap');
              if (heatLayer && !heatLayer.isVisible) toggleLayer('heatmap');
            }}
            className="w-full flex items-center gap-2 px-3 py-2 border border-[#1a1a1a] hover:border-[#ff1744]/40 text-[9px] font-mono text-[#555] hover:text-[#ff1744] transition-all"
          >
            <TrendingUp className="w-3 h-3" />
            Show Crisis Heatmap
          </button>
        </div>
      </div>
    </div>
  );
}
