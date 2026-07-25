/**
 * Los nombres literales de GoHighLevel, en un solo lugar.
 *
 * Fuente: `docs/CONTRATO-GHL.md`. Regla de `CLAUDE.md` §49: los tags, custom fields y
 * stages se usan LITERALES del contrato — no se inventan. Este módulo existe para que
 * inventar uno sea imposible sin que salte a la vista.
 *
 * Cada literal lleva su `confianza`:
 *   - `confirmado` → está escrito en el contrato. Se puede enviar a GHL.
 *   - `pendiente`  → lo necesitamos y nadie lo confirmó todavía. `assertEnviable()` LANZA
 *                    si alguien intenta mandarlo con el adapter real. Sirve para poder
 *                    escribir la lógica completa hoy sin que un nombre inventado llegue
 *                    silenciosamente a la cuenta de producción y dispare el workflow
 *                    equivocado (o ninguno, que es peor porque no se nota).
 *
 * Isomorfo: sin React, sin DOM, sin Node. Lo importan el browser y las funciones de `api/`.
 */

export type Confianza = "confirmado" | "pendiente";

export interface Literal {
  /** El string exacto que viaja a la API de GHL. */
  readonly valor: string;
  readonly confianza: Confianza;
  /** De dónde salió, o qué falta para confirmarlo. */
  readonly fuente: string;
  readonly uso: string;
}

/* ================================================================== */
/* TAGS — CONTRATO-GHL.md §9 (lista maestra)                          */
/* ================================================================== */

export const TAGS = {
  /* ---- Seguimientos ---- */

  /**
   * Resultado del Avanzar → Seguimiento. Es el que mueve el stage.
   * Lleva el `If cita_agendada` que decide si además escribe `Resultado de call` (§8).
   */
  seguimiento: {
    valor: "seguimiento",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Resultados post-call",
    uso: "Resultado Seguimiento (sirve pre y post call). Dispara el movimiento de stage.",
  },

  /** Serie automática del closer: 3 toques · 7 días. Es lo que enciende el ⏱. */
  seguimientoRecupero: {
    valor: "seguimiento_recupero",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Seguimientos",
    uso: "Serie Recupero del closer. Su presencia = seguimiento automático activo (⏱).",
  },

  /**
   * Modo manual. GHL no necesita la fecha — solo saber que este contacto lo retoma un
   * humano, para no dispararle nunca la serie automática. La fecha vive del lado del tool
   * porque es lógica de cola, no de negocio.
   *
   * PENDIENTE: el contrato no lo lista. Decidido en la sesión del 2026-07-25; hay que
   * pedirle a Francisco que lo cree en GHL antes de activar el adapter real.
   */
  seguimientoManual: {
    valor: "seguimiento_manual",
    confianza: "pendiente",
    fuente: "Decidido 2026-07-25 — PENDIENTE de crear en GHL",
    uso: "Modo manual: marca que un humano lo retoma, para que ningún workflow lo persiga.",
  },

  /** Series del setter — acá solo se leen, para no pisarlas desde el territorio del closer. */
  seguimientoParaAgendar: {
    valor: "seguimiento_para_agendar",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Seguimientos",
    uso: "Serie del setter (3 toques · 5 días). Solo lectura desde el closer.",
  },
  seguimientoDecisionLt: {
    valor: "seguimiento_decision_lt",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Seguimientos",
    uso: "Serie del setter (2 toques · 3 días). Solo lectura desde el closer.",
  },

  /* ---- Otros resultados de Avanzar (closer) ---- */

  ventaGanada: {
    valor: "venta_ganada",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Resultados post-call",
    uso: "Venta cerrada → stage Ganado + Opportunity Value.",
  },
  adelantoGanado: {
    valor: "adelanto_ganado",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Resultados post-call",
    uso: "Acordó comprar, falta pago (seña) → stage Adelanto.",
  },
  nurtureAppflow: {
    valor: "nurture_appflow",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Resultados post-call",
    uso: "Nurture tras la call → stage Nurture + escribe Origen nurture.",
  },
  descalificado: {
    valor: "descalificado",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Resultados post-call",
    uso: "No le interesa. Sirve pre y post call; el If cita_agendada bifurca.",
  },
  noshow: {
    valor: "noshow",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Resultados post-call",
    uso: "No asistió. Dispara recuperación (06.4) y NO apaga el bot.",
  },

  /* ---- Territorio (solo lectura) ---- */

  /**
   * EL PORTÓN DE ENTRADA al módulo del closer. Verificado contra el contrato el 2026-07-25.
   *
   * Lo aplica el WF 04.1 al agendar, como swap de `zona_setter`→`zona_closer` (§3 y §9).
   * Es lo mismo que `CLAUDE.md` §11 describe como "al agendar, el contacto ENTRA a su
   * territorio".
   *
   * Es este y no `cita_agendada`, aunque los aplique el mismo workflow en el mismo
   * instante: `cita_agendada` se quita al cerrar o cancelar la cita (§9), así que filtrar
   * por ahí borraría al contacto de las vistas del closer justo al terminar la llamada —
   * que es cuando queda todo el trabajo por hacer (seguimiento, cierre, venta).
   *
   * Dos límites que hay que tener presentes:
   *  - Es TERRITORIO, no asignación: dice "está en el mundo del closer", no de qué closer
   *    es. Con más de uno hará falta otra señal (owner de la oportunidad).
   *  - No se quita nunca — el swap es de una sola vía. Así que incluye también a los
   *    descalificados y a los que están en nurture. Sirve como portón de entrada, no como
   *    filtro de trabajo activo: eso lo deciden el stage y las señales de cada sección.
   */
  zonaCloser: {
    valor: "zona_closer",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §3 y §9 · Territorio",
    uso: "Portón de entrada al módulo Closer. Se aplica al agendar (WF 04.1) y persiste.",
  },

  zonaSetter: {
    valor: "zona_setter",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Territorio",
    uso: "Territorio pre-agenda. El swap al agendar lo reemplaza por zona_closer.",
  },

  /* ---- Solo lectura ---- */

  /**
   * ⚠️ El contrato se contradice sobre este tag: §9 dice "se quita al cerrar/cancelar",
   * §8 dice "NO se quita el tag `cita_agendada` (otros workflows lo usan)". No afecta al
   * portón de entrada (ese es `zona_closer`), pero sí a la lógica de `Resultado de call`,
   * que usa este tag para decidir si un Avanzar vino de una llamada o de un chat.
   * Pendiente de aclarar con Francisco.
   */
  citaAgendada: {
    valor: "cita_agendada",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Territorio",
    uso: "Detector post-call. Lo leemos; nunca lo escribimos ni lo quitamos.",
  },
  estancado: {
    valor: "estancado",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 · Territorio",
    uso: "Lo pone el workflow de barrido. El tool solo lo lee para pintar Estancadas.",
  },
} as const satisfies Record<string, Literal>;

