// ============================================================
// LIFEGRID – Authentication Routes
// ============================================================

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { UserRole } from '@lifegrid/shared-types';
import { UserRepository } from '../database/repositories/UserRepository';
import { generateTokens, verifyRefreshToken } from '../utils/jwt';
import { validate } from '../middleware/validate';
import { asyncHandler } from '../utils/asyncHandler';
import { AppError } from '../utils/AppError';
import { RedisManager } from '../cache/RedisManager';
import { logger } from '../utils/logger';

export const authRouter = Router();

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  mfaCode: z.string().length(6).optional(),
});

const RegisterCitizenSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().min(7).max(20),
  password: z.string().min(8).max(128),
  language: z.string().default('en'),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

// ── POST /auth/login ──────────────────────────────────────────

authRouter.post(
  '/login',
  validate(LoginSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { email, password, mfaCode } = req.body as z.infer<typeof LoginSchema>;

    const user = await UserRepository.findByEmail(email);
    if (!user) throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    if (!user.isActive) throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');

    const passwordValid = await bcrypt.compare(password, (user as any).passwordHash);
    if (!passwordValid) {
      await UserRepository.recordFailedLogin(user.id);
      throw new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
    }

    // MFA check for operator+ roles
    if (user.mfaEnabled) {
      if (!mfaCode) throw new AppError('MFA code required', 401, 'MFA_REQUIRED');
      const mfaValid = await UserRepository.verifyMFA(user.id, mfaCode);
      if (!mfaValid) throw new AppError('Invalid MFA code', 401, 'INVALID_MFA');
    }

    const tokens = generateTokens({ userId: user.id, role: user.role });

    // Store refresh token in Redis
    await RedisManager.set(
      `refresh:${user.id}:${tokens.refreshToken.slice(-16)}`,
      user.id,
      7 * 24 * 3600,  // 7 days
    );

    await UserRepository.updateLastLogin(user.id);
    logger.info(`[Auth] Login: ${user.email} (${user.role})`);

    res.json({
      success: true,
      data: {
        ...tokens,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          language: user.language,
          permissions: user.permissions,
        },
      },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── POST /auth/register  (citizen self-registration) ──────────

authRouter.post(
  '/register',
  validate(RegisterCitizenSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const body = req.body as z.infer<typeof RegisterCitizenSchema>;

    const existing = await UserRepository.findByEmail(body.email);
    if (existing) throw new AppError('Email already registered', 409, 'EMAIL_EXISTS');

    const passwordHash = await bcrypt.hash(body.password, 12);

    const user = await UserRepository.create({
      id: uuidv4(),
      email: body.email,
      phone: body.phone,
      name: body.name,
      role: UserRole.CITIZEN,
      language: body.language,
      isVerified: false,
      isActive: true,
      createdAt: new Date().toISOString(),
      mfaEnabled: false,
      permissions: ['REPORT_INCIDENT', 'VIEW_OWN_INCIDENTS'],
      passwordHash,
    });

    const tokens = generateTokens({ userId: user.id, role: user.role });

    res.status(201).json({
      success: true,
      data: {
        ...tokens,
        user: { id: user.id, name: user.name, email: user.email, role: user.role },
      },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── POST /auth/refresh ────────────────────────────────────────

authRouter.post(
  '/refresh',
  validate(RefreshSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body as z.infer<typeof RefreshSchema>;

    const payload = verifyRefreshToken(refreshToken);
    const cacheKey = `refresh:${payload.userId}:${refreshToken.slice(-16)}`;
    const stored = await RedisManager.get(cacheKey);

    if (!stored) throw new AppError('Refresh token expired or revoked', 401, 'TOKEN_EXPIRED');

    const user = await UserRepository.findById(payload.userId);
    if (!user || !user.isActive) throw new AppError('User not found', 401, 'USER_NOT_FOUND');

    // Rotate refresh token
    await RedisManager.del(cacheKey);
    const tokens = generateTokens({ userId: user.id, role: user.role });
    await RedisManager.set(
      `refresh:${user.id}:${tokens.refreshToken.slice(-16)}`,
      user.id,
      7 * 24 * 3600,
    );

    res.json({
      success: true,
      data: tokens,
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);

// ── POST /auth/logout ─────────────────────────────────────────

authRouter.post(
  '/logout',
  asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
      try {
        const payload = verifyRefreshToken(refreshToken);
        await RedisManager.del(`refresh:${payload.userId}:${refreshToken.slice(-16)}`);
      } catch {
        // Token already invalid, that's fine
      }
    }

    res.json({
      success: true,
      data: { message: 'Logged out successfully' },
      timestamp: new Date().toISOString(),
      requestId: uuidv4(),
    });
  }),
);
