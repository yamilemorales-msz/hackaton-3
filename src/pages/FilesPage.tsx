import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Alert, ghostButtonClass, inputClass } from '../components/ui';
import { apiFetch, errorMessage } from '../lib/api';
import type { FilePage } from '../lib/types';

const SIZES = [10, 25, 50];
const SORTS = [
  { value: 'name,asc', label: 'Nombre' },
  { value: 'progress,desc', label: 'Progreso' },
  { value: 'updatedAt,desc', label: 'Última actualización' },
];

interface Query {
  page: number;
  size: number;
  status: '' | 'ACTIVE' | 'COMPLETE';
  q: string;
  sort: string;
}

/** Sanea la URL: un valor inválido vuelve a su valor por defecto en vez de romper la vista. */
function readQuery(params: URLSearchParams): Query {
  const pageRaw = Number(params.get('page'));
  const sizeRaw = Number(params.get('size'));
  const statusRaw = params.get('status');
  const sortRaw = params.get('sort') ?? '';
  return {
    page: Number.isInteger(pageRaw) && pageRaw >= 0 ? pageRaw : 0,
    size: SIZES.includes(sizeRaw) ? sizeRaw : 10,
    status: statusRaw === 'ACTIVE' || statusRaw === 'COMPLETE' ? statusRaw : '',
    q: (params.get('q') ?? '').slice(0, 60),
    sort: SORTS.some((item) => item.value === sortRaw) ? sortRaw : 'name,asc',
  };
}

interface State {
  data: FilePage | null;
  error: string | null;
  loading: boolean;
}

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

export default function FilesPage() {
  const [params, setParams] = useSearchParams();
  const { page, size, status, q, sort } = readQuery(params);
  const [state, setState] = useState<State>({ data: null, error: null, loading: true });
  const [tick, setTick] = useState(0);
  const [text, setText] = useState(q);

  const update = (patch: Partial<Query>, replace = false): void => {
    const next = { page, size, status, q, sort, ...patch };
    const out = new URLSearchParams();
    if (next.page > 0) out.set('page', String(next.page));
    if (next.size !== 10) out.set('size', String(next.size));
    if (next.status) out.set('status', next.status);
    if (next.q) out.set('q', next.q);
    if (next.sort !== 'name,asc') out.set('sort', next.sort);
    setParams(out, { replace });
  };

  // La URL manda: atrás/adelante actualiza también la caja de búsqueda.
  useEffect(() => {
    setText(q);
  }, [q]);

  // Búsqueda sin una request por tecla.
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

  // Cada cambio aborta la request anterior: una respuesta vieja nunca pisa a una nueva.
  useEffect(() => {
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    apiFetch<FilePage>('/files', { query: { page, size, status, q, sort }, signal: controller.signal })
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
  }, [page, size, status, q, sort, tick]);

  const data = state.data;
  const totalPages = data?.totalPages ?? 0;
  const outOfRange = data !== null && totalPages > 0 && page >= totalPages;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Archivos de datos</h1>

      <form
        className="flex flex-wrap items-end gap-3"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: text.slice(0, 60), page: 0 });
        }}
      >
        <div className="flex flex-col gap-1">
          <label htmlFor="files-q" className="text-sm">
            Buscar
          </label>
          <input
            id="files-q"
            type="search"
            maxLength={60}
            className={inputClass}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="files-status" className="text-sm">
            Estado
          </label>
          <select
            id="files-status"
            className={inputClass}
            value={status}
            onChange={(event) => {
              const value = event.target.value;
              update({ status: value === 'ACTIVE' || value === 'COMPLETE' ? value : '', page: 0 });
            }}
          >
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="COMPLETE">Completos</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="files-sort" className="text-sm">
            Orden
          </label>
          <select
            id="files-sort"
            className={inputClass}
            value={sort}
            onChange={(event) => update({ sort: event.target.value, page: 0 })}
          >
            {SORTS.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="files-size" className="text-sm">
            Por página
          </label>
          <select
            id="files-size"
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

      {state.error ? (
        <div className="flex flex-wrap items-center gap-3">
          <Alert>{state.error}</Alert>
          <button type="button" className={ghostButtonClass} onClick={() => setTick((value) => value + 1)}>
            Reintentar
          </button>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="text-sm text-slate-300">
        {state.loading ? 'Cargando archivos…' : data ? `${data.totalElements} archivos` : ''}
      </p>

      {outOfRange ? (
        <Alert tone="info">
          Esa página no existe.{' '}
          <button type="button" className="underline" onClick={() => update({ page: totalPages - 1 })}>
            Ir a la última página
          </button>
        </Alert>
      ) : null}

      {data && data.content.length === 0 && !state.loading && !outOfRange ? (
        <p className="text-slate-300">No hay archivos con esos filtros.</p>
      ) : null}

      {data && data.content.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Archivos de datos</caption>
            <thead className="border-b border-slate-600 text-slate-200">
              <tr>
                <th scope="col" className="px-2 py-2">
                  Nombre
                </th>
                <th scope="col" className="px-2 py-2">
                  Estado
                </th>
                <th scope="col" className="px-2 py-2">
                  Tamaño
                </th>
                <th scope="col" className="px-2 py-2">
                  Progreso
                </th>
                <th scope="col" className="px-2 py-2">
                  Grupos
                </th>
                <th scope="col" className="px-2 py-2">
                  Errores
                </th>
              </tr>
            </thead>
            <tbody>
              {data.content.map((file) => (
                <tr key={file.id} className="border-b border-slate-800">
                  <th scope="row" className="px-2 py-2 font-medium">
                    <Link to={`/files/${file.id}/refine`} className="text-sky-300 underline">
                      {file.name}
                    </Link>
                  </th>
                  <td className="px-2 py-2">{file.status === 'COMPLETE' ? 'Completo' : 'Activo'}</td>
                  <td className="px-2 py-2">
                    {file.rows} × {file.cols}
                  </td>
                  <td className="px-2 py-2">
                    <progress
                      className="mr-2 h-2 w-24 align-middle"
                      max={1}
                      value={file.progress.overall}
                      aria-label={`Progreso de ${file.name}`}
                    />
                    {percent(file.progress.overall)}
                  </td>
                  <td className="px-2 py-2">
                    {file.refinedGroups} / {file.totalGroups}
                  </td>
                  <td className="px-2 py-2">{file.mistakes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

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
