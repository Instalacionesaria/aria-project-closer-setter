import { createContext, useCallback, useContext, useState, useMemo } from "react";
import { type Grade, type BotEstado, type HistorialItem, type NotaItem, type CallRecord, type PerfilField } from "./closerStore";
import { useSettings } from "./settingsStore";

/**
 * Single source of truth para el módulo Setter (§4.4 de CLAUDE.md), espejo de closerStore.tsx.
 * Construida el 2026-07-10 porque Avanzar en Setter no movía contactos entre colas (§15.5/§17
 * lo dejaban pendiente) — Mi Día, Pipeline e Inicio deberían leer de aquí, nunca guardar su propio estado.
 */

export type SetterStageKey =
  | "nuevo"
  | "en_calificacion"
  | "calificado_sin_agendar"
  | "low_ticket_ofrecido"
  | "agendado"
  | "nurture"
  | "descalificado";

/** Color de la píldora de situación — reemplaza los strings TAG_* sueltos por un tono con nombre. */
export type SetterTagTone = "source" | "cyan" | "violet" | "amber" | "emerald" | "rose";

export type Canal = "whatsapp" | "instagram";

const TAG_SOURCE =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-foreground bg-muted/50 text-[10px] uppercase font-semibold";
const TAG_CYAN =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-cyan-50 text-cyan-700 border-cyan-200/60 dark:bg-cyan-500/20 dark:text-cyan-300 dark:border-cyan-500/30";
const TAG_VIOLET =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 bg-violet-500/10 text-violet-700 border-violet-500/20 text-[10px] uppercase font-semibold";
const TAG_AMBER =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-amber-50 text-amber-700 border-amber-200/60 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/30";
const TAG_EMERALD =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-emerald-50 text-emerald-700 border-emerald-200/60 dark:bg-emerald-500/20 dark:text-emerald-300 dark:border-emerald-500/30";
const TAG_ROSE =
  "inline-flex items-center rounded-full border px-2.5 py-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 text-[10px] uppercase font-semibold bg-rose-50 text-rose-700 border-rose-200/60 dark:bg-rose-500/20 dark:text-rose-300 dark:border-rose-500/30";

/** Espejo obligatorio entre la píldora de la fila (SetterView) y el header de la ficha (ContactDrawer) — un solo mapa de color. */
export const TAG_CLS_BY_TONE: Record<SetterTagTone, string> = {
  source: TAG_SOURCE,
  cyan: TAG_CYAN,
  violet: TAG_VIOLET,
  amber: TAG_AMBER,
  emerald: TAG_EMERALD,
  rose: TAG_ROSE,
};

