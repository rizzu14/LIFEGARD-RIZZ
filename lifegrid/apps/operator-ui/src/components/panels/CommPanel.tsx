// ============================================================
// LIFEGRID – Communication Panel
// Multi-agency encrypted comms + incident channels
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Lock, Radio, Users, Megaphone, Hash } from 'lucide-react';
import { format } from 'date-fns';
import { v4 as uuidv4 } from 'uuid';
import { useOperatorStore, CommMessage, CommChannel } from '../../store/operatorStore';
import { useAuthStore } from '../../store/authStore';
import { useSocket } from '../../hooks/useSocket';

const CHANNEL_ICONS: Record<string, React.ComponentType<any>> = {
  AGENCY:     Radio,
  INCIDENT:   Hash,
  BROADCAST:  Megaphone,
  ENCRYPTED:  Lock,
};

const PRIORITY_COLORS: Record<string, string> = {
  EMERGENCY: '#ff1744',
  URGENT:    '#ffd600',
  NORMAL:    '#555',
};

const MSG_TYPE_COLORS: Record<string, string> = {
  ALERT:   '#ff1744',
  STATUS:  '#00c853',
  COMMAND: '#ffd600',
  TEXT:    '#888',
};

export function CommPanel() {
  const {
    commChannels, commMessages, activeChannelId,
    setActiveChannel, addCommMessage, markChannelRead,
    agencies,
  } = useOperatorStore();
  const { user } = useAuthStore();
  const { socket } = useSocket();

  const [inputText, setInputText] = useState('');
  const [priority, setPriority] = useState<'NORMAL' | 'URGENT' | 'EMERGENCY'>('NORMAL');
  const bottomRef = useRef<HTMLDivElement>(null);

  const activeChannel = commChannels.find(c => c.id === activeChannelId);
  const messages = activeChannelId ? (commMessages[activeChannelId] ?? []) : [];

  // Mark read when switching to channel
  useEffect(() => {
    if (activeChannelId) markChannelRead(activeChannelId);
  }, [activeChannelId, markChannelRead]);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = () => {
    if (!inputText.trim() || !activeChannelId) return;

    const msg: CommMessage = {
      id: uuidv4(),
      channelId: activeChannelId,
      senderId: user?.id ?? 'operator',
      senderName: user?.name ?? 'Operator',
      content: inputText.trim(),
      timestamp: new Date().toISOString(),
      type: 'TEXT',
      isRead: true,
      priority,
    };

    addCommMessage(activeChannelId, msg);
    setInputText('');

    // Broadcast via WebSocket
    if (socket && activeChannelId === 'ch-all') {
      socket.emit('OPERATOR_BROADCAST', {
        message: inputText.trim(),
        severity: priority,
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const totalUnread = commChannels.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header">
        <div className="flex items-center gap-2">
          <Radio className="w-3 h-3 text-[#888]" />
          <span className="panel-title">Communications</span>
        </div>
        {totalUnread > 0 && (
          <span className="text-[8px] font-mono text-[#ff1744] border border-[#ff1744]/30 px-1.5 py-0.5">
            {totalUnread} unread
          </span>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Channel list ─────────────────────────────── */}
        <div className="w-28 border-r border-[#1a1a1a] flex flex-col overflow-y-auto flex-shrink-0">
          {commChannels.map(channel => {
            const Icon = CHANNEL_ICONS[channel.type] ?? Radio;
            const isActive = channel.id === activeChannelId;
            const agency = agencies.find(a => channel.participants.includes(a.id));

            return (
              <button
                key={channel.id}
                onClick={() => setActiveChannel(channel.id)}
                className={`comm-channel ${isActive ? 'active' : ''} flex-col items-start gap-0.5`}
              >
                <div className="flex items-center gap-1.5 w-full">
                  <Icon className="w-3 h-3 flex-shrink-0 text-[#555]" />
                  <span className="text-[9px] font-mono text-[#888] truncate flex-1">{channel.name}</span>
                  {channel.unreadCount > 0 && (
                    <span className="w-3.5 h-3.5 rounded-full bg-[#ff1744] text-white text-[7px] flex items-center justify-center flex-shrink-0">
                      {channel.unreadCount}
                    </span>
                  )}
                </div>
                {channel.lastMessage && (
                  <span className="text-[8px] text-[#333] truncate w-full pl-4">
                    {channel.lastMessage}
                  </span>
                )}
                {agency && (
                  <div className="flex items-center gap-1 pl-4">
                    <span
                      className="comm-status-dot"
                      style={{
                        background: agency.status === 'ONLINE' ? '#00c853'
                          : agency.status === 'BUSY' ? '#ffd600' : '#333',
                      }}
                    />
                    <span className="text-[7px] font-mono text-[#333]">{agency.status}</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Message area ─────────────────────────────── */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Channel header */}
          {activeChannel && (
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1a1a1a] bg-[#080808] flex-shrink-0">
              {activeChannel.type === 'ENCRYPTED' && (
                <Lock className="w-3 h-3 text-[#00c853]" />
              )}
              <span className="text-[9px] font-mono text-[#888]">{activeChannel.name}</span>
              {activeChannel.frequency && (
                <span className="text-[8px] font-mono text-[#333] ml-auto">{activeChannel.frequency}</span>
              )}
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-20 text-[9px] font-mono text-[#222]">
                NO MESSAGES
              </div>
            ) : (
              messages.map((msg, i) => (
                <MessageRow
                  key={msg.id}
                  message={msg}
                  isOwn={msg.senderId === (user?.id ?? 'operator')}
                  showTime={i === 0 || new Date(msg.timestamp).getTime() - new Date(messages[i-1].timestamp).getTime() > 60000}
                />
              ))
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t border-[#1a1a1a] p-2 flex-shrink-0">
            {/* Priority selector */}
            <div className="flex gap-1 mb-2">
              {(['NORMAL', 'URGENT', 'EMERGENCY'] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`
                    px-2 py-0.5 text-[7px] font-mono tracking-widest uppercase border transition-all
                    ${priority === p
                      ? 'border-white text-white'
                      : 'border-[#1a1a1a] text-[#333] hover:border-[#333]'
                    }
                  `}
                  style={priority === p ? { borderColor: PRIORITY_COLORS[p], color: PRIORITY_COLORS[p] } : {}}
                >
                  {p}
                </button>
              ))}
            </div>

            <div className="flex gap-2">
              <textarea
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type message..."
                rows={2}
                className="
                  flex-1 bg-[#080808] border border-[#1a1a1a] text-[10px] text-[#888]
                  px-2 py-1.5 resize-none placeholder:text-[#222]
                  focus:outline-none focus:border-[#333] transition-colors
                "
              />
              <button
                onClick={sendMessage}
                disabled={!inputText.trim()}
                className="
                  w-8 bg-white text-black flex items-center justify-center
                  disabled:opacity-30 hover:bg-[#e0e0e0] transition-colors
                "
              >
                <Send className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message row ───────────────────────────────────────────────

function MessageRow({
  message, isOwn, showTime,
}: { message: CommMessage; isOwn: boolean; showTime: boolean }) {
  const typeColor = MSG_TYPE_COLORS[message.type] ?? '#555';
  const priorityColor = PRIORITY_COLORS[message.priority] ?? '#555';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'}`}
    >
      {showTime && (
        <span className="text-[7px] font-mono text-[#222] mb-1">
          {format(new Date(message.timestamp), 'HH:mm')}
        </span>
      )}

      {!isOwn && (
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[8px] font-mono text-[#444]">{message.senderName}</span>
          {message.senderAgency && (
            <span className="text-[7px] font-mono text-[#333]">[{message.senderAgency}]</span>
          )}
          {message.type !== 'TEXT' && (
            <span className="text-[7px] font-mono px-1 border" style={{ borderColor: `${typeColor}40`, color: typeColor }}>
              {message.type}
            </span>
          )}
        </div>
      )}

      <div
        className={`
          max-w-[90%] px-2.5 py-1.5 text-[10px] leading-relaxed
          ${isOwn
            ? 'bg-white text-black'
            : 'bg-[#0d0d0d] border border-[#1a1a1a] text-[#ccc]'
          }
        `}
        style={message.priority !== 'NORMAL' && !isOwn
          ? { borderColor: `${priorityColor}40` }
          : {}
        }
      >
        {message.content}
      </div>
    </motion.div>
  );
}
