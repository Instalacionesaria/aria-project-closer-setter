/**
 * `GET /api/setter/mi-dia` — las seis colas del setter, derivadas por query.
 *
 * Espejo de `GET /api/closer/mi-dia`. **Cero llamadas a GHL**: todo sale de la caché de
 * `closer_contactos`, que desde el 2026-08-08 incluye el territorio del setter — antes barría
 * solo `zona_closer` y por eso `api/setter/urgentes.ts` tenía que preguntarle a GHL en vivo.
 *
 * La lógica vive en `_lib/miDiaSetter.ts` para que el mismo cálculo sirva a este endpoint y al
 * tick, igual que hace el closer: si dos vitrinas muestran el mismo hecho, comparten la función
 * que lo calcula.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigir } from "../_lib/auth.js";
import { activar } from "../_lib/credenciales.js";
import { ejecutarMiDiaSetter } from "../_lib/miDiaSetter.js";
import { env } from "../_lib/env.js";
import { ghl } from "../_lib/ghl/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["setter"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const datos = await ejecutarMiDiaSetter();
    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      zonaHoraria: env.zonaHoraria(),
      // `llamadasGhl: 0` viaja en la respuesta para que el presupuesto sea verificable con un
      // curl y no una declaración — mismo criterio que `api/setter/urgentes.ts`.
      llamadasGhl: 0,
      ...datos,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
