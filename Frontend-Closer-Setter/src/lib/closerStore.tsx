import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useSettings } from "./settingsStore";

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
  grade: Grade;
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
  cadenciaActiva?: boolean;
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
   * § Gerencia (2026-07-13) — solo relevante en stage "ganado": ¿un setter intervino manualmente
   * en algún punto antes de esta cita? Espejo del `atribucionSetter` de SetterContact, pero vive
   * del lado del closer porque el traspaso setter→closer (§11) es el mismo contacto cambiando de
   * dueño — la única forma honesta de saber si ESTA venta fue 100% automática o tuvo rescate humano
   * es que el propio contacto lo recuerde, no cruzar nombres entre dos stores que no siempre se pisan.
   * Sin definir = automática (el flujo de Avanzar no tiene forma de setear esto en una venta nueva —
   * límite de demo documentado, igual que otros campos que no se recalculan solos en este frontend).
   */
  atribucionSetter?: boolean;
  /** contactId de GHL cuando el contacto es REAL (ej. urgente detectado por la IA) — para abrir su chat real. */
  ghlContactId?: string;
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
  /** Seguimiento automático (§16.1 de CLAUDE.md): enciende/apaga el ícono ⏱. Sin definir, se conserva el estado previo. */
  cadenciaActiva?: boolean;
}

export const STAGE_META: Record<
  StageKey,
  { label: string; dot: string; headerBg: string; labelColor: string; pill: string; hiddenOffset: number }
> = {
  agendado: {
    label: "Agendado",
    dot: "bg-indigo-500",
    headerBg: "bg-indigo-50/50 dark:bg-indigo-900/10",
    labelColor: "text-foreground",
    pill: "bg-sky-50 text-sky-700 border-sky-200/60 dark:bg-sky-500/20 dark:text-sky-300 dark:border-sky-500/30",
    hiddenOffset: 14 - 4,
  },
  seguimiento: {
    label: "Seguimiento",
    dot: "bg-amber-500",
    headerBg: "bg-amber-50/30 dark:bg-amber-900/5",
    labelColor: "text-foreground",
    pill: "bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30",
    hiddenOffset: 24 - 4,
  },
  cierre: {
    label: "Cierre en curso",
    dot: "bg-amber-500",
    headerBg: "bg-amber-50/50 dark:bg-amber-900/10",
    labelColor: "text-amber-700 dark:text-amber-500",
    pill: "bg-indigo-50 text-indigo-700 border-indigo-200/60 dark:bg-indigo-500/20 dark:text-indigo-300 dark:border-indigo-500/30",
    hiddenOffset: 4 - 4,
  },
  ganado: {
    label: "Ganado",
    dot: "bg-emerald-500",
    headerBg: "bg-emerald-50/50 dark:bg-emerald-900/10",
    labelColor: "text-foreground",
    pill: "bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30",
    hiddenOffset: 4 - 4,
  },
  no_show: {
    label: "No-show",
    dot: "bg-orange-500",
    headerBg: "bg-orange-50/50 dark:bg-orange-900/10",
    labelColor: "text-foreground",
    pill: "bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30",
    hiddenOffset: 26 - 4,
  },
  nurture: {
    label: "Nurture",
    dot: "bg-violet-500",
    headerBg: "bg-violet-50/50 dark:bg-violet-900/10",
    labelColor: "text-foreground",
    pill: "bg-violet-50 text-violet-700 border-violet-200/60 dark:bg-violet-500/20 dark:text-violet-300 dark:border-violet-500/30",
    hiddenOffset: 0,
  },
  descalificado: {
    label: "Descalificado",
    dot: "bg-rose-500",
    headerBg: "bg-muted/5",
    labelColor: "text-foreground",
    pill: "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30",
    hiddenOffset: 8 - 4,
  },
};

export const STAGE_ORDER: StageKey[] = ["agendado", "seguimiento", "cierre", "ganado", "no_show", "nurture", "descalificado"];

const seedHist = (): HistorialItem[] => [{ fecha: "27 Jun", texto: "Interacción inicial con IA", autor: "Sistema" }];

const URGENTE_ROJO: UrgenteInfo["pill"] =
  "bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30";
const URGENTE_NARANJA: UrgenteInfo["pill"] =
  "bg-orange-50 text-orange-700 border-orange-200/60 dark:bg-orange-500/20 dark:text-orange-300 dark:border-orange-500/30";

