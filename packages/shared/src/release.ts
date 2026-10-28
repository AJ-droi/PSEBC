/**
 * Release switch: which PRD epics are live in this deployment.
 *
 * The code for every epic ships in one codebase; a deployment chooses what is switched on with
 * the API's ENABLED_EPICS setting (e.g. "1,2,3", "1-3" or "all"). Epics 1–3 are the core of the
 * product (onboarding, booking, matching) and are always on. Later epics are switched on in order,
 * because each one builds on the last (a driver can't log a trip whose pickup address they never saw).
 */

export const EPICS = {
  1: { jira: 'PSEBC-1', name: 'Onboarding and approval' },
  2: { jira: 'PSEBC-2', name: 'Requesting a ride' },
  3: { jira: 'PSEBC-3', name: 'Matching' },
  4: { jira: 'PSEBC-4', name: 'Driver found and details shared' },
  5: { jira: 'PSEBC-5', name: 'Completing and logging the trip' },
  6: { jira: 'PSEBC-6', name: 'Sign-off' },
  7: { jira: 'PSEBC-30', name: 'Reporting dashboard' },
} as const;

export type EpicNo = keyof typeof EPICS;
export const ALL_EPICS = Object.keys(EPICS).map(Number) as EpicNo[];
/** Always on: without these there is no product to demo. */
export const CORE_EPICS: readonly EpicNo[] = [1, 2, 3];
/** An epic that only makes sense once another one is live. */
const REQUIRES: Partial<Record<EpicNo, EpicNo>> = { 5: 4, 6: 5 };

/** Features that belong to an optional epic. Anything not listed here is part of Epics 1–3. */
export const FEATURE_EPIC = {
  /** 4.1–4.3: member sees driver + car; driver sees member name, address, phone, health notes. */
  tripDetails: 4,
  /** 5.1–5.3: pickup/drop-off buttons, "not at pickup", trip logs, concern reports. */
  tripLogging: 5,
  /** 6.1–6.3: safeguarding sign-off queue and incident review. */
  signOff: 6,
  /** 7.1: monthly reports and CSV download. */
  reports: 7,
} as const satisfies Record<string, EpicNo>;

export type Feature = keyof typeof FEATURE_EPIC;
export type FeatureFlags = Record<Feature, boolean>;

export interface ReleaseInfo {
  /** Epic numbers switched on, ascending. */
  epics: EpicNo[];
  features: FeatureFlags;
  /** Short label for screens, e.g. "Epics 1–3". Empty when everything is on. */
  label: string;
}

/**
 * Parse ENABLED_EPICS. Accepts "all" (or empty), a list "1,2,3", ranges "1-3", or a mix "1-4,7".
 * Throws on unknown epics or a missing prerequisite so a bad setting fails at start-up, not mid-demo.
 */
export function parseEnabledEpics(value: string | undefined | null): EpicNo[] {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'all') return [...ALL_EPICS];
  const picked = new Set<number>(CORE_EPICS);
  for (const part of raw.split(',').map((p) => p.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) throw new Error(`ENABLED_EPICS: "${part}" is not an epic number or range`);
    const from = Number(m[1]);
    const to = Number(m[2] ?? m[1]);
    if (to < from) throw new Error(`ENABLED_EPICS: range "${part}" runs backwards`);
    for (let n = from; n <= to; n++) {
      if (!(n in EPICS)) throw new Error(`ENABLED_EPICS: there is no epic ${n} (epics are 1–${ALL_EPICS.length})`);
      picked.add(n);
    }
  }
  for (const [epic, needs] of Object.entries(REQUIRES)) {
    if (picked.has(Number(epic)) && !picked.has(needs!)) {
      throw new Error(`ENABLED_EPICS: epic ${epic} (${EPICS[Number(epic) as EpicNo].name}) needs epic ${needs} switched on too`);
    }
  }
  return [...picked].sort((a, b) => a - b) as EpicNo[];
}

export function releaseInfo(epics: readonly EpicNo[]): ReleaseInfo {
  const on = new Set(epics);
  const features = Object.fromEntries(Object.entries(FEATURE_EPIC).map(([f, e]) => [f, on.has(e)])) as FeatureFlags;
  return { epics: [...epics].sort((a, b) => a - b), features, label: epicsLabel(epics) };
}

/** "Epics 1–3", "Epics 1–4, 7", or "" when every epic is on. */
export function epicsLabel(epics: readonly EpicNo[]): string {
  const sorted = [...new Set(epics)].sort((a, b) => a - b);
  if (sorted.length === ALL_EPICS.length) return '';
  const runs: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j]! + 1) j++;
    runs.push(j > i ? `${sorted[i]}–${sorted[j]}` : `${sorted[i]}`);
    i = j + 1;
  }
  return `Epics ${runs.join(', ')}`;
}
