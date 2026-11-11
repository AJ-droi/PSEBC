import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../lib/logger';

/**
 * Delivery adapters for queued email and SMS.
 *
 *   NOTIFY_EMAIL_DRIVER = resend | smtp | webhook | console | none
 *   NOTIFY_SMS_DRIVER   =                 webhook | console | none
 *
 * `resend` sends through Resend's HTTPS API (works even where outbound SMTP ports are blocked).
 * `smtp` works with any provider that offers SMTP (Microsoft 365, Google Workspace,
 * Brevo, SendGrid, Resend, Mailgun, Postmark, Amazon SES…).
 */

export interface OutboundMessage {
  /** The notification row id: used as an idempotency key so a retry never sends twice. */
  id?: string;
  channel: 'email' | 'sms';
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Sender {
  send(msg: OutboundMessage): Promise<void>;
}

/** A failure that retrying won't fix (bad address, bad API key, unverified domain). The outbox stops retrying it. */
export class PermanentSendError extends Error {}

const consoleSender: Sender = {
  async send({ channel, to, subject }) {
    // Never log message bodies: they may contain names and times.
    logger.info({ channel, to: to.replace(/.(?=.{3})/g, '•'), subject }, 'notification (console driver)');
  },
};

const webhookSender: Sender = {
  async send({ channel, to, subject, text, html }) {
    const url = env().NOTIFY_WEBHOOK_URL;
    if (!url) throw new Error('NOTIFY_WEBHOOK_URL is not set');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // `body` stays the plain-text version so existing Power Automate / Zapier flows keep working.
      body: JSON.stringify({ channel, to, subject, body: text, html }),
    });
    if (!res.ok) throw new Error(`webhook responded ${res.status}`);
  },
};

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (transporter) return transporter;
  const e = env();
  transporter = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_SECURE,
    auth: e.SMTP_USER ? { user: e.SMTP_USER, pass: e.SMTP_PASS } : undefined,
    pool: true,
    maxConnections: 3,
  });
  return transporter;
}

const smtpSender: Sender = {
  async send({ to, subject, text, html }) {
    if (!to) throw new Error('no email address');
    const e = env();
    await smtp().sendMail({
      from: e.EMAIL_FROM,
      replyTo: e.EMAIL_REPLY_TO || undefined,
      to,
      subject,
      text,
      html,
    });
  },
};

const RESEND_URL = 'https://api.resend.com/emails';

const resendSender: Sender = {
  async send({ id, to, subject, text, html }) {
    if (!to) throw new PermanentSendError('no email address');
    const e = env();
    const headers: Record<string, string> = { authorization: `Bearer ${e.RESEND_API_KEY}`, 'content-type': 'application/json' };
    // Resend ignores a repeat request with the same key for 24 hours, so a retry after a timeout can't double-send.
    if (id) headers['idempotency-key'] = `psebc-notification/${id}`;
    let res: Response;
    try {
      res = await fetch(RESEND_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({ from: e.EMAIL_FROM, to: [to], subject, text, html, ...(e.EMAIL_REPLY_TO ? { reply_to: e.EMAIL_REPLY_TO } : {}) }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new Error(`resend unreachable: ${(err as Error).message}`);
    }
    if (res.ok) return;
    const detail = await res
      .json()
      .then((b: { name?: string; message?: string }) => [b.name, b.message].filter(Boolean).join(': '))
      .catch(() => '');
    const message = `resend ${res.status}${detail ? ` ${detail}` : ''}`;
    // 429 (rate limit) and 5xx are worth retrying; other 4xx (bad key, unverified domain, invalid address) are not.
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw new PermanentSendError(message);
    throw new Error(message);
  },
};

let override: { email?: Sender | null; sms?: Sender | null } | null = null;
/** Tests swap in fake senders (pass null to restore the configured ones). */
export function setSenders(s: { email?: Sender | null; sms?: Sender | null } | null): void {
  override = s;
}

export function emailSenderFor(): Sender | null {
  if (override && 'email' in override) return override.email ?? null;
  switch (env().NOTIFY_EMAIL_DRIVER) {
    case 'none':
      return null;
    case 'resend':
      return resendSender;
    case 'smtp':
      return smtpSender;
    case 'webhook':
      return webhookSender;
    default:
      return consoleSender;
  }
}

export function smsSenderFor(): Sender | null {
  if (override && 'sms' in override) return override.sms ?? null;
  switch (env().NOTIFY_SMS_DRIVER) {
    case 'none':
      return null;
    case 'webhook':
      return webhookSender;
    default:
      return consoleSender;
  }
}
