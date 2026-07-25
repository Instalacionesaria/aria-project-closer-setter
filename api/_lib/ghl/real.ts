/**
 * Adapter real contra la API v2 de GoHighLevel (`services.leadconnectorhq.com`).
 *
 * Autenticación: Private Integration Token (`pit-...`) en el header `Authorization`, más
 * el header `Version` con la fecha del contrato de la API — GHL versiona así, y omitirlo
 * devuelve errores poco descriptivos.
 *
 * Ninguna llamada arma un literal a mano: los nombres de tags y custom fields vienen de
 * `src/lib/ghl/contrato.ts`, y `assertEnviable()` corta antes de salir si alguno no está
 * confirmado.
 */

import { env } from "../env";
import type { CampoInput, ContactoGhl, GhlPort, ResultadoGhl, TagsInput } from "./port";

const BASE = "https://services.leadconnectorhq.com";
/** Versión del contrato de la API v2. GHL la exige en cada request. */
const VERSION = "2021-07-28";

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.ghlApiKey()}`,
    Version: VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** 429 y 5xx se reintentan; 4xx son errores nuestros y no tiene sentido repetirlos. */
const esReintentable = (status: number) => status === 429 || status >= 500;

async function llamar(
  metodo: string,
  ruta: string,
  body?: unknown,
): Promise<{ ok: true; datos: any } | { ok: false; error: string; status: number }> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      method: metodo,
      headers: headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    // Fallo de red: no hubo status, así que se trata como reintentable.
    return { ok: false, error: `Red: ${(e as Error).message}`, status: 0 };
  }

  const texto = await respuesta.text();
  if (!respuesta.ok) {
    return { ok: false, error: texto.slice(0, 500) || respuesta.statusText, status: respuesta.status };
  }
  try {
    return { ok: true, datos: texto ? JSON.parse(texto) : {} };
  } catch {
    return { ok: true, datos: {} };
  }
}

/* ================================================================== */
/* Catálogo de custom fields                                          */
/* ================================================================== */

/**
 * Los custom fields se escriben por id, pero el resto del código habla en las unique keys
 * del contrato. Este catálogo traduce en ambos sentidos.
 *
 * Se cachea por proceso: en una función serverless dura lo que dura la instancia caliente,
 * que es exactamente la vida útil que queremos — sin invalidación que mantener, y como
 * mucho una llamada extra por arranque en frío.
 */
let cacheCampos: { claveAId: Map<string, string>; idAClave: Map<string, string> } | null = null;

/** GHL a veces devuelve la key con prefijo `contact.` y a veces sin él. */
const normalizar = (k: string) => k.replace(/^contact\./, "").toLowerCase();

async function catalogoCampos() {
  if (cacheCampos) return cacheCampos;

  const r = await llamar("GET", `/locations/${env.ghlLocationId()}/customFields`);
  const claveAId = new Map<string, string>();
  const idAClave = new Map<string, string>();

  if (r.ok) {
    for (const f of r.datos?.customFields ?? []) {
      const clave = f.fieldKey ?? f.key;
      if (!clave || !f.id) continue;
      claveAId.set(normalizar(clave), f.id);
      idAClave.set(f.id, clave);
    }
    // Solo se cachea un catálogo que se pudo leer. Cachear el vacío convertiría un fallo de
    // red pasajero en un "el campo no existe" permanente hasta el próximo arranque.
    cacheCampos = { claveAId, idAClave };
  }

  return { claveAId, idAClave };
}

const idDeCampo = async (clave: string) => (await catalogoCampos()).claveAId.get(normalizar(clave));
const mapaIdAClave = async () => (await catalogoCampos()).idAClave;

const aResultado = (r: Awaited<ReturnType<typeof llamar>>): ResultadoGhl =>
  r.ok
    ? { ok: true, aplicado: true, detalle: r.datos }
    : { ok: false, error: r.error, status: r.status, reintentable: r.status === 0 || esReintentable(r.status) };

export const ghlReal: GhlPort = {
  modo: "real",

  async aplicarTags({ ghlContactId, tags }: TagsInput) {
    if (tags.length === 0) return { ok: true, aplicado: false };
    return aResultado(await llamar("POST", `/contacts/${ghlContactId}/tags`, { tags }));
  },

  async removerTags({ ghlContactId, tags }: TagsInput) {
    if (tags.length === 0) return { ok: true, aplicado: false };
    // GHL acepta el cuerpo en el DELETE de tags. No es lo más ortodoxo, pero es su contrato.
    return aResultado(await llamar("DELETE", `/contacts/${ghlContactId}/tags`, { tags }));
  },

  /**
   * ⚠️ El PUT de contacto **exige el id** del custom field. Mandarlo por `key` —que es como
   * lo documenta CONTRATO-GHL.md §4 y como parecía natural— devuelve **200 y no escribe
   * nada**. Comprobado el 2026-07-25 con las tres variantes sobre un contacto desechable:
   * `{key, field_value}` → 200 y el campo vacío; `{id, field_value}` → escribe; `{id, value}`
   * → escribe.
   *
   * Es justo el fallo silencioso que hace peligrosa esta integración: sin verificar
   * leyendo, el sistema habría reportado "situación guardada" durante meses.
   */
  async escribirCampo({ ghlContactId, campo, valor }: CampoInput) {
    const id = await idDeCampo(campo);
    if (!id) {
      return {
        ok: false,
        reintentable: false,
        error: `El custom field "${campo}" no existe en la location. Sin su id, GHL acepta el PUT y no escribe nada.`,
      };
    }

    const r = await llamar("PUT", `/contacts/${ghlContactId}`, {
      customFields: [{ id, field_value: valor }],
    });
    return aResultado(r);
  },

  async obtenerContacto(ghlContactId: string): Promise<ContactoGhl | null> {
    const r = await llamar("GET", `/contacts/${ghlContactId}`);
    if (!r.ok) return null;

    const c = r.datos?.contact ?? r.datos;
    if (!c?.id) return null;

    // Al leer, GHL devuelve `{ id, value }` — sin la key. Se traduce de vuelta para que el
    // resto del código siga hablando en las unique keys del contrato y no en ids opacos.
    const porId = await mapaIdAClave();
    const customFields: Record<string, string> = {};
    for (const f of c.customFields ?? []) {
      const clave = porId.get(f.id) ?? f.key ?? f.id;
      if (clave) customFields[clave] = f.field_value ?? f.value ?? "";
    }

    return {
      id: c.id,
      nombre: c.contactName ?? [c.firstName, c.lastName].filter(Boolean).join(" ") ?? "",
      telefono: c.phone ?? undefined,
      email: c.email ?? undefined,
      tags: c.tags ?? [],
      customFields,
    };
  },

  async verificarConexion() {
    const locationId = env.ghlLocationId();

    const tagsR = await llamar("GET", `/locations/${locationId}/tags`);
    if (!tagsR.ok) return { ok: false, error: tagsR.error, status: tagsR.status };

    const camposR = await llamar("GET", `/locations/${locationId}/customFields`);
    if (!camposR.ok) return { ok: false, error: camposR.error, status: camposR.status };

    return {
      ok: true,
      locationId,
      tags: (tagsR.datos?.tags ?? []).map((t: any) => t.name ?? t).filter(Boolean),
      customFields: (camposR.datos?.customFields ?? [])
        .map((f: any) => f.fieldKey ?? f.key ?? f.name)
        .filter(Boolean),
    };
  },
};
