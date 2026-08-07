/**
 * `POST /api/closer/reconciliar` — un ciclo de ingesta, a mano.
 *
 * ## Ya no es el reloj
 *
 * Hasta §56 este endpoint ERA el reloj de 10 s: el frontend lo pingueaba y aparte pedía Mi
 * Día, dos requests por ciclo. Ahora las dos mitades corren juntas en
 * `POST /api/closer/tick`, y esto queda para el `curl` manual y el diagnóstico.
 *
 * ## Se comporta exactamente igual que antes
 *
 * El cuerpo vive en `api/_lib/reconciliacion.ts` y se llama **sin presupuesto de tiempo**,
 * que es el default — o sea, corre hasta terminar, igual que siempre. El tick sí le pasa un
 * deadline; si acá también se lo pasáramos, el mismo código tendría dos comportamientos
 * según por dónde entre y este endpoint dejaría de servir para reproducir lo que pasa en
 * producción.
 *
 * Que `ejecutarReconciliacion` devuelva `{status, body}` no es cosmético: hace que la
 * traducción a HTTP sea una sola línea y por lo tanto imposible de desincronizar.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ejecutarReconciliacion } from "../_lib/reconciliacion.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["admin"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Usá POST." });
  }

  const r = await ejecutarReconciliacion();
  return res.status(r.status).json(r.body);
}
