// ============================================================
// LIFEGRID – Circuit Breaker
// Prevents cascade failures across microservices
//
// States:
//   CLOSED   → Normal operation, requests pass through
//   OPEN     → Failing, requests rejected immediately
//   HALF_OPEN → Testing recovery, limited requests allowed
//
// Configuration per service:
//   failureThreshold:  failures before opening
//   successThreshold:  successes in HALF_OPEN before closing
//   timeout:           ms before attempting HALF_OPEN
//   volumeThreshold:   min requests before evaluating
// ============================================================

import { logger } from '../utils/logger';

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitConfig {
  failureThreshold:  number;   // % failures to open (0–100)
  successThreshold:  number;   // successes to close from HALF_OPEN
  timeout:           number;   // ms before HALF_OPEN attempt
  volumeThreshold:   number;   // min requests in window
  windowMs:          number;   // rolling window duration
}

interface CircuitStats {
  requests:  number;
  failures:  number;
  successes: number;
  lastFailure?: string;
  lastSuccess?: string;
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold:  50,
  successThreshold:  3,
  timeout:           30000,
  volumeThreshold:   10,
  windowMs:          60000,
};

export class CircuitBreaker {
  private static circuits = new Map<string, {
    state:       CircuitState;
    config:      CircuitConfig;
    stats:       CircuitStats;
    windowStart: number;
    openedAt?:   number;
    halfOpenSuccesses: number;
  }>();

  // ── Register a circuit ────────────────────────────────────

  static register(name: string, config: Partial<CircuitConfig> = {}): void {
    this.circuits.set(name, {
      state:       'CLOSED',
      config:      { ...DEFAULT_CONFIG, ...config },
      stats:       { requests: 0, failures: 0, successes: 0 },
      windowStart: Date.now(),
      halfOpenSuccesses: 0,
    });
  }

  // ── Execute with circuit breaker ──────────────────────────

  static async execute<T>(
    name: string,
    fn: () => Promise<T>,
    fallback?: () => T | Promise<T>,
  ): Promise<T> {
    if (!this.circuits.has(name)) {
      this.register(name);
    }

    const circuit = this.circuits.get(name)!;

    // Reset window if expired
    if (Date.now() - circuit.windowStart > circuit.config.windowMs) {
      circuit.stats = { requests: 0, failures: 0, successes: 0 };
      circuit.windowStart = Date.now();
    }

    // Check state
    if (circuit.state === 'OPEN') {
      const elapsed = Date.now() - (circuit.openedAt ?? 0);
      if (elapsed >= circuit.config.timeout) {
        circuit.state = 'HALF_OPEN';
        circuit.halfOpenSuccesses = 0;
        logger.info(`[Circuit] ${name}: OPEN → HALF_OPEN`);
      } else {
        // Circuit is open — use fallback or throw
        if (fallback) return fallback();
        throw new Error(`Circuit breaker OPEN for ${name}`);
      }
    }

    // Execute
    circuit.stats.requests++;
    try {
      const result = await fn();
      this.onSuccess(name);
      return result;
    } catch (err) {
      this.onFailure(name, err as Error);
      if (fallback) return fallback();
      throw err;
    }
  }

  private static onSuccess(name: string): void {
    const circuit = this.circuits.get(name)!;
    circuit.stats.successes++;
    circuit.stats.lastSuccess = new Date().toISOString();

    if (circuit.state === 'HALF_OPEN') {
      circuit.halfOpenSuccesses++;
      if (circuit.halfOpenSuccesses >= circuit.config.successThreshold) {
        circuit.state = 'CLOSED';
        logger.info(`[Circuit] ${name}: HALF_OPEN → CLOSED`);
      }
    }
  }

  private static onFailure(name: string, err: Error): void {
    const circuit = this.circuits.get(name)!;
    circuit.stats.failures++;
    circuit.stats.lastFailure = new Date().toISOString();

    if (circuit.state === 'HALF_OPEN') {
      circuit.state = 'OPEN';
      circuit.openedAt = Date.now();
      logger.warn(`[Circuit] ${name}: HALF_OPEN → OPEN (failure in test)`);
      return;
    }

    if (circuit.state === 'CLOSED') {
      const { requests, failures } = circuit.stats;
      if (requests >= circuit.config.volumeThreshold) {
        const failureRate = (failures / requests) * 100;
        if (failureRate >= circuit.config.failureThreshold) {
          circuit.state = 'OPEN';
          circuit.openedAt = Date.now();
          logger.warn(`[Circuit] ${name}: CLOSED → OPEN (failure rate: ${failureRate.toFixed(1)}%)`);
        }
      }
    }
  }

  // ── Status ────────────────────────────────────────────────

  static getStatus(): Record<string, { state: CircuitState; stats: CircuitStats }> {
    const status: Record<string, any> = {};
    for (const [name, circuit] of this.circuits) {
      status[name] = { state: circuit.state, stats: circuit.stats };
    }
    return status;
  }

  static isOpen(name: string): boolean {
    return this.circuits.get(name)?.state === 'OPEN';
  }
}

// ── Pre-register all service circuits ────────────────────────

CircuitBreaker.register('ai-engine',       { failureThreshold: 40, timeout: 15000 });
CircuitBreaker.register('osrm-routing',    { failureThreshold: 50, timeout: 10000 });
CircuitBreaker.register('twilio-sms',      { failureThreshold: 30, timeout: 60000 });
CircuitBreaker.register('fcm-push',        { failureThreshold: 30, timeout: 30000 });
CircuitBreaker.register('postgres-write',  { failureThreshold: 20, timeout: 5000  });
CircuitBreaker.register('postgres-read',   { failureThreshold: 30, timeout: 5000  });
CircuitBreaker.register('kafka-publish',   { failureThreshold: 20, timeout: 5000  });
CircuitBreaker.register('satellite-ingest',{ failureThreshold: 60, timeout: 120000 });
