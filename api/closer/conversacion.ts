/**
 * `GET /api/closer/conversacion?contactId=...` — el chat real del contacto, desde GHL.
 *
 * Resuelve el límite estructural que CLAUDE.md §32.D dejó anotado: hasta ahora TODOS los
 * contactos compartían el mismo array `SEED_MESSAGES` hardcodeado, así que la ficha mostraba
 * la misma conversación para cualquiera. Con `ghlContactId` presente, el tab Chat lee la
 * conversación de verdad; sin él (contactos de la semilla demo) sigue con la de siempre.
 *
 * Se excluyen los `TYPE_ACTIVITY_*`: son eventos del sistema, no mensajes que alguien
 * escribió. Y se invierte el orden, porque GHL devuelve del más reciente al más antiguo y un
 * chat se lee al revés.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ZONA_HORARIA_ORG } from "../../src/lib/fechas.js";
import { ghl } from "../_lib/ghl/index.js";
import { conversacionDeContacto, esMensajeDeChat, mensajesDeConversacion } from "../_lib/ghl/lectura.js";

/** "10:05 AM" en la zona de la organización. Sin fecha válida, string vacío (la UI no lo pinta). */
function hora(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: ZONA_HORARIA_ORG,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(iso));
  } catch {
    return "";
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  const contactId = req.query.contactId as string | undefined;
  if (!contactId) return res.status(400).json({ ok: false, error: "Falta contactId." });

  try {
    const conversationId = await conversacionDeContacto(contactId);
    // Sin conversación no es un error: el contacto simplemente nunca escribió.
    if (!conversationId) {
      return res.status(200).json({ ok: true, conversationId: null, ghlModo: ghl().modo, count: 0, messages: [] });
    }

    const mensajes = (await mensajesDeConversacion(conversationId))
      .filter(esMensajeDeChat)
      .map((m) => ({
        id: m.id,
        text: m.body ?? "",
        outgoing: m.direction === "outbound",
        type: m.messageType ?? "",
        date: m.dateAdded ?? "",
        time: hora(m.dateAdded),
      }))
      .reverse();

    return res.status(200).json({
      ok: true,
      conversationId,
      ghlModo: ghl().modo,
      count: mensajes.length,
      messages: mensajes,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
