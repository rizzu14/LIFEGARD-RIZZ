// ============================================================
// LIFEGRID – Dispatch Encryption Service
// AES-256-GCM per-channel key derivation
// ============================================================

import crypto from 'crypto';

const MASTER_KEY = Buffer.from(
  process.env.ENCRYPTION_KEY ?? '0'.repeat(64), 'hex',
);
const ALGORITHM = 'aes-256-gcm';

export const EncryptionService = {
  async createSecureChannel(
    incidentId: string,
    responderId: string,
  ): Promise<{ channelId: string; encryptedKey: string }> {
    const channelId  = crypto.randomUUID();
    const channelKey = crypto.randomBytes(32);

    // Derive channel key using HKDF
    const salt = crypto.randomBytes(16);
    const info = Buffer.from(`${incidentId}:${responderId}:${channelId}`);
    const derivedKey = crypto.hkdfSync('sha256', channelKey, salt, info, 32);

    // Encrypt channel key with master key
    const iv      = crypto.randomBytes(16);
    const cipher  = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(derivedKey)), cipher.final()]);
    const authTag   = cipher.getAuthTag();

    const encryptedKey = Buffer.concat([salt, iv, authTag, encrypted]).toString('base64');

    return { channelId, encryptedKey };
  },

  sign(data: string): string {
    return crypto.createHmac('sha256', MASTER_KEY).update(data).digest('hex');
  },

  encrypt(plaintext: string): string {
    const iv      = crypto.randomBytes(16);
    const cipher  = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
    const enc     = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, enc]).toString('base64');
  },

  decrypt(ciphertext: string): string {
    const buf     = Buffer.from(ciphertext, 'base64');
    const iv      = buf.subarray(0, 16);
    const authTag = buf.subarray(16, 32);
    const enc     = buf.subarray(32);
    const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  },
};
