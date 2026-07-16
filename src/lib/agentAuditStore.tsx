import { createContext, useCallback, useContext, useState } from "react";

/**
 * Single source of verdad para Agents Audit (§ arquitectura relacional, 2026-07-10):
 * agentes, alertas (casos técnicos agrupados por patrón vía `errorCode`) y su vínculo
 * con las Intervenciones Urgentes de Setter/Closer (join por `contactName`).
 */

export type AgentId = "lead-flow-ai" | "appointment-flow-ai" | "lead-flow-voz" | "appointment-flow-voz";
export type AgentKind = "text" | "voz";
export type AlertStatus = "active" | "resolved_by_human" | "patched_by_tech";
export type AlertCategory = "comportamiento" | "base_conocimiento" | "informacion_adicional";
export type AlertSeverity = "rojo" | "amarillo";

export const CATEGORY_LABEL: Record<AlertCategory, string> = {
  comportamiento: "Comportamiento",
  base_conocimiento: "Base de conocimiento",
  informacion_adicional: "Información adicional",
};

export interface AgentInfo {
  id: AgentId;
  type: AgentKind;
  icon: "bot" | "phone";
  name: string;
  goal: string;
  desc: string;
  metric: string;
  delta: { text: string; up: boolean };
  subtext: string;
  sentiment: { positivos: number; neutrales: number; molestos: number };
  ops: { value: string; sub?: string; label: string }[];
  /** 12 semanas — tasa de trabajo (línea sólida) y sentimiento positivo (línea punteada) del sparkline de detalle. */
  history: { week: string; tasa: number; sentimientoPositivo: number }[];
}

/** Evidencia de un agente de texto — recorte del chat. */
export interface EvidenceChat {
  kind: "chat";
  userMsg: string;
  aiMsg: string;
}

/** Evidencia de un agente de voz — recorte de la llamada (mismo shape que `CallRecord` del tab Llamada, §28.D). */
export interface EvidenceCall {
  kind: "call";
  duracion: string;
  resultado?: string;
  resumenIA?: string;
  audioUrl?: string;
}

export interface AgentAlert {
  id: string;
  agentId: AgentId;
  /** Clave de agrupación — casos con el mismo errorCode se muestran/actúan como un solo grupo ("×N casos"). */
  errorCode: string;
  title: string;
  category: AlertCategory;
  severity: AlertSeverity;
  /** Join key hacia closerStore/setterStore — ambos indexan contactos por name. */
  contactName: string;
  /** "Hace 2 horas" — display en la tarjeta de evidencia. */
  timestamp: string;
  /** "07 Jul" — display; se usa junto con `openedDaysAgo` para ordenar por antigüedad. */
  openedAt: string;
  openedDaysAgo: number;
  status: AlertStatus;
  diagnostico?: string;
  correctionBlock?: string;
  evidence?: EvidenceChat | EvidenceCall;
}

