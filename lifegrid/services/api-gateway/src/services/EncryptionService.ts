import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? crypto.randomBytes(32).toString('hex');
const ALGORITHM = 'aes-256-gcm';

export class EncryptionService {
  static async createSecureChannel(
    incidentId: string,
    responderId: string,
  ): Promise<{ channelId: string; encryptedKey: string }> {
    const channelId = crypto.randomUUID();
    const channelKey = crypto.randomBytes(32);

    // Encrypt channel key with master key
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(channelKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    const encryptedKey = Buffer.concat([iv, authTag, encrypted]).toString('base64');

    return { channelId, encryptedKey };
  }

  static async sign(data: string): Promise<string> {
    return crypto
      .createHmac('sha256', ENCRYPTION_KEY)
      .update(data)
      .digest('hex');
  }

  static encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  static decrypt(ciphertext: string): string {
    const buf = Buffer.from(ciphertext, 'base64');
    const iv = buf.slice(0, 16);
    const authTag = buf.slice(16, 32);
    const encrypted = buf.slice(32);
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, 'hex'), iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }
}
