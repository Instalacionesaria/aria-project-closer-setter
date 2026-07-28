/**
 * Cliente mínimo de GoHighLevel (API v2 / LeadConnector).
 * El PIT (secreto) SOLO se usa aquí, del lado servidor — nunca llega al navegador.
 */

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-04-15"; // versión requerida por los endpoints de calendarios

function pit(): string {
  const token = process.env.GHL_PIT;
  if (!token) throw new Error("Falta GHL_PIT en el entorno del backend");
  return token;
}

async function ghlFetch(path: string, params: Record<string, string | number>): Promise<any> {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${pit()}`,
      Version: VERSION,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GHL ${res.status} en ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export interface GhlCalendar {
  id: string;
  name: string;
}

export interface GhlCalendarEvent {
  id: string;
  title?: string;
  startTime: string; // ISO con offset, ej. "2026-07-16T10:00:00-05:00"
  endTime?: string;
  appointmentStatus?: string; // confirmed | cancelled | showed | noshow | ...
  contactId?: string;
  address?: string; // suele traer el link de Meet
}

/** Lista todos los calendarios de la subcuenta (para el futuro selector de calendario). */
export async function listCalendars(locationId: string): Promise<GhlCalendar[]> {
  const data = await ghlFetch("/calendars/", { locationId });
  const cals = (data.calendars ?? []) as any[];
  return cals.map((c) => ({ id: c.id, name: c.name }));
}

async function ghlPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pit()}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GHL ${res.status} en POST ${path}: ${t.slice(0, 300)}`);
  }
  return res.json();
}

/** Aplica uno o más tags a un contacto (escritura real en GHL — dispara los workflows atados a esos tags). */
export async function addContactTags(contactId: string, tags: string[]): Promise<any> {
  return ghlPost(`/contacts/${contactId}/tags`, { tags });
}

/** Escribe una nota en el contacto (el analizador guarda el motivo del fallo aquí). */
export async function addContactNote(contactId: string, body: string): Promise<any> {
  return ghlPost(`/contacts/${contactId}/notes`, { body });
}

/** Devuelve el motivo de la última nota "[IA] ..." del contacto (sin el prefijo), o null. */
export async function getLatestIaNote(contactId: string): Promise<string | null> {
  const data = await ghlFetch(`/contacts/${contactId}/notes`, {});
  const notes = (data.notes ?? []) as any[];
  const sorted = [...notes].sort((a, b) => (b.dateAdded ?? "").localeCompare(a.dateAdded ?? ""));
  const ia = sorted.find((n) => (n.body ?? "").startsWith("[IA]"));
  return ia ? (ia.body as string).replace(/^\[IA\]\s*/, "") : null;
}

export interface GhlUrgentContact {
  id: string;
  name: string;
  source: string; // "META ADS" | "VSL OPT-IN" | "📷 IG PROFILE" | "DIRECTO"
  tags: string[];
}

/** Deriva el chip de fuente a partir de los tags del contacto (mismo vocabulario que el tool). */
function deriveSource(tags: string[]): string {
  if (tags.includes("lead_meta_ads")) return "META ADS";
  if (tags.some((t) => t.toLowerCase().includes("vsl"))) return "VSL OPT-IN";
  if (tags.some((t) => t.toLowerCase().includes("instagram") || t.toLowerCase().includes("ig"))) return "📷 IG PROFILE";
  return "DIRECTO";
}

/** Contactos que tienen un tag dado (ej. `bot_pausado_fallo`) — para pintar "Intervenciones Urgentes". */
export async function getContactsByTag(locationId: string, tag: string): Promise<GhlUrgentContact[]> {
  const data = await ghlPost("/contacts/search", {
    locationId,
    pageLimit: 50,
    filters: [{ field: "tags", operator: "contains", value: tag }],
  });
  const contacts = (data.contacts ?? []) as any[];
  return contacts.map((c) => ({
    id: c.id,
    name: c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Sin nombre",
    source: deriveSource(c.tags ?? []),
    tags: c.tags ?? [],
  }));
}

export interface GhlMessage {
  id: string;
  body?: string;
  direction?: string; // "inbound" | "outbound"
  messageType?: string; // TYPE_EMAIL, TYPE_SMS, TYPE_WHATSAPP, TYPE_ACTIVITY_*, ...
  dateAdded?: string;
}

export interface GhlConversationSummary {
  id: string;
  contactId?: string;
  fullName?: string;
  lastMessageDate?: number;
  type?: string;
}

/**
 * Lista las conversaciones del location cuyo último mensaje es >= sinceMs (ej. últimos 30 días).
 * Ordenadas por fecha del último mensaje (desc). `maxScan` acota cuántas revisar por página (máx 100 en GHL).
 * NOTA: por ahora una sola página; paginación completa sobre 30 días es un siguiente paso si el volumen lo exige.
 */
export async function listRecentConversations(locationId: string, sinceMs: number, maxScan = 100): Promise<GhlConversationSummary[]> {
  const data = await ghlFetch("/conversations/search", {
    locationId,
    sortBy: "last_message_date",
    sort: "desc",
    limit: Math.min(Math.max(maxScan, 1), 100),
  });
  const convs = (data.conversations ?? []) as any[];
  return convs
    .filter((c) => (c.lastMessageDate ?? 0) >= sinceMs)
    .map((c) => ({
      id: c.id,
      contactId: c.contactId,
      fullName: c.fullName || c.contactName,
      lastMessageDate: c.lastMessageDate,
      type: c.type,
    }));
}

/** Devuelve el id de la conversación más reciente de un contacto (o null si no tiene). */
export async function searchConversation(locationId: string, contactId: string): Promise<string | null> {
  const data = await ghlFetch("/conversations/search", { locationId, contactId });
  const convs = (data.conversations ?? []) as any[];
  return convs.length ? convs[0].id : null;
}

/** Trae los mensajes de una conversación (GHL los devuelve del más reciente al más antiguo). */
export async function getMessages(conversationId: string): Promise<GhlMessage[]> {
  const data = await ghlFetch(`/conversations/${conversationId}/messages`, {});
  const m = data.messages;
  // La forma real es { messages: { messages: [...] } }; toleramos ambas.
  if (m && typeof m === "object" && !Array.isArray(m)) return (m.messages ?? []) as GhlMessage[];
  return (m ?? []) as GhlMessage[];
}

/** Trae los eventos/citas de un calendario en un rango [startMs, endMs] (epoch ms). */
export async function getCalendarEvents(opts: {
  locationId: string;
  calendarId: string;
  startMs: number;
  endMs: number;
}): Promise<GhlCalendarEvent[]> {
  const data = await ghlFetch("/calendars/events", {
    locationId: opts.locationId,
    calendarId: opts.calendarId,
    startTime: opts.startMs,
    endTime: opts.endMs,
  });
  return (data.events ?? []) as GhlCalendarEvent[];
}
