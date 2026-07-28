/**
 * Cliente del Backend-Closer-Setter (Express en la VPS).
 * La URL sale de VITE_API_URL (pública, no secreta). El PIT de GHL NUNCA vive aquí.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "";

/** Una cita normalizada tal como la devuelve GET /api/agenda-hoy. */
export interface AgendaAppointment {
  id: string;
  name: string;
  title: string;
  date: string; // "2026-07-16" (YYYY-MM-DD, hora de la subcuenta)
  time: string; // "10:00" (24h, hora de la subcuenta)
  startTime: string; // ISO con offset
  endTime: string | null;
  status: string; // confirmed | showed | noshow | ...
  meetUrl: string | null;
  contactId: string | null;
}

export interface AgendaHoyResponse {
  date: string; // "2026-07-16"
  calendarId: string;
  count: number;
  appointments: AgendaAppointment[];
}

/** Trae las citas de HOY del calendario (por defecto el de Descubrimiento). */
export async function fetchAgendaHoy(opts?: {
  includeCancelled?: boolean;
  calendarId?: string;
}): Promise<AgendaHoyResponse> {
  const params = new URLSearchParams();
  if (opts?.includeCancelled) params.set("includeCancelled", "true");
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  const qs = params.toString();

  const res = await fetch(`${API_URL}/api/agenda-hoy${qs ? `?${qs}` : ""}`, {
    // ngrok (plan gratis) intercepta requests de navegador con una página de aviso HTML;
    // este header la salta para que la respuesta sea el JSON real. Inofensivo sin ngrok.
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend respondió ${res.status}. ${body.slice(0, 200)}`);
  }
  return res.json();
}

export interface UrgenteReal {
  contactId: string;
  name: string;
  source: string;
  fallo: string;
}

/** Contactos reales marcados por la IA (tag bot_pausado_fallo) para Intervenciones Urgentes. */
export async function fetchUrgentes(): Promise<{ count: number; urgentes: UrgenteReal[] }> {
  const res = await fetch(`${API_URL}/api/urgentes`, {
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend respondió ${res.status}. ${body.slice(0, 200)}`);
  }
  return res.json();
}

export interface RespondidoReal {
  contactId: string;
  name: string;
  source: string;
  outcome: string; // tag de desenlace: venta_ganada | adelanto_ganado | seguimiento | noshow | nurture_appflow | descalificado
  snippet: string;
  when: string; // "hace 2h"
}

/** Buzón General del closer: contactos zona_closer + desenlace + último mensaje entrante sin responder. */
export async function fetchRespondieron(): Promise<{ count: number; contactos: RespondidoReal[] }> {
  const res = await fetch(`${API_URL}/api/respondieron`, {
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend respondió ${res.status}. ${body.slice(0, 200)}`);
  }
  return res.json();
}

export interface AgendaRangeResponse {
  today: string; // "2026-07-16" (hoy en la zona de la subcuenta)
  days: number;
  calendarId: string;
  count: number;
  appointments: AgendaAppointment[];
}

/** Trae las citas de hoy hasta hoy+days (cada una con su `date`) — para "Próximos Días" y el mini-calendario. */
export async function fetchAgendaRange(days = 6, opts?: { calendarId?: string; includeCancelled?: boolean }): Promise<AgendaRangeResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  if (opts?.includeCancelled) params.set("includeCancelled", "true");
  const res = await fetch(`${API_URL}/api/agenda-range?${params.toString()}`, {
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend respondió ${res.status}. ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Un mensaje real de la conversación de GHL, normalizado para el Chat. */
export interface ConversationMessage {
  id: string;
  text: string;
  outgoing: boolean; // true = saliente (nosotros), false = entrante (contacto)
  type: string; // TYPE_EMAIL, TYPE_SMS, TYPE_WHATSAPP, ...
  date: string;
  time: string; // "10:00 AM"
}

export interface ConversationResponse {
  conversationId: string | null;
  count: number;
  messages: ConversationMessage[];
}

/** Aplica tags reales al contacto en GHL (escritura del "Avanzar"). Dispara los workflows atados al tag. */
export async function applyContactTags(contactId: string, tags: string[]): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/api/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend respondió ${res.status}. ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Trae la conversación real de un contacto (por su contactId de GHL). */
export async function fetchConversation(contactId: string): Promise<ConversationResponse> {
  const res = await fetch(`${API_URL}/api/conversation?contactId=${encodeURIComponent(contactId)}`, {
    headers: { "ngrok-skip-browser-warning": "true" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend respondió ${res.status}. ${body.slice(0, 200)}`);
  }
  return res.json();
}
