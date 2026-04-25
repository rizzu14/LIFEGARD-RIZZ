// ============================================================
// LIFEGRID – Real-Time Threat Detection
// ============================================================
//
// Detects and responds to:
//   - Brute force attacks (login, API key)
//   - Credential stuffing
//   - DDoS patterns
//   - Anomalous access patterns
//   - Insider threats (unusual operator behavior)
//   - False emergency report patterns
//   - Data exfiltration attempts
// ============================================================

import { RedisManager } from '../cache/RedisManager';
import { logger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';
import { SecureAPIGateway } from './SecureAPIGateway';

// ── Threat scoring weights ────────────────────────────────────

const THREAT_WEIGHTS = {
  FAILED_LOGIN:           10,
  INVALID_TOKEN:          5,
  RATE_LIMIT_HIT:         8,
  SQL_INJECTION_ATTEMPT:  50,
  XSS_ATTEMPT:            40,
  SUSPICIOUS_UA:          30,
  RAPID_REQUESTS:         15,
  UNUSUAL_HOURS:          5,
  MULTIPLE_LOCATIONS:     20,
  FALSE_REPORT_PATTERN:   25,
  DATA_SCRAPING:          35,
};

const THREAT_THRESHOLDS = {
  WARN:  30,
  BLOCK: 80,
  BAN:   150,
};

export interface ThreatEvent {
  type: keyof typeof THREAT_WEIGHTS;
  ip: string;
  userId?: string;
  timestamp: string;
  details?: string;
}

export interface ThreatScore {
  ip: string;
  score: number;
  level: 'CLEAN' | 'SUSPICIOUS' | 'BLOCKED' | 'BANNED';
  events: string[];
  lastUpdated: string;
}

export class ThreatDetection {

  // ── Record threat event ───────────────────────────────────

  static async recordEvent(event: ThreatEvent): Promise<ThreatScore> {
    const key = `threat:${event.ip}`;
    const weight = THREAT_WEIGHTS[event.type] ?? 5;

    // Increment score with 1-hour TTL
    const scoreStr = await RedisManager.get(key);
    const currentScore = scoreStr ? JSON.parse(scoreStr) : { score: 0, events: [] };

    currentScore.score += weight;
    currentScore.events.push(`${event.type}@${event.timestamp}`);
    currentScore.events = currentScore.events.slice(-20);  // Keep last 20 events
    currentScore.lastUpdated = new Date().toISOString();

    await RedisManager.set(key, JSON.stringify(currentScore), 3600);

    const level = this.scoreToLevel(currentScore.score);

    if (level === 'BLOCKED' || level === 'BANNED') {
      SecureAPIGateway.blockIP(event.ip);
      logger.warn(`[Threat] IP ${event.ip} ${level}. Score: ${currentScore.score}. Event: ${event.type}`);
    }

    if (event.userId && level !== 'CLEAN') {
      await this.recordUserThreat(event.userId, event.type, currentScore.score);
    }

    return { ip: event.ip, ...currentScore, level };
  }

  // ── Middleware: track failed logins ───────────────────────

  static trackFailedLogin(ip: string, userId?: string): void {
    this.recordEvent({
      type: 'FAILED_LOGIN',
      ip,
      userId,
      timestamp: new Date().toISOString(),
    }).catch(() => {});
  }

  // ── Middleware: anomaly detection ─────────────────────────

  static async detectAnomalies(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const ip = req.ip ?? '';

    // Check existing threat score
    const key = `threat:${ip}`;
    const scoreStr = await RedisManager.get(key);
    if (scoreStr) {
      const score = JSON.parse(scoreStr);
      const level = ThreatDetection.scoreToLevel(score.score);
      if (level === 'BLOCKED' || level === 'BANNED') {
        return next(new AppError('Access denied', 403, 'THREAT_BLOCKED'));
      }
    }

    // Rapid request detection (> 100 req/min from same IP)
    const reqKey = `reqcount:${ip}`;
    const reqCountStr = await RedisManager.get(reqKey);
    const reqCount = reqCountStr ? parseInt(reqCountStr, 10) : 0;

    if (reqCount === 0) {
      await RedisManager.set(reqKey, '1', 60);
    } else {
      await RedisManager.set(reqKey, String(reqCount + 1), 60);
      if (reqCount > 100) {
        await ThreatDetection.recordEvent({
          type: 'RAPID_REQUESTS',
          ip,
          timestamp: new Date().toISOString(),
          details: `${reqCount} requests in 60s`,
        });
      }
    }

    next();
  }

  // ── False report pattern detection ───────────────────────

  static async detectFalseReportPattern(
    reporterId: string,
    ip: string,
  ): Promise<{ isSuspicious: boolean; reason?: string }> {
    const key = `reports:${reporterId}`;
    const countStr = await RedisManager.get(key);
    const count = countStr ? parseInt(countStr, 10) : 0;

    if (count === 0) {
      await RedisManager.set(key, '1', 3600);
    } else {
      await RedisManager.set(key, String(count + 1), 3600);
    }

    // More than 5 reports per hour from same reporter
    if (count >= 5) {
      await this.recordEvent({
        type: 'FALSE_REPORT_PATTERN',
        ip,
        userId: reporterId,
        timestamp: new Date().toISOString(),
        details: `${count + 1} reports in 1 hour`,
      });
      return { isSuspicious: true, reason: 'Excessive report frequency' };
    }

    return { isSuspicious: false };
  }

  // ── Insider threat detection ──────────────────────────────

  static async detectInsiderThreat(
    operatorId: string,
    action: string,
    resourceCount: number,
  ): Promise<void> {
    // Flag if operator accesses unusually large number of records
    if (resourceCount > 1000) {
      logger.warn(`[Threat] Potential data exfiltration: operator ${operatorId} accessed ${resourceCount} records`);
      await this.recordUserThreat(operatorId, 'DATA_SCRAPING', 35);
    }

    // Flag unusual hours (2am–5am local time)
    const hour = new Date().getHours();
    if (hour >= 2 && hour <= 5) {
      await this.recordUserThreat(operatorId, 'UNUSUAL_HOURS', 5);
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  private static scoreToLevel(score: number): ThreatScore['level'] {
    if (score >= THREAT_THRESHOLDS.BAN)    return 'BANNED';
    if (score >= THREAT_THRESHOLDS.BLOCK)  return 'BLOCKED';
    if (score >= THREAT_THRESHOLDS.WARN)   return 'SUSPICIOUS';
    return 'CLEAN';
  }

  private static async recordUserThreat(
    userId: string,
    eventType: string,
    score: number,
  ): Promise<void> {
    const key = `userthreat:${userId}`;
    const existing = await RedisManager.get(key);
    const data = existing ? JSON.parse(existing) : { score: 0, events: [] };
    data.score += score;
    data.events.push(`${eventType}@${new Date().toISOString()}`);
    data.events = data.events.slice(-10);
    await RedisManager.set(key, JSON.stringify(data), 86400);
  }
}
