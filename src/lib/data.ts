// Capa de datos portada fielmente del bundle original (VT + KT + GT).
// El pipeline se genera con datos aleatorios en cada carga, igual que el original.

export type Sender = "lead" | "agent";
export interface Message {
  id: number;
  text: string;
  sender: Sender;
  time: string;
}
export interface Note {
  id: string;
  text: string;
  timestamp: string;
}
export interface CallAnalysis {
  score: number;
  good: string[];
  bad: string[];
  objections: string[];
}
export interface ChatAnalysis {
  status: "urgent" | "warning" | "ok";
  summary: string;
}
export interface HistoryEvent {
  date: string;
  event: string;
}
export interface Lead {
  id: string;
  date: string;
  name: string;
  phone: string;
  callStatus: string;
  result: string;
  value: string;
  notes: Note[];
  aiStatus: "active" | "paused";
  aiAlert?: string;
  aiAlertReason?: string;
  callAnalysis?: CallAnalysis;
  chatAnalysis: ChatAnalysis;
  messages: Message[];
  nextFollowUp?: string;
  followUpType?: string;
  bookingCount?: number;
  history?: HistoryEvent[];
}

export const CALL_STATUS_OPTIONS = [
  "Agendado",
  "Reagendado",
  "Conecto",
  "No conecto",
  "Canceló",
  "Wrong Info",
];
export const RESULT_OPTIONS = [
  "Pendiente",
  "No interesado",
  "Seguimiento",
  "Recuperando",
  "Paga adelanto",
  "Cerrado",
];

const DAY = 864e5;