const SEED: Omit<ClosurerContact, "historial" | "notas">[] = [
  { name: "PABLO MUÑOZ", grade: "D", stage: "agendado", situacion: "Agendado", when: "hace 3 días", activity: "agendó", botEstado: "activo" },
  { name: "LUIS FERNANDEZ", grade: "A", stage: "agendado", situacion: "Agendado", when: "hace 2 días", activity: "agendó", botEstado: "activo" },
  {
    name: "JUAN PEREZ", grade: "C", stage: "agendado", situacion: "Agendado", when: "hace 1 día",
    activity: "Llamada agendada para hoy. El prospecto está muy interesado en automatizar su agencia.", starred: true,
    botEstado: "activo",
    agenda: { time: "10:00", badge: "EN 15 MIN", expanded: true, videoPre: "✓ Vio el video pre-call (87%)",
      briefing: "Llamada agendada para hoy. El prospecto está muy interesado en automatizar su agencia.",
      meetUrl: "https://meet.google.com/juan-perez-1100" },
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
  { name: "MARTA PEREZ", grade: "B", stage: "agendado", situacion: "Agendado", when: "hace 1 día", activity: "agendó", botEstado: "activo", agenda: { time: "11:00", meetUrl: "https://meet.google.com/marta-perez-1300" } },
  { name: "LUIS GOMEZ", grade: "D", stage: "agendado", situacion: "Agendado", when: "hoy", activity: "agendó", botEstado: "activo", agenda: { time: "12:00", meetUrl: "https://meet.google.com/luis-gomez-1500" } },
  { name: "SOFIA SANCHEZ", grade: "B", stage: "agendado", situacion: "Agendado", when: "hoy", activity: "agendó", botEstado: "activo", agenda: { time: "13:00", meetUrl: "https://meet.google.com/sofia-sanchez-1700" } },
  { name: "CARMEN GOMEZ", grade: "A", stage: "agendado", situacion: "Agendado", when: "hoy", activity: "agendó", botEstado: "activo", agenda: { time: "14:00", meetUrl: "https://meet.google.com/carmen-gomez-1900" } },

  {
    name: "CARLOS RUIZ", grade: "A", stage: "seguimiento", situacion: "Seguimiento · Dudando", when: "hace 17 días", activity: "El prospecto tiene dudas sobre el ROI.",
    botEstado: "muerto_postcall",
    llamadas: [{ id: "cr-1", origin: "sales_call", fecha: "22 Jun", duracion: "38:20", contestada: true, resultado: "Resultado: Quiere pensarlo — dudas sobre el ROI" }],
  },
  {
    name: "ELENA MARTIN", grade: "D", stage: "seguimiento", situacion: "Seguimiento · Muy interesado", when: "hace 15 días", activity: "respondió · esperando respuesta",
    botEstado: "muerto_postcall",
    llamadas: [{ id: "em-1", origin: "sales_call", fecha: "24 Jun", duracion: "41:10", contestada: true, resultado: "Resultado: Muy interesada, a seguir" }],
  },
  {
    name: "FERNANDO LOPEZ", grade: "C", stage: "seguimiento", situacion: "Seguimiento · Muy interesado", when: "hace 14 días", activity: "respondió · esperando respuesta",
    botEstado: "muerto_postcall",
    llamadas: [{ id: "fl-1", origin: "sales_call", fecha: "25 Jun", duracion: "33:50", contestada: true, resultado: "Resultado: Muy interesado, a seguir" }],
  },
  {
    name: "DIEGO RODRIGUEZ", grade: "B", stage: "seguimiento", situacion: "Seguimiento · Próximo a pagar", when: "hace 14 días", activity: "respondió · esperando respuesta", starred: true,
    botEstado: "muerto_postcall",
    llamadas: [{ id: "dr-1", origin: "sales_call", fecha: "25 Jun", duracion: "36:05", contestada: true, resultado: "Resultado: Muy interesado, a seguir" }],
  },

  {
    name: "ELENA ALVAREZ", grade: "B", stage: "cierre", situacion: "Acordó comprar, falta pago · $500", when: "hace 15 días", activity: "link enviado · sin pago", monto: 500,
    botEstado: "muerto_postcall",
    llamadas: [{ id: "ea-1", origin: "sales_call", fecha: "24 Jun", duracion: "42:15", contestada: true, resultado: "Resultado: Acordó comprar" }],
  },
  {
    name: "LUCIA ROMERO", grade: "B", stage: "cierre", situacion: "Acordó comprar, falta pago · $500", when: "hace 8 días", activity: "link enviado · sin pago", monto: 500,
    botEstado: "muerto_postcall",
    llamadas: [{ id: "lr-1", origin: "sales_call", fecha: "01 Jul", duracion: "39:40", contestada: true, resultado: "Resultado: Acordó comprar" }],
  },
  {
    name: "RAUL FERNANDEZ", grade: "A", stage: "cierre", situacion: "Acordó comprar, falta pago · $500", when: "hace 7 días", activity: "link enviado · sin pago", monto: 500,
    botEstado: "muerto_postcall",
    llamadas: [{ id: "rf-1", origin: "sales_call", fecha: "02 Jul", duracion: "45:30", contestada: true, resultado: "Resultado: Acordó comprar" }],
  },
  {
    name: "MARTA MARTIN", grade: "B", stage: "cierre", situacion: "Acordó comprar, falta pago · $500", when: "hace 5 días", activity: "link enviado · sin pago", monto: 500,
    botEstado: "muerto_postcall",
    llamadas: [{ id: "mm-1", origin: "sales_call", fecha: "04 Jul", duracion: "37:00", contestada: true, resultado: "Resultado: Acordó comprar" }],
  },

  {
    name: "JORGE ALVAREZ", grade: "A", stage: "ganado", situacion: "Venta · Contado", when: "hace 8 días", activity: "",
    botEstado: "muerto_postcall", atribucionSetter: false,
    llamadas: [{ id: "ja-1", origin: "sales_call", fecha: "01 Jul", duracion: "40:00", contestada: true, resultado: "Resultado: Venta cerrada" }],
  },
  {
    name: "DIEGO GOMEZ", grade: "C", stage: "ganado", situacion: "Venta · Contado", when: "hace 10 días", activity: "",
    botEstado: "muerto_postcall", atribucionSetter: false,
    llamadas: [{ id: "dg-1", origin: "sales_call", fecha: "29 Jun", duracion: "35:20", contestada: true, resultado: "Resultado: Venta cerrada" }],
  },
  {
    name: "MIGUEL PEREZ", grade: "C", stage: "ganado", situacion: "Venta · Contado", when: "hace 12 días", activity: "",
    botEstado: "muerto_postcall", atribucionSetter: false,
    llamadas: [{ id: "mp-1", origin: "sales_call", fecha: "27 Jun", duracion: "44:10", contestada: true, resultado: "Resultado: Venta cerrada" }],
  },
  {
    name: "SHIRLEY FAJARDO", grade: "A", stage: "ganado", situacion: "Venta · Contado", when: "hace 18 días", activity: "Todo bajo control. Venta cerrada.",
    botEstado: "muerto_postcall", atribucionSetter: true,
    llamadas: [{ id: "sf-1", origin: "sales_call", fecha: "21 Jun", duracion: "50:05", contestada: true, resultado: "Resultado: Venta cerrada" }],
  },

  // No-show: única excepción a "muerto_postcall" — la IA se reactiva para correr el workflow de recuperación automática.
  {
    name: "ALFREDO", grade: "A", stage: "no_show", situacion: "No-show", when: "hace 20 días", activity: "La conversación se ha estancado. El usuario no responde.",
    botEstado: "activo",
  },
  {
    name: "LUCIA FERNANDEZ", grade: "C", stage: "no_show", situacion: "No-show · Plantón", when: "hace 8 días", activity: "venía muy seguro · plantó",
    botEstado: "activo",
  },
  {
    name: "CARMEN MARTIN", grade: "A", stage: "no_show", situacion: "No-show · Plantón", when: "hace 8 días", activity: "venía muy seguro · plantó",
    botEstado: "activo",
  },
  {
    name: "CARLOS PEREZ", grade: "C", stage: "no_show", situacion: "No-show · Plantón", when: "hace 8 días", activity: "venía muy seguro · plantó",
    botEstado: "activo",
  },
  // El workflow de recuperación de no-show (arriba) puede fallar — ahí sí queda pausado_fallo + urgente, no "activo".
  {
    name: "EJEMPLO PEDRO GOMEZ", grade: "C", stage: "no_show", situacion: "No-show · Plantón", when: "hoy", activity: "venía muy seguro · plantó",
    fuente: "VSL OPT-IN", botEstado: "pausado_fallo",
    urgente: { pill: URGENTE_NARANJA, detail: "venía muy seguro · plantó", detailClass: "text-muted-foreground" },
  },
  {
    name: "ANA MARTINEZ", grade: "C", stage: "no_show", situacion: "No-show · Plantón", when: "hoy", activity: "venía muy seguro · plantó",
    fuente: "META ADS", botEstado: "derivado_lt",
  },

  // Nurture: maduración post-call — sub-origen decide el texto de la píldora "NURTURE · X".
  {
    name: "SEBASTIAN LARA", grade: "B", stage: "nurture", nurtureOrigen: "no_show",
    situacion: "NURTURE · NO-SHOW", when: "hace 25 días",
    activity: "serie de recuperación de no-show agotada sin respuesta", fuente: "VSL OPT-IN",
    botEstado: "apagado_manual",
  },
  {
    name: "PATRICIA VEGA", grade: "C", stage: "nurture", nurtureOrigen: "pidio_tiempo",
    situacion: "NURTURE · PIDIÓ TIEMPO", when: "hace 20 días",
    activity: "pidió tiempo tras la llamada · re-contacto programado en 30-60 días",
    botEstado: "muerto_postcall",
    llamadas: [{ id: "pv-1", origin: "sales_call", fecha: "18 Jun", duracion: "34:10", contestada: true, resultado: "Resultado: Quiere pensarlo — pidió tiempo" }],
  },
  {
    name: "OSCAR JIMENEZ", grade: "D", stage: "nurture", nurtureOrigen: "se_enfrio",
    situacion: "NURTURE · SE ENFRIÓ", when: "hace 30 días",
    activity: "sin respuesta tras varios seguimientos · pasa a solo contenido",
    botEstado: "muerto_postcall",
    llamadas: [{ id: "oj-1", origin: "sales_call", fecha: "08 Jun", duracion: "27:55", contestada: true, resultado: "Resultado: Muy interesado, a seguir" }],
  },

  {
    name: "MIGUEL SANCHEZ", grade: "C", stage: "descalificado", situacion: "No interesado · Precio", when: "hace 2 días", activity: "",
    fuente: "META ADS", botEstado: "muerto_postcall",
    llamadas: [{ id: "ms-1", origin: "sales_call", fecha: "05 Jul", duracion: "28:40", contestada: true, resultado: "Resultado: No interesado" }],
  },
  {
    name: "LAURA RODRIGUEZ", grade: "D", stage: "descalificado", situacion: "No interesado · Precio", when: "hace 5 días", activity: "",
    botEstado: "muerto_postcall",
    llamadas: [{ id: "lrz-1", origin: "sales_call", fecha: "02 Jul", duracion: "22:15", contestada: true, resultado: "Resultado: No interesado" }],
  },
  {
    name: "LAURA MUÑOZ", grade: "D", stage: "descalificado", situacion: "No interesado · Precio", when: "hace 5 días", activity: "",
    botEstado: "muerto_postcall",
    llamadas: [{ id: "lm-1", origin: "sales_call", fecha: "02 Jul", duracion: "19:50", contestada: true, resultado: "Resultado: No interesado" }],
  },
  {
    name: "PABLO MORENO", grade: "D", stage: "descalificado", situacion: "No interesado · Precio", when: "hace 5 días", activity: "",
    botEstado: "muerto_postcall",
    llamadas: [{ id: "pm-1", origin: "sales_call", fecha: "02 Jul", duracion: "25:30", contestada: true, resultado: "Resultado: No interesado" }],
  },
  {
    name: "EJEMPLO ARIEL MENDEZ", grade: "B", stage: "descalificado", situacion: "No interesado · Precio", when: "hoy",
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
    perfil: [
      { label: "Teléfono", value: "+54 911 5566 7788", group: "detalles" },
      { label: "Correo", value: "ariel.mendez@agenciamendez.com", group: "detalles" },
      { label: "Fuente", value: "Meta Ads", group: "origen" },
      { label: "Etapa del negocio", value: "Facturando activamente", group: "calificacion", formulario: "meta" },
      { label: "Objetivo de facturación", value: "$8,000 - $10,000 USD", group: "calificacion", formulario: "meta" },
      { label: "Mayor obstáculo", value: "Quiere delegar ventas para enfocarse en operaciones.", group: "calificacion", formulario: "meta" },
      { label: "Inversión $4-8k", value: "$4,500 USD", group: "calificacion", formulario: "vsl" },
    ],
  },
  {
    name: "VALENTINA GOMEZ", grade: "A", stage: "ganado", situacion: "Venta · Contado", when: "hoy", activity: "venta low-ticket cerrada exitosamente",
    fuente: "META ADS", botEstado: "muerto_postcall", atribucionSetter: true,
    agenda: { time: "9:00", briefing: "venta low-ticket cerrada exitosamente", meetUrl: "https://meet.google.com/valentina-gomez-0900" },
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

  // Respondieron (buzón general) — Mi Día
  {
    name: "EJEMPLO SANTIAGO TORRES", grade: "B", stage: "seguimiento", situacion: "Seguimiento · Muy interesado", when: "hoy",
    activity: "respondió hace 2h", fuente: "META ADS", botEstado: "muerto_postcall",
    respondido: { microtext: "respondió hace 2h" },
    llamadas: [
      { id: "st-2", origin: "sales_call", fecha: "Hoy", duracion: "31:20", contestada: true, resultado: "Resultado: Muy interesado, a seguir" },
      { id: "st-1", origin: "app_flow_voz", fecha: "Hoy", duracion: "01:45", contestada: true, resultado: "Contestó · confirmó", sentimiento: "positivo", resumenIA: "Confirmó que sigue interesado y que puede hablar hoy más tarde.", audioUrl: "https://example.com/audio/app-flow-st-1.mp3" },
    ],
  },
  {
    // IG no tiene bot (§11) — sin botEstado, el toggle del compositor no se renderiza para este contacto.
    name: "EJEMPLO CAMILA VEGA", grade: "A", stage: "cierre", situacion: "Acordó comprar, falta pago · $500", when: "hoy",
    activity: "respondió hace 45 min", fuente: "📷 IG PROFILE", monto: 500,
    respondido: { microtext: "respondió hace 45 min" },
  },

  // Seguimientos de hoy — Mi Día (distinto del stage "Seguimiento" del Pipeline: son los que vencen/tocan hoy)
  {
    name: "EJEMPLO RODRIGO SILVA", grade: "C", stage: "seguimiento", situacion: "Seguimiento · Dudando", when: "hoy",
    activity: "vencido hace 1 día", fuente: "META ADS", botEstado: "muerto_postcall", cadenciaActiva: true,
    seguimientoPendiente: { microtext: "vencido hace 1 día", vencido: true },
    videoPreCall: { visto: false, diasSinAbrir: 2 },
    llamadas: [
      { id: "rs-3", origin: "sales_call", fecha: "Hace 1 día", duracion: "29:45", contestada: true, resultado: "Resultado: Quiere pensarlo" },
      { id: "rs-1", origin: "lead_flow_voz", fecha: "Hace 2 días", duracion: "00:00", contestada: false, resultado: "No contestó" },
      { id: "rs-2", origin: "lead_flow_voz", fecha: "Ayer", duracion: "00:00", contestada: false, resultado: "No contestó" },
    ],
  },
  {
    // IG no tiene bot (§11) — sin botEstado.
    name: "EJEMPLO VALERIA CASTRO", grade: "B", stage: "seguimiento", situacion: "Seguimiento · Muy interesado", when: "hoy",
    activity: "seguimiento programado para hoy", fuente: "📷 IG PROFILE", cadenciaActiva: true,
    seguimientoPendiente: { microtext: "seguimiento programado para hoy" },
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

interface SessionDeltas {
  ventasCount: number;
  ventasMonto: number;
}

const ZERO_DELTAS: SessionDeltas = { ventasCount: 0, ventasMonto: 0 };

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
  const [deltas, setDeltas] = useState<SessionDeltas>(ZERO_DELTAS);
  const [openContactName, setOpenContactName] = useState<string | null>(null);
  const [openGhlContactId, setOpenGhlContactId] = useState<string | null>(null);
  const { comisiones } = useSettings();
  const comisionPct = (comisiones[CURRENT_CLOSER_NAME] ?? 10) / 100;

  const advance = useCallback((name: string, input: AdvanceInput) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
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
        ...prev,
        [name]: {
          ...c,
          stage: input.stage,
          situacion: input.pildora,
          when: "Hoy",
          activity: input.texto,
          monto: input.monto ?? c.monto,
          historial,
          notas,
          urgente: undefined,
          agenda: undefined,
          completedToday: true,
          pinned: undefined,
          cadenciaActiva: input.cadenciaActiva ?? c.cadenciaActiva,
          botEstado: nextBotEstado,
        },
      };
    });
    if (input.stage === "ganado" && input.monto) {
      setDeltas((d) => ({ ventasCount: d.ventasCount + 1, ventasMonto: d.ventasMonto + input.monto! }));
    }
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

  const cierreEnCursoMonto = useMemo(
    () => Object.values(contacts).filter((c) => c.stage === "cierre").reduce((sum, c) => sum + (c.monto ?? 0), 0),
    [contacts]
  );

  const cockpit: Cockpit = useMemo(
    () => ({
      cashCollected: COCKPIT_BASE.cashCollected + deltas.ventasMonto,
      ventas: COCKPIT_BASE.ventas + deltas.ventasCount,
      callsMes: COCKPIT_BASE.callsMes,
      comision: Math.round((COCKPIT_BASE.cashCollected + deltas.ventasMonto) * comisionPct),
    }),
    [deltas, comisionPct]
  );

  const value: ClosurerStoreValue = {
    contacts,
    cockpit,
    cierreEnCursoMonto,
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
