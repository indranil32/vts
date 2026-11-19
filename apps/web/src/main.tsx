import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import './index.css';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './components/ui';
import { Layout } from './components/Layout';
import Login from './pages/Login';

const Console = lazy(() => import('./pages/Console'));
const Replay = lazy(() => import('./pages/Replay'));
const Settings = lazy(() => import('./pages/Settings'));

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 2_000, refetchOnWindowFocus: false, retry: 1 } } });
const Spinner = () => <div className="flex h-full items-center justify-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>;

function Protected() {
  const { me, loading } = useAuth();
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  return <Suspense fallback={<Spinner />}><Outlet /></Suspense>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<Protected />}>
                <Route element={<Layout />}>
                  <Route index element={<Console />} />
                  <Route path="replay" element={<Replay />} />
                  <Route path="settings" element={<Settings />} />
                </Route>
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
