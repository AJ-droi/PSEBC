'use client';
import Link from 'next/link';
import { DesktopShell } from '@/components/shells';
import { DriverForm } from '@/components/driver-form';

export default function NewDriver() {
  return (
    <DesktopShell roles={['admin']}>
      {() => (
        <>
          <div>
            <p className="muted">
              <Link href="/office/drivers">Drivers</Link>
            </p>
            <h1 className="d-title">Add a volunteer driver</h1>
            <p className="muted">Fill this in with the driver. Safeguarding must approve them before they’re offered any lift.</p>
          </div>
          <DriverForm />
        </>
      )}
    </DesktopShell>
  );
}
