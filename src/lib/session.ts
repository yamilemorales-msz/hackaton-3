// Estado de la sesión compartido entre pestañas.
// - El access token vive SOLO en memoria (variable del módulo).
// - El refresh token (un solo uso) se persiste en localStorage.
// - BroadcastChannel avisa a las demás pestañas de tokens nuevos y de cierres de sesión.

const RT_KEY = 'lumon.refresh';
const CHANNEL = 'lumon-session';

type Message = { type: 'tokens'; accessToken: string } | { type: 'logout'; reason: string | null };

export type SessionEvent = { type: 'tokens' } | { type: 'logout'; reason: string | null };
type Listener = (event: SessionEvent) => void;

let accessToken: string | null = null;
const listeners = new Set<Listener>();
const channel: BroadcastChannel | null =
  typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL);

function emit(event: SessionEvent): void {
  listeners.forEach((listener) => listener(event));
}

function post(message: Message): void {
  channel?.postMessage(message);
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem(RT_KEY);
  } catch {
    return null;
  }
}

export function setTokens(access: string, refresh: string): void {
  accessToken = access;
  try {
    localStorage.setItem(RT_KEY, refresh);
  } catch {
    // Sin almacenamiento: la sesión dura lo que dure la pestaña.
  }
  post({ type: 'tokens', accessToken: access });
}

/** Cierra la sesión local. Con `broadcast` avisa también a las demás pestañas. */
export function clearSession(reason: string | null, broadcast = true): void {
  const hadSession = accessToken !== null || getRefreshToken() !== null;
  accessToken = null;
  try {
    localStorage.removeItem(RT_KEY);
  } catch {
    // nada que limpiar
  }
  if (broadcast && hadSession) post({ type: 'logout', reason });
  emit({ type: 'logout', reason });
}

export function onSessionEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

channel?.addEventListener('message', (event: MessageEvent<Message>) => {
  const message = event.data;
  if (message.type === 'tokens') {
    accessToken = message.accessToken;
    emit({ type: 'tokens' });
  } else {
    clearSession(message.reason, false);
  }
});

// Respaldo si BroadcastChannel no está disponible: otra pestaña borró el refresh token.
window.addEventListener('storage', (event) => {
  if (event.key === RT_KEY && event.newValue === null && accessToken !== null) {
    clearSession(null, false);
  }
});
