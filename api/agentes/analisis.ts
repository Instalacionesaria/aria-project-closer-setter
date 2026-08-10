/**
 * `GET /api/agentes/analisis?agenteId=…` — TODAS las conversaciones auditadas de un agente.
 *
 * ── Por qué hacía falta un endpoint nuevo ─────────────────────────────
 *
 * Auditoría de Agentes mostraba solo **hallazgos agrupados por patrón**, y eso deja fuera
 * exactamente lo que Fabio pidió ver: un **verde no produce ningún hallazgo**, así que una
 * conversación bien atendida era invisible en la única pantalla que existe para mirar al agente.
 * El técnico veía "0 rojos, 0 amarillos" y ninguna forma de leer qué había dicho el auditor.
 *
 * `/api/agentes/alertas` no sirve para esto y no se extendió: su unidad es el PATRÓN
 * (`error_code` × casos), y agruparlo es su razón de existir — meterle una lista plana de análisis
 * lo convertiría en dos endpoints en uno. Acá la unidad es la CONVERSACIÓN.
 *
 * ── El filtro es DISTINTO al de los contadores, y a propósito ─────────
 *
 * `/api/agentes/alertas` y el chip de la tarjeta cuentan solo lo **auditable**: son métricas de
 * calidad, y un análisis que no pudo juzgar nada no dice nada sobre el agente. Esta lista no es una
 * métrica: es el registro de lo que el auditor miró, así que incluye los no auditables (ver abajo).
 *
 * La diferencia está acá escrita porque el repo ya pagó una vez por no escribirla: el chip
 * "N VERDES de M" comparaba dos poblaciones distintas —el numerador sin filtrar `auditable`, el
 * denominador con él— y nadie podía explicar el número. Eso se arregló el mismo día que esto se
 * escribió. Dos filtros distintos están bien **si están justificados**; dos filtros distintos por
 * descuido son un número que miente.
 *
 * La ventana sí es compartida (`DIAS_VENTANA_AUDITOR`): las tres vitrinas hablan del mismo período.
 *
 * ── Los no auditables SÍ se listan ────────────────────────────────────
 *
 * Y es el caso que motivó todo: una llamada de 19 segundos que el auditor declaró imposible de
 * juzgar tiene `nivel: null`, cero hallazgos y un `resumen` que dice exactamente qué pasó. Es la
 * fila más informativa de la lista y la que un filtro por `auditable` habría escondido. Lo que se
 * excluye es la **siembra de línea base** (`disparo: 'linea_base'`), que no es un análisis: es una
 * marca de dónde arrancar a contar.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigir } from "../_lib/auth.js";
import { activar } from "../_lib/credenciales.js";
import { db } from "../_lib/repo.js";
import {
  AGENTES_CON_AUDITOR,
  DIAS_VENTANA_AUDITOR,
} from "../_lib/analizador.js";

/** El techo por página. Un agente activo no produce más de esto en 30 días. */
const TOPE = 100;

