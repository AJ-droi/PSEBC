import type { RequestHandler } from 'express';
import { releaseInfo, type Feature, type ReleaseInfo } from '@psebc/shared';
import { env } from '../config/env';
import { AppError } from './errors';

/** What this deployment has switched on (ENABLED_EPICS). Read from env, so tests can change it. */
export function release(): ReleaseInfo {
  return releaseInfo(env().ENABLED_EPICS);
}

export function featureOn(feature: Feature): boolean {
  return release().features[feature];
}

export const notInRelease = () => new AppError(404, 'not_in_release', 'This part of the app isn’t switched on in this release.');

/** Route guard for features that belong to an epic that may be switched off. Runs before auth: nothing to leak. */
export function requireFeature(feature: Feature): RequestHandler {
  return (_req, _res, next) => (featureOn(feature) ? next() : next(notInRelease()));
}
