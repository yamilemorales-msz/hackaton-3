import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch, isApiError } from '../lib/api';
import { Splash, buttonClass } from './ui';

type Health = 'checking' | 'ok' | 'down';

/** Si /meta/health no responde, muestra "Conectando con Lumon…" y reintenta con espera creciente. */
export function HealthGate({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<Health>('checking');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    apiFetch<unknown>('/meta/health', { auth: false, retries: 0, signal: controller.signal })
      .then(() => {
        setHealth('ok');
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        // Un 4xx significa que la API sí responde.
        if (isApiError(error) && error.status >= 400 && error.status < 500) {
          setHealth('ok');
          return;
        }
        setHealth('down');
        const wait = Math.min(30000, 1000 * 2 ** Math.min(attempt, 5));
        timer = window.setTimeout(() => {
          setAttempt((value) => value + 1);
        }, wait);
      });
    return () => {
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [attempt]);

  if (health === 'ok') return <>{children}</>;
  if (health === 'checking') return <Splash label="Conectando con Lumon…" />;
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col items-start justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">Conectando con Lumon…</h1>
      <p role="status" aria-live="polite" className="text-slate-300">
        La API no responde. Reintentando automáticamente (intento {attempt + 1}).
      </p>
      <button type="button" className={buttonClass} onClick={() => setAttempt((value) => value + 1)}>
        Reintentar ahora
      </button>
    </main>
  );
}
