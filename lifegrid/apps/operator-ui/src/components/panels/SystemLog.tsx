import React, { useRef, useEffect } from 'react';
import { useOperatorStore } from '../../store/operatorStore';
import { format } from 'date-fns';

const LOG_COLORS: Record<string, string> = {
  INCIDENT:  '#e8e8e8',
  DISPATCH:  '#00b0ff',
  SENSOR:    '#ffd600',
  SYSTEM:    '#ff6d00',
  BROADCAST: '#888',
  INFO:      '#555',
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: '#ff1744',
  HIGH:     '#ff6d00',
  MEDIUM:   '#ffd600',
  LOW:      '#00c853',
  INFO:     '#555',
};

export function SystemLog() {
  const { logEntries } = useOperatorStore();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logEntries]);

  return (
    <div className="panel h-full">
      <div className="panel-header">
        <span className="panel-title">System Log</span>
        <span className="text-[8px] font-mono text-[#333]">{logEntries.length} entries</span>
      </div>

      <div className="panel-body font-mono">
        {logEntries.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-[9px] text-[#222]">
            AWAITING EVENTS<span className="animate-blink-cursor">_</span>
          </div>
        ) : (
          logEntries.map((entry, i) => (
            <div
              key={i}
              className="flex gap-2 px-3 py-1.5 border-b border-[#0d0d0d] hover:bg-[#080808] transition-colors"
            >
              {/* Timestamp */}
              <span className="text-[8px] text-[#333] flex-shrink-0 tabular-nums">
                {format(new Date(entry.timestamp), 'HH:mm:ss')}
              </span>

              {/* Type badge */}
              <span
                className="text-[7px] tracking-widest uppercase flex-shrink-0 w-16"
                style={{ color: LOG_COLORS[entry.type] ?? '#555' }}
              >
                [{entry.type}]
              </span>

              {/* Severity dot */}
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1"
                style={{ background: SEVERITY_COLORS[entry.severity] ?? '#333' }}
              />

              {/* Message */}
              <span className="text-[9px] text-[#666] flex-1 leading-relaxed">
                {entry.message}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
