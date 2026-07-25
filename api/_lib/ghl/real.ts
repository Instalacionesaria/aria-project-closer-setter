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

  async escribirCampo({ ghlContactId, campo, valor }: CampoInput) {
    // El PUT de contacto acepta `customFields` por `key` (la unique key del contrato) o
    // por `id`. Usamos la key, que es lo que documenta CONTRATO-GHL.md §4.
    return aResultado(
      await llamar("PUT", `/contacts/${ghlContactId}`, {
        customFields: [{ key: campo, field_value: valor }],
      }),
    );
  },

  async obtenerContacto(ghlContactId: string): Promise<ContactoGhl | null> {
    const r = await llamar("GET", `/contacts/${ghlContactId}`);
    if (!r.ok) return null;

    const c = r.datos?.contact ?? r.datos;
    if (!c?.id) return null;

    const customFields: Record<string, string> = {};
    for (const f of c.customFields ?? []) {
      const clave = f.key ?? f.id;
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
