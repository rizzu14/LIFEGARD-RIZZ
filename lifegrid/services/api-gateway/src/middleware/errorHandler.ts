import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AppError } from '../utils/AppError';
import { logger } from '../utils/logger';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = uuidv4();

  if (err instanceof AppError) {
    logger.warn(`[${err.code}] ${err.message}`, { path: req.path, requestId });
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
      },
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // Zod validation errors
  if (err.name === 'ZodError') {
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: (err as any).errors,
      },
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    res.status(401).json({
      success: false,
      error: { code: 'INVALID_TOKEN', message: 'Authentication token is invalid or expired' },
      timestamp: new Date().toISOString(),
      requestId,
    });
    return;
  }

  // Unexpected errors
  logger.error('Unhandled error:', err);
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: process.env.NODE_ENV === 'production'
        ? 'An internal error occurred'
        : err.message,
    },
    timestamp: new Date().toISOString(),
    requestId,
  });
}
