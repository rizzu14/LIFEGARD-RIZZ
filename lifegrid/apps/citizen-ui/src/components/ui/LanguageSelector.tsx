import React, { useState } from 'react';
import { Globe } from 'lucide-react';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
  { code: 'zh', label: '中文' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
];

interface LanguageSelectorProps {
  value: string;
  onChange: (lang: string) => void;
  compact?: boolean;
}

export function LanguageSelector({ value, onChange, compact = false }: LanguageSelectorProps) {
  const [open, setOpen] = useState(false);
  const current = LANGUAGES.find(l => l.code === value) ?? LANGUAGES[0];

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 px-2 py-1 border border-gray-200 hover:border-gray-400 transition-colors rounded"
        aria-label="Select language"
        aria-expanded={open}
      >
        <Globe className="w-3 h-3 text-gray-400" />
        <span className="text-[10px] text-gray-500 font-mono uppercase">{current.code}</span>
      </button>

      {open && (
        <div className="absolute right-0 top-8 z-50 bg-white border border-gray-200 min-w-[140px] shadow-lg rounded">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              onClick={() => { onChange(lang.code); setOpen(false); }}
              className={`
                w-full text-left px-3 py-2 text-xs hover:bg-gray-50 transition-colors
                ${value === lang.code ? 'text-gray-900 font-semibold' : 'text-gray-500'}
              `}
            >
              {lang.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