export interface SetterContact {
  name: string;
  phone: string;
  /** Sin definir = "-" (sin calificación aún), regla 7 de §4 — nunca se inventa. */
  grade?: Grade;
  /** Chip de fuente: "Meta Ads" / "VSL opt-in" / "📷 IG Profile" / "Directo". */
  fuente: string;
  /** IG no tiene bot (§11) — deriva `hasBot` en la ficha. */
  canal: Canal;
  stage: SetterStageKey;
  situacion: string;
  situacionTone: SetterTagTone;
  subtitle: string;
  overdue?: string;
  botPrefix?: boolean;
  /** Sin definir = "activo" por defecto si el canal tiene bot (regla A del toggle). */
  botEstado?: BotEstado;
  seguimientoAutomaticoActivo?: boolean;
  monto?: number;
  agendaFecha?: string;
  /** Presencia = la sala del Meet ya existe (§ auditoría íconos, 2026-07-10) — enciende 📹. `agendaFecha` sin esto = cita (📅) sin sala todavía. */
  agendaMeetUrl?: string;
  /** "Pausado por fallo" (banner rojo + gating) — presencia = Intervenciones Urgentes en Mi Día. */
  /**
   * contactId de GHL cuando el contacto es REAL (ej. un urgente detectado por el analizador),
   * no de la semilla demo. Habilita traer su conversación real en el tab Chat.
   */
  ghlContactId?: string;
  urgente?: { detail: string };
  /** Presencia = Conversaciones Estancadas en Mi Día (§13: sin avance >6h). */
  estancada?: { microtext: string };
  /** Presencia = Oportunidades Low-Ticket en Mi Día. */
  oportunidadLt?: { microtext: string };
  /** Presencia = Buzón General / Respondieron en Mi Día. */
  respondido?: { microtext: string };
  /** Presencia = Seguimientos en Mi Día (distinto del stage macro, igual que en Closer §18). */
  seguimientoPendiente?: { microtext: string; vencido?: boolean };
  completedToday?: boolean;
  /** "Mantener" activo (§ ciclo de vida de tareas, 2026-07-11) — igual que en Closer: fija la tarea arriba de su sección en vez de completarla al responder. */
  pinned?: boolean;
  /**
   * § correcciones dashboards (2026-07-11) — "latch" de atribución: se enciende con la PRIMERA
   * intervención manual del setter (responder, resolver, fijar/completar, tocar el bot, Avanzar)
   * y ya no se apaga. Determina si una agenda/venta futura de este contacto cuenta como trabajo
   * del setter (diferida) o del sistema (hands-off), sin importar quién cierre al final.
   */
  atribucionSetter?: boolean;
  historial: HistorialItem[];
  notas: NotaItem[];
  /** Tab Llamadas — cronológico, más recientes primero. Ausente/vacío → estado vacío ("Sin registro de llamadas"). */
  llamadas?: CallRecord[];
  /** Tab Perfil — campos reales agrupados por significado, no por rol/formulario. Ausente/vacío → estado vacío. */
  perfil?: PerfilField[];
}

export interface SetterAdvanceInput {
  stage: SetterStageKey;
  pildora: string;
  situacionTone: SetterTagTone;
  texto: string;
  monto?: number;
  nota?: string;
  seguimientoAutomaticoActivo?: boolean;
  agendaFecha?: string;
}

const seedHist = (): HistorialItem[] => [
  { fecha: "8 jul, 10:05", texto: "Respondió al mensaje de calificación", autor: "Sistema" },
  { fecha: "27 Jun", texto: "Entró por Meta Ads", autor: "Sistema" },
];

