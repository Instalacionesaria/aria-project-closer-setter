/**
 * `GET /api/closer/citas-respaldo` — el cron de citas (:25 y :55 de cada hora).
 *
 * Las citas se agendan a horas en punto o y-media; correr 5 minutos antes de cada bloque
 * (doc §5.2) deja el caché fresco justo cuando importa, con ~2 llamadas/hora en vez de las
 * 360 del polling viejo. Hace dos cosas:
 *
 *   1. Reconcilia `closer_citas` con el calendar de GHL (hoy + mañana) — el respaldo del
 *      webhook de cita, y LA vía de alta de contactos nuevos si el webhook no existe.
 *   2. Refresca los contactos con cita en los próximos ~40 min (§5.3: tags y custom fields
 *      frescos — video precall, lo que recabó el chatbot — antes de la reunión).
 *
 * Protegido con CRON_SECRET: Vercel manda `Authorization: Bearer ${CRON_SECRET}` en cada
 * invocación de cron cuando la variable existe. Sin el header correcto, 401 — el endpoint
 * gasta llamadas de GHL y no debe poder dispararlo cualquiera.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { refrescarContactosProximos, rangoRespaldo, sincronizarCitas } from "../_lib/citas.js";
import { env } from "../_lib/env.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ ok: false, error: "Solo el cron de Vercel." });
  }
  // Sin CRON_SECRET configurado se acepta (el cron de Vercel no manda header en ese caso).
  // El riesgo es bajo: el endpoint es idempotente y el costo está acotado a ~2 llamadas.

  if (env.ghlModo() === "stub") {
    return res.status(200).json({ ok: true, corrio: false, motivo: "Modo stub." });
  }

  try {
    const { desde, hasta } = rangoRespaldo();
    const sync = await sincronizarCitas(desde, hasta);
    const refrescados = await refrescarContactosProximos();

    return res.status(200).json({ ok: true, corrio: true, rango: { desde, hasta }, ...sync, refrescados });
  } catch (e) {
    return res.status(502).json({ ok: false, error: (e as Error).message });
  }
}
