import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, ghostButtonClass, inputClass } from '../components/ui';
import { apiFetch, errorMessage } from '../lib/api';
import { safeImageUrl } from '../lib/refiners';
import type { Department, RefinerPage } from '../lib/refiners';
import { useResource } from '../lib/useResource';

const SIZES = [10, 25, 50];

interface Query {
  page: number;
  size: number;
  departmentId: number | null;
  q: string;
}

function readQuery(params: URLSearchParams): Query {
  const page = Number(params.get('page'));
  const size = Number(params.get('size'));
  const dept = Number(params.get('departmentId'));
  return {
    page: Number.isInteger(page) && page >= 0 ? page : 0,
    size: SIZES.includes(size) ? size : 10,
    departmentId: Number.isInteger(dept) && dept >= 1 ? dept : null,
    q: (params.get('q') ?? '').slice(0, 60),
  };
}

interface State {
  data: RefinerPage | null;
  error: string | null;
  loading: boolean;
}

export default function RefinersPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const { page, size, departmentId, q } = readQuery(params);
  const departments = useResource<Department[]>('/departments');
  const [state, setState] = useState<State>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const [text, setText] = useState(q);

  const update = (patch: Partial<Query>, replace = false): void => {
    const next = { page, size, departmentId, q, ...patch };
    const out = new URLSearchParams();
    if (next.page > 0) out.set('page', String(next.page));
    if (next.size !== 10) out.set('size', String(next.size));
    if (next.departmentId !== null) out.set('departmentId', String(next.departmentId));
    if (next.q) out.set('q', next.q);
    setParams(out, { replace });
  };

  useEffect(() => {
    setText(q);
  }, [q]);

  useEffect(() => {
    if (text === q) return undefined;
    const timer = window.setTimeout(() => {
      update({ q: text.slice(0, 60), page: 0 }, true);
    }, 350);
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    apiFetch<RefinerPage>('/refiners', {
      query: { page, size, departmentId, q },
      signal: controller.signal,
    })
      .then((res) => {
        if (!controller.signal.aborted) setState({ data: res.data, error: null, loading: false });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setState((prev) => ({ data: prev.data, error: errorMessage(error), loading: false }));
        }
      });
    return () => {
      controller.abort();
    };
  }, [page, size, departmentId, q, tick]);

  const data = state.data;
  const totalPages = data?.totalPages ?? 0;
  const deptList = Array.isArray(departments.data) ? departments.data : [];

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Expedientes del personal</h1>

      <form
        role="search"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: text.slice(0, 60), page: 0 });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="ref-q" className="text-sm">
            Buscar
          </label>
          <input
            id="ref-q"
            type="search"
            maxLength={60}
            className={inputClass}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ref-dept" className="text-sm">
            Departamento
          </label>
          <select
            id="ref-dept"
            className={inputClass}
            value={departmentId ?? ''}
            onChange={(event) => {
              const value = Number(event.target.value);
              update({ departmentId: value >= 1 ? value : null, page: 0 });
            }}
          >
            <option value="">Todos</option>
            {deptList.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ref-size" className="text-sm">
            Por página
          </label>
          <select
            id="ref-size"
            className={inputClass}
            value={size}
            onChange={(event) => update({ size: Number(event.target.value), page: 0 })}
          >
            {SIZES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>
      </form>

      {departments.error ? <Alert>No se pudieron cargar los departamentos: {departments.error}</Alert> : null}
      {state.error ? (
        <div className="flex flex-wrap items-center gap-3">
          <Alert>{state.error}</Alert>
          <button type="button" className={ghostButtonClass} onClick={() => setTick((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      ) : null}
      <p role="status" aria-live="polite" className="text-sm text-slate-300">
        {state.loading ? 'Cargando expedientes…' : data ? `${data.totalElements} expedientes` : ''}
      </p>

      {data && data.content.length === 0 && !state.loading ? (
        <p className="text-slate-300">No hay expedientes con esos filtros.</p>
      ) : null}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data?.content.map((refiner) => {
          const badge = safeImageUrl(refiner.badge?.url);
          return (
            <li key={refiner.id} className="flex gap-3 rounded border border-slate-700 p-3">
              {badge ? (
                <img
                  src={badge}
                  alt={`Fotocheck de ${refiner.fullName}`}
                  width={64}
                  height={64}
                  loading="lazy"
                  decoding="async"
                  className="h-16 w-16 shrink-0 rounded object-cover"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-slate-800 text-xl font-semibold text-slate-300"
                >
                  {refiner.fullName.slice(0, 1)}
                </div>
              )}
              <div className="flex min-w-0 flex-col gap-1">
                {/* Textos del exterior: siempre como texto, nunca como HTML. */}
                <p className="font-semibold">{refiner.fullName}</p>
                <p className="text-sm text-slate-300">
                  {refiner.title} · {refiner.department.name} · ext. {refiner.extension}
                </p>
                <p className="line-clamp-2 text-sm text-slate-300">{refiner.bio}</p>
                {can('refiners:write') ? (
                  <Link to={`/refiners/${refiner.id}/edit`} className="text-sm text-sky-300 underline">
                    Editar expediente de {refiner.fullName}
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <nav aria-label="Paginación" className="flex items-center gap-3">
        <button type="button" className={ghostButtonClass} disabled={page <= 0} onClick={() => update({ page: page - 1 })}>
          Anterior
        </button>
        <span className="text-sm text-slate-200">
          Página {page + 1} de {Math.max(1, totalPages)}
        </span>
        <button
          type="button"
          className={ghostButtonClass}
          disabled={page + 1 >= totalPages}
          onClick={() => update({ page: page + 1 })}
        >
          Siguiente
        </button>
      </nav>
    </div>
  );
}
