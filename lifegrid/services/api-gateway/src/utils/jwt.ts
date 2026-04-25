import jwt from 'jsonwebtoken';
import type { AuthToken, UserRole } from '@lifegrid/shared-types';

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  ?? 'lifegrid-access-secret-change-in-production';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'lifegrid-refresh-secret-change-in-production';
const ACCESS_EXPIRY  = process.env.JWT_ACCESS_EXPIRY  ?? '15m';
const REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY ?? '7d';

export interface TokenPayload {
  userId: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export function generateTokens(payload: { userId: string; role: UserRole }): AuthToken {
  const accessToken = jwt.sign(payload, ACCESS_SECRET, {
    expiresIn: ACCESS_EXPIRY,
    issuer: 'lifegrid',
    audience: 'lifegrid-client',
  });

  const refreshToken = jwt.sign(payload, REFRESH_SECRET, {
    expiresIn: REFRESH_EXPIRY,
    issuer: 'lifegrid',
    audience: 'lifegrid-client',
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: 15 * 60,  // 15 minutes in seconds
    tokenType: 'Bearer',
    userId: payload.userId,
    role: payload.role,
  };
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, ACCESS_SECRET, {
    issuer: 'lifegrid',
    audience: 'lifegrid-client',
  }) as TokenPayload;
}

export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, REFRESH_SECRET, {
    issuer: 'lifegrid',
    audience: 'lifegrid-client',
  }) as TokenPayload;
}
