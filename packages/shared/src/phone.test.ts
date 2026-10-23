import { describe, expect, it } from 'vitest';
import { formatUkPhone, isUkPhone, normaliseUkPhone, telHref } from './phone';
import { memberAboutSchema } from './schemas';

describe('UK phone numbers', () => {
  it.each([
    ['07700 900123', '+447700900123'],
    ['07700900123', '+447700900123'],
    ['+44 7700 900123', '+447700900123'],
    ['+44 (0)7700 900123', '+447700900123'],
    ['0044 7700-900123', '+447700900123'],
    ['447700900123', '+447700900123'],
    ['01446 700333', '+441446700333'],
    ['029 2000 0000', '+442920000000'],
    ['0300 123 4567', '+443001234567'],
  ])('accepts %s', (input, e164) => {
    expect(isUkPhone(input)).toBe(true);
    expect(normaliseUkPhone(input)).toBe(e164);
  });

  it.each(['12345', '+1 202 555 0100', '+234 803 123 4567', '0909 123 4567', '07700 90012', 'call me', ''])('rejects %s', (input) => {
    expect(isUkPhone(input)).toBe(false);
    expect(normaliseUkPhone(input)).toBeNull();
  });

  it('formats for screens in the familiar UK way', () => {
    expect(formatUkPhone('+447700900123')).toBe('07700 900123');
    expect(formatUkPhone('+441446700333')).toBe('01446 700333');
    expect(formatUkPhone('+442920000000')).toBe('029 2000 0000');
    expect(formatUkPhone('+443001234567')).toBe('0300 123 4567');
    expect(telHref('07700 900123')).toBe('tel:+447700900123');
  });

  it('forms store +44 and give a plain-English error', () => {
    const base = { fullName: 'A', preferredName: 'A', addressLine: '1 Road', town: 'Barry', postcode: 'CF62 0XX', findingNotes: '' };
    expect(memberAboutSchema.parse({ ...base, phone: '07700 900456' }).phone).toBe('+447700900456');
    const bad = memberAboutSchema.safeParse({ ...base, phone: '+234 803 123 4567' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]?.message).toMatch(/UK phone number/);
  });
});