export type TagKey = keyof typeof TAGS;

/**
 * Los tags de seguimiento son mutuamente excluyentes: un contacto está en manual, o en una
 * serie automática, o en ninguna — nunca en dos. Aplicar uno quita los otros.
 */
export const TAGS_SEGUIMIENTO_EXCLUYENTES: readonly TagKey[] = [
  "seguimientoRecupero",
  "seguimientoManual",
  "seguimientoParaAgendar",
  "seguimientoDecisionLt",
];

/**
 * ¿Este contacto pertenece al módulo del closer?
 *
 * Único punto donde se decide, para que activar o cambiar el criterio sea tocar una
 * función y no recorrer la lógica. Se evalúa sobre los tags crudos que trae GHL.
 *
 * `exigirZonaCloser: false` es el estado de hoy: la semilla del demo no tiene tags, así
 * que el filtro dejaría la app vacía. Se pone en `true` cuando los contactos lleguen de
 * GHL de verdad.
 */
export function perteneceAlCloser(tags: readonly string[], exigirZonaCloser = false): boolean {
  if (!exigirZonaCloser) return true;
  return tags.includes(TAGS.zonaCloser.valor);
}

/* ================================================================== */
/* CUSTOM FIELDS — CONTRATO-GHL.md §4                                 */
/* ================================================================== */

export const CAMPOS = {
  nivelInteresSeguimiento: {
    valor: "contact.nivel_de_inters_seguimiento",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Resultados de Avanzar",
    uso: "Subcategoría de la píldora SEGUIMIENTO · X.",
  },
  motivoDescalificacion: {
    valor: "contact.motivo_de_descalificacin",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Resultados de Avanzar",
    uso: "Subcategoría de la píldora DESCALIFICADO · X.",
  },
  formaPagoVenta: {
    valor: "contact.forma_de_pago_venta",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Resultados de Avanzar",
    uso: "Subcategoría de la píldora VENTA — X.",
  },
  razonNoshow: {
    valor: "contact.razn_de_noshow",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Resultados de Avanzar",
    uso: "Subcategoría de la píldora NO-SHOW · X. Insumo de Gerencia.",
  },
  origenNurture: {
    valor: "contact.origen_nurture",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Interacciones",
    uso: "Subcategoría de la píldora NURTURE · X.",
  },
} as const satisfies Record<string, Literal>;

export type CampoKey = keyof typeof CAMPOS;

/* ================================================================== */
/* SITUACIÓN DEL SEGUIMIENTO                                          */
/* ================================================================== */

/** Slug interno. Estable aunque cambie la etiqueta que ve el usuario. */
export type SituacionSeguimiento = "proximo_a_pagar" | "muy_interesado" | "dudando" | "enfriandose" | "otro";

export interface SituacionDef {
  readonly slug: SituacionSeguimiento;
  /** Label de la UI Y valor exacto del dropdown en GHL — el contrato usa los mismos strings. */
  readonly label: string;
  readonly confianza: Confianza;
}

