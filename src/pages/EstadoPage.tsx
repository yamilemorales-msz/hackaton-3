import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Alert, buttonClass, ghostButtonClass, inputClass } from '../components/ui';
import { apiFetch, errorMessage, isApiError, isRecord } from '../lib/api';
import { BUILD } from '../lib/config';
import { useResource } from '../lib/useResource';

interface ActionState {
  loading: boolean;
  result: unknown;
  error: string | null;
}

const IDLE: ActionState = { loading: false, result: null, error: null };

/** Los datos del servidor se muestran siempre como texto. */
function Json({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-200" tabIndex={0}>
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded border border-slate-700 p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

interface CheckRow {
  name: string;
  passed: boolean;
  reason: string;
}

function checkRows(value: unknown): CheckRow[] {
  const source = isRecord(value) ? value.checks : value;
  if (!Array.isArray(source)) return [];
  const rows: CheckRow[] = [];
  for (const item of source) {
    if (!isRecord(item)) continue;
    const name = item.name ?? item.check ?? item.id ?? item.code;
    const reason = item.reason ?? item.message ?? item.detail;
    rows.push({
      name: typeof name === 'string' ? name : 'Comprobación',
      passed: item.passed === true,
      reason: typeof reason === 'string' ? reason : '',
    });
  }
  return rows;
}

function Checks({ value }: { value: unknown }) {
  const rows = checkRows(value);
  if (rows.length === 0) return <Json value={value} />;
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((row) => (
        <li key={row.name} className="rounded bg-slate-900 p-2 text-sm">
          <span className={row.passed ? 'text-emerald-300' : 'text-red-300'}>
            {row.passed ? '✓ Aprobada' : '✗ Pendiente'}
          </span>{' '}
          <strong>{row.name}</strong>
          {row.reason ? <span className="text-slate-300"> — {row.reason}</span> : null}
        </li>
      ))}
    </ul>
  );
}

interface RosterRow {
  name: string;
  code: string;
}

const EMPTY_ROSTER: RosterRow[] = [
  { name: '', code: '' },
  { name: '', code: '' },
  { name: '', code: '' },
];