const SEED: Omit<SetterContact, "historial" | "notas">[] = [
  // Intervenciones urgentes
  {
    name: "EJEMPLO CARLA MENDOZA", phone: "34 600 111 222", grade: "B", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "EN CALIFICACIÓN", situacionTone: "cyan",
    subtitle: "Fallo en webhook de Zapier al validar email", botPrefix: true,
    botEstado: "pausado_fallo", urgente: { detail: "Fallo en webhook de Zapier al validar email. Requiere revisión manual." },
    perfil: [
      { label: "Fuente", value: "Meta Ads", group: "origen" },
      { label: "Etapa del negocio", value: "Facturando, sin sistema de ventas", group: "calificacion", formulario: "meta", procedencia: "vía Meta Ads" },
      { label: "Objetivo de facturación", value: "$5,000 - $8,000 USD", group: "calificacion", formulario: "meta", procedencia: "vía Meta Ads" },
    ],
  },
  // Conversaciones estancadas
  {
    name: "EJEMPLO JORGE RUIZ", phone: "57 300 999 8888", fuente: "VSL opt-in", canal: "whatsapp",
    stage: "en_calificacion", situacion: "EN CALIFICACIÓN", situacionTone: "cyan",
    subtitle: "se apagó hace 11h · preguntó precio · se apagó hace 6h",
    botEstado: "apagado_manual",
    estancada: { microtext: "se apagó hace 11h · preguntó precio · se apagó hace 6h" },
    // apagado_manual = un humano ya lo apagó a mano (a diferencia de pausado_fallo/derivado_lt, que son estados que dispara el SISTEMA) — el latch de atribución ya está encendido.
    atribucionSetter: true,
  },
  // Oportunidades low-ticket
  {
    name: "EJEMPLO PEDRO SANCHEZ", phone: "54 911 1234 5678", grade: "C", fuente: "Meta Ads", canal: "whatsapp",
    stage: "low_ticket_ofrecido", situacion: "DERIVADO A LT", situacionTone: "violet",
    subtitle: "sin capital para el programa · interesado en arrancar · hace 7h", botPrefix: true,
    botEstado: "derivado_lt",
    oportunidadLt: { microtext: "sin capital para el programa · interesado en arrancar · hace 7h" },
    perfil: [
      { label: "Fuente", value: "Meta Ads", group: "origen" },
      { label: "Etapa del negocio", value: "Recién arrancando", group: "calificacion", formulario: "meta" },
      { label: "Inversión $4-8k", value: "Sin capital disponible actualmente", group: "calificacion", formulario: "vsl", procedencia: "vía agente IA" },
      { label: "Mayor obstáculo", value: "Interesado en arrancar pero sin capital para el programa high-ticket.", group: "calificacion", formulario: "vsl", procedencia: "vía agente IA" },
    ],
  },
  // Buzón general
  {
    name: "EJEMPLO DIEGO SALAZAR", phone: "54 911 2222 3333", fuente: "Meta Ads", canal: "whatsapp",
    stage: "nurture", situacion: "NURTURE", situacionTone: "violet",
    subtitle: "mensaje sin responder hace 20 min", botPrefix: true,
    botEstado: "apagado_manual",
    respondido: { microtext: "mensaje sin responder hace 20 min" },
  },
  {
    name: "EJEMPLO SOFIA NUÑEZ", phone: "54 911 4444 5555", grade: "B", fuente: "VSL opt-in", canal: "whatsapp",
    stage: "en_calificacion", situacion: "EN CALIFICACIÓN", situacionTone: "cyan",
    subtitle: "mensaje sin responder hace 35 min", botPrefix: true,
    botEstado: "pausa_temporal",
    respondido: { microtext: "mensaje sin responder hace 35 min" },
    llamadas: [
      {
        id: "sn-1", origin: "lead_flow_voz", fecha: "Hoy", duracion: "03:12", contestada: true,
        resultado: "Contestó · calificó parcial", sentimiento: "neutral",
        resumenIA: "Contestó pero cortó a mitad de la calificación. Mencionó que iba a revisar precios con su pareja antes de decidir.",
        audioUrl: "https://example.com/audio/lead-flow-sn-1.mp3",
      },
      {
        id: "sn-2", origin: "lead_flow_voz", fecha: "Ayer", duracion: "00:00", contestada: false,
        resultado: "No contestó",
      },
    ],
    perfil: [
      { label: "Fuente", value: "VSL opt-in", group: "origen" },
      { label: "Inversión $4-8k", value: "$4,000 USD", group: "calificacion", formulario: "vsl", procedencia: "vía VSL opt-in" },
      { label: "Mayor obstáculo", value: "Quiere revisar precios con su pareja antes de decidir.", group: "calificacion", formulario: "vsl", procedencia: "vía agente IA" },
    ],
  },
  {
    name: "EJEMPLO MARTINA OYOLA", phone: "54 911 6666 7777", grade: "C", fuente: "📷 IG Profile", canal: "instagram",
    stage: "nurture", situacion: "NURTURE", situacionTone: "violet",
    subtitle: "mensaje sin responder hace 12 min",
    respondido: { microtext: "mensaje sin responder hace 12 min" },
  },
  {
    name: "EJEMPLO IGNACIO PRADA", phone: "54 911 8888 9999", grade: "A", fuente: "📷 IG Profile", canal: "instagram",
    stage: "en_calificacion", situacion: "EN CALIFICACIÓN", situacionTone: "cyan",
    subtitle: "mensaje sin responder hace 1h",
    respondido: { microtext: "mensaje sin responder hace 1h" },
  },
  {
    name: "EJEMPLO CAMILA ROSSI", phone: "54 911 1122 3344", fuente: "📷 IG Profile", canal: "instagram",
    stage: "low_ticket_ofrecido", situacion: "DERIVADO A LT", situacionTone: "violet",
    subtitle: "mensaje sin responder hace 3h",
    respondido: { microtext: "mensaje sin responder hace 3h" },
  },
  // Seguimientos (subcategorías reales del setter — Para agendar / Para decisión LT, § auditoría v2 2026-07-11; "Muy seguro" era del closer y ni siquiera válida ahí desde §39.1)
  { name: "EJEMPLO FERNANDO LOPEZ", phone: "+52 55 4225 6686", grade: "C", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO · PARA AGENDAR", situacionTone: "amber",
    subtitle: "respondió · esperando respuesta", overdue: "Vencido hace 2 días",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "respondió · esperando respuesta", vencido: true } },
  { name: "EJEMPLO ELENA MARTIN", phone: "+52 55 9539 7100", grade: "A", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO · PARA DECISIÓN LT", situacionTone: "amber",
    subtitle: "respondió · esperando respuesta", overdue: "Vencido hace 2 días",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "respondió · esperando respuesta", vencido: true } },
  { name: "EJEMPLO MIGUEL RUIZ", phone: "+52 55 5633 4783", grade: "A", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO · PARA AGENDAR", situacionTone: "amber",
    subtitle: "respondió · esperando respuesta", overdue: "Vencido hace 2 días",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "respondió · esperando respuesta", vencido: true } },
  { name: "EJEMPLO PEDRO ALVAREZ", phone: "+52 55 8678 4587", grade: "C", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO · PARA DECISIÓN LT", situacionTone: "amber",
    subtitle: "respondió · esperando respuesta", overdue: "Vencido hace 2 días",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "respondió · esperando respuesta", vencido: true } },
  { name: "EJEMPLO LAURA ALVAREZ", phone: "+52 55 2116 8027", grade: "D", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO · PARA AGENDAR", situacionTone: "amber",
    subtitle: "respondió · esperando respuesta", overdue: "Vencido hace 2 días",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "respondió · esperando respuesta", vencido: true } },
  { name: "EJEMPLO LUIS PEREZ", phone: "+52 55 7484 4190", grade: "B", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO · PARA DECISIÓN LT", situacionTone: "amber",
    subtitle: "respondió · esperando respuesta", overdue: "Vencido hace 2 días",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "respondió · esperando respuesta", vencido: true } },
  { name: "EJEMPLO ELENA ROMERO", phone: "+52 55 3311 2020", grade: "B", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO · PARA AGENDAR", situacionTone: "amber",
    subtitle: "respondió · esperando respuesta", overdue: "Vencido hace 2 días",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "respondió · esperando respuesta", vencido: true } },
  { name: "EJEMPLO PEDRO MARTINEZ", phone: "+52 55 6644 1188", grade: "C", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO · PARA DECISIÓN LT", situacionTone: "amber",
    subtitle: "respondió · esperando respuesta", overdue: "Vencido hace 2 días",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "respondió · esperando respuesta", vencido: true } },
  {
    name: "EJEMPLO RICARDO PAZ", phone: "+52 55 7712 4499", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "SEGUIMIENTO AGOTADO — REVISAR", situacionTone: "source",
    subtitle: "serie completada sin respuesta · hace 1 día",
    botEstado: "apagado_manual",
    seguimientoPendiente: { microtext: "serie completada sin respuesta · hace 1 día" },
  },
  {
    name: "EJEMPLO ANA SILVA", phone: "54 911 4444 5555", grade: "B", fuente: "Meta Ads", canal: "whatsapp",
    stage: "en_calificacion", situacion: "EN CALIFICACIÓN", situacionTone: "cyan",
    subtitle: "preguntó por planes de pago a plazos",
  },
  {
    name: "EJEMPLO MATEO DIAZ", phone: "54 911 5555 6666", grade: "C", fuente: "VSL opt-in", canal: "whatsapp",
    stage: "en_calificacion", situacion: "EN CALIFICACIÓN", situacionTone: "cyan",
    subtitle: "llamada cortada a mitad de la calificación",
    llamadas: [
      {
        id: "md-1", origin: "lead_flow_voz", fecha: "Hoy", duracion: "01:48", contestada: true,
        resultado: "Contestó · cortada", sentimiento: "neutral",
        resumenIA: "Contestó y estaba respondiendo la calificación de presupuesto cuando la llamada se cortó abruptamente a mitad de su frase — el agente no esperó la pausa natural antes de continuar.",
        audioUrl: "https://example.com/audio/lead-flow-voz-md-1.mp3",
      },
    ],
  },
  // Pipeline — Agendado
  { name: "EJEMPLO PABLO MUÑOZ", phone: "—", grade: "D", fuente: "Meta Ads", canal: "whatsapp",
    stage: "agendado", situacion: "AGENDADO", situacionTone: "emerald", subtitle: "agendó", agendaFecha: "hace 3 días" },
  { name: "EJEMPLO LUIS FERNANDEZ", phone: "—", grade: "A", fuente: "Meta Ads", canal: "whatsapp",
    stage: "agendado", situacion: "AGENDADO", situacionTone: "emerald", subtitle: "agendó", agendaFecha: "hace 2 días" },
  { name: "EJEMPLO JUAN PEREZ", phone: "—", grade: "C", fuente: "Meta Ads", canal: "whatsapp",
    stage: "agendado", situacion: "AGENDADO", situacionTone: "emerald", subtitle: "agendó", agendaFecha: "hace 1 día" },
  { name: "EJEMPLO MARTA PEREZ", phone: "—", grade: "B", fuente: "Meta Ads", canal: "whatsapp",
    stage: "agendado", situacion: "AGENDADO", situacionTone: "emerald",
    subtitle: "Llamada agendada para hoy. El prospecto está muy interesado en automatizar su agencia.", agendaFecha: "hace 1 día" },
  { name: "EJEMPLO LUIS GOMEZ", phone: "—", grade: "D", fuente: "Meta Ads", canal: "whatsapp",
    stage: "agendado", situacion: "AGENDADO", situacionTone: "emerald", subtitle: "agendó", agendaFecha: "hace 1 día" },
  { name: "EJEMPLO SOFIA SANCHEZ", phone: "—", grade: "B", fuente: "Meta Ads", canal: "whatsapp",
    stage: "agendado", situacion: "AGENDADO", situacionTone: "emerald", subtitle: "agendó", agendaFecha: "hace 1 día" },
];

