'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import useSWR from 'swr';
import type { Feature, Role } from '@psebc/shared';
import { fetcher } from '@/lib/api';
import { useRelease } from '@/lib/release';
import { homeFor, signOut, useMe, type Me } from '@/lib/session';
import { Brand, Loading } from './ui';
import { Bell } from './icons';
import { AlertsPrompt, BELL_KEY, useMessageAlerts } from './alerts';

/** Loads the signed-in user and checks the role before rendering a screen. The API re-checks every call. */
export function RoleGate({ roles, children }: { roles: Role[]; children: (me: Me) => ReactNode }) {
  const { data, error, isLoading } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (data && !data.mfaPassed) router.replace('/login/mfa');
  }, [data, router]);
  if (isLoading || (data && !data.mfaPassed)) return <Loading />;
  if (error || !data) return <Loading label="Signing you in…" />;
  if (!roles.includes(data.user.role)) {
    return (
      <main className="screen" id="main">
        <h1 className="title">You don’t have access to this page</h1>
        <Link className="btn btn-primary" href={homeFor(data.user.role)}>
          Go to my home page
        </Link>
      </main>
    );
  }
  return <>{children(data)}</>;
}

function NotificationsLink() {
  const { data } = useSWR<{ unread: number; notifications: { kind: string; readAt: string | null }[] }>(BELL_KEY, fetcher, {
    refreshInterval: 20_000,
    refreshWhenHidden: true,
  });
  useMessageAlerts(data);
  const n = data?.unread ?? 0;
  return (
    <Link href="/notifications" className="icon-btn" aria-label={n ? `Messages, ${n} new` : 'Messages'} style={{ position: 'relative' }}>
      <Bell />
      {n ? (
        <span className="badge" style={{ position: 'absolute', top: -2, right: -4, minWidth: 22, height: 22, fontSize: 12 }} aria-hidden="true">
          {n}
        </span>
      ) : null}
    </Link>
  );
}

/** Phone layout for members and drivers. */
export function MobileShell({ roles, children, top = true, label }: { roles: Role[]; children: (me: Me) => ReactNode; top?: boolean; label?: string }) {
  return (
    <div className="mobile">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <RoleGate roles={roles}>
        {(me) => (
          <>
            {top ? (
              <header className="m-top">
                <Link href={homeFor(me.user.role)} style={{ textDecoration: 'none' }} aria-label="PSEBC Lifts home">
                  <Brand />
                </Link>
                <div className="row" style={{ gap: 4 }}>
                  {label ? <span className="chip chip-neutral">{label}</span> : null}
                  <NotificationsLink />
                  {me.user.role === 'member' ? (
                    <Link href="/member/profile" className="avatar" aria-label="My details">
                      {me.user.fullName.charAt(0)}
                    </Link>
                  ) : null}
                </div>
              </header>
            ) : null}
            <AlertsPrompt inset />
            {children(me)}
          </>
        )}
      </RoleGate>
    </div>
  );
}

const NAV: Record<string, { href: string; label: string; roles: Role[]; feature?: Feature }[]> = {
  office: [
    { href: '/office', label: 'Lifts', roles: ['coordinator', 'admin'] },
    { href: '/office/members', label: 'Members', roles: ['coordinator', 'admin'] },
    { href: '/office/drivers', label: 'Drivers', roles: ['coordinator', 'admin'] },
    { href: '/office/reports', label: 'Reports', roles: ['admin'], feature: 'reports' },
    { href: '/office/users', label: 'Logins', roles: ['admin'] },
    { href: '/safeguarding/incidents', label: 'Incidents', roles: ['safeguarding'], feature: 'tripLogging' },
    { href: '/safeguarding', label: 'Sign-off', roles: ['safeguarding'], feature: 'signOff' },
    { href: '/safeguarding/approvals', label: 'Driver approvals', roles: ['safeguarding'] },
    { href: '/office/reports', label: 'Reports', roles: ['safeguarding'], feature: 'reports' },
    { href: '/safeguarding/audit', label: 'Audit trail', roles: ['safeguarding'] },
  ],
};

const ROLE_LABEL: Record<Role, string> = {
  member: 'Member',
  driver: 'Volunteer driver',
  coordinator: 'Coordinator',
  admin: 'Admin',
  safeguarding: 'Safeguarding lead',
};

/** Desktop layout for the church office, admin and safeguarding (design: top bar + nav). */
export function DesktopShell({ roles, children }: { roles: Role[]; children: (me: Me) => ReactNode }) {
  const pathname = usePathname();
  const { has, release } = useRelease();
  return (
    <div className="desk">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <RoleGate roles={roles}>
        {(me) => {
          const items = NAV.office!.filter((n) => n.roles.includes(me.user.role) && (!n.feature || has(n.feature)));
          const area = me.user.role === 'safeguarding' ? 'Safeguarding' : me.user.role === 'admin' ? 'Admin' : 'Church office';
          const current = items
            .map((i) => i.href)
            .filter((h) => pathname === h || pathname.startsWith(h + '/'))
            .sort((a, b) => b.length - a.length)[0];
          return (
            <>
              <header className="d-top">
                <Link href={homeFor(me.user.role)} style={{ textDecoration: 'none' }}>
                  <Brand suffix={area} />
                </Link>
                <nav className="d-nav" aria-label="Main">
                  {items.map((n) => (
                    <Link key={n.href + n.label} href={n.href} aria-current={n.href === current ? 'page' : undefined}>
                      {n.label}
                    </Link>
                  ))}
                </nav>
                <div className="d-user">
                  {release?.label ? (
                    <span className="chip chip-neutral" title="Parts of the app switched on in this release">
                      {release.label}
                    </span>
                  ) : null}
                  <NotificationsLink />
                  <span>
                    {me.user.fullName} · {ROLE_LABEL[me.user.role]}
                  </span>
                  <button type="button" className="link-btn" onClick={signOut}>
                    Sign out
                  </button>
                </div>
              </header>
              <main className="d-main" id="main">
                <AlertsPrompt />
                {children(me)}
              </main>
            </>
          );
        }}
      </RoleGate>
    </div>
  );
}
