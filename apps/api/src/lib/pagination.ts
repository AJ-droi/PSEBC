import type { Request } from 'express';
import { paginationQuerySchema, pageMeta, type PageMeta, type PaginationQuery } from '@psebc/shared';
import { parse } from './http';

export interface Page extends PaginationQuery {
  limit: number;
  offset: number;
  meta: (total: number) => PageMeta;
}

/**
 * Read `page` / `pageSize` from the query string (defaults 1 / 20, max 100 per page).
 * Use `limit` and `offset` in the query and `meta(total)` in the response:
 *   res.json({ members: rows, pagination: p.meta(total) })
 */
export function pageFrom(req: Request, defaults: Partial<PaginationQuery> = {}): Page {
  const q = parse(paginationQuerySchema, { ...defaults, ...pick(req.query) });
  return { ...q, limit: q.pageSize, offset: (q.page - 1) * q.pageSize, meta: (total) => pageMeta(q, total) };
}

function pick(query: Request['query']) {
  const out: Record<string, unknown> = {};
  if (query.page !== undefined) out.page = query.page;
  if (query.pageSize !== undefined) out.pageSize = query.pageSize;
  return out;
}
