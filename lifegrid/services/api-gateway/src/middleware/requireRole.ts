import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/AppError';

export function requireRole(allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required', 401, 'AUTH_REQUIRED'));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError(
        `Access denied. Required roles: ${allowedRoles.join(', ')}`,
        403,
        'FORBIDDEN',
      ));
    }
    next();
  };
}
