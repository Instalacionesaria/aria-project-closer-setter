/**
 * Los 6 indicadores de estado por contacto, cargados en UNA query para todo el lote.
 *
 * ## La regla que este archivo existe para hacer cumplir
 *
 * **Nunca una query por contacto.** Esto lo llaman `pipeline.ts` y `mi-dia.ts`, que corren
 * cada 10 segundos: un N+1 acá no se nota con 7 contactos y mata la app con 700. Por eso el
 * trabajo pesado (agregar citas, avances y seguimientos) vive en la vista SQL
 * `closer_indicadores_contacto` (migración 013), que devuelve exactamente una fila por
 * contacto, y acá solo se combina en memoria.
 *
 * De los 6, cuatro salen de la vista o de la fila del contacto y dos se derivan:
 *   · 🤖 de los tags, con la única `botDesdeTags` del proyecto (nunca de una columna: la
 *     columna `bot_estado` estaba NULL en los 7 contactos de producción).
 *   · 💰 de la etapa + el monto, con el gating de §27.A (una promesa no es un cobro).
 */

import { botDesdeTags } from "../../src/lib/ghl/contrato.js";
import { INDICADORES_VACIOS, type IndicadoresContacto } from "../../src/lib/indicadores.js";
import { db } from "./repo.js";

/** Fila cruda de la vista. Shape a mano: el select multilínea rompe la inferencia de supabase-js. */
interface FilaVista {
  ghl_contact_id: string;
  reuniones: number;
  cita_futura: boolean;
  proxima_cita_el: string | null;
  proxima_meet_url: string | null;
  ultima_cita_vencida_el: string | null;
  seguimiento_auto: boolean;
}

/** Lo que la fila de `closer_contactos` tiene que traer para completar 📞, 🤖 y 💰. */
export interface DatosParaIndicadores {
  ghl_contact_id: string;
  tags: string[] | null;
  fuente: string | null;
  llamadas_ia_intentos: number | null;
  llamadas_ia_contestadas: number | null;
  /** La etapa YA resuelta por el caller (stage_key o derivada de tags) — no se recalcula acá. */
  etapa: string;
  monto: number | null;
}

const COLUMNAS_VISTA =
  "ghl_contact_id, reuniones, cita_futura, proxima_cita_el, proxima_meet_url, ultima_cita_vencida_el, seguimiento_auto";

/** La parte pura: fila de la vista + fila del contacto → los 6 indicadores. Testeable sin base. */
export function combinar(contacto: DatosParaIndicadores, vista?: FilaVista): IndicadoresContacto {
  return {
    reuniones: vista?.reuniones ?? 0,
    citaFutura: vista?.cita_futura ?? false,
    proximaCitaEl: vista?.proxima_cita_el ?? null,
    proximaMeetUrl: vista?.proxima_meet_url ?? null,
    ultimaCitaVencidaEl: vista?.ultima_cita_vencida_el ?? null,
    llamadasIaContestadas: contacto.llamadas_ia_contestadas,
    llamadasIaIntentos: contacto.llamadas_ia_intentos,
    bot: botDesdeTags(contacto.tags ?? [], contacto.fuente),
    seguimientoAuto: vista?.seguimiento_auto ?? false,
    // §27.A: solo la etapa Ganado tiene dinero COBRADO. Un "Acordó comprar" también escribe
    // `monto`, pero es una promesa y vive solo en la píldora.
    ventaMonto: contacto.etapa === "ganado" ? contacto.monto : null,
  };
}

/**
 * Los indicadores de todo un lote de contactos. Una query, sin `.in(...)`: los dos callers
 * piden SIEMPRE el territorio completo y la vista tiene esa misma cardinalidad, así que
 * filtrar por ids solo agregaría tamaño de URL.
 *
 * Si la vista falla, se devuelven indicadores vacíos en vez de romper el endpoint: quedarse
 * sin el Pipeline entero porque los íconos no cargaron sería peor que ver los íconos
 * apagados. El error se loguea para que no pase inadvertido.
 */
export async function cargarIndicadores(
  contactos: readonly DatosParaIndicadores[],
): Promise<Map<string, IndicadoresContacto>> {
  const mapa = new Map<string, IndicadoresContacto>();
  if (contactos.length === 0) return mapa;

  const { data, error } = await db().from("closer_indicadores_contacto").select(COLUMNAS_VISTA);
  if (error) console.error("closer_indicadores_contacto:", error.message);

  const porId = new Map((((data ?? []) as unknown) as FilaVista[]).map((f) => [f.ghl_contact_id, f]));
  for (const c of contactos) {
    mapa.set(c.ghl_contact_id, error ? INDICADORES_VACIOS : combinar(c, porId.get(c.ghl_contact_id)));
  }
  return mapa;
}