function buildSeedContacts(): Record<string, SetterContact> {
  const map: Record<string, SetterContact> = {};
  for (const c of SEED) map[c.name] = { ...c, historial: seedHist(), notas: [] };
  return map;
}

interface SetterStoreValue {
  contacts: Record<string, SetterContact>;
  /** § correcciones dashboards (2026-07-11) — única fuente de los KPIs de Inicio (comisiones, agendas, show rate). */
  cockpit: SetterCockpit;
  openContactName: string | null;
  /** contactId de GHL de la ficha abierta (cuando se abrió desde un urgente real) — para su conversación real. */
  openGhlContactId: string | null;
  openContact: (name: string, ghlContactId?: string) => void;
  closeContact: () => void;
  advance: (name: string, input: SetterAdvanceInput) => void;
  addNota: (name: string, texto: string) => void;
  resolveIntervention: (name: string) => void;
  setBotEstado: (name: string, estado: BotEstado, evento: string, autor?: string) => void;
  /** FIJAR (§ toast/pin, 2026-07-11): sube la tarea de Buzón/Respondieron u Oportunidad LT al tope de su sección sin completarla. */
  pinTask: (name: string) => void;
  /** Completa la tarea — automático (barra de progreso) o manual (botón de ficha). */
  completeTask: (name: string) => void;
  /** Demo: el contacto "vuelve a escribir" tras estar completado — reabre la tarea en Respondieron/Buzón. */
  reviveTask: (name: string) => void;
}

