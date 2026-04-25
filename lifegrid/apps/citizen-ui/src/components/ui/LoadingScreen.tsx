import React from 'react';

export function LoadingScreen() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center gap-6">
      <div className="w-12 h-12 border-2 border-gray-200 flex items-center justify-center rounded-lg">
        <span className="text-sm font-mono font-bold text-gray-800 tracking-widest">LG</span>
      </div>
      <div className="flex gap-1.5">
        {[0, 1, 2].map(i => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse"
            style={{ animationDelay: `${i * 0.2}s` }}
          />
        ))}
      </div>
      <span className="text-[10px] font-mono text-gray-400 tracking-widest uppercase">
        LIFEGRID LOADING
      </span>
    </div>
  );
}
