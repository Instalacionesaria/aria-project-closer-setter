import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useSettings } from "./settingsStore";
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
import { fetchPipeline, fetchUrgentes } from "./api";

/**
 * `polling-closer-intervenciones-urgentes` — cada cuánto se re-consulta la cola roja.
 *
 * Se mantiene el valor que tenía en la vista (10s) para no cambiar dos cosas a la vez. Vale
 * revisarlo: una intervención urgente se mide en minutos, y el analizador que aplica el tag
 * corre cuando entra un mensaje, no continuamente.
 */
const POLLING_URGENTES_MS = 10_000;

/**
 * `polling-closer-pipeline` — cada cuánto se re-barre el territorio completo (`zona_closer`).
 *
 * Más espaciado que los demás a propósito: es el único que puede pedir varias páginas a GHL,
 * y un contacto nuevo apareciendo dentro de los 30 segundos es más que suficiente.
 */
const POLLING_PIPELINE_MS = 30_000;

/**
 * Cuánto tiempo un contacto tocado a mano conserva su etapa local frente a lo que diga GHL.
 * Cubre la ventana entre que se registra un Avanzar y que GHL termina de aplicar el tag.
 */
const GRACIA_MS = 20_000;

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
}

/**
 * Tab "Llamadas" de la ficha (§ spec de Francisco, 2026-07-10). Tres orígenes:
 * "sales_call" (closer, meet de ventas — score/objeciones SOLO aquí, nunca en llamadas de IA),
 * "app_flow_voz" (closer, agente Appointment Flow), "lead_flow_voz" (setter, agente Lead Flow).
 */
export type CallOrigin = "sales_call" | "app_flow_voz" | "lead_flow_voz";
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

const seedHist = (): HistorialItem[] => [{ fecha: "27 Jun", texto: "Interacción inicial con IA", autor: "Sistema" }];

const URGENTE_ROJO: UrgenteInfo["pill"] =
  "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30";
const URGENTE_NARANJA: UrgenteInfo["pill"] =
  "bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30";

/* Semillas de demostración: UNA por etapa del pipeline (regla de Francisco, 2026-07-31).
   Viven solo en memoria — al refrescar la página vuelven a su etapa original a propósito.
   Los contactos reales de GHL llegan por polling keyeados por ghlContactId y no se mezclan. */
