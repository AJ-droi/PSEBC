'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { HELP_CAPS, VEHICLE_CAPS, type HelpCap, type VehicleCap } from '@psebc/shared';
import { patch, post, upload } from '@/lib/api';
import { useSubmit } from '@/lib/form';
import { CheckCards, ErrorBox, SelectField, TextField } from './ui';

export interface DriverFormValues {
  fullName: string;
  phone: string;
  email: string;
  postcode: string;
  dbsNumber: string;
  dbsIssueDate: string;
  dbsRenewalDate: string;
  insuranceExpiry: string;
  vehicleMakeModel: string;
  vehicleColour: string;
  vehicleReg: string;
  passengerSeats: number;
  vehicleCaps: VehicleCap[];
  helpCaps: HelpCap[];
}

const blank: DriverFormValues = {
  fullName: '',
  phone: '',
  email: '',
  postcode: '',
  dbsNumber: '',
  dbsIssueDate: '',
  dbsRenewalDate: '',
  insuranceExpiry: '',
  vehicleMakeModel: '',
  vehicleColour: '',
  vehicleReg: '',
  passengerSeats: 3,
  vehicleCaps: [],
  helpCaps: [],
};

type Files = { photo?: File; licence?: File; insurance?: File };

/** F02 Driver registration (stories 1.2 PSEBC-8, 1.6). Admin fills this in with the driver. */
export function DriverForm({ driverId, initial, status }: { driverId?: string; initial?: Partial<DriverFormValues>; status?: string }) {
  const [v, setV] = useState<DriverFormValues>({ ...blank, ...initial });
  const [files, setFiles] = useState<Files>({});
  const { busy, error, fields, run } = useSubmit();
  const router = useRouter();
  const set = <K extends keyof DriverFormValues>(k: K, val: DriverFormValues[K]) => setV((p) => ({ ...p, [k]: val }));

  async function save(submit: boolean) {
    const body = { ...v, dbsRenewalDate: v.dbsRenewalDate || undefined, submit };
    const res = await run(async () => {
      const id = driverId ?? (await post<{ id: string }>('/drivers', body)).id;
      if (driverId) await patch(`/drivers/${driverId}`, body);
      for (const kind of ['photo', 'licence', 'insurance'] as const) {
        const f = files[kind];
        if (f) await upload(`/drivers/${id}/documents/${kind}`, f);
      }
      return id;
    });
    if (res) router.replace(`/office/drivers/${res}?saved=1`);
  }

  const fileInput = (kind: keyof Files, label: string, accept: string) => (
    <div className="field">
      <label className="label sm" htmlFor={`f-${kind}`}>
        {label}
      </label>
      <input id={`f-${kind}`} className="input" type="file" accept={accept} onChange={(e) => setFiles((p) => ({ ...p, [kind]: e.target.files?.[0] }))} />
    </div>
  );

  return (
    <div className="d-grid">
      <form className="stack-lg" onSubmit={(e) => e.preventDefault()} noValidate>
        <ErrorBox error={error} />
        <section className="section">
          <h2>1 · About the driver</h2>
          <div className="cols-2">
            <TextField label="Full name" value={v.fullName} onChange={(e) => set('fullName', e.target.value)} error={fields.fullName} />
            <TextField label="Mobile" type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} error={fields.phone} />
            <TextField label="Email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} error={fields.email} />
            <TextField label="Home postcode" value={v.postcode} onChange={(e) => set('postcode', e.target.value.toUpperCase())} error={fields.postcode} />
          </div>
          {fileInput('photo', 'Photo (shown to members)', 'image/jpeg,image/png,image/webp')}
        </section>
        <section className="section">
          <h2>2 · Checks</h2>
          <div className="cols-2">
            <TextField label="DBS certificate number" inputMode="numeric" maxLength={12} value={v.dbsNumber} onChange={(e) => set('dbsNumber', e.target.value.replace(/\D/g, ''))} error={fields.dbsNumber} />
            <TextField label="DBS issue date" type="date" value={v.dbsIssueDate} onChange={(e) => set('dbsIssueDate', e.target.value)} error={fields.dbsIssueDate} />
            <TextField label="DBS renewal due" hint="Leave blank for 3 years after issue" type="date" value={v.dbsRenewalDate} onChange={(e) => set('dbsRenewalDate', e.target.value)} />
            <TextField label="Insurance expires" type="date" value={v.insuranceExpiry} onChange={(e) => set('insuranceExpiry', e.target.value)} error={fields.insuranceExpiry} />
          </div>
          <div className="cols-2">
            {fileInput('licence', 'Driving licence (PDF or photo)', 'application/pdf,image/*')}
            {fileInput('insurance', 'Insurance certificate (PDF or photo)', 'application/pdf,image/*')}
          </div>
          <p className="small muted">The app stores the result of the DBS check, not the certificate itself.</p>
        </section>
        <section className="section">
          <h2>3 · Vehicle</h2>
          <div className="cols-2">
            <TextField label="Make and model" value={v.vehicleMakeModel} onChange={(e) => set('vehicleMakeModel', e.target.value)} error={fields.vehicleMakeModel} />
            <TextField label="Colour" value={v.vehicleColour} onChange={(e) => set('vehicleColour', e.target.value)} error={fields.vehicleColour} />
            <TextField label="Registration" value={v.vehicleReg} onChange={(e) => set('vehicleReg', e.target.value.toUpperCase())} error={fields.vehicleReg} />
            <SelectField label="Passenger seats" value={String(v.passengerSeats)} onChange={(e) => set('passengerSeats', Number(e.target.value))} options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))} />
          </div>
          <CheckCards legend="The car can take" value={v.vehicleCaps} onChange={(x) => set('vehicleCaps', x)} options={(Object.keys(VEHICLE_CAPS) as VehicleCap[]).map((k) => ({ value: k, label: VEHICLE_CAPS[k] }))} />
        </section>
        <section className="section">
          <h2>4 · Help they can give</h2>
          <p className="muted small">Matching only sends requests the driver has said they can help with.</p>
          <CheckCards legend="They can help with" value={v.helpCaps} onChange={(x) => set('helpCaps', x)} options={(Object.keys(HELP_CAPS) as HelpCap[]).map((k) => ({ value: k, label: HELP_CAPS[k] }))} />
        </section>
      </form>
      <aside className="section" style={{ position: 'sticky', top: 16 }}>
        <div className="small muted">Status</div>
        <strong>{status === 'approved' ? 'Approved' : status === 'draft' || !status ? 'New' : 'Pending approval'}</strong>
        <p className="small muted">A pending, rejected or expired driver never receives an invite. Safeguarding is notified when you send for approval.{status === 'approved' ? ' Changing checks, car or help sends them back for re-approval.' : ''}</p>
        <button className="btn btn-primary block" type="button" disabled={busy} onClick={() => save(true)}>
          {busy ? 'Saving…' : driverId ? 'Save changes' : 'Save and send for approval'}
        </button>
        {!driverId ? (
          <button className="btn btn-secondary block" type="button" disabled={busy} onClick={() => save(false)}>
            Save as draft
          </button>
        ) : null}
        <div className="small muted">
          <strong>Reminders</strong>
          <p>Safeguarding gets a reminder 30 days before the DBS or insurance expires. On expiry the driver is set to Expired automatically.</p>
        </div>
      </aside>
    </div>
  );
}
