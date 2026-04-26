// ============================================================
// LIFEGRID – Floating AI Call Button
// Fixed bottom-right · Always visible · Emergency red theme
// ============================================================

import React, { useState } from 'react';
import { Phone, X, Copy, Check } from 'lucide-react';

const TWILIO_NUMBER     = '+19785103930';
const TWILIO_DISPLAY    = '+1 (978) 510-3930';

export function FloatingCallButton() {
  const [expanded, setExpanded]   = useState(false);
  const [copied, setCopied]       = useState(false);
  const [tooltip, setTooltip]     = useState(false);

  const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

  const handleCall = () => {
    window.location.href = `tel:${TWILIO_NUMBER}`;
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(TWILIO_NUMBER);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement('input');
      el.value = TWILIO_NUMBER;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      {/* ── Styles injected once ─────────────────────────── */}
      <style>{`
        @keyframes fcb-pulse {
          0%   { box-shadow: 0 0 0 0   rgba(255,59,59,0.55), 0 8px 32px rgba(255,59,59,0.30); }
          60%  { box-shadow: 0 0 0 14px rgba(255,59,59,0),   0 8px 32px rgba(255,59,59,0.30); }
          100% { box-shadow: 0 0 0 0   rgba(255,59,59,0),    0 8px 32px rgba(255,59,59,0.30); }
        }
        @keyframes fcb-ring {
          0%   { transform: rotate(0deg)   scale(1);    }
          10%  { transform: rotate(-12deg) scale(1.08); }
          20%  { transform: rotate(12deg)  scale(1.08); }
          30%  { transform: rotate(-8deg)  scale(1);    }
          40%  { transform: rotate(8deg)   scale(1);    }
          50%  { transform: rotate(0deg)   scale(1);    }
          100% { transform: rotate(0deg)   scale(1);    }
        }
        .fcb-pill {
          animation: fcb-pulse 2.2s ease-out infinite;
        }
        .fcb-pill:hover {
          transform: scale(1.04);
          box-shadow: 0 0 0 0 rgba(255,59,59,0), 0 12px 40px rgba(255,59,59,0.45) !important;
          animation: none;
        }
        .fcb-icon-wrap {
          animation: fcb-ring 3s ease-in-out infinite;
        }
        .fcb-copy:hover { background: rgba(255,255,255,0.18) !important; }
        .fcb-call-btn:hover { background: rgba(255,255,255,0.15) !important; }
      `}</style>

      {/* ── Floating container ────────────────────────────── */}
      <div style={{
        position: 'fixed',
        bottom: 84,          // above bottom nav
        right: 16,
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-end',
        gap: 10,
        pointerEvents: 'none',
      }}>

        {/* ── Expanded card ─────────────────────────────── */}
        {expanded && (
          <div
            style={{
              pointerEvents: 'auto',
              background: 'linear-gradient(145deg, #1a0a0a, #2d0f0f)',
              border: '1px solid rgba(255,59,59,0.3)',
              borderRadius: 20,
              padding: '16px 18px',
              width: 230,
              boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
              animation: 'fcb-fade-in 0.18s ease-out',
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: '50%',
                background: 'rgba(255,59,59,0.15)',
                border: '1px solid rgba(255,59,59,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                flexShrink: 0,
              }}>
                <span style={{ fontSize: 16 }}>🤖</span>
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#fff', lineHeight: 1.2 }}>LIFEGRID AI</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e', animation: 'pulse 1.5s infinite' }} />
                  <span style={{ fontSize: 9, color: '#22c55e', fontFamily: 'monospace', letterSpacing: '0.08em' }}>AI IS LIVE</span>
                </div>
              </div>
            </div>

            {/* Number display */}
            <div style={{
              background: 'rgba(255,255,255,0.06)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 10,
              padding: '8px 12px',
              marginBottom: 12,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <span style={{ fontSize: 13, fontFamily: 'monospace', fontWeight: 700, color: '#fff', letterSpacing: '0.05em' }}>
                {TWILIO_DISPLAY}
              </span>
              <button
                className="fcb-copy"
                onClick={handleCopy}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: '4px 6px', borderRadius: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'background 0.15s',
                }}
                title="Copy number"
              >
                {copied
                  ? <Check style={{ width: 13, height: 13, color: '#22c55e' }} />
                  : <Copy  style={{ width: 13, height: 13, color: 'rgba(255,255,255,0.5)' }} />
                }
              </button>
            </div>

            {/* Call button */}
            <button
              className="fcb-call-btn"
              onClick={handleCall}
              style={{
                width: '100%', padding: '11px',
                background: '#ff3b3b',
                border: 'none', borderRadius: 12,
                color: '#fff', fontWeight: 700, fontSize: 13,
                cursor: 'pointer', letterSpacing: '0.04em',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                transition: 'background 0.15s',
              }}
            >
              <Phone style={{ width: 15, height: 15 }} />
              {isMobile ? 'Call Now' : 'Open Dialer'}
            </button>

            {/* Desktop hint */}
            {!isMobile && (
              <p style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textAlign: 'center', margin: '8px 0 0', lineHeight: 1.4 }}>
                On desktop, call from your phone
              </p>
            )}
          </div>
        )}

        {/* ── Main pill button ──────────────────────────── */}
        <div
          style={{ pointerEvents: 'auto', position: 'relative' }}
          onMouseEnter={() => setTooltip(true)}
          onMouseLeave={() => setTooltip(false)}
        >
          {/* Tooltip (desktop only) */}
          {tooltip && !expanded && (
            <div style={{
              position: 'absolute', right: '110%', top: '50%', transform: 'translateY(-50%)',
              background: 'rgba(15,23,42,0.92)', color: '#fff',
              fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
              padding: '6px 10px', borderRadius: 8,
              boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
              pointerEvents: 'none',
            }}>
              Call LIFEGRID AI
              <div style={{
                position: 'absolute', right: -5, top: '50%', transform: 'translateY(-50%)',
                width: 0, height: 0,
                borderTop: '5px solid transparent',
                borderBottom: '5px solid transparent',
                borderLeft: '5px solid rgba(15,23,42,0.92)',
              }} />
            </div>
          )}

          <button
            className="fcb-pill"
            onClick={() => setExpanded(e => !e)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '12px 18px 12px 14px',
              background: 'linear-gradient(135deg, #ff3b3b 0%, #cc1f1f 100%)',
              border: 'none', borderRadius: 99,
              color: '#fff', cursor: 'pointer',
              transition: 'transform 0.15s ease, box-shadow 0.15s ease',
            }}
            aria-label="Call LIFEGRID AI Emergency Line"
          >
            <div className="fcb-icon-wrap" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', flexShrink: 0 }}>
              {expanded
                ? <X     style={{ width: 14, height: 14, color: '#fff' }} />
                : <Phone style={{ width: 14, height: 14, color: '#fff' }} />
              }
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.04em', lineHeight: 1.2 }}>
                Call LIFEGRID AI
              </div>
              <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.7)', letterSpacing: '0.08em', fontFamily: 'monospace' }}>
                EMERGENCY AI AGENT
              </div>
            </div>
          </button>
        </div>
      </div>
    </>
  );
}
