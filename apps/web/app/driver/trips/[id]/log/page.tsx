'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { RoleGate } from '@/components/shells';
import { BackBar, ErrorBox, Loading, TextArea, YesNo } from '@/components/ui';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { dayLong, time } from '@/lib/format';
import type { DriverTripView } from '@/lib/types';

/** F08 Driver trip log — story 5.2 (PSEBC-25). "Anything to report? Yes" opens the concern report. */
export default function DriverLog() {
  return (
    <div className="mobile">
      <RoleGate roles={['driver']}>{() => <Inner />}</RoleGate>
    </div>
  );
}

function Inner() {
  const { id } = useParams<{ id: string }>();
  const { data } = useSWR<DriverTripView>(`/rides/${id}`, fetcher);
  const [planned, setPlanned] = useState<boolean | null>(null);
  const [report, setReport] = useState<boolean | null>(null);
  const [needs, setNeeds] = useState<boolean | null>(null);
  const [comments, setComments] = useState('');
  const { busy, error, run } = useSubmit();
  const router = useRouter();
  if (!data) return <Loading />;
  if (data.view !== 'driver_trip') return <ErrorBox error="This trip can no longer be logged." />;
  const name = data.member.preferredName;
  if (data.driverLogDone) {
    return (
      <>
        <BackBar href="/driver" />
        <main className="screen" id="main">
          <h1 className="title">Thank you</h1>
          <p className="lede">You’ve already logged this trip.</p>
        </main>
      </>
    );
  }
  return (
    <>
      <BackBar href={`/driver/trips/${id}`} crumb={`Trip log · ${dayLong(data.ride.pickupAt)}`} />
      <main className="screen" id="main">
        <div>
          <h1 className="title">How did it go?</h1>
          <p className="lede">
            Lift with {name}
            {data.ride.pickedUpAt ? ` · picked up ${time(data.ride.pickedUpAt)}` : ''}
            {data.ride.droppedOffAt ? ` · dropped off ${time(data.ride.droppedOffAt)}` : ''}
          </p>
        </div>
        <ErrorBox error={error} />
        <YesNo legend="Did the trip go as planned?" name="plan" value={planned} onChange={setPlanned} />
        <div className="stack-sm">
          <YesNo legend="Anything to report?" name="rep" value={report} onChange={setReport} />
          {report ? (
            <div className="alert">
              <p>Tell safeguarding what happened on the next screen. Only the safeguarding lead sees your report.</p>
            </div>
          ) : null}
        </div>
        <div className="stack-sm">
          <YesNo legend={`Have ${name}’s needs changed?`} name="needs" value={needs} onChange={setNeeds} />
          <p className="small muted">If yes, the church office will check with them before updating their profile.</p>
        </div>
        <TextArea label="Anything else? (optional)" value={comments} onChange={(e) => setComments(e.target.value)} rows={2} />
      </main>
      <div className="m-foot">
        <button
          className="btn btn-primary block"
          type="button"
          disabled={busy || planned === null || report === null || needs === null}
          onClick={async () => {
            const res = await run(() => post<{ openConcern: boolean }>(`/rides/${id}/logs/driver`, { wentAsPlanned: planned, anythingToReport: report, needsChanged: needs, comments }));
            if (res) router.replace(res.openConcern ? `/concern/${id}?back=/driver` : '/driver');
          }}
        >
          {report ? 'Next: the concern report' : 'Send trip log'}
        </button>
      </div>
    </>
  );
}
