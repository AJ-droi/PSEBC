'use client';
import { useId, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/api';

interface M {
  id: string;
  fullName: string;
  town: string;
  postcode: string;
  consentGiven: boolean;
  status: string;
}

/** Type-ahead member search for the church office. */
export function MemberPicker({ label, action, onPick }: { label: string; action: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [chosen, setChosen] = useState<M | null>(null);
  const id = useId();
  const { data } = useSWR<{ members: M[] }>(q.length >= 2 && !chosen ? `/members?q=${encodeURIComponent(q)}&pageSize=6` : null, fetcher);
  const results = (data?.members ?? []).filter((m) => m.status === 'active').slice(0, 6);
  return (
    <form
      className="row"
      style={{ alignItems: 'flex-end', position: 'relative' }}
      onSubmit={(e) => {
        e.preventDefault();
        const pick = chosen ?? results[0];
        if (pick) onPick(pick.id);
      }}
    >
      <div className="field" style={{ minWidth: 280 }}>
        <label className="label sm" htmlFor={id}>
          {label}
        </label>
        <input
          id={id}
          className="input"
          placeholder="Start typing a name"
          value={chosen ? chosen.fullName : q}
          autoComplete="off"
          role="combobox"
          aria-expanded={results.length > 0}
          aria-controls={`${id}-list`}
          onChange={(e) => {
            setChosen(null);
            setQ(e.target.value);
          }}
        />
        {results.length > 0 ? (
          <ul id={`${id}-list`} role="listbox" className="panel" style={{ position: 'absolute', top: '100%', zIndex: 5, listStyle: 'none', margin: '4px 0 0', padding: 6, gap: 2, minWidth: 280 }}>
            {results.map((m) => (
              <li key={m.id} role="option" aria-selected={false}>
                <button type="button" className="list-link" style={{ width: '100%', textAlign: 'left', border: 0, cursor: 'pointer' }} onClick={() => setChosen(m)}>
                  <strong>{m.fullName}</strong>
                  <span className="small muted">
                    {m.town} {m.postcode}
                    {m.consentGiven ? '' : ' · consent needed'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <button className="btn btn-primary" type="submit" disabled={!chosen && results.length === 0}>
        {action}
      </button>
    </form>
  );
}
