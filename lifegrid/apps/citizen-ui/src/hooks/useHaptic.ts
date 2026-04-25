// ============================================================
// LIFEGRID – Haptic Feedback Hook
// Vibration API wrapper with named patterns
// ============================================================

type HapticPattern = 'tap' | 'success' | 'warning' | 'error' | 'sos' | 'tick';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap:     10,
  tick:    5,
  success: [50, 30, 80],
  warning: [100, 50, 100],
  error:   [200, 100, 200, 100, 200],
  sos:     [300, 100, 300, 100, 300],
};

export function useHaptic() {
  const isSupported = 'vibrate' in navigator;

  const haptic = (pattern: HapticPattern = 'tap') => {
    if (!isSupported) return;
    try {
      navigator.vibrate(PATTERNS[pattern]);
    } catch {
      // Silently fail — haptics are enhancement only
    }
  };

  return { haptic, isSupported };
}
