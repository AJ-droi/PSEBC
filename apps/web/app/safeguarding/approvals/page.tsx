'use client';
import { DesktopShell } from '@/components/shells';
import { ApprovalsWorkspace } from '@/components/approvals';

export default function Approvals() {
  return (
    <DesktopShell roles={['safeguarding']}>
      {() => (
        <>
          <h1 className="d-title">Driver approvals</h1>
          <ApprovalsWorkspace />
        </>
      )}
    </DesktopShell>
  );
}
