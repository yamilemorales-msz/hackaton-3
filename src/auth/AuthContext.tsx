import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch, isRecord, parseTokens, refreshSession } from '../lib/api';
import { clearSession, getAccessToken, getRefreshToken, onSessionEvent, setTokens } from '../lib/session';

export interface Me {
  id: number | null;
  email: string;
  displayName: string;
  team: { code: string; name: string };
  role: { code: string; name: string };
  permissions: string[];
  clearance: { granted: boolean; grantedAt: string | null };
}

export type AuthStatus = 'loading' | 'anon' | 'authed' | 'error';

export interface RegisterInput {
  teamName: string;
  email: string;
  password: string;
}

interface AuthValue {
  status: AuthStatus;
  me: Me | null;
  /** Mensaje para el login (por ejemplo, sesión revocada). */
  notice: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  reloadMe: () => Promise<void>;
  retryRestore: () => void;
  /** La interfaz se decide por permisos, nunca por rol. */
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeMe(value: unknown): Me {
  const root: Record<string, unknown> = isRecord(value) ? value : {};
  const user: Record<string, unknown> = isRecord(root.user) ? root.user : root;
  const team: Record<string, unknown> = isRecord(root.team) ? root.team : {};
  const role: Record<string, unknown> = isRecord(root.role) ? root.role : {};
  const clearance: Record<string, unknown> = isRecord(root.clearance) ? root.clearance : {};
  const permissions: string[] = [];
  if (Array.isArray(root.permissions)) {
    for (const item of root.permissions) {
      if (typeof item === 'string') permissions.push(item);
    }
  }
  return {
    id: typeof user.id === 'number' ? user.id : null,
    email: text(user.email),
    displayName: text(user.displayName),
    team: { code: text(team.code), name: text(team.name) },
    role: { code: text(role.code), name: text(role.name) },
    permissions,
    clearance: {
      granted: clearance.granted === true,
      grantedAt: typeof clearance.grantedAt === 'string' ? clearance.grantedAt : null,
    },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const statusRef = useRef<AuthStatus>(status);
  statusRef.current = status;

  const loadMe = useCallback(async (): Promise<void> => {
    const res = await apiFetch<unknown>('/auth/me');
    setMe(normalizeMe(res.data));
    setStatus('authed');
  }, []);

  const restore = useCallback(async (): Promise<void> => {
    if (!getRefreshToken()) {
      setStatus('anon');
      return;
    }
    setStatus('loading');
    try {
      if (!getAccessToken()) await refreshSession(null);
      await loadMe();
    } catch {
      // Si la sesión se cerró, el evento de logout ya dejó el estado en "anon".
      setStatus(getRefreshToken() ? 'error' : 'anon');
    }
  }, [loadMe]);

  useEffect(() => {
    const off = onSessionEvent((event) => {
      if (event.type === 'logout') {
        setMe(null);
        setStatus('anon');
        setNotice(event.reason);
      } else if (statusRef.current === 'anon') {
        // Otra pestaña inició sesión.
        loadMe().catch(() => undefined);
      }
    });
    void restore();
    return off;
  }, [loadMe, restore]);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const res = await apiFetch<unknown>('/auth/login', {
        method: 'POST',
        auth: false,
        body: { email, password },
      });
      const tokens = parseTokens(res.data);
      setTokens(tokens.accessToken, tokens.refreshToken);
      setNotice(null);
      await loadMe();
    },
    [loadMe],
  );

  const register = useCallback(
    async (input: RegisterInput): Promise<void> => {
      const res = await apiFetch<unknown>('/auth/register', {
        method: 'POST',
        auth: false,
        body: { teamName: input.teamName, email: input.email, password: input.password },
      });
      const tokens = parseTokens(res.data);
      setTokens(tokens.accessToken, tokens.refreshToken);
      setNotice(null);
      await loadMe();
    },
    [loadMe],
  );

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = getRefreshToken();
    try {
      // Revoca la sesión en el servidor.
      await apiFetch<unknown>('/auth/logout', { method: 'POST', auth: false, body: { refreshToken } });
    } catch {
      // Aunque falle la red, la sesión local se cierra igual.
    } finally {
      clearSession(null);
    }
  }, []);

  const retryRestore = useCallback((): void => {
    void restore();
  }, [restore]);

  const can = useCallback((permission: string): boolean => me?.permissions.includes(permission) ?? false, [me]);

  const value = useMemo<AuthValue>(
    () => ({ status, me, notice, login, register, logout, reloadMe: loadMe, retryRestore, can }),
    [status, me, notice, login, register, logout, loadMe, retryRestore, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error('useAuth debe usarse dentro de AuthProvider.');
  return value;
}
