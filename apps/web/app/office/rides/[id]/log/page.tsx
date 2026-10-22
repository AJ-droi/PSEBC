'use client';
import { useParams } from 'next/navigation';
import { MemberLog } from '@/components/forms';
import { DesktopShell } from '@/components/shells';

/** Story 5.3: the coordinator completes the member’s log after a phone check-in. */
export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <DesktopShell roles={['coordinator', 'admin']}>
      {() => (
        <div className="mobile" style={{ minHeight: 0, background: 'var(--surface)', borderRadius: 16, border: '1px solid var(--divider)', overflow: 'hidden' }}>
          <MemberLog rideId={id} forOffice backHref={`/office/rides/${id}`} doneHref={`/office/rides/${id}`} concernHref={`/concern/${id}?back=/office/rides/${id}`} />
        </div>
      )}
    </DesktopShell>
  );
}
