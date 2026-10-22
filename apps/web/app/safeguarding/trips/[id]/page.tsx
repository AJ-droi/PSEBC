'use client';
import { useParams } from 'next/navigation';
import { DesktopShell } from '@/components/shells';
import { SignoffWorkspace } from '@/components/signoff';

export default function Trip() {
  const { id } = useParams<{ id: string }>();
  return (
    <DesktopShell roles={['safeguarding']}>
      {() => (
        <>
          <h1 className="d-title">Sign-off</h1>
          <SignoffWorkspace selectedId={id} />
        </>
      )}
    </DesktopShell>
  );
}
