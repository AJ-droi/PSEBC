'use client';
import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { ConcernForm } from '@/components/forms';
import { RoleGate } from '@/components/shells';
import { homeFor } from '@/lib/session';

function Inner({ home }: { home: string }) {
  const { rideId } = useParams<{ rideId: string }>();
  const back = useSearchParams().get('back');
  const safeBack = back && back.startsWith('/') && !back.startsWith('//') ? back : home;
  return <ConcernForm rideId={rideId} backHref={safeBack} doneHref={home} />;
}

/** F10 — anyone involved in the trip (driver, member, or the office on their behalf). */
export default function Page() {
  return (
    <div className="mobile">
      <RoleGate roles={['member', 'driver', 'coordinator', 'admin', 'safeguarding']}>
        {(me) => (
          <Suspense>
            <Inner home={homeFor(me.user.role)} />
          </Suspense>
        )}
      </RoleGate>
    </div>
  );
}