export const AGENTS: AgentInfo[] = [
  {
    id: "lead-flow-ai",
    type: "text",
    icon: "bot",
    name: "Lead Flow AI",
    goal: "CONVERSACIONES → AGENDA",
    desc: "Contactos sin agendar · su trabajo: llevarlos a la cita",
    metric: "23%",
    delta: { text: "▲ +4 pts", up: true },
    subtext: "49 de 214 agendaron",
    sentiment: { positivos: 85, neutrales: 10, molestos: 5 },
    ops: [
      { value: "214", label: "Conversaciones" },
      { value: "49", label: "Agendadas" },
      { value: "23", label: "Sin Respuesta" },
    ],
    history: [
      { week: "20 abr", tasa: 17, sentimientoPositivo: 78 },
      { week: "05 may", tasa: 18, sentimientoPositivo: 79 },
      { week: "12 may", tasa: 16, sentimientoPositivo: 77 },
      { week: "19 may", tasa: 18, sentimientoPositivo: 80 },
      { week: "26 may", tasa: 19, sentimientoPositivo: 81 },
      { week: "02 jun", tasa: 19, sentimientoPositivo: 81 },
      { week: "09 jun", tasa: 20, sentimientoPositivo: 82 },
      { week: "16 jun", tasa: 20, sentimientoPositivo: 83 },
      { week: "23 jun", tasa: 21, sentimientoPositivo: 83 },
      { week: "30 jun", tasa: 22, sentimientoPositivo: 84 },
      { week: "07 jul", tasa: 23, sentimientoPositivo: 85 },
    ],
  },
  {
    id: "appointment-flow-ai",
    type: "text",
    icon: "bot",
    name: "Appointment Flow AI",
    goal: "SHOW-UP DE SUS CITAS",
    desc: "Contactos agendados · su trabajo: asegurar que asistan",
    metric: "68%",
    delta: { text: "▼ -2 pts", up: false },
    subtext: "58 de 86 se presentaron",
    sentiment: { positivos: 70, neutrales: 20, molestos: 10 },
    ops: [
      { value: "86", label: "Conversaciones" },
      { value: "58", label: "Agendadas" },
      { value: "12", label: "Sin Respuesta" },
    ],
    history: [
      { week: "20 abr", tasa: 71, sentimientoPositivo: 74 },
      { week: "05 may", tasa: 71, sentimientoPositivo: 73 },
      { week: "12 may", tasa: 70, sentimientoPositivo: 73 },
      { week: "19 may", tasa: 70, sentimientoPositivo: 72 },
      { week: "26 may", tasa: 69, sentimientoPositivo: 72 },
      { week: "02 jun", tasa: 69, sentimientoPositivo: 71 },
      { week: "09 jun", tasa: 70, sentimientoPositivo: 71 },
      { week: "16 jun", tasa: 69, sentimientoPositivo: 70 },
      { week: "23 jun", tasa: 68, sentimientoPositivo: 70 },
      { week: "30 jun", tasa: 68, sentimientoPositivo: 70 },
      { week: "07 jul", tasa: 68, sentimientoPositivo: 70 },
    ],
  },
  {
    id: "lead-flow-voz",
    type: "voz",
    icon: "phone",
    name: "Lead Flow Voz",
    goal: "% LLAMADOS → CITA EN 48H",
    desc: "Llama al lead recién capturado · califica y agenda en la llamada",
    metric: "15%",
    delta: { text: "▲ +2 pts", up: true },
    subtext: "23 de 150 agendaron",
    sentiment: { positivos: 60, neutrales: 30, molestos: 10 },
    ops: [
      { value: "150", label: "Llamados" },
      { value: "315", sub: "2.1/cto", label: "Totales" },
      { value: "45%", label: "Contestadas" },
      { value: "25%", label: "Sin Respuesta" },
      { value: "30%", label: "Buzón" },
      { value: "320", label: "Minutos" },
    ],
    history: [
      { week: "20 abr", tasa: 13, sentimientoPositivo: 55 },
      { week: "05 may", tasa: 13, sentimientoPositivo: 56 },
      { week: "12 may", tasa: 12, sentimientoPositivo: 55 },
      { week: "19 may", tasa: 13, sentimientoPositivo: 57 },
      { week: "26 may", tasa: 14, sentimientoPositivo: 57 },
      { week: "02 jun", tasa: 14, sentimientoPositivo: 58 },
      { week: "09 jun", tasa: 14, sentimientoPositivo: 58 },
      { week: "16 jun", tasa: 15, sentimientoPositivo: 59 },
      { week: "23 jun", tasa: 14, sentimientoPositivo: 59 },
      { week: "30 jun", tasa: 15, sentimientoPositivo: 60 },
      { week: "07 jul", tasa: 15, sentimientoPositivo: 60 },
    ],
  },
  {
    id: "appointment-flow-voz",
    type: "voz",
    icon: "phone",
    name: "Appointment Flow Voz",
    goal: "% CONFIRMACIONES LOGRADAS",
    desc: "Confirma la sesión · recuerda el video pre-call",
    metric: "82%",
    delta: { text: "▲ +5 pts", up: true },
    subtext: "49 de 60 confirmaron",
    sentiment: { positivos: 90, neutrales: 5, molestos: 5 },
    ops: [
      { value: "60", label: "Llamados" },
      { value: "126", sub: "2.1/cto", label: "Totales" },
      { value: "70%", label: "Contestadas" },
      { value: "10%", label: "Sin Respuesta" },
      { value: "20%", label: "Buzón" },
      { value: "85", label: "Minutos" },
    ],
    history: [
      { week: "20 abr", tasa: 77, sentimientoPositivo: 86 },
      { week: "05 may", tasa: 78, sentimientoPositivo: 87 },
      { week: "12 may", tasa: 78, sentimientoPositivo: 87 },
      { week: "19 may", tasa: 79, sentimientoPositivo: 88 },
      { week: "26 may", tasa: 79, sentimientoPositivo: 88 },
      { week: "02 jun", tasa: 80, sentimientoPositivo: 88 },
      { week: "09 jun", tasa: 80, sentimientoPositivo: 89 },
      { week: "16 jun", tasa: 81, sentimientoPositivo: 89 },
      { week: "23 jun", tasa: 81, sentimientoPositivo: 89 },
      { week: "30 jun", tasa: 82, sentimientoPositivo: 90 },
      { week: "07 jul", tasa: 82, sentimientoPositivo: 90 },
    ],
  },
];

