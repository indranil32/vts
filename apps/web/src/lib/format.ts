export const utc = (d?: string | Date | null, sec = false) => d ? new Date(d).toISOString().slice(11, sec ? 19 : 16) + 'Z' : '—';
export const utcDate = (d?: string | Date | null) => d ? new Date(d).toISOString().slice(5, 16).replace('T', ' ') + 'Z' : '—';
export const ago = (d?: string | Date | null) => {
  if (!d) return '—';
  const s = Math.max(0, (Date.now() - new Date(d).getTime()) / 1000);
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`;
};
export const human = (s?: string | null) => (s ?? '').replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
export const latlon = (lat: number, lon: number) => {
  const f = (v: number, p: string, n: string, w: number) => { const a = Math.abs(v); const d = Math.floor(a); return `${String(d).padStart(w, '0')}°${((a - d) * 60).toFixed(3).padStart(6, '0')}'${v >= 0 ? p : n}`; };
  return `${f(lat, 'N', 'S', 2)} ${f(lon, 'E', 'W', 3)}`;
};

export const STATUS_COLOR: Record<string, string> = {
  INBOUND: '#22d3ee', OUTBOUND: '#a78bfa', AT_ANCHOR: '#fbbf24', BERTHED: '#34d399', IN_AREA: '#94a3b8', APPROACHING: '#60a5fa', LEFT_AREA: '#475569',
};
export const SEV_COLOR: Record<string, string> = { ALARM: 'text-red-400', WARNING: 'text-amber-300', INFO: 'text-sky-300' };
export const ZONE_STYLE: Record<string, { color: string; fill: string; fillOpacity: number; dash?: string; weight?: number }> = {
  LAND: { color: '#2b3a2e', fill: '#1f2b23', fillOpacity: 1, weight: 1 },
  VTS_AREA: { color: '#38bdf8', fill: '#38bdf8', fillOpacity: 0, dash: '8 6', weight: 1.5 },
  FAIRWAY: { color: '#e2e8f0', fill: '#e2e8f0', fillOpacity: 0.04, dash: '4 4' },
  ANCHORAGE: { color: '#fbbf24', fill: '#fbbf24', fillOpacity: 0.05, dash: '6 4' },
  PILOT_BOARDING: { color: '#f472b6', fill: '#f472b6', fillOpacity: 0.06 },
  RESTRICTED: { color: '#ef4444', fill: '#ef4444', fillOpacity: 0.1, dash: '2 4' },
  BERTH: { color: '#34d399', fill: '#34d399', fillOpacity: 0.12 },
  PRECAUTIONARY: { color: '#a78bfa', fill: '#a78bfa', fillOpacity: 0.04, dash: '3 5' },
};
