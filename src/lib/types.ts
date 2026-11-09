export type BinCode = 'WO' | 'FC' | 'DR' | 'MA';

export const BINS: BinCode[] = ['WO', 'FC', 'DR', 'MA'];

/** Carácter con el que el backend marca cada caja en `bins`. */
export const BIN_CHAR: Record<BinCode, string> = { WO: 'W', FC: 'F', DR: 'D', MA: 'M' };
export const CHAR_BIN: Record<string, BinCode | undefined> = { W: 'WO', F: 'FC', D: 'DR', M: 'MA' };

export function isBin(value: unknown): value is BinCode {
  return value === 'WO' || value === 'FC' || value === 'DR' || value === 'MA';
}

export interface Progress {
  WO: number;
  FC: number;
  DR: number;
  MA: number;
  overall: number;
}

export type FileStatus = 'ACTIVE' | 'COMPLETE';

export interface FileStats {
  progress: Progress;
  refinedGroups: number;
  totalGroups: number;
  mistakes: number;
  status: FileStatus;
}

export interface FileInfo extends FileStats {
  id: number;
  name: string;
  rows: number;
  cols: number;
  tileSize: number;
  updatedAt: string;
}

export interface FilePage {
  content: FileInfo[];
  totalElements: number;
  totalPages: number;
  page: number;
  size: number;
}

export interface Rules {
  tremorThreshold: number;
  connectivity: 4 | 8;
  minGroupSize: number;
  maxGroupSize: number;
  binning: { strategy: 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD'; order: BinCode[] };
}

export interface RefineResult {
  refinementId: number;
  bin: BinCode;
  size: number;
  file: FileStats;
}

export interface Cell {
  r: number;
  c: number;
}
