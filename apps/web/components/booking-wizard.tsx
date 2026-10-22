'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { DESTINATIONS, HELP_NEEDED, MOBILITY_AIDS, VEHICLE_REQUIREMENTS, labelList } from '@psebc/shared';
import { fetcher, post } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { dayLong, londonToIso, time, timeOptions, upcomingDates } from '@/lib/format';
import type { MemberProfile } from '@/lib/types';
import { BackBar, ErrorBox, KV, Loading, RadioCards, SelectField, Steps, Tags, TextArea, TextField } from './ui';

/**
 * F04 Request a ride — three screens: where and when, getting home, check and book
 * (story 2.1 PSEBC-12; used by the office for story 2.2 PSEBC-13).
 * Needs come from the profile and are not re-entered.
 */
export function BookingWizard({ memberId, backHref, doneHref, forOffice }: { memberId: string; backHref: string; doneHref: (id: string) => string; forOffice?: boolean }) {
  const { data, error: loadError } = useSWR<{ member: MemberProfile }>(`/members/${memberId}`, fetcher, { revalidateOnFocus: false });
  const dates = useMemo(() => upcomingDates(), []);
  const times = useMemo(() => timeOptions(7, 21), []);
  const [step, setStep] = useState(1);
  const [date, setDate] = useState(() => nextSunday(dates));
  const [pickup, setPickup] = useState('09:45');
  const [fromHome, setFromHome] = useState(true);
  const [otherAddress, setOtherAddress] = useState('');
  const [destination, setDestination] = useState<string>(DESTINATIONS[0]);
  const [otherDestination, setOtherDestination] = useState('');
  const [returnNeeded, setReturnNeeded] = useState(true);
  const [returnTime, setReturnTime] = useState('12:30');
  const [companion, setCompanion] = useState(false);
  const [needsNote, setNeedsNote] = useState('');
  const [stepError, setStepError] = useState<string | null>(null);
  const { busy, error, fields, run } = useSubmit();
  const router = useRouter();

  if (loadError) return <ErrorBox error={loadError} />;
  if (!data) return <Loading />;
  const m = data.member;
  const needs = [...labelList(MOBILITY_AIDS, m.mobilityAids), ...labelList(HELP_NEEDED, m.helpNeeded), ...(m.vehicleRequirement !== 'any' ? [VEHICLE_REQUIREMENTS[m.vehicleRequirement as keyof typeof VEHICLE_REQUIREMENTS]] : [])];
  const pickupIso = londonToIso(date, pickup);
  const returnIso = returnNeeded ? londonToIso(date, returnTime) : null;
  const finalDestination = destination === 'other' ? otherDestination.trim() : destination;
  const who = forOffice ? m.preferredName : 'you';

  if (!m.consentGiven) {
    return (
      <>
        <BackBar href={backHref} crumb="Book a lift" />
        <main className="screen" id="main">
          <h1 className="title">Consent needed first</h1>
          <p className="lede">Lifts can’t be booked until consent to share travel needs with the driver is recorded.</p>
          {forOffice ? (
            <Link className="btn btn-primary block" href={`/office/members/${m.id}/needs`}>
              Record consent
            </Link>
          ) : (
            <p className="lede">Please phone the church office.</p>
          )}
        </main>
      </>
    );
  }

  function next() {
    setStepError(null);
    if (step === 1) {
      if (!fromHome && otherAddress.trim().length < 5) return setStepError('Enter where to pick up from');
      if (destination === 'other' && otherDestination.trim().length < 3) return setStepError('Enter where you are going');
      if (new Date(pickupIso).getTime() < Date.now() + 30 * 60_000) return setStepError('Choose a pickup time at least 30 minutes from now');
    }
    if (step === 2 && returnNeeded && returnIso! <= pickupIso) return setStepError('The lift home must be after the pickup time');
    setStep(step + 1);
    window.scrollTo({ top: 0 });
  }

  async function book() {
    const res = await run(() =>
      post<{ id: string; status: string }>('/rides', {
        memberId: forOffice ? memberId : undefined,
        pickupAt: pickupIso,
        pickupFromHome: fromHome,
        pickupAddress: fromHome ? '' : otherAddress,
        destination: finalDestination,
        returnNeeded,
        returnAt: returnIso,
        companion,
        needsNote,
      }),
    );
    if (res) router.replace(doneHref(res.id));
  }

  const crumb = `${forOffice ? `Booking for ${m.preferredName}` : 'Book a lift'} · Step ${step} of 3`;
  const back = step === 1 ? backHref : null;

  return (
    <>
      {back ? (
        <BackBar href={back} crumb={crumb} />
      ) : (
        <div className="m-back">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => setStep(step - 1)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="crumb">{crumb}</span>
        </div>
      )}
      <Steps total={3} current={step} />
      <main className="screen" id="main">
        <ErrorBox error={stepError ?? error} />
        {step === 1 ? (
          <>
            <h1 className="title">Where and when?</h1>
            <SelectField label="Date" value={date} onChange={(e) => setDate(e.target.value)} options={dates} />
            <SelectField label={forOffice ? 'Pick them up at' : 'Pick me up at'} value={pickup} onChange={(e) => setPickup(e.target.value)} options={times} />
            <RadioCards
              legend={forOffice ? 'Pick them up from' : 'Pick me up from'}
              name="from"
              value={fromHome ? 'home' : 'other'}
              onChange={(v) => setFromHome(v === 'home')}
              options={[
                {
                  value: 'home',
                  label: (
                    <span>
                      <strong style={{ fontWeight: 600 }}>{forOffice ? 'Their home' : 'My home'}</strong>
                      <br />
                      <span className="muted small">
                        {m.addressLine}, {m.town}
                      </span>
                    </span>
                  ),
                },
                { value: 'other', label: 'Somewhere else' },
              ]}
            />
            {!fromHome ? <TextField label="Pickup address" value={otherAddress} onChange={(e) => setOtherAddress(e.target.value)} error={fields.pickupAddress} /> : null}
            <SelectField label="Going to" value={destination} onChange={(e) => setDestination(e.target.value)} options={[...DESTINATIONS.map((d) => ({ value: d, label: d })), { value: 'other', label: 'Somewhere else' }]} />
            {destination === 'other' ? <TextField label="Where are you going?" value={otherDestination} onChange={(e) => setOtherDestination(e.target.value)} /> : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1 className="title">Getting home</h1>
            <RadioCards legend={`Do ${who} need a lift home?`} name="ret" inline value={returnNeeded ? 'yes' : 'no'} onChange={(v) => setReturnNeeded(v === 'yes')} options={[{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />
            {returnNeeded ? <SelectField label={forOffice ? 'Pick them up to go home at' : 'Pick me up to go home at'} value={returnTime} onChange={(e) => setReturnTime(e.target.value)} options={times} error={fields.returnAt} /> : null}
            <RadioCards
              legend={`Is anyone travelling with ${forOffice ? 'them' : 'you'}?`}
              name="comp"
              value={companion ? 'yes' : 'no'}
              onChange={(v) => setCompanion(v === 'yes')}
              options={[
                { value: 'no', label: forOffice ? 'No, just them' : 'No, just me' },
                { value: 'yes', label: 'Yes, a carer or companion' },
              ]}
            />
            <TextArea label={`Is anything different about ${forOffice ? 'their' : 'your'} needs this time?`} hint="Optional. Usual needs are already on the profile." placeholder="For example: using my wheelchair today" value={needsNote} onChange={(e) => setNeedsNote(e.target.value)} rows={2} />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1 className="title">Check {forOffice ? 'the' : 'your'} lift</h1>
            <div className="panel">
              <KV
                items={[
                  ['When', `${dayLong(pickupIso)}, ${time(pickupIso)}`],
                  ['From', fromHome ? `Home, ${m.addressLine}` : otherAddress],
                  ['To', finalDestination],
                  ['Lift home', returnIso ? time(returnIso) : 'Not needed'],
                  ...(companion ? ([['With', 'A carer or companion']] as [string, string][]) : []),
                ]}
              />
            </div>
            <div className="stack-sm">
              <h2 className="h3">{forOffice ? `${m.preferredName}’s needs` : 'Your needs'} (from the profile)</h2>
              <Tags items={needs} />
              {needsNote ? <p className="muted">This time: {needsNote}</p> : null}
            </div>
            <button type="button" className="link-btn" onClick={() => setStep(1)}>
              Something not right? Change it
            </button>
          </>
        ) : null}
      </main>
      <div className="m-foot">
        {step < 3 ? (
          <button type="button" className="btn btn-primary block" onClick={next}>
            Next
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary block" onClick={book} disabled={busy}>
              {busy ? 'Booking…' : 'Book this lift'}
            </button>
            <p className="small muted" style={{ textAlign: 'center' }}>
              {forOffice ? `${m.preferredName} will be told when a driver says yes.` : 'We’ll tell you when a driver says yes.'}
            </p>
          </>
        )}
      </div>
    </>
  );
}

function nextSunday(dates: { value: string }[]): string {
  const sunday = dates.find((d, i) => i > 0 && new Date(`${d.value}T12:00:00Z`).getUTCDay() === 0);
  return sunday?.value ?? dates[1]?.value ?? dates[0]!.value;
}
