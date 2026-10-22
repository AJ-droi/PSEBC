'use client';
import Link from 'next/link';
import { useId, type ReactNode, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { RIDE_STATUS_LABELS, DRIVER_STATUS_LABELS, type RideStatus, type DriverStatus } from '@psebc/shared';
import { Back } from './icons';

export function Brand({ suffix }: { suffix?: string }) {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true" />
      PSEBC Lifts {suffix ? <small>· {suffix}</small> : null}
    </span>
  );
}

export function BackBar({ href, label, crumb }: { href: string; label?: string; crumb?: string }) {
  return (
    <div className="m-back">
      <Link href={href} aria-label={label ?? 'Back'}>
        <Back />
      </Link>
      {crumb ? <span className="crumb">{crumb}</span> : null}
    </div>
  );
}

export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <div className="steps" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={i < current ? 'done' : ''} />
      ))}
    </div>
  );
}

export function Field({ label, hint, error, children, id, small }: { label: ReactNode; hint?: ReactNode; error?: string; children: (id: string, describedBy?: string) => ReactNode; id?: string; small?: boolean }) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = hint ? `${fid}-hint` : undefined;
  const errId = error ? `${fid}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;
  return (
    <div className="field">
      <div>
        <label className={`label${small ? ' sm' : ''}`} htmlFor={fid}>
          {label}
        </label>
        {hint ? (
          <p className="hint" id={hintId}>
            {hint}
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="field-error" id={errId}>
          {error}
        </p>
      ) : null}
      {children(fid, describedBy)}
    </div>
  );
}

export function TextField({ label, hint, error, ...rest }: { label: ReactNode; hint?: ReactNode; error?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Field label={label} hint={hint} error={error} id={rest.id}>
      {(id, d) => <input className="input" id={id} aria-describedby={d} aria-invalid={error ? true : undefined} {...rest} />}
    </Field>
  );
}

export function TextArea({ label, hint, error, ...rest }: { label: ReactNode; hint?: ReactNode; error?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Field label={label} hint={hint} error={error} id={rest.id}>
      {(id, d) => <textarea className="input" id={id} aria-describedby={d} aria-invalid={error ? true : undefined} rows={3} {...rest} />}
    </Field>
  );
}

export function SelectField({ label, hint, error, options, ...rest }: { label: ReactNode; hint?: ReactNode; error?: string; options: { value: string; label: string }[] } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <Field label={label} hint={hint} error={error} id={rest.id}>
      {(id, d) => (
        <select className="input" id={id} aria-describedby={d} aria-invalid={error ? true : undefined} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** Radio group shown as large option cards; selection changes border, fill and the radio tick — never colour alone. */
export function RadioCards<T extends string>({
  legend,
  hint,
  name,
  options,
  value,
  onChange,
  inline,
  error,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  name: string;
  options: { value: T; label: ReactNode }[];
  value: T | null | undefined;
  onChange: (v: T) => void;
  inline?: boolean;
  error?: string;
}) {
  const body = options.map((o) => (
    <label key={o.value} className="opt">
      <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} /> {o.label}
    </label>
  ));
  return (
    <fieldset className="q" aria-invalid={error ? true : undefined}>
      <legend>
        {legend}
        {hint ? <span className="hint">{hint}</span> : null}
      </legend>
      {error ? <p className="field-error">{error}</p> : null}
      {inline ? <div className="opt-row">{body}</div> : body}
    </fieldset>
  );
}

export function YesNo({ legend, name, value, onChange, error }: { legend: ReactNode; name: string; value: boolean | null; onChange: (v: boolean) => void; error?: string }) {
  return (
    <RadioCards
      legend={legend}
      name={name}
      inline
      error={error}
      value={value === null ? null : value ? 'yes' : 'no'}
      onChange={(v) => onChange(v === 'yes')}
      options={[
        { value: 'yes', label: 'Yes' },
        { value: 'no', label: 'No' },
      ]}
    />
  );
}

export function CheckCards<T extends string>({
  legend,
  hint,
  options,
  value,
  onChange,
  error,
}: {
  legend: ReactNode;
  hint?: ReactNode;
  options: { value: T; label: ReactNode }[];
  value: T[];
  onChange: (v: T[]) => void;
  error?: string;
}) {
  return (
    <fieldset className="q">
      <legend>
        {legend}
        {hint ? <span className="hint">{hint}</span> : null}
      </legend>
      {error ? <p className="field-error">{error}</p> : null}
      {options.map((o) => (
        <label key={o.value} className="opt">
          <input
            type="checkbox"
            checked={value.includes(o.value)}
            onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((x) => x !== o.value))}
          />{' '}
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function RideChip({ status }: { status: RideStatus }) {
  return <span className={`chip chip-${status}`}>{RIDE_STATUS_LABELS[status]}</span>;
}

export function DriverChip({ status }: { status: DriverStatus }) {
  return <span className={`chip chip-${status}`}>{DRIVER_STATUS_LABELS[status]}</span>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="alert" role="alert">
      <strong>There’s a problem</strong>
      <p>{message}</p>
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="muted" role="status" style={{ padding: 24 }}>
      {label}
    </p>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} style={{ display: 'contents' }}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Tags({ items, tone }: { items: string[]; tone?: 'amber' }) {
  if (!items.length) return <p className="muted">None recorded</p>;
  return (
    <ul className="tags">
      {items.map((t) => (
        <li key={t} className={`tag${tone ? ` ${tone}` : ''}`}>
          {t}
        </li>
      ))}
    </ul>
  );
}
