/**
 * `POST /api/closer/sincronizar` — barre el territorio del closer desde GHL.
 *
 * Es la red de seguridad del webhook, y también lo que puebla la app la primera vez: sin
 * esto, un contacto que ya tenía `zona_closer` antes de que existiera el webhook no
 * aparecería nunca, porque nadie va a disparar un evento retroactivo por él.
 *
 * Se expone como endpoint en vez de correr en un cron para que sea explícito y auditable:
 * quien lo llama sabe que lo llamó, y la respuesta dice exactamente cuántos encontró y
 * cuántos falló. Cuando haga falta automatizarlo, un cron de Vercel puede pegarle acá sin
 * cambiar nada del código.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sincronizarTerritorio } from "../_lib/contactos.js";
import { ghl } from "../_lib/ghl/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ ok: false, error: "Solo POST o GET." });
  }

  // Misma protección que el webhook: es un endpoint que escribe, y aunque solo copie datos
  // de GHL, dejarlo abierto permitiría que cualquiera consuma la cuota de la API a pedido.
  const secreto = process.env.WEBHOOK_SECRET;
  if (secreto && req.headers["x-webhook-secret"] !== secreto) {
    return res.status(401).json({ ok: false, error: "Secreto inválido." });
  }

  try {
    const limite = Number(req.query.limite ?? 100) || 100;
    const r = await sincronizarTerritorio(limite);

    return res.status(r.errores.length && !r.sincronizados ? 503 : 200).json({
      ok: r.errores.length === 0,
      modo: ghl().modo,
      ...r,
      ...(ghl().modo === "stub"
        ? { nota: "Adapter en modo stub: no hay conexión con GHL, así que no hay nada que sincronizar." }
        : {}),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
