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
import {
  CAMPOS_PERFIL_ORDENADOS,
  type FormularioPerfil,
  type GrupoPerfil,
} from "../../../src/lib/ghl/contrato.js";
import type { ContactoGhl } from "./port.js";

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

/* ================================================================== */
/* Perfil                                                              */
/* ================================================================== */

/**
 * Un campo ya listo para el tab Perfil. Es la forma que espera `PerfilTab` (`PerfilField` de
 * `src/lib/closerStore.tsx`); se redeclara acá en vez de importarse porque aquel módulo es un
 * componente de React y esto corre en una función serverless.
 */
export interface CampoPerfilLeido {
  label: string;
  value: string;
  group: GrupoPerfil;
  /** Solo cuando `group === "calificacion"`: decide el bloque "Form VSL" / "Form Meta". */
  formulario?: FormularioPerfil;
  procedencia?: string;
}

/**
 * Misma normalización que `normalizar` en `real.ts` (no se importa: es privada de ese módulo,
 * y este frente no lo toca). GHL devuelve la unique key a veces con el prefijo `contact.` y a
 * veces sin él, según por dónde entre el dato — comparar los strings crudos hace que la mitad
 * de los campos "no existan" y el Perfil salga vacío sin que nada falle.
 *
 * Una diferencia deliberada con `real.ts`: allá se quita el prefijo ANTES de bajar a
 * minúsculas, así que un `Contact.` con mayúscula sobrevive y la clave deja de matchear.
 * Acá se baja primero, con lo que la insensibilidad a mayúsculas alcanza también al prefijo.
 * Es más barato que depender de que GHL nunca cambie la caja del prefijo.
 */
export const normalizarClave = (k: string) => k.toLowerCase().replace(/^contact\./, "");

/**
 * El valor de un custom field llega tipado como `string`, pero GHL manda números para los
 * numéricos y arrays para los de selección múltiple. Un `.trim()` sobre un número revienta en
 * runtime, en medio de una lectura que debería ser inofensiva.
 */
function aTexto(valor: unknown): string {
  if (valor === null || valor === undefined) return "";
  if (Array.isArray(valor)) return valor.map(aTexto).filter(Boolean).join(", ");
  return String(valor).trim();
}

/**
 * UN custom field del contacto, buscado con la misma normalización que usa el Perfil.
 *
 * Existe porque `api/_lib/contactos.ts` tenía su propio lector (`cf[clave] ?? cf[sin prefijo]`)
 * que era **case-sensitive**: un `Contact.Nivel_De_Inters_Seguimiento` no matcheaba y la
 * subcategoría se guardaba en null sin que nada fallara. Dos parsers distintos sobre el mismo
 * payload es la clase de bug que no se ve hasta que alguien compara dos pantallas.
 *
 * Devuelve `null` para el campo vacío — misma regla que el Perfil: "existe la clave" y "hay
 * un dato" son lo mismo.
 */
export function leerCampo(contacto: ContactoGhl, literal: string): string | null {
  const buscada = normalizarClave(literal);
  for (const [clave, valor] of Object.entries(contacto.customFields ?? {})) {
    if (normalizarClave(clave) !== buscada) continue;
    return aTexto(valor) || null;
  }
  return null;
}

/** El mismo campo, leído como entero. `null` si no está o si no es un número (nunca `0`). */
export function leerEntero(contacto: ContactoGhl, literal: string): number | null {
  const texto = leerCampo(contacto, literal);
  if (texto === null) return null;
  const n = Number.parseInt(texto, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Traduce un contacto de GHL a los campos del tab Perfil.
 *
 * ── La regla que manda acá es la §4.10 ──
 *
 * Un campo sin valor NO se incluye. Nunca un guion, nunca un "Sin datos", nunca la etiqueta
 * sola: el front pinta lo que le llega como si fuera verdad, así que un placeholder que viaja
 * en la respuesta es indistinguible de un dato real. La ausencia también es informativa —
 * `PerfilTab` ya sabe qué hacer con ella (los bloques Form VSL / Form Meta muestran "Sin datos
 * de este formulario", y un grupo entero sin campos directamente no se renderiza).
 *
 * ── Tres orígenes distintos, no uno ──
 *
 * 1. **Detalles**: teléfono y correo son campos NATIVOS del contacto, no custom fields — por
 *    eso no están en `CAMPOS_PERFIL` y se leen directo.
 * 2. **Origen**: la fuente se deriva de los tags, igual que el chip de la fila (§8).
 * 3. **Calificación e Interacciones**: los custom fields declarados en el contrato.
 *
 * ── Por qué "DIRECTO" no se emite ──
 *
 * `derivarFuente` devuelve `DIRECTO` cuando ningún tag identifica el origen. Como chip de fila
 * eso es correcto y está en el contrato (§8: "ninguna fila sin origen"), pero como campo del
 * Perfil sería afirmar que el lead entró de forma directa cuando lo cierto es que no sabemos
 * de dónde vino. Es exactamente el placeholder que la §4.10 pide omitir, así que se omite.
 *
 * El orden de salida es: detalles → origen → calificación (VSL y después Meta) →
 * interacciones, siguiendo el orden de declaración de `CAMPOS_PERFIL`. `PerfilTab` filtra por
 * grupo, así que lo único que importa es el orden DENTRO de cada grupo.
 */
export function perfilDesdeContacto(contacto: ContactoGhl): CampoPerfilLeido[] {
  // Se indexa una vez y ya normalizado, para no repetir el reemplazo por cada campo buscado.
  // Los vacíos se descartan acá: así "existe la clave" y "hay un dato" son lo mismo más abajo.
  const porClave = new Map<string, string>();
  for (const [clave, valor] of Object.entries(contacto.customFields ?? {})) {
    const texto = aTexto(valor);
    if (texto) porClave.set(normalizarClave(clave), texto);
  }

  const campos: CampoPerfilLeido[] = [];

  const telefono = aTexto(contacto.telefono);
  if (telefono) campos.push({ label: "Teléfono", value: telefono, group: "detalles" });

  const email = aTexto(contacto.email);
  if (email) campos.push({ label: "Correo", value: email, group: "detalles" });

  const fuente = derivarFuente(contacto.tags ?? []);
  if (fuente !== "DIRECTO") campos.push({ label: "Fuente", value: fuente, group: "origen" });

  for (const campo of CAMPOS_PERFIL_ORDENADOS) {
    const valor = porClave.get(normalizarClave(campo.valor));
    if (!valor) continue;

    campos.push({
      label: campo.etiqueta,
      value: valor,
      group: campo.grupo,
      // Las opcionales se agregan solo si existen: `formulario: undefined` viaja como clave
      // presente en el JSON de algunos serializadores y confunde el filtro por formulario.
      ...(campo.formulario ? { formulario: campo.formulario } : {}),
      ...(campo.procedencia ? { procedencia: campo.procedencia } : {}),
    });
  }

  return campos;
}
