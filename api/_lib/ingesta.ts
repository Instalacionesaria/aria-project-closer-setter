/**
 * Ingesta de mensajes de WhatsApp — la lógica compartida entre las dos vías.
 *
 * El sistema tiene doble vía a propósito (CONTEXTO-CLOSER-Conexiones-Polling.md §4):
 * el webhook da velocidad (≤1s) y la reconciliación da confiabilidad (≤10s aunque el
 * workflow de GHL esté caído o ni exista). Ninguna depende de la otra, y las dos terminan
 * acá: mismo upsert, mismos efectos, misma idempotencia. Lo que este módulo garantiza es
 * que llegar por las dos vías a la vez NO duplique nada — la primary key de
 * `closer_mensajes` es el messageId de GHL, y el segundo upsert del mismo id es un no-op.
 *
 * El ruteo al Buzón NO escribe ninguna bandera: el Buzón se DERIVA por query
 * (bot apagado + último entrante posterior a `buzon_resuelto_el`). Lo único que la ingesta
 * mantiene son los hechos: qué mensajes hay y cuándo fue el último.
 */

import { TAGS } from "../../src/lib/ghl/contrato.js";
import { env } from "./env.js";
import { sincronizarContacto } from "./contactos.js";
import { ORG_ID, db } from "./repo.js";

/* ================================================================== */
/* Mensajes                                                            */
/* ================================================================== */

export interface MensajeNormalizado {
  /** messageId de GHL, o el determinístico de `idDeMensaje()` si el payload no lo trae. */
  id: string;
  ghlContactId: string;
  conversationId: string | null;
  direccion: "inbound" | "outbound";
  body: string;
  /** ISO. El momento del mensaje según GHL, no cuándo lo ingerimos. */
  timestampGhl: string;
}

/**
 * Id determinístico para payloads sin messageId (los workflows de GHL no siempre lo
 * incluyen). Determinístico = el mismo mensaje llegando dos veces fabrica el MISMO id, y la
 * primary key lo deduplica igual que a uno real. El hash del body cubre el caso de dos
 * mensajes distintos en el mismo segundo.
 */
export function idDeMensaje(conversationId: string | null, timestampIso: string, body: string): string {
  let hash = 0;
  for (let i = 0; i < body.length; i++) {
    hash = (hash * 31 + body.charCodeAt(i)) | 0;
  }
  return `wh:${conversationId ?? "sin-conv"}:${timestampIso}:${(hash >>> 0).toString(36)}`;
}

/** Upsert idempotente del lote. Devuelve cuántos eran genuinamente nuevos. */
export async function guardarMensajes(mensajes: MensajeNormalizado[]): Promise<number> {
  if (mensajes.length === 0) return 0;

  // `ignoreDuplicates` + `count` es lo que permite saber cuántos NO estaban: la
  // reconciliación usa ese número para decidir si hay que disparar efectos de entrante.
  const { data, error } = await db()
    .from("closer_mensajes")
    .upsert(
      mensajes.map((m) => ({
        id: m.id,
        ghl_contact_id: m.ghlContactId,
        conversation_id: m.conversationId,
        direccion: m.direccion,
        body: m.body,
        timestamp_ghl: m.timestampGhl,
      })),
      { onConflict: "id", ignoreDuplicates: true },
    )
    .select("id");

  if (error) throw new Error(`closer_mensajes: ${error.message}`);
  return data?.length ?? 0;
}

/* ================================================================== */
/* Contacto                                                            */
/* ================================================================== */

export interface ContactoCacheado {
  ghl_contact_id: string;
  tags: string[];
  congelado: boolean;
  buzon_resuelto_el: string | null;
  last_message_ghl_at: string | null;
}

/**
 * Garantiza que el contacto exista en `closer_contactos` y lo devuelve.
 *
 * La red de seguridad del alta (decisión de Fabio, 2026-07-31): NO hay barrido de
 * descubrimiento — todo contacto nuevo llega con cita, así que lo crea el webhook de citas
 * o el respaldo de :25/:55. Pero si un webhook de MENSAJE llega antes que el de cita (o el
 * de cita se perdió), esto lo da de alta en el momento con 1 llamada a GHL, en vez de
 * ignorar un mensaje de alguien que sí es del territorio.
 */
export async function asegurarContacto(ghlContactId: string): Promise<ContactoCacheado | null> {
  const leer = () =>
    db()
      .from("closer_contactos")
      .select("ghl_contact_id, tags, congelado, buzon_resuelto_el, last_message_ghl_at")
      .eq("ghl_contact_id", ghlContactId)
      .maybeSingle<ContactoCacheado>();

  const { data, error } = await leer();
  if (error) throw new Error(`closer_contactos: ${error.message}`);
  if (data) return data;

  // No existe: 1 llamada a GHL para traerlo. Si GHL tampoco lo tiene (id equivocado,
  // contacto borrado), se devuelve null y el caller decide qué reportar.
  const creado = await sincronizarContacto(ghlContactId).catch(() => false);
  if (!creado) return null;

  const reintento = await leer();
  return reintento.data ?? null;
}

