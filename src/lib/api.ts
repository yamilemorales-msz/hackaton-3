import { API_BASE, BUILD } from './config';
import { clearSession, getAccessToken, getRefreshToken, setTokens } from './session';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  /** Segundos indicados por Retry-After, si vino. */
  readonly retryAfter: number | null;
  readonly headers: Headers | null;

  constructor(
    status: number,
    code: string,
    message: string,
    details: unknown,
    retryAfter: number | null,
    headers: Headers | null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
    this.headers = headers;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isAbortError(value: unknown): boolean {
  return value instanceof DOMException && value.name === 'AbortError';
}

export function errorMessage(error: unknown): string {
  if (isApiError(error)) return `${error.message} (${error.code})`;
  if (error instanceof Error) return error.message;
  return 'Ocurrió un error inesperado.';
}

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  /** false para endpoints públicos (login, registro, health). */
  auth?: boolean;
  /** Reintentos ante corte de red, 503 o 429. Por defecto: 3 en GET, 0 en el resto. */
  retries?: number;
}

export interface ApiResponse<T> {
  data: T;
  status: number;
  headers: Headers;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Espera creciente con jitter; si el servidor mandó Retry-After, manda ese valor. */
export function backoffMs(attempt: number, retryAfter: number | null): number {
  if (retryAfter !== null) return retryAfter * 1000 + 50;
  const base = Math.min(8000, 400 * 2 ** attempt);
  return base / 2 + Math.random() * (base / 2);
}

function parseRetryAfter(headers: Headers): number | null {
  const raw = headers.get('Retry-After');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(raw);
  if (Number.isNaN(date)) return null;
  return Math.max(0, (date - Date.now()) / 1000);
}

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

function send(path: string, opts: RequestOptions, token: string | null): Promise<Response> {
  const headers = new Headers(opts.headers);
  headers.set('X-Lumon-Build', BUILD);
  headers.set('Accept', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(opts.body);
  }
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers,
    body,
    signal: opts.signal,
  });
}

async function readJson(res: Response): Promise<unknown> {
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed;
  } catch {
    return null;
  }
}

async function toError(res: Response): Promise<ApiError> {
  const body = await readJson(res);
  const record: Record<string, unknown> = isRecord(body) ? body : {};
  const code = typeof record.error === 'string' ? record.error : `HTTP_${res.status}`;
  const message =
    typeof record.message === 'string' ? record.message : `La API respondió ${res.status}.`;
  return new ApiError(
    res.status,
    code,
    message,
    record.details ?? null,
    parseRetryAfter(res.headers),
    res.headers,
  );
}

export function parseTokens(data: unknown): TokenPair {
  if (isRecord(data) && typeof data.accessToken === 'string' && typeof data.refreshToken === 'string') {
    return { accessToken: data.accessToken, refreshToken: data.refreshToken };
  }
  throw new ApiError(0, 'BAD_RESPONSE', 'La respuesta de sesión no tiene el formato esperado.', null, null, null);
}

function revokedReason(code: string): string {
  if (code === 'REFRESH_REUSED') {
    return 'Tu sesión se revocó por seguridad: se detectó un refresh token reutilizado. Vuelve a iniciar sesión.';
  }
  if (code === 'SESSION_REVOKED') return 'Tu sesión fue revocada. Vuelve a iniciar sesión.';
  return 'Tu sesión ya no es válida. Vuelve a iniciar sesión.';
}

const SESSION_ENDED = new Set(['REFRESH_REUSED', 'SESSION_REVOKED', 'TOKEN_INVALID']);

// ---------------------------------------------------------------------------
// Refresh coordinado
// - Dentro de la pestaña: una sola promesa compartida por todas las requests.
// - Entre pestañas: Web Locks. Quien entra al lock después de otra pestaña ve
//   que el token ya cambió (o lee el refresh token nuevo), y nunca reutiliza uno.
// ---------------------------------------------------------------------------

let refreshing: Promise<string> | null = null;

