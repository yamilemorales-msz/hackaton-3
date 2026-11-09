import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { Alert, MessagePage, Splash, buttonClass, ghostButtonClass } from '../components/ui';
import { apiFetch, errorMessage, isApiError, isRecord } from '../lib/api';
import { findGroup } from '../lib/grid';
import type { Group } from '../lib/grid';
import { TileStore, tileKey } from '../lib/tileStore';
import { BINS, BIN_CHAR, CHAR_BIN, isBin } from '../lib/types';
import type { BinCode, Cell, FileInfo, FileStats, RefineResult, Rules } from '../lib/types';
import { useResource } from '../lib/useResource';

const CELL = 28; // px por celda
const MAX_CELLS = 2400; // nunca más de 2 500 celdas en el DOM

const BIN_NAME: Record<BinCode, string> = { WO: 'WO', FC: 'FC', DR: 'DR', MA: 'MA' };
const BIN_CELL: Record<BinCode, string> = {
  WO: 'bg-sky-900 text-sky-100',
  FC: 'bg-emerald-900 text-emerald-100',
  DR: 'bg-purple-900 text-purple-100',
  MA: 'bg-rose-900 text-rose-100',
};

interface Win {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

interface Selection extends Group {
  ids: Set<number>;
  /** Identidad estable del grupo: la misma intención reutiliza la misma Idempotency-Key. */
  signature: string;
}

interface Notice {
  tone: 'error' | 'info';
  text: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function percent(value: number): string {
  return `${Math.round(value * 100)} %`;
}

function parseIndex(raw: string | null, max: number): number {
  const value = Number(raw);
  return Number.isInteger(value) ? clamp(value, 0, max) : 0;
}

export default function RefinePage() {
  const { id } = useParams();
  const fileId = Number(id);
  const valid = Number.isInteger(fileId) && fileId > 0;
  const file = useResource<FileInfo>(valid ? `/files/${fileId}` : null);
  const rules = useResource<Rules>(valid ? `/files/${fileId}/rules` : null);

  if (!valid) {
    return (
      <MessagePage title="Archivo no válido">
        <p>El identificador de la URL no corresponde a un archivo.</p>
      </MessagePage>
    );
  }
  if (file.data && rules.data) return <Grid key={file.data.id} file={file.data} rules={rules.data} />;
  if (file.error || rules.error) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-3">
        <h1 className="text-2xl font-semibold">No se pudo abrir el archivo</h1>
        <Alert>{file.error ?? rules.error}</Alert>
        <div className="flex gap-2">
          <button
            type="button"
            className={buttonClass}
            onClick={() => {
              file.reload();
              rules.reload();
            }}
          >
            Reintentar
          </button>
          <Link to="/files" className={ghostButtonClass}>
            Volver a archivos
          </Link>
        </div>
      </div>
    );
  }
  return <Splash label="Abriendo archivo…" />;
}

