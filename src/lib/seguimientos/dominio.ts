/**
 * Seguimientos del closer — la lógica, sin React, sin base de datos, sin red.
 *
 * ## Qué guarda esta capa y por qué tan poco
 *
 * `CONTRATO-GHL.md` §0 es tajante: GHL es la única fuente de verdad y el tool no almacena
 * datos propios. Lo respetamos casi entero. La excepción, decidida el 2026-07-25, es la
 * **fecha objetivo del seguimiento manual**: GHL solo necesita saber que el contacto está
 * en modo manual (tag `seguimiento_manual`) para no dispararle nunca la serie automática;
 * el día exacto en que reaparece en la cola es lógica de cola de trabajo, no de negocio, y
 * no tiene ni campo ni workflow en el contrato.
 *
 * Todo lo demás se lee de GHL: la situación es un custom field, el modo es un tag, el stage
 * lo mueve un workflow.
 *
 * ## La regla que define la cola
 *
 * "Seguimientos de hoy" muestra SOLO seguimientos manuales vencidos o de hoy, más series
 * automáticas agotadas. Una serie automática en curso NO genera fila: `CLAUDE.md` §16.1
 * define el automático como "el sistema persigue por ti" y su resultado confirmado es
 * píldora + ⏱ + evento, sin tarea; solo el manual dice "tarea que reaparece ese día". Es
 * también lo único coherente con §40.E — si el sistema trabaja, no hay tarea humana. Si el
 * contacto responde mientras la serie corre, vuelve por Buzón general o Intervención
 * urgente, que son otras colas.
 */

import { hoyISO, sumarDias, diasVencido, type FechaISO } from "../fechas";
import type { SituacionSeguimiento } from "../ghl/contrato";

/* ================================================================== */
/* Tipos                                                               */
/* ================================================================== */

export type ModoSeguimiento = "automatico" | "manual";

/**
 * `agotado` NO es terminal: es "la serie terminó sin respuesta, mirálo vos" (§16.1.D).
 * Los estados realmente cerrados son `completado`, `cancelado` y `reemplazado`.
 */
export type EstadoSeguimiento = "pendiente" | "agotado" | "completado" | "cancelado" | "reemplazado";

export type MotivoCierre =
  | "avanzar" /** El closer registró otro resultado — cancelación universal. */
  | "respondio" /** El contacto escribió; GHL saca de la serie (WF 02.6). */
  | "reemplazado" /** Se pactó un seguimiento nuevo encima. */
  | "completado_por_humano" /** Se atendió la tarea desde el chat. */
  | "cancelado_manual";

export interface Seguimiento {
  id: string;
  ghlContactId: string;
  closerId: string;
  situacion: SituacionSeguimiento;
  modo: ModoSeguimiento;
  /**
   * El día en que un HUMANO lo mira. No es la fecha del próximo toque.
   * Manual → la fecha pactada. Automático → fin proyectado de la serie + gracia, que además
   * sirve de fail-safe: si los webhooks de GHL nunca llegan, el contacto aflora igual en vez
   * de desaparecer para siempre.
   */
  fechaObjetivo: FechaISO;
  estado: EstadoSeguimiento;
  nota?: string;
  /** Snapshot de la serie al crearla — cambiar el catálogo mañana no reescribe lo prometido ayer. */
  serie?: { key: string; toques: number; dias: number };
  creadoEl: string;
  creadoPor: string;
  cerradoEl?: string;
  motivoCierre?: MotivoCierre;
}

/* ================================================================== */
/* Catálogo de series                                                  */
/* ================================================================== */

/** Única serie automática del closer (§16.1.B / §39.1). El setter tiene las suyas. */
export const SERIE_RECUPERO = { key: "recupero", label: "Recupero", toques: 3, dias: 7 } as const;

/**
 * Días de gracia después del último toque antes de pedirle al humano que mire.
 * Sin esto, una serie cuyos webhooks se pierden nunca genera tarea y el contacto se cae
 * del sistema en silencio.
 */
export const DIAS_GRACIA_SERIE = 3;

