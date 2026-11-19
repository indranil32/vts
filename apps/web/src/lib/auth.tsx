import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, post, session } from './api';

export interface Me { user: { sub: string; name: string; roles: string[] }; centre: { name?: string; portCode?: string; vhf?: string; center?: [number, number]; zoom?: number } }
const Ctx = createContext<{ me: Me | null; loading: boolean; login: (e: string, p: string) => Promise<void>; logout: () => void; can: (...r: string[]) => boolean }>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!session.token());
  const load = () => api<Me>('/auth/me').then(setMe).catch(() => setMe(null)).finally(() => setLoading(false));
  useEffect(() => { if (session.token()) load(); }, []);
  const login = async (email: string, password: string) => {
    const r = await post<{ token: string }>('/auth/login', { email, password });
    session.setToken(r.token);
    setLoading(true);
    await load();
  };
  const logout = () => { session.setToken(null); setMe(null); };
  const can = (...roles: string[]) => !!me && (me.user.roles.includes('VTS_ADMIN') || roles.some((r) => me.user.roles.includes(r)));
  return <Ctx.Provider value={{ me, loading, login, logout, can }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
export const OPS = ['VTS_OPERATOR', 'VTS_SUPERVISOR'];
