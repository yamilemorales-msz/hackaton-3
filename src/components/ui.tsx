import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Splash({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex min-h-full items-center justify-center p-8 text-slate-300">
      {label}
    </div>
  );
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'info' }) {
  const color =
    tone === 'error' ? 'border-red-400 bg-red-950 text-red-100' : 'border-sky-400 bg-sky-950 text-sky-100';
  return (
    <p role={tone === 'error' ? 'alert' : 'status'} className={`rounded border px-3 py-2 text-sm ${color}`}>
      {children}
    </p>
  );
}

export function MessagePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-full max-w-xl flex-col items-start justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <div className="text-slate-300">{children}</div>
      <Link to="/" className="rounded bg-sky-300 px-4 py-2 font-medium text-slate-950 hover:bg-sky-200">
        Volver al inicio
      </Link>
    </main>
  );
}

export const inputClass =
  'w-full rounded border border-slate-500 bg-slate-900 px-3 py-2 text-slate-100 placeholder:text-slate-400';
export const buttonClass =
  'rounded bg-sky-300 px-4 py-2 font-medium text-slate-950 hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60';
export const ghostButtonClass =
  'rounded border border-slate-500 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60';
