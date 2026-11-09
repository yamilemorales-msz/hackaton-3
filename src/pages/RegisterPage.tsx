import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, Splash, buttonClass, inputClass } from '../components/ui';
import { errorMessage, fieldErrors } from '../lib/api';
import { safeNext } from './LoginPage';

export default function RegisterPage() {
  const { status, register } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [teamName, setTeamName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  if (status === 'loading') return <Splash label="Verificando sesión…" />;
  if (status === 'authed') return <Navigate to={next} replace />;

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setFields({});
    register({ teamName: teamName.trim(), email: email.trim(), password })
      .catch((err: unknown) => {
        const byField = fieldErrors(err);
        setFields(byField);
        if (Object.keys(byField).length === 0) setError(errorMessage(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  const teamError = fields.teamName ?? fields.name ?? fields.team;
  const emailError = fields.email;
  const passwordError = fields.password;

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-5 p-6">
      <h1 className="text-2xl font-semibold">Registrar cuadrilla</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="reg-team" className="text-sm">
            Nombre del equipo
          </label>
          <input
            id="reg-team"
            type="text"
            required
            className={inputClass}
            value={teamName}
            aria-invalid={teamError ? true : undefined}
            aria-describedby={teamError ? 'reg-team-error' : undefined}
            onChange={(event) => setTeamName(event.target.value)}
          />
          {teamError ? (
            <p id="reg-team-error" role="alert" className="text-sm text-red-300">
              {teamError}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reg-email" className="text-sm">
            Correo
          </label>
          <input
            id="reg-email"
            type="email"
            autoComplete="username"
            required
            className={inputClass}
            value={email}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? 'reg-email-error' : undefined}
            onChange={(event) => setEmail(event.target.value)}
          />
          {emailError ? (
            <p id="reg-email-error" role="alert" className="text-sm text-red-300">
              {emailError}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="reg-password" className="text-sm">
            Contraseña
          </label>
          <input
            id="reg-password"
            type="password"
            autoComplete="new-password"
            required
            className={inputClass}
            value={password}
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? 'reg-password-error' : undefined}
            onChange={(event) => setPassword(event.target.value)}
          />
          {passwordError ? (
            <p id="reg-password-error" role="alert" className="text-sm text-red-300">
              {passwordError}
            </p>
          ) : null}
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <button type="submit" className={buttonClass} disabled={busy || !teamName || !email || !password}>
          {busy ? 'Registrando…' : 'Crear cuadrilla y entrar'}
        </button>
      </form>
      <p className="text-sm text-slate-300">
        ¿Ya tienes cuenta?{' '}
        <Link to="/login" className="text-sky-300 underline">
          Iniciar sesión
        </Link>
      </p>
    </main>
  );
}