/** Inscripción de los tres integrantes para las rondas de control (PUT /team/roster). */
function RosterSection() {
  const roster = useResource<unknown>('/team/roster');
  const [rows, setRows] = useState<RosterRow[]>(EMPTY_ROSTER);
  const [save, setSave] = useState<ActionState>(IDLE);

  useEffect(() => {
    const data = roster.data;
    if (!isRecord(data) || !Array.isArray(data.members)) return;
    const members: unknown[] = data.members;
    if (members.length === 0) return;
    setRows(
      EMPTY_ROSTER.map((empty, index) => {
        const member = members[index];
        if (!isRecord(member)) return empty;
        return {
          name: typeof member.name === 'string' ? member.name : '',
          code: typeof member.code === 'string' ? member.code : '',
        };
      }),
    );
  }, [roster.data]);

  const setField = (index: number, field: 'name' | 'code', value: string): void => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  };

  const submit = (): void => {
    setSave({ loading: true, result: null, error: null });
    const members = rows.map((row) => ({ name: row.name.trim(), code: row.code.trim() }));
    apiFetch<unknown>('/team/roster', { method: 'PUT', body: { members } })
      .then((res) => {
        setSave({ loading: false, result: res.data, error: null });
      })
      .catch((error: unknown) => {
        setSave({ loading: false, result: isApiError(error) ? error.details : null, error: errorMessage(error) });
      });
  };

  const locked = isRecord(roster.data) && roster.data.locked === true;
  const ready = rows.every((row) => row.name.trim().length >= 3 && row.code.trim().length >= 1);

  return (
    <Section title="Roster (rondas de control)">
      {roster.error ? <Alert>{roster.error}</Alert> : null}
      {locked ? <Alert tone="info">El roster ya entró a un sorteo y no se puede editar.</Alert> : null}
      {rows.map((row, index) => (
        <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr]">
          <div className="flex flex-col gap-1">
            <label htmlFor={`roster-name-${index}`} className="text-sm">
              Nombre del integrante {index + 1}
            </label>
            <input
              id={`roster-name-${index}`}
              type="text"
              className={inputClass}
              value={row.name}
              onChange={(event) => setField(index, 'name', event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`roster-code-${index}`} className="text-sm">
              Código
            </label>
            <input
              id={`roster-code-${index}`}
              type="text"
              className={inputClass}
              value={row.code}
              onChange={(event) => setField(index, 'code', event.target.value)}
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        className={`${buttonClass} self-start`}
        disabled={save.loading || locked || !ready}
        onClick={submit}
      >
        {save.loading ? 'Guardando…' : 'Guardar roster'}
      </button>
      {save.error ? <Alert>{save.error}</Alert> : null}
      {save.result !== null ? <Json value={save.result} /> : null}
    </Section>
  );
}

export default function EstadoPage() {
  const { me, can, reloadMe } = useAuth();
  const health = useResource<unknown>('/meta/health', false);
  const integrations = useResource<unknown>('/integrations/status');
  const clearance = useResource<unknown>('/clearance');

  const [check, setCheck] = useState<ActionState>(IDLE);
  const [domain, setDomain] = useState<ActionState>(IDLE);
  const [chaos, setChaos] = useState<ActionState>(IDLE);
  const [origin, setOrigin] = useState<string>(window.location.origin);

  const run = (
    set: (state: ActionState) => void,
    path: string,
    method: string,
    body: unknown,
    after?: () => void,
  ): void => {
    set({ loading: true, result: null, error: null });
    apiFetch<unknown>(path, { method, body })
      .then((res) => {
        set({ loading: false, result: res.data, error: null });
        after?.();
      })
      .catch((error: unknown) => {
        set({ loading: false, result: isApiError(error) ? error.details : null, error: errorMessage(error) });
        after?.();
      });
  };

  const afterCheck = (): void => {
    clearance.reload();
    integrations.reload();
    reloadMe().catch(() => undefined);
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Estado</h1>

      <Section title="Build y servicio">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-300">Build desplegado</dt>
          <dd>
            <code>{BUILD}</code>
          </dd>
          <dt className="text-slate-300">API</dt>
          <dd role="status">
            {health.loading ? 'Comprobando…' : health.error ? `No responde: ${health.error}` : 'Responde'}
          </dd>
          <dt className="text-slate-300">Cuadrilla</dt>
          <dd>
            {me?.team.code} · {me?.team.name}
          </dd>
          <dt className="text-slate-300">Piso de Pruebas</dt>
          <dd>{me?.clearance.granted ? 'Abierto' : 'Cerrado'}</dd>
        </dl>
        <button type="button" className={`${ghostButtonClass} self-start`} onClick={health.reload}>
          Volver a comprobar la API
        </button>
      </Section>

      <Section title="Clearance">
        {clearance.loading ? <p role="status">Cargando…</p> : null}
        {clearance.error ? <Alert>{clearance.error}</Alert> : null}
        {clearance.data !== null ? <Json value={clearance.data} /> : null}
        <button
          type="button"
          className={`${buttonClass} self-start`}
          disabled={check.loading}
          onClick={() => run(setCheck, '/clearance/check', 'POST', undefined, afterCheck)}
        >
          {check.loading ? 'Revisando…' : 'Abrir el Piso de Pruebas'}
        </button>
        {check.error ? <Alert>{check.error}</Alert> : null}
        {check.result !== null ? <Checks value={check.result} /> : null}
      </Section>

      {can('team:manage') ? <RosterSection /> : null}

      <Section title="Integraciones">
        {integrations.loading ? <p role="status">Cargando…</p> : null}
        {integrations.error ? <Alert>{integrations.error}</Alert> : null}
        {integrations.data !== null ? <Json value={integrations.data} /> : null}
        <button type="button" className={`${ghostButtonClass} self-start`} onClick={integrations.reload}>
          Actualizar
        </button>
      </Section>

      {can('team:manage') ? (
        <Section title="Verificar dominio">
          <label htmlFor="estado-origin" className="text-sm">
            Origen de producción
          </label>
          <input
            id="estado-origin"
            type="url"
            className={inputClass}
            value={origin}
            onChange={(event) => setOrigin(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={ghostButtonClass}
              disabled={domain.loading}
              onClick={() => run(setDomain, '/integrations/deploy/challenge', 'POST', { origin })}
            >
              1. Pedir token
            </button>
            <button
              type="button"
              className={ghostButtonClass}
              disabled={domain.loading}
              onClick={() => run(setDomain, '/integrations/deploy/verify', 'POST', undefined, integrations.reload)}
            >
              2. Verificar
            </button>
          </div>
          <p className="text-sm text-slate-300">
            Publica el token en <code>public/.well-known/lumon-verification.txt</code>, despliega y luego verifica.
          </p>
          {domain.loading ? <p role="status">Procesando…</p> : null}
          {domain.error ? <Alert>{domain.error}</Alert> : null}
          {domain.result !== null ? <Json value={domain.result} /> : null}
        </Section>
      ) : null}

      {can('team:manage') ? (
        <Section title="Modo caos">
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2].map((level) => (
              <button
                key={level}
                type="button"
                className={ghostButtonClass}
                disabled={chaos.loading}
                onClick={() => run(setChaos, '/workspace/chaos', 'PUT', { level })}
              >
                Nivel {level}
              </button>
            ))}
          </div>
          {chaos.loading ? <p role="status">Aplicando…</p> : null}
          {chaos.error ? <Alert>{chaos.error}</Alert> : null}
          {chaos.result !== null ? <Json value={chaos.result} /> : null}
        </Section>
      ) : null}
    </div>
  );
}
