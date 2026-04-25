// ============================================================
// LIFEGRID – Key Management Service
// ============================================================
//
// Manages cryptographic keys for:
//   - JWT signing (RS256 asymmetric)
//   - AES-256-GCM data encryption
//   - HMAC-SHA256 signing
//   - Dispatch channel keys (HKDF derived)
//   - API signing keys
//
// Key rotation policy:
//   JWT signing keys:    90-day rotation
//   Encryption keys:     180-day rotation
//   API keys:            365-day rotation or on compromise
//   Dispatch channels:   Per-incident (ephemeral)
//
// Key storage:
//   Production: AWS KMS / HashiCorp Vault / Azure Key Vault
//   Development: Environment variables (never committed)
// ============================================================

import crypto from 'crypto';
import { RedisManager } from '../cache/RedisManager';
import { logger } from '../utils/logger';

export interface KeyMetadata {
  keyId:       string;
  algorithm:   string;
  purpose:     string;
  createdAt:   string;
  expiresAt:   string;
  rotatedAt?:  string;
  isActive:    boolean;
  version:     number;
}

export class KeyManagement {

  // ── Generate API key ──────────────────────────────────────

  static generateAPIKey(prefix: string = 'lg'): {
    key: string;
    hash: string;
    metadata: KeyMetadata;
  } {
    // Format: lg_live_<32-byte-hex>
    const rawKey = crypto.randomBytes(32).toString('hex');
    const key = `${prefix}_live_${rawKey}`;

    // Store only the hash — never the raw key
    const hash = crypto.createHash('sha256').update(key).digest('hex');

    const metadata: KeyMetadata = {
      keyId:     crypto.randomUUID(),
      algorithm: 'SHA-256',
      purpose:   'API_ACCESS',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 365 * 86400000).toISOString(),
      isActive:  true,
      version:   1,
    };

    return { key, hash, metadata };
  }

  // ── Verify API key ────────────────────────────────────────

  static async verifyAPIKey(key: string): Promise<boolean> {
    const hash = crypto.createHash('sha256').update(key).digest('hex');
    const stored = await RedisManager.get(`apikey:${hash}`);
    return stored === 'valid';
  }

  // ── Generate ephemeral dispatch key ──────────────────────

  static generateDispatchKey(incidentId: string, responderId: string): {
    channelId: string;
    sessionKey: Buffer;
    encryptedKey: string;
    expiresAt: string;
  } {
    const masterKey = Buffer.from(process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex');
    const channelId = crypto.randomUUID();
    const sessionKey = crypto.randomBytes(32);

    // HKDF key derivation
    const salt = crypto.randomBytes(16);
    const info = Buffer.from(`lifegrid:dispatch:${incidentId}:${responderId}:${channelId}`);
    const derivedKey = crypto.hkdfSync('sha256', sessionKey, salt, info, 32);

    // Encrypt with master key
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(derivedKey)), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const encryptedKey = Buffer.concat([salt, iv, authTag, encrypted]).toString('base64');

    // 24-hour expiry for dispatch keys
    const expiresAt = new Date(Date.now() + 86400000).toISOString();

    return { channelId, sessionKey, encryptedKey, expiresAt };
  }

  // ── Key rotation check ────────────────────────────────────

  static isKeyExpired(metadata: KeyMetadata): boolean {
    return new Date(metadata.expiresAt) < new Date();
  }

  static shouldRotate(metadata: KeyMetadata, warningDays: number = 14): boolean {
    const expiresAt = new Date(metadata.expiresAt);
    const warningDate = new Date(Date.now() + warningDays * 86400000);
    return expiresAt < warningDate;
  }

  // ── Secure key derivation ─────────────────────────────────

  static deriveKey(
    masterKey: Buffer,
    context: string,
    length: number = 32,
  ): Buffer {
    const salt = crypto.createHash('sha256').update(context).digest();
    const info = Buffer.from(`lifegrid:${context}`);
    return Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, info, length));
  }

  // ── Zero-knowledge proof of key possession ────────────────

  static proveKeyPossession(key: Buffer, challenge: string): string {
    return crypto.createHmac('sha256', key).update(challenge).digest('hex');
  }

  static verifyKeyPossession(key: Buffer, challenge: string, proof: string): boolean {
    const expected = this.proveKeyPossession(key, challenge);
    return crypto.timingSafeEqual(
      Buffer.from(proof, 'hex'),
      Buffer.from(expected, 'hex'),
    );
  }

  // ── Secure memory wipe ────────────────────────────────────

  static wipeKey(key: Buffer): void {
    // Overwrite buffer with zeros before GC
    key.fill(0);
  }
}
