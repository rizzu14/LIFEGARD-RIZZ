// ============================================================
// LIFEGRID – Identity Masking Service
// ============================================================
//
// Protects citizen identity throughout the emergency pipeline:
//
//   1. Anonymous reporting — no identity required for SOS
//   2. Pseudonymous tracking — reference code instead of user ID
//   3. Operator view masking — operators see masked identifiers
//   4. Responder view masking — responders see only what's needed
//   5. Audit trail — full identity in encrypted audit log only
//   6. Witness protection mode — complete identity suppression
//
// Identity masking layers:
//   Layer 1: Transport (TLS 1.3)
//   Layer 2: Application (field-level encryption)
//   Layer 3: Database (column encryption for PII)
//   Layer 4: Display (role-based masking in API responses)
//   Layer 5: Audit (encrypted audit trail with key escrow)
// ============================================================

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { PrivacyCompliance, DataCategory } from '../legal/PrivacyCompliance';

const MASK_KEY = process.env.IDENTITY_MASK_KEY ?? crypto.randomBytes(32).toString('hex');

// ── Masking profiles per role ─────────────────────────────────

export interface MaskingProfile {
  showPhone:     boolean;
  showEmail:     boolean;
  showFullName:  boolean;
  showExactLocation: boolean;
  showDeviceId:  boolean;
  showIPAddress: boolean;
  locationPrecision: number;  // decimal places
  phoneFormat:   'FULL' | 'LAST4' | 'MASKED' | 'HIDDEN';
  emailFormat:   'FULL' | 'DOMAIN_ONLY' | 'MASKED' | 'HIDDEN';
}

export const MASKING_PROFILES: Record<string, MaskingProfile> = {
  CITIZEN: {
    showPhone:         true,   // own data
    showEmail:         true,   // own data
    showFullName:      true,   // own data
    showExactLocation: true,   // own data
    showDeviceId:      false,
    showIPAddress:     false,
    locationPrecision: 6,
    phoneFormat:       'FULL',
    emailFormat:       'FULL',
  },
  OPERATOR: {
    showPhone:         true,   // needed for callback
    showEmail:         false,
    showFullName:      true,   // needed for coordination
    showExactLocation: true,   // needed for dispatch
    showDeviceId:      true,
    showIPAddress:     false,
    locationPrecision: 5,
    phoneFormat:       'LAST4',
    emailFormat:       'MASKED',
  },
  SUPERVISOR: {
    showPhone:         true,
    showEmail:         true,
    showFullName:      true,
    showExactLocation: true,
    showDeviceId:      true,
    showIPAddress:     true,
    locationPrecision: 6,
    phoneFormat:       'FULL',
    emailFormat:       'FULL',
  },
  COMMANDER: {
    showPhone:         true,
    showEmail:         true,
    showFullName:      true,
    showExactLocation: true,
    showDeviceId:      true,
    showIPAddress:     true,
    locationPrecision: 6,
    phoneFormat:       'FULL',
    emailFormat:       'FULL',
  },
  RESPONDER: {
    showPhone:         true,   // needed to contact citizen
    showEmail:         false,
    showFullName:      true,
    showExactLocation: true,   // needed for navigation
    showDeviceId:      false,
    showIPAddress:     false,
    locationPrecision: 5,
    phoneFormat:       'FULL',
    emailFormat:       'HIDDEN',
  },
  ANALYST: {
    showPhone:         false,
    showEmail:         false,
    showFullName:      false,
    showExactLocation: false,
    showDeviceId:      false,
    showIPAddress:     false,
    locationPrecision: 2,      // city-level only
    phoneFormat:       'HIDDEN',
    emailFormat:       'HIDDEN',
  },
  SYSTEM_ADMIN: {
    showPhone:         true,
    showEmail:         true,
    showFullName:      true,
    showExactLocation: true,
    showDeviceId:      true,
    showIPAddress:     true,
    locationPrecision: 6,
    phoneFormat:       'FULL',
    emailFormat:       'FULL',
  },
};

// ── Witness protection mode ───────────────────────────────────

export interface WitnessProtectionRecord {
  originalId: string;
  protectedId: string;
  activatedAt: string;
  activatedBy: string;
  reason: string;
  expiresAt: string;
}

const witnessProtectionRegistry = new Map<string, WitnessProtectionRecord>();

export class IdentityMasking {

  // ── Apply masking profile to a data object ────────────────

