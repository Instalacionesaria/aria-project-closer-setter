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

/**
 * Cuánto se apartan la hora REAL de un mensaje (la de GHL, que trae la reconciliación) y la
 * de llegada de su webhook. Observado: entre 2 y 46 segundos. 10 minutos deja margen de
 * sobra para una entrega lenta sin llegar a confundir dos mensajes distintos.
 */
const VENTANA_GEMELO_MS = 10 * 60_000;

const esFabricado = (id: string) => id.startsWith("wh:");

/** ¿Son el mismo mensaje visto por las dos vías? Mismo texto y dirección, con las horas casi pegadas. */
const mismoMensaje = (a: MensajeNormalizado, b: { direccion: string; body: string; timestamp_ghl: string }) =>
  a.direccion === b.direccion &&
  a.body === b.body &&
  Math.abs(Date.parse(a.timestampGhl) - Date.parse(b.timestamp_ghl)) <= VENTANA_GEMELO_MS;

/**
 * Las filas de una vía para los contactos del lote, en UNA query.
 *
 * Se resuelve con una sola consulta por lote (no una por mensaje) porque esto corre en el
 * camino caliente: la reconciliación llama a `guardarMensajes` cada 10 segundos y un
 * contacto activo puede traer decenas de mensajes. El filtro fino se hace en memoria.
 */
async function filasDeLaOtraVia(contactIds: string[], via: "fabricados" | "reales") {
  let q = db().from("closer_mensajes").select("id, direccion, body, timestamp_ghl").in("ghl_contact_id", contactIds);
  q = via === "fabricados" ? q.like("id", "wh:%") : q.not("id", "like", "wh:%");

  const { data } = await q;
  return (data ?? []) as { id: string; direccion: string; body: string; timestamp_ghl: string }[];
}

/**
 * Upsert idempotente del lote. Devuelve cuántos eran genuinamente nuevos.
 *
 * ## Por qué la primary key no alcanza (bug encontrado el 2026-08-04)
 *
 * §51.2 dice que el dedupe entre webhook y reconciliación ES la primary key: las dos vías
 * traen el `messageId` de GHL y el segundo no duplica. Con los webhooks reales resultó
 * falso: **el webhook estándar (gratis) de GHL no manda `messageId`**, así que el webhook
 * fabrica un `wh:...` y la reconciliación guarda el mismo mensaje con su id verdadero — dos
 * filas, un solo mensaje. Los 4 entrantes de la prueba de Fabio quedaron duplicados.
 *
 * La regla acá es asimétrica a propósito, y solo cruza fabricado↔real (nunca real↔real, que
 * son mensajes legítimamente distintos aunque digan lo mismo):
 *
 *   - Un fabricado NO se inserta si su mensaje real ya está.
 *   - Un real, al insertarse, BORRA los fabricados equivalentes.
 *
 * Así, en cualquier orden de llegada, queda exactamente una fila — y con la hora buena, que
 * es la del real. Si la reconciliación nunca corre (nadie abrió la app), el fabricado se
 * queda: mejor el mensaje con su hora aproximada que ningún mensaje.
 */
export async function guardarMensajes(mensajes: MensajeNormalizado[]): Promise<number> {
  if (mensajes.length === 0) return 0;

  const contactos = [...new Set(mensajes.map((m) => m.ghlContactId))];

  // Un fabricado (webhook) no entra si su mensaje real ya está. Solo se consulta cuando el
  // lote trae alguno — la reconciliación, que manda ids reales, se saltea esta query entera.
  let aInsertar = mensajes;
  if (mensajes.some((m) => esFabricado(m.id))) {
    const reales = await filasDeLaOtraVia(contactos, "reales");
    aInsertar = mensajes.filter((m) => !esFabricado(m.id) || !reales.some((r) => mismoMensaje(m, r)));
  }
  if (aInsertar.length === 0) return 0;

  // `ignoreDuplicates` + `count` es lo que permite saber cuántos NO estaban: la
  // reconciliación usa ese número para decidir si hay que disparar efectos de entrante.
  const { data, error } = await db()
    .from("closer_mensajes")
    .upsert(
      aInsertar.map((m) => ({
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

  /**
   * Los reales acaban de entrar: se limpian las copias que hubiera dejado el webhook.
   *
   * Una sola query de lectura por lote, y casi siempre vuelve vacía (los fabricados solo
   * viven el rato que va del webhook a la reconciliación siguiente), así que el DELETE ni
   * se ejecuta. Sin esto, el camino caliente pagaría una consulta por mensaje cada 10s.
   */
  const nuevosReales = aInsertar.filter((m) => !esFabricado(m.id));
  if (nuevosReales.length > 0) {
    const fabricados = await filasDeLaOtraVia(contactos, "fabricados");
    const sobran = fabricados.filter((f) => nuevosReales.some((m) => mismoMensaje(m, f))).map((f) => f.id);
    if (sobran.length > 0) await db().from("closer_mensajes").delete().in("id", sobran);
  }

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
  /**
   * `ultimo_entrante_el` solo AVANZA, nunca retrocede.
   *
   * Las dos vías escriben el mismo mensaje y la que llega segunda pisaba la marca con su
   * propia hora: un webhook que aterrizaba después de la reconciliación la movía hacia
   * atrás. Y esa marca decide el Buzón General (§51.3 — "último entrante posterior a
   * `buzon_resuelto_el`"), así que retroceder puede hacer desaparecer de la cola a alguien
   * que sí escribió. El resto de los efectos (evento, cancelar serie, reabrir tarea) sí se
   * ejecutan igual: son idempotentes.
   */
  const { data: previo } = await db()
    .from("closer_contactos")
    .select("ultimo_entrante_el")
    .eq("ghl_contact_id", ghlContactId)
    .maybeSingle();

  const anterior = previo?.ultimo_entrante_el ? Date.parse(previo.ultimo_entrante_el as string) : 0;
  const nuevo = Date.parse(ocurrioEl);

  if (Number.isNaN(nuevo) || nuevo >= anterior) {
    await db()
      .from("closer_contactos")
      .update({ ultimo_entrante_el: ocurrioEl, ultimo_entrante_texto: texto.slice(0, 500) || null })
      .eq("ghl_contact_id", ghlContactId);
  }

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
