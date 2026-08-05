/**
 * `GET /api/closer/chat?contactId=` — la conversación del contacto, desde la CACHÉ.
 *
 * Reemplaza a `conversacion.ts`, que hacía 2 llamadas a GHL por request — y el ChatTab lo
 * pedía cada 10s con la ficha abierta. Los mensajes ya están en `closer_mensajes` (webhook
 * + reconciliación), así que esto es una query. El shape de cada mensaje es EXACTAMENTE el
 * que el ChatTab ya consume ({id, text, outgoing, type, date, time}).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ZONA_HORARIA_ORG } from "../../src/lib/fechas.js";
import { ventanaWhatsapp } from "../../src/lib/whatsapp.js";
import { env } from "../_lib/env.js";
import { db } from "../_lib/repo.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  const contactId = String(req.query.contactId ?? "");
  if (!contactId) return res.status(400).json({ ok: false, error: "Falta contactId." });

  try {
    const { data, error } = await db()
      .from("closer_mensajes")
      .select("id, conversation_id, direccion, body, timestamp_ghl, estado, error_envio")
      .eq("ghl_contact_id", contactId)
      .order("timestamp_ghl", { ascending: true })
      .limit(200);
    if (error) throw new Error(`closer_mensajes: ${error.message}`);

    const messages = (data ?? []).map((m) => {
      const d = new Date(m.timestamp_ghl);
      return {
        id: m.id,
        text: m.body,
        outgoing: m.direccion === "outbound",
        type: "whatsapp",
        date: new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA_ORG }).format(d),
        time: new Intl.DateTimeFormat("es-PE", {
          timeZone: ZONA_HORARIA_ORG,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(d),
        /**
         * El estado de entrega REAL, no el de la respuesta del POST. Un saliente puede
         * figurar como enviado y estar `failed` diez minutos después, cuando Meta lo
         * rechaza — es el bug del 2026-08-05 (§55).
         */
        estado: (m.estado as string | null) ?? null,
        errorEnvio: (m.error_envio as string | null) ?? null,
      };
    });

    /**
     * La ventana de 24 h, para que el compositor sepa si puede escribir.
     *
     * Va en la misma respuesta que ya se pide cada 5 s con la ficha abierta: un endpoint
     * aparte habría duplicado el reloj para un dato que se deriva de una columna que este
     * request ya podría estar leyendo.
     */
    const { data: contacto } = await db()
      .from("closer_contactos")
      .select("ultimo_entrante_el")
      .eq("ghl_contact_id", contactId)
      .maybeSingle();

    return res.status(200).json({
      ok: true,
      conversationId: data?.[0]?.conversation_id ?? null,
      ghlModo: env.ghlModo(),
      fuente: "cache",
      count: messages.length,
      ventana: ventanaWhatsapp(contacto?.ultimo_entrante_el as string | null | undefined),
      messages,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
