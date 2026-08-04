/**
 * El único error boundary de la app.
 *
 * Existe porque el code splitting lo vuelve obligatorio, no como buena práctica genérica.
 * Con `React.lazy`, un chunk que no se puede descargar —el caso normal: se desplegó una
 * versión nueva y el usuario tenía la pestaña vieja abierta, así que el archivo con hash que
 * su HTML pide ya no existe— tira una excepción durante el render y deja la **pantalla en
 * blanco**. `closerStore.tsx` ya avisaba de esto: *"esta app no tiene error boundary en
 * ninguna vista, y una pantalla en blanco sería peor que el demo de siempre"*.
 *
 * El fallback ofrece recargar porque, para el caso que de verdad ocurre, recargar ES la cura:
 * trae el HTML nuevo con los hashes nuevos.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface Estado {
  error: Error | null;
}

export class LimiteDeError extends Component<Props, Estado> {
  state: Estado = { error: null };

  static getDerivedStateFromError(error: Error): Estado {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Sin servicio de telemetría en el proyecto: la consola es donde alguien lo va a ver.
    console.error("Vista caída:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-md text-center space-y-4">
          <h2 className="text-lg font-semibold text-foreground">No se pudo cargar esta vista</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Suele pasar cuando se publicó una versión nueva mientras tenías la pestaña abierta.
            Recargar lo resuelve.
          </p>
          {/* El mensaje real, en chico: si es otra cosa, esconderlo obliga a abrir la consola. */}
          <p className="text-[11px] text-muted-foreground/70 font-mono break-words">{this.state.error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center h-10 px-5 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 text-sm font-medium transition-colors"
          >
            Recargar
          </button>
        </div>
      </div>
    );
  }
}
