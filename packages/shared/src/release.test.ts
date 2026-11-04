import { describe, expect, it } from 'vitest';
import { ALL_EPICS, epicsLabel, parseEnabledEpics, releaseInfo } from './release';

describe('release switch (ENABLED_EPICS)', () => {
  it('defaults to every epic', () => {
    expect(parseEnabledEpics(undefined)).toEqual(ALL_EPICS);
    expect(parseEnabledEpics('')).toEqual(ALL_EPICS);
    expect(parseEnabledEpics('ALL')).toEqual(ALL_EPICS);
  });

  it('reads lists, ranges and mixes', () => {
    expect(parseEnabledEpics('1,2,3')).toEqual([1, 2, 3]);
    expect(parseEnabledEpics('1-3')).toEqual([1, 2, 3]);
    expect(parseEnabledEpics(' 1-4 , 7 ')).toEqual([1, 2, 3, 4, 7]);
  });

  it('always keeps the core epics 1–3 on', () => {
    expect(parseEnabledEpics('4')).toEqual([1, 2, 3, 4]);
  });

  it('rejects unknown epics, bad ranges and missing prerequisites', () => {
    expect(() => parseEnabledEpics('1-9')).toThrow(/no epic 8/);
    expect(() => parseEnabledEpics('one')).toThrow(/not an epic/);
    expect(() => parseEnabledEpics('3-1')).toThrow(/backwards/);
    expect(() => parseEnabledEpics('1-3,5')).toThrow(/needs epic 4/);
    expect(() => parseEnabledEpics('1-4,6')).toThrow(/needs epic 5/);
  });

  it('maps epics to features', () => {
    expect(releaseInfo([1, 2, 3]).features).toEqual({ tripDetails: false, tripLogging: false, signOff: false, reports: false });
    expect(releaseInfo([1, 2, 3, 7]).features.reports).toBe(true);
    expect(releaseInfo(ALL_EPICS).features).toEqual({ tripDetails: true, tripLogging: true, signOff: true, reports: true });
  });

  it('labels the release for screens', () => {
    expect(epicsLabel([1, 2, 3])).toBe('Epics 1–3');
    expect(epicsLabel([1, 2, 3, 4, 7])).toBe('Epics 1–4, 7');
    expect(epicsLabel(ALL_EPICS)).toBe('');
  });
});
