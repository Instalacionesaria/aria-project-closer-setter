/**
 * `POST /api/webhooks/llamada?token=…` — las llamadas de los agentes de voz, desde Assistable.
 *
 * Es la fuente que faltaba para los dos auditores de VOZ (§53.4): hasta hoy GHL no exponía
 * las llamadas ni sus transcripciones y no había de dónde sacarlas.
 *
 * ## Por qué el secreto va en la URL y no en un header
 *
 * Assistable solo ofrece **un campo de URL**: no deja configurar headers. Es peor que un
 * header —una URL se copia, se pega en un chat, queda en logs de proxies— así que el diseño
 * compensa por el lado del daño posible, no por el de la probabilidad:
 *
 *   1. **Token PROPIO** (`LLAMADAS_TOKEN`), distinto de `WEBHOOK_SECRET`. Ese otro protege
 *      un endpoint que aplica tags, escribe notas en GHL y dispara al auditor (dinero real).
 *      Si esta URL se filtra, no puede tocar nada de eso.
 *   2. **El endpoint es INERTE.** Guarda el cuerpo crudo y responde 200. No llama a GHL, no
 *      llama al modelo, no escribe en ninguna otra tabla, no dispara ningún efecto. El peor
 *      caso de un token filtrado es que alguien meta filas de basura en la bandeja.
 *   3. Rotar es cambiar una variable de entorno y volver a pegar la URL en Assistable.
 *
 * ## Por qué guarda crudo y no interpreta
 *
 * Todavía no sabemos si la transcripción viene en este payload o hay que pedirla aparte con
 * el `call_id`. Guardar el cuerpo entero desde el día uno deja que los datos reales decidan
 * el esquema, en vez de inventar columnas y descubrir después que faltaba la mitad. Cuando
 * haya unos cuantos payloads, se diseña la tabla mirándolos.
 *
 * Mismo principio que `api/webhooks/ghl.ts`: nada se procesa sin guardarse primero.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "../_lib/repo.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * Un GET sin token responde que está vivo, y nada más. Es para poder pegar la URL en el
   * navegador y confirmar que el deploy llegó, sin tener que armar un curl — el momento en
   * que más se necesita es justo cuando se está configurando Assistable.
   */
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, listo: true, endpoint: "webhooks/llamada", metodo: "POST" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ ok: false, error: "Solo POST." });
  }

  const esperado = process.env.LLAMADAS_TOKEN;
  if (!esperado) {
    // Falla cerrado, igual que el webhook de GHL: sin token configurado no se acepta nada.
    // 503 y no 401 porque el problema es configuración nuestra, no la credencial del que llama.
    console.error("[llamada] LLAMADAS_TOKEN sin configurar: se rechaza todo hasta que exista.");
    return res.status(503).json({ ok: false, error: "LLAMADAS_TOKEN sin configurar en el servidor." });
  }

  const token = String(req.query.token ?? "");
  if (token !== esperado) {
    return res.status(401).json({ ok: false, error: "Token inválido." });
  }

  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  if (!cuerpo) return res.status(400).json({ ok: false, error: "Cuerpo JSON inválido." });

  /**
   * `call_id` como clave de idempotencia: si Assistable reintenta la misma llamada, el índice
   * único de la bandeja lo corta acá y no quedan dos filas del mismo evento. Sin `call_id`
   * se cae a la hora de llegada, que sacrifica la dedupe pero nunca pierde el payload.
   */
  const callId = String(cuerpo.call_id ?? cuerpo.callId ?? "");
  const externalId = callId ? `assistable:${callId}` : `assistable:sin-id:${Date.now()}`;

  const { error } = await db()
    .from("closer_webhook_inbox")
    .insert({ proveedor: "assistable", external_id: externalId, payload: cuerpo });

  // 23505 = clave duplicada: ya lo recibimos. Es éxito, no error.
  if (error?.code === "23505") {
    return res.status(200).json({ ok: true, duplicado: true, callId: callId || null });
  }
  if (error) {
    // El único caso donde conviene que Assistable reintente: no llegamos a guardar nada.
    return res.status(500).json({ ok: false, error: `inbox: ${error.message}` });
  }

  return res.status(200).json({
    ok: true,
    guardado: true,
    callId: callId || null,
    contactId: String(cuerpo.contact_id ?? cuerpo.contactId ?? "") || null,
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