const COLUMNAS =
  "id, ghl_contact_id, conversation_id, nivel, auditable, motivo, criterio, sentimiento, " +
  "resumen, observaciones, destacado, evidencia, fallo, disparo, analizado_el";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Mismo rol que el resto de Auditoría de Agentes: es la pantalla del técnico.
  const ctx = await exigir(req, res, ["tecnico"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  const agenteId = String(req.query.agenteId ?? "").trim();
  if (!(AGENTES_CON_AUDITOR as readonly string[]).includes(agenteId)) {
    return res.status(400).json({
      ok: false,
      codigo: "agente_invalido",
      error: `"${agenteId}" no es un agente con auditor.`,
      opciones: AGENTES_CON_AUDITOR,
    });
  }

  try {
    const desde = new Date(
      Date.now() - DIAS_VENTANA_AUDITOR * 86_400_000,
    ).toISOString();

    const { data, error } = await db()
      .from("closer_analisis_agente")
      .select(COLUMNAS)
      .eq("agente_id", agenteId)
      // El mismo filtro que el contador de la vitrina. Ver la cabecera.
      .neq("disparo", "linea_base")
      .gte("analizado_el", desde)
      .order("analizado_el", { ascending: false })
      .limit(TOPE);

    if (error) throw new Error(`closer_analisis_agente: ${error.message}`);

    const filas = (data ?? []) as unknown as Fila[];

    /**
     * Los hallazgos de esta página, en una segunda query. No de toda la ventana: la lista está
     * paginada y traer hallazgos de filas que nadie va a ver es trabajo tirado.
     *
     * Dos queries y no un join: PostgREST no expone joins sin FK declarada en el sentido que hace
     * falta acá, y son dos consultas indexadas sobre pocas filas.
     */
    const porAnalisis = new Map<string, Hallazgo[]>();
    if (filas.length > 0) {
      const { data: hallazgos } = await db()
        .from("closer_hallazgo_agente")
        .select(
          "analisis_id, error_code, titulo, severidad, categoria, criterio, diagnostico, correccion, correccion_tipo, estado",
        )
        .in(
          "analisis_id",
          filas.map((f) => f.id),
        );

      for (const h of (hallazgos ?? []) as unknown as (Hallazgo & {
        analisis_id: string;
      })[]) {
        const lista = porAnalisis.get(h.analisis_id) ?? [];
        lista.push(h);
        porAnalisis.set(h.analisis_id, lista);
      }
    }

    /** El nombre del contacto, de la caché. Solo los de esta página. */
    const nombres = new Map<string, string>();
    const ids = [...new Set(filas.map((f) => f.ghl_contact_id))];
    if (ids.length > 0) {
      const { data: contactos } = await db()
        .from("closer_contactos")
        .select("ghl_contact_id, nombre")
        .in("ghl_contact_id", ids);
      for (const c of (contactos ?? []) as {
        ghl_contact_id: string;
        nombre: string | null;
      }[]) {
        if (c.nombre) nombres.set(c.ghl_contact_id, c.nombre);
      }
    }

    return res.status(200).json({
      ok: true,
      agenteId,
      ventanaDias: DIAS_VENTANA_AUDITOR,
      // Se dice si la lista quedó cortada: media verdad silenciosa sobre cuántas hubo sería peor.
      truncado: filas.length === TOPE,
      analisis: filas.map((f) => ({
        id: f.id,
        ghlContactId: f.ghl_contact_id,
        /** `null` = el contacto no está en la caché. No se rellena con el id, que no es un nombre. */
        nombre: nombres.get(f.ghl_contact_id) ?? null,
        /** El `call_id` para una llamada, el `conversation_id` de GHL para un chat. */
        conversacionId: f.conversation_id,
        /** `null` = no se pudo juzgar. No es un cuarto nivel: es la ausencia de veredicto. */
        nivel: f.nivel,
        auditable: f.auditable,
        fallo: f.fallo,
        criterio: f.criterio,
        sentimiento: f.sentimiento,
        resumen: f.resumen,
        /** `null` = no se pidieron (no auditable); `[]` = se pidieron y no hubo. Ver la `039`. */
        observaciones: f.observaciones,
        destacado: f.destacado,
        evidencia: f.evidencia,
        motivo: f.motivo,
        disparo: f.disparo,
        analizadoEl: f.analizado_el,
        hallazgos: porAnalisis.get(f.id) ?? [],
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

interface Fila {
  id: string;
  ghl_contact_id: string;
  conversation_id: string | null;
  nivel: string | null;
  auditable: boolean;
  motivo: string | null;
  criterio: string | null;
  sentimiento: string | null;
  resumen: string | null;
  observaciones:
    { etiqueta: string; texto: string; cita: string | null }[] | null;
  destacado: string | null;
  evidencia: string | null;
  fallo: boolean;
  disparo: string;
  analizado_el: string;
}

interface Hallazgo {
  error_code: string;
  titulo: string;
  severidad: string;
  categoria: string;
  criterio: string | null;
  diagnostico: string | null;
  correccion: string | null;
  correccion_tipo: string | null;
  estado: string;
}