/** § ciclo de vida de tareas en Mi Día (2026-07-11) — única fuente de verdad del conteo de tareas pendientes del Setter (nav badge, header de Mi Día e Inicio). */
export interface SetterPendingTasksBreakdown {
  urgentes: number;
  estancadas: number;
  oportunidades: number;
  respondieron: number;
  seguimientosHoy: number;
  total: number;
}

export function setterPendingTasksBreakdown(contacts: Record<string, SetterContact>): SetterPendingTasksBreakdown {
  const all = Object.values(contacts);
  const urgentes = all.filter((c) => c.urgente && !c.completedToday).length;
  const estancadas = all.filter((c) => c.estancada && !c.completedToday).length;
  const oportunidades = all.filter((c) => c.oportunidadLt && !c.completedToday).length;
  const respondieron = all.filter((c) => c.respondido && !c.completedToday).length;
  const seguimientosHoy = all.filter((c) => c.seguimientoPendiente && !c.completedToday).length;
  return { urgentes, estancadas, oportunidades, respondieron, seguimientosHoy, total: urgentes + estancadas + oportunidades + respondieron + seguimientosHoy };
}

/**
 * § correcciones dashboards (2026-07-11) — cockpit del Setter, espejo del `Cockpit` de closerStore.tsx.
 * Antes cada tarjeta de Inicio tenía un valor suelto hardcodeado ($0 comisión conviviendo con $1,000
 * en diferidas, etc.) — ahora todo deriva de esta única base + los % configurados en Ajustes, igual
 * patrón que ya se usa para el cockpit del closer.
 */
