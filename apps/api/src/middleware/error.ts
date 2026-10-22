import type { NextFunction, Request, Response } from 'express';
import { InvalidTransitionError } from '@psebc/shared';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'Not found' } });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
    return;
  }
  if (err instanceof InvalidTransitionError) {
    res.status(409).json({ error: { code: 'invalid_status', message: 'This lift has already moved on. Please refresh.' } });
    return;
  }
  const pgCode = (err as { code?: string })?.code;
  if (pgCode === '23505') {
    res.status(409).json({ error: { code: 'duplicate', message: 'This has already been recorded' } });
    return;
  }
  if ((err as { type?: string })?.type === 'entity.too.large') {
    res.status(413).json({ error: { code: 'too_large', message: 'That file is too large' } });
    return;
  }
  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({ error: { code: 'server_error', message: 'Something went wrong. Please try again.' } });
}
