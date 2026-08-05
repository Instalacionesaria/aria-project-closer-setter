/**
 * El ÚNICO módulo de relojes del frontend (doc §10).
 *
 * Antes había 8 `setInterval` sueltos repartidos en 4 archivos, cada uno golpeando a GHL
 * vía el backend cada 10-30s, incluso con la pestaña oculta. Ahora todo reloj del front se
 * registra acá, y el módulo garantiza las dos reglas que ningún reloj suelto puede
 * garantizar por sí mismo:
 *
 *   1. **Pestaña oculta = CERO intervalos corriendo.** Un solo listener de
 *      `visibilitychange` pausa y reanuda todos. Al volver, cada reloj dispara UNA vez de
 *      inmediato (el usuario quiere ver fresco, no esperar el próximo tick).
 *   2. **Un reloj por clave.** Registrar dos veces la misma clave reemplaza el anterior —
 *      dos montajes del mismo componente no duplican el tráfico.
 *
 * NOTA FUTURA (no implementar): cuando se active Supabase Realtime, este módulo se
 * reemplaza por suscripciones y el frontend deja de tener relojes. Está encapsulado
 * justamente para que ese cambio sea de un solo archivo.
 */

import { useEffect } from "react";

type Tarea = {
  fn: () => void;
  ms: number;
  timer: ReturnType<typeof setInterval> | null;
};

const tareas = new Map<string, Tarea>();
let escuchando = false;

const visible = () => typeof document === "undefined" || document.visibilityState === "visible";

function arrancar(t: Tarea) {
  if (t.timer !== null) return;
  t.timer = setInterval(() => {
    if (visible()) t.fn();
  }, t.ms);
}

function frenar(t: Tarea) {
  if (t.timer === null) return;
  clearInterval(t.timer);
  t.timer = null;
}

function escuchar() {
  if (escuchando || typeof document === "undefined") return;
  escuchando = true;
  document.addEventListener("visibilitychange", () => {
    if (visible()) {
      // Al recuperar el foco: un disparo inmediato por reloj + se reanudan los intervalos.
      for (const t of tareas.values()) {
        t.fn();
        arrancar(t);
      }
    } else {
      for (const t of tareas.values()) frenar(t);
    }
  });
}

/**
 * Registra un reloj. Dispara `fn` una vez de inmediato (si la pestaña está visible) y
 * después cada `ms`. Devuelve la función para darlo de baja.
 */
export function registrarReloj(clave: string, fn: () => void, ms: number): () => void {
  escuchar();
  const previa = tareas.get(clave);
  if (previa) frenar(previa);

  const t: Tarea = { fn, ms, timer: null };
  tareas.set(clave, t);
  if (visible()) {
    fn();
    arrancar(t);
  }

  return () => {
    const actual = tareas.get(clave);
    if (actual === t) {
      frenar(t);
      tareas.delete(clave);
    }
  };
}

/** El mismo registro, como hook: vive mientras el componente esté montado. */
export function usePolling(clave: string, fn: () => void, ms: number): void {
  useEffect(() => registrarReloj(clave, fn, ms), [clave, ms, fn]);
}

/** Cadencias oficiales (doc §10) — una sola tabla para que nadie invente la suya. */
export const CADENCIA = {
  /**
   * EL reloj del closer (§56): ingesta desde GHL + las cinco colas de Mi Día, en un request.
   *
   * Que esto sea 10s NO es el rate limit de la ingesta: el candado del backend garantiza
   * que la reconciliación corra como mucho una vez por `VENTANA_MS`
   * (`api/_lib/reconciliacion.ts`) sin importar cuántas pestañas ni con qué frecuencia
   * pingueen. Se puede mover esta perilla sin tocar el presupuesto de GHL.
   */
  tick: 10_000,
  /** @deprecated §56 — quedó por si algún día se vuelve a separar. Nadie lo usa. */
  reconciliar: 10_000,
  /** @deprecated §56 — lo absorbió `tick`. */
  miDia: 10_000,
  /** Chat con la ficha abierta. */
  chat: 5_000,
  /** Métricas de Inicio. */
  inicio: 60_000,
  /** Urgentes del Setter (decisión de Fabio 2026-07-31: 10s→60s, único cambio al Setter). */
  setterUrgentes: 60_000,
} as const;
