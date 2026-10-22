'use client';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { CancelRide } from '@/components/forms';
import { DesktopShell } from '@/components/shells';

function Inner() {
  const { id } = useParams<{ id: string }>();
  const rebook = useSearchParams().get('rebook') === '1';
  return (
    <div className="mobile" style={{ minHeight: 0, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--divider)', overflow: 'hidden' }}>
      <CancelRide rideId={id} backHref={`/office/rides/${id}`} doneHref={(n) => (n ? `/office/rides/${n}?booked=1` : `/office/rides/${id}`)} startWithRebook={rebook} />
    </div>
  );
}

export default function Page() {
  return (
    <DesktopShell roles={['coordinator', 'admin']}>
      {() => (
        <Suspense>
          <Inner />
        </Suspense>
      )}
    </DesktopShell>
  );
}
