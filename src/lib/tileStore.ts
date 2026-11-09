import { apiFetch, backoffMs, isAbortError, isApiError } from './api';
import type { Cell } from './types';

export interface TileData {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  values: string;
  tremor: Uint8Array;
  bins: string[];
  version: number;
}

interface RawTile {
  tileRow: number;
  tileCol: number;
  originRow: number;
  originCol: number;
  rows: number;
  cols: number;
  values: string;
  tremor: string;
  bins: string;
  version: number;
}

export interface CellInfo {
  value: number;
  tremor: number;
  bin: string;
}

interface Waiter {
  resolve: (tile: TileData) => void;
  reject: (error: unknown) => void;
}

// El backend permite 40 bloques cada 10 s por sesión: nos quedamos por debajo.
const WINDOW_MS = 10_000;
const WINDOW_MAX = 32;
const MAX_ACTIVE = 4;
const MAX_ATTEMPTS = 6;

function decodeTile(raw: RawTile): TileData {
  const binary = atob(raw.tremor); // base64 → un byte por celda
  const tremor = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) tremor[i] = binary.charCodeAt(i);
  return {
    tileRow: raw.tileRow,
    tileCol: raw.tileCol,
    originRow: raw.originRow,
    originCol: raw.originCol,
    rows: raw.rows,
    cols: raw.cols,
    values: raw.values,
    tremor,
    bins: raw.bins.split(''),
    version: raw.version,
  };
}

export function tileKey(tileRow: number, tileCol: number): string {
  return `${tileRow}:${tileCol}`;
}

/**
 * Caché de bloques de un archivo.
 * - Pide cada bloque solo cuando hace falta y nunca dos veces a la vez.
 * - Cancela los bloques que salieron de la vista antes de responder.
 * - Ante 429/503 no pide nada hasta que pase Retry-After (o la espera creciente).
 */
export class TileStore {
  readonly fileId: number;
  readonly rows: number;
  readonly cols: number;
  readonly tileSize: number;
  /** Cuántas requests de bloques se enviaron (informativo). */
  requested = 0;

