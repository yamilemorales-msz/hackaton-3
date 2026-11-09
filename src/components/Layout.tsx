import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ErrorBoundary } from './ErrorBoundary';
import { ghostButtonClass } from './ui';

interface NavItem {
  to: string;
  label: string;
  permission: string | null;
}

const NAV: NavItem[] = [
  { to: '/files', label: 'Archivos', permission: 'files:read' },
  { to: '/refiners', label: 'Expedientes', permission: 'refiners:read' },
  { to: '/incidents', label: 'Incidencias', permission: 'incidents:read' },
  { to: '/estado', label: 'Estado', permission: null },
];

export function Layout() {
  const { me, can, logout } = useAuth();
  const location = useLocation();
  const [leaving, setLeaving] = useState(false);

  const onLogout = (): void => {
    if (leaving) return;
    setLeaving(true);
    void logout().finally(() => {
      setLeaving(false);
    });
  };

  return (
    <div className="flex min-h-full flex-col">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:bg-slate-900 focus:p-2">
        Saltar al contenido
      </a>
      <header className="flex flex-wrap items-center gap-4 border-b border-slate-700 bg-slate-900 px-4 py-3">
        <span className="font-semibold tracking-wide text-sky-300">Consola MDR</span>
        <nav aria-label="Principal" className="flex flex-wrap gap-1">
          {NAV.filter((item) => item.permission === null || can(item.permission)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-slate-700 text-white' : 'text-slate-200 hover:bg-slate-800'}`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm text-slate-200">
          <span>
            {me?.team.code} · {me?.displayName || me?.email}
          </span>
          <button type="button" className={ghostButtonClass} onClick={onLogout} disabled={leaving}>
            {leaving ? 'Saliendo…' : 'Cerrar sesión'}
          </button>
        </div>
      </header>
      <main id="contenido" className="flex-1 p-4">
        <ErrorBoundary key={location.pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>
    </div>
  );
}