/** Presets de fecha del grupo manual (§16.1.B). El cliente manda el preset, no la fecha. */
export const PRESETS_MANUAL = {
  manana: 1,
  en_3_dias: 3,
  una_semana: 7,
} as const;

export type PresetManual = keyof typeof PRESETS_MANUAL | "personalizada";

/* ================================================================== */
/* Crear                                                               */
/* ================================================================== */

export interface CrearSeguimientoInput {
  ghlContactId: string;
  closerId: string;
  situacion: SituacionSeguimiento;
  modo: ModoSeguimiento;
  /** Solo modo manual. */
  preset?: PresetManual;
  /** Solo `preset: "personalizada"`. Fecha civil, tal cual sale del `<input type="date">`. */
  fechaPersonalizada?: FechaISO;
  nota?: string;
}

export class SeguimientoInvalidoError extends Error {
  constructor(
    message: string,
    readonly codigo: string,
  ) {
    super(message);
    this.name = "SeguimientoInvalidoError";
  }
}

/**
 * Resuelve la fecha objetivo a partir de la INTENCIÓN, nunca de una fecha que haya
 * calculado el browser. Ese fue el bug de `isoInDays`: aritmética en la zona del cliente,
 * que después de las 19:00 en Lima devolvía el día equivocado.
 */
export function resolverFechaObjetivo(input: CrearSeguimientoInput, ahora: Date = new Date()): FechaISO {
  const hoy = hoyISO(ahora);

  if (input.modo === "automatico") {
    return sumarDias(hoy, SERIE_RECUPERO.dias + DIAS_GRACIA_SERIE);
  }

  if (input.preset === "personalizada") {
    const fecha = input.fechaPersonalizada;
    if (!fecha) {
      throw new SeguimientoInvalidoError("Falta la fecha personalizada.", "fecha_faltante");
    }
    if (fecha <= hoy) {
      // Un seguimiento "para hoy" caería el mismo día en que la tarea ya se completó
      // (el `IS DISTINCT FROM hoy` de la cola lo filtraría), así que no aparecería nunca.
      throw new SeguimientoInvalidoError(
        `La fecha debe ser futura. Recibido ${fecha}, hoy es ${hoy} en la organización.`,
        "fecha_no_futura",
      );
    }
    return fecha;
  }

  const dias = PRESETS_MANUAL[input.preset as keyof typeof PRESETS_MANUAL];
  if (dias === undefined) {
    throw new SeguimientoInvalidoError(`Preset desconocido: ${String(input.preset)}`, "preset_invalido");
  }
  return sumarDias(hoy, dias);
}

/**
 * Instagram no tiene bot ni automatización (§11 / `CONTRATO-GHL.md`). Ofrecer el modo
 * automático ahí sería prometer una serie que nadie va a enviar.
 *
 * Es config, no hardcode: el día que GHL soporte automatización en IG, se saca el canal de
 * la lista (en producción, de `org_config.canales_sin_seguimiento_automatico`) y el grupo
 * automático reaparece sin tocar código ni desplegar.
 */
export const CANALES_SIN_SEGUIMIENTO_AUTOMATICO: readonly string[] = ["📷 IG PROFILE"];

export const permiteSeguimientoAutomatico = (
  fuente: string | undefined,
  canalesBloqueados: readonly string[] = CANALES_SIN_SEGUIMIENTO_AUTOMATICO,
): boolean => !fuente || !canalesBloqueados.includes(fuente);

/* ================================================================== */
/* La cola de "Seguimientos de hoy"                                    */
/* ================================================================== */

const ESTADOS_ABIERTOS: readonly EstadoSeguimiento[] = ["pendiente", "agotado"];

export const estaAbierto = (s: Seguimiento): boolean => ESTADOS_ABIERTOS.includes(s.estado);

/**
 * ¿Le toca al humano hoy?
 *
 * Tres condiciones, y la del medio es la que más se olvida:
 *   1. Está abierto.
 *   2. Es manual, O es una serie que se agotó. Una serie automática EN CURSO no genera fila.
 *   3. Su fecha objetivo ya llegó.
 *
 * El filtro de "ya se atendió hoy" no vive acá: es del contacto, no del seguimiento, y lo
 * aplica la vista con `completedToday`.
 */
