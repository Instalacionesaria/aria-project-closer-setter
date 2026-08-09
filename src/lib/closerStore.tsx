import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "./settingsStore";
import { useAuth } from "./authStore";
import {
  filaAContacto,
  registrarResultadoRemoto,
  registrarSeguimientoRemoto,
  traerMiDia,
  type RespuestaAvanzar,
} from "./seguimientos/cliente";
import type { ModoSeguimiento } from "./seguimientos/dominio";
import type { SituacionSeguimiento } from "./ghl/contrato";
import { etapaDesdeTags } from "./ghl/etapas";
import { armarPildora } from "./pildora";
import {
  crearNota,
  eliminarContacto,
  eliminarNota,
  fetchAgendaRange,
  fetchHistorial,
  fetchLlamadas,
  fetchNotas,
  fetchPipeline,
  sincronizarCrm as sincronizarCrmRemoto,
  tickCloser,
  type AgendaAppointment,
  type EventoHistorial,
  type MiDiaResponse,
  type NotaReal,
  type PipelineContacto,
  type PipelineStats,
  type SincronizarCrmResponse,
} from "./api";
import type { IndicadoresContacto } from "./indicadores";
import { CADENCIA, registrarReloj } from "./polling";

/* Los pollers `polling-closer-intervenciones-urgentes` (10s) y `polling-closer-pipeline`
   (30s) se eliminaron el 2026-07-31: sus datos ahora llegan de NUESTRO backend (Supabase,
   cero GHL por request) vía el reloj único de Mi Día, y el Pipeline se refresca por evento
   (montaje, foco, después de un Avanzar). El único reloj que "toca" GHL es el disparador de
   /api/closer/reconciliar — y su candado vive en el backend. Ver `src/lib/polling.ts`. */

/* El dinero real del cockpit NO tiene polling propio (corrección de Fabio, 2026-07-31): se lee
   una vez al cargar y se relee solo cuando `polling-closer-pipeline` — que ya existe — detecta
   que un contacto real entró o salió de Ganado/Cierre. Ver `claveDinero` en el provider. */

/**
 * Cuánto tiempo un contacto tocado a mano conserva su etapa local frente a lo que diga GHL.
 * Cubre la ventana entre que se registra un Avanzar y que GHL termina de aplicar el tag.
 */
const GRACIA_MS = 20_000;

/**
 * Quién firma lo que se escribe desde la app.
 *
 * Era la constante `"Jorge Q."`, de cuando no había sesión (§50.7). Ahora la hay. Igual **no es
 * esto lo que decide la firma**: el backend ignora el `autor` del cuerpo y usa `ctx.nombre` (ver
 * `api/closer/notas.ts`). Sirve para pintar la nota en la lista sin esperar la respuesta, y si
 * difiriera del servidor el próximo GET lo corrige.
 */
const AUTOR_OPTIMISTA = "Vos";

