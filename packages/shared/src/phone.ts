/**
 * UK phone numbers.
 *
 * People type numbers many ways ("07700 900123", "+44 7700 900123", "0044 (0)7700-900123").
 * We accept any of those, check it is a real UK format, and store one canonical form:
 * E.164 ("+447700900123") — what SMS providers and `tel:` links need.
 * Screens show the familiar national form via `formatUkPhone` ("07700 900123").
 */

/** Strip spaces, brackets, dashes and dots; turn +44 / 0044 / 44 into a leading 0. */
function toNational(input: string): string | null {
  let s = input.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(s)) return null;
  if (s.startsWith('+44')) s = '0' + s.slice(3);
  else if (s.startsWith('0044')) s = '0' + s.slice(4);
  else if (s.startsWith('44') && s.length === 12) s = '0' + s.slice(2);
  else if (s.startsWith('+')) return null; // another country's code
  s = s.replace(/^00?(?=[1-37-8])/, '0'); // "+44 (0)7…" leaves "007…" → "07…"
  return s;
}

/**
 * Valid UK numbers people would give for lifts:
 *  01/02 geographic (10–11 digits), 03 non-geographic, 07 mobiles (11 digits), 080 freephone.
 * Premium-rate 09 and short codes are rejected.
 */
const UK_NATIONAL = /^0(?:1\d{8,9}|2\d{9}|3\d{9}|7\d{9}|80\d{7,8})$/;

export function isUkPhone(input: string | null | undefined): boolean {
  if (!input) return false;
  const n = toNational(input);
  return !!n && UK_NATIONAL.test(n);
}

/** "07700 900123" → "+447700900123". Returns null when it isn't a valid UK number. */
export function normaliseUkPhone(input: string | null | undefined): string | null {
  if (!input) return null;
  const n = toNational(input);
  if (!n || !UK_NATIONAL.test(n)) return null;
  return '+44' + n.slice(1);
}

/** "+447700900123" → "07700 900123" (also tidies a national number). Unknown input is returned as typed. */
export function formatUkPhone(input: string | null | undefined): string {
  if (!input) return '';
  const n = toNational(input);
  if (!n || !UK_NATIONAL.test(n)) return input;
  if (/^07/.test(n)) return `${n.slice(0, 5)} ${n.slice(5)}`; // 07700 900123
  if (/^02/.test(n)) return `${n.slice(0, 3)} ${n.slice(3, 7)} ${n.slice(7)}`; // 029 2000 0000
  if (/^0[38]/.test(n)) return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`; // 0300 123 4567
  return `${n.slice(0, 5)} ${n.slice(5)}`; // 01446 000000
}

/** For `tel:` links. */
export function telHref(input: string | null | undefined): string {
  return `tel:${normaliseUkPhone(input) ?? (input ?? '').replace(/[^\d+]/g, '')}`;
}