function Grid({ file, rules }: { file: FileInfo; rules: Rules }) {
  const { can } = useAuth();
  const canRefine = can('files:refine');
  const { rows, cols, tileSize } = file;
  const [params, setParams] = useSearchParams();

  const [store, setStore] = useState<TileStore | null>(null);
  const [, bump] = useReducer((value: number) => value + 1, 0);
  const [stats, setStats] = useState<FileStats>({
    progress: file.progress,
    refinedGroups: file.refinedGroups,
    totalGroups: file.totalGroups,
    mistakes: file.mistakes,
    status: file.status,
  });
  const [win, setWin] = useState<Win>({ r0: 0, r1: 0, c0: 0, c1: 0 });
  const [focus, setFocus] = useState<Cell>(() => ({
    r: parseIndex(params.get('r'), rows - 1),
    c: parseIndex(params.get('c'), cols - 1),
  }));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [showGrid, setShowGrid] = useState(false);

  const scroller = useRef<HTMLDivElement | null>(null);
  const ghost = useRef<HTMLDivElement | null>(null);
  const wantFocus = useRef(false);
  const selectToken = useRef(0);
  const busyRef = useRef(false);
  const keys = useRef(new Map<string, string>());
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const frame = useRef<number | null>(null);
  const urlTimer = useRef<number | null>(null);
  const initial = useRef<Cell>(focus);

  // Caché de bloques: vive mientras la grilla está abierta.
  useEffect(() => {
    const created = new TileStore(file.id, rows, cols, tileSize);
    setStore(created);
    const off = created.subscribe(bump);
    return () => {
      off();
      created.dispose();
    };
  }, [file.id, rows, cols, tileSize]);

  const measure = useCallback((): void => {
    const el = scroller.current;
    if (!el) return;
    const rowCount = Math.min(Math.ceil(el.clientHeight / CELL) + 2, 40);
    const colCount = Math.min(Math.ceil(el.clientWidth / CELL) + 2, Math.floor(MAX_CELLS / rowCount));
    const r0 = clamp(Math.floor(el.scrollTop / CELL) - 1, 0, rows - 1);
    const c0 = clamp(Math.floor(el.scrollLeft / CELL) - 1, 0, cols - 1);
    const next: Win = {
      r0,
      c0,
      r1: Math.min(rows - 1, r0 + rowCount - 1),
      c1: Math.min(cols - 1, c0 + colCount - 1),
    };
    setWin((prev) =>
      prev.r0 === next.r0 && prev.r1 === next.r1 && prev.c0 === next.c0 && prev.c1 === next.c1 ? prev : next,
    );
  }, [rows, cols]);

  // Posición inicial desde la URL (?r=&c=).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.scrollTop = initial.current.r * CELL;
    el.scrollLeft = initial.current.c * CELL;
    measure();
  }, [measure, showGrid]);

  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      if (urlTimer.current !== null) window.clearTimeout(urlTimer.current);
    };
  }, [measure]);

  // Solo se piden los bloques que hacen falta para lo que se ve.
  useEffect(() => {
    if (!store) return;
    const wanted = new Set<string>();
    const tr1 = Math.floor(win.r1 / tileSize);
    const tc1 = Math.floor(win.c1 / tileSize);
    for (let tr = Math.floor(win.r0 / tileSize); tr <= tr1; tr += 1) {
      for (let tc = Math.floor(win.c0 / tileSize); tc <= tc1; tc += 1) wanted.add(tileKey(tr, tc));
    }
    store.setWanted(wanted);
  }, [store, win, tileSize]);

  // El foco de teclado sigue a la celda activa (que siempre está en el DOM).
  useEffect(() => {
    if (!wantFocus.current) return;
    const el = scroller.current?.querySelector(`[data-r="${focus.r}"][data-c="${focus.c}"]`);
    if (el instanceof HTMLElement) {
      el.focus({ preventScroll: true });
      wantFocus.current = false;
    }
  });

  const onScroll = (): void => {
    if (frame.current === null) {
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        measure();
      });
    }
    // La URL guarda la posición sin llenar el historial.
    if (urlTimer.current !== null) window.clearTimeout(urlTimer.current);
    urlTimer.current = window.setTimeout(() => {
      const el = scroller.current;
      if (!el) return;
      const next = new URLSearchParams();
      next.set('r', String(Math.floor(el.scrollTop / CELL)));
      next.set('c', String(Math.floor(el.scrollLeft / CELL)));
      setParams(next, { replace: true });
    }, 400);
  };

  const ensureVisible = (cell: Cell): void => {
    const el = scroller.current;
    if (!el) return;
    const top = cell.r * CELL;
    const left = cell.c * CELL;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + CELL > el.scrollTop + el.clientHeight) el.scrollTop = top + CELL - el.clientHeight;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (left + CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = left + CELL - el.clientWidth;
  };

  const moveFocus = (r: number, c: number): void => {
    const next = { r: clamp(r, 0, rows - 1), c: clamp(c, 0, cols - 1) };
    wantFocus.current = true;
    setFocus(next);
    ensureVisible(next);
  };

  const selectAt = (cell: Cell): void => {
    if (!store) return;
    selectToken.current += 1;
    const token = selectToken.current;
    setSelecting(true);
    setNotice(null);
    findGroup(store, rules, cell)
      .then((group) => {
        if (token !== selectToken.current) return; // llegó tarde: hay una selección más nueva
        if (!group) {
          setSelection(null);
          setNotice({ tone: 'info', text: 'Esa celda no da miedo: elige un dígito que tiemble.' });
          return;
        }
        const ids = new Set<number>();
        let min = Number.MAX_SAFE_INTEGER;
        group.cells.forEach((item) => {
          const cellId = item.r * cols + item.c;
          ids.add(cellId);
          if (cellId < min) min = cellId;
        });
        setSelection({ ...group, ids, signature: `${min}:${group.cells.length}` });
      })
      .catch((error: unknown) => {
        if (token !== selectToken.current) return;
        setSelection(null);
        setNotice({ tone: 'error', text: `No se pudo completar el grupo: ${errorMessage(error)}` });
      })
      .finally(() => {
        if (token === selectToken.current) setSelecting(false);
      });
  };

  const refine = (bin: BinCode): void => {
    if (!store || !selection || busyRef.current) return; // doble clic o doble Enter: una sola request
    if (!canRefine) {
      setNotice({ tone: 'error', text: 'Tu rol no tiene permiso para refinar (files:refine).' });
      return;
    }
    if (selection.refinedAs) {
      setNotice({ tone: 'info', text: `Ese grupo ya está en la caja ${selection.refinedAs}.` });
      return;
    }
    if (selection.noise) {
      setNotice({ tone: 'info', text: 'Ese grupo es ruido: no se puede refinar. Elige otro.' });
      return;
    }
    const current = selection;
    const intent = `${current.signature}|${bin}`;
    let key = keys.current.get(intent);
    if (!key) {
      key = crypto.randomUUID(); // un UUID por intención; los reintentos lo reutilizan
      keys.current.set(intent, key);
    }
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    apiFetch<RefineResult>(`/files/${file.id}/refinements`, {
      method: 'POST',
      headers: { 'Idempotency-Key': key },
      body: { bin, cells: current.cells },
      retries: 5,
    })
      .then((res) => {
        store.applyBin(current.cells, BIN_CHAR[bin]);
        setStats(res.data.file);
        setSelection(null);
        setNotice({ tone: 'info', text: `Grupo de ${res.data.size} celdas refinado en ${bin}.` });
      })
      .catch((error: unknown) => {
        if (!isApiError(error)) {
          setNotice({ tone: 'error', text: errorMessage(error) });
          return;
        }
        const details: Record<string, unknown> = isRecord(error.details) ? error.details : {};
        if (error.code === 'WRONG_BIN') {
          const mistakes = details.mistakes;
          if (typeof mistakes === 'number') setStats((prev) => ({ ...prev, mistakes }));
          setNotice({
            tone: 'error',
            text: `Caja equivocada: Lumon lo anotó. Según las reglas, este grupo va en ${current.bin ?? 'otra caja'}.`,
          });
        } else if (error.code === 'ALREADY_REFINED') {
          if (Array.isArray(details.tiles)) {
            details.tiles.forEach((pair: unknown) => {
              if (Array.isArray(pair) && typeof pair[0] === 'number' && typeof pair[1] === 'number') {
                store.invalidate(pair[0], pair[1]);
              }
            });
          }
          setSelection(null);
          setNotice({
            tone: 'error',
            text: 'Alguien ya refinó ese grupo. Se están actualizando los bloques: elige otro grupo.',
          });
        } else if (error.code === 'GROUP_CLAIMED') {
          const holder: Record<string, unknown> = isRecord(details.holder) ? details.holder : {};
          const name = typeof holder.displayName === 'string' ? holder.displayName : 'otro refinador';
          setNotice({
            tone: 'error',
            text: `Ese grupo lo tiene reservado ${name}. Espera a que lo libere y vuelve a intentarlo, o elige otro.`,
          });
        } else if (error.code === 'GROUP_INVALID') {
          const reason = typeof details.reason === 'string' ? details.reason : '';
          const hint =
            reason === 'INCOMPLETE'
              ? 'El grupo está incompleto: vuelve a seleccionarlo para incluir todas sus celdas.'
              : reason === 'SIZE_OUT_OF_RANGE'
                ? 'Ese grupo es ruido por su tamaño: no se puede refinar.'
                : reason === 'NOT_CONNECTED'
                  ? 'Las celdas pertenecen a más de un grupo: vuelve a seleccionarlo.'
                  : 'Alguna celda no da miedo: vuelve a seleccionar el grupo.';
          setSelection(null);
          setNotice({ tone: 'error', text: hint });
        } else {
          setNotice({
            tone: 'error',
            text: `${errorMessage(error)} Puedes reintentar: el grupo no se refinará dos veces.`,
          });
        }
      })
      .finally(() => {
        busyRef.current = false;
        setBusy(false);
      });
  };

  const cellFromTarget = (target: EventTarget | null): Cell | null => {
    if (!(target instanceof HTMLElement)) return null;
    const el = target.closest('[data-r]');
    if (!(el instanceof HTMLElement)) return null;
    const r = Number(el.dataset.r);
    const c = Number(el.dataset.c);
    return Number.isInteger(r) && Number.isInteger(c) ? { r, c } : null;
  };

  const hideGhost = (): void => {
    if (ghost.current) ghost.current.style.display = 'none';
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    const cell = cellFromTarget(event.target);
    if (!cell) return;
    setFocus(cell);
    if (selection?.ids.has(cell.r * cols + cell.c)) {
      // Arrastre del grupo seleccionado hacia una caja (Pointer Events, sin librería).
      drag.current = { x: event.clientX, y: event.clientY, active: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    } else {
      selectAt(cell);
    }
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    if (!state) return;
    if (!state.active && Math.hypot(event.clientX - state.x, event.clientY - state.y) > 4) state.active = true;
    if (state.active && ghost.current) {
      ghost.current.style.display = 'block';
      ghost.current.style.transform = `translate(${event.clientX + 12}px, ${event.clientY + 12}px)`;
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    const state = drag.current;
    drag.current = null;
    hideGhost();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!state?.active) return;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-bin]');
    if (target instanceof HTMLElement && isBin(target.dataset.bin)) refine(target.dataset.bin);
  };

  const onPointerCancel = (): void => {
    drag.current = null;
    hideGhost();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const el = scroller.current;
    const pageRows = el ? Math.max(1, Math.floor(el.clientHeight / CELL) - 1) : 10;
    const { r, c } = focus;
    let handled = true;
    switch (event.key) {
      case 'ArrowUp':
        moveFocus(r - 1, c);
        break;
      case 'ArrowDown':
        moveFocus(r + 1, c);
        break;
      case 'ArrowLeft':
        moveFocus(r, c - 1);
        break;
      case 'ArrowRight':
        moveFocus(r, c + 1);
        break;
      case 'PageUp':
        moveFocus(r - pageRows, c);
        break;
      case 'PageDown':
        moveFocus(r + pageRows, c);
        break;
      case 'Home':
        if (event.ctrlKey) moveFocus(0, 0);
        else moveFocus(r, 0);
        break;
      case 'End':
        if (event.ctrlKey) moveFocus(rows - 1, cols - 1);
        else moveFocus(r, cols - 1);
        break;
      case 'Enter':
      case ' ':
        // Primer Enter: selecciona el grupo. Segundo Enter: lo lleva a la caja que indican las reglas.
        if (selection?.ids.has(r * cols + c)) {
          if (selection.bin) refine(selection.bin);
          else refine('WO');
        } else {
          selectAt(focus);
        }
        break;
      case 'Escape':
        selectToken.current += 1;
        setSelection(null);
        setSelecting(false);
        break;
      case '1':
      case '2':
      case '3':
      case '4':
        refine(BINS[Number(event.key) - 1]);
        break;
      default:
        handled = false;
    }
    if (handled) event.preventDefault();
  };

  const renderRow = (r: number, c0: number, c1: number, key: string): ReactNode => {
    const cells: ReactNode[] = [];
    for (let c = c0; c <= c1; c += 1) {
      const info = store ? store.cellAt(r, c) : null;
      const selected = selection?.ids.has(r * cols + c) ?? false;
      const focused = focus.r === r && focus.c === c;
      const refined = info ? CHAR_BIN[info.bin] : undefined;
      const scary = info !== null && info.tremor >= rules.tremorThreshold;
      let cls = 'lumon-cell';
      let label: string | undefined;
      if (!info) {
        cls += ' text-slate-500';
        label = 'Cargando';
      } else if (selected) {
        cls += ' bg-amber-300 font-bold text-slate-950';
        label = `${info.value}, seleccionado`;
      } else if (refined) {
        cls += ` ${BIN_CELL[refined]}`;
        label = `${info.value}, refinado en ${refined}`;
      } else if (scary) {
        const span = Math.max(1, 100 - rules.tremorThreshold);
        const level = Math.min(3, 1 + Math.floor(((info.tremor - rules.tremorThreshold) * 3) / span));
        cls += ` lumon-scary lumon-scary-${level}`;
        label = `${info.value}, da miedo`;
      } else {
        cls += ' text-sky-200';
      }
      cells.push(
        <div
          key={c}
          role="gridcell"
          aria-colindex={c + 1}
          aria-selected={selected}
          aria-label={label}
          tabIndex={focused ? 0 : -1}
          data-r={r}
          data-c={c}
          className={cls}
          style={{ left: c * CELL, width: CELL, height: CELL }}
        >
          {info ? info.value : '·'}
        </div>,
      );
    }
    return (
      <div key={key} role="row" aria-rowindex={r + 1} className="absolute left-0" style={{ top: r * CELL, height: CELL }}>
        {cells}
      </div>
    );
  };

  const complete = stats.status === 'COMPLETE' || stats.progress.overall >= 1;

  if (complete && !showGrid) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-4 py-8">
        <h1 className="text-3xl font-semibold">Archivo completado</h1>
        <p role="status" className="text-slate-200">
          {file.name} llegó al 100 %. {stats.refinedGroups} de {stats.totalGroups} grupos refinados, con{' '}
          {stats.mistakes} errores. Cada número encontró su caja.
        </p>
        <div className="flex gap-2">
          <Link to="/files" className={buttonClass}>
            Volver a archivos
          </Link>
          <button type="button" className={ghostButtonClass} onClick={() => setShowGrid(true)}>
            Ver la grilla
          </button>
        </div>
      </div>
    );
  }

  const rowNodes: ReactNode[] = [];
  for (let r = win.r0; r <= win.r1; r += 1) rowNodes.push(renderRow(r, win.c0, win.c1, `r${r}`));
  const focusOutside = focus.r < win.r0 || focus.r > win.r1 || focus.c < win.c0 || focus.c > win.c1;
  if (focusOutside) rowNodes.push(renderRow(focus.r, focus.c, focus.c, 'focus'));

  const wait = store ? store.waitSeconds() : 0;
  const failed = store ? store.failedKeys().length : 0;

  let summary = 'Elige un dígito que tiemble para seleccionar su grupo.';
  if (selecting) summary = 'Completando el grupo…';
  else if (selection) {
    const count = selection.capped ? `más de ${rules.maxGroupSize}` : String(selection.cells.length);
    if (selection.refinedAs) summary = `Grupo de ${count} celdas: ya está refinado en ${selection.refinedAs}.`;
    else if (selection.noise) {
      summary = `Grupo de ${count} celdas: es ruido (solo se refinan grupos de ${rules.minGroupSize} a ${rules.maxGroupSize}).`;
    } else summary = `Grupo de ${count} celdas → caja ${selection.bin ?? '?'}. Arrástralo a su caja o pulsa Enter.`;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-semibold">{file.name}</h1>
        <p className="text-sm text-slate-300">
          {rows} × {cols} · {stats.refinedGroups}/{stats.totalGroups} grupos · {stats.mistakes} errores · total{' '}
          {percent(stats.progress.overall)} · bloques pedidos: {store ? store.requested : 0}
        </p>
        <Link to="/files" className="ml-auto text-sm text-sky-300 underline">
          Volver a archivos
        </Link>
      </div>

      <p role="status" aria-live="polite" className="min-h-6 text-sm text-slate-100">
        {summary}
      </p>
      {notice ? <Alert tone={notice.tone}>{notice.text}</Alert> : null}
      {wait > 0 ? (
        <p role="status" className="text-sm text-amber-200">
          Lumon pidió esperar: los bloques se reanudan en {wait} s.
        </p>
      ) : null}
      {failed > 0 ? (
        <div className="flex items-center gap-3">
          <Alert>No se pudieron cargar {failed} bloques.</Alert>
          <button type="button" className={ghostButtonClass} onClick={() => store?.retryFailed()}>
            Reintentar bloques
          </button>
        </div>
      ) : null}

      <div
        ref={scroller}
        onScroll={onScroll}
        className="h-[55vh] max-h-[640px] min-h-[240px] overflow-auto rounded border border-slate-700 bg-slate-950"
      >
        <div
          role="grid"
          aria-label={`Grilla de ${file.name}`}
          aria-rowcount={rows}
          aria-colcount={cols}
          className="relative"
          style={{ width: cols * CELL, height: rows * CELL }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onKeyDown={onKeyDown}
        >
          {rowNodes}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="group" aria-label="Cajas">
        {BINS.map((bin, index) => {
          const target = selection !== null && !selection.noise && !selection.refinedAs;
          return (
            <button
              key={bin}
              type="button"
              data-bin={bin}
              disabled={busy || !target || !canRefine}
              onClick={() => refine(bin)}
              className="flex flex-col gap-2 rounded border border-slate-500 bg-slate-900 p-3 text-left hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span className="flex items-baseline justify-between">
                <span className="text-lg font-semibold">{BIN_NAME[bin]}</span>
                <span className="text-xs text-slate-300">tecla {index + 1}</span>
              </span>
              <progress className="h-2 w-full" max={1} value={stats.progress[bin]} aria-label={`Progreso de la caja ${bin}`} />
              <span className="text-sm text-slate-200">{percent(stats.progress[bin])}</span>
            </button>
          );
        })}
      </div>
      {busy ? (
        <p role="status" className="text-sm text-slate-200">
          Refinando…
        </p>
      ) : null}
      {!canRefine ? <p className="text-sm text-slate-300">Tu rol solo puede ver la grilla, no refinar.</p> : null}
      <p className="text-xs text-slate-400">
        Teclado: flechas, RePág, AvPág, Inicio y Fin mueven el foco; Enter selecciona el grupo y vuelve a Enter para
        enviarlo; 1 a 4 eligen la caja; Esc cancela.
      </p>

      <div
        ref={ghost}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-50 hidden rounded bg-amber-300 px-2 py-1 text-sm font-semibold text-slate-950"
      >
        Grupo de {selection ? selection.cells.length : 0} celdas
      </div>
    </div>
  );
}
