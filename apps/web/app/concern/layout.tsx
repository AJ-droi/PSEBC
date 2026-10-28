import type { ReactNode } from 'react';
import { FeatureGate } from '@/components/feature-gate';

/** Concern reports belong to Epic 5 (story 5.2). */
export default function Layout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="tripLogging">{children}</FeatureGate>;
}
