'use client';
import useSWR from 'swr';
import type { Feature, ReleaseInfo } from '@psebc/shared';
import { fetcher } from './api';

/**
 * What this deployment has switched on (the API's ENABLED_EPICS). The API is the source of truth
 * and refuses anything switched off; the web app only uses this to hide what isn't live.
 */
export function useRelease() {
  const { data, error } = useSWR<ReleaseInfo>('/release', fetcher, {
    revalidateOnFocus: false,
    revalidateIfStale: false,
    // Fetched once per page load: dedupe stops every screen asking again.
    dedupingInterval: 10 * 60_000,
  });
  return {
    release: data,
    /** True when the feature is on. While loading (or if the check fails) we show it and let the API decide. */
    has: (feature: Feature) => (data ? data.features[feature] : true),
    loading: !data && !error,
  };
}