interface SetterCockpitBase {
  /** $ bruto de ventas Low-Ticket ya cobradas este mes (antes de aplicar el % de comisión directa). */
  ltBruto: number;
  ltVentasCount: number;
  /** $ bruto de las ventas HT del closer originadas/rescatadas por este setter (antes de aplicar el % diferida). */
  diferidaBruto: number;
  diferidaVentasCount: number;
  /** Agendas que el bot cerró solo, sin intervención del setter — métrica del sistema, no mérito del setter. */
  agendasAutomaticas: number;
  /** Agendas que el setter generó/rescató manualmente — su mérito real (crece en vivo con cada Avanzar → Agendó). */
  agendasGeneradasBase: number;
  showRateNum: number;
  showRateDen: number;
  /** Ya confirmado coherente por Francisco (§ correcciones dashboards) — se muestra tal cual, sin recalcular vía división (evita un 79% por redondeo donde el confirmado es 78%). */
  showRatePct: number;
  /** Ídem — referencia de demo (mismo patrón que BUZON_COUNTS, §23 de CLAUDE.md): la lista real de Oportunidades LT en Mi Día es una muestra, este es el conteo total de referencia que Francisco ya validó. */
  oportunidadesLTBase: number;
}

const CURRENT_SETTER_NAME = "Jorge Q.";

const SETTER_COCKPIT_BASE: SetterCockpitBase = {
  ltBruto: 500,
  ltVentasCount: 1,
  diferidaBruto: 10000,
  diferidaVentasCount: 2,
  agendasAutomaticas: 33,
  agendasGeneradasBase: 9,
  showRateNum: 33,
  showRateDen: 42,
  showRatePct: 78,
  oportunidadesLTBase: 12,
};