async function withRefreshLock<T>(fn: () => Promise<T>): Promise<T> {
  if (typeof navigator.locks?.request === 'function') {
    const result: unknown = await navigator.locks.request('lumon-refresh', () => fn());
    return result as T;
  }
  return fn();
}

async function doRefresh(staleToken: string | null): Promise<string> {
  return withRefreshLock(async () => {
    const current = getAccessToken();
    if (current !== null && current !== staleToken) return current; // otra pestaña ya rotó
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      throw new ApiError(401, 'NO_SESSION', 'No hay una sesión activa.', null, null, null);
    }
    for (let attempt = 0; ; attempt += 1) {
      const res = await send('/auth/refresh', { method: 'POST', body: { refreshToken } }, null);
      if (res.ok) {
        const tokens = parseTokens(await readJson(res));
        setTokens(tokens.accessToken, tokens.refreshToken);
        return tokens.accessToken;
      }
      const error = await toError(res);
      // 503/429: el servidor no consumió el token, se puede reintentar con el mismo.
      if ((res.status === 503 || res.status === 429) && attempt < 3) {
        await sleep(backoffMs(attempt, error.retryAfter));
        continue;
      }
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        clearSession(revokedReason(error.code));
      }
      throw error;
    }
  });
}

export function refreshSession(staleToken: string | null): Promise<string> {
  if (refreshing === null) {
    refreshing = doRefresh(staleToken).finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

// ---------------------------------------------------------------------------
// Request genérica
// ---------------------------------------------------------------------------

export async function apiFetch<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const useAuth = opts.auth !== false;
  const method = opts.method ?? 'GET';
  const maxRetries = opts.retries ?? (method === 'GET' ? 3 : 0);
  let attempt = 0;
  let refreshed = false;

  for (;;) {
    const token = useAuth ? getAccessToken() : null;
    let res: Response;
    try {
      res = await send(path, opts, token);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt, null), opts.signal);
        attempt += 1;
        continue;
      }
      throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con Lumon.', null, null, null);
    }

    if (res.ok) {
      const data = (await readJson(res)) as T;
      return { data, status: res.status, headers: res.headers };
    }

    const error = await toError(res);

    if (res.status === 401 && useAuth) {
      // Solo TOKEN_EXPIRED justifica un refresh, y la request se reintenta una sola vez.
      if (error.code === 'TOKEN_EXPIRED' && !refreshed) {
        refreshed = true;
        await refreshSession(token);
        continue;
      }
      if (SESSION_ENDED.has(error.code)) clearSession(revokedReason(error.code));
      throw error;
    }

    if ((res.status === 503 || res.status === 429) && attempt < maxRetries) {
      await sleep(backoffMs(attempt, error.retryAfter), opts.signal);
      attempt += 1;
      continue;
    }

    throw error;
  }
}

/** Errores por campo que manda el servidor en `details`, tolerante a varias formas. */
export function fieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!isApiError(error)) return out;

  const collect = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (!isRecord(item)) continue;
        const field = item.field ?? item.path ?? item.name;
        const message = item.message ?? item.reason ?? item.error;
        if (typeof field === 'string' && typeof message === 'string') out[field] = message;
      }
    } else if (isRecord(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (typeof entry === 'string') out[key] = entry;
        else if (Array.isArray(entry) && typeof entry[0] === 'string') out[key] = entry[0];
      }
    }
  };

  const details = error.details;
  if (isRecord(details) && typeof details.field === 'string') {
    // 409 EMAIL_TAKEN / TEAM_NAME_TAKEN: details = { field }
    out[details.field] = error.message;
  } else if (isRecord(details)) {
    collect(details.fields ?? details.errors ?? details);
  } else {
    collect(details);
  }

  if (Object.keys(out).length === 0) {
    if (/EMAIL/.test(error.code)) out.email = error.message;
    else if (/NAME|TEAM/.test(error.code)) out.teamName = error.message;
    else if (/PASSWORD/.test(error.code)) out.password = error.message;
  }
  return out;
}
