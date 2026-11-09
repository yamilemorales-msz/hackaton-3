import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { MessagePage, Splash, buttonClass } from './ui';

/** Rutas privadas: sin sesión va al login y, al entrar, vuelve a la misma ruta con su query string. */
export function RequireAuth() {
  const { status, retryRestore } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <Splash label="Verificando sesión…" />;
  if (status === 'error') {
    return (
      <main className="mx-auto flex min-h-full max-w-xl flex-col items-start justify-center gap-4 p-8">
        <h1 className="text-2xl font-semibold">No se pudo restaurar la sesión</h1>
        <p className="text-slate-300">Hubo un problema de conexión con Lumon.</p>
        <button type="button" className={buttonClass} onClick={retryRestore}>
          Reintentar
        </button>
      </main>
    );
  }
  if (status === 'anon') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return <Outlet />;
}

/** Abrir por URL una ruta sin el permiso muestra "sin permiso", no un error. */
export function RequirePermission({ permission }: { permission: string }) {
  const { can } = useAuth();
  if (!can(permission)) {
    return (
      <MessagePage title="Sin permiso">
        <p>
          Tu rol no tiene el permiso <code className="rounded bg-slate-800 px-1">{permission}</code> necesario para
          ver esta sección.
        </p>
      </MessagePage>
    );
  }
  return <Outlet />;
}
