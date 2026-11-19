import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Radar } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Btn, Field, inputCls } from '../components/ui';

export default function Login() {
  const { me, login } = useAuth();
  const [email, setEmail] = useState('harbour@vts.demo');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to="/" replace />;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await login(email, password); } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <div className="flex h-full items-center justify-center bg-[radial-gradient(ellipse_at_center,#0f2338_0%,#070b14_70%)]">
      <form onSubmit={submit} className="w-80 space-y-4 rounded-lg border border-ink-700 bg-ink-900 p-6 shadow-2xl">
        <div className="flex items-center gap-2"><Radar className="text-cyan-400" /><div><div className="font-semibold text-slate-100">Vessel Traffic Service</div><div className="text-[11px] text-slate-500">Operator console</div></div></div>
        <Field label="Email"><input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" /></Field>
        <Field label="Password"><input type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></Field>
        {err && <div className="text-xs text-red-400">{err}</div>}
        <Btn variant="primary" className="w-full justify-center py-2" disabled={busy}>Sign in</Btn>
        <div className="text-[10px] leading-relaxed text-slate-500">Demo users: harbour@vts.demo (harbour master), operator@vts.demo, viewer@vts.demo, admin@vts.demo</div>
      </form>
    </div>
  );
}
