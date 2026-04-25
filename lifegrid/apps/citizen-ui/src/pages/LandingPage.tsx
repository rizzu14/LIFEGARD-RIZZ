import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { AlertTriangle, Phone, MapPin, Shield, Zap, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function LandingPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-black text-white grid-overlay flex flex-col">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="border-b border-[#1a1a1a] px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 border border-white flex items-center justify-center">
            <span className="text-xs font-mono font-bold tracking-widest">LG</span>
          </div>
          <div>
            <div className="text-sm font-bold tracking-[0.2em] uppercase">LIFEGRID</div>
            <div className="text-[10px] text-[#555] tracking-widest uppercase">National Emergency Infrastructure</div>
          </div>
        </div>
        <nav className="hidden md:flex items-center gap-6">
          <button
            onClick={() => navigate('/login')}
            className="text-xs text-[#888] hover:text-white transition-colors tracking-widest uppercase"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate('/register')}
            className="text-xs border border-[#333] hover:border-white px-4 py-2 transition-colors tracking-widest uppercase"
          >
            Register
          </button>
        </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16 text-center">

        {/* Status indicator */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 mb-8 px-4 py-2 border border-[#1a1a1a] bg-[#0a0a0a]"
        >
          <span className="w-2 h-2 rounded-full bg-[#00ff88] animate-pulse" />
          <span className="text-[10px] font-mono text-[#888] tracking-widest uppercase">
            System Operational · All Services Active
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="text-5xl md:text-7xl font-bold tracking-tight mb-4 leading-none"
        >
          LIFEGRID
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="text-[#555] text-sm md:text-base tracking-[0.3em] uppercase mb-4"
        >
          National Emergency Coordination Infrastructure
        </motion.p>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="text-[#888] text-sm max-w-md mb-12 leading-relaxed"
        >
          AI-powered emergency response. Real-time coordination.
          Every second counts.
        </motion.p>

        {/* ── Emergency Button ─────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4 }}
          className="mb-16"
        >
          <button
            onClick={() => navigate('/emergency')}
            className="
              relative group
              w-48 h-48 rounded-full
              border-2 border-white
              bg-black
              flex flex-col items-center justify-center gap-2
              hover:bg-white hover:text-black
              transition-all duration-300
              focus:outline-none focus:ring-4 focus:ring-white focus:ring-offset-4 focus:ring-offset-black
            "
            aria-label="Report Emergency"
          >
            {/* Pulse rings */}
            <span className="absolute inset-0 rounded-full border border-white opacity-20 animate-ping" />
            <span className="absolute inset-[-8px] rounded-full border border-white opacity-10 animate-ping" style={{ animationDelay: '0.3s' }} />

            <AlertTriangle className="w-10 h-10" strokeWidth={1.5} />
            <span className="text-xs font-bold tracking-[0.3em] uppercase">Emergency</span>
            <span className="text-[10px] text-[#888] group-hover:text-[#555] tracking-widest">Tap to Report</span>
          </button>
        </motion.div>

        {/* ── Quick Actions ─────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="grid grid-cols-3 gap-4 w-full max-w-sm mb-16"
        >
          {[
            { icon: Phone, label: 'Call', action: () => window.location.href = 'tel:911' },
            { icon: MapPin, label: 'Locate', action: () => navigate('/emergency?mode=location') },
            { icon: Shield, label: 'Track', action: () => navigate('/dashboard') },
          ].map(({ icon: Icon, label, action }) => (
            <button
              key={label}
              onClick={action}
              className="
                flex flex-col items-center gap-2 p-4
                border border-[#1a1a1a] bg-[#0a0a0a]
                hover:border-[#333] hover:bg-[#111]
                transition-all duration-200
              "
            >
              <Icon className="w-5 h-5 text-[#888]" strokeWidth={1.5} />
              <span className="text-[10px] text-[#555] tracking-widest uppercase">{label}</span>
            </button>
          ))}
        </motion.div>

        {/* ── Feature Grid ──────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-px bg-[#111] border border-[#111] w-full max-w-2xl"
        >
          {[
            {
              icon: Zap,
              title: 'Instant Response',
              desc: 'AI dispatches the nearest responders in under 30 seconds',
            },
            {
              icon: Globe,
              title: 'Multilingual',
              desc: 'Real-time guidance in 8+ languages via voice and text',
            },
            {
              icon: MapPin,
              title: 'Live Tracking',
              desc: 'Track responder location and ETA in real time',
            },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="bg-black p-6 flex flex-col gap-3">
              <Icon className="w-5 h-5 text-[#555]" strokeWidth={1.5} />
              <div className="text-xs font-bold tracking-widest uppercase">{title}</div>
              <div className="text-[11px] text-[#555] leading-relaxed">{desc}</div>
            </div>
          ))}
        </motion.div>
      </main>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-[#111] px-6 py-4 flex items-center justify-between">
        <span className="text-[10px] text-[#333] font-mono tracking-widest">
          LIFEGRID v1.0 · CLASSIFIED INFRASTRUCTURE
        </span>
        <span className="text-[10px] text-[#333] font-mono">
          {new Date().getFullYear()} · ALL RIGHTS RESERVED
        </span>
      </footer>
    </div>
  );
}
