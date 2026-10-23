import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { eq, sql } from 'drizzle-orm';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { MFA_ROLES, loginSchema, mfaVerifySchema } from '@psebc/shared';
import { db } from '../../db/client';
import { users, type User } from '../../db/schema';
import { ah, parse } from '../../lib/http';
import { AppError, unauthorised } from '../../lib/errors';
import { clearSession, issueSession } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

authenticator.options = { window: 1 };

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, email));
    const generic = new AppError(401, 'bad_credentials', 'That email or password is not right');

    if (!user || user.status !== 'active') {
      await bcrypt.compare(password, DUMMY_HASH); // keeps timing the same for unknown emails
      throw generic;
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new AppError(423, 'locked', `Too many attempts. Try again in ${LOCK_MINUTES} minutes or call the church office.`);
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const failed = user.failedLogins + 1;
      await db
        .update(users)
        .set({ failedLogins: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null })
        .where(eq(users.id, user.id));
      throw generic;
    }
    await db.update(users).set({ failedLogins: 0, lockedUntil: null, lastLoginAt: sql`now()` }).where(eq(users.id, user.id));

    const needsMfa = MFA_ROLES.includes(user.role);
    issueSession(res, user.id, user.tokenVersion, !needsMfa);
    await audit({ id: user.id, role: user.role, name: user.fullName, ip: req.ip }, { action: 'auth.login', entityType: 'user', entityId: user.id });
    res.json({
      user: publicUser(user),
      next: needsMfa ? (user.mfaEnabled ? 'mfa_verify' : 'mfa_setup') : 'done',
    });
  }),
);

authRouter.post('/logout', (_req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get(
  '/me',
  ah(async (req, res) => {
    if (!req.user) throw unauthorised();
    const { id, role, fullName, email, memberId, driverId } = req.user;
    res.json({ user: { id, role, fullName, email, memberId, driverId }, mfaPassed: req.user.mfaPassed, mfaEnabled: req.user.mfaEnabled });
  }),
);

/** First sign-in for admin/safeguarding: create a TOTP secret and show it as a QR code. */
authRouter.post(
  '/mfa/setup',
  ah(async (req, res) => {
    if (!req.user) throw unauthorised();
    if (!MFA_ROLES.includes(req.user.role)) throw new AppError(400, 'not_needed', 'Your role does not use a security code');
    if (req.user.mfaEnabled) throw new AppError(409, 'already_set_up', 'Your security code app is already set up');
    const secret = authenticator.generateSecret();
    await db.update(users).set({ mfaSecret: secret }).where(eq(users.id, req.user.id));
    const otpauth = authenticator.keyuri(req.user.email, 'PSEBC Lifts', secret);
    res.json({ otpauth, secret, qr: await QRCode.toDataURL(otpauth) });
  }),
);

authRouter.post(
  '/mfa/verify',
  rateLimit({ windowMs: 15 * 60_000, limit: 10 }),
  ah(async (req, res) => {
    if (!req.user) throw unauthorised();
    const { code } = parse(mfaVerifySchema, req.body);
    const [row] = await db.select({ mfaSecret: users.mfaSecret, mfaEnabled: users.mfaEnabled, tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, req.user.id));
    if (!row?.mfaSecret) throw new AppError(400, 'no_secret', 'Set up your security code app first');
    if (!authenticator.check(code, row.mfaSecret)) throw new AppError(401, 'bad_code', 'That code is not right. Codes change every 30 seconds.');
    if (!row.mfaEnabled) {
      await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, req.user.id));
      await audit(actorFrom(req), { action: 'auth.mfa_enabled', entityType: 'user', entityId: req.user.id });
    }
    issueSession(res, req.user.id, row.tokenVersion, true);
    res.json({ ok: true });
  }),
);

function publicUser(u: User) {
  return { id: u.id, role: u.role, fullName: u.fullName, email: u.email, memberId: u.memberId, driverId: u.driverId };
}
