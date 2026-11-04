import type { ReactNode } from 'react';
import { FeatureGate } from '@/components/feature-gate';

/** Member trip log filled in by the office — Epic 5 (story 5.3). */
export default function Layout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="tripLogging">{children}</FeatureGate>;
}
