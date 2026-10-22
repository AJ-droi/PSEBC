'use client';
import { useParams } from 'next/navigation';
import { MemberLog } from '@/components/forms';
import { RoleGate } from '@/components/shells';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return (
    <div className="mobile">
      <RoleGate roles={['member']}>{() => <MemberLog rideId={id} backHref="/member" doneHref="/member" concernHref={`/concern/${id}?from=member`} />}</RoleGate>
    </div>
  );
}
