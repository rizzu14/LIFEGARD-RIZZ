import { DatabaseManager } from '../DatabaseManager';
import type { User } from '@lifegrid/shared-types';

export class UserRepository {
  static async findByEmail(email: string): Promise<(User & { passwordHash: string }) | null> {
    const row = await DatabaseManager.queryOne<any>(
      'SELECT * FROM lifegrid.users WHERE email = $1',
      [email.toLowerCase()],
    );
    return row ? this.mapRow(row) : null;
  }

  static async findById(id: string): Promise<(User & { passwordHash: string }) | null> {
    const row = await DatabaseManager.queryOne<any>(
      'SELECT * FROM lifegrid.users WHERE id = $1',
      [id],
    );
    return row ? this.mapRow(row) : null;
  }

  static async create(data: User & { passwordHash: string }): Promise<User> {
    await DatabaseManager.query(
      `INSERT INTO lifegrid.users
        (id, email, phone, name, role, language, password_hash, is_verified, is_active, mfa_enabled, permissions, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        data.id, data.email.toLowerCase(), data.phone ?? null, data.name,
        data.role, data.language, data.passwordHash,
        data.isVerified, data.isActive, data.mfaEnabled,
        data.permissions, data.createdAt,
      ],
    );
    return data;
  }

  static async updateLastLogin(id: string): Promise<void> {
    await DatabaseManager.query(
      'UPDATE lifegrid.users SET last_login_at = NOW(), failed_logins = 0 WHERE id = $1',
      [id],
    );
  }

  static async recordFailedLogin(id: string): Promise<void> {
    await DatabaseManager.query(
      `UPDATE lifegrid.users
       SET failed_logins = failed_logins + 1,
           locked_until = CASE WHEN failed_logins >= 4 THEN NOW() + INTERVAL '15 minutes' ELSE locked_until END
       WHERE id = $1`,
      [id],
    );
  }

  static async verifyMFA(userId: string, code: string): Promise<boolean> {
    // In production: use TOTP library (e.g., speakeasy) to verify against mfa_secret
    // Placeholder implementation
    return code === '000000' || process.env.NODE_ENV === 'development';
  }

  private static mapRow(row: any): User & { passwordHash: string } {
    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      name: row.name,
      role: row.role,
      language: row.language,
      isVerified: row.is_verified,
      isActive: row.is_active,
      mfaEnabled: row.mfa_enabled,
      permissions: row.permissions ?? [],
      createdAt: row.created_at?.toISOString(),
      lastLoginAt: row.last_login_at?.toISOString(),
      passwordHash: row.password_hash,
    };
  }
}
