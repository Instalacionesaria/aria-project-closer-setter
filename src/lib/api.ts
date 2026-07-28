/**
 * Cliente de las lecturas de GHL que sirven las funciones de `api/closer/*`.
 *
 * Rutas relativas, mismo origen: el frontend y las funciones se despliegan juntos en Vercel,
 * así que no hay `VITE_API_URL` que configurar ni CORS que abrir. (Hasta el 2026-07-27 esto
 * apuntaba a un Express en una VPS vía túnel; ese backend quedó archivado en la rama
 * `respaldo/kevin-local` cuando el proyecto pasó a Vercel Functions.)
 *
 * El PIT de GHL nunca llega acá: vive solo del lado servidor, en `api/_lib`.
 *
 * Las ESCRITURAS no están en este archivo. El Avanzar se persiste por
 * `src/lib/seguimientos/cliente.ts` → `POST /api/closer/avanzar`, que es el único camino que
 * aplica tags y custom fields juntos y con idempotencia. Un `POST /tags` suelto acá
 * duplicaría la escritura y dispararía workflows de más.
 */

/** Error uniforme para todas las lecturas: el status y un recorte del cuerpo, sin ruido. */
async function pedir<T>(ruta: string): Promise<T> {
  const res = await fetch(ruta);
  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`El servidor respondió ${res.status}. ${cuerpo.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

/** Una cita normalizada tal como la devuelve `GET /api/closer/agenda`. */
export interface AgendaAppointment {
  id: string;
  name: string;
  title: string;
  date: string; // "2026-07-27" (YYYY-MM-DD, día de la organización)
  time: string; // "11:00" (24h)
  startTime: string; // ISO con offset
  endTime: string | null;
  status: string; // confirmed | showed | noshow | cancelled | ...
  meetUrl: string | null;
  contactId: string | null;
}

export interface AgendaHoyResponse {
  date: string;
  calendarId: string | null;
  /** `stub` = sin credenciales de GHL configuradas; la lista viene vacía a propósito. */
  ghlModo?: "real" | "stub";
  count: number;
  appointments: AgendaAppointment[];
  /** Presente solo cuando falta configuración (ej. sin calendario por defecto). */
  aviso?: string;
}

export interface AgendaRangeResponse extends AgendaHoyResponse {
  /** Último día del rango, `YYYY-MM-DD`. */
  hasta: string;
  days: number;
}

/** Citas de HOY del calendario de la subcuenta. */
export function fetchAgendaHoy(opts?: {
  includeCancelled?: boolean;
  calendarId?: string;
}): Promise<AgendaHoyResponse> {
  const params = new URLSearchParams();
  if (opts?.includeCancelled) params.set("includeCancelled", "true");
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  const qs = params.toString();
  return pedir<AgendaHoyResponse>(`/api/closer/agenda${qs ? `?${qs}` : ""}`);
}

/** Citas de hoy hasta hoy+days — alimenta el tab Agenda y "Próximos Días". */
export function fetchAgendaRange(
  days = 6,
  opts?: { calendarId?: string; includeCancelled?: boolean },
): Promise<AgendaRangeResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  if (opts?.includeCancelled) params.set("includeCancelled", "true");
  return pedir<AgendaRangeResponse>(`/api/closer/agenda?${params.toString()}`);
}

export interface UrgenteReal {
  contactId: string;
  name: string;
  source: string;
  /** El motivo real que dejó el analizador. El prefijo "Falla detectada por IA:" lo pone la vista. */
  fallo: string;
}

/** Contactos con `bot_pausado_fallo` + `zona_closer` → Intervenciones Urgentes del closer. */
export function fetchUrgentes(): Promise<{ count: number; urgentes: UrgenteReal[] }> {
  return pedir(`/api/closer/urgentes`);
}

/**
 * Lo mismo para el SETTER: `bot_pausado_fallo` + `zona_setter`.
 *
 * Son dos endpoints y no uno con parámetro porque los tags de territorio son excluyentes:
 * cada rol pide su cola y no hay forma de que un contacto aparezca en las dos (§11).
 */
export function fetchUrgentesSetter(): Promise<{ count: number; urgentes: UrgenteReal[] }> {
  return pedir(`/api/setter/urgentes`);
}

export interface RespondidoReal {
  contactId: string;
  name: string;
  source: string;
  /** Tag de desenlace: venta_ganada | adelanto_ganado | noshow | seguimiento | nurture_appflow | descalificado. */
  outcome: string;
  snippet: string;
  when: string; // "hace 2h"
}

/** Buzón General del closer: territorio closer + desenlace + último mensaje entrante sin responder. */
export function fetchRespondieron(): Promise<{ count: number; contactos: RespondidoReal[] }> {
  return pedir(`/api/closer/respondieron`);
}

/**
 * Métricas medidas de un agente de TEXTO, para la pestaña Auditoría de Agentes.
 *
 * Todo campo puede venir `null`: significa "todavía no lo medí", y la vista conserva el
 * valor que sembró Francisco en vez de pintar un cero que no midió nadie.
 */
export interface AgenteTextoMetricas {
  id: "lead-flow-ai" | "appointment-flow-ai";
  metric: string | null;
  delta: { text: string; up: boolean } | null;
  subtext: string | null;
  sentiment: { positivos: number; neutrales: number; molestos: number } | null;
  ops: { label: string; value: string | null }[];
  history: { week: string; tasa: number; sentimientoPositivo: number }[];
  /** Cuántos análisis sostienen estos números. 0 = todavía no se midió nada. */
  analisis: number;
}

/** Lo que midieron las dos analizadoras de agentes de texto. Los de voz no salen de acá. */
export function fetchAgentesTexto(): Promise<{ ventanaDias: number; agentes: AgenteTextoMetricas[] }> {
  return pedir(`/api/agentes/texto`);
}

/** Un mensaje real de la conversación de GHL, normalizado para el Chat. */
export interface ConversationMessage {
  id: string;
  text: string;
  outgoing: boolean; // true = saliente (nosotros), false = entrante (el contacto)
  type: string; // TYPE_SMS, TYPE_WHATSAPP, ...
  date: string;
  time: string; // "10:05 AM"
}

export interface ConversationResponse {
  conversationId: string | null;
  count: number;
  messages: ConversationMessage[];
}

/** La conversación real de un contacto, por su `contactId` de GHL. */
export function fetchConversation(contactId: string): Promise<ConversationResponse> {
  return pedir<ConversationResponse>(`/api/closer/conversacion?contactId=${encodeURIComponent(contactId)}`);
}
