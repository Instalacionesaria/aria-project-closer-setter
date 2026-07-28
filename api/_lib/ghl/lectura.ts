/**
 * Lecturas de GoHighLevel: calendario, conversaciones y contactos por tag.
 *
 * Por qué vive fuera de `GhlPort`: el puerto modela ESCRITURAS (tags, campos) y su contrato
 * gira alrededor de `aplicado: boolean` e idempotencia, porque lo que importa es no mentirle
 * a la UI sobre un efecto que no ocurrió. Estas son consultas de solo lectura: no hay efecto
 * que registrar, no hay outbox, y meterlas en el puerto habría obligado al stub a inventar
 * citas y mensajes falsos — justo lo que el diseño del puerto evita.
 *
 * En modo stub no hay credenciales, así que cada función devuelve vacío en vez de explotar:
 * el tool muestra su estado vacío honesto ("No tienes citas agendadas para hoy") en lugar de
 * un error rojo. Quién está en qué modo lo dice `ghl().modo`, que los endpoints reportan.
 *
 * El PIT nunca sale de acá: estas funciones solo corren dentro de `api/`.
 */

import { env } from "../env.js";

const BASE = "https://services.leadconnectorhq.com";

/**
 * GHL versiona su API por fecha y cada familia de endpoints tiene la suya. Los de
 * calendario solo responden con `2021-04-15`; el resto usa `2021-07-28`, igual que
 * `real.ts`. Mandar la equivocada devuelve errores que no explican nada.
 */
const VERSION_CALENDARIOS = "2021-04-15";
const VERSION_GENERAL = "2021-07-28";

function headers(version: string): Record<string, string> {
  return {
    Authorization: `Bearer ${env.ghlApiKey()}`,
    Version: version,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

async function get(ruta: string, params: Record<string, string | number>, version = VERSION_GENERAL): Promise<any> {
  const url = new URL(BASE + ruta);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const r = await fetch(url, { headers: headers(version) });
  if (!r.ok) {
    const cuerpo = await r.text();
    throw new Error(`GHL ${r.status} en GET ${ruta}: ${cuerpo.slice(0, 300)}`);
  }
  return r.json();
}

async function post(ruta: string, body: unknown): Promise<any> {
  const r = await fetch(BASE + ruta, {
    method: "POST",
    headers: headers(VERSION_GENERAL),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const cuerpo = await r.text();
    throw new Error(`GHL ${r.status} en POST ${ruta}: ${cuerpo.slice(0, 300)}`);
  }
  return r.json();
}

/* ================================================================== */
/* Calendario                                                          */
/* ================================================================== */

export interface EventoCalendario {
  id: string;
  title?: string;
  /** ISO con offset de la subcuenta, ej. `2026-07-27T11:00:00-05:00`. */
  startTime: string;
  endTime?: string;
  /** confirmed | cancelled | showed | noshow | ... */
  appointmentStatus?: string;
  contactId?: string;
  /** GHL guarda el link del Meet acá cuando la cita tiene sala. */
  address?: string;
}

/** Citas de un calendario dentro de un rango epoch-ms. Vacío si no hay credenciales. */
export async function eventosDeCalendario(opts: {
  calendarId: string;
  desdeMs: number;
  hastaMs: number;
}): Promise<EventoCalendario[]> {
  if (!env.tieneCredencialesGhl()) return [];
  const datos = await get(
    "/calendars/events",
    {
      locationId: env.ghlLocationId(),
      calendarId: opts.calendarId,
      startTime: opts.desdeMs,
      endTime: opts.hastaMs,
    },
    VERSION_CALENDARIOS,
  );
  return (datos.events ?? []) as EventoCalendario[];
}

/* ================================================================== */
/* Conversaciones                                                      */
/* ================================================================== */

export interface MensajeGhl {
  id: string;
  body?: string;
  /** inbound | outbound */
  direction?: string;
  /** TYPE_SMS, TYPE_WHATSAPP, TYPE_ACTIVITY_*, ... */
  messageType?: string;
  dateAdded?: string;
}

/** Id de la conversación más reciente del contacto, o null si no tiene ninguna. */
export async function conversacionDeContacto(ghlContactId: string): Promise<string | null> {
  if (!env.tieneCredencialesGhl()) return null;
  const datos = await get("/conversations/search", {
    locationId: env.ghlLocationId(),
    contactId: ghlContactId,
  });
  const convs = (datos.conversations ?? []) as any[];
  return convs.length ? convs[0].id : null;
}

/**
 * Mensajes de una conversación. GHL los devuelve del más reciente al más antiguo y a veces
 * anidados (`{ messages: { messages: [...] } }`), así que se tolera ambas formas.
 */
export async function mensajesDeConversacion(conversationId: string): Promise<MensajeGhl[]> {
  if (!env.tieneCredencialesGhl()) return [];
  const datos = await get(`/conversations/${conversationId}/messages`, {});
  const m = datos.messages;
  if (m && typeof m === "object" && !Array.isArray(m)) return (m.messages ?? []) as MensajeGhl[];
  return (m ?? []) as MensajeGhl[];
}

/** Los de actividad son eventos del sistema, no mensajes de chat: nunca se muestran. */
export const esMensajeDeChat = (m: MensajeGhl) => Boolean(m.body) && !(m.messageType ?? "").startsWith("TYPE_ACTIVITY");

/* ================================================================== */
/* Contactos                                                           */
/* ================================================================== */

export interface ContactoConTag {
  id: string;
  nombre: string;
  /** Chip de fuente del tool: META ADS | VSL OPT-IN | 📷 IG PROFILE | DIRECTO. */
  fuente: string;
  tags: string[];
}

/** El chip de fuente sale de los tags — ninguna fila queda sin origen (§8: fallback DIRECTO). */
function derivarFuente(tags: string[]): string {
  const bajos = tags.map((t) => t.toLowerCase());
  if (bajos.includes("lead_meta_ads")) return "META ADS";
  if (bajos.some((t) => t.includes("vsl"))) return "VSL OPT-IN";
  if (bajos.some((t) => t.includes("instagram") || t === "ig")) return "📷 IG PROFILE";
  return "DIRECTO";
}

/** Contactos que tienen un tag dado — así se descubre el territorio real de cada cola. */
export async function contactosConTag(tag: string, limite = 50): Promise<ContactoConTag[]> {
  if (!env.tieneCredencialesGhl()) return [];
  const datos = await post("/contacts/search", {
    locationId: env.ghlLocationId(),
    pageLimit: limite,
    filters: [{ field: "tags", operator: "contains", value: tag }],
  });
  return ((datos.contacts ?? []) as any[]).map((c) => ({
    id: c.id,
    nombre:
      c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || "Sin nombre",
    fuente: derivarFuente(c.tags ?? []),
    tags: c.tags ?? [],
  }));
}

/**
 * Motivo de la última nota `[IA] ...` del contacto, sin el prefijo.
 * Es donde el analizador deja por qué pausó al bot; sin nota, null (el caller decide el texto).
 */
export async function ultimaNotaIa(ghlContactId: string): Promise<string | null> {
  if (!env.tieneCredencialesGhl()) return null;
  const datos = await get(`/contacts/${ghlContactId}/notes`, {});
  const notas = (datos.notes ?? []) as any[];
  const ordenadas = [...notas].sort((a, b) => (b.dateAdded ?? "").localeCompare(a.dateAdded ?? ""));
  const ia = ordenadas.find((n) => (n.body ?? "").startsWith("[IA]"));
  return ia ? (ia.body as string).replace(/^\[IA\]\s*/, "") : null;
}