/**
 * Seed de alertas — 7 grupos calibrados para reproducir el banner "3 casos graves"
 * y los badges de las capturas de referencia exactamente (Lead Flow AI 2 rojos + 1 amarillo,
 * Appointment Flow AI 1 amarillo, Lead Flow Voz 1 rojo, Appointment Flow Voz sin grupos = "al día").
 *
 * `casesCount` (derivado por `groupAlerts`, ver abajo) NO tiene por qué igualar `evidence.length`:
 * la evidencia es una muestra demo, igual que `BUZON_COUNTS` en `SetterView.tsx` (§23 de CLAUDE.md) —
 * acá se modela con un campo `syntheticCases` que infla el conteo del grupo más allá de los alerts
 * realmente seedeados, documentado explícitamente.
 */
function makeFillerAlerts(count: number, base: Omit<AgentAlert, "id" | "contactName" | "timestamp">, contactPool: string[]): AgentAlert[] {
  return Array.from({ length: count }, (_, i) => ({
    ...base,
    id: `${base.errorCode}-filler-${i}`,
    contactName: contactPool[i % contactPool.length],
    timestamp: "Hace varios días",
  }));
}

const SEED_ALERTS: AgentAlert[] = [
  // Lead Flow AI — "Promesa vacía — financiamiento" (rojo, ×15, abierto hace 2 días)
  {
    id: "promesa-financiamiento-1", agentId: "lead-flow-ai", errorCode: "promesa_vacia_financiamiento",
    title: "Promesa vacía — financiamiento", category: "comportamiento", severity: "rojo",
    contactName: "CARLOS RUIZ", timestamp: "Hace 2 horas", openedAt: "05 Jul", openedDaysAgo: 2, status: "active",
    diagnostico: "El agente promete condiciones de financiamiento (meses sin intereses) que no están confirmadas en la base de conocimiento — genera una expectativa que el equipo de cierre no puede sostener.",
    correctionBlock: "No ofrezcas planes de financiamiento específicos sin verificarlos primero en la base de conocimiento. Si preguntan, responde que un asesor confirmará las opciones disponibles.",
    evidence: { kind: "chat", userMsg: "¿Tienen meses sin intereses?", aiMsg: "Sí, tenemos hasta 12 meses sin intereses." },
  },
  {
    id: "promesa-financiamiento-2", agentId: "lead-flow-ai", errorCode: "promesa_vacia_financiamiento",
    title: "Promesa vacía — financiamiento", category: "comportamiento", severity: "rojo",
    contactName: "ANA SILVA", timestamp: "Hace 5 horas", openedAt: "05 Jul", openedDaysAgo: 2, status: "active",
    diagnostico: "El agente promete condiciones de financiamiento (meses sin intereses) que no están confirmadas en la base de conocimiento — genera una expectativa que el equipo de cierre no puede sostener.",
    correctionBlock: "No ofrezcas planes de financiamiento específicos sin verificarlos primero en la base de conocimiento. Si preguntan, responde que un asesor confirmará las opciones disponibles.",
    evidence: { kind: "chat", userMsg: "Me interesa a plazos", aiMsg: "Podemos hacerlo a 12 meses sin intereses." },
  },
  ...makeFillerAlerts(13, {
    agentId: "lead-flow-ai", errorCode: "promesa_vacia_financiamiento", title: "Promesa vacía — financiamiento",
    category: "comportamiento", severity: "rojo", openedAt: "05 Jul", openedDaysAgo: 2, status: "active",
  }, ["CARLOS RUIZ", "ANA SILVA"]),

  // Lead Flow AI — "No detecta intención de pago" (rojo, ×9, abierto hace 1 día) — incluye a CARLA MENDOZA (Setter)
  {
    id: "no-detecta-pago-carla", agentId: "lead-flow-ai", errorCode: "no_detecta_intencion_pago",
    title: "No detecta intención de pago", category: "base_conocimiento", severity: "rojo",
    contactName: "CARLA MENDOZA", timestamp: "Hace 3 horas", openedAt: "06 Jul", openedDaysAgo: 1, status: "active",
    diagnostico: "Fallo en webhook de Zapier al validar email — el agente no detecta que el intento de pago quedó pendiente de validación y deja la conversación pausada sin avisar al humano.",
    correctionBlock: "Si el webhook de validación no responde en 30s, pausa el bot y notifica a Intervenciones Urgentes en vez de continuar la conversación como si nada.",
    evidence: { kind: "chat", userMsg: "Ya pagué, ¿ahora qué sigo?", aiMsg: "¡Genial! Seguimos coordinando los detalles." },
  },
  ...makeFillerAlerts(8, {
    agentId: "lead-flow-ai", errorCode: "no_detecta_intencion_pago", title: "No detecta intención de pago",
    category: "base_conocimiento", severity: "rojo", openedAt: "06 Jul", openedDaysAgo: 1, status: "active",
  }, ["JORGE RUIZ", "IGNACIO PRADA"]),

  // Lead Flow AI — "Respuestas demasiado largas" (amarillo, ×22, abierto hace 4 días)
  ...makeFillerAlerts(22, {
    agentId: "lead-flow-ai", errorCode: "respuestas_demasiado_largas", title: "Respuestas demasiado largas",
    category: "comportamiento", severity: "amarillo", openedAt: "03 Jul", openedDaysAgo: 4, status: "active",
    diagnostico: "El agente redacta respuestas de más de 4 párrafos en WhatsApp — el prospecto pierde el hilo y tarda más en responder.",
    correctionBlock: "Limita las respuestas a un máximo de 2 líneas cortas por mensaje. Si hay más información, ofrécela en un segundo mensaje solo si preguntan.",
  }, ["FERNANDO LOPEZ", "ELENA MARTIN", "MIGUEL RUIZ"]),

  // Appointment Flow AI — "No detecta solicitud de pago" (amarillo, ×6) — incluye a ARIEL MENDEZ (Closer)
  {
    id: "no-detecta-solicitud-pago-ariel", agentId: "appointment-flow-ai", errorCode: "no_detecta_solicitud_pago",
    title: "No detecta solicitud de pago", category: "comportamiento", severity: "amarillo",
    contactName: "ARIEL MENDEZ", timestamp: "Hace 1 hora", openedAt: "07 Jul", openedDaysAgo: 0, status: "active",
    diagnostico: "El usuario solicitó el enlace de pago pero la IA no lo detectó ni lo envió — requiere intervención inmediata para no perder la venta.",
    correctionBlock: "Cuando el mensaje del contacto contenga palabras como \"link\", \"pago\" o \"cómo pago\", envía el enlace de pago de inmediato en vez de continuar el guión estándar.",
    evidence: { kind: "chat", userMsg: "¿Me pasás el link para pagar?", aiMsg: "¡Claro que sí! ¿Te gustaría agendar una llamada?" },
  },
  ...makeFillerAlerts(5, {
    agentId: "appointment-flow-ai", errorCode: "no_detecta_solicitud_pago", title: "No detecta solicitud de pago",
    category: "comportamiento", severity: "amarillo", openedAt: "07 Jul", openedDaysAgo: 0, status: "active",
  }, ["CARMEN MARTIN", "CARLOS PEREZ"]),

  // Lead Flow Voz — "Corta antes de que el cliente termine" (rojo, ×5, abierto hace 1 día) — 2 ejemplos reales de grabación/transcript
  {
    id: "corta-antes-tiempo-mateo", agentId: "lead-flow-voz", errorCode: "corta_antes_tiempo",
    title: "Corta antes de que el cliente termine", category: "comportamiento", severity: "rojo",
    contactName: "MATEO DIAZ", timestamp: "Hace 4 horas", openedAt: "06 Jul", openedDaysAgo: 1, status: "active",
    diagnostico: "El agente de voz tiene una latencia de espera muy corta y corta a los clientes cuando hacen pausas al hablar.",
    correctionBlock: "Aumenta el tiempo de espera de fin de turno a 2.5 segundos.",
    evidence: { kind: "call", duracion: "01:48", resultado: "Contestó · cortada", resumenIA: "Contestó y estaba respondiendo la calificación de presupuesto cuando la llamada se cortó abruptamente a mitad de su frase — el agente no esperó la pausa natural antes de continuar.", audioUrl: "https://example.com/audio/lead-flow-voz-md-1.mp3" },
  },
  {
    id: "corta-antes-tiempo-rodrigo", agentId: "lead-flow-voz", errorCode: "corta_antes_tiempo",
    title: "Corta antes de que el cliente termine", category: "comportamiento", severity: "rojo",
    contactName: "RODRIGO SILVA", timestamp: "Hace 8 horas", openedAt: "06 Jul", openedDaysAgo: 1, status: "active",
    diagnostico: "El agente de voz tiene una latencia de espera muy corta y corta a los clientes cuando hacen pausas al hablar.",
    correctionBlock: "Aumenta el tiempo de espera de fin de turno a 2.5 segundos.",
    evidence: { kind: "call", duracion: "02:05", resultado: "Contestó · cortada", resumenIA: "Estaba explicando por qué necesitaba pensar el precio con su socio cuando el agente lo interrumpió y cortó la llamada antes de que terminara la frase.", audioUrl: "https://example.com/audio/lead-flow-voz-rs-1.mp3" },
  },
  ...makeFillerAlerts(3, {
    agentId: "lead-flow-voz", errorCode: "corta_antes_tiempo", title: "Corta antes de que el cliente termine",
    category: "comportamiento", severity: "rojo", openedAt: "06 Jul", openedDaysAgo: 1, status: "active",
    diagnostico: "El agente de voz tiene una latencia de espera muy corta y corta a los clientes cuando hacen pausas al hablar.",
    correctionBlock: "Aumenta el tiempo de espera de fin de turno a 2.5 segundos.",
  }, ["SANTIAGO TORRES", "RODRIGO SILVA"]),
];