const SEED: Omit<ClosurerContact, "historial" | "notas">[] = [
  {
    name: "EJEMPLO JUAN PEREZ", grade: "C", stage: "agendado", situacion: "Agendado", when: "hace 1 día",
    activity: "Llamada agendada para hoy. El prospecto está muy interesado en automatizar su agencia.", starred: true,
    botEstado: "activo",
    videoPreCall: { visto: true, pct: 87, fecha: "05 Jul" },
    llamadas: [
      {
        id: "jp-1", origin: "sales_call", fecha: "05 Jun", duracion: "45:00", contestada: true,
        resultado: "Resultado: No interesado", scoreFinal: 88,
        objeciones: ["Muy caro", "Consultar con socio"],
        puntosFuertes: ["Buena introducción", "Escucha activa"],
        aMejorar: ["Faltó urgencia", "No se manejó bien el precio"],
        audioUrl: "https://example.com/audio/sales-call-jp.mp3",
      },
      {
        id: "jp-2", origin: "app_flow_voz", fecha: "04 Jun", duracion: "02:30", contestada: true,
        resultado: "Contestó · confirmó", sentimiento: "positivo",
        resumenIA: "El lead contestó rápidamente. Confirmó su asistencia a la reunión de hoy y mencionó que está buscando una solución para automatizar sus ventas.",
        audioUrl: "https://example.com/audio/app-flow-jp.mp3",
      },
      {
        id: "jp-3", origin: "lead_flow_voz", fecha: "02 Jun", duracion: "05:45", contestada: true,
        resultado: "Contestó · agendó", sentimiento: "positivo",
        resumenIA: "Primer contacto telefónico. El lead calificó con buen presupuesto disponible y agendó la llamada de ventas.",
        audioUrl: "https://example.com/audio/lead-flow-jp.mp3",
      },
    ],
    perfil: [
      { label: "Teléfono", value: "+54 911 2233 4455", group: "detalles" },
      { label: "Correo", value: "juan.perez@agenciaperez.com", group: "detalles" },
      { label: "Categoría", value: "Segmento A · Prioridad alta", group: "detalles" },
      { label: "Fuente", value: "Meta Ads", group: "origen" },
      { label: "Campaña", value: "Escala tu Agencia con IA — Julio", group: "origen" },
      { label: "Fecha de ingreso", value: "01 Jun", group: "origen" },
      { label: "Etapa del negocio", value: "Facturando, quiere escalar", group: "calificacion", formulario: "meta" },
      { label: "Objetivo de facturación", value: "$12,000 - $18,000 USD", group: "calificacion", formulario: "meta" },
      { label: "Mayor obstáculo", value: "No tiene un sistema de ventas predecible, depende de referidos.", group: "calificacion", formulario: "meta" },
      { label: "Inversión $4-8k", value: "$6,000 USD", group: "calificacion", formulario: "vsl" },
      { label: "Tiene equipo", value: "Sí, 2 personas en ventas", group: "calificacion", formulario: "vsl", procedencia: "vía agente IA" },
    ],
  },
  {
    name: "EJEMPLO RODRIGO SILVA", grade: "C", stage: "seguimiento", situacion: "Seguimiento · Dudando", when: "hoy",
    activity: "vencido hace 1 día", fuente: "META ADS", botEstado: "muerto_postcall", seguimientoAutomaticoActivo: true,
    seguimientoPendiente: { microtext: "vencido hace 1 día", vencido: true },
    videoPreCall: { visto: false, diasSinAbrir: 2 },
    llamadas: [
      { id: "rs-3", origin: "sales_call", fecha: "Hace 1 día", duracion: "29:45", contestada: true, resultado: "Resultado: Quiere pensarlo" },
      { id: "rs-1", origin: "lead_flow_voz", fecha: "Hace 2 días", duracion: "00:00", contestada: false, resultado: "No contestó" },
      { id: "rs-2", origin: "lead_flow_voz", fecha: "Ayer", duracion: "00:00", contestada: false, resultado: "No contestó" },
    ],
  },

  {
    // Buzón general (Mi Día): escribió y no tiene bot activo (muerto_postcall) → `respondido`.
    name: "EJEMPLO ELENA ALVAREZ", grade: "B", stage: "cierre", situacion: "Acordó comprar, falta pago · $500", when: "hoy", activity: "respondió hace 45 min", monto: 500,
    botEstado: "muerto_postcall",
    respondido: { microtext: "respondió hace 45 min" },
    llamadas: [{ id: "ea-1", origin: "sales_call", fecha: "24 Jun", duracion: "42:15", contestada: true, resultado: "Resultado: Acordó comprar" }],
  },

  // No-show: única excepción a "muerto_postcall" — la IA se reactiva para correr el workflow de recuperación automática.
  {
    name: "EJEMPLO ALFREDO", grade: "A", stage: "no_show", situacion: "No-show", when: "hace 20 días", activity: "La conversación se ha estancado. El usuario no responde.",
    botEstado: "activo",
  },

  // Nurture: maduración post-call — sub-origen decide el texto de la píldora "NURTURE · X".
  // Además demuestra "Completadas Hoy" (Mi Día): tarea del día ya cerrada, fila atenuada + tachado.
  {
    name: "EJEMPLO PATRICIA VEGA", grade: "C", stage: "nurture", nurtureOrigen: "pidio_tiempo",
    situacion: "NURTURE · PIDIÓ TIEMPO", when: "hoy",
    activity: "pidió tiempo tras la llamada · re-contacto programado en 30-60 días",
    completedToday: true,
    botEstado: "muerto_postcall",
    llamadas: [{ id: "pv-1", origin: "sales_call", fecha: "18 Jun", duracion: "34:10", contestada: true, resultado: "Resultado: Quiere pensarlo — pidió tiempo" }],
  },

  {
    // Intervención urgente (Mi Día): la IA no detectó una solicitud de pago → pausado_fallo + marcador `urgente`.
    name: "EJEMPLO MIGUEL SANCHEZ", grade: "C", stage: "descalificado", situacion: "No interesado · Precio", when: "hoy",
    activity: "El usuario solicitó el enlace de pago pero la IA no lo detectó ni lo envió. Requiere intervención inmediata para no perder la venta.",
    fuente: "META ADS", botEstado: "pausado_fallo",
    urgente: {
      pill: URGENTE_ROJO,
      detail: "El usuario solicitó el enlace de pago pero la IA no lo detectó ni lo envió. Requiere intervención inmediata para no perder la venta.",
      detailClass: "text-rose-700 dark:text-rose-400 font-medium",
      daysBadge: "Abierta hace 40 min",
      highlighted: true,
      phone: true,
    },
    llamadas: [{ id: "ms-1", origin: "sales_call", fecha: "05 Jul", duracion: "28:40", contestada: true, resultado: "Resultado: No interesado" }],
  },

  {
    /* Píldora `ganado` con los tres campos (VENTA · FORMA DE PAGO · MONTO) — ver `armarPildora`. */
    name: "EJEMPLO VALENTINA GOMEZ", grade: "A", stage: "ganado", situacion: "VENTA · BUY NOW PAY LATER · $5.400", when: "hoy", activity: "venta low-ticket cerrada exitosamente",
    monto: 5400, formaPagoVenta: "Buy Now Pay Later",
    fuente: "META ADS", botEstado: "muerto_postcall", atribucionSetter: true,
    llamadas: [{ id: "vg-1", origin: "sales_call", fecha: "Hoy", duracion: "33:15", contestada: true, resultado: "Resultado: Venta LT cerrada" }],
    perfil: [
      { label: "Teléfono", value: "+54 911 9988 7766", group: "detalles" },
      { label: "Correo", value: "valentina.gomez@agenciagomez.com", group: "detalles" },
      { label: "Categoría", value: "Segmento B · Convertida a Low-Ticket", group: "detalles" },
      { label: "Fuente", value: "Meta Ads", group: "origen" },
      { label: "Campaña", value: "Low-Ticket — Antesala High Ticket", group: "origen" },
      { label: "Etapa del negocio", value: "Recién arrancando, sin facturación estable", group: "calificacion", formulario: "meta" },
      { label: "Objetivo de facturación", value: "$0 - $2,000 USD", group: "calificacion", formulario: "meta" },
      { label: "Mayor obstáculo", value: "No tiene claridad de oferta ni proceso de ventas.", group: "calificacion", formulario: "meta" },
      { label: "Inversión $4-8k", value: "$300 USD", group: "calificacion", formulario: "vsl" },
    ],
  },

];

