'use client';
import useSWR from 'swr';
import { fetcher } from './api';

export function useOfficePhone(): string {
  const { data } = useSWR<{ church_office_phone?: string }>('/admin/public-settings', fetcher, { revalidateOnFocus: false });
  return data?.church_office_phone ?? '';
}