// Filler alerts no llevan evidencia individual (`makeFillerAlerts` no la asigna) — solo inflan `casesCount`.

export function groupAlerts(alerts: AgentAlert[]) {
  const byKey = new Map<string, AgentAlert[]>();
  for (const a of alerts) {
    const key = `${a.agentId}::${a.errorCode}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(a);
  }
  return Array.from(byKey.entries()).map(([key, group]) => {
    const first = group[0];
    const hasActive = group.some((a) => a.status === "active");
    const hasResolvedByHuman = group.some((a) => a.status === "resolved_by_human");
    const allPatched = group.every((a) => a.status === "patched_by_tech");
    return {
      key,
      agentId: first.agentId,
      errorCode: first.errorCode,
      title: first.title,
      category: first.category,
      severity: first.severity,
      openedAt: first.openedAt,
      openedDaysAgo: first.openedDaysAgo,
      casesCount: group.length,
      diagnostico: group.find((a) => a.diagnostico)?.diagnostico,
      correctionBlock: group.find((a) => a.correctionBlock)?.correctionBlock,
      evidence: group.filter((a) => a.evidence).map((a) => ({ contactName: a.contactName, timestamp: a.timestamp, status: a.status, ...a.evidence! })),
      cases: group,
      hasActive,
      isOpen: hasActive || hasResolvedByHuman,
      isFullyPatched: allPatched,
      hasUnresolvedByHumanOnly: hasResolvedByHuman && !hasActive,
    };
  });
}

export type AlertGroupSummary = ReturnType<typeof groupAlerts>[number];

export interface AdjustmentEntry {
  date: string;
  issue: string;
  count: string;
  agentIcon: string;
  agentName: string;
  category: string;
  author: string;
  diagnostico?: string;
  correctionBlock?: string;
}

/** Historial de Ajustes — reproduce exactamente las capturas de referencia; "Marcar grupo resuelto" agrega filas nuevas encima. */
const SEED_ADJUSTMENTS: AdjustmentEntry[] = [
  {
    date: "04 Jul 2026", issue: "Promesa vacía — bonos", count: "×8", agentIcon: "💬", agentName: "Lead Flow AI", category: "Base de conocimiento", author: "Diego M.",
    diagnostico: "El agente ofrecía bonos de regalo (auditoría gratis, sesión extra) que no estaban aprobados en la oferta vigente, generando expectativas que el equipo de cierre no podía cumplir.",
    correctionBlock: "No menciones bonos, regalos o extras que no estén listados explícitamente en la base de conocimiento del producto activo.",
  },
  {
    date: "02 Jul 2026", issue: "Tono demasiado formal", count: "×34", agentIcon: "💬", agentName: "Lead Flow AI", category: "Comportamiento", author: "Diego M.",
    diagnostico: "El agente respondía con un registro muy formal ('Estimado/a', párrafos largos) que no calzaba con el tono cercano de WhatsApp, bajando el engagement inicial.",
    correctionBlock: "Usa un tono cercano y coloquial, como si fueras un vendedor humano por WhatsApp. Evita fórmulas formales de correo electrónico.",
  },
  {
    date: "01 Jul 2026", issue: "Cuelga al buzón de voz", count: "×12", agentIcon: "📞", agentName: "Lead Flow Voz", category: "Comportamiento", author: "Diego M.",
    diagnostico: "El agente de voz colgaba apenas detectaba el tono de buzón de voz, sin dejar un mensaje pregrabado — perdiendo la oportunidad de generar un callback.",
    correctionBlock: "Si detectás buzón de voz, dejá el mensaje pregrabado estándar antes de colgar en vez de cortar inmediatamente.",
  },
  {
    date: "28 Jun 2026", issue: "Falta de urgencia en cierre", count: "×15", agentIcon: "💬", agentName: "Appointment Flow AI", category: "Información adicional", author: "Ana S.",
    diagnostico: "El agente no mencionaba la fecha límite de la oferta vigente al confirmar la cita, restando urgencia y aumentando el no-show.",
    correctionBlock: "Al confirmar la cita, recordá siempre la vigencia de la oferta actual (fecha límite) para reforzar la urgencia de asistir.",
  },
];

interface AgentAuditStoreValue {
  agents: AgentInfo[];
  alerts: AgentAlert[];
  adjustments: AdjustmentEntry[];
  resolveAlertsForContact: (contactName: string) => void;
  patchAlertGroup: (agentId: AgentId, errorCode: string) => void;
}

const AgentAuditCtx = createContext<AgentAuditStoreValue | null>(null);

export function AgentAuditProvider({ children }: { children: React.ReactNode }) {
  const [alerts, setAlerts] = useState<AgentAlert[]>(SEED_ALERTS);
  const [adjustments, setAdjustments] = useState<AdjustmentEntry[]>(SEED_ADJUSTMENTS);

  const resolveAlertsForContact = useCallback((contactName: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.contactName === contactName && a.status === "active" ? { ...a, status: "resolved_by_human" } : a)),
    );
  }, []);

  const patchAlertGroup = useCallback((agentId: AgentId, errorCode: string) => {
    setAlerts((prev) => {
      const group = prev.filter((a) => a.agentId === agentId && a.errorCode === errorCode);
      if (group.length === 0) return prev;
      const agent = AGENTS.find((a) => a.id === agentId);
      setAdjustments((adj) => [
        {
          date: "Hoy",
          issue: group[0].title,
          count: `×${group.length}`,
          agentIcon: agent?.type === "voz" ? "📞" : "💬",
          agentName: agent?.name ?? agentId,
          category: CATEGORY_LABEL[group[0].category],
          author: "Diego M.",
          diagnostico: group.find((a) => a.diagnostico)?.diagnostico,
          correctionBlock: group.find((a) => a.correctionBlock)?.correctionBlock,
        },
        ...adj,
      ]);
      return prev.map((a) => (a.agentId === agentId && a.errorCode === errorCode ? { ...a, status: "patched_by_tech" } : a));
    });
  }, []);

  const value: AgentAuditStoreValue = { agents: AGENTS, alerts, adjustments, resolveAlertsForContact, patchAlertGroup };
  return <AgentAuditCtx.Provider value={value}>{children}</AgentAuditCtx.Provider>;
}

export function useAgentAudit(): AgentAuditStoreValue {
  const ctx = useContext(AgentAuditCtx);
  if (!ctx) throw new Error("useAgentAudit debe usarse dentro de AgentAuditProvider");
  return ctx;
}