  private tiles = new Map<string, TileData>();
  private stale = new Set<string>();
  private inflight = new Map<string, AbortController>();
  private queue: string[] = [];
  private wanted = new Set<string>();
  private waiters = new Map<string, Waiter[]>();
  private failed = new Map<string, string>();
  private attempts = new Map<string, number>();
  private starts: number[] = [];
  private blockedUntil = 0;
  private timer: number | null = null;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(fileId: number, rows: number, cols: number, tileSize: number) {
    this.fileId = fileId;
    this.rows = rows;
    this.cols = cols;
    this.tileSize = tileSize;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  cellAt(r: number, c: number): CellInfo | null {
    const size = this.tileSize;
    const tile = this.tiles.get(tileKey(Math.floor(r / size), Math.floor(c / size)));
    if (!tile) return null;
    const index = (r - tile.originRow) * tile.cols + (c - tile.originCol);
    return {
      value: tile.values.charCodeAt(index) - 48,
      tremor: tile.tremor[index] ?? 0,
      bin: tile.bins[index] ?? '.',
    };
  }

  errorAt(r: number, c: number): string | null {
    const size = this.tileSize;
    return this.failed.get(tileKey(Math.floor(r / size), Math.floor(c / size))) ?? null;
  }

  failedKeys(): string[] {
    return Array.from(this.failed.keys());
  }

  /** Segundos que faltan para poder volver a pedir bloques (0 si no hay espera). */
  waitSeconds(): number {
    return Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000));
  }

  /** Bloques visibles ahora. Lo que ya no está a la vista se cancela. */
  setWanted(keys: Set<string>): void {
    this.wanted = keys;
    for (const [key, controller] of Array.from(this.inflight.entries())) {
      if (!keys.has(key) && !this.waiters.has(key)) {
        controller.abort();
        this.inflight.delete(key);
      }
    }
    this.queue = this.queue.filter((key) => keys.has(key) || this.waiters.has(key));
    keys.forEach((key) => this.enqueue(key));
    this.pump();
  }

  /** Pide un bloque aunque no esté a la vista (para completar un grupo que cruza bloques). */
  load(tileRow: number, tileCol: number): Promise<TileData> {
    const key = tileKey(tileRow, tileCol);
    const cached = this.tiles.get(key);
    if (cached && !this.stale.has(key)) return Promise.resolve(cached);
    return new Promise<TileData>((resolve, reject) => {
      const list = this.waiters.get(key) ?? [];
      list.push({ resolve, reject });
      this.waiters.set(key, list);
      this.failed.delete(key);
      this.attempts.delete(key);
      this.enqueue(key);
      this.pump();
    });
  }

  retryFailed(): void {
    const keys = this.failedKeys();
    this.failed.clear();
    keys.forEach((key) => {
      this.attempts.delete(key);
      if (this.wanted.has(key)) this.enqueue(key);
    });
    this.emit();
    this.pump();
  }

  /** Vuelve a pedir un bloque (por ejemplo tras un 409). Lo viejo se sigue viendo hasta que llegue lo nuevo. */
  invalidate(tileRow: number, tileCol: number): void {
    const key = tileKey(tileRow, tileCol);
    if (!this.tiles.has(key)) return;
    this.stale.add(key);
    if (this.wanted.has(key)) this.enqueue(key);
    this.pump();
  }

  /** Marca celdas con su caja sin volver a pedir la grilla. */
  applyBin(cells: Cell[], char: string): void {
    const size = this.tileSize;
    for (const cell of cells) {
      const tile = this.tiles.get(tileKey(Math.floor(cell.r / size), Math.floor(cell.c / size)));
      if (!tile) continue;
      tile.bins[(cell.r - tile.originRow) * tile.cols + (cell.c - tile.originCol)] = char;
    }
    this.emit();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.inflight.forEach((controller) => controller.abort());
    this.inflight.clear();
    this.queue = [];
    this.waiters.forEach((list) => list.forEach((waiter) => waiter.reject(new DOMException('Aborted', 'AbortError'))));
    this.waiters.clear();
    this.listeners.clear();
  }

  private enqueue(key: string): void {
    const fresh = this.tiles.has(key) && !this.stale.has(key);
    if (fresh || this.inflight.has(key) || this.failed.has(key) || this.queue.includes(key)) return;
    this.queue.push(key);
  }

  private schedule(ms: number): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.emit();
      this.pump();
    }, ms);
  }

  private pump(): void {
    if (this.disposed) return;
    while (this.queue.length > 0 && this.inflight.size < MAX_ACTIVE) {
      const now = Date.now();
      this.starts = this.starts.filter((time) => now - time < WINDOW_MS);
      let wait = 0;
      if (now < this.blockedUntil) wait = this.blockedUntil - now;
      else if (this.starts.length >= WINDOW_MAX) wait = WINDOW_MS - (now - this.starts[0]) + 25;
      if (wait > 0) {
        this.schedule(wait);
        return;
      }
      const key = this.queue.shift();
      if (key === undefined) return;
      this.starts.push(now);
      void this.fetchTile(key);
    }
  }

  private settle(key: string, tile: TileData | null, error: unknown): void {
    const list = this.waiters.get(key);
    if (!list) return;
    this.waiters.delete(key);
    list.forEach((waiter) => {
      if (tile) waiter.resolve(tile);
      else waiter.reject(error);
    });
  }

  private async fetchTile(key: string): Promise<void> {
    const controller = new AbortController();
    this.inflight.set(key, controller);
    this.requested += 1;
    const [tileRow, tileCol] = key.split(':');
    try {
      const res = await apiFetch<RawTile>(`/files/${this.fileId}/tiles/${tileRow}/${tileCol}`, {
        signal: controller.signal,
        retries: 0,
      });
      const tile = decodeTile(res.data);
      this.tiles.set(key, tile);
      this.stale.delete(key);
      this.attempts.delete(key);
      this.failed.delete(key);
      this.settle(key, tile, null);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        // Salió de la vista antes de responder.
      } else if (isApiError(error) && (error.status === 429 || error.status === 503 || error.status === 0)) {
        const attempt = this.attempts.get(key) ?? 0;
        this.attempts.set(key, attempt + 1);
        const wait =
          error.status === 429 ? (error.retryAfter ?? 2) * 1000 + 150 : backoffMs(attempt, error.retryAfter);
        // Nadie pide bloques hasta que pase la espera.
        this.blockedUntil = Math.max(this.blockedUntil, Date.now() + wait);
        if (attempt + 1 >= MAX_ATTEMPTS) {
          this.failed.set(key, error.message);
          this.settle(key, null, error);
        } else if (this.wanted.has(key) || this.waiters.has(key)) {
          this.queue.unshift(key);
        }
      } else {
        this.failed.set(key, error instanceof Error ? error.message : 'No se pudo cargar el bloque.');
        this.settle(key, null, error);
      }
    } finally {
      if (this.inflight.get(key) === controller) this.inflight.delete(key);
      if (!this.disposed) {
        this.emit();
        this.pump();
      }
    }
  }
}
