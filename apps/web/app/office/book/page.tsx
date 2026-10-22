'use client';
import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { BookingWizard } from '@/components/booking-wizard';
import { DesktopShell } from '@/components/shells';
import { MemberPicker } from '@/components/member-picker';

/** Story 2.2 (PSEBC-13): coordinator selects the member, then completes the same form. */
function Inner() {
  const memberId = useSearchParams().get('memberId');
  const router = useRouter();
  if (!memberId) {
    return (
      <div className="section" style={{ maxWidth: 640 }}>
        <h1 className="d-title">Book a lift for a member</h1>
        <MemberPicker label="Member" action="Continue" onPick={(id) => router.push(`/office/book?memberId=${id}`)} />
      </div>
    );
  }
  return (
    <div className="mobile" style={{ minHeight: 0, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--divider)', overflow: 'hidden' }}>
      <BookingWizard memberId={memberId} backHref="/office" doneHref={(id) => `/office/rides/${id}?booked=1`} forOffice />
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
