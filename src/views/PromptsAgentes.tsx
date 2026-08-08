/**
 * Auditoría de Agentes › **Prompts** — el único lugar donde se edita el prompt de un agente.
 *
 * ── Por qué vive acá y no en Ajustes ──────────────────────────────────
 *
 * Hasta el 2026-08-07 estos cuatro campos estaban en Ajustes › Credenciales, junto a las claves
 * de API, y por eso exigían `admin`. Quien mantiene el prompt del agente en GHL es el **técnico**,
 * así que tenerlos ahí obligaba a darle acceso al PIT de GHL, a la key de Anthropic y al token de
 * Meta a alguien que solo necesita editar un texto.
 *
 * Es una **mudanza**, no una copia: allá no quedó ni la lectura. Dos campos editando el mismo dato
 * es el patrón que este proyecto ya pagó caro.
 *
 * El permiso real lo verifica `api/agentes/prompts.ts`. Esconder la pestaña es cosmética.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Check, AlertTriangle, FileText } from "lucide-react";
import { cn } from "../lib/utils";
import { fetchPrompts, guardarPrompts, type PromptAdmin } from "../lib/api";

export default function PromptsAgentes() {
  const [prompts, setPrompts] = useState<PromptAdmin[] | null>(null);
  /**
   * Los tres estados son distinguibles a propósito (regla D3): `null` mientras carga, `[]` cuando
   * cargó y no hay nada, y `error` cuando no se pudo saber. Un `[]` que también significa "no
   * pude averiguarlo" es exactamente lo que la regla 2 del proyecto prohíbe.
   */
  const [error, setError] = useState<string | null>(null);
  const [cambios, setCambios] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const cargar = useCallback(async () => {
    setError(null);
    const r = await fetchPrompts();
    if (!r.ok) {
      setError(r.error ?? "No se pudieron cargar los prompts.");
      setPrompts(null);
      return;
    }
    setPrompts(r.prompts ?? []);
    setCambios({});
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const editar = (clave: string, valor: string) => {
    setCambios((c) => ({ ...c, [clave]: valor }));
    setGuardado(false);
  };

  const hayCambios = prompts !== null && Object.entries(cambios).some(([k, v]) => {
    const original = prompts.find((p) => p.clave === k)?.texto ?? "";
    return v !== original;
  });

  const guardar = async () => {
    if (!hayCambios) return;
    setGuardando(true);
    setError(null);
    const r = await guardarPrompts(cambios);
    setGuardando(false);
    if (!r.ok) {
      setError(r.error ?? "No se pudo guardar.");
      return;
    }
    setGuardado(true);
    // Se relee para traer el hash nuevo: es la versión que después dice "el prompt cambió desde
    // que se detectó este hallazgo", y mostrar el viejo sería mentir sobre qué está corriendo.
    await cargar();
  };

  if (error && prompts === null) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 shrink-0" />
        <div className="space-y-2">
          <p className="text-sm text-foreground">{error}</p>
          <button onClick={() => void cargar()} className="text-xs font-medium text-primary hover:underline">
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (prompts === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-10">
        <Loader2 className="w-4 h-4 animate-spin" />
        Cargando los prompts…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-medium text-foreground">Prompts de los agentes</h2>
        <p className="text-sm text-muted-foreground">
          Lo que el auditor usa como referencia de cómo debería comportarse cada agente. Guardar no requiere
          desplegar: el siguiente análisis lo toma solo.
        </p>
      </div>

      {prompts.map((p) => {
        const texto = cambios[p.clave] ?? p.texto;
        return (
          <div key={p.clave} className="rounded-xl border border-border/60 bg-card p-4 space-y-3">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">{p.agente}</span>
                </div>
                {/**
                 * Los que todavía no tienen auditor lo DICEN. Atenuarlos sin explicación se lee
                 * como "está roto", y no lo está: el auditor de ese agente no existe todavía.
                 */}
                {p.auditado ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1">
                    <Check className="w-3 h-3" /> Hay un auditor usándolo
                  </span>
                ) : (
                  <span className="text-[11px] text-muted-foreground">
                    Todavía no hay un auditor para este agente. Se guarda igual, y lo va a usar cuando exista.
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground font-mono shrink-0">
                {p.hash ? `${p.lineas} ${p.lineas === 1 ? "línea" : "líneas"} · ${p.hash}` : "sin cargar"}
              </span>
            </div>

            <textarea
              value={texto}
              onChange={(e) => editar(p.clave, e.target.value)}
              rows={10}
              placeholder="Pegá acá el prompt del agente…"
              className="w-full rounded-lg border border-input bg-background dark:bg-secondary px-3 py-2 text-xs font-mono resize-y leading-relaxed"
            />
          </div>
        );
      })}

      {error && (
        <p className="text-xs text-destructive inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" />
          {error}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 sticky bottom-0 py-3 bg-[#fcfcfd]/90 dark:bg-background/90 backdrop-blur border-t border-border/40">
        {guardado && !hayCambios && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 inline-flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            Guardado
          </span>
        )}
        <button
          onClick={() => void guardar()}
          disabled={!hayCambios || guardando}
          className={cn(
            "h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium",
            "disabled:opacity-40 inline-flex items-center gap-2",
          )}
        >
          {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Guardar cambios
        </button>
      </div>
    </div>
  );
}
