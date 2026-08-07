/**
 * `POST /api/closer/buzon-resolver` — "Marcar como resuelto" del Buzón General.
 *
 * El Buzón se DERIVA (bot apagado + último entrante posterior a `buzon_resuelto_el`), así
 * que resolver es mover la marca: el contacto sale de la cola al instante y, si vuelve a
 * escribir, reaparece solo — su próximo entrante será posterior a esta marca. Cero flags.
 *
 * La resolución de hoy además lo pone en "Completadas Hoy" (esa sección se deriva por
 * query de avances + resoluciones con fecha de hoy en Lima — doc §8.2).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { registrarEventoSistema } from "../_lib/ingesta.js";
import { db } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Usá POST." });
  }

  const cuerpo = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as Record<string, unknown> | null;
  const contactId = String(cuerpo?.contactId ?? "");
  if (!contactId) return res.status(400).json({ ok: false, error: "Falta contactId." });

  try {
    const ahora = new Date().toISOString();
    const { data, error } = await db()
      .from("closer_contactos")
      .update({ buzon_resuelto_el: ahora })
      .eq("ghl_contact_id", contactId)
      .select("ghl_contact_id")
      .maybeSingle();
    if (error) throw new Error(`closer_contactos: ${error.message}`);
    if (!data) return res.status(404).json({ ok: false, error: "Ese contacto no está en la caché." });

    // Autor de la marca: el humano resolvió, pero el evento lo escribe el sistema como
    // consecuencia — igual que la cancelación universal. El texto dice quién decide.
    await registrarEventoSistema(contactId, "buzon_resuelto", "Buzón resuelto por el closer");

    return res.status(200).json({ ok: true, resueltoEl: ahora });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
