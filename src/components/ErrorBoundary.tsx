import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** Un error de render en una ruta no deja la app en blanco. Se reinicia con `key` al cambiar de ruta. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Error de render', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="mx-auto flex max-w-xl flex-col items-start gap-4 p-8">
        <h1 className="text-2xl font-semibold">Algo falló en esta pantalla</h1>
        <p className="text-slate-300">La consola sigue funcionando. Puedes volver o intentar de nuevo.</p>
        <div className="flex gap-3">
          <a href="/" className="rounded bg-sky-300 px-4 py-2 font-medium text-slate-950 hover:bg-sky-200">
            Volver al inicio
          </a>
          <button
            type="button"
            className="rounded border border-slate-500 px-4 py-2 hover:bg-slate-800"
            onClick={() => this.setState({ failed: false })}
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }
}