  static applyMask(data: Record<string, any>, role: string): Record<string, any> {
    const profile = MASKING_PROFILES[role] ?? MASKING_PROFILES.ANALYST;
    const result = { ...data };

    // Phone
    if (result.phone || result.callerPhone) {
      const phone = result.phone ?? result.callerPhone;
      result.phone = this.maskPhone(phone, profile.phoneFormat);
      if (result.callerPhone) result.callerPhone = result.phone;
    }

    // Email
    if (result.email) {
      result.email = this.maskEmail(result.email, profile.emailFormat);
    }

    // Name
    if (result.name && !profile.showFullName) {
      result.name = this.maskName(result.name);
    }

    // Location
    if (result.location) {
      result.location = profile.showExactLocation
        ? result.location
        : PrivacyCompliance.fuzzyLocation(result.location, profile.locationPrecision);
    }
    if (result.location_lat && !profile.showExactLocation) {
      const precision = Math.pow(10, profile.locationPrecision);
      result.location_lat = Math.round(result.location_lat * precision) / precision;
      result.location_lng = Math.round(result.location_lng * precision) / precision;
    }

    // Device ID
    if (result.deviceId && !profile.showDeviceId) {
      result.deviceId = this.pseudonymizeDeviceId(result.deviceId);
    }

    // IP Address
    if (result.ipAddress && !profile.showIPAddress) {
      result.ipAddress = this.maskIPAddress(result.ipAddress);
    }

    return result;
  }

  // ── Mask response middleware ──────────────────────────────

  static maskResponse(req: Request, res: Response, next: NextFunction): void {
    const role = req.user?.role ?? 'ANALYST';
    const originalJson = res.json.bind(res);

    res.json = (data: any) => {
      if (data?.data) {
        data.data = IdentityMasking.deepMask(data.data, role);
      }
      return originalJson(data);
    };

    next();
  }

  static deepMask(obj: any, role: string): any {
    if (Array.isArray(obj)) {
      return obj.map(item => this.deepMask(item, role));
    }
    if (obj && typeof obj === 'object') {
      return this.applyMask(obj, role);
    }
    return obj;
  }

  // ── Witness protection ────────────────────────────────────

  static activateWitnessProtection(
    userId: string,
    activatedBy: string,
    reason: string,
    durationDays: number = 365,
  ): WitnessProtectionRecord {
    const protectedId = `WP-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
    const record: WitnessProtectionRecord = {
      originalId:  userId,
      protectedId,
      activatedAt: new Date().toISOString(),
      activatedBy,
      reason,
      expiresAt:   new Date(Date.now() + durationDays * 86400000).toISOString(),
    };

    witnessProtectionRegistry.set(userId, record);
    witnessProtectionRegistry.set(protectedId, record);

    return record;
  }

  static resolveProtectedId(id: string): string {
    const record = witnessProtectionRegistry.get(id);
    return record?.originalId ?? id;
  }

  static isUnderProtection(userId: string): boolean {
    const record = witnessProtectionRegistry.get(userId);
    if (!record) return false;
    return new Date(record.expiresAt) > new Date();
  }

  // ── Field masking helpers ─────────────────────────────────

  static maskPhone(phone: string, format: MaskingProfile['phoneFormat']): string {
    if (!phone) return '';
    switch (format) {
      case 'FULL':    return phone;
      case 'LAST4':   return `****${phone.slice(-4)}`;
      case 'MASKED':  return phone.replace(/\d(?=\d{4})/g, '*');
      case 'HIDDEN':  return '[REDACTED]';
    }
  }

  static maskEmail(email: string, format: MaskingProfile['emailFormat']): string {
    if (!email) return '';
    const [local, domain] = email.split('@');
    switch (format) {
      case 'FULL':        return email;
      case 'DOMAIN_ONLY': return `***@${domain}`;
      case 'MASKED':      return PrivacyCompliance.maskEmail(email);
      case 'HIDDEN':      return '[REDACTED]';
    }
  }

  static maskName(name: string): string {
    const parts = name.trim().split(' ');
    if (parts.length === 1) return `${parts[0][0]}***`;
    return `${parts[0][0]}*** ${parts[parts.length - 1][0]}***`;
  }

  static maskIPAddress(ip: string): string {
    // IPv4: mask last octet
    if (ip.includes('.')) {
      const parts = ip.split('.');
      return `${parts[0]}.${parts[1]}.${parts[2]}.***`;
    }
    // IPv6: mask last 4 groups
    if (ip.includes(':')) {
      const parts = ip.split(':');
      return parts.slice(0, 4).join(':') + ':****:****:****:****';
    }
    return '***';
  }

  static pseudonymizeDeviceId(deviceId: string): string {
    return crypto
      .createHmac('sha256', MASK_KEY)
      .update(deviceId)
      .digest('hex')
      .slice(0, 12);
  }
}
