'use client';
import { BookingWizard } from '@/components/booking-wizard';
import { RoleGate } from '@/components/shells';

export default function Book() {
  return (
    <div className="mobile">
      <RoleGate roles={['member']}>{(me) => <BookingWizard memberId={me.user.memberId!} backHref="/member" doneHref={(id) => `/member/rides/${id}?booked=1`} />}</RoleGate>
    </div>
  );
}
