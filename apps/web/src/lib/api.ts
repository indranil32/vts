// Thin API client: JWT in localStorage (falls back to memory when storage is unavailable).
const KEY = 'vts.token';
let memToken: string | null = null;
export const session = {
  token: () => { try { return localStorage.getItem(KEY) ?? memToken; } catch { return memToken; } },
  setToken: (t: string | null) => { memToken = t; try { t === null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, t); } catch { /* memory only */ } },
};

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = session.token();
  if (t) headers.authorization = `Bearer ${t}`;
  let body: string | undefined;
  if (opts.body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.body); }
  const r = await fetch(`/api${path}`, { method: opts.method ?? (body ? 'POST' : 'GET'), headers, body });
  if (r.status === 401 && t) { session.setToken(null); location.href = '/login'; }
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try { const j = await r.json(); msg = j.error ?? msg; if (Array.isArray(j.details)) msg += ': ' + j.details.map((d: any) => `${d.path?.join('.')} ${d.message}`).join('; '); } catch { /* not json */ }
    throw new ApiError(r.status, msg);
  }
  const ct = r.headers.get('content-type') ?? '';
  return (ct.includes('json') ? r.json() : r.text()) as Promise<T>;
}
export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body: body ?? {} });
export const patch = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
