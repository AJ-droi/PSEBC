/** Thin client for the Express API (proxied at /api by next.config.ts). */

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  const type = res.headers.get('content-type') ?? '';
  const body = type.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: { fields?: Record<string, string> } } })?.error;
    if (res.status === 401 && typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
    }
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? 'Something went wrong. Please try again.', err?.details?.fields ?? {});
  }
  return body as T;
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    body: json !== undefined ? JSON.stringify(json) : init.body,
  });
  return handle<T>(res);
}

export const post = <T = unknown>(path: string, json: unknown = {}) => api<T>(path, { method: 'POST', json });
export const put = <T = unknown>(path: string, json: unknown) => api<T>(path, { method: 'PUT', json });
export const patch = <T = unknown>(path: string, json: unknown) => api<T>(path, { method: 'PATCH', json });

export async function upload<T = unknown>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`/api${path}`, { method: 'POST', body: form, credentials: 'same-origin' });
  return handle<T>(res);
}

/** SWR fetcher */
export const fetcher = <T,>(path: string) => api<T>(path);
