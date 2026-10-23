import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { MFA_ROLES, type Role } from '@psebc/shared';
import { env } from '../config/env';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { users } from '../db/schema';
import { forbidden, unauthorised } from '../lib/errors';

export const SESSION_COOKIE = 'psebc_session';
const SESSION_HOURS = 12;

export interface SessionUser {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  memberId: string | null;
  driverId: string | null;
  mfaEnabled: boolean;
  /** True once this session has passed the second factor (or the role doesn't need one). */
  mfaPassed: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

interface TokenPayload {
  sub: string;
  tv: number;
  mfa: boolean;
}

export function issueSession(res: Response, userId: string, tokenVersion: number, mfaPassed: boolean): void {
  const token = jwt.sign({ sub: userId, tv: tokenVersion, mfa: mfaPassed } satisfies TokenPayload, env().JWT_SECRET, {
    expiresIn: `${SESSION_HOURS}h`,
  });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_HOURS * 3_600_000,
    path: '/',
  });
}

export function clearSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/**
 * Loads the user on every request so a closed account or a bumped token version
 * stops access immediately (story 1.5 "Login stops immediately").
 */
export async function loadUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
    if (!token) return next();
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, env().JWT_SECRET) as unknown as TokenPayload;
    } catch {
      return next();
    }
    const [row] = await db
      .select({
        id: users.id,
        role: users.role,
        fullName: users.fullName,
        email: users.email,
        memberId: users.memberId,
        driverId: users.driverId,
        mfaEnabled: users.mfaEnabled,
        status: users.status,
        tokenVersion: users.tokenVersion,
      })
      .from(users)
      .where(eq(users.id, payload.sub));
    if (!row || row.status !== 'active' || row.tokenVersion !== payload.tv) return next();
    const needsMfa = MFA_ROLES.includes(row.role);
    req.user = {
      id: row.id,
      role: row.role,
      fullName: row.fullName,
      email: row.email,
      memberId: row.memberId,
      driverId: row.driverId,
      mfaEnabled: row.mfaEnabled,
      mfaPassed: !needsMfa || payload.mfa,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Require a signed-in user who has completed MFA where their role needs it. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorised());
  if (!req.user.mfaPassed) return next(forbidden('Finish signing in with your security code'));
  next();
}

export const requireRole =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorised());
    if (!req.user.mfaPassed) return next(forbidden('Finish signing in with your security code'));
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };

export function currentUser(req: Request): SessionUser {
  if (!req.user) throw unauthorised();
  return req.user;
}