// --- Leads semilla (hardcodeados en el original) ---
const VT: Lead[] = [
  {
    id: "1",
    date: "01 Jun 2024",
    name: "ARIEL MENDEZ",
    phone: "54 11 6123-6266",
    callStatus: "Canceló",
    result: "No interesado",
    value: "",
    notes: [],
    aiStatus: "active",
    aiAlert: "urgente",
    aiAlertReason: "El lead pidió link de pago hace 10 min y la IA no lo reconoció.",
    callAnalysis: {
      score: 45,
      good: ["Buena introducción", "Tono amable"],
      bad: ["No se manejó la objeción de precio", "Faltó urgencia"],
      objections: ["Muy caro", "No tengo tiempo"],
    },
    chatAnalysis: {
      status: "urgent",
      summary:
        "El usuario solicitó el enlace de pago pero la IA no lo detectó ni lo envió. Requiere intervención inmediata para no perder la venta.",
    },
    messages: [
      { id: 1, text: "Hola, vi su anuncio sobre el sistema IA.", sender: "lead", time: "10:00 AM" },
      { id: 2, text: "¡Hola Ariel! Claro que sí, ¿te gustaría agendar una llamada rápida para mostrarte cómo funciona?", sender: "agent", time: "10:05 AM" },
      { id: 3, text: "Me parece bien. ¿Tienen disponibilidad mañana?", sender: "lead", time: "10:15 AM" },
      { id: 4, text: "Quiero pagar ya, mandame el link", sender: "lead", time: "10:20 AM" },
      { id: 5, text: "Para agendar, por favor dime tu horario...", sender: "agent", time: "10:21 AM" },
    ],
  },
  {
    id: "2",
    date: "01 Jun 2024",
    name: "ALFREDO",
    phone: "1 385-252-0077",
    callStatus: "No conecto",
    result: "Recuperando",
    value: "",
    notes: [],
    nextFollowUp: new Date().toISOString().split("T")[0],
    followUpType: "sin-llamada",
    aiStatus: "paused",
    chatAnalysis: {
      status: "warning",
      summary:
        "La conversación se ha estancado. El usuario no ha respondido al último correo enviado.",
    },
    messages: [
      { id: 1, text: "Información por favor", sender: "lead", time: "09:00 AM" },
      { id: 2, text: "¡Hola Alfredo! Te envié los detalles por correo.", sender: "agent", time: "09:15 AM" },
    ],
  },
  {
    id: "3",
    date: "03 Jun 2024",
    name: "EFRAIN FLORES",
    phone: "52 55 6158 1400",
    callStatus: "Conecto",
    result: "Seguimiento",
    value: "8,000$",
    notes: [{ id: "n1", text: "NO CONOCIA LA INDUSTRIA , RESEARCH PROPIO", timestamp: "3 Jun, 14:30" }],
    nextFollowUp: new Date(Date.now() - DAY).toISOString().split("T")[0],
    followUpType: "post-llamada",
    aiStatus: "active",
    callAnalysis: {
      score: 85,
      good: ["Excelente cualificación", "Descubrimiento profundo del dolor"],
      bad: ["Faltó establecer próximos pasos claros"],
      objections: ["Tengo que consultarlo con mi socio"],
    },
    chatAnalysis: { status: "ok", summary: "Todo bajo control. La IA agendó la llamada correctamente." },
    messages: [],
  },
  {
    id: "4",
    date: "03 Jun 2024",
    name: "SHIRLEY FAJARDO",
    phone: "506 8844 0694",
    callStatus: "Conecto",
    result: "Cerrado",
    value: "8,000$",
    notes: [],
    aiStatus: "active",
    chatAnalysis: { status: "ok", summary: "Todo bajo control. Venta cerrada." },
    messages: [],
  },
  {
    id: "5",
    date: "13 Jun 2024",
    name: "GARY ALFARO",
    phone: "989 202 411",
    callStatus: "Reagendado",
    result: "Paga adelanto",
    value: "100$",
    notes: [{ id: "n2", text: "DEJO SEÑA DE 100$ , REAGENDO EN UNA SEMANA", timestamp: "13 Jun, 10:15" }],
    bookingCount: 2,
    aiStatus: "active",
    chatAnalysis: { status: "ok", summary: "El usuario reagendó exitosamente y pagó el adelanto." },
    messages: [],
    history: [
      { date: "05 Jun", event: "Agendó primera cita" },
      { date: "06 Jun", event: "Marcado como No Show ❌" },
      { date: "06 Jun", event: "Resultado anterior: Cerrado (Seña)" },
      { date: "12 Jun", event: "Reagendó cita nueva 🔄" },
    ],
  },
  {
    id: "6",
    date: "14 Jun 2024",
    name: "MARIA GOMEZ",
    phone: "34 612 345 678",
    callStatus: "Conecto",
    result: "Seguimiento",
    value: "5,000$",
    notes: [{ id: "n3", text: "Interesada, pero tiene que hablar con su marido. Llamar el viernes.", timestamp: "14 Jun, 11:00" }],
    nextFollowUp: new Date(Date.now() + DAY * 2).toISOString().split("T")[0],
    followUpType: "post-llamada",
    aiStatus: "active",
    callAnalysis: {
      score: 75,
      good: ["Generó buena confianza"],
      bad: ["No cerró en la primera llamada"],
      objections: ["Decisión compartida"],
    },
    chatAnalysis: { status: "ok", summary: "Conversación fluida." },
    messages: [],
  },
  {
    id: "7",
    date: "15 Jun 2024",
    name: "JUAN PEREZ",
    phone: "52 55 1234 5678",
    callStatus: "Agendado",
    result: "Pendiente",
    value: "",
    notes: [],
    aiStatus: "active",
    chatAnalysis: { status: "ok", summary: "Llamada agendada para hoy." },
    messages: [],
  },
  {
    id: "8",
    date: "15 Jun 2024",
    name: "LAURA MARTINEZ",
    phone: "57 300 123 4567",
    callStatus: "No conecto",
    result: "Recuperando",
    value: "",
    notes: [{ id: "n4", text: "No contestó a la hora acordada.", timestamp: "15 Jun, 09:30" }],
    aiStatus: "active",
    chatAnalysis: { status: "ok", summary: "Esperando reprogramación." },
    messages: [],
  },
  {
    id: "9",
    date: "16 Jun 2024",
    name: "CARLOS RUIZ",
    phone: "56 9 1234 5678",
    callStatus: "Conecto",
    result: "Seguimiento",
    value: "12,000$",
    notes: [{ id: "n5", text: "Interesado en el plan anual, envié propuesta.", timestamp: "16 Jun, 15:45" }],
    aiStatus: "active",
    chatAnalysis: { status: "warning", summary: "El prospecto tiene dudas sobre el ROI." },
    messages: [],
  },
  {
    id: "10",
    date: "16 Jun 2024",
    name: "ANA SILVA",
    phone: "51 987 654 321",
    callStatus: "Conecto",
    result: "Seguimiento",
    value: "6,500$",
    notes: [],
    nextFollowUp: "",
    followUpType: "post-llamada",
    aiStatus: "active",
    callAnalysis: {
      score: 60,
      good: ["Buena energía"],
      bad: ["Habló demasiado"],
      objections: ["Precio alto"],
    },
    chatAnalysis: { status: "warning", summary: "El prospecto mencionó dudas sobre el precio en el chat post-llamada." },
    messages: [],
  },
];

