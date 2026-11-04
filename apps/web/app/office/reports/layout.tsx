import type { ReactNode } from 'react';
import { FeatureGate } from '@/components/feature-gate';

/** Reports — Epic 7 (story 7.1). */
export default function Layout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="reports">{children}</FeatureGate>;
}
