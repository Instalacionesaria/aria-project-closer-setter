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
   * No está en el contrato escrito (se decidió el 2026-07-25), pero se verificó contra la
   * subcuenta el mismo día: el tag EXISTE. Confirmado por comprobación directa, no por doc.
   */
  seguimientoManual: {
    valor: "seguimiento_manual",
    confianza: "confirmado",
    fuente: "Verificado en la subcuenta DbWG5cimcumPcKk5p3xC el 2026-07-25",
    uso: "Modo manual: marca que un humano lo retoma, para que ningún workflow lo persiga.",
  },

  /**
   * Existe en la cuenta pero NO está en el contrato. Por el nombre parece la marca de
   * "serie terminada", que es justo el disparador que falta para la tarea de §16.1.D
   * ("Seguimiento agotado — revisar"). Sin confirmar quién lo aplica ni cuándo, así que
   * por ahora solo se lee, nunca se escribe.
   */
  seguimientoTerminado: {
    valor: "seguimiento_terminado",
    confianza: "pendiente",
    fuente: "Encontrado en la subcuenta el 2026-07-25 — no documentado en CONTRATO-GHL.md",
    uso: "Candidato a disparador de 'serie agotada'. Solo lectura hasta confirmar su semántica.",
  },

  /* ---- Etapas propias del setter (pre-agenda) ---- */

  /**
   * ── Las tres que faltan, y por qué solo tres ──────────────────────
   *
   * El pipeline del setter tiene 7 etapas, pero **cuatro ya tienen tag confirmado** y sería un
   * error crear duplicados:
   *
   *   · `low_ticket_ofrecido` → `derivado_lt` (TAGS_BOT). Ofrecerle un low-ticket a un lead ES
   *     derivarlo a low-ticket: el tag ya significa exactamente eso.
   *   · `agendado`            → lo resuelve el swap `zona_setter` → `zona_closer` del WF 04.1.
   *                             No necesita tag propio; de hecho tener uno sería una segunda
   *                             fuente para el mismo hecho.
   *   · `nurture`             → `nurture_appflow`.
   *   · `descalificado`       → `descalificado`.
   *
   * Quedan estas tres, que son las etapas de calificación — el trabajo específico del setter, que
   * hoy no tiene representación en GHL porque el módulo nunca escribió nada.
   *
   * Van como `pendiente` a propósito: `assertEnviable()` impide que salgan en modo real hasta que
   * existan en la subcuenta. La app las usa igual para su propio pipeline (Supabase es la fuente de verdad
   * del stage), así que las 7 columnas funcionan desde el día uno y la escritura a GHL se
   * enciende sola cuando los tags existan.
   */
  setterNuevo: {
    valor: "setter_nuevo",
    confianza: "pendiente",
    fuente: "Propuesto por nosotros el 2026-08-08. Pendiente de crearlo en la subcuenta.",
    uso: "Lead que entró y todavía nadie tocó. Primera etapa del pipeline del setter.",
  },
  setterEnCalificacion: {
    valor: "setter_en_calificacion",
    confianza: "pendiente",
    fuente: "Propuesto por nosotros el 2026-08-08. Pendiente de crearlo en la subcuenta.",
    uso: "El setter está calificándolo: hay conversación en curso pero todavía no hay veredicto.",
  },
  setterCalificado: {
    valor: "setter_calificado",
    confianza: "pendiente",
    fuente: "Propuesto por nosotros el 2026-08-08. Pendiente de crearlo en la subcuenta.",
    uso: "Califica para high-ticket pero todavía no agendó. Es la etapa 🔥 del pipeline.",
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
   * Pendiente de aclarar con Fabio.
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
/* TAGS DE BOT — CONTEXTO-CLOSER-Conexiones-Polling.md §2             */
/* ================================================================== */

/**
 * Los interruptores del chatbot de GHL. Antes de esta sección vivían como strings sueltos
 * repetidos en cuatro archivos (`respondieron.ts`, `contactos.ts`, `urgentes.ts`,
 * `analizador.ts`) — la duplicación estaba anotada como deuda en `respondieron.ts`.
 *
 * `bot_activado` es el único que este tool nunca vio en la subcuenta: lo tiene que aplicar
 * Fabio en sus workflows cuando el chatbot atiende, y los que lo harían siguen en
 * borrador (ver `docs/03-INTEGRACION-GHL.md` y `docs/10-ESTADO.md`). Va `confirmado` igual
 * porque este tool solo lo LEE — leer un tag que no existe todavía es un no-op, no un
 * riesgo. Lo que SÍ bloquea es al auditor: ver `docs/07-AUDITOR-IA.md`.
 */
export const TAGS_BOT = {
  botActivado: {
    valor: "bot_activado",
    confianza: "confirmado",
    fuente: "CONTEXTO-CLOSER-Conexiones-Polling.md §2 — lo aplica el workflow de GHL",
    uso: "El chatbot de GHL está atendiendo al contacto. Solo lectura.",
  },
  botReactivar: {
    valor: "bot_reactivar",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9",
    uso: "Orden de reactivar el bot (el flujo de intervenciones al resolver). No decide estado.",
  },
  botDesactivadoPostcall: {
    valor: "bot_desactivado_postcall",
    confianza: "confirmado",
    fuente: "CONTEXTO-CLOSER-Conexiones-Polling.md §2/§8.6",
    uso: "Ya tuvo la sales call. Lo aplican las 5 salidas de Avanzar (todas menos No-show).",
  },
  botPausadoFallo: {
    valor: "bot_pausado_fallo",
    confianza: "confirmado",
    fuente: "api/_lib/analizador.ts (el auditor de lo aplica el workflow)",
    uso:
      "El auditor IA apagó el bot por fallo grave. Lo APLICA el auditor y lo QUITA " +
      "`api/agentes/alertas.ts` al resolver la intervención por humano (§10 de la espec " +
      "multiempresa, 2026-08-07). Antes decía 'solo lectura': sin quitarlo, el contacto volvía a " +
      "Urgentes en el próximo tick con la alerta ya resuelta.",
  },
  botApagadoManual: {
    valor: "bot_apagado_manual",
    confianza: "confirmado",
    fuente: "api/_lib/contactos.ts — vivía como string suelto hasta 2026-08-04",
    uso: "Un humano apagó el bot a mano desde el compositor. Solo lectura.",
  },
  derivadoLt: {
    valor: "derivado_lt",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §9 — vivía como string suelto en contactos.ts",
    uso: "El bot derivó la conversación a low-ticket y se pausó al hacerlo. Solo lectura.",
  },
} as const satisfies Record<string, Literal>;

/**
 * El tag que dispara el workflow de seguimiento AUTOMÁTICO post-call en GHL.
 *
 * PENDIENTE confirmar con Fabio cuál de la familia `seguimiento_*` es el correcto —
 * mientras tanto es `seguimiento_recupero`, que es lo que el código ya mandaba antes de
 * esta tarea. Cambiar el valor acá NO debe tocar ninguna lógica (doc §2).
 */
export const TAG_SEGUIMIENTO_AUTO = TAGS.seguimientoRecupero.valor;

/** El bot, reducido a lo único que decide el ruteo de mensajes: ¿está atendiendo o no? */
export type EstadoBot = "prendido" | "apagado";

/**
 * Los 6 estados del toggle 🤖 (§25.A). Vive acá y no en `closerStore.tsx` porque `api/` lo
 * necesita para derivarlo del lado del servidor, y una función serverless no debe arrastrar
 * un `.tsx` con React adentro. `closerStore` lo re-exporta para no romper sus consumidores.
 */
export type BotEstado =
  | "activo"
  | "pausado_fallo"
  | "apagado_manual"
  | "pausa_temporal"
  | "derivado_lt"
  | "muerto_postcall";

/** El chip de fuente de un contacto de Instagram — el único canal sin bot (§11). */
export const FUENTE_IG = "📷 IG PROFILE";

/**
 * EL estado del bot, derivado de los tags. Única implementación en todo el proyecto.
 *
 * Hasta el 2026-08-04 había DOS que no se hablaban: esta (que solo distinguía prendido de
 * apagado, para rutear el Buzón) y una `botDesdeTags` local en `api/_lib/contactos.ts` que
 * escribía la columna `closer_contactos.bot_estado`. Esa columna estaba NULL en los 7
 * contactos de producción — se derivaba y se guardaba, pero nadie la leía de vuelta. Ahora
 * el estado se DERIVA en cada lectura y la columna quedó obsoleta (migración 013).
 *
 * Precedencia, de más específico a menos (los apagados ganan siempre):
 *
 *   fuente IG                   → null              (nunca tuvo bot, §11)
 *   bot_pausado_fallo           → pausado_fallo     (urgencia accionable — gana porque pide acción)
 *   bot_desactivado_postcall    → muerto_postcall   (terminal, §34)
 *   derivado_lt                 → derivado_lt
 *   bot_apagado_manual          → apagado_manual
 *   bot_activado                → activo
 *   ninguno                     → null              (default APAGADO, §51.3)
 *
 * `pausa_temporal` NO se deriva: no tiene tag en GHL. Es un estado optimista que el front
 * superpone localmente al enviar un mensaje manual (§25.C), hasta el próximo refresco.
 *
 * El `null` final es deliberado y no es lo mismo que `"activo"`: significa "el sistema no
 * tiene evidencia de que el bot esté atendiendo". Afirmar lo contrario contradiría el ruteo
 * del Buzón, que con ese mismo default ya está mandando esos mensajes al closer.
 */
export function botDesdeTags(tags: readonly string[], fuente?: string | null): BotEstado | null {
  if (fuente === FUENTE_IG) return null;
  const t = tags.map((x) => x.trim().toLowerCase());
  if (t.includes(TAGS_BOT.botPausadoFallo.valor)) return "pausado_fallo";
  if (t.includes(TAGS_BOT.botDesactivadoPostcall.valor)) return "muerto_postcall";
  if (t.includes(TAGS_BOT.derivadoLt.valor)) return "derivado_lt";
  if (t.includes(TAGS_BOT.botApagadoManual.valor)) return "apagado_manual";
  if (t.includes(TAGS_BOT.botActivado.valor)) return "activo";
  return null;
}

/**
 * Proyección binaria de `botDesdeTags`, que es lo único que necesita el ruteo del Buzón
 * (§51.3): ¿el chatbot está atendiendo, sí o no?
 *
 * Es una PROYECCIÓN y no una segunda implementación a propósito — así no pueden divergir.
 * Semántica idéntica a la versión anterior: los cuatro estados de apagado y el `null` caen
 * todos en `"apagado"`, y solo `bot_activado` sin ningún tag de apagado da `"prendido"`.
 */
export function estadoBotDesdeTags(tags: readonly string[]): EstadoBot {
  return botDesdeTags(tags) === "activo" ? "prendido" : "apagado";
}

/**
 * ¿El agente de texto de GHL está ATENDIENDO esta conversación ahora mismo?
 *
 * Es el portón del auditor de IA, y existe por un bug real (2026-08-04): el auditor analizaba
 * cualquier contacto del territorio, tuviera bot o no. Con el bot apagado, la conversación no
 * tiene ni un mensaje del agente — y el criterio 2 de su rúbrica es "la IA dejó de responder
 * o ignoró al usuario". **Ese criterio se cumple SIEMPRE cuando no hay bot.** No era un falso
 * positivo ocasional: era uno garantizado, que mandaba contactos sanos a la cola roja y
 * gastaba una llamada al modelo por cada mensaje.
 *
 * Se separa de `estadoBotDesdeTags` en vez de reusarla porque incluye `bot_reactivar`, que el
 * contrato §9 define como una ORDEN de reactivar y no como un estado. Para el ruteo del Buzón
 * esa distinción importa (todavía no está prendido); para el auditor no (ya hay un agente que
 * va a contestar, y su respuesta es auditable). Un tag de apagado sigue ganando sobre los dos.
 */
export function botAtendiendo(tags: readonly string[]): boolean {
  const estado = botDesdeTags(tags);
  if (estado === "activo") return true;
  // `bot_reactivar` solo cuenta si NINGÚN tag de apagado lo contradice.
  if (estado !== null) return false;
  return tags.map((t) => t.trim().toLowerCase()).includes(TAGS_BOT.botReactivar.valor);
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
/* CUSTOM FIELDS DEL PERFIL — CONTRATO-GHL.md §4                      */
/* ================================================================== */

/**
 * Los campos que el lead llenó —o que un agente registró sobre él— y que alimentan el tab
 * Perfil de la ficha.
 *
 * ── Por qué van aparte de `CAMPOS` y no adentro ──
 *
 * `CAMPOS` son las subcategorías que el tool ESCRIBE al registrar un Avanzar: cada una
 * tiene un tag y un workflow detrás, y por eso pasan por `assertEnviable()` antes de salir.
 * Estos son de **solo lectura**: los escriben los formularios (VSL, Meta Lead Ads) y los
 * agentes de GHL, y el tool no los toca nunca. Mezclarlos haría que `literalesPendientes()`
 * —el inventario de "qué falta confirmar antes de poder escribirlo"— hablara también de
 * campos que nadie escribe desde acá, y `CampoKey` (que hoy significa "subcategoría de
 * Avanzar" en `resultados.ts` y en `CAMPO_SUBCATEGORIA_POR_STAGE`) pasaría a significar dos
 * cosas distintas a la vez.
 *
 * ── Cada entrada dice además dónde va en la ficha ──
 *
 * `grupo` sigue la regla del Perfil (CLAUDE.md §41.2): se agrupa por SIGNIFICADO, no por rol
 * ni por formulario de origen. `formulario` solo aplica dentro de `calificacion`, y esa
 * separación VSL/Meta es intencional del contrato: son campos DISTINTOS aunque la pregunta
 * se parezca ("NO unificar", §4), y un contacto puede tener llenos los de uno, los del otro,
 * o ambos — mostrarlos juntos borraría esa información.
 *
 * Ojo con los literales: llevan los typos y las vocales comidas tal como están en la cuenta
 * (`_cul_es_...`, `confirmacin_...`). Son unique keys, no prosa. "Arreglarlos" hace que el
 * campo deje de encontrarse y el Perfil quede vacío sin que nada falle.
 */

/**
 * Espejo estructural de `PerfilGroup` / `PerfilFormulario` de `src/lib/closerStore.tsx`.
 * No se importan de ahí a propósito: este módulo es isomorfo (lo cargan las funciones de
 * `api/`) y aquel es un componente de React. Si divergen, lo canta el endpoint que arma la
 * respuesta, porque la forma que espera `PerfilTab` es la de allá.
 */
export type GrupoPerfil = "detalles" | "origen" | "calificacion" | "interacciones";
export type FormularioPerfil = "vsl" | "meta";

export interface CampoPerfil extends Literal {
  /** Label corto que ve el usuario en la ficha. No es la pregunta entera del formulario. */
  readonly etiqueta: string;
  readonly grupo: GrupoPerfil;
  /** Solo en `calificacion`: decide el bloque "Form VSL" o "Form Meta". */
  readonly formulario?: FormularioPerfil;
  /** Micro-label opcional de procedencia, ej. "vía llamada IA". Informa, no agrupa. */
  readonly procedencia?: string;
}

export const CAMPOS_PERFIL = {
  /* ---- Calificación · Form VSL (landing) — CONTRATO-GHL.md §4 ---- */

  vslEtapaNegocio: {
    valor: "contact._en_qu_etapa_est_tu_negocio_hoy",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Calificación — form VSL",
    uso: 'Pregunta "¿En qué etapa está tu negocio hoy?". Solo lectura.',
    etiqueta: "Etapa del negocio",
    grupo: "calificacion",
    formulario: "vsl",
  },
  vslObjetivoFacturacion: {
    valor: "contact._cul_es_tu_objetivo_de_facturacin",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Calificación — form VSL",
    uso: 'Pregunta "¿Cuál es tu objetivo de facturación?". Solo lectura.',
    etiqueta: "Objetivo de facturación",
    grupo: "calificacion",
    formulario: "vsl",
  },
  vslTipoServicios: {
    valor: "contact._qu_tipo_de_servicios_ofreces_o_planeas_ofrecer",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Calificación — form VSL",
    uso: 'Pregunta "¿Qué tipo de servicios ofreces (o planeas ofrecer)?". Solo lectura.',
    etiqueta: "Tipo de servicios",
    grupo: "calificacion",
    formulario: "vsl",
  },
  vslMayorObstaculo: {
    valor: "contact._cul_es_el_mayor_obstculo_que_te_est_impidiendo_llegar_a_ese_objetivo",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Calificación — form VSL",
    uso: 'Pregunta "¿Cuál es el mayor obstáculo que te está impidiendo llegar a ese objetivo?". Solo lectura.',
    etiqueta: "Mayor obstáculo",
    grupo: "calificacion",
    formulario: "vsl",
  },
  vslListoParaEmpezar: {
    valor: "contact._si_somos_una_buena_opcin_para_ti_y_tenemos_cupo_disponible_estaras_listo_para_empezar_ahora",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Calificación — form VSL",
    uso: 'Pregunta "Si somos una buena opción y hay cupo, ¿estarías listo para empezar ahora?". Solo lectura.',
    etiqueta: "Listo para empezar ahora",
    grupo: "calificacion",
    formulario: "vsl",
  },
  vslInversion4a8k: {
    valor: "contact._podras_asumir_una_inversin_de_4000_a_8000_usd",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Calificación — form VSL",
    uso: 'Pregunta "¿Podrías asumir una inversión de $4,000 a $8,000 USD?" — el filtro de capital del high-ticket (§1). Solo lectura.',
    etiqueta: "Inversión $4-8k",
    grupo: "calificacion",
    formulario: "vsl",
  },
  vslCompromisoAsistencia: {
    valor: "contact._al_agendar_confirmas_tu_compromiso_de_asistencia",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Calificación — form VSL",
    uso: '"Al agendar, confirmas tu compromiso de asistencia". Solo lectura.',
    etiqueta: "Compromiso de asistencia",
    grupo: "calificacion",
    formulario: "vsl",
  },
  vslTieneEquipo: {
    valor: "contact.tiene_equipo_",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Calificación — form VSL",
    uso: "¿Tiene equipo? Lo llena el agente de voz durante la llamada, no el formulario. Solo lectura.",
    etiqueta: "Tiene equipo",
    grupo: "calificacion",
    formulario: "vsl",
    procedencia: "vía llamada IA",
  },

  /* ---- Calificación · Form Meta (Lead Ads) — CONTRATO-GHL.md §4 ---- */

  metaEtapaNegocio: {
    valor: "contact.en_que_etapa_esta_tu_negocio_hoy",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Meta Lead Ads — form Meta",
    uso: 'Pregunta "En que etapa esta tu negocio hoy?". Campo propio de Meta, distinto del homónimo de la VSL. Solo lectura.',
    etiqueta: "Etapa del negocio",
    grupo: "calificacion",
    formulario: "meta",
  },
  metaObjetivoFacturacion: {
    valor: "contact.cual_es_tu_objetivo_de_facturacion",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Meta Lead Ads — form Meta",
    uso: 'Pregunta "Cual es tu objetivo de facturacion?". Campo propio de Meta. Solo lectura.',
    etiqueta: "Objetivo de facturación",
    grupo: "calificacion",
    formulario: "meta",
  },
  metaMayorObstaculo: {
    valor: "contact.cual_es_el_mayor_obstaculo_que_te_esta_impidiendo_llegar_a_ese_objetivo",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Meta Lead Ads — form Meta",
    uso: 'Pregunta "Cual es el mayor obstaculo...?". Campo propio de Meta. Solo lectura.',
    etiqueta: "Mayor obstáculo",
    grupo: "calificacion",
    formulario: "meta",
  },

  /* ---- Interacciones (eje engagement, §7) — CONTRATO-GHL.md §4 ---- */

  confirmacionCitaWsp: {
    valor: "contact.confirmacin_cita_por_wsp",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Interacciones",
    uso: "Clic al botón de confirmación post-agenda por WhatsApp. Solo lectura.",
    etiqueta: "Confirmación de cita por WhatsApp",
    grupo: "interacciones",
  },
  videoPrecall: {
    valor: "contact._video_precall",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Interacciones",
    uso: "Porcentaje visto del video pre-call. NUNCA modifica el score (§9). Solo lectura.",
    etiqueta: "Video pre-call",
    grupo: "interacciones",
  },
  videoPrecallFecha: {
    valor: "contact._video_precall_fecha",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Interacciones",
    uso: "Cuándo se vio el video pre-call. Solo lectura.",
    etiqueta: "Video pre-call · fecha",
    grupo: "interacciones",
  },
  llamadasIaIntentos: {
    valor: "contact._llamadas_ia_intentos",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Interacciones",
    uso: "Intentos de llamada IA hasta contestar. Las sales calls no cuentan acá (§8). Solo lectura.",
    etiqueta: "Llamadas IA · intentos",
    grupo: "interacciones",
  },
  llamadasIaContestadas: {
    valor: "contact._llamadas_ia_contestadas",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Interacciones",
    uso: "Llamadas IA contestadas (puede haber dos: lead flow + app flow). Solo lectura.",
    etiqueta: "Llamadas IA · contestadas",
    grupo: "interacciones",
  },
  ultimaLlamadaIaResultado: {
    valor: "contact.ultima_llamada_ia__resultado",
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Interacciones",
    uso: "Resultado de la última llamada IA (responde / buzón / etc.). Solo lectura.",
    etiqueta: "Última llamada IA · resultado",
    grupo: "interacciones",
  },

  /**
   * Mismo campo que la subcategoría de la píldora NURTURE — se referencia `CAMPOS` en vez de
   * repetir el literal, para que no puedan divergir. Acá se lee por la regla de acumulación
   * (§4 del contrato): el campo queda lleno aunque el contacto ya no esté en Nurture, y ese
   * historial es justamente lo que sirve ver en la ficha.
   */
  origenNurture: {
    valor: CAMPOS.origenNurture.valor,
    confianza: "confirmado",
    fuente: "CONTRATO-GHL.md §4 · Carpeta Interacciones",
    uso: "Origen del nurture (No-show / Pidió tiempo / Se enfrió). Acá solo se lee; lo escribe el Avanzar.",
    etiqueta: "Origen nurture",
    grupo: "interacciones",
  },
} as const satisfies Record<string, CampoPerfil>;

export type CampoPerfilKey = keyof typeof CAMPOS_PERFIL;

/**
 * Los mismos campos como lista, ya tipada como `CampoPerfil[]`.
 *
 * `Object.values(CAMPOS_PERFIL)` devuelve la unión de los tipos exactos de cada entrada, y
 * como `as const` no agrega las propiedades opcionales que un objeto no tiene, leer
 * `campo.formulario` sobre esa unión no compila. Esta lista existe para recorrerlos sin
 * repetir un cast en cada caller. El ORDEN es el de declaración, y es el que termina viendo
 * el usuario dentro de cada grupo — cambiarlo reordena la ficha.
 */
export const CAMPOS_PERFIL_ORDENADOS: readonly CampoPerfil[] = Object.values(CAMPOS_PERFIL);

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
 * Los cinco labels coinciden EXACTAMENTE con las opciones del dropdown en la subcuenta,
 * verificado el 2026-07-25 contra el campo `iZN1zfDlTOrPvjssFjrX` (tipo SINGLE_OPTIONS):
 *   Próximo a pagar | Muy interesado | Dudando | Enfriándose | Otro
 *
 * El contrato escrito lista solo cuatro (le falta "Otro"), pero la cuenta ya lo tiene, así
 * que la pantalla aprobada de §39.1 —que siempre tuvo cinco tarjetas— queda cubierta.
 * Si alguno de estos strings cambia en GHL, la escritura del campo falla en silencio:
 * son los valores literales del dropdown, no etiquetas de UI.
 */
export const SITUACIONES: readonly SituacionDef[] = [
  { slug: "proximo_a_pagar", label: "Próximo a pagar", confianza: "confirmado" },
  { slug: "muy_interesado", label: "Muy interesado", confianza: "confirmado" },
  { slug: "dudando", label: "Dudando", confianza: "confirmado" },
  { slug: "enfriandose", label: "Enfriándose", confianza: "confirmado" },
  { slug: "otro", label: "Otro", confianza: "confirmado" },
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
 * dos stages de GHL al mismo `cierre` del front y queda anotado para Fabio.
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
        `No se envía a GHL en modo real — pedir confirmación a Fabio antes de activarlo. ` +
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
