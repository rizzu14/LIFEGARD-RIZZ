import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Radio, MapPin } from 'lucide-react';
import { api } from '../../lib/api';
import type { Responder } from '@lifegrid/shared-types';

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE:   '#00c853',
  DISPATCHED:  '#ffd600',
  EN_ROUTE:    '#00b0ff',
  ON_SCENE:    '#ff6d00',
  RETURNING:   '#888',
  OFFLINE:     '#333',
  MAINTENANCE: '#333',
};

export function ResponderPanel() {
  const { data, isLoading } = useQuery({
    queryKey: ['responders'],
    queryFn: () => api.get('/responders'),
    refetchInterval: 15000,
  });

  const responders: Responder[] = data?.data?.data ?? [];

  const byType = responders.reduce((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {} as Record<string, Responder[]>);

  return (
    <div className="panel h-full">
      <div className="panel-header">
        <span className="panel-title">Responders ({responders.length})</span>
        <div className="flex items-center gap-2">
          <span className="text-[8px] font-mono text-[#00c853]">
            {responders.filter(r => r.isAvailable).length} available
          </span>
        </div>
      </div>

      <div className="panel-body">
        {isLoading ? (
          <div className="flex items-center justify-center h-20 text-[9px] font-mono text-[#333] animate-pulse">
            LOADING...
          </div>
        ) : (
          Object.entries(byType).map(([type, units]) => (
            <div key={type}>
              <div className="px-3 py-1.5 bg-[#080808] border-b border-[#1a1a1a]">
                <span className="text-[8px] font-mono text-[#444] tracking-widest uppercase">
                  {type.replace('_', ' ')} ({units.length})
                </span>
              </div>
              {units.map(responder => (
                <div
                  key={responder.id}
                  className="flex items-center gap-3 px-3 py-2 border-b border-[#0d0d0d] hover:bg-[#080808] transition-colors"
                >
                  <div
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: STATUS_COLORS[responder.status] ?? '#333' }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-[10px] text-[#ccc] truncate">{responder.name}</div>
                    <div className="text-[8px] text-[#444] font-mono">{responder.badgeNumber}</div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div
                      className="text-[8px] font-mono"
                      style={{ color: STATUS_COLORS[responder.status] ?? '#333' }}
                    >
                      {responder.status.replace('_', ' ')}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
