'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { DECLINE_REASONS, type DeclineReason } from '@psebc/shared';
import { RoleGate } from '@/components/shells';
import { BackBar, ErrorBox, Loading, RadioCards, TextArea } from '@/components/ui';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { when } from '@/lib/format';
import type { InviteView } from '@/lib/types';

/** F06 Decline asks for a reason from a short list (story 3.2) — helps spot gaps. */
export default function Decline() {
  return (
    <div className="mobile">
      <RoleGate roles={['driver']}>{() => <Inner />}</RoleGate>
    </div>
  );
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const { data } = useSWR<InviteView>(`/rides/${id}`, fetcher);
  const [reason, setReason] = useState<DeclineReason | null>(null);
  const [note, setNote] = useState('');
  const { busy, error, run } = useSubmit();
  const router = useRouter();
  if (!data) return <Loading />;
  return (
    <>
      <BackBar href={`/driver/invites/${id}`} crumb={data.ride ? `${when(data.ride.pickupAt)} · ${data.ride.pickupArea?.split(',')[0] ?? ''}` : ''} />
      <main className="screen" id="main">
        <div>
          <h1 className="title">Can’t take this one?</h1>
          <p className="lede">That’s fine. Telling us why helps the church find more drivers for the lifts that go unfilled.</p>
        </div>
        <ErrorBox error={error} />
        <RadioCards legend="Why can’t you take it?" name="why" value={reason} onChange={setReason} options={(Object.keys(DECLINE_REASONS) as DeclineReason[]).map((k) => ({ value: k, label: DECLINE_REASONS[k] }))} />
        {reason === 'other' ? <TextArea label="Tell us more (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} /> : null}
        <p className="muted small">Your answer is only seen by the church office. The member is not told who declined.</p>
      </main>
      <div className="m-foot">
        <button
          className="btn btn-primary block"
          type="button"
          disabled={!reason || busy}
          onClick={async () => {
            const ok = await run(() => post(`/rides/${id}/decline`, { reason, note }));
            if (ok) router.replace('/driver');
          }}
        >
          Decline request
        </button>
      </div>
    </>
  );
}
