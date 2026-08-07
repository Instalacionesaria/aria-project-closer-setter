/**
 * `GET /api/agentes/texto` — lo que llena las dos tarjetas de "Agentes de Texto".
 *
 * Devuelve, por agente, exactamente los campos que Francisco definió en `AgentInfo`. La UI
 * no se toca: este endpoint existe para que esas tarjetas dejen de mostrar datos sembrados
 * y muestren lo que realmente midieron las analizadoras.
 *
 *   Lead Flow AI        ← territorio `zona_setter`   · se juzga por si CONSIGUIÓ la cita
 *   Appointment Flow AI ← territorio `zona_closer`   · se juzga por si el contacto SE PRESENTÓ
 *
 * Los agentes de VOZ no salen de acá: son de Fabio, con sus propias analizadoras.
 *
 * ## De dónde sale cada número
 *
 * - **Sentimiento** — de `closer_analisis_agente`: el reparto de los veredictos de los
 *   últimos 30 días. Lo produce el modelo, una vez por conversación.
 * - **Tasa, subtexto y operativos** — de las CITAS de GHL, no de los análisis. Un agente
 *   puede atender de maravilla y no conseguir la cita; son cosas distintas y se miden por
 *   separado.
 * - **Delta** — la misma tasa contra los 30 días anteriores, en puntos.
 * - **History** — 12 semanas: se pinta lo real donde lo hay y se conserva el valor sembrado
 *   donde todavía no. Así el sparkline se ve completo desde el primer día y se va volviendo
 *   real solo, semana a semana.
 * - **"Sin Respuesta"** — NO se calcula. Francisco todavía no definió qué cuenta
 *   exactamente (¿el último mensaje es de la IA?, ¿el contacto nunca escribió?), y elegirlo
 *   por mi cuenta sería inventar un criterio de negocio. Viaja `null` y la vista conserva
 *   el valor que él puso.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { AUDITORES_ACTIVOS, type AgenteTextoId } from "../_lib/analizador.js";
import { db } from "../_lib/repo.js";
import { env } from "../_lib/env.js";
import { ghl } from "../_lib/ghl/index.js";
import { eventosDeCalendario } from "../_lib/ghl/lectura.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

const DIAS_VENTANA = 30;

/** Lo que consume la vista. Espeja `AgentInfo` sin importarlo: `api/` no depende del front. */
export interface AgenteTextoMetricas {
  id: AgenteTextoId;
  metric: string | null;
  delta: { text: string; up: boolean } | null;
  subtext: string | null;
  sentiment: { positivos: number; neutrales: number; molestos: number } | null;
  /** `null` en una caja = "no lo sé, dejá el valor que ya estaba". */
  ops: { label: string; value: string | null }[];
  /**
   * Solo las semanas realmente medidas.
   *
   * `tasa` viaja en `null` a propósito mientras no se pueda reconstruir hacia atrás (ver
   * `historialDe`). Antes se mandaba el mismo número que `sentimientoPositivo`: con la
   * semilla puesta no se notaba, pero sin semilla son dos trazos superpuestos en el
   * sparkline, que se lee como un bug de render y no como "esto todavía no se mide".
   */
  history: { week: string; tasa: number | null; sentimientoPositivo: number }[];
  /** Cuántos análisis sostienen estos números. 0 = todavía no se midió nada. */
  analisis: number;
}

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 100) : 0);

/** "▲ +4 pts" / "▼ -2 pts". Sin período anterior no hay delta que mostrar. */
function armarDelta(actual: number, previo: number | null): { text: string; up: boolean } | null {
  if (previo === null) return null;
  const d = actual - previo;
  if (d === 0) return { text: "0 pts", up: true };
  return { text: `${d > 0 ? "▲ +" : "▼ -"}${Math.abs(d)} pts`, up: d > 0 };
}

/**
 * Citas del calendario en una ventana de días hacia atrás.
 *
 * Las dos tasas se sacan de acá porque las dos hablan de citas: Lead Flow se mide por
 * cuántas consiguió, Appointment Flow por cuántas terminaron en el contacto presentándose.
 */
async function citasEnVentana(desdeDias: number, hastaDias: number) {
  const calendarId = env.ghlCalendarioPorDefecto();
  if (!calendarId) return [];
  const ahora = Date.now();
  return eventosDeCalendario({
    calendarId,
    desdeMs: ahora - desdeDias * 86_400_000,
    hastaMs: ahora - hastaDias * 86_400_000,
  });
}

/** Sentimiento y volumen de un agente, de la vista que agrega los últimos 30 días. */
async function sentimientoDe(agenteId: AgenteTextoId) {
  const { data, error } = await db().from("closer_agentes_texto_30d").select("*").eq("agente_id", agenteId).maybeSingle();
  if (error || !data) return null;
  return {
    conversaciones: Number(data.conversaciones ?? 0),
    analisis: Number(data.analisis ?? 0),
    sentiment: {
      positivos: Number(data.pct_positivos ?? 0),
      neutrales: Number(data.pct_neutrales ?? 0),
      molestos: Number(data.pct_molestos ?? 0),
    },
  };
}

