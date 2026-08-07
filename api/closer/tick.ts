/**
 * `POST /api/closer/tick` — el reloj único del closer (§56).
 *
 * Antes eran DOS relojes de 10 s haciendo DOS requests: `POST /api/closer/reconciliar`
 * (ingesta desde GHL) y `GET /api/closer/mi-dia` (las cinco colas desde Supabase). Ahora es
 * uno solo. Baja de 12-13 a 6-7 requests por minuto por pestaña.
 *
 * ## Por qué en SECUENCIA y no en paralelo
 *
 * Los dos relojes viejos no estaban desfasados: `registrarReloj` dispara al registrarse, los
 * dos se registran en el mismo montaje y con la misma cadencia, así que estaban **en fase**.
 * Mi Día leía la tabla microsegundos ANTES de que la reconciliación escribiera, o sea que un
 * mensaje entrante detectado por la reconciliación no aparecía en el Buzón hasta el tick
 * siguiente: ~15 s en total.
 *
 * Corriendo la reconciliación PRIMERO, Mi Día ve las escrituras de este mismo ciclo y el
 * mensaje aparece de inmediato (~6 s, dominados por la ventana del candado). El precio es
 * ~0,5-1 s de latencia sobre Mi Día en el caso normal.
 *
 * Ojo con el alcance de esa mejora: aplica al **Buzón**, que depende de `ultimo_entrante_el`.
 * Urgentes depende de los TAGS cacheados, y la reconciliación no refresca tags — eso lo hace
 * el webhook o el cron. No es más rápido.
 *
 * ## Por qué las dos mitades no comparten la lectura de `closer_contactos`
 *
 * Justamente por lo de arriba: Mi Día necesita leer DESPUÉS de las escrituras. Pasarle el
 * snapshot de la reconciliación anularía la frescura que motiva el orden. Y "parchear" el
 * snapshot en memoria con lo que la reconciliación tocó es frágil: si algún día se agrega
 * una mutación y nadie actualiza el parche, Mi Día muestra datos viejos de una forma que no
 * se nota. Dos lecturas dentro de UN request siguen siendo mejor que dos requests con una
 * lectura cada uno — aunque conviene decirlo claro: **del lado de Supabase esto no ahorra
 * nada**. Lo que ahorra son invocaciones, y lo que compra es frescura.
 *
 * ## El presupuesto de la reconciliación
 *
 * Es un deadline COOPERATIVO (`presupuestoMs`), no un `Promise.race`. Un race no cancela
 * nada: la mitad seguiría corriendo después de responder y podría quedar congelada entre el
 * `update` de `last_message_ghl_at` y `efectosDeEntrante`, perdiendo para siempre el evento
 * de historial, la cancelación del seguimiento y el revive de la tarea. El deadline
 * cooperativo corta ENTRE conversaciones, nunca a mitad de una.
 *
 * 4 s es holgado: en régimen normal la reconciliación es 1 search + 0-3 fetches de mensajes,
 * bastante menos de 1 s. Está dimensionado para que el tick p99 quede cómodamente por debajo
 * del intervalo de 10 s y los requests no se apilen.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ejecutarMiDia } from "../_lib/miDia.js";
import { ejecutarReconciliacion } from "../_lib/reconciliacion.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

/** Deadline de la mitad de ingesta. Ver la nota de cabecera: cooperativo, no un race. */
const PRESUPUESTO_RECONCILIACION_MS = 4_000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer", "setter"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Usá POST." });
  }

  /**
   * Mitad 1 — ingesta. `ejecutarReconciliacion` no lanza nunca, pero se envuelve igual: un
   * fallo suyo NO puede impedir que Mi Día se pinte. Las cinco colas son la pantalla donde
   * el closer trabaja; que GHL esté caído no debería vaciarla.
   */
  let reconciliacion: Record<string, unknown>;
  try {
    const r = await ejecutarReconciliacion({ presupuestoMs: PRESUPUESTO_RECONCILIACION_MS });
    reconciliacion = r.body;
    /**
     * Antes un GHL caído era un 502, o sea una invocación con error que Vercel cuenta. Ahora
     * el status lo decide Mi Día, así que sin esto una reconciliación permanentemente rota
     * se volvería invisible: 200 para siempre y un campo que nadie lee.
     */
    if (r.status >= 400) console.error("[tick] la reconciliación falló:", r.body);
  } catch (e) {
    reconciliacion = { ok: false, error: (e as Error).message };
    console.error("[tick] la reconciliación lanzó:", e);
  }

  /**
   * Mitad 2 — las cinco colas. El status HTTP lo decide SOLO esta mitad: es la única cuyo
   * resultado consume el frontend. El de la reconciliación viaja como campo (lo lee el curl
   * y el diagnóstico; el store lo ignora).
   */
  try {
    const miDia = await ejecutarMiDia();
    return res.status(200).json({ ok: true, reconciliacion, ...miDia });
  } catch (e) {
    // Se devuelve igual el reporte de la reconciliación: esa mitad YA corrió, consumió el
    // candado y gastó llamadas a GHL. Tirarlo dejaría el ciclo sin rastro.
    return res.status(500).json({ ok: false, error: (e as Error).message, reconciliacion });
  }
}
