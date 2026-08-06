/**
 * `GET  /api/closer/plantillas` — las plantillas aprobadas que se pueden mandar.
 * `POST /api/closer/plantillas` — mandar una a un contacto.
 *
 * Es la salida a la ventana de 24 h que la 015 enseñó a detectar: pasadas las 24 h desde el
 * último mensaje del contacto, Meta solo deja mandar una plantilla previamente aprobada.
 *
 * ── Por qué la lista no se pide a GHL ──
 *
 * Porque no se puede, y está medido el 2026-08-06 contra la subcuenta real, que **sí tiene
 * plantillas aprobadas**:
 *
 *   GET /locations/{id}/templates?type=whatsapp     → 200 {"templates":[],"totalCount":0}
 *   GET /conversations/providers/whatsapp/templates → 404
 *   GET /locations/{id}/whatsapp/templates          → 404
 *   GET /whatsapp/templates                         → 404
 *
 * El primero responde 200 con cero porque su schema de respuesta es `oneOf: [SMS, Email]`:
 * una plantilla de Meta no es representable ahí. Viven en Settings > WhatsApp > Templates,
 * otro almacén, y la API v2 no lo expone. No falta un scope — no hay ruta. Así que la lista
 * se configura en `closer_plantillas` (017) y esto la lee.
 *
 * ── Dos métodos, porque hay dos caminos ──
 *
 * `template_id` usa el campo `templateId` de `POST /conversations/messages`, que existe en la
 * spec pero **no acepta variables**. `workflow` dispara un workflow de GHL que contiene la
 * acción de enviar la plantilla: es el camino documentado y el único que soporta variables.
 * Cuál sirve para cada plantilla se decide probando una real; el código soporta los dos para
 * que la respuesta no exija reescribir nada.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../_lib/env.js";
import { guardarMensajes } from "../_lib/ingesta.js";
import { db } from "../_lib/repo.js";

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

interface Plantilla {
  id: string;
  nombre: string;
  descripcion: string | null;
  metodo: "template_id" | "workflow";
  template_id: string | null;
  workflow_id: string | null;
  idioma: string | null;
  cuerpo: string;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return listar(res);
  if (req.method === "POST") return enviar(req, res);
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Usá GET o POST." });
}

/* ─────────────────────────────── Listar ─────────────────────────────── */

async function listar(res: VercelResponse) {
  const { data, error } = await db()
    .from("closer_plantillas")
    .select("id, nombre, descripcion, metodo, template_id, workflow_id, idioma, cuerpo")
    .eq("activa", true)
    .order("orden", { ascending: true })
    .order("nombre", { ascending: true });

  // Falla explícita: un `[]` acá significaría "no hay plantillas cargadas", que es otro hecho
  // (regla 2) y llevaría al closer a pedirle a alguien que cargue las que ya están.
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const plantillas = (data ?? []) as Plantilla[];

  return res.status(200).json({
    ok: true,
    count: plantillas.length,
    // `template_id` y `workflow_id` NO viajan al browser: son identificadores de la cuenta de
    // GHL y el cliente no los necesita — manda el `id` nuestro y el servidor resuelve el resto.
    plantillas: plantillas.map((p) => ({
      id: p.id,
      nombre: p.nombre,
      descripcion: p.descripcion,
      idioma: p.idioma,
      cuerpo: p.cuerpo,
    })),
  });
}

/* ─────────────────────────────── Enviar ─────────────────────────────── */

async function enviar(req: VercelRequest, res: VercelResponse) {
  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  const contactId = String(cuerpo?.contactId ?? "").trim();
  const plantillaId = String(cuerpo?.plantillaId ?? "").trim();

  if (!contactId) return res.status(400).json({ ok: false, error: "Falta contactId." });
  if (!plantillaId) return res.status(400).json({ ok: false, error: "Falta plantillaId." });

  if (env.ghlModo() === "stub") {
    return res.status(200).json({ ok: true, enviado: false, motivo: "Modo stub: la plantilla no salió a ningún lado." });
  }

  const { data, error } = await db()
    .from("closer_plantillas")
    .select("id, nombre, descripcion, metodo, template_id, workflow_id, idioma, cuerpo")
    .eq("id", plantillaId)
    .eq("activa", true)
    .maybeSingle();

  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) {
    return res.status(404).json({
      ok: false,
      codigo: "plantilla_desconocida",
      error: "Esa plantilla no existe o está desactivada.",
    });
  }
  const plantilla = data as Plantilla;

  /**
   * Congelado (§7): el contacto perdió `zona_closer` y hacia GHL es inerte. Mismo corte que
   * en `mensajes.ts` — pero **sin** el re-chequeo contra GHL que hace aquel. Allá vale la
   * llamada extra porque el closer está escribiendo en vivo y una caché vieja le bloquearía
   * la conversación; acá mandar una plantilla es una acción deliberada y puntual, y gastar
   * una llamada a GHL en cada intento para cubrir una caché de segundos no se paga.
   */
  const { data: contacto } = await db()
    .from("closer_contactos")
    .select("congelado")
    .eq("ghl_contact_id", contactId)
    .maybeSingle();
  if (contacto?.congelado) {
    return res.status(409).json({
      ok: false,
      codigo: "congelado",
      error: "El contacto no tiene zona_closer en GHL: no se le envían mensajes desde acá (§7).",
    });
  }

  /**
   * NO se corta por la ventana de 24 h, al revés que `mensajes.ts`. Es justo al revés:
   * una plantilla aprobada es lo ÚNICO que Meta deja pasar cuando la ventana está cerrada,
   * así que este endpoint existe para ese momento. Con la ventana abierta también funciona
   * —solo que ahí conviene escribir a mano— y bloquearlo sería inventar una regla que Meta
   * no tiene.
   */

  try {
    return plantilla.metodo === "workflow"
      ? await porWorkflow(res, contactId, plantilla)
      : await porTemplateId(res, contactId, plantilla);
  } catch (e) {
    return res.status(502).json({ ok: false, error: (e as Error).message });
  }
}

