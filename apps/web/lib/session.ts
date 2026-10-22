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
      return '/safeguarding';
    default:
      return '/office';
  }
}

export async function signOut() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  navigator.serviceWorker?.controller?.postMessage('logout');
  window.location.href = '/login';
}
