'use client';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import {
  BOOKED_BY,
  CONTACT_METHODS,
  HEALTH_FLAGS,
  HELP_NEEDED,
  MOBILITY_AIDS,
  RELATIONSHIPS,
  REPRESENTATIVE_ROLES,
  VEHICLE_REQUIREMENTS,
  type BookedBy,
  type ContactMethod,
  type HealthFlag,
  type HelpNeeded,
  type MobilityAid,
  type VehicleRequirement,
} from '@psebc/shared';
import { post, put } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import type { MemberProfile } from '@/lib/types';
import { BackBar, CheckCards, ErrorBox, RadioCards, SelectField, Steps, TextArea, TextField, YesNo } from './ui';

export interface NeedsState {
  mobilityAids: MobilityAid[];
  helpNeeded: HelpNeeded[];
  vehicleRequirement: VehicleRequirement;
  notesForDriver: string;
  healthFlags: HealthFlag[];
  unwellInstructions: string;
  consent: boolean;
  consentGivenBy: 'member' | 'representative';
}

const emptyNeeds: NeedsState = {
  mobilityAids: [],
  helpNeeded: [],
  vehicleRequirement: 'any',
  notesForDriver: '',
  healthFlags: [],
  unwellInstructions: '',
  consent: false,
  consentGivenBy: 'member',
};

const initial = {
  fullName: '',
  preferredName: '',
  addressLine: '',
  town: '',
  postcode: '',
  findingNotes: '',
  phone: '',
  canReceiveSms: true,
  contactMethod: 'text' as ContactMethod,
  bookedBy: 'office' as BookedBy,
  emergencyName: '',
  emergencyRelationship: RELATIONSHIPS[0] as string,
  emergencyPhone: '',
  hasRepresentative: false,
  representativeSameAsEmergency: true,
  representativeName: '',
  representativePhone: '',
  representativeRole: REPRESENTATIVE_ROLES[0] as string,
  ...emptyNeeds,
};
type State = typeof initial;

const STEP_OF: Record<string, number> = {
  fullName: 1, preferredName: 1, addressLine: 1, town: 1, postcode: 1, findingNotes: 1, phone: 1,
  canReceiveSms: 2, contactMethod: 2, bookedBy: 2,
  emergencyName: 3, emergencyRelationship: 3, emergencyPhone: 3, hasRepresentative: 3, representativeName: 3, representativePhone: 3, representativeRole: 3,
  mobilityAids: 4, helpNeeded: 4, vehicleRequirement: 4, notesForDriver: 4,
};

const TITLES = ['About them', 'Contact and bookings', 'Emergency contact', 'Travel needs', 'Health and consent'];