/** Semanas realmente medidas, para el sparkline. */
async function historialDe(agenteId: AgenteTextoId) {
  const { data, error } = await db()
    .from("closer_analisis_agente")
    .select("analizado_el, sentimiento")
    .eq("agente_id", agenteId)
    .gte("analizado_el", new Date(Date.now() - 12 * 7 * 86_400_000).toISOString());

  if (error || !data?.length) return [];

  /** Agrupa por lunes de cada semana — el mismo eje que usa el sparkline. */
  const porSemana = new Map<string, { total: number; positivos: number }>();
  for (const fila of data) {
    const d = new Date(fila.analizado_el as string);
    const lunes = new Date(d);
    lunes.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const clave = lunes.toISOString().slice(0, 10);
    const acc = porSemana.get(clave) ?? { total: 0, positivos: 0 };
    acc.total += 1;
    if (fila.sentimiento === "positivo") acc.positivos += 1;
    porSemana.set(clave, acc);
  }

  const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return [...porSemana.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([clave, acc]) => {
      const d = new Date(`${clave}T00:00:00Z`);
      return {
        week: `${String(d.getUTCDate()).padStart(2, "0")} ${MESES[d.getUTCMonth()]}`,
        // La tasa por semana todavía no se puede reconstruir hacia atrás desde las citas.
        // Va `null` y la vista NO dibuja esa línea — antes se mandaba el sentimiento
        // positivo en su lugar, o sea el mismo número dos veces disfrazado de dos series.
        tasa: null,
        sentimientoPositivo: pct(acc.positivos, acc.total),
      };
    });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["tecnico"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const [citas, citasPrevias] = await Promise.all([
      citasEnVentana(DIAS_VENTANA, 0),
      citasEnVentana(DIAS_VENTANA * 2, DIAS_VENTANA),
    ]);

    /** Se presentó = GHL lo marcó como `showed`. No-show y cancelada no cuentan. */
    const presentadas = (l: typeof citas) => l.filter((c) => c.appointmentStatus === "showed").length;
    const vigentes = (l: typeof citas) => l.filter((c) => c.appointmentStatus !== "cancelled").length;

    /**
     * ¿Alguien está registrando la asistencia?
     *
     * Verificado el 2026-07-28 contra la subcuenta: en 180 días y 633 citas hay 386
     * `confirmed`, 245 `cancelled`, 1 `noshow` y CERO `showed`. Es decir, la asistencia no
     * se marca — ni la buena ni la mala.
     *
     * Sin ese dato, cualquier show-up que calcule es un invento: contar solo `showed` da 0%
     * y tratar `confirmed` como asistió da ~100%, y las dos cifras dirían algo que nadie
     * midió. Así que no se calcula y la tarjeta conserva el número de Francisco.
     *
     * Se destraba solo el día que empiecen a marcarse las citas — o cuando el "Avanzar" del
     * closer escriba el desenlace, que es la definición del propio producto ("Se presentó"
     * es un hecho derivado que alimenta el Show rate, CLAUDE.md §3).
     */
    const hayAsistenciaRegistrada = citas.some(
      (c) => c.appointmentStatus === "showed" || c.appointmentStatus === "noshow",
    );

    const agentes: AgenteTextoMetricas[] = [];

    for (const id of ["lead-flow-ai", "appointment-flow-ai"] as const) {
      const agregado = await sentimientoDe(id);
      const conversaciones = agregado?.conversaciones ?? 0;

      let metric: string | null = null;
      let subtext: string | null = null;
      let delta: { text: string; up: boolean } | null = null;
      let agendadas: number | null = null;

      if (id === "lead-flow-ai") {
        /**
         * Su trabajo es llevar el lead a la cita: cuántas de las conversaciones que atendió
         * terminaron agendando. Sin análisis todavía no hay denominador — y una tasa sobre
         * cero conversaciones sería un número inventado, así que se devuelve null.
         */
        agendadas = vigentes(citas);
        if (conversaciones > 0) {
          const tasa = pct(agendadas, conversaciones);
          metric = `${tasa}%`;
          subtext = `${agendadas} de ${conversaciones} agendaron`;
          delta = armarDelta(tasa, null);
        }
      } else {
        /** Su trabajo es que se presenten: show-up sobre las citas del período. */
        const totalCitas = vigentes(citas);
        if (hayAsistenciaRegistrada && totalCitas > 0) {
          agendadas = presentadas(citas);
          const tasa = pct(agendadas, totalCitas);
          metric = `${tasa}%`;
          subtext = `${agendadas} de ${totalCitas} se presentaron`;
          const prevTotal = vigentes(citasPrevias);
          delta = armarDelta(tasa, prevTotal > 0 ? pct(presentadas(citasPrevias), prevTotal) : null);
        }
        // Sin asistencia registrada, "Agendadas" sí se sabe: son las citas vigentes.
        agendadas = agendadas ?? (totalCitas > 0 ? totalCitas : null);
      }

      agentes.push({
        id,
        metric,
        delta,
        subtext,
        sentiment: agregado?.analisis ? agregado.sentiment : null,
        ops: [
          { label: "Conversaciones", value: conversaciones > 0 ? String(conversaciones) : null },
          { label: "Agendadas", value: agendadas !== null ? String(agendadas) : null },
          // Pendiente de que Francisco defina qué cuenta. Ver cabecera.
          { label: "Sin Respuesta", value: null },
        ],
        history: await historialDe(id),
        analisis: agregado?.analisis ?? 0,
      });
    }

    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      ventanaDias: DIAS_VENTANA,
      /**
       * Qué agentes tienen auditor cableado. Sale de la MISMA constante que usa el
       * analizador y que repite `/api/agentes/alertas`: un solo lugar donde se decide, para
       * que dos endpoints no puedan decir cosas distintas sobre lo mismo.
       */
      agentesConAuditor: AUDITORES_ACTIVOS,
      /**
       * Se dice explícitamente para que "sin métrica de show-up" no se lea como un bug del
       * endpoint: es que nadie está marcando la asistencia en GHL.
       */
      asistenciaRegistradaEnGhl: hayAsistenciaRegistrada,
      agentes,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