/**
 * El dropdown `nivel_de_inters_seguimiento` tiene CUATRO valores en el contrato, pero la
 * pantalla aprobada (§39.1, marcada DISEÑO APROBADO) tiene CINCO tarjetas. "Otro" queda
 * como `pendiente`: la tarjeta se sigue mostrando, pero si se elige no se escribe el campo
 * en GHL hasta que Francisco agregue el valor al dropdown. La píldora en ese caso queda
 * solo `SEGUIMIENTO`, sin subcategoría — honesto, en vez de forzar al closer a mentir
 * eligiendo una de las otras cuatro.
 */
export const SITUACIONES: readonly SituacionDef[] = [
  { slug: "proximo_a_pagar", label: "Próximo a pagar", confianza: "confirmado" },
  { slug: "muy_interesado", label: "Muy interesado", confianza: "confirmado" },
  { slug: "dudando", label: "Dudando", confianza: "confirmado" },
  { slug: "enfriandose", label: "Enfriándose", confianza: "confirmado" },
  { slug: "otro", label: "Otro", confianza: "pendiente" },
];

export const situacionPorSlug = (slug: SituacionSeguimiento): SituacionDef =>
  SITUACIONES.find((s) => s.slug === slug)!;

/** Para leer lo que GHL devuelve en el custom field. Devuelve `undefined` si no matchea. */
export function situacionDesdeGhl(valor: string | null | undefined): SituacionSeguimiento | undefined {
  if (!valor) return undefined;
  const normalizado = valor.trim().toLowerCase();
  return SITUACIONES.find((s) => s.label.toLowerCase() === normalizado)?.slug;
}

/* ================================================================== */
/* STAGES — CONTRATO-GHL.md §3, pipeline "Appointment Flow"           */
/* ================================================================== */

/**
 * El tool NUNCA escribe el stage: lo mueve el workflow de GHL disparado por el tag
 * (§3 del contrato). Este mapa es solo para LEER lo que GHL devuelve.
 *
 * ⚠️ Discrepancia sin resolver: GHL tiene los stages "Cierre en curso" Y "Adelanto".
 * El front tiene un solo `cierre`, etiquetado "Cierre en curso", que se alimenta de
 * "Acordó comprar, falta pago" — pero el contrato manda esa salida a "Adelanto" vía
 * `adelanto_ganado`. Ninguna salida de Avanzar escribe "Cierre en curso". Se mapean los
 * dos stages de GHL al mismo `cierre` del front y queda anotado para Francisco.
 */
export const STAGE_GHL_A_FRONT: Readonly<Record<string, string>> = {
  Agendado: "agendado",
  "Cierre en curso": "cierre",
  Adelanto: "cierre",
  Seguimiento: "seguimiento",
  Ganado: "ganado",
  "No-show": "no_show",
  Nurture: "nurture",
  Descalificado: "descalificado",
};

/**
 * Regla de acumulación (§4 del contrato): al escribir una subcategoría nueva NO se borran
 * las anteriores, así que un contacto acumula varios campos llenos. La píldora muestra solo
 * la del stage ACTUAL; el resto queda como historial invisible, disponible para Gerencia.
 */
export const CAMPO_SUBCATEGORIA_POR_STAGE: Readonly<Partial<Record<string, CampoKey>>> = {
  ganado: "formaPagoVenta",
  seguimiento: "nivelInteresSeguimiento",
  no_show: "razonNoshow",
  nurture: "origenNurture",
  descalificado: "motivoDescalificacion",
};

/* ================================================================== */
/* Red de seguridad                                                    */
/* ================================================================== */

export class LiteralNoConfirmadoError extends Error {
  constructor(literal: Literal) {
    super(
      `Literal de GHL sin confirmar: "${literal.valor}" (${literal.fuente}). ` +
        `No se envía a GHL en modo real — pedir confirmación a Francisco antes de activarlo. ` +
        `CLAUDE.md §49: los nombres se usan literales del contrato, no se inventan.`,
    );
    this.name = "LiteralNoConfirmadoError";
  }
}

/**
 * Portón único antes de que cualquier literal salga hacia GHL.
 *
 * En modo stub no hace nada: queremos poder ejercitar toda la lógica con los nombres
 * propuestos. En modo real lanza, para que un nombre inventado no llegue nunca a la cuenta
 * de producción — donde el peor caso no es un error visible, sino un tag que no dispara
 * ningún workflow y nadie se entera.
 */
export function assertEnviable(literal: Literal, modoReal: boolean): void {
  if (modoReal && literal.confianza === "pendiente") throw new LiteralNoConfirmadoError(literal);
}

/** Inventario para el arranque del server y para el doc — qué falta confirmar. */
export function literalesPendientes(): Literal[] {
  return [...Object.values(TAGS), ...Object.values(CAMPOS)].filter((l) => l.confianza === "pendiente");
}