export interface SetterCockpit {
  /** Comisión directa: ltBruto × % LT (Ajustes). */
  comisionLT: number;
  ltVentasCount: number;
  /** Comisión diferida: diferidaBruto × % diferida (Ajustes). */
  comisionDiferida: number;
  diferidaBruto: number;
  diferidaVentasCount: number;
  /** = comisionLT + comisionDiferida — la única cifra que debe verse en el hero de Inicio. */
  comisionTotal: number;
  agendasAutomaticas: number;
  agendasGeneradas: number;
  agendasTotal: number;
  showRateNum: number;
  showRateDen: number;
  showRatePct: number;
  oportunidadesLT: number;
}

interface SetterSessionDeltas {
  ltMonto: number;
  ltCount: number;
  agendasGeneradas: number;
}

const ZERO_SETTER_DELTAS: SetterSessionDeltas = { ltMonto: 0, ltCount: 0, agendasGeneradas: 0 };

const SetterCtx = createContext<SetterStoreValue | null>(null);

export function SetterProvider({ children }: { children: React.ReactNode }) {
  const [contacts, setContacts] = useState<Record<string, SetterContact>>(() => buildSeedContacts());
  const [openContactName, setOpenContactName] = useState<string | null>(null);
  const [openGhlContactId, setOpenGhlContactId] = useState<string | null>(null);
  const [deltas, setDeltas] = useState<SetterSessionDeltas>(ZERO_SETTER_DELTAS);
  const { comisionesSetterLT, comisionesSetterDiferida } = useSettings();

  const advance = useCallback((name: string, input: SetterAdvanceInput) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
      const historial = [{ fecha: "Hoy", texto: input.texto, autor: "Usuario Activo" }, ...c.historial];
      const notas = input.nota
        ? [{ id: Date.now(), contexto: input.pildora, texto: input.nota, autor: "Usuario Activo", fecha: "Hoy" }, ...c.notas]
        : c.notas;
      return {
        ...prev,
        [name]: {
          ...c,
          stage: input.stage,
          situacion: input.pildora,
          situacionTone: input.situacionTone,
          subtitle: input.texto,
          monto: input.monto ?? c.monto,
          agendaFecha: input.agendaFecha ?? c.agendaFecha,
          // Cancelación universal, igual que el closer: cualquier Avanzar apaga la serie.
          // `?? c.seguimientoAutomaticoActivo` dejaba el ⏱ encendido tras un resultado que no fuera Seguimiento.
          seguimientoAutomaticoActivo: input.seguimientoAutomaticoActivo ?? false,
          historial,
          notas,
          urgente: undefined,
          estancada: undefined,
          oportunidadLt: undefined,
          // Mismo cierre total de tareas que en el closer: sin esto, FIJAR tras un Avanzar
          // resucita al contacto en su cola vieja con la píldora del resultado nuevo.
          respondido: undefined,
          seguimientoPendiente: undefined,
          completedToday: true,
          pinned: undefined,
          // Registrar un Avanzar ES la intervención manual — el latch de atribución se enciende y ya no se apaga.
          atribucionSetter: true,
        },
      };
    });
    // § correcciones dashboards (2026-07-11): Avanzar → Agendó SIEMPRE es una agenda "generada por el
    // setter" (el bot nunca usa Avanzar — sus agendas automáticas viven solo en la base semilla).
    // Avanzar → Venta Low-Ticket suma al bruto LT en vivo, igual que el closer con sus ventas.
    if (input.stage === "agendado") {
      setDeltas((d) => ({ ...d, agendasGeneradas: d.agendasGeneradas + 1 }));
    }
    if (input.stage === "low_ticket_ofrecido" && input.monto) {
      setDeltas((d) => ({ ...d, ltMonto: d.ltMonto + input.monto!, ltCount: d.ltCount + 1 }));
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
        [name]: { ...c, urgente: undefined, botEstado: "activo", historial, completedToday: true, pinned: undefined, atribucionSetter: true },
      };
    });
  }, []);

  const setBotEstado = useCallback((name: string, estado: BotEstado, evento: string, autor: string = "Usuario Activo") => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c) return prev;
      const historial = [{ fecha: "Hoy", texto: evento, autor }, ...c.historial];
      // Solo un toggle MANUAL (autor real, no "Sistema") enciende el latch de atribución — la pausa automática por mensaje del sistema no es una intervención del setter.
      return { ...prev, [name]: { ...c, botEstado: estado, historial, atribucionSetter: autor !== "Sistema" ? true : c.atribucionSetter } };
    });
  }, []);

  /** § correcciones toast/pin v2 (2026-07-11): "tarea de conversación" cubre Buzón/Respondieron, Oportunidad LT, Seguimientos de hoy Y Estancadas — no solo Buzón. */
  const hasConversationTask = (c: SetterContact) => !!(c.respondido || c.oportunidadLt || c.seguimientoPendiente || c.estancada);

  /** FIJAR — puede deshacer un completado recién disparado (bug v2 #1: completar ya no espera al timer en pantalla, dispara al enviar). */
  const pinTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !hasConversationTask(c)) return prev;
      return { ...prev, [name]: { ...c, pinned: true, completedToday: false, atribucionSetter: true } };
    });
  }, []);

  const completeTask = useCallback((name: string) => {
    setContacts((prev) => {
      const c = prev[name];
      if (!c || !hasConversationTask(c)) return prev;
      const historial = [{ fecha: "Hoy", texto: "Respondió al contacto — tarea completada", autor: "Usuario Activo" }, ...c.historial];
      return { ...prev, [name]: { ...c, pinned: false, completedToday: true, subtitle: "Respondió al contacto", historial, atribucionSetter: true } };
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

  const cockpit: SetterCockpit = useMemo(() => {
    const ltPct = (comisionesSetterLT[CURRENT_SETTER_NAME] ?? 20) / 100;
    const diferidaPct = (comisionesSetterDiferida[CURRENT_SETTER_NAME] ?? 10) / 100;
    const ltBruto = SETTER_COCKPIT_BASE.ltBruto + deltas.ltMonto;
    const diferidaBruto = SETTER_COCKPIT_BASE.diferidaBruto;
    const comisionLT = Math.round(ltBruto * ltPct);
    const comisionDiferida = Math.round(diferidaBruto * diferidaPct);
    const agendasGeneradas = SETTER_COCKPIT_BASE.agendasGeneradasBase + deltas.agendasGeneradas;
    return {
      comisionLT,
      ltVentasCount: SETTER_COCKPIT_BASE.ltVentasCount + deltas.ltCount,
      comisionDiferida,
      diferidaBruto,
      diferidaVentasCount: SETTER_COCKPIT_BASE.diferidaVentasCount,
      comisionTotal: comisionLT + comisionDiferida,
      agendasAutomaticas: SETTER_COCKPIT_BASE.agendasAutomaticas,
      agendasGeneradas,
      agendasTotal: SETTER_COCKPIT_BASE.agendasAutomaticas + agendasGeneradas,
      showRateNum: SETTER_COCKPIT_BASE.showRateNum,
      showRateDen: SETTER_COCKPIT_BASE.showRateDen,
      showRatePct: SETTER_COCKPIT_BASE.showRatePct,
      oportunidadesLT: SETTER_COCKPIT_BASE.oportunidadesLTBase,
    };
  }, [comisionesSetterLT, comisionesSetterDiferida, deltas]);

  const value: SetterStoreValue = {
    contacts,
    cockpit,
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

  return <SetterCtx.Provider value={value}>{children}</SetterCtx.Provider>;
}

export function useSetter(): SetterStoreValue {
  const ctx = useContext(SetterCtx);
  if (!ctx) throw new Error("useSetter debe usarse dentro de <SetterProvider>");
  return ctx;
}
