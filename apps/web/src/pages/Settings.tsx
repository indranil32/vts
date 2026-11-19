import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, patch, post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Btn, Field, Pill, inputCls, useToast } from '../components/ui';
import { human, utcDate } from '../lib/format';

const TH: [string, string][] = [
  ['cpaNm', 'CPA alarm (nm)'], ['tcpaMin', 'TCPA window (min)'], ['cpaRangeNm', 'CPA check range (nm)'],
  ['aisLostMin', 'AIS lost after (min)'], ['anchorRadiusNm', 'Anchor watch radius (nm)'], ['unknownVesselMinLength', 'Unknown-vessel min LOA (m)'],
];

export default function Settings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const s = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings') });
  const zones = useQuery({ queryKey: ['zones'], queryFn: () => api('/zones') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api('/users'), enabled: can('VTS_ADMIN') });
  const clearances = useQuery({ queryKey: ['clearances'], queryFn: () => api('/clearances') });
  const [th, setTh] = useState<Record<string, number>>({});
  useEffect(() => { if (s.data) setTh(s.data.thresholds); }, [s.data]);
  const save = useMutation({ mutationFn: () => patch('/settings/thresholds', th), onSuccess: () => { toast('Thresholds saved'); qc.invalidateQueries({ queryKey: ['settings'] }); }, onError: (e: any) => toast(e.message, 'err') });
  const zone = useMutation({ mutationFn: ({ id, body }: { id: string; body: any }) => patch(`/zones/${id}`, body), onSuccess: () => qc.invalidateQueries({ queryKey: ['zones'] }), onError: (e: any) => toast(e.message, 'err') });
  const revoke = useMutation({ mutationFn: (id: string) => post(`/clearances/${id}/revoke`), onSuccess: () => qc.invalidateQueries({ queryKey: ['clearances'] }), onError: (e: any) => toast(e.message, 'err') });
  const sup = can('VTS_SUPERVISOR');
  const ais = s.data?.ais;

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mx-auto grid max-w-6xl gap-5 lg:grid-cols-2">
        <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">Alert thresholds</h2>
          <div className="grid grid-cols-2 gap-3">
            {TH.map(([k, label]) => <Field key={k} label={label}><input type="number" step="0.01" disabled={!sup} className={inputCls} value={th[k] ?? ''} onChange={(e) => setTh({ ...th, [k]: Number(e.target.value) })} /></Field>)}
          </div>
          {sup && <div className="mt-3"><Btn variant="primary" onClick={() => save.mutate()}>Save thresholds</Btn></div>}
        </section>
        <section className="rounded-lg border border-ink-700 bg-ink-900 p-4">
          <h2 className="mb-3 text-sm font-semibold">AIS input</h2>
          {ais && <div className="space-y-1 text-xs">
            <div>Source <b>{ais.type}</b> {ais.connected ? <Pill color="green">connected</Pill> : <Pill color="red">down</Pill>}</div>
            <div className="text-slate-400">{ais.detail}</div>
            <div className="text-slate-400">{ais.messages} messages · {ais.decodeErrors} decode errors · last {ais.lastMessageAt ? utcDate(ais.lastMessageAt) : '—'}</div>
          </div>}
          <p className="mt-3 text-[11px] text-slate-500">Configured with <code>AIS_SOURCE</code>: <code>NMEA_TCP</code> / <code>NMEA_UDP</code> for an AIS base station or network feed (AIVDM), <code>PROVIDER</code> for a commercial AIS data API, <code>SIMULATOR</code> for demo traffic.</p>
        </section>
        <section className="rounded-lg border border-ink-700 bg-ink-900 p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Zones</h2>
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-1">Name</th><th>Type</th><th>Speed limit (kn)</th><th>Charted depth (m)</th><th>PCS berth</th><th>Active</th></tr></thead>
            <tbody>{(zones.data ?? []).map((z: any) => (
              <tr key={z.id} className="border-t border-ink-800">
                <td className="py-1.5">{z.name}</td><td><Pill>{human(z.type)}</Pill></td>
                <td><input type="number" disabled={!sup} className={inputCls + ' w-20 py-0.5'} defaultValue={z.max_speed ?? ''} onBlur={(e) => e.target.value !== String(z.max_speed ?? '') && zone.mutate({ id: z.id, body: { maxSpeed: e.target.value ? Number(e.target.value) : null } })} /></td>
                <td><input type="number" disabled={!sup} className={inputCls + ' w-20 py-0.5'} defaultValue={z.min_depth ?? ''} onBlur={(e) => e.target.value !== String(z.min_depth ?? '') && zone.mutate({ id: z.id, body: { minDepth: e.target.value ? Number(e.target.value) : null } })} /></td>
                <td>{z.pcs_berth_code ?? '—'}</td>
                <td><input type="checkbox" disabled={!sup} checked={z.active} onChange={(e) => zone.mutate({ id: z.id, body: { active: e.target.checked } })} /></td>
              </tr>
            ))}</tbody>
          </table>
        </section>
        <section className="rounded-lg border border-ink-700 bg-ink-900 p-4 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold">Traffic clearances</h2>
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="py-1">Issued</th><th>Vessel</th><th>Clearance</th><th>Valid until</th><th>By</th><th>Status</th><th /></tr></thead>
            <tbody>{(clearances.data ?? []).map((c: any) => (
              <tr key={c.id} className="border-t border-ink-800">
                <td className="py-1.5 font-mono">{utcDate(c.created_at)}</td><td>{c.vessel_name ?? c.mmsi}</td><td>{human(c.type)}{c.remarks ? <span className="text-slate-500"> — {c.remarks}</span> : null}</td>
                <td className="font-mono">{utcDate(c.valid_until)}</td><td>{c.issued_by_name}</td>
                <td><Pill color={c.status === 'ACTIVE' ? 'green' : 'slate'}>{c.status}</Pill></td>
                <td>{c.status === 'ACTIVE' && can('VTS_OPERATOR', 'VTS_SUPERVISOR') && <Btn variant="ghost" onClick={() => revoke.mutate(c.id)}>Revoke</Btn>}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
        {users.data && (
          <section className="rounded-lg border border-ink-700 bg-ink-900 p-4 lg:col-span-2">
            <h2 className="mb-3 text-sm font-semibold">Users</h2>
            <table className="w-full text-xs"><tbody>{users.data.map((u: any) => (
              <tr key={u.id} className="border-t border-ink-800"><td className="py-1.5">{u.name}</td><td className="text-slate-400">{u.email}</td><td>{u.roles.map((r: string) => <Pill key={r} color="cyan" className="mr-1">{human(r)}</Pill>)}</td><td className="text-slate-500">{u.last_login_at ? `last login ${utcDate(u.last_login_at)}` : 'never signed in'}</td></tr>
            ))}</tbody></table>
          </section>
        )}
      </div>
    </div>
  );
}
