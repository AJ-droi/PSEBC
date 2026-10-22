'use client';
import { DesktopShell } from '@/components/shells';
import { MemberRegistration } from '@/components/member-registration';

export default function NewMember() {
  return (
    <DesktopShell roles={['coordinator', 'admin']}>
      {() => (
        <div className="mobile" style={{ minHeight: 0, background: 'var(--ground)', borderRadius: 16, border: '1px solid var(--divider)', overflow: 'hidden' }}>
          <MemberRegistration />
        </div>
      )}
    </DesktopShell>
  );
}
