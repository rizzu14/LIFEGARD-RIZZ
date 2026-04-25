// ============================================================
// LIFEGRID – Redundancy Manager
//
// Implements the redundancy formula:
//   R = 1 - [(1 - Ps) × (1 - Pc)]
//
// Where:
//   Ps = Probability of primary path success
//   Pc = Probability of contingency path success
//   R  = Overall system reliability
//
// Paths:
//   Primary (Ps):     Internet → API Gateway → Kafka
//   Contingency (Pc): Satellite link → Ingestion Service
//   Tertiary:         SMS fallback → Twilio → Kafka
//   Quaternary:       Local offline queue → sync on reconnect
//
// Target: R ≥ 0.9999 (four nines)
//   Ps = 0.999 (internet path)
//   Pc = 0.998 (satellite path)
//   R  = 1 - (0.001 × 0.002) = 1 - 0.000002 = 0.999998 ✓
// ============================================================

import { logger } from '../utils/logger';

export interface PathStatus {
  name: string;
  isAvailable: boolean;
  latencyMs: number;
  successRate: number;   // rolling 5-minute window
  lastCheck: string;
}

export interface RedundancyStatus {
  overallReliability: number;   // R value
  primaryPath: PathStatus;
  contingencyPath: PathStatus;
  tertiaryPath: PathStatus;
  activePathCount: number;
  formula: string;
}

export class RedundancyManager {
  private static paths: Map<string, PathStatus> = new Map();
  private static checkInterval: ReturnType<typeof setInterval> | null = null;

  // Rolling success counters (last 100 attempts per path)
  private static successHistory: Map<string, boolean[]> = new Map();

  static async initialize(): Promise<void> {
    // Initialize path statuses
    this.paths.set('primary', {
      name: 'Internet → API Gateway → Kafka',
      isAvailable: true,
      latencyMs: 0,
      successRate: 1.0,
      lastCheck: new Date().toISOString(),
    });

    this.paths.set('contingency', {
      name: 'Satellite Link → Direct Ingest',
      isAvailable: true,
      latencyMs: 0,
      successRate: 1.0,
      lastCheck: new Date().toISOString(),
    });

    this.paths.set('tertiary', {
      name: 'SMS Fallback → Twilio',
      isAvailable: true,
      latencyMs: 0,
      successRate: 1.0,
      lastCheck: new Date().toISOString(),
    });

    this.paths.set('quaternary', {
      name: 'Offline Queue → Local Storage',
      isAvailable: true,
      latencyMs: 0,
      successRate: 1.0,
      lastCheck: new Date().toISOString(),
    });

    // Start health checks every 30 seconds
    this.checkInterval = setInterval(() => this.runHealthChecks(), 30000);
    await this.runHealthChecks();

    logger.info(`✅ RedundancyManager initialized. R = ${this.computeReliability().toFixed(6)}`);
  }

  private static async runHealthChecks(): Promise<void> {
    await Promise.allSettled([
      this.checkPrimaryPath(),
      this.checkContingencyPath(),
      this.checkTertiaryPath(),
    ]);
  }

  private static async checkPrimaryPath(): Promise<void> {
    const start = Date.now();
    try {
      // Check Kafka connectivity
      const { Kafka } = await import('kafkajs');
      const kafka = new Kafka({ clientId: 'health-check', brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',') });
      const admin = kafka.admin();
      await admin.connect();
      await admin.listTopics();
      await admin.disconnect();

      this.recordSuccess('primary', true, Date.now() - start);
    } catch {
      this.recordSuccess('primary', false, Date.now() - start);
    }
  }

  private static async checkContingencyPath(): Promise<void> {
    const start = Date.now();
    try {
      // Check satellite link availability (ping satellite gateway)
      const satUrl = process.env.SATELLITE_GATEWAY_URL;
      if (!satUrl) {
        this.recordSuccess('contingency', false, 0);
        return;
      }
      const res = await fetch(`${satUrl}/health`, { signal: AbortSignal.timeout(5000) });
      this.recordSuccess('contingency', res.ok, Date.now() - start);
    } catch {
      this.recordSuccess('contingency', false, Date.now() - start);
    }
  }

  private static async checkTertiaryPath(): Promise<void> {
    // SMS path is always considered available if Twilio credentials exist
    const available = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
    this.recordSuccess('tertiary', available, 0);
  }

  private static recordSuccess(pathName: string, success: boolean, latencyMs: number): void {
    const history = this.successHistory.get(pathName) ?? [];
    history.push(success);
    if (history.length > 100) history.shift();
    this.successHistory.set(pathName, history);

    const successRate = history.filter(Boolean).length / history.length;
    const path = this.paths.get(pathName);
    if (path) {
      path.isAvailable = success;
      path.latencyMs = latencyMs;
      path.successRate = successRate;
      path.lastCheck = new Date().toISOString();
    }
  }

  // ── Reliability formula ───────────────────────────────────
  // R = 1 - ∏(1 - Pi) for all independent paths

  static computeReliability(): number {
    const paths = Array.from(this.paths.values());
    const failureProbability = paths.reduce((acc, path) => {
      const Pi = path.successRate;
      return acc * (1 - Pi);
    }, 1);
    return 1 - failureProbability;
  }

  // Simplified two-path formula for display
  static computeTwoPathReliability(Ps: number, Pc: number): number {
    return 1 - (1 - Ps) * (1 - Pc);
  }

  static getStatus(): RedundancyStatus {
    const primary     = this.paths.get('primary')!;
    const contingency = this.paths.get('contingency')!;
    const tertiary    = this.paths.get('tertiary')!;

    const Ps = primary?.successRate ?? 0;
    const Pc = contingency?.successRate ?? 0;
    const R  = this.computeReliability();

    return {
      overallReliability: R,
      primaryPath:     primary,
      contingencyPath: contingency,
      tertiaryPath:    tertiary,
      activePathCount: Array.from(this.paths.values()).filter(p => p.isAvailable).length,
      formula: `R = 1 - [(1 - ${Ps.toFixed(4)}) × (1 - ${Pc.toFixed(4)})] = ${R.toFixed(6)}`,
    };
  }

  // Select best available path for a given message
  static selectPath(preferSatellite = false): string {
    if (preferSatellite && this.paths.get('contingency')?.isAvailable) {
      return 'contingency';
    }
    if (this.paths.get('primary')?.isAvailable) return 'primary';
    if (this.paths.get('contingency')?.isAvailable) return 'contingency';
    if (this.paths.get('tertiary')?.isAvailable) return 'tertiary';
    return 'quaternary';  // offline queue
  }

  static stop(): void {
    if (this.checkInterval) clearInterval(this.checkInterval);
  }
}