/** F01 Member registration — five screens (story 1.1, PSEBC-7). Used by the admin or church office with the member. */
export function MemberRegistration() {
  const [s, setS] = useState<State>(initial);
  const [step, setStep] = useState(1);
  const { busy, error, fields, run } = useSubmit();
  const router = useRouter();
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));

  async function save() {
    const res = await run(() => post<{ id: string }>('/members', s));
    if (res) router.replace(`/office/members/${res.id}?created=1`);
  }

  // After a failed save, jump back to the first screen with a problem.
  useEffect(() => {
    const steps = Object.keys(fields).map((k) => STEP_OF[k] ?? 5);
    if (steps.length) setStep(Math.min(...steps));
  }, [fields]);
  const showStep = step;

  return (
    <>
      {showStep === 1 ? (
        <BackBar href="/office/members" crumb={`Joining the lift scheme · 1 of 5`} />
      ) : (
        <div className="m-back">
          <button type="button" className="icon-btn" aria-label="Back" onClick={() => setStep(showStep - 1)}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <span className="crumb">Joining the lift scheme · {showStep} of 5</span>
        </div>
      )}
      <Steps total={5} current={showStep} />
      <main className="screen" id="main">
        <h1 className="title">{TITLES[showStep - 1]}</h1>
        <ErrorBox error={error} />
        {showStep === 1 ? (
          <>
            <p className="lede" style={{ marginTop: -14 }}>So their driver knows who to collect and where.</p>
            <TextField label="Full name" value={s.fullName} onChange={(e) => set('fullName', e.target.value)} error={fields.fullName} autoComplete="off" />
            <TextField label="What would they like to be called?" hint="The name their driver will use." value={s.preferredName} onChange={(e) => set('preferredName', e.target.value)} error={fields.preferredName} />
            <TextField label="Home address" hint="House number and street" value={s.addressLine} onChange={(e) => set('addressLine', e.target.value)} error={fields.addressLine} />
            <div className="opt-row" style={{ gap: 12 }}>
              <div style={{ flex: 1 }}>
                <TextField label="Town" value={s.town} onChange={(e) => set('town', e.target.value)} error={fields.town} />
              </div>
              <div style={{ flex: 1 }}>
                <TextField label="Postcode" value={s.postcode} onChange={(e) => set('postcode', e.target.value.toUpperCase())} error={fields.postcode} />
              </div>
            </div>
            <TextArea label="Anything that helps the driver find them?" hint="Optional. Please don’t write key safe codes here." value={s.findingNotes} onChange={(e) => set('findingNotes', e.target.value)} rows={2} />
            <TextField label="Phone number" type="tel" hint="UK number, for example 07700 900123" inputMode="tel" autoComplete="tel" placeholder="07700 900123" value={s.phone} onChange={(e) => set('phone', e.target.value)} error={fields.phone} />
          </>
        ) : null}
        {showStep === 2 ? (
          <>
            <p className="lede" style={{ marginTop: -14 }}>How we keep them updated about their lifts.</p>
            <YesNo legend="Can their phone get text messages?" name="sms" value={s.canReceiveSms} onChange={(v) => set('canReceiveSms', v)} />
            <RadioCards legend="How should we contact them about lifts?" name="how" value={s.contactMethod} onChange={(v) => set('contactMethod', v)} options={(Object.keys(CONTACT_METHODS) as ContactMethod[]).map((k) => ({ value: k, label: CONTACT_METHODS[k] }))} />
            <RadioCards legend="Who will usually book their lifts?" name="who" value={s.bookedBy} onChange={(v) => set('bookedBy', v)} options={(Object.keys(BOOKED_BY) as BookedBy[]).map((k) => ({ value: k, label: BOOKED_BY[k] }))} />
          </>
        ) : null}
        {showStep === 3 ? (
          <>
            <p className="lede" style={{ marginTop: -14 }}>Someone we can call if there’s a problem on a journey.</p>
            <TextField label="Their name" value={s.emergencyName} onChange={(e) => set('emergencyName', e.target.value)} error={fields.emergencyName} />
            <SelectField label="How are they related?" value={s.emergencyRelationship} onChange={(e) => set('emergencyRelationship', e.target.value)} options={RELATIONSHIPS.map((r) => ({ value: r, label: r }))} />
            <TextField label="Their phone number" type="tel" hint="UK number, for example 07700 900123" inputMode="tel" autoComplete="tel" placeholder="07700 900123" value={s.emergencyPhone} onChange={(e) => set('emergencyPhone', e.target.value)} error={fields.emergencyPhone} />
            <YesNo legend="Does someone help them manage their lifts?" name="rep" value={s.hasRepresentative} onChange={(v) => set('hasRepresentative', v)} />
            {s.hasRepresentative ? (
              <div className="panel">
                <label className="check">
                  <input type="checkbox" checked={s.representativeSameAsEmergency} onChange={(e) => set('representativeSameAsEmergency', e.target.checked)} /> Same person as the emergency contact
                </label>
                {!s.representativeSameAsEmergency ? (
                  <>
                    <TextField label="Their name" value={s.representativeName} onChange={(e) => set('representativeName', e.target.value)} />
                    <TextField label="Their phone" type="tel" hint="UK number, for example 07700 900123" inputMode="tel" autoComplete="tel" placeholder="07700 900123" value={s.representativePhone} onChange={(e) => set('representativePhone', e.target.value)} error={fields.representativePhone} />
                  </>
                ) : null}
                <SelectField label="What is their role?" value={s.representativeRole} onChange={(e) => set('representativeRole', e.target.value)} options={REPRESENTATIVE_ROLES.map((r) => ({ value: r, label: r }))} />
                <p className="small muted">They’ll be able to book and cancel lifts for them through the church office.</p>
              </div>
            ) : null}
          </>
        ) : null}
        {showStep === 4 ? <NeedsFields s={s} set={setS as unknown as Dispatch<SetStateAction<NeedsState>>} /> : null}
        {showStep === 5 ? <HealthFields s={s} set={setS as unknown as Dispatch<SetStateAction<NeedsState>>} representative={s.hasRepresentative} /> : null}
      </main>
      <div className="m-foot">
        {showStep < 5 ? (
          <button type="button" className="btn btn-primary block" onClick={() => setStep(showStep + 1)}>
            Next
          </button>
        ) : (
          <>
            <button type="button" className="btn btn-primary block" onClick={save} disabled={busy}>
              {busy ? 'Saving…' : 'Save and finish'}
            </button>
            {!s.consent ? <p className="small muted" style={{ textAlign: 'center' }}>You can save now, but lifts can’t be booked until consent is recorded.</p> : null}
          </>
        )}
      </div>
    </>
  );
}

