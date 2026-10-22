import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodSchema, z } from 'zod';
import { AppError } from './errors';

/** Wrap an async route so rejected promises reach the error middleware. */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

export function parse<S extends ZodSchema>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw new AppError(422, 'validation', 'Please check the highlighted answers', { fields });
  }
  return result.data;
}

export function uuidParam(req: Request, name = 'id'): string {
  const v = req.params[name] ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(v)) throw new AppError(404, 'not_found', 'Not found');
  return v;
}
