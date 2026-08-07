/**
 * `DELETE /api/closer/contactos?ghlContactId=...` — borra un lead de LA PLATAFORMA.
 *
 * Pedido de Fabio (2026-08-03): "esto no eliminará nada en GHL, solo que no se mostrará más
 * en la plataforma, igual en la base de datos". Es decir:
 *
 *   - **GHL no se toca.** Cero llamadas. El contacto, sus tags, citas y conversaciones
 *     siguen intactos allá — esta operación es local a Comando Central.
 *   - **Supabase se limpia entero**: la fila de `closer_contactos` y TODO su rastro en las
 *     tablas satélite (mensajes, citas, notas, historial, seguimientos, avances, análisis).
 *     Borrar el contacto y dejarle los mensajes sería un borrado a medias que resucita mal.
 *
 * ## El contacto puede VOLVER — y eso es correcto
 *
 * La caché la mantienen el webhook y el cron (§51.3, alta por upsert): si el contacto sigue
 * teniendo `zona_closer` en GHL y agenda una cita nueva o dispara un webhook, se vuelve a
 * crear — como si fuera un alta nueva, sin su historia anterior. Para que un lead no vuelva
 * nunca, hay que quitarle `zona_closer` en GHL (sale del territorio); eso es una acción de
 * negocio en GHL, no de esta plataforma.
 *
 * ## Orden de borrado
 *
 * `closer_contacto_eventos` referencia a `closer_seguimientos` (FK `seguimiento_id`), así
 * que los eventos van ANTES que los seguimientos. El resto no tiene FKs entre sí (decisión
 * documentada en repo.ts: la identidad la manda GHL). `closer_contactos` cierra la lista.
 * El trigger append-only de eventos bloquea UPDATE pero permite DELETE (§50.5) — borrar es
 * una acción administrativa legítima.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

/** Todas las tablas con rastro del contacto, en orden seguro de borrado (FKs primero). */
const TABLAS_DEL_CONTACTO = [
  "closer_contacto_eventos", // referencia a closer_seguimientos — va primero
  "closer_notas",
  "closer_mensajes",
  "closer_citas",
  "closer_avances",
  "closer_analisis_agente",
  "closer_ghl_outbox",
  "closer_contacto_tarea",
  "closer_seguimientos",
  "closer_contactos", // la fila principal, al final: si algo falla antes, el contacto sigue visible
] as const;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["admin"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "DELETE") {
    res.setHeader("Allow", "DELETE");
    return res.status(405).json({ ok: false, error: "Solo DELETE." });
  }

  const crudo = req.query.ghlContactId ?? req.query.contactId;
  const ghlContactId = (Array.isArray(crudo) ? crudo[0] : crudo)?.trim();
  if (!ghlContactId) {
    return res.status(400).json({ ok: false, codigo: "contacto_faltante", error: "Falta ghlContactId." });
  }

  try {
    const borradas: Record<string, number> = {};

    for (const tabla of TABLAS_DEL_CONTACTO) {
      const { data, error } = await db().from(tabla).delete().eq("ghl_contact_id", ghlContactId).select("ghl_contact_id");
      if (error) throw new Error(`${tabla}: ${error.message}`);
      borradas[tabla] = (data ?? []).length;
    }

    // `existia: false` no es un error — repetir el DELETE (doble clic, retry) es inocuo.
    return res.status(200).json({
      ok: true,
      ghlContactId,
      existia: borradas.closer_contactos > 0,
      borradas,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
