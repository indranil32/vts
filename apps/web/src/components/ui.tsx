import { createContext, useCallback, useContext, useState, type ReactNode, type ButtonHTMLAttributes } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';

export const Btn = ({ className, variant = 'default', ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost' }) => (
  <button {...p} className={clsx('inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition disabled:opacity-40 disabled:cursor-not-allowed',
    variant === 'primary' && 'bg-cyan-500 text-ink-950 hover:bg-cyan-400',
    variant === 'danger' && 'bg-red-500/90 text-white hover:bg-red-500',
    variant === 'default' && 'bg-ink-700 text-slate-200 hover:bg-ink-600',
    variant === 'ghost' && 'text-slate-400 hover:bg-ink-700 hover:text-slate-200', className)} />
);
export const Pill = ({ children, color = 'slate', className }: { children: ReactNode; color?: string; className?: string }) => {
  const c: Record<string, string> = {
    slate: 'bg-slate-500/15 text-slate-300', cyan: 'bg-cyan-500/15 text-cyan-300', green: 'bg-emerald-500/15 text-emerald-300', amber: 'bg-amber-500/15 text-amber-300',
    red: 'bg-red-500/20 text-red-300', violet: 'bg-violet-500/15 text-violet-300', sky: 'bg-sky-500/15 text-sky-300',
  };
  return <span className={clsx('inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', c[color] ?? c.slate, className)}>{children}</span>;
};
export const Field = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className="block"><span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</span>{children}</label>
);
export const inputCls = 'w-full rounded border border-ink-600 bg-ink-900 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-cyan-500';

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-lg border border-ink-600 bg-ink-850 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5"><h3 className="text-sm font-semibold">{title}</h3><button onClick={onClose} className="text-slate-500 hover:text-slate-200"><X size={16} /></button></div>
        <div className="space-y-3 p-4">{children}</div>
      </div>
    </div>
  );
}

const ToastCtx = createContext<(m: string, kind?: 'ok' | 'err' | 'warn') => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; m: string; kind: string }[]>([]);
  const push = useCallback((m: string, kind: 'ok' | 'err' | 'warn' = 'ok') => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, m, kind }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 5000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-[3000] -translate-x-1/2 space-y-2">
        {items.map((i) => <div key={i.id} className={clsx('rounded px-3 py-2 text-xs shadow-lg', i.kind === 'err' ? 'bg-red-600 text-white' : i.kind === 'warn' ? 'bg-amber-500 text-ink-950' : 'bg-emerald-600 text-white')}>{i.m}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
