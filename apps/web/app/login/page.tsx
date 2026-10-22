'use client';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Role } from '@psebc/shared';
import { Brand, ErrorBox, TextField } from '@/components/ui';
import { post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { homeFor } from '@/lib/session';

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, fields, run } = useSubmit();
  const router = useRouter();
  const next = useSearchParams().get('next');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await run(() => post<{ user: { role: Role }; next: string }>('/auth/login', { email, password }));
    if (!res) return;
    if (res.next !== 'done') router.replace('/login/mfa');
    else router.replace(next && next.startsWith('/') && !next.startsWith('//') ? next : homeFor(res.user.role));
  }

  return (
    <form className="screen" onSubmit={submit} noValidate>
      <div>
        <h1 className="title">Sign in</h1>
        <p className="lede">Lifts to Princes Street Church from checked volunteer drivers.</p>
      </div>
      <ErrorBox error={error} />
      <TextField label="Email address" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} error={fields.email} required />
      <TextField label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} error={fields.password} required />
      <button className="btn btn-primary block" type="submit" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <p className="muted small">Forgotten your password, or don’t use the app? Please phone the church office — they can book lifts for you.</p>
    </form>
  );
}

export default function Login() {
  return (
    <div className="mobile">
      <header className="m-top">
        <Brand />
      </header>
      <main id="main">
        <Suspense>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
