/**
 * `GET /api/closer/mi-dia` — TODAS las colas de Mi Día en una respuesta, desde la caché.
 *
 * El cuerpo vive en `api/_lib/miDia.ts` desde §56, porque el tick de 10 s lo comparte. Este
 * endpoint **NO quedó como reliquia**: es la hidratación al montar y la ÚNICA fuente de
 * `seguimientosHoy` (`src/lib/seguimientos/cliente.ts` → `traerMiDia`), que el tick ni
 * siquiera consume. Sigue siendo de primera clase.
 *
 * Cero llamadas a GHL (doc §8.2/§9). Ver la cabecera de `_lib/miDia.ts` para el detalle de
 * las cinco colas.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ejecutarMiDia } from "../_lib/miDia.js";
import { exigir } from "../_lib/auth.js";

/* `clasificarCaso` se re-exporta desde su nuevo hogar: lo importan otros módulos y mover el
   archivo no debería obligarlos a cambiar el import. */
export { clasificarCaso, type CasoSeguimiento } from "../_lib/miDia.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer"]);
  if (!ctx) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    return res.status(200).json({ ok: true, ...(await ejecutarMiDia()) });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
