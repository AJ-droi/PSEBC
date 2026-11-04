import type { ReactNode } from 'react';
import { FeatureGate } from '@/components/feature-gate';

/** Trip sign-off — Epic 6. */
export default function Layout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="signOff" redirectTo="/safeguarding/approvals">{children}</FeatureGate>;
}
