'use client';
import Link from 'next/link';
import { RIDE_STATUS_LABELS } from '@psebc/shared';
import { dayShort } from '@/lib/format';
import type { SeriesInfo } from '@/lib/types';

/** Story 2.6: "Lift 2 of 5 in a repeat booking", with the other days one tap away. */
export function SeriesPanel({ series, currentId, hrefFor }: { series: SeriesInfo | null | undefined; currentId: string; hrefFor: (id: string) => string }) {
  if (!series) return null;
  return (
    <div className="panel">
      <div className="h3">
        Repeat booking · lift {series.position} of {series.total}
      </div>
      <ul className="stack-sm" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {series.dates.map((d) => (
          <li key={d.id} className="between">
            {d.id === currentId ? (
              <strong aria-current="true">{dayShort(d.pickupAt)} (this one)</strong>
            ) : (
              <Link href={hrefFor(d.id)}>{dayShort(d.pickupAt)}</Link>
            )}
            <span className="small muted">{RIDE_STATUS_LABELS[d.status]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
