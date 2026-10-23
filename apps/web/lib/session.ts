'use client';
import useSWR from 'swr';
import type { Role } from '@psebc/shared';
import { fetcher } from './api';

export interface Me {
  user: { id: string; role: Role; fullName: string; email: string; memberId: string | null; driverId: string | null };
  mfaPassed: boolean;
  mfaEnabled: boolean;
}

export function useMe() {
  return useSWR<Me>('/auth/me', fetcher, { revalidateOnFocus: false });
}

export function homeFor(role: Role): string {
  switch (role) {
    case 'member':
      return '/member';
    case 'driver':
      return '/driver';
    case 'safeguarding':
      // Open incidents are the first thing the safeguarding lead sees.
      return '/safeguarding/incidents';
    default:
      return '/office';
  }
}

export async function signOut() {
  // Stop this device getting the next person's alerts, while we are still signed in.
  const { disablePushAlerts } = await import('./alerts');
  await disablePushAlerts();
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  navigator.serviceWorker?.controller?.postMessage('logout');
  window.location.href = '/login';
}
