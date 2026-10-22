'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand, ErrorBox, Loading, TextField } from '@/components/ui';
import { post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { homeFor, useMe } from '@/lib/session';

/** Multi-factor sign-in for admin and safeguarding (PRD §10). */
export default function Mfa() {
  const { data: me, mutate } = useMe();
  const [setup, setSetup] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const { busy, error, fields, run } = useSubmit();
  const router = useRouter();

  useEffect(() => {
    if (me?.mfaPassed) router.replace(homeFor(me.user.role));
    if (me && !me.mfaEnabled && !setup) {
      post<{ qr: string; secret: string }>('/auth/mfa/setup').then(setSetup).catch(() => undefined);
    }
  }, [me, setup, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await run(() => post('/auth/mfa/verify', { code }));
    if (ok) {
      const fresh = await mutate();
      router.replace(homeFor(fresh!.user.role));
    }
  }

  if (!me) return <Loading />;
  return (
    <div className="mobile">
      <header className="m-top">
        <Brand />
      </header>
      <main id="main">
        <form className="screen" onSubmit={submit} noValidate>
          <div>
            <h1 className="title">Security code</h1>
            <p className="lede">
              {me.mfaEnabled
                ? 'Open your authenticator app and enter the 6-digit code for PSEBC Lifts.'
                : 'Your role can see sensitive information, so you need a second step to sign in. Scan this code with an authenticator app (for example Microsoft Authenticator), then enter the 6-digit code it shows.'}
            </p>
          </div>
          {!me.mfaEnabled && setup ? (
            <div className="panel" style={{ alignItems: 'center' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={setup.qr} alt="QR code to add PSEBC Lifts to your authenticator app" width={200} height={200} />
              <p className="small muted" style={{ wordBreak: 'break-all' }}>
                Can’t scan? Enter this key: <strong>{setup.secret}</strong>
              </p>
            </div>
          ) : null}
          <ErrorBox error={error} />
          <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} error={fields.code} />
          <button className="btn btn-primary block" type="submit" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      </main>
    </div>
  );
}
