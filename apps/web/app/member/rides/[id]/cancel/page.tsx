'use client';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { CancelRide } from '@/components/forms';
import { RoleGate } from '@/components/shells';

function Inner() {
  const { id } = useParams<{ id: string }>();
  const rebook = useSearchParams().get('rebook') === '1';
  return <CancelRide rideId={id} backHref={`/member/rides/${id}`} doneHref={(newId) => (newId ? `/member/rides/${newId}?booked=1` : '/member')} startWithRebook={rebook} />;
}

export default function Page() {
  return (
    <div className="mobile">
      <RoleGate roles={['member']}>{() => <Suspense><Inner /></Suspense>}</RoleGate>
    </div>
  );
}
