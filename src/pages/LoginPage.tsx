import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, Splash, buttonClass, inputClass } from '../components/ui';
import { errorMessage } from '../lib/api';

/** Solo se aceptan destinos internos, para no redirigir a otro sitio. */
export function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/files';
}

export default function LoginPage() {
  const { status, notice, login } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'loading') return <Splash label="Verificando sesión…" />;
  if (status === 'authed') return <Navigate to={next} replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    login(email.trim(), password)
      .catch((err: unknown) => {
        setError(errorMessage(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const nextQuery = params.get('next') ? `?next=${encodeURIComponent(next)}` : '';

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-5 p-6">
      <h1 className="text-2xl font-semibold">Entrar al piso</h1>
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="login-email" className="text-sm">
            Correo
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            required
            className={inputClass}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="login-password" className="text-sm">
            Contraseña
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <button type="submit" className={buttonClass} disabled={busy || !email || !password}>
          {busy ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </form>
      <p className="text-sm text-slate-300">
        ¿Cuadrilla nueva?{' '}
        <Link to={`/register${nextQuery}`} className="text-sky-300 underline">
          Registrar cuadrilla
        </Link>
      </p>
    </main>
  );
}
