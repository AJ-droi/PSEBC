'use client';
import { useState } from 'react';
import type { PageMeta } from '@psebc/shared';

/**
 * "Previous · Page 2 of 5 · Next" under a list. Hidden when everything fits on one page.
 * Large buttons and a plain-English status for screen readers (PRD §10).
 */
export function Pager({ pagination, onPage, noun = 'items' }: { pagination: PageMeta | undefined; onPage: (page: number) => void; noun?: string }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total, pageSize } = pagination;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav className="pager" aria-label="Pages">
      <button type="button" className="btn btn-secondary sm" disabled={!pagination.hasPrevious} onClick={() => onPage(page - 1)}>
        <span aria-hidden="true">‹</span> Previous
      </button>
      <span className="small muted" aria-live="polite">
        {from}–{to} of {total} {noun} · page {page} of {totalPages}
      </span>
      <button type="button" className="btn btn-secondary sm" disabled={!pagination.hasNext} onClick={() => onPage(page + 1)}>
        Next <span aria-hidden="true">›</span>
      </button>
    </nav>
  );
}

/**
 * Page state for a list. Goes back to page 1 whenever `resetOn` changes (e.g. a search or filter),
 * and builds the SWR key: usePage('/members', { q }) → '/members?q=…&page=2&pageSize=20'.
 */
export function usePage(path: string, params: Record<string, string | number | undefined> = {}, pageSize = 20) {
  const filters = JSON.stringify(params);
  const [state, setState] = useState({ filters, page: 1 });
  // A new search/filter starts again at page 1 (no flash of an out-of-range page).
  const page = state.filters === filters ? state.page : 1;
  const setPage = (p: number) => {
    setState({ filters, page: p });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  qs.set('page', String(page));
  qs.set('pageSize', String(pageSize));
  return { page, setPage, key: `${path}?${qs.toString()}` };
}