export function estaEnColaDeHoy(s: Seguimiento, ahora: Date = new Date()): boolean {
  if (!estaAbierto(s)) return false;
  if (s.modo === "automatico" && s.estado !== "agotado") return false;
  return s.fechaObjetivo <= hoyISO(ahora);
}

export type TonoFila = "neutral" | "vencido" | "agotado";

export interface FilaSeguimiento {
  /** Segunda línea de la fila. La fecha vive acá — NUNCA en la píldora (§12/§39.3). */
  microtext: string;
  /** Vencido y agotado son tinte de fila, jamás píldora. */
  tono: TonoFila;
  vencido: boolean;
}

/**
 * El texto y el tinte de la fila, derivados del estado real. Reproduce los strings que hoy
 * están escritos a mano en la semilla ("vencido hace 1 día", "seguimiento programado para
 * hoy"), pero calculados — así no envejecen como el "Abierta hace 767 días" que §39.6 tuvo
 * que corregir a mano.
 */
export function derivarFila(s: Seguimiento, ahora: Date = new Date()): FilaSeguimiento {
  if (s.estado === "agotado") {
    const dias = diasVencido(s.fechaObjetivo, ahora);
    const cuando = dias <= 0 ? "hoy" : dias === 1 ? "hace 1 día" : `hace ${dias} días`;
    return { microtext: `serie completada sin respuesta · ${cuando}`, tono: "agotado", vencido: false };
  }

  const atraso = diasVencido(s.fechaObjetivo, ahora);

  if (atraso > 0) {
    const cuando = atraso === 1 ? "vencido hace 1 día" : `vencido hace ${atraso} días`;
    return { microtext: cuando, tono: "vencido", vencido: true };
  }

  if (atraso === 0) {
    return { microtext: "seguimiento programado para hoy", tono: "neutral", vencido: false };
  }

  if (s.modo === "automatico") {
    // Sin toques confirmados no se inventa un contador (§4.10). Cuando lleguen los webhooks
    // de GHL, acá va "· toque 2 de 3" con su base (§4.9).
    return { microtext: `Seguimiento automático · ${s.serie?.key === "recupero" ? "Recupero" : s.serie?.key}`, tono: "neutral", vencido: false };
  }

  const faltan = -atraso;
  return {
    microtext: faltan === 1 ? "seguimiento programado para mañana" : `seguimiento programado en ${faltan} días`,
    tono: "neutral",
    vencido: false,
  };
}

/* ================================================================== */
/* Cierre                                                              */
/* ================================================================== */

/**
 * Cancelación universal: CUALQUIER resultado de Avanzar cierra el seguimiento abierto.
 *
 * No está en ningún documento — se decidió el 2026-07-25. Es lo que evita que un trato
 * ganado siga siendo perseguido por un workflow, y lo que hace que el ⏱ se apague solo en
 * vez de quedarse encendido para siempre.
 */
export function cerrarPorAvanzar(s: Seguimiento, ahoraIso: string): Seguimiento {
  return { ...s, estado: "cancelado", motivoCierre: "avanzar", cerradoEl: ahoraIso };
}

/** El contacto respondió. GHL ya lo sacó de la serie (WF 02.6); acá lo reflejamos. */
export function cerrarPorRespuesta(s: Seguimiento, ahoraIso: string): Seguimiento {
  return { ...s, estado: "cancelado", motivoCierre: "respondio", cerradoEl: ahoraIso };
}

/** Se pactó uno nuevo encima. Uno solo abierto por contacto — lo garantiza un índice parcial único. */
export function marcarReemplazado(s: Seguimiento, ahoraIso: string): Seguimiento {
  return { ...s, estado: "reemplazado", motivoCierre: "reemplazado", cerradoEl: ahoraIso };
}

/** El ⏱ (§8) — derivado, nunca un campo escribible. Ese fue el bug del latch de una sola vía. */
export const tieneSeguimientoAutomaticoActivo = (seguimientos: readonly Seguimiento[]): boolean =>
  seguimientos.some((s) => s.modo === "automatico" && s.estado === "pendiente");
