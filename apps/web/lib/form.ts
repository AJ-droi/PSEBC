'use client';
import { useState } from 'react';
import { ApiError } from '@/lib/api';

/** Tracks submit state and maps API validation errors onto fields. */
export function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      return await fn();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        setFields(e.fields);
      } else {
        setError('We couldn’t reach PSEBC Lifts. Check your connection and try again.');
      }
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, fields, run, setError };
}
