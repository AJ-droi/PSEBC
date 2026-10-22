import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { authenticator } from 'otplib';
import QRCode from 'qrcode';
import { MFA_ROLES, loginSchema, mfaVerifySchema, type Role } from '@psebc/shared';
import { queryOne, getPool } from '../../db/pool';
import { ah, parse } from '../../lib/http';
import { AppError, unauthorised } from '../../lib/errors';
import { clearSession, issueSession } from '../../middleware/auth';
import { actorFrom, audit } from '../../services/audit';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false });
const MAX_FAILED = 5;
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);
const LOCK_MINUTES = 15;

authenticator.options = { window: 1 };

interface UserRow {
  id: string;
  role: Role;
  full_name: string;
  email: string;
  password_hash: string;
  status: string;
  token_version: number;
  mfa_enabled: boolean;
  mfa_secret: string | null;
  failed_logins: number;
  locked_until: Date | null;
  member_id: string | null;
  driver_id: string | null;
}

authRouter.post(
  '/login',
  loginLimiter,
  ah(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const user = await queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
    const generic = new AppError(401, 'bad_credentials', 'That email or password is not right');

    if (!user || user.status !== 'active') {
      await bcrypt.compare(password, DUMMY_HASH); // keeps timing the same for unknown emails
      throw generic;
    }
    if (user.locked_until && user.locked_until > new Date()) {
      throw new AppError(423, 'locked', `Too many attempts. Try again in ${LOCK_MINUTES} minutes or call the church office.`);
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      const failed = user.failed_logins + 1;
      await getPool().query(
        `UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $2 >= $3 THEN now() + ($4 || ' minutes')::interval ELSE NULL END WHERE id = $1`,
        [user.id, failed, MAX_FAILED, String(LOCK_MINUTES)],
      );
      throw generic;
    }
    await getPool().query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);

    const needsMfa = MFA_ROLES.includes(user.role);
    issueSession(res, user.id, user.token_version, !needsMfa);
    await audit({ id: user.id, role: user.role, name: user.full_name, ip: req.ip }, { action: 'auth.login', entityType: 'user', entityId: user.id });
    res.json({
      user: publicUser(user),
      next: needsMfa ? (user.mfa_enabled ? 'mfa_verify' : 'mfa_setup') : 'done',
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
    res.json({
      user: {
        id: req.user.id,
        role: req.user.role,
        fullName: req.user.fullName,
        email: req.user.email,
        memberId: req.user.memberId,
        driverId: req.user.driverId,
      },
      mfaPassed: req.user.mfaPassed,
      mfaEnabled: req.user.mfaEnabled,
    });
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
    await getPool().query('UPDATE users SET mfa_secret = $2 WHERE id = $1', [req.user.id, secret]);
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
    const row = await queryOne<{ mfa_secret: string | null; mfa_enabled: boolean; token_version: number }>(
      'SELECT mfa_secret, mfa_enabled, token_version FROM users WHERE id = $1',
      [req.user.id],
    );
    if (!row?.mfa_secret) throw new AppError(400, 'no_secret', 'Set up your security code app first');
    if (!authenticator.check(code, row.mfa_secret)) throw new AppError(401, 'bad_code', 'That code is not right. Codes change every 30 seconds.');
    if (!row.mfa_enabled) {
      await getPool().query('UPDATE users SET mfa_enabled = true WHERE id = $1', [req.user.id]);
      await audit(actorFrom(req), { action: 'auth.mfa_enabled', entityType: 'user', entityId: req.user.id });
    }
    issueSession(res, req.user.id, row.token_version, true);
    res.json({ ok: true });
  }),
);

function publicUser(u: UserRow) {
  return { id: u.id, role: u.role, fullName: u.full_name, email: u.email, memberId: u.member_id, driverId: u.driver_id };
}
