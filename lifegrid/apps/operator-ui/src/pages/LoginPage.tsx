import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader, Eye, EyeOff, Shield } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { api } from '../lib/api';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [showMfa, setShowMfa] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await api.post('/auth/login', { email, password, mfaCode: mfaCode || undefined });
      const { user, ...tokens } = response.data.data;
      setAuth(user, tokens);
      navigate('/');
    } catch (err: any) {
      const code = err.response?.data?.error?.code;
      if (code === 'MFA_REQUIRED') {
        setShowMfa(true);
        setError('Enter your MFA code to continue');
      } else {
        setError(err.response?.data?.error?.message ?? 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white flex items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        {/* Brand */}
        <div className="flex items-center gap-3 mb-12">
          <div className="w-8 h-8 border border-[#333] flex items-center justify-center">
            <span className="text-[9px] font-mono font-bold">LG</span>
          </div>
          <div>
            <div className="text-xs font-bold tracking-[0.3em] uppercase">LIFEGRID</div>
            <div className="text-[9px] text-[#333] font-mono tracking-widest">COMMAND CENTER ACCESS</div>
          </div>
        </div>

        {/* Security notice */}
        <div className="flex items-center gap-2 mb-8 p-3 border border-[#1a1a1a] bg-[#080808]">
          <Shield className="w-3 h-3 text-[#555]" />
          <span className="text-[9px] text-[#555] font-mono">AUTHORIZED PERSONNEL ONLY · MONITORED ACCESS</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-[9px] font-mono text-[#555] tracking-widest uppercase block mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-[#080808] border border-[#1a1a1a] text-white text-sm px-3 py-3 focus:outline-none focus:border-[#333] transition-colors font-mono"
              placeholder="operator@lifegrid.gov"
            />
          </div>

          <div>
            <label className="text-[9px] font-mono text-[#555] tracking-widest uppercase block mb-2">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="w-full bg-[#080808] border border-[#1a1a1a] text-white text-sm px-3 py-3 pr-10 focus:outline-none focus:border-[#333] transition-colors font-mono"
                placeholder="••••••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#333] hover:text-[#666]"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {showMfa && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
              <label className="text-[9px] font-mono text-[#555] tracking-widest uppercase block mb-2">
                MFA Code
              </label>
              <input
                type="text"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                maxLength={6}
                className="w-full bg-[#080808] border border-[#1a1a1a] text-white text-xl px-3 py-3 focus:outline-none focus:border-[#333] transition-colors font-mono tracking-[0.5em] text-center"
                placeholder="000000"
                autoFocus
              />
            </motion.div>
          )}

          {error && (
            <div className="text-[10px] text-[#ff1744] font-mono p-2 border border-[#ff1744]/20 bg-[#ff1744]/5">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="
              w-full py-3 bg-white text-black font-bold text-xs tracking-[0.3em] uppercase
              hover:bg-[#e0e0e0] transition-colors
              disabled:opacity-50 disabled:cursor-not-allowed
              flex items-center justify-center gap-2
              mt-6
            "
          >
            {loading ? <><Loader className="w-4 h-4 animate-spin" /> Authenticating...</> : 'Access Command Center'}
          </button>
        </form>

        <div className="mt-8 text-center text-[9px] text-[#222] font-mono">
          LIFEGRID v1.0 · CLASSIFIED SYSTEM · ALL ACCESS LOGGED
        </div>
      </motion.div>
    </div>
  );
}
