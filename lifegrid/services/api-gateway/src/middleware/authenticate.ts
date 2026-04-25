import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';
import { UserRepository } from '../database/repositories/UserRepository';
import { RedisManager } from '../cache/RedisManager';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: string;
        email: string;
        permissions: string[];
      };
    }
  }
}

export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new AppError('Authentication required', 401, 'AUTH_REQUIRED');
    }

    const token = authHeader.slice(7);

    // Check token blacklist (for logged-out tokens)
    const isBlacklisted = await RedisManager.get(`blacklist:${token.slice(-16)}`);
    if (isBlacklisted) {
      throw new AppError('Token has been revoked', 401, 'TOKEN_REVOKED');
    }

    const payload = verifyToken(token);

    // Cache user lookup for 5 minutes
    const cacheKey = `user:${payload.userId}`;
    let userData = await RedisManager.get(cacheKey);

    if (!userData) {
      const user = await UserRepository.findById(payload.userId);
      if (!user || !user.isActive) {
        throw new AppError('User not found or inactive', 401, 'USER_INACTIVE');
      }
      userData = JSON.stringify({
        id: user.id,
        role: user.role,
        email: user.email,
        permissions: user.permissions,
      });
      await RedisManager.set(cacheKey, userData, 300);
    }

    req.user = JSON.parse(userData);
    next();
  } catch (err) {
    next(err);
  }
}