/** ¿Perdió `zona_closer`? Congelado = visible pero inerte: ni una llamada más de GHL por él. */
export function estaFueraDeZona(tags: readonly string[]): boolean {
  return !tags.includes(TAGS.zonaCloser.valor);
}

/* ================================================================== */
/* Efectos de un mensaje ENTRANTE                                      */
/* ================================================================== */

/**
 * Lo que un mensaje entrante dispara además de guardarse — extraído del webhook para que
 * la reconciliación produzca EXACTAMENTE los mismos efectos cuando el webhook no existe:
 *
 *  1. `ultimo_entrante_*` del contacto (es lo que el Buzón compara contra
 *     `buzon_resuelto_el` — el "ruteo" es esta actualización más la query).
 *  2. Evento de historial, autor `Sistema`.
 *  3. Cancela la serie automática pendiente (regla de cancelación: perseguir a alguien
 *     que ya contestó es lo que la cancelación evita — WF 02.6 la corta del lado de GHL,
 *     esto la refleja acá).
 *  4. Reabre la tarea del día (§40.D — el revive real).
 *
 * Lo que NO hace: llamar al analizador de Kevin. Eso queda SOLO en el webhook — un
 * analizador colgado de un bucle de 10s convertiría cada ciclo con actividad en una
 * inferencia de ~$0,02, y el doc de esta tarea prohíbe tocar su disparo.
 */
export async function efectosDeEntrante(ghlContactId: string, texto: string, ocurrioEl: string): Promise<void> {
  await db()
    .from("closer_contactos")
    .update({ ultimo_entrante_el: ocurrioEl, ultimo_entrante_texto: texto.slice(0, 500) || null })
    .eq("ghl_contact_id", ghlContactId);

  await registrarEventoSistema(
    ghlContactId,
    "mensaje_entrante",
    texto ? `Escribió: "${texto.slice(0, 120)}"` : "El contacto escribió",
  );

  const ahora = new Date().toISOString();

  await db()
    .from("closer_seguimientos")
    .update({ estado: "cancelado", motivo_cierre: "respondio", cerrado_el: ahora })
    .eq("ghl_contact_id", ghlContactId)
    .eq("estado", "pendiente")
    .eq("modo", "automatico");

  await db()
    .from("closer_contacto_tarea")
    .update({ completada_dia: null, actualizado_el: ahora })
    .eq("ghl_contact_id", ghlContactId);
}

/** Todo evento automático lleva autor `Sistema` y jamás pasa por Avanzar (CLAUDE.md §2). */
export async function registrarEventoSistema(
  ghlContactId: string,
  tipo: string,
  texto: string,
  seguimientoId?: string,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await db().from("closer_contacto_eventos").insert({
    org_id: ORG_ID,
    ghl_contact_id: ghlContactId,
    seguimiento_id: seguimientoId ?? null,
    tipo,
    texto,
    autor_tipo: "sistema",
    autor_nombre: "Sistema",
    payload,
  });
}

/* ================================================================== */
/* Búsqueda de conversaciones (la llamada barata de la reconciliación) */
/* ================================================================== */

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

export interface ConversacionResumen {
  id: string;
  contactId: string;
  /** epoch ms — así lo devuelve el search (verificado 2026-07-31). */
  lastMessageDate: number;
  lastMessageDirection: string | null;
  lastMessageBody: string | null;
}

/**
 * Una página de `GET /conversations/search`, ordenada por último mensaje descendente.
 *
 * Verificado contra la cuenta real (2026-07-31): el parámetro `tags=` SE IGNORA — el
 * search devuelve las ~15.000 conversaciones de la cuenta igual. Por eso la reconciliación
 * NO filtra acá: camina la lista por marca de agua y cruza contra los contactos cacheados,
 * que es O(mensajes nuevos), no O(conversaciones de la cuenta).
 */
export async function paginaDeConversaciones(opts: {
  limit: number;
  startAfterDate?: number;
}): Promise<ConversacionResumen[]> {
  const url = new URL(`${BASE}/conversations/search`);
  url.searchParams.set("locationId", env.ghlLocationId());
  url.searchParams.set("sortBy", "last_message_date");
  url.searchParams.set("sort", "desc");
  url.searchParams.set("limit", String(opts.limit));
  if (opts.startAfterDate) url.searchParams.set("startAfterDate", String(opts.startAfterDate));

  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${env.ghlApiKey()}`, Version: VERSION, Accept: "application/json" },
  });
  if (!r.ok) {
    const cuerpo = await r.text();
    throw new Error(`GHL ${r.status} en GET /conversations/search: ${cuerpo.slice(0, 300)}`);
  }

  const datos = await r.json();
  const crudas = (Array.isArray(datos?.conversations) ? datos.conversations : []) as any[];
  return crudas
    .filter((c) => c?.id && c?.contactId)
    .map((c) => ({
      id: String(c.id),
      contactId: String(c.contactId),
      lastMessageDate: Number(c.lastMessageDate) || 0,
      lastMessageDirection: c.lastMessageDirection ?? null,
      lastMessageBody: c.lastMessageBody ?? null,
    }));
}