export function NeedsFields({ s, set }: { s: NeedsState; set: Dispatch<SetStateAction<NeedsState>> }) {
  const upd = <K extends keyof NeedsState>(k: K, v: NeedsState[K]) => set((p) => ({ ...p, [k]: v }));
  return (
    <>
      <p className="lede" style={{ marginTop: -14 }}>So we send a driver and car that suit them.</p>
      <CheckCards legend="Do they use a mobility aid?" hint="Tick everything they bring on a journey. Leave blank for none." value={s.mobilityAids} onChange={(v) => upd('mobilityAids', v)} options={(Object.keys(MOBILITY_AIDS) as MobilityAid[]).map((k) => ({ value: k, label: MOBILITY_AIDS[k] }))} />
      <CheckCards legend="What help do they need?" value={s.helpNeeded} onChange={(v) => upd('helpNeeded', v)} options={(Object.keys(HELP_NEEDED) as HelpNeeded[]).map((k) => ({ value: k, label: HELP_NEEDED[k] }))} />
      <SelectField label="What kind of car do they need?" value={s.vehicleRequirement} onChange={(e) => upd('vehicleRequirement', e.target.value as VehicleRequirement)} options={(Object.keys(VEHICLE_REQUIREMENTS) as VehicleRequirement[]).map((k) => ({ value: k, label: VEHICLE_REQUIREMENTS[k] }))} />
      <TextArea label="Short note for the driver" hint="Optional. For example: walks slowly on steps." value={s.notesForDriver} onChange={(e) => upd('notesForDriver', e.target.value)} rows={2} />
    </>
  );
}

export function HealthFields({ s, set, representative }: { s: NeedsState; set: Dispatch<SetStateAction<NeedsState>>; representative?: boolean }) {
  const upd = <K extends keyof NeedsState>(k: K, v: NeedsState[K]) => set((p) => ({ ...p, [k]: v }));
  return (
    <>
      <p className="lede" style={{ marginTop: -14 }}>Only share what matters for a car journey. They don’t have to share anything.</p>
      <CheckCards legend="Is there anything their driver should know?" value={s.healthFlags} onChange={(v) => upd('healthFlags', v)} options={(Object.keys(HEALTH_FLAGS) as HealthFlag[]).map((k) => ({ value: k, label: HEALTH_FLAGS[k] }))} />
      <TextArea label="What should the driver do if they feel unwell?" value={s.unwellInstructions} onChange={(e) => upd('unwellInstructions', e.target.value)} rows={2} />
      <div className="panel" style={{ borderColor: s.consent ? 'var(--pine)' : undefined }}>
        <div className="h3">Sharing with their driver</div>
        <p className="muted">We’ll show their travel needs and the health information ticked above to the volunteer driver for each lift, from when they accept until the trip is closed.</p>
        {representative ? (
          <RadioCards legend="Who is giving consent?" name="by" inline value={s.consentGivenBy} onChange={(v) => upd('consentGivenBy', v)} options={[{ value: 'member', label: 'The member' }, { value: 'representative', label: 'Their representative' }]} />
        ) : null}
        <label className="check" style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={s.consent} onChange={(e) => upd('consent', e.target.checked)} /> They agree to share this with their driver
        </label>
        <p className="small muted">They can change their mind at any time by telling the church office.</p>
      </div>
    </>
  );
}

/** F12 Update member needs (story 1.7): changing health information needs fresh consent. */
export function NeedsEditor({ member, onDone }: { member: MemberProfile; onDone: () => void }) {
  const [s, setS] = useState<NeedsState>({
    mobilityAids: member.mobilityAids as MobilityAid[],
    helpNeeded: member.helpNeeded as HelpNeeded[],
    vehicleRequirement: member.vehicleRequirement as VehicleRequirement,
    notesForDriver: member.notesForDriver,
    healthFlags: (member.healthFlags ?? []) as HealthFlag[],
    unwellInstructions: member.unwellInstructions ?? '',
    consent: false,
    consentGivenBy: (member.consentGivenBy as 'member' | 'representative') ?? 'member',
  });
  const { busy, error, run } = useSubmit();
  return (
    <div className="stack-lg">
      <ErrorBox error={error} />
      <NeedsFields s={s} set={setS} />
      <HealthFields s={s} set={setS} representative={member.hasRepresentative} />
      <div className="notice">
        <p>Tick the consent box again to confirm they agree to share the updated information. Without it, health changes can’t be saved and lifts can’t be booked.</p>
      </div>
      <button
        type="button"
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          const ok = await run(() => put(`/members/${member.id}/needs`, s));
          if (ok) onDone();
        }}
      >
        {busy ? 'Saving…' : 'Save needs'}
      </button>
    </div>
  );
}
