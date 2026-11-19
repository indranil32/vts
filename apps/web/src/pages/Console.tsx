// Main operator console: live traffic image + alerts / traffic list / PCS port calls / VTS log.
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Check, X, Ship, Anchor, Radio, FileCheck2, Send, Tag, Crosshair, RefreshCw } from 'lucide-react';
import { CLEARANCE_TYPES, type LatLon } from '@vts/shared';
import TrafficMap from '../components/TrafficMap';
import { api, post } from '../lib/api';
import { useAuth, OPS } from '../lib/auth';
import { utc, utcDate, ago, human, latlon, STATUS_COLOR, SEV_COLOR } from '../lib/format';
import { Btn, Pill, Modal, Field, inputCls, useToast } from '../components/ui';

type Tab = 'alerts' | 'traffic' | 'pcs' | 'log';
const PCS_COLOR: Record<string, string> = { ARRIVAL_CLEARED: 'green', ARRIVED: 'cyan', BERTHED: 'green', DEPARTURE_CLEARED: 'violet', DEPARTURE_REQUESTED: 'amber', PRE_ARRIVAL_SUBMITTED: 'amber', BERTH_ALLOCATED: 'sky', DEPARTED: 'slate' };

export default function Console() {
  const { me, can } = useAuth();
  const [tab, setTab] = useState<Tab>('alerts');
  const [params] = useSearchParams();
  const [sel, setSel] = useState<string | null>(params.get('mmsi'));
  const [labels, setLabels] = useState(true);
  const picture = useQuery({ queryKey: ['picture'], queryFn: () => api('/picture'), refetchInterval: 3000 });
  const zones = useQuery({ queryKey: ['zones'], queryFn: () => api('/zones'), staleTime: 60_000 });
  const points = useQuery({ queryKey: ['points'], queryFn: () => api('/reporting-points'), staleTime: 60_000 });
  const vessel = useQuery({ queryKey: ['vessel', sel], queryFn: () => api(`/vessels/${sel}`), enabled: !!sel, refetchInterval: 4000 });
  const targets = picture.data?.targets ?? [];
  const center = (me?.centre.center ?? [0.02, 0.09]) as LatLon;

  return (
    <div className="flex h-full">
      <div className="relative min-w-0 flex-1">
        <TrafficMap targets={targets} zones={zones.data ?? []} points={points.data ?? []} selected={sel} onSelect={setSel} track={vessel.data?.track} center={center} zoom={me?.centre.zoom ?? 13} labels={labels} />
        <div className="absolute left-12 top-3 z-[500] flex gap-1">
          <Btn variant="default" onClick={() => setLabels(!labels)} className={clsx(!labels && 'opacity-60')}><Tag size={12} />Labels</Btn>
        </div>
        <Legend />
        {sel && vessel.data && <VesselCard v={vessel.data} onClose={() => setSel(null)} canAct={can(...OPS)} />}
      </div>
      <aside className="flex w-[420px] shrink-0 flex-col border-l border-ink-700 bg-ink-900">
        <div className="flex border-b border-ink-700">
          {(['alerts', 'traffic', 'pcs', 'log'] as Tab[]).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={clsx('flex-1 py-2 text-xs font-semibold uppercase tracking-wide', tab === t ? 'border-b-2 border-cyan-400 text-cyan-300' : 'text-slate-500 hover:text-slate-300')}>
              {t === 'pcs' ? 'Port calls' : t}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {tab === 'alerts' && <Alerts onSelect={setSel} canAct={can(...OPS)} />}
          {tab === 'traffic' && <Traffic targets={targets} sel={sel} onSelect={setSel} />}
          {tab === 'pcs' && <PortCalls onSelect={setSel} targets={targets} canAct={can(...OPS)} />}
          {tab === 'log' && <Log canAct={can(...OPS)} onSelect={setSel} />}
        </div>
      </aside>
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-6 left-3 z-[500] rounded border border-ink-700 bg-ink-900/90 px-2.5 py-2 text-[10px] text-slate-400">
      {Object.entries(STATUS_COLOR).filter(([k]) => k !== 'LEFT_AREA').map(([k, c]) => (
        <div key={k} className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />{human(k)}</div>
      ))}
      <div className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-red-400" />Alert</div>
      <div className="mt-1 text-slate-500">Vectors: 6 min</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: any }) {
  return <div className="flex justify-between gap-2 py-0.5"><span className="text-slate-500">{k}</span><span className="num text-right text-slate-200">{v ?? '—'}</span></div>;
}

function VesselCard({ v, onClose, canAct }: { v: any; onClose: () => void; canAct: boolean }) {
  const [modal, setModal] = useState<null | 'clearance' | 'log' | 'movement'>(null);
  const pcs = v.pcsCall;
  return (
    <div className="absolute right-3 top-3 z-[600] w-[340px] rounded-lg border border-ink-600 bg-ink-900/95 shadow-2xl backdrop-blur">
      <div className="flex items-start justify-between border-b border-ink-700 px-3 py-2">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100"><Ship size={14} className="text-cyan-400" />{v.name ?? `MMSI ${v.mmsi}`}</div>
          <div className="text-[11px] text-slate-500">MMSI {v.mmsi}{v.imo ? ` · IMO ${v.imo}` : ''}{v.call_sign ? ` · ${v.call_sign}` : ''} · {human(v.ship_type_text) || 'Unknown type'}</div>
        </div>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X size={15} /></button>
      </div>
      <div className="grid grid-cols-2 gap-x-4 px-3 py-2 text-[11px]">
        <Row k="Status" v={<span style={{ color: STATUS_COLOR[v.traffic_status] }}>{human(v.traffic_status)}</span>} />
        <Row k="Nav" v={human(v.nav_status)} />
        <Row k="SOG" v={v.sog != null ? `${Number(v.sog).toFixed(1)} kn` : null} />
        <Row k="COG" v={v.cog != null ? `${Number(v.cog).toFixed(0)}°` : null} />
        <Row k="LOA × B" v={v.length ? `${Number(v.length)} × ${Number(v.beam ?? 0)} m` : null} />
        <Row k="Draught" v={v.draught ? `${Number(v.draught)} m` : null} />
        <Row k="Last AIS" v={v.at ? `${ago(v.at)} ago` : null} />
        <Row k="Dest." v={v.destination} />
      </div>
      {v.lat != null && <div className="px-3 pb-1 font-mono text-[10px] text-slate-500">{latlon(v.lat, v.lon)} · {(v.zones ?? []).filter((z: string) => z !== 'VTS_AREA').join(', ') || 'open water'}</div>}
      <div className="mx-3 my-2 rounded border border-ink-700 bg-ink-850 p-2 text-[11px]">
        <div className="mb-1 flex items-center justify-between"><span className="font-semibold uppercase tracking-wide text-slate-400">Port Community System</span>{pcs && <Pill color={PCS_COLOR[pcs.status] ?? 'slate'}>{human(pcs.status)}</Pill>}</div>
        {pcs ? (
          <>
            <Row k="Call" v={pcs.call_no} />
            <Row k="Agent" v={pcs.agent_name} />
            <Row k="Berth" v={pcs.berth_code} />
            <Row k="ETA / ETD" v={`${utcDate(pcs.eta)} / ${utcDate(pcs.etd)}`} />
            <Row k="Entry permit" v={pcs.entry_permit_no ?? <span className="text-amber-300">not issued</span>} />
            <Row k="Departure clearance" v={pcs.departure_clearance_no ?? '—'} />
            {pcs.dangerous_goods && <div className="mt-1"><Pill color="red">Dangerous goods on board</Pill></div>}
          </>
        ) : <div className="text-slate-500">No port call for this vessel.</div>}
      </div>
      {v.alerts?.filter((a: any) => ['OPEN', 'ACKNOWLEDGED'].includes(a.status)).map((a: any) => (
        <div key={a.id} className={clsx('mx-3 mb-1 flex items-start gap-1.5 text-[11px]', SEV_COLOR[a.severity])}><AlertTriangle size={12} className="mt-0.5 shrink-0" />{a.message}</div>
      ))}
      {canAct && (
        <div className="flex flex-wrap gap-1.5 border-t border-ink-700 px-3 py-2">
          <Btn variant="primary" onClick={() => setModal('clearance')}><FileCheck2 size={12} />Clearance</Btn>
          <Btn onClick={() => setModal('log')}><Radio size={12} />Log VHF</Btn>
          {pcs && <Btn onClick={() => setModal('movement')}><Send size={12} />Report to PCS</Btn>}
        </div>
      )}
      {v.log?.length > 0 && (
        <div className="max-h-36 overflow-y-auto border-t border-ink-700 px-3 py-2 text-[11px]">
          {v.log.slice(0, 12).map((l: any) => <div key={l.id} className="flex gap-2 py-0.5"><span className="num shrink-0 font-mono text-slate-500">{utc(l.at)}</span><span className="text-slate-300">{l.text}</span></div>)}
        </div>
      )}
      {modal === 'clearance' && <ClearanceModal mmsi={v.mmsi} onClose={() => setModal(null)} />}
      {modal === 'log' && <LogModal mmsi={v.mmsi} onClose={() => setModal(null)} />}
      {modal === 'movement' && pcs && <MovementModal call={pcs} onClose={() => setModal(null)} />}
    </div>
  );
}

function ClearanceModal({ mmsi, onClose }: { mmsi: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [type, setType] = useState<string>('ENTER_FAIRWAY');
  const [valid, setValid] = useState(60);
  const [remarks, setRemarks] = useState('');
  const m = useMutation({
    mutationFn: () => post('/clearances', { mmsi, type, validMinutes: valid, remarks: remarks || undefined }),
    onSuccess: (r) => { r.warnings?.length ? toast(`Issued with warning: ${r.warnings.join('; ')}`, 'warn') : toast('Clearance issued'); qc.invalidateQueries(); onClose(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  return (
    <Modal title="Issue traffic clearance" onClose={onClose}>
      <Field label="Clearance"><select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>{CLEARANCE_TYPES.map((t) => <option key={t} value={t}>{human(t)}</option>)}</select></Field>
      <Field label="Valid for (minutes)"><input type="number" className={inputCls} value={valid} min={5} max={1440} onChange={(e) => setValid(Number(e.target.value))} /></Field>
      <Field label="Remarks / instructions"><textarea className={inputCls} rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. proceed via RP2, pilot on board at 0.5 nm" /></Field>
      <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={m.isPending} onClick={() => m.mutate()}>Issue</Btn></div>
    </Modal>
  );
}

function LogModal({ mmsi, onClose }: { mmsi?: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [category, setCategory] = useState('VHF');
  const [text, setText] = useState('');
  const m = useMutation({
    mutationFn: () => post('/log', { category, text, mmsi }),
    onSuccess: () => { toast('Logged'); qc.invalidateQueries(); onClose(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  return (
    <Modal title="VTS log entry" onClose={onClose}>
      <Field label="Category"><select className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)}>{['VHF', 'INSTRUCTION', 'INCIDENT', 'NOTE'].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Entry"><textarea className={inputCls} rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Ch 12: vessel reports pilot on board, ETA berth 1430Z" /></Field>
      <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={text.length < 2 || m.isPending} onClick={() => m.mutate()}>Save</Btn></div>
    </Modal>
  );
}

function MovementModal({ call, onClose }: { call: any; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const next = call.status === 'ARRIVAL_CLEARED' ? 'arrived' : call.status === 'ARRIVED' ? 'berthed' : call.status === 'DEPARTURE_CLEARED' ? 'departed' : 'arrived';
  const [action, setAction] = useState(next);
  const [at, setAt] = useState(new Date().toISOString().slice(0, 16));
  const m = useMutation({
    mutationFn: () => post('/pcs/movement', { callId: call.id, action, at: new Date(at + 'Z').toISOString() }),
    onSuccess: (r) => { r?.sent_at ? toast(`Reported to PCS: ${action}`) : toast(`Queued; PCS said: ${r?.last_error ?? 'pending'}`, 'warn'); qc.invalidateQueries(); onClose(); },
    onError: (e: any) => toast(e.message, 'err'),
  });
  return (
    <Modal title={`Report movement — ${call.call_no}`} onClose={onClose}>
      <p className="text-xs text-slate-400">Movements are normally reported automatically from AIS. Use this to report or correct a time manually.</p>
      <Field label="Movement"><select className={inputCls} value={action} onChange={(e) => setAction(e.target.value)}><option value="arrived">Arrived (ATA)</option><option value="berthed">All fast (berthed)</option><option value="departed">Departed (ATD)</option></select></Field>
      <Field label="Time (UTC)"><input type="datetime-local" className={inputCls} value={at} onChange={(e) => setAt(e.target.value)} /></Field>
      <div className="flex justify-end gap-2"><Btn variant="ghost" onClick={onClose}>Cancel</Btn><Btn variant="primary" disabled={m.isPending} onClick={() => m.mutate()}>Send to PCS</Btn></div>
    </Modal>
  );
}

function Alerts({ onSelect, canAct }: { onSelect: (m: string) => void; canAct: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [showAll, setShowAll] = useState(false);
  const q = useQuery({ queryKey: ['alerts', showAll], queryFn: () => api(`/alerts?${showAll ? 'limit=100' : 'status=OPEN,ACKNOWLEDGED'}`), refetchInterval: 3000 });
  const act = useMutation({ mutationFn: ({ id, a }: { id: string; a: 'ack' | 'close' }) => post(`/alerts/${id}/${a}`), onSuccess: () => qc.invalidateQueries({ queryKey: ['alerts'] }), onError: (e: any) => toast(e.message, 'err') });
  const rows = q.data ?? [];
  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-slate-500">
        <span>{rows.filter((a: any) => a.status === 'OPEN').length} open · {rows.filter((a: any) => a.status === 'ACKNOWLEDGED').length} acknowledged</span>
        <label className="flex items-center gap-1"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />History</label>
      </div>
      {rows.length === 0 && <div className="px-3 py-8 text-center text-slate-500">No active alerts</div>}
      {rows.map((a: any) => (
        <div key={a.id} className={clsx('border-b border-ink-800 px-3 py-2', a.status === 'OPEN' && a.severity === 'ALARM' && 'bg-red-500/10')}>
          <div className="flex items-center gap-2">
            <AlertTriangle size={13} className={clsx(SEV_COLOR[a.severity], a.status === 'OPEN' && a.severity === 'ALARM' && 'blink')} />
            <span className={clsx('text-[10px] font-bold uppercase', SEV_COLOR[a.severity])}>{human(a.type)}</span>
            <span className="num ml-auto font-mono text-[10px] text-slate-500">{utc(a.raised_at)}</span>
            <Pill color={a.status === 'OPEN' ? 'red' : a.status === 'ACKNOWLEDGED' ? 'amber' : 'slate'}>{human(a.status)}</Pill>
          </div>
          <button className="mt-1 text-left text-xs text-slate-200 hover:text-cyan-300" onClick={() => a.mmsi && onSelect(a.mmsi.trim())}>{a.message}</button>
          {a.ack_by_name && <div className="text-[10px] text-slate-500">Ack {a.ack_by_name} {utc(a.ack_at)}{a.ack_note ? ` — ${a.ack_note}` : ''}</div>}
          {canAct && ['OPEN', 'ACKNOWLEDGED'].includes(a.status) && (
            <div className="mt-1.5 flex gap-1.5">
              {a.status === 'OPEN' && <Btn onClick={() => act.mutate({ id: a.id, a: 'ack' })}><Check size={12} />Acknowledge</Btn>}
              <Btn variant="ghost" onClick={() => act.mutate({ id: a.id, a: 'close' })}><X size={12} />Close</Btn>
              {a.mmsi && <Btn variant="ghost" onClick={() => onSelect(a.mmsi.trim())}><Crosshair size={12} />Locate</Btn>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Traffic({ targets, sel, onSelect }: { targets: any[]; sel: string | null; onSelect: (m: string) => void }) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => {
    const order = ['INBOUND', 'OUTBOUND', 'AT_ANCHOR', 'BERTHED', 'IN_AREA', 'APPROACHING', 'LEFT_AREA'];
    const f = filter.toLowerCase();
    const list = targets.filter((t) => !f || (t.name ?? '').toLowerCase().includes(f) || t.mmsi.includes(f));
    return order.map((s) => [s, list.filter((t) => (t.traffic_status ?? 'IN_AREA') === s)] as const).filter(([, l]) => l.length);
  }, [targets, filter]);
  return (
    <div>
      <div className="p-2"><input className={inputCls} placeholder="Filter by name or MMSI" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
      {groups.map(([s, list]) => (
        <div key={s}>
          <div className="sticky top-0 bg-ink-850 px-3 py-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: STATUS_COLOR[s] }}>{human(s)} · {list.length}</div>
          {list.map((t) => (
            <button key={t.mmsi} onClick={() => onSelect(t.mmsi)} className={clsx('flex w-full items-center gap-2 border-b border-ink-800 px-3 py-1.5 text-left hover:bg-ink-800', sel === t.mmsi && 'bg-ink-800')}>
              {t.traffic_status === 'AT_ANCHOR' ? <Anchor size={12} className="text-amber-300" /> : <Ship size={12} className="text-slate-400" />}
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-slate-100">{t.name ?? `MMSI ${t.mmsi}`} {t.open_alerts > 0 && <AlertTriangle size={11} className="inline text-red-400" />}</div>
                <div className="text-[10px] text-slate-500">{human(t.ship_type_text) || '—'}{t.call_no ? ` · ${t.call_no}` : ''}</div>
              </div>
              <div className="num text-right font-mono text-[10px] text-slate-400">{Number(t.sog ?? 0).toFixed(1)} kn<br />{t.cog != null ? `${Number(t.cog).toFixed(0)}°` : ''}</div>
              {t.pcs_status && <Pill color={PCS_COLOR[t.pcs_status] ?? 'slate'}>{human(t.pcs_status).slice(0, 14)}</Pill>}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function PortCalls({ onSelect, targets, canAct }: { onSelect: (m: string) => void; targets: any[]; canAct: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['pcs'], queryFn: () => api('/pcs/status'), refetchInterval: 8000 });
  const sync = useMutation({ mutationFn: () => post('/pcs/sync'), onSuccess: () => { qc.invalidateQueries({ queryKey: ['pcs'] }); toast('Synchronised with PCS'); }, onError: (e: any) => toast(e.message, 'err') });
  const d = q.data;
  if (!d) return null;
  if (!d.enabled) return <div className="p-4 text-xs text-slate-400">The PCS link is not configured. Set <code>PCS_URL</code> and <code>PCS_API_KEY</code> to receive expected arrivals, entry permits and departure clearances, and to report movements automatically.</div>;
  const live = new Set(targets.map((t) => t.mmsi));
  return (
    <div>
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-slate-500">
        <span>Last sync {d.lastSync ? `${ago(d.lastSync)} ago` : 'never'}{d.lastError && <span className="text-amber-400"> · {d.lastError}</span>}</span>
        {canAct && <Btn variant="ghost" onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw size={12} />Sync</Btn>}
      </div>
      {d.calls.filter((c: any) => !['DEPARTED', 'CANCELLED'].includes(c.status)).map((c: any) => (
        <button key={c.id} onClick={() => c.mmsi && onSelect(c.mmsi)} className="block w-full border-b border-ink-800 px-3 py-2 text-left hover:bg-ink-800">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-100">{c.vessel_name}</span>
            {c.mmsi && live.has(c.mmsi) && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" title="On AIS" />}
            {c.dangerous_goods && <Pill color="red">DG</Pill>}
            <Pill color={PCS_COLOR[c.status] ?? 'slate'} className="ml-auto">{human(c.status)}</Pill>
          </div>
          <div className="mt-0.5 grid grid-cols-3 text-[10px] text-slate-500">
            <span>{c.call_no}</span><span>Berth {c.berth_code ?? '—'}</span><span className="text-right">ETA {utcDate(c.eta)}</span>
          </div>
          <div className="text-[10px] text-slate-500">Permit {c.entry_permit_no ?? '—'} · Dep. clearance {c.departure_clearance_no ?? '—'}</div>
        </button>
      ))}
      <div className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-slate-500">Movement reports to PCS</div>
      {d.outbox.length === 0 && <div className="px-3 pb-3 text-[11px] text-slate-500">None yet</div>}
      {d.outbox.map((o: any) => (
        <div key={o.id} className="flex items-center gap-2 px-3 py-1 text-[11px]">
          <span className="font-mono text-slate-500">{utc(o.at)}</span><span className="uppercase text-slate-300">{o.action}</span><span className="text-slate-400">{o.vessel_name}</span>
          <span className="ml-auto">{o.sent_at ? <Pill color="green">sent</Pill> : <Pill color="amber" className="max-w-[140px] truncate">{o.last_error ? 'retrying' : 'queued'}</Pill>}</span>
        </div>
      ))}
    </div>
  );
}

function Log({ canAct, onSelect }: { canAct: boolean; onSelect: (m: string) => void }) {
  const [cat, setCat] = useState('');
  const [modal, setModal] = useState(false);
  const q = useQuery({ queryKey: ['log', cat], queryFn: () => api(`/log?limit=300${cat ? `&category=${cat}` : ''}`), refetchInterval: 4000 });
  const CAT: Record<string, string> = { EVENT: 'slate', VHF: 'cyan', INSTRUCTION: 'violet', INCIDENT: 'red', CLEARANCE: 'green', PCS: 'sky', NOTE: 'amber' };
  return (
    <div>
      <div className="flex items-center gap-2 p-2">
        <select className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All entries</option>{Object.keys(CAT).map((c) => <option key={c}>{c}</option>)}</select>
        {canAct && <Btn variant="primary" onClick={() => setModal(true)}>New entry</Btn>}
      </div>
      {(q.data ?? []).map((l: any) => (
        <div key={l.id} className="flex gap-2 border-b border-ink-800 px-3 py-1.5 text-[11px]">
          <span className="num shrink-0 font-mono text-slate-500">{utc(l.at, true)}</span>
          <Pill color={CAT[l.category] ?? 'slate'} className="shrink-0">{l.category}</Pill>
          <span className="min-w-0 text-slate-300">
            {l.mmsi && <button className="mr-1 text-cyan-300 hover:underline" onClick={() => onSelect(l.mmsi.trim())}>{l.vessel_name ?? l.mmsi}</button>}
            {l.text}{l.author !== 'system' && <span className="text-slate-500"> — {l.author}</span>}
          </span>
        </div>
      ))}
      {modal && <LogModal onClose={() => setModal(false)} />}
    </div>
  );
}
