'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loading } from '@/components/ui';
import { homeFor, useMe } from '@/lib/session';

export default function Index() {
  const { data, error } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (data) router.replace(data.mfaPassed ? homeFor(data.user.role) : '/login/mfa');
    if (error) router.replace('/login');
  }, [data, error, router]);
  return <Loading />;
}
