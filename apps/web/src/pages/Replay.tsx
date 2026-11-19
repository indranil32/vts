// Incident replay: reconstruct the traffic image at any moment of a past window from the recorded tracks.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Pause, Search } from 'lucide-react';
import type { LatLon } from '@vts/shared';
import TrafficMap, { type Target } from '../components/TrafficMap';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Btn, Field, inputCls } from '../components/ui';
import { utc } from '../lib/format';

const iso = (d: Date) => d.toISOString().slice(0, 16);

export default function Replay() {
  const { me } = useAuth();
  const [from, setFrom] = useState(iso(new Date(Date.now() - 3600e3)));
  const [to, setTo] = useState(iso(new Date()));
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(30);
  const zones = useQuery({ queryKey: ['zones'], queryFn: () => api('/zones') });
  const points = useQuery({ queryKey: ['points'], queryFn: () => api('/reporting-points') });
  const data = useQuery({ queryKey: ['replay', range], queryFn: () => api(`/replay?from=${range!.from}&to=${range!.to}`), enabled: !!range });
  const log = useQuery({ queryKey: ['replay-log', range], queryFn: () => api('/log?limit=1000'), enabled: !!range });

  const start = range ? new Date(range.from).getTime() : 0;
  const end = range ? new Date(range.to).getTime() : 0;
  useEffect(() => { if (range) setT(start); }, [range]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!playing) return;
    const h = setInterval(() => setT((x) => { const n = x + 500 * speed; if (n >= end) { setPlaying(false); return end; } return n; }), 500);
    return () => clearInterval(h);
  }, [playing, speed, end]);

  const byVessel = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const p of data.data ?? []) { const k = p.mmsi.trim(); if (!m.has(k)) m.set(k, []); m.get(k)!.push({ ...p, ts: new Date(p.at).getTime() }); }
    return m;
  }, [data.data]);
  const targets: Target[] = useMemo(() => {
    const out: Target[] = [];
    for (const [mmsi, pts] of byVessel) {
      let last: any = null;
      for (const p of pts) { if (p.ts <= t) last = p; else break; }
      if (!last || t - last.ts > 10 * 60_000) continue;
      out.push({ mmsi, lat: last.lat, lon: last.lon, sog: Number(last.sog), cog: Number(last.cog), heading: null, name: last.name, ship_type_text: last.ship_type_text, traffic_status: Number(last.sog) >= 0.5 ? 'INBOUND' : 'IN_AREA' });
    }
    return out;
  }, [byVessel, t]);
  const events = (log.data ?? []).filter((l: any) => { const ts = new Date(l.at).getTime(); return ts <= t && ts > t - 15 * 60_000; }).slice(0, 15);

  return (
    <div className="flex h-full">
      <div className="relative flex-1"><TrafficMap targets={targets} zones={zones.data ?? []} points={points.data ?? []} center={(me?.centre.center ?? [0.02, 0.09]) as LatLon} zoom={me?.centre.zoom ?? 13} /></div>
      <aside className="w-[360px] space-y-3 border-l border-ink-700 bg-ink-900 p-3">
        <h2 className="text-sm font-semibold">Traffic replay</h2>
        <Field label="From (UTC)"><input type="datetime-local" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To (UTC, max 6 h)"><input type="datetime-local" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Btn variant="primary" onClick={() => setRange({ from: new Date(from + 'Z').toISOString(), to: new Date(to + 'Z').toISOString() })}><Search size={12} />Load</Btn>
        {data.error && <div className="text-xs text-red-400">{(data.error as Error).message}</div>}
        {range && data.data && (
          <>
            <div className="text-[11px] text-slate-500">{data.data.length} track points · {byVessel.size} vessels</div>
            <input type="range" min={start} max={end} step={1000} value={t} onChange={(e) => setT(Number(e.target.value))} className="w-full accent-cyan-400" />
            <div className="flex items-center gap-2">
              <Btn onClick={() => setPlaying(!playing)}>{playing ? <Pause size={12} /> : <Play size={12} />}{playing ? 'Pause' : 'Play'}</Btn>
              <select className={inputCls + ' w-24'} value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>{[10, 30, 60, 120].map((s) => <option key={s} value={s}>×{s}</option>)}</select>
              <span className="num ml-auto font-mono text-base text-cyan-300">{utc(new Date(t), true)}</span>
            </div>
            <div className="pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">Log (previous 15 min)</div>
            <div className="space-y-1 text-[11px]">{events.map((l: any) => <div key={l.id}><span className="font-mono text-slate-500">{utc(l.at, true)}</span> <span className="text-slate-300">{l.vessel_name ? `${l.vessel_name}: ` : ''}{l.text}</span></div>)}</div>
          </>
        )}
      </aside>
    </div>
  );
}
