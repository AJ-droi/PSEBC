'use client';
import { useParams } from 'next/navigation';
import { DesktopShell } from '@/components/shells';
import { ApprovalsWorkspace } from '@/components/approvals';

export default function Approval() {
  const { id } = useParams<{ id: string }>();
  return (
    <DesktopShell roles={['safeguarding']}>
      {() => (
        <>
          <h1 className="d-title">Driver approvals</h1>
          <ApprovalsWorkspace selectedId={id} />
        </>
      )}
    </DesktopShell>
  );
}
