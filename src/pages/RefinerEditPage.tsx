import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Alert, Splash, buttonClass, ghostButtonClass, inputClass } from '../components/ui';
import { apiFetch, errorMessage, fieldErrors, isApiError, isRecord } from '../lib/api';
import type { Department, Refiner } from '../lib/refiners';
import { useResource } from '../lib/useResource';

interface Form {
  title: string;
  extension: string;
  bio: string;
  departmentId: number;
}

type Field = keyof Form;

const FIELDS: Array<{ key: Field; label: string }> = [
  { key: 'title', label: 'Cargo' },
  { key: 'extension', label: 'Anexo' },
  { key: 'departmentId', label: 'Departamento' },
  { key: 'bio', label: 'Biografía' },
];

function toForm(refiner: Refiner): Form {
  return {
    title: refiner.title,
    extension: refiner.extension,
    bio: refiner.bio,
    departmentId: refiner.department.id,
  };
}

function isRefiner(value: unknown): value is Refiner {
  return isRecord(value) && typeof value.id === 'number' && typeof value.version === 'number';
}

interface Conflict {
  server: Refiner;
  etag: string;
  /** Por campo: true = quedarse con lo que escribió el usuario. */
  keepMine: Record<Field, boolean>;
}

export default function RefinerEditPage() {
  const { id } = useParams();
  const refinerId = Number(id);
  const departments = useResource<Department[]>('/departments');
  const [refiner, setRefiner] = useState<Refiner | null>(null);
  const [etag, setEtag] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [conflict, setConflict] = useState<Conflict | null>(null);

  const load = useCallback((): void => {
    setLoadError(null);
    apiFetch<Refiner>(`/refiners/${refinerId}`)
      .then((res) => {
        setRefiner(res.data);
        setEtag(res.headers.get('ETag'));
        setForm(toForm(res.data));
      })
      .catch((err: unknown) => {
        setLoadError(errorMessage(err));
      });
  }, [refinerId]);

  useEffect(() => {
    if (Number.isInteger(refinerId) && refinerId > 0) load();
  }, [load, refinerId]);

  const save = (values: Form, ifMatch: string, current: Refiner): void => {
    setSaving(true);
    setError(null);
    setFields({});
    setSaved(false);
    // Solo se envía lo que cambió respecto a la versión leída.
    const base = toForm(current);
    const body: Partial<Form> = {};
    if (values.title !== base.title) body.title = values.title;
    if (values.extension !== base.extension) body.extension = values.extension;
    if (values.bio !== base.bio) body.bio = values.bio;
    if (values.departmentId !== base.departmentId) body.departmentId = values.departmentId;
    apiFetch<Refiner>(`/refiners/${current.id}`, {
      method: 'PATCH',
      headers: { 'If-Match': ifMatch },
      body,
      retries: 2,
    })
      .then((res) => {
        setRefiner(res.data);
        setEtag(res.headers.get('ETag'));
        setForm(toForm(res.data));
        setConflict(null);
        setSaved(true);
      })
      .catch((err: unknown) => {
        if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
          const current = isRecord(err.details) ? err.details.current : null;
          const newTag = err.headers?.get('ETag') ?? null;
          if (isRefiner(current) && newTag) {
            // Regla de Milchick: nunca se sobrescribe en silencio.
            setConflict({
              server: current,
              etag: newTag,
              keepMine: { title: true, extension: true, bio: true, departmentId: true },
            });
            return;
          }
        }
        const byField = fieldErrors(err);
        setFields(byField);
        setError(errorMessage(err));
      })
      .finally(() => {
        setSaving(false);
      });
  };

  if (!Number.isInteger(refinerId) || refinerId < 1) {
    return <Alert>El identificador del expediente no es válido.</Alert>;
  }
  if (loadError) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-3">
        <Alert>{loadError}</Alert>
        <button type="button" className={buttonClass} onClick={load}>
          Reintentar
        </button>
      </div>
    );
  }
  if (!refiner || !form) return <Splash label="Cargando expediente…" />;

  const deptList = Array.isArray(departments.data) ? departments.data : [];
  const deptName = (deptId: number): string => deptList.find((d) => d.id === deptId)?.name ?? `#${deptId}`;
  const show = (field: Field, values: Form): string =>
    field === 'departmentId' ? deptName(values.departmentId) : String(values[field]);

  if (conflict) {
    const serverForm = toForm(conflict.server);
    const differing = FIELDS.filter((item) => form[item.key] !== serverForm[item.key]);
    const resolved: Form = {
      title: conflict.keepMine.title ? form.title : serverForm.title,
      extension: conflict.keepMine.extension ? form.extension : serverForm.extension,
      bio: conflict.keepMine.bio ? form.bio : serverForm.bio,
      departmentId: conflict.keepMine.departmentId ? form.departmentId : serverForm.departmentId,
    };
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4" role="region" aria-labelledby="conflict-title">
        <h1 id="conflict-title" className="text-2xl font-semibold">
          Conflicto de versión
        </h1>
        <Alert>
          Alguien modificó este expediente (ahora en la versión {conflict.server.version}) mientras lo editabas. Elige,
          campo por campo, qué valor conservar antes de guardar.
        </Alert>
        {differing.length === 0 ? <p>Los valores coinciden; puedes guardar sin perder nada.</p> : null}
        {differing.map((item) => (
          <fieldset key={item.key} className="rounded border border-slate-700 p-3">
            <legend className="px-1 font-semibold">{item.label}</legend>
            <label className="flex items-start gap-2 py-1">
              <input
                type="radio"
                name={`pick-${item.key}`}
                checked={conflict.keepMine[item.key]}
                onChange={() =>
                  setConflict({ ...conflict, keepMine: { ...conflict.keepMine, [item.key]: true } })
                }
              />
              <span>
                <span className="text-sm text-slate-300">Lo que escribiste: </span>
                <span className="whitespace-pre-wrap break-words">{show(item.key, form)}</span>
              </span>
            </label>
            <label className="flex items-start gap-2 py-1">
              <input
                type="radio"
                name={`pick-${item.key}`}
                checked={!conflict.keepMine[item.key]}
                onChange={() =>
                  setConflict({ ...conflict, keepMine: { ...conflict.keepMine, [item.key]: false } })
                }
              />
              <span>
                <span className="text-sm text-slate-300">Lo que hay en el servidor: </span>
                <span className="whitespace-pre-wrap break-words">{show(item.key, serverForm)}</span>
              </span>
            </label>
          </fieldset>
        ))}
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            disabled={saving}
            onClick={() => {
              setRefiner(conflict.server);
              setEtag(conflict.etag);
              setForm(resolved);
              const next = conflict.etag;
              const server = conflict.server;
              setConflict(null);
              // Se reintenta con el ETag nuevo, sobre la versión que el usuario ya vio.
              window.setTimeout(() => {
                save(resolved, next, server);
              }, 0);
            }}
          >
            {saving ? 'Guardando…' : 'Guardar con mi elección'}
          </button>
          <button
            type="button"
            className={ghostButtonClass}
            onClick={() => {
              setRefiner(conflict.server);
              setEtag(conflict.etag);
              setForm(serverForm);
              setConflict(null);
            }}
          >
            Descartar mis cambios
          </button>
        </div>
      </div>
    );
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (saving) return;
    if (!etag) {
      setError('No se recibió la versión del expediente (ETag). Recarga antes de guardar.');
      return;
    }
    save(form, etag, refiner);
  };

  const set = <K extends Field>(key: K, value: Form[K]): void => {
    setSaved(false);
    setForm({ ...form, [key]: value });
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-semibold">Editar expediente: {refiner.fullName}</h1>
      <p className="text-sm text-slate-300">Versión {refiner.version}</p>
      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-1">
          <label htmlFor="ed-title" className="text-sm">
            Cargo
          </label>
          <input
            id="ed-title"
            className={inputClass}
            maxLength={200}
            value={form.title}
            aria-invalid={fields.title ? true : undefined}
            onChange={(event) => set('title', event.target.value)}
          />
          {fields.title ? <p className="text-sm text-red-300">{fields.title}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ed-ext" className="text-sm">
            Anexo (3 a 6 dígitos)
          </label>
          <input
            id="ed-ext"
            inputMode="numeric"
            className={inputClass}
            value={form.extension}
            aria-invalid={fields.extension ? true : undefined}
            onChange={(event) => set('extension', event.target.value)}
          />
          {fields.extension ? <p className="text-sm text-red-300">{fields.extension}</p> : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ed-dept" className="text-sm">
            Departamento
          </label>
          <select
            id="ed-dept"
            className={inputClass}
            value={form.departmentId}
            onChange={(event) => set('departmentId', Number(event.target.value))}
          >
            {deptList.length === 0 ? (
              <option value={refiner.department.id}>{refiner.department.name}</option>
            ) : null}
            {deptList.map((dept) => (
              <option key={dept.id} value={dept.id}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ed-bio" className="text-sm">
            Biografía
          </label>
          <textarea
            id="ed-bio"
            rows={5}
            maxLength={2000}
            className={inputClass}
            value={form.bio}
            aria-invalid={fields.bio ? true : undefined}
            onChange={(event) => set('bio', event.target.value)}
          />
          {fields.bio ? <p className="text-sm text-red-300">{fields.bio}</p> : null}
        </div>
        {error ? <Alert>{error}</Alert> : null}
        {saved ? <Alert tone="info">Expediente guardado.</Alert> : null}
        <div className="flex gap-2">
          <button type="submit" className={buttonClass} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar'}
          </button>
          <Link to="/refiners" className={ghostButtonClass}>
            Volver al directorio
          </Link>
        </div>
      </form>
    </div>
  );
}