/**
 * Camino 1: `POST /conversations/messages` con `templateId`.
 *
 * Devuelve un `messageId` real, así que el saliente se puede cachear al toque y aparece en el
 * chat sin esperar al tick — igual que un mensaje escrito a mano.
 */
async function porTemplateId(res: VercelResponse, contactId: string, plantilla: Plantilla) {
  const r = await fetch(`${BASE}/conversations/messages`, {
    method: "POST",
    headers: cabeceras(),
    body: JSON.stringify({ type: "WhatsApp", contactId, templateId: plantilla.template_id }),
  });

  if (!r.ok) {
    const detalle = await r.text();
    // El error de GHL viaja entero y sin traducir: si el campo `templateId` no acepta una
    // plantilla de Meta, lo que diga acá es exactamente el dato que decide el otro camino.
    return res.status(502).json({
      ok: false,
      codigo: "ghl_rechazo",
      error: `GHL ${r.status}: ${detalle.slice(0, 400)}`,
      metodo: "template_id",
    });
  }

  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const messageId = String(datos?.messageId ?? datos?.id ?? "") || `out:${contactId}:${Date.now()}`;
  const ahora = new Date().toISOString();

  await guardarMensajes([
    {
      id: messageId,
      ghlContactId: contactId,
      conversationId: String(datos?.conversationId ?? "") || null,
      direccion: "outbound",
      // Se guarda el CUERPO de la plantilla, que es lo que el contacto va a leer. El id de
      // Meta en el chat no le diría nada a nadie.
      body: plantilla.cuerpo,
      timestampGhl: ahora,
      /**
       * `workflow`, no `asesor` ni `agente_ia`. Lo eligió un humano pero no lo escribió: el
       * texto es una plantilla. Importa para el auditor — con `agente_ia` juzgaría al agente
       * por un texto que aprobó Meta y encima le correría el debounce; con `asesor` le
       * atribuiría al closer una redacción que no es suya.
       */
      autor: "workflow",
      // GHL aceptó, Meta todavía no entregó. El veredicto lo escribe la reconciliación.
      estado: "pending",
    },
  ]);

  await db()
    .from("closer_contactos")
    // `ultimo_entrante_el` NO se toca: mandar una plantilla no reabre la ventana de 24 h.
    // Solo la reabre un mensaje DEL contacto, y confundirlo dejaría al closer escribiendo
    // libre contra una ventana que sigue cerrada.
    .update({ ultimo_saliente_el: ahora, last_message_ghl_at: ahora })
    .eq("ghl_contact_id", contactId);

  return res.status(200).json({ ok: true, enviado: true, metodo: "template_id", messageId, plantilla: plantilla.nombre });
}

/**
 * Camino 2: disparar el workflow de GHL que adentro manda la plantilla.
 *
 * Acá GHL responde "el contacto entró al workflow", no "el mensaje salió": lo que pase
 * después ocurre dentro de GHL y nosotros nos enteramos por la reconciliación. Por eso la
 * respuesta dice `encolado` y no `enviado` — dar por enviado algo que todavía no salió es el
 * bug que arregló la 015, y repetirlo acá sería gratuito.
 */
async function porWorkflow(res: VercelResponse, contactId: string, plantilla: Plantilla) {
  const r = await fetch(`${BASE}/contacts/${encodeURIComponent(contactId)}/workflow/${encodeURIComponent(plantilla.workflow_id!)}`, {
    method: "POST",
    headers: cabeceras(),
    body: JSON.stringify({ eventStartTime: new Date().toISOString() }),
  });

  if (!r.ok) {
    const detalle = await r.text();
    return res.status(502).json({
      ok: false,
      codigo: "ghl_rechazo",
      error: `GHL ${r.status}: ${detalle.slice(0, 400)}`,
      metodo: "workflow",
    });
  }

  return res.status(200).json({
    ok: true,
    enviado: false,
    encolado: true,
    metodo: "workflow",
    plantilla: plantilla.nombre,
    aviso: "El contacto entró al workflow de GHL. El mensaje va a aparecer en el chat cuando la reconciliación lo traiga.",
  });
}

function cabeceras(): Record<string, string> {
  return {
    Authorization: `Bearer ${env.ghlApiKey()}`,
    Version: VERSION,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
