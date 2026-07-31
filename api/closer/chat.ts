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
import { ghl } from "../_lib/ghl/index.js";
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
      .select("id, conversation_id, direccion, body, timestamp_ghl")
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
      };
    });

    return res.status(200).json({
      ok: true,
      conversationId: data?.[0]?.conversation_id ?? null,
      ghlModo: ghl().modo,
      fuente: "cache",
      count: messages.length,
      messages,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
