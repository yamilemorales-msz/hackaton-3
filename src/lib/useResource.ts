import { useCallback, useEffect, useState } from 'react';
import { apiFetch, errorMessage } from './api';

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

interface State<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

/** GET con loading/error. Al cambiar `path` se aborta la request anterior: una respuesta vieja nunca pisa a una nueva. */
export function useResource<T>(path: string | null, auth = true): Resource<T> {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: path !== null });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (path === null) return undefined;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    apiFetch<T>(path, { signal: controller.signal, auth })
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
  }, [path, tick, auth]);

  const reload = useCallback(() => {
    setTick((value) => value + 1);
  }, []);

  return { ...state, reload };
}