function buildSeedContacts(): Record<string, ClosurerContact> {
  const map: Record<string, ClosurerContact> = {};
  for (const c of SEED) map[c.name] = { ...c, fuente: c.fuente ?? "DIRECTO", historial: seedHist(), notas: [] };
  return map;
}

interface CockpitBase {
  cashCollected: number;
  ventas: number;
  callsMes: number;
}

const COCKPIT_BASE: CockpitBase = {
  cashCollected: 34000,
  ventas: 8,
  callsMes: 80,
};

/** Closer activo del demo (sin auth real) — su % vive en Ajustes > Administración > Comisiones. */
const CURRENT_CLOSER_NAME = "Diego M.";

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
  callsMes: number;
  comision: number;
}

interface ClosurerStoreValue {
  contacts: Record<string, ClosurerContact>;
  cockpit: Cockpit;
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
  const [openContactName, setOpenContactName] = useState<string | null>(null);
  const [openGhlContactId, setOpenGhlContactId] = useState<string | null>(null);
  const { comisiones } = useSettings();
  const comisionPct = (comisiones[CURRENT_CLOSER_NAME] ?? 10) / 100;

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
        for (const fila of r.seguimientosHoy) siguiente[fila.ghlContactId] = filaAContacto(fila);
        return siguiente;
      });
    });

    return () => {
      vigente = false;
    };
  }, []);

  /**
   * ── polling-closer-intervenciones-urgentes ──
   *
   * Trae los contactos con el bot caído (`bot_pausado_fallo` + `zona_closer`) y los mete en
   * el store como contactos de verdad.
   *
   * **Por qué vive acá y no en Mi Día.** Antes era un `useState` local dentro de `MiDiaTab`,
   * así que una urgencia existía únicamente mientras esa pestaña estuviera abierta: no
   * aparecía en el Pipeline, la ficha se abría sin historial ni notas, y el contacto se
   * evaporaba al cambiar de vista. Acá es un contacto más, con las mismas reglas que el
   * resto (§4.4: ninguna vista tiene estado propio).
   *
   * **La etapa se deriva, no se inventa.** La versión anterior escribía
   * `stage: "descalificado"` — no porque el contacto lo estuviera, sino porque ese stage
   * pinta la píldora de rojo. Al mover esto al store, ese invento habría metido a cada
   * urgencia en la columna Descalificado del Pipeline. La urgencia es un MARCADOR (`urgente`),
   * no una etapa: el contacto sigue donde su historia lo dejó, y eso lo dicen sus tags.
   *
   * **Merge, no reemplazo.** Si el contacto ya está en el store (por la cola de seguimientos
   * o por un Avanzar registrado en esta sesión), se le agrega la urgencia y se respeta lo que
   * ya sabíamos de él. Solo se crea desde cero cuando no existía.
   */
  useEffect(() => {
    let vigente = true;

    const traerUrgentes = () => {
      fetchUrgentes()
        .then((res) => {
          if (!vigente) return;
          setContacts((prev) => {
            const siguiente = { ...prev };
            const conUrgenciaAhora = new Set<string>();

            for (const u of res.urgentes) {
              conUrgenciaAhora.add(u.contactId);
              const previo = siguiente[u.contactId];
              const urgente: UrgenteInfo = {
                pill: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
                detail: u.fallo,
                highlighted: true,
              };
              const etapa = etapaDesdeTags(u.tags);

              siguiente[u.contactId] = previo
                ? { ...previo, urgente, botEstado: "pausado_fallo", stage: etapa }
                : {
                    name: u.name.toUpperCase(),
                    // Sin calificación no se inventa una letra: la fila muestra "—" (§4.7).
                    grade: undefined,
                    stage: etapa,
                    situacion: armarPildora({ stage: etapa }),
                    when: "hoy",
                    activity: "",
                    fuente: u.source,
                    botEstado: "pausado_fallo",
                    ghlContactId: u.contactId,
                    urgente,
                    historial: [],
                    notas: [],
                  };
            }

            /**
             * Si una urgencia se resolvió en GHL (le quitaron el tag), tiene que apagarse acá
             * también. Sin esto la cola roja solo crecería: se limpia únicamente lo que este
             * mismo polling puso, nunca la semilla ni una urgencia resuelta desde la ficha.
             */
            for (const [clave, c] of Object.entries(siguiente)) {
              if (c.urgente && c.ghlContactId && !conUrgenciaAhora.has(c.ghlContactId)) {
                siguiente[clave] = { ...c, urgente: undefined };
              }
            }

            return siguiente;
          });
        })
        .catch(() => {
          /* Backend caído: se queda lo que ya había. Nunca una pantalla vacía. */
        });
    };

    traerUrgentes();
    const iv = setInterval(traerUrgentes, POLLING_URGENTES_MS);
    return () => {
      vigente = false;
      clearInterval(iv);
    };
  }, []);

  /**
   * ── polling-closer-pipeline ──
   *
   * El territorio completo: TODOS los contactos con `zona_closer`, cada uno en la etapa que
   * dicen sus tags. Es lo que hace que un contacto recién etiquetado en GHL aparezca en el
   * Pipeline sin que nadie lo cargue a mano.
   *
   * **La etapa la manda GHL, no el front.** El stage lo mueve un workflow disparado por el
   * tag, así que la verdad está en los tags y este polling la trae de vuelta. Registrar un
   * Avanzar cambia el stage local al instante (optimista) y aplica el tag en GHL; el
   * siguiente ciclo confirma. Si la escritura hubiera fallado, este mismo ciclo lo corrige —
   * la pantalla nunca se queda mostrando algo que GHL no tiene.
   *
   * **Por qué existe `recienTocados`.** Ese ida y vuelta tiene una ventana: entre que se
   * registra el Avanzar y que GHL termina de procesar el tag pueden pasar unos segundos, y
   * un ciclo que cayera justo ahí devolvería la etapa VIEJA y revertiría la píldora en
   * pantalla. Se vería como "registré la venta y se deshizo sola". Por eso un contacto tocado
   * a mano hace menos de `GRACIA_MS` conserva su etapa local: se le da tiempo a GHL a ponerse
   * al día antes de dejar que el servidor mande.
   */
  useEffect(() => {
    let vigente = true;

    const traerPipeline = () => {
      fetchPipeline()
        .then((res) => {
          if (!vigente || !res?.ok) return;
          setContacts((prev) => {
            const siguiente = { ...prev };
            const ahora = Date.now();

            for (const c of res.contactos) {
              const previo = siguiente[c.ghlContactId];
              const tocadoReciente = (recienTocados.current[c.ghlContactId] ?? 0) > ahora - GRACIA_MS;
              const etapa = (tocadoReciente && previo ? previo.stage : c.etapa) as StageKey;

              siguiente[c.ghlContactId] = previo
                ? {
                    ...previo,
                    stage: etapa,
                    // La píldora se recompone solo si la etapa la manda el servidor: si el
                    // contacto está en gracia, se respeta la que armó el Avanzar (que además
                    // trae monto y forma de pago, datos que el Pipeline no conoce).
                    situacion: tocadoReciente ? previo.situacion : armarPildora({ stage: etapa }),
                    fuente: previo.fuente ?? c.fuente,
                  }
                : {
                    // `nombre` puede venir null: GHL no siempre tiene uno. No se inventa (§4.10).
                    name: (c.nombre ?? "SIN NOMBRE").toUpperCase(),
                    grade: undefined,
                    stage: etapa,
                    situacion: armarPildora({ stage: etapa }),
                    when: "",
                    activity: "",
                    fuente: c.fuente,
                    ghlContactId: c.ghlContactId,
                    historial: [],
                    notas: [],
                  };
            }
            return siguiente;
          });
        })
        .catch(() => {
          /* Backend caído: se queda lo que ya había. */
        });
    };

    traerPipeline();
    const iv = setInterval(traerPipeline, POLLING_PIPELINE_MS);
    return () => {
      vigente = false;
      clearInterval(iv);
    };
  }, []);

  const advance = useCallback((name: string, input: AdvanceInput) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;

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
      }

      return { ...prev, [name]: applyAdvance(c, input) };
    });
  }, []);

  const addNota = useCallback((name: string, texto: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
      return { ...prev, [name]: { ...c, notas: [{ id: Date.now(), contexto: null, texto, autor: "Usuario Activo", fecha: "Hoy" }, ...c.notas] } };
    });
  }, []);

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
  const cierreEnCursoMonto = useMemo(
    () => Object.values(contacts).filter((c) => c.stage === "cierre").reduce((sum, c) => sum + (c.monto ?? 0), 0),
    [contacts]
  );

  const ganadoMonto = useMemo(
    () => Object.values(contacts).filter((c) => c.stage === "ganado").reduce((sum, c) => sum + (c.monto ?? 0), 0),
    [contacts]
  );

  const ganadoCount = useMemo(
    () => Object.values(contacts).filter((c) => c.stage === "ganado").length,
    [contacts]
  );

  /**
   * El cockpit de Inicio ahora se DERIVA de los contactos, igual que los totales del Pipeline.
   *
   * Antes salía de `COCKPIT_BASE` ($34.000 / 8 ventas), un literal sin relación con ningún
   * contacto: el Pipeline decía $29.800 sobre 5 ventas y Inicio $34.000 sobre 8, a un clic de
   * distancia y sin forma de explicar la diferencia. Decisión de Fabio (2026-07-30): un solo
   * número para la misma plata en toda la app.
   *
   * `callsMes` sigue siendo una referencia de `COCKPIT_BASE` — es lo único que no se puede
   * derivar de los contactos, porque el store no sabe cuántas llamadas hubo en el mes.
   */
  const cockpit: Cockpit = useMemo(
    () => ({
      cashCollected: ganadoMonto,
      ventas: ganadoCount,
      callsMes: COCKPIT_BASE.callsMes,
      comision: Math.round(ganadoMonto * comisionPct),
    }),
    [ganadoMonto, ganadoCount, comisionPct]
  );

  const value: ClosurerStoreValue = {
    contacts,
    cockpit,
    cierreEnCursoMonto,
    ganadoMonto,
    openContactName,
    openGhlContactId,
    openContact: (name: string, ghlContactId?: string) => {
      setOpenContactName(name);
      setOpenGhlContactId(ghlContactId ?? null);
    },
    closeContact: () => {
      setOpenContactName(null);
      setOpenGhlContactId(null);
    },
    advance,
    addNota,
    resolveIntervention,
    setBotEstado,
    pinTask,
    completeTask,
    reviveTask,
  };

  return <ClosurerCtx.Provider value={value}>{children}</ClosurerCtx.Provider>;
}

export function useClosurer() {
  const ctx = useContext(ClosurerCtx);
  if (!ctx) throw new Error("useClosurer debe usarse dentro de ClosurerProvider");
  return ctx;
}
