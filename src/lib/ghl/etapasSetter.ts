/**
 * Las siete etapas del pipeline del setter, y su tag en GHL.
 *
 * Espeja `etapas.ts`, que hace lo mismo para el closer. Hasta hoy estas etapas existían **solo
 * como un tipo de TypeScript** (`SetterStageKey` en `setterStore.tsx`): no había un catálogo con
 * sus literales, ni un derivador desde tags, ni forma de escribirlas en GHL. El pipeline
 * renderizaba 2 de las 7 y los contactos de las otras 5 desaparecían en silencio.
 *
 * ── La fuente de verdad del stage es Supabase ─────────────────────────
 *
 * `closer_contactos.stage_key`, igual que en el closer. GHL recibe el tag para que sus workflows
 * puedan reaccionar, pero nunca vuelve a pisar la etapa. Por eso las 7 columnas funcionan desde
 * el día uno aunque tres de los tags todavía no existan en la subcuenta.
 */

import { TAGS, TAGS_BOT, type Literal } from "./contrato.js";

export type EtapaSetter =
  | "nuevo"
  | "en_calificacion"
  | "calificado_sin_agendar"
  | "low_ticket_ofrecido"
  | "agendado"
  | "nurture"
  | "descalificado";

export interface EtapaSetterDef {
  readonly key: EtapaSetter;
  readonly label: string;
  /**
   * El tag que la representa en GHL, o `null` si otra cosa la resuelve.
   *
   * `agendado` es el único `null`, y no es un hueco: esa etapa la produce el swap
   * `zona_setter` → `zona_closer` del WF 04.1 cuando la cita existe de verdad. Darle un tag
   * propio sería una segunda fuente para el mismo hecho.
   */
  readonly tag: Literal | null;
  /** `true` = el contacto ya no es trabajo del setter. Se muestra, no se acciona. */
  readonly terminal: boolean;
}

/**
 * En el orden en que se renderizan las columnas, que es el del embudo. El orden vive acá y no en
 * la vista: si dos pantallas lo definieran por su cuenta, divergirían.
 */
export const ETAPAS_SETTER: readonly EtapaSetterDef[] = [
  { key: "nuevo", label: "Nuevo", tag: TAGS.setterNuevo, terminal: false },
  { key: "en_calificacion", label: "En calificación", tag: TAGS.setterEnCalificacion, terminal: false },
  { key: "calificado_sin_agendar", label: "Calificado sin agendar", tag: TAGS.setterCalificado, terminal: false },
  { key: "low_ticket_ofrecido", label: "Low-Ticket ofrecido", tag: TAGS_BOT.derivadoLt, terminal: false },
  // El handoff al closer: sale del territorio del setter, así que para él es terminal.
  { key: "agendado", label: "Agendado", tag: null, terminal: true },
  { key: "nurture", label: "Nurture", tag: TAGS.nurtureAppflow, terminal: true },
  { key: "descalificado", label: "Descalificado", tag: TAGS.descalificado, terminal: true },
];

const PORCLAVE = new Map(ETAPAS_SETTER.map((e) => [e.key, e]));

export function etapaSetterPorClave(key: string): EtapaSetterDef | null {
  return PORCLAVE.get(key as EtapaSetter) ?? null;
}

export function esEtapaSetter(v: string): v is EtapaSetter {
  return PORCLAVE.has(v as EtapaSetter);
}

/**
 * La etapa de un contacto según sus tags, para cuando `stage_key` está vacío.
 *
 * Se recorre **en orden inverso al embudo**: si un contacto tiene dos tags de etapa —puede pasar
 * mientras un workflow todavía no limpió el anterior— gana el más avanzado. Mismo criterio que
 * usa el closer: la etapa más avanzada es la que describe dónde está de verdad.
 *
 * `nuevo` es el default y no un fallback de emergencia: un contacto del setter sin ninguna marca
 * de etapa es, literalmente, un lead que nadie tocó todavía.
 */
export function etapaSetterDesdeTags(tags: readonly string[]): EtapaSetter {
  const normalizados = tags.map((t) => t.trim().toLowerCase());
  for (let i = ETAPAS_SETTER.length - 1; i >= 0; i--) {
    const e = ETAPAS_SETTER[i];
    if (e.tag && normalizados.includes(e.tag.valor)) return e.key;
  }
  // Si ya está en el territorio del closer, para el setter está agendado: hizo el handoff.
  if (normalizados.includes(TAGS.zonaCloser.valor)) return "agendado";
  return "nuevo";
}

/**
 * Los tags de etapa que hay que QUITAR al mover a otra columna.
 *
 * Las etapas son mutuamente excluyentes: un contacto está en una, no en dos. Sin esto, arrastrar
 * una tarjeta dejaría el tag viejo puesto y el contacto aparecería en las dos columnas en cuanto
 * alguien derivara la etapa desde tags.
 */
export function tagsDeOtrasEtapas(destino: EtapaSetter): Literal[] {
  return ETAPAS_SETTER.filter((e) => e.key !== destino && e.tag !== null).map((e) => e.tag!);
}
