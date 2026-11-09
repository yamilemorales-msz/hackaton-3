import type { CellInfo, TileStore } from './tileStore';
import { CHAR_BIN } from './types';
import type { BinCode, Cell, Rules } from './types';

export interface Group {
  cells: Cell[];
  /** Se dejó de recorrer porque ya supera el máximo: es ruido. */
  capped: boolean;
  noise: boolean;
  /** Caja que corresponde según las reglas del archivo (null si es ruido). */
  bin: BinCode | null;
  /** Caja en la que ya está refinado, si lo está. */
  refinedAs: BinCode | null;
}

const DIRS4: Array<[number, number]> = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const DIRS8: Array<[number, number]> = [...DIRS4, [-1, -1], [-1, 1], [1, -1], [1, 1]];

/**
 * Componente conexo de celdas que dan miedo a partir de `start` (BFS).
 * Si el grupo cruza bloques que no están cargados, los pide.
 * Devuelve null si la celda inicial no da miedo.
 */
export async function findGroup(store: TileStore, rules: Rules, start: Cell): Promise<Group | null> {
  const size = store.tileSize;
  const info = async (r: number, c: number): Promise<CellInfo | null> => {
    const cached = store.cellAt(r, c);
    if (cached) return cached;
    await store.load(Math.floor(r / size), Math.floor(c / size));
    return store.cellAt(r, c);
  };

  const first = await info(start.r, start.c);
  if (!first || first.tremor < rules.tremorThreshold) return null;

  const dirs = rules.connectivity === 8 ? DIRS8 : DIRS4;
  const limit = rules.maxGroupSize + 1;
  const seen = new Set<number>([start.r * store.cols + start.c]);
  const queue: Cell[] = [start];
  const cells: Cell[] = [];
  let sum = 0;
  let max = 0;
  let refinedAs: BinCode | null = null;
  let capped = false;

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    const cell = await info(current.r, current.c);
    if (!cell || cell.tremor < rules.tremorThreshold) continue;
    cells.push(current);
    sum += cell.value;
    max = Math.max(max, cell.value);
    const already = CHAR_BIN[cell.bin];
    if (already) refinedAs = already;
    if (cells.length >= limit) {
      capped = true;
      break;
    }
    for (const [dr, dc] of dirs) {
      const r = current.r + dr;
      const c = current.c + dc;
      if (r < 0 || c < 0 || r >= store.rows || c >= store.cols) continue;
      const id = r * store.cols + c;
      if (seen.has(id)) continue;
      seen.add(id);
      queue.push({ r, c });
    }
  }

  const noise = capped || cells.length < rules.minGroupSize || cells.length > rules.maxGroupSize;
  const index = (rules.binning.strategy === 'MAX_DIGIT_MOD' ? max : sum) % 4;
  const bin = noise ? null : (rules.binning.order[index] ?? null);
  return { cells, capped, noise, bin, refinedAs };
}
