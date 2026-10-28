import type { ReactNode } from 'react';
import { FeatureGate } from '@/components/feature-gate';

/** Incidents come from concern reports (Epic 5). Without them, safeguarding starts at driver approvals. */
export default function Layout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="tripLogging" redirectTo="/safeguarding/approvals">{children}</FeatureGate>;
}
