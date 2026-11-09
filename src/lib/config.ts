function trimSlash(value: string | undefined): string {
  return (value ?? '').replace(/\/+$/, '');
}

export const API_BASE = trimSlash(import.meta.env.VITE_API_BASE_URL);
export const WS_BASE = trimSlash(import.meta.env.VITE_WS_BASE_URL);

/** SHA corto del commit desplegado; se inyecta en el build (ver vite.config.ts). En local vale "dev". */
export const BUILD: string = __LUMON_BUILD__;