/** Fecha corta para la ficha ("3 ago, 17:41") — el servidor manda ISO crudo (CONTRATO §0). */
const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleString("es-PE", {
    timeZone: "America/Lima",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Una nota de la base → la forma que ya consume el tab Notas. */
const notaRealAItem = (n: NotaReal): NotaItem => ({
  // El id de la base es uuid y `NotaItem.id` es number (viene de la era demo): se usa el
  // timestamp como clave de React, que es único por nota dentro de la misma ficha.
  id: new Date(n.creadoEl).getTime(),
  contexto: n.contexto,
  texto: n.texto,
  autor: n.autor,
  fecha: fechaCorta(n.creadoEl),
  realId: n.id,
});

/** Un evento de la base → la forma que ya consume el tab Historial. */
const eventoAItem = (e: EventoHistorial): HistorialItem => ({
  fecha: fechaCorta(e.ocurrioEl),
  texto: e.texto,
  autor: e.autor,
});

/**
 * Single source of truth for the Closer module (§4.4 de CLAUDE.md): Avanzar es el
 * único mecanismo que cambia el estado de un contacto. Pipeline, Mi Día e Inicio
 * leen de aquí — nunca guardan su propio estado.
 */

export type Grade = "A" | "B" | "C" | "D";
export type StageKey = "agendado" | "seguimiento" | "cierre" | "ganado" | "no_show" | "nurture" | "descalificado";

/** Origen del Nurture (closer) — decide el sub-texto de la píldora "NURTURE · X". */
export type NurtureOrigen = "no_show" | "pidio_tiempo" | "se_enfrio";

/**
 * Estado del toggle 🤖 (§ "Restaurar y reglar el toggle del agente IA", 2026-07-10).
 * "activo" = ON normal. "pausado_fallo" = el motor detectó un fallo (banner urgente, bloqueado hasta resolver).
 * "apagado_manual" = lo apagó el humano (clicable, prender pide confirmación normal).
 * "pausa_temporal" = el humano escribió manual SIN apagar el toggle (ON atenuado, se auto-levanta en ~2h).
 * "derivado_lt" = el sistema derivó a low-ticket (clicable, prender pide confirmación reforzada).
 * "muerto_postcall" = tras la sales call (solo closer) — el toggle ya no se renderiza en absoluto.
 */
export type BotEstado = "activo" | "pausado_fallo" | "apagado_manual" | "pausa_temporal" | "derivado_lt" | "muerto_postcall";

/**
 * Única fuente de verdad para el color/texto/tooltip del ícono 🤖 — usada tanto por el header/filas
 * (solo lectura) como por el toggle del compositor, para que ambas vitrinas reflejen el mismo estado (regla D.7).
 * `estado` undefined = sin bot asignado (canal IG o dato ausente).
 */
export function botIconVisual(estado: BotEstado | undefined): { className: string; label?: string; title: string } {
  switch (estado) {
    case "activo":
      return { className: "text-emerald-500", title: "IA activa" };
    case "pausado_fallo":
      return { className: "text-red-500", title: "Pausado por fallo — responde al contacto y marca como resuelto" };
    case "apagado_manual":
      return { className: "text-[#6b6980]", title: "IA apagada manualmente" };
    case "pausa_temporal":
      return { className: "text-amber-500", title: "Pausado ~2h por tu mensaje — se reactiva solo" };
    case "derivado_lt":
      return { className: "text-violet-500", label: "LT", title: "Derivado a low-ticket — IA pausada" };
    case "muerto_postcall":
      return { className: "text-[#6b6980]/25", title: "IA inactiva — sales call realizada" };
    default:
      return { className: "text-[#6b6980]/25", title: "Sin agente IA asignado" };
  }
}

export interface HistorialItem {
  fecha: string;
  texto: string;
  autor: string;
}

export interface NotaItem {
  id: number;
  contexto: string | null;
  texto: string;
  autor: string;
  fecha: string;
  /** El uuid de `closer_notas` — presente SOLO en notas reales; con él se borra en el servidor. */
  realId?: string;
}

/**
 * Tab "Llamadas" de la ficha (§ spec de Fabio, 2026-07-10). Tres orígenes:
 * "sales_call" (closer, meet de ventas — score/objeciones SOLO aquí, nunca en llamadas de IA),
 * "app_flow_voz" (closer, agente Appointment Flow), "lead_flow_voz" (setter, agente Lead Flow).
 */
/**
 * `voz_ia` (2026-08-06) es el cuarto y significa *"llamada de un agente de IA cuyo embudo no
 * sabemos"*. Nace con las llamadas de Assistable: el payload trae `assistant_id`, y un
 * asistente que no está en el mapa de `src/lib/assistable.ts` no se puede clasificar sin
 * inventar. Como NO es una sales call, los dos contadores siguen midiendo bien —lo único que
 * se pierde es la etiqueta del chip— así que degradar acá no cuesta ningún dato.
 */
export type CallOrigin = "sales_call" | "app_flow_voz" | "lead_flow_voz" | "voz_ia";
export type Sentimiento = "positivo" | "neutral" | "negativo";

export interface CallRecord {
  id: string;
  origin: CallOrigin;
  fecha: string;
  duracion: string;
  contestada: boolean;
  /** Texto tras la duración — closer: "Resultado: {texto}"; IA: "{Contestó/No contestó} · {texto}". */
  resultado?: string;
  /** Solo llamadas de IA — presente únicamente si `contestada` (sin conexión = sin resumen). */
  resumenIA?: string;
  sentimiento?: Sentimiento;
  /** Solo sales_call. */
  scoreFinal?: number;
  objeciones?: string[];
  puntosFuertes?: string[];
  aMejorar?: string[];
  /** Ausente = sin audio (buzón de voz / no contestó) — el reproductor no se renderiza. */
  audioUrl?: string;
}

/**
 * Regla transversal #4 (§ auditoría íconos, 2026-07-10): los íconos de estado NUNCA se setean a mano —
 * se derivan de los mismos datos que alimentan los tabs. Un solo origen de verdad, dos vitrinas.
 */

/** 📞 — cuenta ÚNICAMENTE llamadas de agentes IA (Lead Flow + App Flow, mismo contador) con resultado contestada. Las sales calls jamás suman aquí. */
export function countCallsContestadas(llamadas?: CallRecord[]): number {
  if (!llamadas) return 0;
  return llamadas.filter((l) => l.origin !== "sales_call" && l.contestada).length;
}

/**
 * 📹 — cuenta llamadas/reuniones CON EL CLOSER (`origin === "sales_call"`), 2026-07-11.
 * Reemplaza al viejo flag 🎙 (eliminado) y a la derivación por `agenda.meetUrl` — el ícono de
 * video ahora es un contador igual que 📞, solo que cuenta sales calls en vez de llamadas de IA.
 */
export function countSalesCalls(llamadas?: CallRecord[]): number {
  if (!llamadas) return 0;
  return llamadas.filter((l) => l.origin === "sales_call").length;
}

export interface CallsIASummary {
  intentos: number;
  contestadas: number;
  ultimoResultado?: string;
}

/**
 * Tab Perfil > Interacciones (2026-07-16) — resumen de llamadas de agentes IA (Lead Flow/App Flow
 * Voz), calculado SIEMPRE del mismo `llamadas` que alimenta el tab Llamada — nunca un campo aparte
 * (regla transversal #4, § auditoría íconos). `llamadas` viene ordenado más reciente primero, así
 * que el primer intento de IA de la lista es el "último resultado".
 */
export function callsIASummary(llamadas?: CallRecord[]): CallsIASummary {
  const ia = (llamadas ?? []).filter((l) => l.origin !== "sales_call");
  return {
    intentos: ia.length,
    contestadas: ia.filter((l) => l.contestada).length,
    ultimoResultado: ia[0]?.resultado,
  };
}

export interface AgendaInfo {
  time: string;
  badge?: string;
  expanded?: boolean;
  briefing?: string;
  videoPre?: string;
  /** Presencia = la sala del Meet ya existe (§ auditoría íconos, 2026-07-10) — enciende 📹. Sin ella, la cita existe (📅) pero aún no tiene sala. */
  meetUrl?: string;
}

export interface UrgenteInfo {
  pill: string;
  detail: string;
  detailClass?: string;
  daysBadge?: string;
  highlighted?: boolean;
  phone?: boolean;
}

/** Presencia = aparece en "Respondieron" (buzón general) de Mi Día. */
export interface RespondidoInfo {
  microtext: string;
}

/** Presencia = aparece en "Seguimientos" de Mi Día (distinto del stage macro "seguimiento" del Pipeline). */
export interface SeguimientoPendienteInfo {
  microtext: string;
  vencido?: boolean;
}

/** Tab Perfil > Video pre-call. Ausente = el campo no se renderiza (regla: sin dato, no hay elemento). */
export interface VideoPreCallInfo {
  visto: boolean;
  pct?: number;
  fecha?: string;
  diasSinAbrir?: number;
}

/**
 * Tab Perfil (§ auditoría v2, 2026-07-11): el Perfil jala TODOS los campos con valor y los agrupa
 * por SIGNIFICADO, sin importar rol. Corrección (§ Perfil — Form VSL/Meta, 2026-07-16): dentro de
 * "calificacion" SÍ importa el formulario de origen — son campos DISTINTOS aunque la pregunta se
 * parezca (el lead form de Meta y el formulario de la VSL escriben cada uno los suyos; un contacto
 * puede tener llenos los de Meta, los del VSL, o ambos). `formulario` decide la subcategoría visible
 * dentro de "Calificación"; en el resto de los grupos (detalles/origen/interacciones) no aplica.
 */
export type PerfilGroup = "detalles" | "origen" | "calificacion" | "interacciones";
export type PerfilFormulario = "vsl" | "meta";

export interface PerfilField {
  label: string;
  value: string;
  group: PerfilGroup;
  /** Solo relevante cuando `group === "calificacion"` — decide el bloque "Form VSL"/"Form Meta". */
  formulario?: PerfilFormulario;
  /** Micro-label opcional de procedencia, ej. "vía agente IA" — no decide el grupo, solo informa. */
  procedencia?: string;
}

export interface ClosurerContact {
  name: string;
  /**
   * Id del contacto en GHL. Presente = viene de la cuenta real; ausente = es de la semilla
   * del demo. Decide si un Avanzar se persiste contra el servidor o se queda en memoria, y
   * permite que los dos tipos convivan en el mismo `Record` sin migrar la identidad de toda
   * la app: la clave es un string y a las vistas les da igual si es un nombre o un id.
   */
  ghlContactId?: string;
  /** Teléfono real de GHL. Ausente = no hay dato; el header NO inventa uno (§4.10). */
  telefono?: string;
  /** Sin calificación todavía → "—" en la UI, nunca una letra inventada (§4.7 / §4.10). */
  grade?: Grade;
  stage: StageKey;
  situacion: string;
  when: string;
  activity: string;
  starred?: boolean;
  monto?: number;
  /** Chip de fuente (§ fila de contacto): "META ADS" / "VSL OPT-IN" / "📷 IG PROFILE" / "DIRECTO". */
  fuente?: string;
  /** Sin definir = "activo" por defecto (regla A: el bot arranca ON). Ausente por completo cuando `fuente` es IG (sin bot). */
  botEstado?: BotEstado;
  seguimientoAutomaticoActivo?: boolean;
  videoPreCall?: VideoPreCallInfo;
  urgente?: UrgenteInfo;
  agenda?: AgendaInfo;
  respondido?: RespondidoInfo;
  seguimientoPendiente?: SeguimientoPendienteInfo;
  completedToday?: boolean;
  /** "Mantener" activo (§ ciclo de vida de tareas, 2026-07-11): la tarea de conversación queda fijada arriba de su sección en vez de completarse al responder. Se limpia al completar (con o sin mantener) y en cualquier Avanzar. */
  pinned?: boolean;
  /** Solo stage "nurture" — decide el sub-texto de la píldora "NURTURE · X". */
  nurtureOrigen?: NurtureOrigen;
  /**
   * Solo stage "ganado" — la subcategoría de la píldora `VENTA · CONTADO · $100`, y el valor
   * que va al custom field `forma_de_pago_venta` de GHL. Mismo rol que `nurtureOrigen` para
   * NURTURE: el sub-texto se guarda como dato, no solo dentro del string ya compuesto.
   */
  formaPagoVenta?: string;
  /**
   * § Gerencia (2026-07-13) — solo relevante en stage "ganado": ¿un setter intervino manualmente
   * en algún punto antes de esta cita? Espejo del `atribucionSetter` de SetterContact, pero vive
   * del lado del closer porque el traspaso setter→closer (§11) es el mismo contacto cambiando de
   * dueño — la única forma honesta de saber si ESTA venta fue 100% automática o tuvo rescate humano
   * es que el propio contacto lo recuerde, no cruzar nombres entre dos stores que no siempre se pisan.
   * Sin definir = automática (el flujo de Avanzar no tiene forma de setear esto en una venta nueva —
   * límite de demo documentado, igual que otros campos que no se recalculan solos en este frontend).
   */
  atribucionSetter?: boolean;
  historial: HistorialItem[];
  notas: NotaItem[];
  /** Tab Llamadas — cronológico, más recientes primero. Ausente/vacío → estado vacío ("Sin registro de llamadas"). */
  llamadas?: CallRecord[];
  /** Tab Perfil — campos reales agrupados por significado, no por rol/formulario. Ausente/vacío → estado vacío. */
  perfil?: PerfilField[];
  /**
   * Los 6 íconos, calculados por el backend (§8). PRESENTE = contacto real, y manda sobre
   * cualquier derivación local. AUSENTE = semilla, y se cae a las derivaciones históricas
   * sobre `llamadas`/`agenda`/`botEstado`, que siguen vivas para ella. Ver `indicadoresDe`.
   */
  indicadores?: IndicadoresContacto;
  /** Perdió `zona_closer` en GHL (§51.3): visible y movible, pero inerte hacia GHL. */
  congelado?: boolean;
  /**
   * La próxima cita, o la última vencida. Es un DATO de la fila — NO decide en qué columna
   * del Pipeline aparece el contacto; eso lo manda la etapa y solo la etapa.
   */
  cita?: NonNullable<PipelineContacto["cita"]>;
}

/**
 * LOS 6 INDICADORES de un contacto, resueltos. Único lugar del proyecto donde se decide qué
 * se pinta en la fila de íconos — ninguna vista deriva un ícono por su cuenta.
 *
 * El bloque del servidor gana; la semilla cae a las derivaciones de siempre. Las tres
 * funciones históricas (`countSalesCalls`, `countCallsContestadas`, `callsIASummary`) no se
 * borran: pasan de ser la derivación principal a ser el fallback, y siguen alimentando el
 * tab Perfil.
 */
export function indicadoresDe(c: ClosurerContact): IndicadoresContacto {
  const s = c.indicadores;
  return {
    reuniones: s?.reuniones ?? countSalesCalls(c.llamadas),
    citaFutura: s?.citaFutura ?? !!c.agenda,
    proximaCitaEl: s?.proximaCitaEl ?? null,
    proximaMeetUrl: s?.proximaMeetUrl ?? c.agenda?.meetUrl ?? null,
    ultimaCitaVencidaEl: s?.ultimaCitaVencidaEl ?? null,
    llamadasIaContestadas: s?.llamadasIaContestadas ?? countCallsContestadas(c.llamadas),
    llamadasIaIntentos: s?.llamadasIaIntentos ?? callsIASummary(c.llamadas).intentos,
    /**
     * El estado LOCAL gana sobre el del servidor, y es el único indicador donde pasa: hay
     * escrituras optimistas que el servidor no puede conocer todavía —`muerto_postcall` tras
     * un Avanzar, `pausa_temporal` al escribir un mensaje (que ni siquiera tiene tag en GHL)—.
     * `traerPipeline` limpia el local cuando llega el del servidor, para que no quede pegado.
     */
    bot: c.botEstado ?? s?.bot ?? null,
    seguimientoAuto: s?.seguimientoAuto ?? !!c.seguimientoAutomaticoActivo,
    ventaMonto: c.stage === "ganado" ? (c.monto ?? null) : null,
  };
}

/** Lo que produce el cuadrante Avanzar y que la store necesita para propagar el cambio. */
export interface AdvanceInput {
  stage: StageKey;
  pildora: string;
  texto: string;
  monto?: number;
  nota?: string;
  /** Seguimiento automático (§16.1 de CLAUDE.md): enciende/apaga el ícono ⏱. */
  seguimientoAutomaticoActivo?: boolean;
  /** Solo Venta: la subcategoría del stage `ganado` (Contado / Splitwise / BNPL / Cuotas). */
  formaPagoVenta?: string;
  /**
   * La subcategoría elegida en la pantalla de Avanzar: la forma de pago en una Venta, la
   * razón en un No-show o una descalificación, el motivo en un Nurture.
   *
   * Se manda tal como la escribe la UI —con separador tipográfico incluido,
   * `"Avisó · quiere reagendar"`— y el backend la traduce al valor exacto del dropdown de GHL
   * (`"Avisó quiere reagendar"`) contra el catálogo. La traducción vive en un solo lugar a
   * propósito: si no matchea carácter por carácter, GHL devuelve 200 y no escribe nada, que
   * es el fallo más caro de esta integración (§50.5).
   */
  subcategoriaGhl?: string;

  /* ── Solo para contactos reales: lo que el backend necesita para persistir ──
     La situación va como slug y la fecha como INTENCIÓN (el preset), nunca como una fecha
     calculada en el browser — el servidor la resuelve contra America/Lima. */
  situacion?: SituacionSeguimiento;
  modo?: ModoSeguimiento;
  preset?: string;
  fechaPersonalizada?: string;
  /** Generado una vez por apertura del modal, no por clic: hace inocuo el doble submit. */
  idempotencyKey?: string;
}

/**
 * Etapa resultante → salida de Avanzar que la produjo. Es el inverso del mapa que ya usa
 * cada pantalla del modal, y existe para que el store sepa QUÉ resultado mandarle al backend
 * sin que cada llamador tenga que acordarse de pasarlo.
 *
 * `agendado` no aparece a propósito: es la etapa de ENTRADA (la produce GHL al agendar, vía
 * el tag `zona_closer`), no la produce ninguna salida de Avanzar.
 */
export const RESULTADO_POR_STAGE: Partial<
  Record<StageKey, "venta" | "acordo" | "no_interesa" | "no_show" | "nurture">
> = {
  ganado: "venta",
  cierre: "acordo",
  descalificado: "no_interesa",
  no_show: "no_show",
  nurture: "nurture",
};

export const STAGE_META: Record<
  StageKey,
  { label: string; dot: string; headerBg: string; labelColor: string; pill: string }
> = {
  agendado: {
    label: "Agendado",
    dot: "bg-indigo-500",
    headerBg: "bg-indigo-50/50 dark:bg-indigo-900/10",
    labelColor: "text-foreground",
    pill: "bg-sky-50 text-sky-700 border-sky-200/60 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/30",
  },
  seguimiento: {
    label: "Seguimiento",
    dot: "bg-amber-500",
    headerBg: "bg-amber-50/30 dark:bg-amber-900/5",
    labelColor: "text-foreground",
    pill: "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30",
  },
  cierre: {
    label: "Cierre en curso",
    dot: "bg-amber-500",
    headerBg: "bg-amber-50/50 dark:bg-amber-900/10",
    labelColor: "text-amber-700 dark:text-amber-500",
    pill: "bg-indigo-50 text-indigo-700 border-indigo-200/60 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30",
  },
  ganado: {
    label: "Ganado",
    dot: "bg-emerald-500",
    headerBg: "bg-emerald-50/50 dark:bg-emerald-900/10",
    labelColor: "text-foreground",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30",
  },
  no_show: {
    label: "No-show",
    dot: "bg-orange-500",
    headerBg: "bg-orange-50/50 dark:bg-orange-900/10",
    labelColor: "text-foreground",
    pill: "bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30",
  },
  nurture: {
    label: "Nurture",
    dot: "bg-violet-500",
    headerBg: "bg-violet-50/50 dark:bg-violet-900/10",
    labelColor: "text-foreground",
    pill: "bg-violet-50 text-violet-700 border-violet-200/60 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/30",
  },
  descalificado: {
    label: "Descalificado",
    dot: "bg-rose-500",
    headerBg: "bg-muted/5",
    labelColor: "text-foreground",
    pill: "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30",
  },
};

export const STAGE_ORDER: StageKey[] = ["agendado", "seguimiento", "cierre", "ganado", "no_show", "nurture", "descalificado"];

/* Las semillas EJEMPLO se ELIMINARON el 2026-08-01 (pedido de Fabio): la app entra en
   pruebas con contactos reales de GHL y las semillas solo confundirian. `buildSeedContacts`
   queda devolviendo el Record vacio que los pollings llenan con los contactos reales.
   URGENTE_ROJO/NARANJA y seedHist se fueron con ellas (eran solo de la semilla). */

function buildSeedContacts(): Record<string, ClosurerContact> {
  return {};
}
/* `COCKPIT_BASE` ($34.000 / 8 ventas / 80 calls) se eliminó el 2026-07-31. Era el último
   literal de dinero del cockpit: sobrevivió a la derivación del 2026-07-30 porque nada en el
   store sabía cuántas llamadas hubo. Ahora las sales calls se cuentan del tab Llamada de cada
   contacto y el dinero real sale de las oportunidades de GHL (`/api/closer/cockpit`), así que
   no queda ningún número del cockpit sin un dato detrás. */


/**
 * El efecto de un Avanzar sobre UN contacto, como función pura.
 *
 * Vive fuera del provider para poder testearse sin montar React y sin los cuatro
 * contextos que envuelven la app. Es también la pieza que el backend va a reutilizar:
 * la transición de estado es la misma, cambia dónde se persiste.
 */
export function applyAdvance(c: ClosurerContact, input: AdvanceInput): ClosurerContact {
  const historial = [{ fecha: "Hoy", texto: input.texto, autor: "Usuario Activo" }, ...c.historial];
  const notas = input.nota
    ? [{ id: Date.now(), contexto: input.pildora, texto: input.nota, autor: "Usuario Activo", fecha: "Hoy" }, ...c.notas]
    : c.notas;
  /**
   * Regla de negocio (2026-07-11): una vez que el closer registra un resultado de Avanzar,
   * el contacto YA conversó con él — el agente IA muere para siempre (`muerto_postcall`, toggle
   * ni se renderiza). La ÚNICA excepción es "No-show": ese resultado reactiva la IA (`activo`)
   * porque dispara el workflow de recuperación automática, que necesita al agente trabajando.
   * IG nunca tuvo bot (§11) — no se le asigna estado nuevo, sigue exento.
   */
  const isIG = c.fuente === "📷 IG PROFILE";
  const nextBotEstado: BotEstado | undefined = isIG ? c.botEstado : input.stage === "no_show" ? "activo" : "muerto_postcall";
  return {
    ...c,
    stage: input.stage,
    situacion: input.pildora,
    when: "Hoy",
    activity: input.texto,
    monto: input.monto ?? c.monto,
    /* La forma de pago solo la escribe una Venta. Se preserva la anterior si este Avanzar
       no la trae, igual que `monto` — así un Seguimiento posterior no borra el dato de una
       venta ya registrada. */
    formaPagoVenta: input.formaPagoVenta ?? c.formaPagoVenta,
    historial,
    notas,
    urgente: undefined,
    agenda: undefined,
    /**
     * Un Avanzar cierra TODAS las tareas abiertas del contacto, no solo la urgencia.
     * Antes se limpiaban `urgente`/`agenda` pero no `respondido`/`seguimientoPendiente`
     * (el hueco que §40 dejó anotado como "no ocurre en el seed actual"). Consecuencia
     * real y alcanzable: tras registrar una Venta, `hasConversationTask` seguía siendo
     * true, así que enviar un mensaje y pulsar FIJAR devolvía el contacto a la cola de
     * Seguimientos luciendo la píldora `VENTA · $5.000`.
     */
    respondido: undefined,
    seguimientoPendiente: undefined,
    completedToday: true,
    pinned: undefined,
    /**
     * Regla de cancelación universal: CUALQUIER resultado de Avanzar cierra el seguimiento
     * pendiente. Antes esto era `?? c.seguimientoAutomaticoActivo`, y como solo la salida Seguimiento
     * escribe el campo, los otros cinco resultados conservaban el valor previo: registrar
     * una Venta sobre un contacto con serie activa dejaba el ⏱ encendido sobre un trato
     * ganado. Hoy es un ícono que miente; con el tag `seguimiento_recupero` escribiéndose
     * en GHL sería un workflow persiguiendo a alguien que ya pagó.
     */
    seguimientoAutomaticoActivo: input.seguimientoAutomaticoActivo ?? false,
    botEstado: nextBotEstado,
  };
}

/* Los "deltas de sesión" (ventasCount / ventasMonto) se eliminaron el 2026-07-30. Existían
   para sumarle al `COCKPIT_BASE` fijo las ventas registradas durante la sesión. Con el
   cockpit derivado de `contacts` sobran: una venta nueva cambia el stage del contacto y el
   total se recalcula solo, sin un acumulador paralelo que pueda desincronizarse. */

export interface Cockpit {
  cashCollected: number;
  ventas: number;
  /**
   * Sales calls registradas en el tab Llamada de los contactos del store.
   *
   * NO es "del mes" y por eso no se llama así: `CallRecord.fecha` es texto libre ("05 Jun",
   * "Hoy", "Hace 1 día"), no una fecha con la que se pueda filtrar un rango. Se cuenta lo que
   * hay, y la vista rotula la base — antes era el literal 80, que no salía de ningún lado.
   */
  salesCalls: number;
  comision: number;
  /**
   * Contactos que llegaron a tener su llamada con el closer (≥1 `sales_call`). Es la base de
   * la Tasa de Cierre: §6.A la define como "% de ventas sobre citas atendidas", y una llamada
   * registrada ES la prueba de que la cita se atendió.
   */
  atendieron: number;
  /** Contactos en etapa No-show — el denominador que le falta al Show rate. */
  noShow: number;
}

/* `CockpitFuente`/`CockpitRealState` (la lectura de Opportunity Value contra GHL) se
   eliminaron el 2026-07-31: el dinero del dashboard sale de `/api/closer/inicio` (queries
   sobre closer_avances) y el de los encabezados del Pipeline, de los propios contactos.
   El Opportunity Value solo se ESCRIBE al registrar la venta — nunca se lee de vuelta. */

interface ClosurerStoreValue {
  contacts: Record<string, ClosurerContact>;
  cockpit: Cockpit;
  /** Citas de hoy (reales, de la caché del backend) — el widget "Agenda de Hoy". */
  citasHoy: MiDiaResponse["citasHoy"];
  /** Completadas de hoy REALES (avances + buzón resuelto), derivadas por query en el backend. */
  completadasReales: MiDiaResponse["completadasHoy"];
  /** Citas de los próximos 15 días — una sola fuente para el tab Agenda y la franja del Pipeline. */
  agendaProximos: AgendaAppointment[];
  /** Activos vs. congelados, del backend. `null` hasta el primer refresco del Pipeline. */
  pipelineStats: PipelineStats | null;
  /** El botón "Sincronizar CRM": relee GHL entero y devuelve qué pasó. */
  sincronizarCrm: () => Promise<SincronizarCrmResponse>;
  /** `true` fuerza 1 llamada a GHL (el botón "Refrescar" de la Agenda, §8.5). */
  refrescarAgenda: (forzar?: boolean) => void;
  /** Refetch del territorio por evento (montaje/foco/Avanzar) — el Pipeline ya no tiene reloj. */
  refrescarPipeline: () => void;
  cierreEnCursoMonto: number;
  /** Suma de los montos de la etapa Ganado — el mismo dinero que el Cash Collected de Inicio. */
  ganadoMonto: number;
  openContactName: string | null;
  /** contactId de GHL de la ficha abierta (cuando se abrió desde una cita real) — para traer su conversación real. */
  openGhlContactId: string | null;
  openContact: (name: string, ghlContactId?: string) => void;
  closeContact: () => void;
  advance: (name: string, input: AdvanceInput) => void;
  addNota: (name: string, texto: string) => void;
  /** Borra una nota (X roja del tab Notas). Real → también de `closer_notas`; semilla → solo memoria. */
  removeNota: (name: string, id: number) => void;
  /** Elimina el lead de la plataforma y de Supabase — GHL no se toca (puede volver si agenda de nuevo). */
  deleteContact: (name: string) => void;
  /** "Marcar como Resuelto" en Intervenciones Urgentes: libera al contacto de la cola roja y reactiva la IA. */
  resolveIntervention: (name: string) => void;
  /** Cambios de estado del toggle 🤖 (manuales o automáticos) — siempre escribe su evento en Historial. */
  setBotEstado: (name: string, estado: BotEstado, evento: string, autor?: string) => void;
  /** FIJAR (§ toast/pin, 2026-07-11): sube la tarea de "Respondieron" al tope de su sección sin completarla. */
  pinTask: (name: string) => void;
  /** Completa la tarea de "Respondieron" — automático (barra de progreso) o manual (botón de ficha). */
  completeTask: (name: string) => void;
  /** Demo: el contacto "vuelve a escribir" tras estar completado — reabre la tarea en Respondieron. En producción lo dispara el webhook de un mensaje entrante real. */
  reviveTask: (name: string) => void;
}

/** § ciclo de vida de tareas en Mi Día (2026-07-11) — única fuente de verdad del conteo de tareas pendientes: nav badge, header de Mi Día e Inicio deben llamar a esta misma función, nunca duplicar la fórmula. */
export interface PendingTasksBreakdown {
  urgentes: number;
  respondieron: number;
  seguimientosHoy: number;
  total: number;
}

export function pendingTasksBreakdown(contacts: Record<string, ClosurerContact>): PendingTasksBreakdown {
  const all = Object.values(contacts);
  const urgentes = all.filter((c) => c.urgente && !c.completedToday).length;
  const respondieron = all.filter((c) => c.respondido && !c.completedToday).length;
  const seguimientosHoy = all.filter((c) => c.seguimientoPendiente && !c.completedToday).length;
  return { urgentes, respondieron, seguimientosHoy, total: urgentes + respondieron + seguimientosHoy };
}

const ClosurerCtx = createContext<ClosurerStoreValue | null>(null);

export function ClosurerProvider({ children }: { children: React.ReactNode }) {
  const [contacts, setContacts] = useState<Record<string, ClosurerContact>>(() => buildSeedContacts());
  /**
   * Espejo SÍNCRONO del Record, para leer un contacto ANTES de despachar un setState.
   *
   * La trampa que motivó esto (bug de notas perdidas, 2026-08-03): leer datos "dentro" del
   * updater de setContacts y usarlos afuera. React solo ejecuta el updater al instante si no
   * hay otra actualización pendiente en el provider — y acá los relojes de 10s despachan
   * actualizaciones todo el tiempo, así que a veces el updater corre DESPUÉS, la variable
   * capturada sigue vacía, y el POST que dependía de ella jamás sale. Intermitente y sin
   * error visible. Regla: los efectos de red se deciden leyendo este ref, nunca el updater.
   */
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  /** Firmas del último tick, para no escribir listas nuevas que dicen lo mismo (ver el reloj). */
  const firmaCitasRef = useRef("");
  const firmaCompletadasRef = useRef("");
  /** Un tick a la vez (§56). Ver el guard de en-vuelo en el reloj de abajo. */
  const tickEnVueloRef = useRef(false);
  const [openContactName, setOpenContactName] = useState<string | null>(null);
  const [openGhlContactId, setOpenGhlContactId] = useState<string | null>(null);
  /**
   * Activos vs. congelados, del servidor. La vista los MUESTRA en vez de recontar por su
   * cuenta: §51.1 pide que los conteos se deriven por query, nunca de contadores sueltos.
   */
  const [pipelineStats, setPipelineStats] = useState<PipelineStats | null>(null);
  const { comisiones } = useSettings();
  const { usuario } = useAuth();
  /**
   * El % del closer QUE ESTÁ MIRANDO, de Ajustes › Operación.
   *
   * Decía `comisiones["Jorge Q."] ?? 10`: el nombre de una persona escrito en el código, y un 10%
   * de respaldo. Con dos closers, el segundo veía la comisión del primero; con la semilla vacía,
   * todos verían un 10% que nadie fijó. Sin porcentaje cargado ahora es 0, y lo que hay que
   * cargarlo es Ajustes.
   */
  const comisionPct = (usuario ? (comisiones[usuario.nombre] ?? 0) : 0) / 100;

  /**
   * `ghlContactId` → cuándo se registró un Avanzar sobre él, en esta pestaña.
   *
   * Lo lee `polling-closer-pipeline` para no pisar con la etapa vieja de GHL un cambio que
   * acaba de hacer el humano y que GHL todavía está procesando. Es un `useRef` y no estado
   * porque cambiarlo no tiene que redibujar nada.
   */
  const recienTocados = useRef<Record<string, number>>({});

  /**
   * Hidratación desde el backend.
   *
   * Los contactos reales se suman a la semilla en vez de reemplazarla: la cuenta de GHL
   * tiene hoy tres contactos y ninguna cita, así que un reemplazo dejaría la app
   * prácticamente vacía y parecería rota. Conviven — los reales se distinguen porque
   * traen `ghlContactId`.
   *
   * Cualquier fallo devuelve `null`, así que un backend caído deja la demo intacta en vez
   * de romper la pantalla — esta app no tiene error boundary en ninguna vista, y una
   * pantalla en blanco sería peor que el demo de siempre.
   *
   * Deps vacías: el efecto ESCRIBE `contacts`; incluirlo sería un bucle infinito.
   */
  useEffect(() => {
    let vigente = true;

    traerMiDia().then((r) => {
      // StrictMode invoca el efecto dos veces en desarrollo. El GET es idempotente, así que
      // no hace daño, pero el guard evita pisar el estado con una respuesta obsoleta.
      if (!vigente || !r?.seguimientosHoy?.length) return;

      setContacts((prev) => {
        const siguiente = { ...prev };
        for (const fila of r.seguimientosHoy) {
          /**
           * FUSIÓN, no reemplazo. Antes era una asignación directa, así que un contacto que
           * también estaba en Seguimientos de Hoy perdía todo lo que le había puesto el
           * Pipeline —indicadores, cita, congelado— en la primera hidratación.
           */
          siguiente[fila.ghlContactId] = { ...siguiente[fila.ghlContactId], ...filaAContacto(fila) };
        }
        return siguiente;
      });
    });

    return () => {
      vigente = false;
    };
  }, []);

  /** Citas de hoy (widget Agenda de Hoy) y completadas reales — vienen de Mi Día. */
  const [citasHoy, setCitasHoy] = useState<MiDiaResponse["citasHoy"]>([]);
  const [completadasReales, setCompletadasReales] = useState<MiDiaResponse["completadasHoy"]>([]);

  /**
   * ── EL reloj del closer (§56) ──
   *
   * Un solo `POST /api/closer/tick` cada 10s hace las dos mitades que antes eran dos relojes
   * y dos requests: la ingesta desde GHL y las cinco colas de Mi Día. Baja de 12-13 a 6-7
   * requests por minuto.
   *
   * El backend las corre EN SECUENCIA, ingesta primero, así que esta respuesta ya incluye lo
   * que se acaba de ingerir. Los dos relojes viejos estaban en fase, no desfasados —
   * `registrarReloj` dispara al registrarse—, así que Mi Día leía siempre ANTES de las
   * escrituras del mismo ciclo y un entrante tardaba un tick entero en llegar al Buzón.
   *
   * Solo con la pestaña visible: el módulo de polling pausa todo con `visibilitychange`. El
   * candado del backend hace que N pestañas cuesten lo mismo que una.
   *
   * **Merge, no reemplazo** (regla de siempre): los contactos reales se funden con la
   * semilla EJEMPLO en el mismo Record. La etapa se deriva de los tags SOLO si el backend no
   * la manda; la urgencia y el "respondió" son MARCADORES, nunca etapas inventadas.
   */
  useEffect(
    () =>
      registrarReloj(
        "closer:tick",
        () => {
          /**
           * Guard de en-vuelo. `registrarReloj` es un `setInterval` crudo: si un tick tarda
           * más que la cadencia, el siguiente sale igual y se apilan. Antes daba lo mismo
           * (el POST rebotaba contra el candado en milisegundos), pero ahora cada request
           * apilado corre TAMBIÉN las siete queries de Mi Día — el candado solo protege una
           * de las dos mitades. Además evita que una respuesta lenta pise a una más nueva.
           */
          if (tickEnVueloRef.current) return;
          tickEnVueloRef.current = true;
          tickCloser()
            .finally(() => {
              tickEnVueloRef.current = false;
            })
            .then((res) => {
              if (!res?.ok) return;
              // Firma antes de escribir: estas dos son listas de presentación sin merge, así
              // que un string alcanza. Sin esto, dos arrays nuevos cada 10s bastan para
              // re-renderizar el árbol entero aunque no haya cambiado nada.
              const firmaCitas = JSON.stringify(res.citasHoy ?? []);
              if (firmaCitas !== firmaCitasRef.current) {
                firmaCitasRef.current = firmaCitas;
                setCitasHoy(res.citasHoy ?? []);
              }
              const firmaCompletadas = JSON.stringify(res.completadasHoy ?? []);
              if (firmaCompletadas !== firmaCompletadasRef.current) {
                firmaCompletadasRef.current = firmaCompletadas;
                setCompletadasReales(res.completadasHoy ?? []);
              }

              setContacts((prev) => {
                const siguiente = { ...prev };
                const conUrgenciaAhora = new Set<string>();
                const enBuzonAhora = new Set<string>();
                /**
                 * ── El guard que apaga el reloj de re-renders ──
                 *
                 * Antes este updater devolvía SIEMPRE un objeto nuevo, cambiara algo o no. Con
                 * el `value` del contexto recreándose en cada render, eso re-renderizaba
                 * `CloserAI` (2000+ líneas) y la ficha abierta cada 10 segundos, para nada.
                 *
                 * La comparación es POR CAMPO y no por referencia a propósito: los objetos
                 * `urgente`/`respondido` se construyen frescos en cada tick, así que comparar
                 * referencias diría "cambió" siempre y el guard no serviría de nada.
                 */
                let cambio = false;

                for (const u of res.urgentes ?? []) {
                  conUrgenciaAhora.add(u.ghlContactId);
                  const previo = siguiente[u.ghlContactId];
                  const etapa = (u.etapa as StageKey) ?? etapaDesdeTags(u.tags);

                  if (
                    previo &&
                    previo.urgente?.detail === u.fallo &&
                    previo.stage === etapa &&
                    previo.indicadores === u.indicadores
                  ) {
                    continue; // idéntico: se conserva la identidad de `previo` intacta
                  }

                  const urgente: UrgenteInfo = {
                    pill: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                    detail: u.fallo,
                    highlighted: true,
                  };
                  cambio = true;

                  siguiente[u.ghlContactId] = previo
                    ? { ...previo, urgente, stage: etapa, indicadores: u.indicadores ?? previo.indicadores }
                    : {
                        name: (u.nombre ?? "SIN NOMBRE").toUpperCase(),
                        // Sin calificación no se inventa una letra: la fila muestra "—" (§4.7).
                        grade: undefined,
                        stage: etapa,
                        situacion: armarPildora({ stage: etapa }),
                        when: "hoy",
                        activity: "",
                        fuente: u.fuente,
                        ghlContactId: u.ghlContactId,
                        indicadores: u.indicadores,
                        urgente,
                        historial: [],
                        notas: [],
                      };
                }

                for (const b of res.buzon ?? []) {
                  enBuzonAhora.add(b.ghlContactId);
                  const previo = siguiente[b.ghlContactId];
                  const microtext = b.snippet ? `escribió: "${b.snippet}"` : "escribió · sin responder";
                  const etapa = (b.etapa as StageKey) ?? etapaDesdeTags(b.tags);

                  if (
                    previo &&
                    previo.respondido?.microtext === microtext &&
                    previo.stage === etapa &&
                    previo.indicadores === b.indicadores
                  ) {
                    continue;
                  }
                  cambio = true;

                  siguiente[b.ghlContactId] = previo
                    ? { ...previo, respondido: { microtext }, stage: etapa, indicadores: b.indicadores ?? previo.indicadores }
                    : {
                        name: (b.nombre ?? "SIN NOMBRE").toUpperCase(),
                        grade: undefined,
                        stage: etapa,
                        situacion: armarPildora({ stage: etapa }),
                        when: "hoy",
                        activity: b.snippet ?? "",
                        fuente: b.fuente,
                        ghlContactId: b.ghlContactId,
                        indicadores: b.indicadores,
                        respondido: { microtext },
                        historial: [],
                        notas: [],
                      };
                }

                /**
                 * Lo que el backend ya no reporta se apaga acá también — solo sobre contactos
                 * reales (con ghlContactId): la semilla EJEMPLO conserva sus marcadores, que
                 * es exactamente lo que Fabio pidió de ella (vuelve sola al refrescar).
                 *
                 * Esto NO se puede reemplazar por una firma gruesa de la respuesta: es lo que
                 * corrige la deriva cuando el servidor deja de reportar a alguien.
                 */
                for (const [clave, c] of Object.entries(siguiente)) {
                  if (!c.ghlContactId) continue;
                  if (c.urgente && !conUrgenciaAhora.has(c.ghlContactId)) {
                    siguiente[clave] = { ...siguiente[clave], urgente: undefined };
                    cambio = true;
                  }
                  if (c.respondido && !enBuzonAhora.has(c.ghlContactId)) {
                    siguiente[clave] = { ...siguiente[clave], respondido: undefined };
                    cambio = true;
                  }
                }

                return cambio ? siguiente : prev;
              });
            })
            .catch(() => {
              /* Backend caído: se queda lo que ya había. Nunca una pantalla vacía. */
            });
        },
        CADENCIA.tick,
      ),
    [],
  );

  /**
   * ── El Pipeline: por EVENTO, sin intervalo (doc §10) ──
   *
   * Se trae el territorio completo al montar, al recuperar el foco de la pestaña, y después
   * de cada Avanzar propio. Ya no hay reloj de 30s: la etapa vive en Supabase (la escribe
   * Avanzar vía `proyectarAvance`) y el endpoint es una query a la caché — pedirlo entre
   * eventos solo redibujaría lo mismo.
   *
   * `recienTocados`/GRACIA_MS se conservan achicados: cubren la ventana entre el Avanzar
   * optimista y el refetch que él mismo dispara, para que la píldora rica (monto, forma de
   * pago) no sea pisada por la recompuesta del servidor.
   */
  const traerPipeline = useCallback(() => {
    fetchPipeline()
      .then((res) => {
        if (!res?.ok) return;
        setContacts((prev) => {
          const siguiente = { ...prev };
          const ahora = Date.now();

          for (const c of res.contactos) {
            const previo = siguiente[c.ghlContactId];
            const tocadoReciente = (recienTocados.current[c.ghlContactId] ?? 0) > ahora - GRACIA_MS;
            const etapa = (tocadoReciente && previo ? previo.stage : c.etapa) as StageKey;
            // Píldora RICA: el backend cachea la subcategoría y el monto que escribió Avanzar
            // (proyectarAvance), así que la venta real se lee "VENTA · CONTADO · $5.000" —
            // ya no la categoría pelada de antes.
            const subcategoria = c.subcategorias?.[etapa] ?? undefined;
            const monto = etapa === "ganado" ? (c.monto ?? undefined) : undefined;

            /**
             * `indicadores`, `congelado` y `cita` se asignan EXPLÍCITAMENTE en las dos ramas.
             * Dejarlos al `{...previo}` conservaría para siempre una cita ya cancelada o un
             * congelado que el servidor acaba de levantar — el spread preserva lo viejo cuando
             * el campo nuevo no se nombra.
             */
            siguiente[c.ghlContactId] = previo
              ? {
                  ...previo,
                  stage: etapa,
                  situacion: tocadoReciente ? previo.situacion : armarPildora({ stage: etapa, subcategoria, monto }),
                  monto: monto ?? previo.monto,
                  fuente: previo.fuente ?? c.fuente,
                  telefono: c.telefono ?? previo.telefono,
                  indicadores: c.indicadores,
                  congelado: c.congelado,
                  cita: c.cita ?? undefined,
                  /**
                   * El `botEstado` optimista se suelta en cuanto llega el del servidor, salvo
                   * en la ventana de gracia de un Avanzar recién hecho. Sin esto, un
                   * `pausa_temporal` puesto al escribir un mensaje se quedaría pegado para
                   * siempre y taparía el estado real de los tags.
                   */
                  botEstado: tocadoReciente ? previo.botEstado : undefined,
                }
              : {
                  // `nombre` puede venir null: GHL no siempre tiene uno. No se inventa (§4.10).
                  name: (c.nombre ?? "SIN NOMBRE").toUpperCase(),
                  grade: undefined,
                  stage: etapa,
                  situacion: armarPildora({ stage: etapa, subcategoria, monto }),
                  when: "",
                  activity: "",
                  fuente: c.fuente,
                  ghlContactId: c.ghlContactId,
                  telefono: c.telefono ?? undefined,
                  monto,
                  indicadores: c.indicadores,
                  congelado: c.congelado,
                  cita: c.cita ?? undefined,
                  historial: [],
                  notas: [],
                };
          }
          return siguiente;
        });
        setPipelineStats(res.stats ?? null);
      })
      .catch(() => {
        /* Backend caído: se queda lo que ya había. */
      });
  }, []);

  useEffect(() => {
    traerPipeline();
    const alVolver = () => {
      if (document.visibilityState === "visible") traerPipeline();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [traerPipeline]);

  /**
   * ── Agenda de próximos días: al montar + botón Refrescar, sin reloj ──
   *
   * Antes TRES vistas (widget de Mi Día, franja del Pipeline, tab Agenda) pedían el rango
   * cada 10s cada una. Ahora el store lo trae una vez (de la caché del backend) y las tres
   * consumen lo mismo; `refrescarAgenda(true)` es el botón manual (1 llamada a GHL, §8.5).
   */
  const [agendaProximos, setAgendaProximos] = useState<AgendaAppointment[]>([]);
  const refrescarAgenda = useCallback((forzar = false) => {
    fetchAgendaRange(15, forzar ? { refrescar: true } : undefined)
      .then((res) => {
        if (res) setAgendaProximos(res.appointments ?? []);
      })
      .catch(() => {
        /* sin backend, sin citas reales — la vista muestra su estado vacío */
      });
  }, []);

  useEffect(() => {
    refrescarAgenda();
  }, [refrescarAgenda]);

  const advance = useCallback((name: string, input: AdvanceInput) => {
    // Se lee del espejo síncrono (ver contactsRef): los efectos de red NUNCA dentro del updater.
    const c = contactsRef.current[name];
    if (c) {
      /**
       * Contacto real + resultado Seguimiento → se persiste. El POST va sin `await`: la UI
       * ya se actualizó y no hay nada que esperar. Es optimista a propósito — si falla, la
       * consola lo dice y la próxima carga muestra la verdad. Bloquear la interfaz por una
       * escritura que casi siempre funciona sería peor experiencia que la de hoy.
       */
      if (c.ghlContactId) {
        // Marca de gracia: durante los próximos GRACIA_MS, `polling-closer-pipeline` respeta
        // la etapa que acabamos de poner en vez de traer la que GHL todavía no actualizó.
        recienTocados.current[c.ghlContactId] = Date.now();
        const idem = input.idempotencyKey ?? `${c.ghlContactId}-${Date.now()}`;
        const avisar = (r: RespuestaAvanzar | null) => {
          if (!r?.ok) {
            console.warn("[avanzar] no se pudo persistir el resultado de", c.ghlContactId);
            return;
          }
          // El backend distingue "quedó registrado" de "llegó a GHL". Un tag que no se aplicó
          // significa que el workflow de GHL no se va a disparar, así que no se puede tratar
          // como éxito silencioso.
          if (r.ghl?.advertencia) console.warn("[avanzar]", r.ghl.advertencia);
          if (r.ghl?.nota) console.warn("[avanzar]", r.ghl.nota);
        };

        if (input.stage === "seguimiento" && input.situacion && input.modo) {
          registrarSeguimientoRemoto({
            ghlContactId: c.ghlContactId,
            situacion: input.situacion,
            modo: input.modo,
            preset: input.preset,
            fechaPersonalizada: input.fechaPersonalizada,
            nota: input.nota,
            idempotencyKey: idem,
          }).then(avisar);
        } else {
          /**
           * Las otras cinco salidas. Antes de esto el guard exigía `stage === "seguimiento"`,
           * así que registrar una Venta sobre un contacto real de GHL no escribía nada: ni el
           * tag, ni el custom field, ni el Opportunity Value. Solo cambiaba la píldora en
           * pantalla y se revertía al recargar.
           */
          const resultado = RESULTADO_POR_STAGE[input.stage];
          if (resultado) {
            registrarResultadoRemoto({
              ghlContactId: c.ghlContactId,
              resultado,
              subcategoria: input.subcategoriaGhl,
              monto: input.monto,
              nota: input.nota,
              idempotencyKey: idem,
            }).then(avisar);
          }
        }

        // El Pipeline se refresca por EVENTO (ya no hay reloj de 30s): tras el Avanzar, un
        // refetch confirma contra el backend lo que la UI ya mostró optimista. El delay le
        // da tiempo a `proyectarAvance` a escribir el stage antes de releer.
        setTimeout(traerPipeline, 1_500);
      }
    }

    setContacts((prev) => {
      const actual = prev[name];
      if (!actual) return prev;
      return { ...prev, [name]: applyAdvance(actual, input) };
    });
  }, [traerPipeline]);

  /**
   * Agrega una nota. Optimista en pantalla y PERSISTIDA si el contacto es real.
   *
   * Hasta el 2026-08-03 esto solo escribía en memoria: la nota aparecía y se perdía al
   * refrescar (bug reportado por Fabio sobre su contacto de prueba). El endpoint
   * `/api/closer/notas` ya existía — lo que faltaba era llamarlo.
   */
  const addNota = useCallback((name: string, texto: string) => {
    // Se lee del espejo síncrono (ver contactsRef). La primera versión leía el ghlContactId
    // DENTRO del updater de setContacts y lo chequeaba afuera — cuando React difería el
    // updater (cosa que hace seguido con los relojes de 10s activos), el id quedaba vacío y
    // el POST nunca salía: notas que "se guardaban" solo en pantalla, de forma intermitente.
    const ghlContactId = contactsRef.current[name]?.ghlContactId;

    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
      return {
        ...prev,
        [name]: {
          ...c,
          notas: [{ id: Date.now(), contexto: null, texto, autor: AUTOR_OPTIMISTA, fecha: "Hoy" }, ...c.notas],
        },
      };
    });

    if (!ghlContactId) return; // semilla/demo: se queda en memoria, como siempre

    crearNota({ ghlContactId, texto })
      .then((r) => {
        // Se reemplaza la nota optimista por la fila REAL de la base (id y fecha de verdad).
        setContacts((prev) => {
          const c = prev[name];
          if (!c || !r?.nota) return prev;
          const sinOptimista = c.notas.filter((n) => !(n.texto === texto && n.fecha === "Hoy"));
          return { ...prev, [name]: { ...c, notas: [notaRealAItem(r.nota), ...sinOptimista] } };
        });
      })
      .catch((e) => {
        // Falló el guardado: se marca la nota en pantalla en vez de dejarla como si estuviera
        // guardada. Una nota que el closer cree escrita y no existe es peor que un error visible.
        console.error("La nota no se guardó:", e);
        setContacts((prev) => {
          const c = prev[name];
          if (!c) return prev;
          return {
            ...prev,
            [name]: {
              ...c,
              notas: c.notas.map((n) =>
                n.texto === texto && n.fecha === "Hoy" ? { ...n, fecha: "⚠ no se guardó" } : n,
              ),
            },
          };
        });
      });
  }, []);

  /**
   * Borra UNA nota (la X roja del tab Notas, pedido de Fabio 2026-08-03).
   *
   * Optimista: sale de la pantalla al instante. Si es una nota real (tiene `realId`) también
   * se borra de `closer_notas`; si ese DELETE falla, se re-piden las notas del servidor para
   * que la pantalla vuelva a la verdad en vez de quedarse mintiendo que se borró.
   */
  const removeNota = useCallback((name: string, id: number) => {
    const c = contactsRef.current[name];
    if (!c) return;
    const nota = c.notas.find((n) => n.id === id);
    if (!nota) return;

    setContacts((prev) => {
      const actual = prev[name];
      if (!actual) return prev;
      return { ...prev, [name]: { ...actual, notas: actual.notas.filter((n) => n.id !== id) } };
    });

    if (!nota.realId || !c.ghlContactId) return; // optimista/semilla: solo memoria

    const ghlContactId = c.ghlContactId;
    eliminarNota(nota.realId).catch((e) => {
      console.error("La nota no se pudo borrar:", e);
      fetchNotas(ghlContactId)
        .then((r) =>
          setContacts((prev) => {
            const actual = prev[name];
            if (!actual) return prev;
            return { ...prev, [name]: { ...actual, notas: (r.notas ?? []).map(notaRealAItem) } };
          }),
        )
        .catch(() => {
          /* backend caído: no hay verdad que restaurar */
        });
    });
  }, []);

  /**
   * Elimina un lead de LA PLATAFORMA (pedido de Fabio, 2026-08-03): desaparece de todas las
   * vistas y su rastro se borra de Supabase. **GHL no se toca** — si el contacto sigue en
   * territorio (`zona_closer`) y agenda una cita nueva, el webhook/cron lo re-crea como alta
   * nueva (§51.3). La ficha se cierra primero para no quedar abierta sobre un fantasma.
   */
  const deleteContact = useCallback((name: string) => {
    const c = contactsRef.current[name];
    if (!c) return;

    setOpenContactName(null);
    setOpenGhlContactId(null);
    setContacts((prev) => {
      const { [name]: _fuera, ...resto } = prev;
      return resto;
    });

    if (!c.ghlContactId) return; // semilla/demo: con sacarlo del Record alcanza

    eliminarContacto(c.ghlContactId)
      .then(() => traerPipeline())
      .catch((e) => {
        // Si el borrado remoto falla, el próximo refresco del Pipeline lo va a traer de
        // vuelta — preferible a que parezca borrado sin estarlo.
        console.error("El contacto no se pudo eliminar del servidor:", e);
        traerPipeline();
      });
  }, [traerPipeline]);

  const resolveIntervention = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !c.urgente) return prev;
      const historial = [
        { fecha: "Hoy", texto: "Intervención resuelta por Usuario Activo", autor: "Usuario Activo" },
        ...c.historial,
      ];
      return {
        ...prev,
        [name]: {
          ...c,
          urgente: undefined,
          botEstado: "activo",
          historial,
          when: "Hoy",
          activity: "Intervención resuelta",
          completedToday: true,
          pinned: undefined,
        },
      };
    });
  }, []);

  const setBotEstado = useCallback((name: string, estado: BotEstado, evento: string, autor: string = "Usuario Activo") => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
      const historial = [{ fecha: "Hoy", texto: evento, autor }, ...c.historial];
      return { ...prev, [name]: { ...c, botEstado: estado, historial } };
    });
  }, []);

  /**
   * § correcciones toast/pin v2 (2026-07-11): "tarea de conversación" ahora cubre Respondieron
   * Y Seguimientos de hoy (antes solo Respondieron — un seguimiento que se atiende por chat
   * también se completa al responder, no solo vía Avanzar).
   */
  const hasConversationTask = (c: ClosurerContact) => !!(c.respondido || c.seguimientoPendiente);

  /**
   * FIJAR — sube la tarea al tope de su sección; NO la completa. Botón de ficha, o clic en la
   * barra de completado durante la ventana de 5s. Bug v2: como `completeTask` ahora se dispara
   * AL ENVIAR (no al terminar el timer en pantalla), fijar debe poder deshacer un completado que
   * ya ocurrió — por eso el guard ya no excluye `completedToday`, y fijar limpia esa bandera.
   */
  const pinTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !hasConversationTask(c)) return prev;
      return { ...prev, [name]: { ...c, pinned: true, completedToday: false } };
    });
  }, []);

  /** Completa la tarea — se dispara AL ENVIAR un mensaje (§ correcciones v2, bug 1: salir de la conversación ya no debe impedir el completado), o manual desde "Completar Tarea" en la ficha. */
  const completeTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !hasConversationTask(c)) return prev;
      const historial = [{ fecha: "Hoy", texto: "Respondió al contacto — tarea completada", autor: "Usuario Activo" }, ...c.historial];
      return { ...prev, [name]: { ...c, pinned: false, completedToday: true, when: "Hoy", activity: "Respondió al contacto", historial } };
    });
  }, []);

  const reviveTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !c.completedToday) return prev;
      const historial = [{ fecha: "Hoy", texto: "Contacto respondió — tarea reabierta", autor: "Sistema" }, ...c.historial];
      return {
        ...prev,
        [name]: { ...c, completedToday: false, pinned: false, respondido: { microtext: "escribió de nuevo · sin responder" }, historial },
      };
    });
  }, []);

  /**
   * Los dos totales de dinero del Pipeline, derivados de los MISMOS contactos que se pintan
   * en cada etapa. Nunca una base fija: si un contacto entra o sale de la etapa, el número se
   * corrige solo.
   *
   * Se suman TODOS los de la etapa, sin mirar los filtros de grade/destacados de la barra
   * (decisión de Fabio, 2026-07-30): el encabezado dice cuánta plata hay en esa etapa, no
   * cuánta estás mirando. Filtrar la vista no debería mover un total de dinero.
   */
  /* `cierreEnCursoMonto` se calcula más abajo, junto al resto del dinero: necesita el monto real
     de GHL, que llega por la lectura de `/api/closer/cockpit`. Antes salía solo de los montos del store,
     que en un contacto real de GHL viene indefinido — el mismo agujero que tenía Ganado. */

  const ganadoCount = useMemo(
    () => Object.values(contacts).filter((c) => c.stage === "ganado").length,
    [contacts]
  );

  /**
   * ── El dinero de los encabezados del Pipeline (2026-07-31, doc §1) ──
   *
   * Se lee de los mismos contactos que se pintan: las semillas traen su `monto` de la
   * seed, y los contactos REALES lo traen del propio `/api/closer/pipeline` — que ahora
   * devuelve `monto` (lo escribe `proyectarAvance` al registrar la Venta en Supabase).
   * La lectura de Opportunity Value contra GHL (`/api/closer/cockpit`) se ELIMINÓ:
   * "mandamos opportunity value a GHL al registrar venta; nunca lo leemos de vuelta".
   *
   * El dashboard de Inicio NO usa estos números: sus métricas del mes salen 100% de
   * `/api/closer/inicio` (queries sobre closer_avances). Estos totales son de los
   * encabezados de columna del Pipeline, que sí incluyen las semillas visibles ahí.
   */
  const ganadoMonto = useMemo(
    () =>
      Object.values(contacts)
        .filter((c) => c.stage === "ganado")
        .reduce((sum, c) => sum + (c.monto ?? 0), 0),
    [contacts]
  );

  const cierreEnCursoMonto = useMemo(
    () =>
      Object.values(contacts)
        .filter((c) => c.stage === "cierre")
        .reduce((sum, c) => sum + (c.monto ?? 0), 0),
    [contacts]
  );

  const cashCollected = ganadoMonto;

  /**
   * Bases reales de los porcentajes del cockpit, derivadas del tab Llamada de cada contacto —
   * la misma fuente que ya alimenta los íconos 📹/📞 (§27, §35). Nunca un campo suelto.
   *
   * `atendieron` = contactos con ≥1 `sales_call`: una llamada registrada es la prueba de que la
   * cita se atendió, y es el denominador que §6.A pide para la Tasa de Cierre. Antes ese
   * denominador era el literal `40`, escrito en la vista, sin relación con ningún dato.
   */
  const { salesCalls, atendieron, noShow } = useMemo(() => {
    const all = Object.values(contacts);
    return {
      salesCalls: all.reduce((s, c) => s + countSalesCalls(c.llamadas), 0),
      atendieron: all.filter((c) => countSalesCalls(c.llamadas) > 0).length,
      noShow: all.filter((c) => c.stage === "no_show").length,
    };
  }, [contacts]);

  /**
   * El cockpit de Inicio se DERIVA: de los contactos del store y del dinero real de GHL.
   *
   * Antes salía de `COCKPIT_BASE` ($34.000 / 8 ventas / 80 calls), literales sin relación con
   * ningún contacto: el Pipeline decía $29.800 sobre 5 ventas y Inicio $34.000 sobre 8, a un
   * clic de distancia y sin forma de explicar la diferencia. Decisión de Fabio (2026-07-30):
   * un solo número para la misma plata en toda la app.
   *
   * `ventas` sigue contando los contactos en Ganado (no las oportunidades `won`) para que el
   * número coincida con el badge de esa columna del Pipeline. Si GHL tuviera una oportunidad
   * ganada cuyo contacto perdió el tag, los dos números divergirían — y es preferible que
   * "Ventas" concuerde con lo que el closer tiene a la vista.
   */
  const cockpit: Cockpit = useMemo(
    () => ({
      cashCollected,
      ventas: ganadoCount,
      salesCalls,
      comision: Math.round(cashCollected * comisionPct),
      atendieron,
      noShow,
    }),
    [cashCollected, ganadoCount, salesCalls, atendieron, noShow, comisionPct]
  );

  /**
   * Notas, historial y llamadas REALES al abrir la ficha de un contacto de GHL.
   *
   * Sin esto, el tab Notas mostraba solo lo que se hubiera escrito en esta sesión (y el
   * Historial, nada): las filas de `closer_notas`/`closer_contacto_eventos` existían pero
   * nadie las leía. Se pide una vez por apertura — no hay reloj: una nota la escribe el
   * propio closer y ya la tiene en pantalla; los eventos los agrega Avanzar, que refresca.
   *
   * Las llamadas se sumaron el 2026-08-06 y siguen la misma regla: un agente de voz no marca
   * mientras el closer mira la ficha, así que un reloj sería gasto sin lector.
   */
  useEffect(() => {
    if (!openGhlContactId) return;
    const id = openGhlContactId;
    let vivo = true;

    const aplicar = (cambio: (c: ClosurerContact) => ClosurerContact) => {
      if (!vivo) return;
      setContacts((prev) => (prev[id] ? { ...prev, [id]: cambio(prev[id]) } : prev));
    };

    fetchNotas(id)
      .then((r) =>
        aplicar((c) => {
          const delServidor = (r.notas ?? []).map(notaRealAItem);
          const enServidor = new Set(delServidor.map((n) => n.texto));
          // MERGE, no reemplazo: si el usuario escribió una nota mientras este GET estaba en
          // vuelo, pisarle la lista se la "desaparecía" de la pantalla (el POST seguía su
          // curso, pero parecía perdida). Las optimistas de esta sesión que el servidor
          // todavía no devuelve se conservan arriba.
          const optimistas = c.notas.filter(
            (n) => (n.fecha === "Hoy" || n.fecha.startsWith("⚠")) && !enServidor.has(n.texto),
          );
          return { ...c, notas: [...optimistas, ...delServidor] };
        }),
      )
      .catch(() => {
        /* backend caído: se conserva lo que hubiera en memoria, no se inventa nada */
      });

    fetchHistorial(id)
      .then((r) => aplicar((c) => ({ ...c, historial: (r.eventos ?? []).map(eventoAItem) })))
      .catch(() => {
        /* idem */
      });

    /**
     * Las llamadas de los agentes de voz. Se asignan directo: el endpoint ya devuelve
     * `CallRecord` armado por `aCallRecord` — la misma derivación que usa el webhook al
     * escribir, no una segunda copia de las reglas en el cliente (regla 3).
     *
     * Reemplazo y no merge, al revés que las notas: acá no hay nada optimista que proteger,
     * porque nadie agrega llamadas desde la ficha.
     */
    fetchLlamadas(id)
      .then((r) => aplicar((c) => ({ ...c, llamadas: r.llamadas ?? [] })))
      .catch(() => {
        /* idem: sin datos se conserva lo que hubiera, no se pinta un vacío falso */
      });

    return () => {
      vivo = false;
    };
  }, [openGhlContactId]);

  /**
   * El botón "Sincronizar CRM" del Pipeline. Relee de GHL las citas de los próximos 15 días
   * Y cada contacto del territorio (tags, bot, contadores de llamadas), descongelando al que
   * recuperó `zona_closer` y congelando al que lo perdió.
   *
   * Al terminar refresca las dos vistas desde la CACHÉ — cero llamadas extra a GHL. Devuelve
   * la respuesta cruda para que la barra de filtros muestre qué pasó, incluido el caso en que
   * el candado de 60 s no dejó correr nada.
   */
  const sincronizarCrm = useCallback(async (): Promise<SincronizarCrmResponse> => {
    const r = await sincronizarCrmRemoto();
    traerPipeline();
    refrescarAgenda();
    return r;
  }, [traerPipeline, refrescarAgenda]);

  const openContact = useCallback((name: string, ghlContactId?: string) => {
    /**
     * La CLAVE del Record para un contacto real es su ghlContactId, no el nombre (el
     * nombre es display). Guardar el nombre acá hacía que `contacts[openContactName]`
     * fallara para todo contacto real y la ficha cayera al fallback demo — chat,
     * historial y notas inventados sobre una persona de verdad (bug de Fabio Malpartida,
     * 2026-08-01). Se guarda la clave que de verdad indexa.
     */
    setOpenContactName(ghlContactId ?? name);
    setOpenGhlContactId(ghlContactId ?? null);
  }, []);

  const closeContact = useCallback(() => {
    setOpenContactName(null);
    setOpenGhlContactId(null);
  }, []);

  /**
   * `useMemo` sobre el value, y `useCallback` sobre las dos acciones de arriba, por la misma
   * razón: sin esto el objeto se recrea en CADA render del provider y todo consumidor de
   * `useClosurer()` se re-renderiza, aunque el campo que le importa no haya cambiado.
   *
   * El orden en que se hizo importa y conviene dejarlo escrito: memoizar esto ANTES de poner
   * el guard del reloj (arriba) no habría servido de nada — el tick creaba una referencia
   * nueva de `contacts` cada 10 segundos, así que el memo se invalidaba igual. Primero se
   * dejó de escribir estado sin cambios; recién después el memo tiene algo que conservar.
   */
  const value = useMemo<ClosurerStoreValue>(
    () => ({
      contacts,
      cockpit,
      citasHoy,
      completadasReales,
      agendaProximos,
      pipelineStats,
      refrescarAgenda,
      refrescarPipeline: traerPipeline,
      sincronizarCrm,
      cierreEnCursoMonto,
      ganadoMonto,
      openContactName,
      openGhlContactId,
      openContact,
      closeContact,
      advance,
      addNota,
      removeNota,
      deleteContact,
      resolveIntervention,
      setBotEstado,
      pinTask,
      completeTask,
      reviveTask,
    }),
    [
      contacts,
      cockpit,
      citasHoy,
      completadasReales,
      agendaProximos,
      pipelineStats,
      refrescarAgenda,
      traerPipeline,
      sincronizarCrm,
      cierreEnCursoMonto,
      ganadoMonto,
      openContactName,
      openGhlContactId,
      openContact,
      closeContact,
      advance,
      addNota,
      removeNota,
      deleteContact,
      resolveIntervention,
      setBotEstado,
      pinTask,
      completeTask,
      reviveTask,
    ],
  );

  return <ClosurerCtx.Provider value={value}>{children}</ClosurerCtx.Provider>;
}

export function useClosurer() {
  const ctx = useContext(ClosurerCtx);
  if (!ctx) throw new Error("useClosurer debe usarse dentro de ClosurerProvider");
  return ctx;
}
