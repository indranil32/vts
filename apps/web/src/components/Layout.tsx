import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Radar, History, Settings, LogOut, Radio, Link2, Siren } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return <span className="num font-mono text-sm text-slate-100">{now.toISOString().slice(11, 19)}<span className="text-slate-500">Z</span></span>;
}

export function Layout() {
  const { me, logout } = useAuth();
  const stats = useQuery({ queryKey: ['stats'], queryFn: () => api('/stats'), refetchInterval: 5000 });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings'), refetchInterval: 15000 });
  const pcs = useQuery({ queryKey: ['pcs-lite'], queryFn: () => api('/pcs/status'), refetchInterval: 15000 });
  const s = stats.data ?? {};
  const ais = settings.data?.ais;
  const nav = (to: string, Icon: any, label: string) => (
    <NavLink to={to} end className={({ isActive }) => clsx('flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium', isActive ? 'bg-ink-700 text-cyan-300' : 'text-slate-400 hover:text-slate-200')}>
      <Icon size={14} />{label}
    </NavLink>
  );
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-4 border-b border-ink-700 bg-ink-900 px-3">
        <div className="flex items-center gap-2">
          <Radar size={18} className="text-cyan-400" />
          <div className="leading-tight"><div className="text-[13px] font-semibold text-slate-100">{me?.centre.name ?? 'VTS Centre'}</div><div className="text-[10px] text-slate-500">{me?.centre.vhf}</div></div>
        </div>
        <nav className="flex gap-1">{nav('/', Radar, 'Traffic')}{nav('/replay', History, 'Replay')}{nav('/settings', Settings, 'Settings')}</nav>
        <div className="ml-2 flex items-center gap-3 text-[11px] text-slate-400">
          <span>In area <b className="num text-slate-100">{s.in_area ?? '–'}</b></span>
          <span>Under way <b className="num text-cyan-300">{s.under_way ?? '–'}</b></span>
          <span>Anchored <b className="num text-amber-300">{s.at_anchor ?? '–'}</b></span>
          <span>Berthed <b className="num text-emerald-300">{s.berthed ?? '–'}</b></span>
          <span>Expected 24h <b className="num text-sky-300">{s.expected_24h ?? '–'}</b></span>
          {s.alarms > 0 && <span className="flex items-center gap-1 rounded bg-red-500/20 px-1.5 py-0.5 font-semibold text-red-300 blink"><Siren size={12} />{s.alarms} ALARM{s.alarms > 1 ? 'S' : ''}</span>}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className={clsx('flex items-center gap-1 text-[11px]', ais?.connected ? 'text-emerald-400' : 'text-red-400')} title={ais?.detail}><Radio size={12} />AIS {ais?.type ?? ''}</span>
          <span className={clsx('flex items-center gap-1 text-[11px]', !pcs.data?.enabled ? 'text-slate-500' : pcs.data?.lastError ? 'text-amber-400' : 'text-emerald-400')} title={pcs.data?.lastError ?? pcs.data?.url ?? 'PCS not configured'}>
            <Link2 size={12} />PCS {!pcs.data?.enabled ? 'off' : pcs.data?.lastError ? 'degraded' : 'linked'}
          </span>
          <Clock />
          <span className="text-[11px] text-slate-400">{me?.user.name}</span>
          <button onClick={logout} className="text-slate-500 hover:text-slate-200" title="Sign out"><LogOut size={15} /></button>
        </div>
      </header>
      <main className="min-h-0 flex-1"><Outlet /></main>
    </div>
  );
}
