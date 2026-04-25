// ============================================================
// LIFEGRID – Broadcast Modal
// Send emergency broadcast to all agencies
// ============================================================

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Megaphone, X, Send, AlertTriangle } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';
import { useOperatorStore } from '../../store/operatorStore';
import { useAuthStore } from '../../store/authStore';
import { useSocket } from '../../hooks/useSocket';

const BROADCAST_TEMPLATES = [
  { label: 'All Units Standby',    text: 'ALL UNITS: Standby for emergency deployment. Await further instructions.' },
  { label: 'Evacuation Order',     text: 'EVACUATION ORDER: All units assist civilian evacuation of affected zones immediately.' },
  { label: 'Incident Contained',   text: 'SITUATION UPDATE: Incident contained. Units may begin withdrawal from perimeter.' },
  { label: 'Mass Casualty Alert',  text: 'MASS CASUALTY ALERT: All medical units respond immediately. Triage protocols activated.' },
  { label: 'Chemical Hazard',      text: 'CHEMICAL HAZARD: HazMat protocols activated. All units maintain 500m exclusion zone.' },
];

export function BroadcastModal() {
  const { setBroadcastModalOpen, addCommMessage, addLogEntry, agencies } = useOperatorStore();
  const { user } = useAuthStore();
  const { socket } = useSocket();

  const [message, setMessage] = useState('');
  const [severity, setSeverity] = useState<'NORMAL' | 'URGENT' | 'EMERGENCY'>('URGENT');
  const [selectedAgencies, setSelectedAgencies] = useState<string[]>(['ALL']);
  const [isSending, setIsSending] = useState(false);
  const [sent, setSent] = useState(false);

  const toggleAgency = (id: string) => {
    if (id === 'ALL') {
      setSelectedAgencies(['ALL']);
      return;
    }
    setSelectedAgencies(prev => {
      const without = prev.filter(a => a !== 'ALL');
      return without.includes(id) ? without.filter(a => a !== id) : [...without, id];
    });
  };

  const handleSend = async () => {
    if (!message.trim()) return;
    setIsSending(true);

    try {
      // Broadcast via WebSocket
      if (socket) {
        socket.emit('OPERATOR_BROADCAST', { message: message.trim(), severity });
      }

      // Add to all-agencies channel
      addCommMessage('ch-all', {
        id: uuidv4(),
        channelId: 'ch-all',
        senderId: user?.id ?? 'operator',
        senderName: user?.name ?? 'Operator',
        content: `[BROADCAST] ${message.trim()}`,
        timestamp: new Date().toISOString(),
        type: 'ALERT',
        isRead: true,
        priority: severity,
      });

      addLogEntry({
        type: 'BROADCAST',
        severity,
        message: `Broadcast sent to ${selectedAgencies.includes('ALL') ? 'all agencies' : selectedAgencies.join(', ')}: ${message.slice(0, 60)}`,
        timestamp: new Date().toISOString(),
      });

      setSent(true);
      setTimeout(() => setBroadcastModalOpen(false), 1500);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="broadcast-modal"
      onClick={(e) => e.target === e.currentTarget && setBroadcastModalOpen(false)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-[#080808] border border-[#1a1a1a] w-full max-w-md mx-4"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1a1a1a]">
          <div className="flex items-center gap-2">
            <Megaphone className="w-4 h-4 text-[#ffd600]" />
            <span className="text-sm font-bold tracking-widest uppercase">Emergency Broadcast</span>
          </div>
          <button onClick={() => setBroadcastModalOpen(false)} className="p-1 hover:bg-[#111] transition-colors">
            <X className="w-4 h-4 text-[#555]" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Severity */}
          <div>
            <label className="text-[9px] font-mono text-[#555] tracking-widest uppercase block mb-2">Priority</label>
            <div className="flex gap-2">
              {(['NORMAL', 'URGENT', 'EMERGENCY'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={`
                    flex-1 py-2 text-[9px] font-mono tracking-widest uppercase border transition-all
                    ${severity === s ? 'border-white text-white bg-white/5' : 'border-[#1a1a1a] text-[#444] hover:border-[#333]'}
                  `}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Templates */}
          <div>
            <label className="text-[9px] font-mono text-[#555] tracking-widest uppercase block mb-2">Templates</label>
            <div className="space-y-1">
              {BROADCAST_TEMPLATES.map(t => (
                <button
                  key={t.label}
                  onClick={() => setMessage(t.text)}
                  className="w-full text-left px-3 py-2 border border-[#1a1a1a] text-[9px] text-[#555] hover:border-[#333] hover:text-[#888] transition-all"
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div>
            <label className="text-[9px] font-mono text-[#555] tracking-widest uppercase block mb-2">Message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Enter broadcast message..."
              rows={4}
              className="
                w-full bg-[#0d0d0d] border border-[#1a1a1a] text-white text-sm
                px-3 py-2.5 resize-none placeholder:text-[#333]
                focus:outline-none focus:border-[#333] transition-colors
              "
            />
          </div>

          {/* Warning */}
          <div className="flex gap-2 p-3 border border-[#ff1744]/20 bg-[#ff1744]/5">
            <AlertTriangle className="w-3.5 h-3.5 text-[#ff1744] flex-shrink-0 mt-0.5" />
            <p className="text-[9px] text-[#888]">
              This message will be broadcast to all connected agency channels and logged permanently.
            </p>
          </div>

          {/* Send */}
          <button
            onClick={handleSend}
            disabled={!message.trim() || isSending || sent}
            className="
              w-full flex items-center justify-center gap-2
              py-3 bg-white text-black font-bold text-xs tracking-widest uppercase
              disabled:opacity-50 hover:bg-[#e0e0e0] transition-colors
            "
          >
            {sent ? (
              '✓ Broadcast Sent'
            ) : isSending ? (
              'Sending...'
            ) : (
              <><Send className="w-4 h-4" /> Send Broadcast</>
            )}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
