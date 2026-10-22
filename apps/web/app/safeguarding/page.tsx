'use client';
import useSWR from 'swr';
import { DesktopShell } from '@/components/shells';
import { SignoffWorkspace } from '@/components/signoff';
import { fetcher } from '@/lib/api';

export default function Safeguarding() {
  return (
    <DesktopShell roles={['safeguarding']}>
      {() => (
        <>
          <Summary />
          <SignoffWorkspace />
        </>
      )}
    </DesktopShell>
  );
}

function Summary() {
  const { data } = useSWR<{ ready: number; waiting: number; open_concerns: number; pending_drivers: number }>('/safeguarding/summary', fetcher);
  return (
    <div className="d-head">
      <h1 className="d-title">Sign-off</h1>
      {data ? (
        <p className="muted">
          {data.ready} ready · {data.waiting} waiting for logs · {data.open_concerns} open concern{data.open_concerns === 1 ? '' : 's'} · {data.pending_drivers} driver{data.pending_drivers === 1 ? '' : 's'} to approve
        </p>
      ) : null}
    </div>
  );
}
