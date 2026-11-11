import { env } from '../config/env';

/**
 * Turns a queued notification into an email: a plain-text part and a simple,
 * accessible HTML part (large type, high contrast, one clear button) that links
 * back into the app. Everything from the message is escaped.
 */

const BRAND = 'PSEBC Lifts';

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

export function absoluteLink(link: string | null | undefined): string {
  const origin = env().WEB_ORIGIN.replace(/\/+$/, '');
  if (!link) return `${origin}/notifications`;
  if (/^https?:\/\//i.test(link)) return link;
  return `${origin}${link.startsWith('/') ? '' : '/'}${link}`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderEmail(n: { title: string; body: string; link?: string | null }): RenderedEmail {
  const url = absoluteLink(n.link);
  const urgent = /^URGENT/i.test(n.title);
  const subject = `${n.title} · ${BRAND}`;
  const footer = 'You are receiving this because you are part of the Princes Street Church lift scheme. If something looks wrong, please contact the church office.';
  const text = `${n.title}\n\n${n.body}\n\nOpen in ${BRAND}: ${url}\n\n—\n${footer}\n`;
  const html = `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f2;font-family:Arial,Helvetica,sans-serif;color:#1d1d1b;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f2;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${urgent ? '#b3261e' : '#1f3a5f'};color:#ffffff;padding:16px 24px;font-size:16px;font-weight:bold;">${BRAND}</td></tr>
        <tr><td style="padding:24px;">
          <h1 style="margin:0 0 12px;font-size:22px;line-height:1.3;">${escapeHtml(n.title)}</h1>
          <p style="margin:0 0 24px;font-size:18px;line-height:1.5;white-space:pre-line;">${escapeHtml(n.body)}</p>
          <a href="${escapeHtml(url)}" style="display:inline-block;background:#1f3a5f;color:#ffffff;text-decoration:none;font-size:18px;font-weight:bold;padding:14px 24px;border-radius:8px;">Open in ${BRAND}</a>
          <p style="margin:16px 0 0;font-size:14px;color:#555;">Or copy this link: <a href="${escapeHtml(url)}" style="color:#1f3a5f;">${escapeHtml(url)}</a></p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e5e5e2;font-size:13px;line-height:1.5;color:#555;">${escapeHtml(footer)}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  return { subject, text, html };
}
