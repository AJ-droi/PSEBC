'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import type { Feature } from '@psebc/shared';
import { useRelease } from '@/lib/release';
import { Loading } from './ui';

/**
 * Wraps a screen that belongs to an epic that may be switched off in this release.
 * With `redirectTo`, people are sent somewhere useful instead (e.g. safeguarding's home).
 */
export function FeatureGate({ feature, redirectTo, children }: { feature: Feature; redirectTo?: string; children: ReactNode }) {
  const { has, loading } = useRelease();
  const router = useRouter();
  const off = !loading && !has(feature);
  useEffect(() => {
    if (off && redirectTo) router.replace(redirectTo);
  }, [off, redirectTo, router]);
  if (loading || (off && redirectTo)) return <Loading />;
  if (off) {
    return (
      <main className="screen" id="main">
        <h1 className="title">Coming in a later release</h1>
        <p className="lede">This part of PSEBC Lifts isn’t switched on yet.</p>
        <Link className="btn btn-primary" href="/">
          Go to my home page
        </Link>
      </main>
    );
  }
  return <>{children}</>;
}
