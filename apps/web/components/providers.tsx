'use client';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';

/**
 * Lift status changes quickly and several people act on the same lift, so screens
 * always re-check with the server when they open rather than trusting cached data.
 */
export function Providers({ children }: { children: ReactNode }) {
  return <SWRConfig value={{ dedupingInterval: 300, revalidateOnMount: true, revalidateOnFocus: true, errorRetryCount: 2 }}>{children}</SWRConfig>;
}