const FIRST_NAMES = [
  "CARLOS", "MIGUEL", "ANDREA", "LUCIA", "JORGE", "SOFIA", "MARTA", "PEDRO",
  "LUIS", "ANA", "DIEGO", "CARMEN", "RAUL", "ELENA", "LAURA", "PABLO",
  "FERNANDO", "ISABEL",
];
const LAST_NAMES = [
  "GOMEZ", "RODRIGUEZ", "FERNANDEZ", "LOPEZ", "MARTINEZ", "SANCHEZ", "PEREZ",
  "MARTIN", "RUIZ", "DIAZ", "ALVAREZ", "MORENO", "MUÑOZ", "ROMERO",
];
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// Formatea una fecha como "01 Jun 2026"
const formatDate = (d: Date) =>
  `${String(d.getDate()).padStart(2, "0")} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

// Parsea "01 Jun 2026" a timestamp (para ordenar)
const parseDate = (s: string): number => {
  const t = s.split(" ");
  if (t.length < 3) return new Date().getTime();
  const day = parseInt(t[0], 10);
  const mon = t[1].toLowerCase();
  const year = parseInt(t[2], 10);
  const idx = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"].findIndex((m) =>
    mon.startsWith(m)
  );
  return new Date(year, idx >= 0 ? idx : 0, day).getTime();
};

const rand = (n: number) => Math.floor(Math.random() * n);

// Plantillas de conversación
const CHAT_TEMPLATES: Message[][] = [
  [
    { id: 1, text: "Hola, quiero más info", sender: "lead", time: "10:00 AM" },
    { id: 2, text: "¡Claro! ¿Te gustaría agendar una llamada?", sender: "agent", time: "10:05 AM" },
  ],
  [
    { id: 1, text: "¿Tienen disponibilidad hoy?", sender: "lead", time: "09:00 AM" },
    { id: 2, text: "Sí, a las 3 PM. ¿Te reservo?", sender: "agent", time: "09:15 AM" },
  ],
  [
    { id: 1, text: "Me interesa el sistema", sender: "lead", time: "14:00 PM" },
    { id: 2, text: "Perfecto, te envié los detalles", sender: "agent", time: "14:20 PM" },
  ],
  [
    { id: 1, text: "¿Cuánto cuesta?", sender: "lead", time: "11:00 AM" },
    { id: 2, text: "Depende de tus necesidades, agendemos para verlo", sender: "agent", time: "11:05 AM" },
  ],
];

// Generador procedural de leads (portado de KT)
function generateLeads(count: number, startId: number): Lead[] {
  const out: Lead[] = [];
  const now = new Date();
  const yesterday = new Date(now.getTime() - DAY).toISOString().split("T")[0];

  for (let s = 0; s < count; s++) {
    const id = (startId + s).toString();
    const name = `${FIRST_NAMES[rand(FIRST_NAMES.length)]} ${LAST_NAMES[rand(LAST_NAMES.length)]}`;
    let callStatus = "Conecto";
    let result = "Seguimiento";
    let chatStatus: ChatAnalysis["status"] = "ok";
    let nextFollowUp = "";
    let aiAlertReason = "";
    let aiAlert: string | undefined = undefined;
    let baseDate = new Date();

    if (s >= count - 4) {
      callStatus = "Agendado";
      result = "Pendiente";
      baseDate = new Date();
    } else if (s < 37) {
      if (s < 30) {
        callStatus = "Conecto";
        result = "Seguimiento";
        nextFollowUp = s < 15 ? yesterday : new Date(now.getTime() + DAY * 2).toISOString().split("T")[0];
      } else {
        callStatus = "Conecto";
        result = "No interesado";
      }
      baseDate = new Date(now.getTime() - (rand(14) + 1) * DAY);
    } else if (s < 62) {
      callStatus = "No conecto";
      result = "Recuperando";
      baseDate = new Date(now.getTime() - (rand(7) + 1) * DAY);
    } else {
      callStatus = "Agendado";
      result = "Pendiente";
      baseDate = new Date(now.getTime() + (rand(10) + 1) * DAY);
    }

    const dateStr = formatDate(baseDate);
    if (s % 12 === 0) {
      chatStatus = "urgent";
      aiAlert = "urgente";
      aiAlertReason = "El lead hizo una objeción fuerte y la IA no supo manejarla.";
    } else if (s % 5 === 0) {
      chatStatus = "warning";
    }

    const histDate = new Date(baseDate.getTime() - (rand(5) + 2) * DAY).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
    });
    const shortDate = dateStr.length < 10 ? dateStr : dateStr.substring(0, 6);
    const history: HistoryEvent[] = [
      { date: histDate, event: "Interacción inicial con IA" },
      { date: histDate, event: "Agendó llamada de ventas" },
    ];
    let callAnalysis: CallAnalysis | undefined;
    if (callStatus === "Conecto") {
      history.push({ date: shortDate, event: "Llamada realizada (Conectó)" });
      if (result === "Seguimiento") history.push({ date: shortDate, event: "Marcado para seguimiento post-llamada" });
      if (result === "No interesado") history.push({ date: shortDate, event: "Marcado como no interesado" });
      callAnalysis = {
        score: rand(40) + 50,
        good: ["Buena introducción", "Escucha activa"],
        bad: ["Faltó urgencia", "No se manejó bien el precio"],
        objections: ["Muy caro", "Consultar con socio"],
      };
    } else if (callStatus === "No conecto") {
      history.push({ date: shortDate, event: "Llamada: No Show ❌" });
      history.push({ date: shortDate, event: "Iniciado flujo de recuperación IA" });
    }

    out.push({
      id,
      date: dateStr,
      name,
      phone: `+52 55 ${Math.floor(1e3 + Math.random() * 9e3)} ${Math.floor(1e3 + Math.random() * 9e3)}`,
      callStatus,
      result,
      value: result === "Seguimiento" ? `${(rand(5) + 3) * 1e3}$` : "",
      notes: [],
      nextFollowUp,
      aiStatus: "active",
      aiAlert,
      aiAlertReason,
      callAnalysis,
      chatAnalysis: {
        status: chatStatus,
        summary:
          chatStatus === "urgent"
            ? "Requiere intervención manual inmediata."
            : chatStatus === "warning"
              ? "Revisar la última respuesta enviada."
              : "Todo bajo control.",
      },
      messages: [...CHAT_TEMPLATES[rand(CHAT_TEMPLATES.length)]],
      history,
      followUpType: result === "Seguimiento" ? "post-llamada" : undefined,
    });
  }
  return out;
}

// Array maestro de leads: semilla + generados, ordenado por fecha (portado de GT)
export const LEADS: Lead[] = [
  ...VT.map((e, t) => {
    const isScheduled = e.callStatus === "Agendado" || e.callStatus === "Reagendado";
    const n = formatDate(isScheduled ? new Date(Date.now() + (t + 1) * DAY) : new Date(Date.now() - (20 - t) * DAY));
    return {
      ...e,
      date: n,
      messages: e.messages && e.messages.length ? e.messages : [...CHAT_TEMPLATES[rand(CHAT_TEMPLATES.length)]],
      history:
        e.history || [
          { date: n.substring(0, 6), event: "Interacción inicial con IA" },
          { date: n.substring(0, 6), event: "Agendó llamada de ventas" },
          ...(e.callStatus === "Conecto" ? [{ date: n.substring(0, 6), event: "Llamada realizada (Conectó)" }] : []),
          ...(e.callStatus === "No conecto"
            ? [
                { date: n.substring(0, 6), event: "Llamada: No Show ❌" },
                { date: n.substring(0, 6), event: "Iniciado flujo de recuperación IA" },
              ]
            : []),
        ],
    };
  }),
  ...generateLeads(75, 11),
].sort((a, b) => parseDate(a.date) - parseDate(b.date));

// --- Datos estáticos de otras vistas (Sales Call AI / AI Chat Audit) ---

export const SALES_OBJECTIONS = [
  { name: "Muy caro / Falta de presupuesto", pct: 45 },
  { name: "Tengo que consultarlo con mi socio", pct: 30 },
  { name: "No tengo tiempo para implementar", pct: 15 },
  { name: "Ya usamos otra herramienta", pct: 10 },
];

export const SALES_CLOSER_ERRORS = [
  { name: "Falta de urgencia al cierre", count: 12 },
  { name: "No indagar dolor profundo", count: 8 },
  { name: "Hablar de características, no beneficios", count: 5 },
  { name: "No establecer próximos pasos", count: 3 },
];

export const SALES_CONTENT_INSIGHTS = [
  "¿Por qué un sistema IA es más barato que un setter humano? (Manejo objeción precio)",
  "Caso de estudio: Cómo implementar en menos de 48 horas. (Manejo objeción tiempo)",
];

export const SALES_RECORDINGS = [
  { date: "Hoy, 10:30", name: "Ariel Mendez", score: 45, obj: "Muy caro", duration: "15:20" },
  { date: "Ayer, 14:00", name: "Efrain Flores", score: 85, obj: "Consultar socio", duration: "22:15" },
  { date: "13 Jun", name: "Gary Alfaro", score: 92, obj: "Ninguna", duration: "18:40" },
];

export const AUDIT_UNMAPPED_QUESTIONS = [
  { q: "¿Se puede integrar con Zapier?", count: 45 },
  { q: "¿Cuánto cuesta si tengo 5 agentes?", count: 28 },
  { q: "¿Tienen aplicación móvil?", count: 15 },
];

export const AUDIT_AI_ERRORS = [
  { err: "No detectar intención de compra (pedir link)", pct: 40 },
  { err: "Bucle infinito preguntando el correo", pct: 25 },
  { err: "Respuestas demasiado largas", pct: 20 },
  { err: "Confusión con zonas horarias", pct: 15 },
];
