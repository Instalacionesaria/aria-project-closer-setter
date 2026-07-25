/**
 * Sonda temporal — BORRAR cuando el 500 esté resuelto.
 *
 * Importa SOLO desde dentro de `api/`. Distingue dos causas que hasta ahora se confunden:
 * si falla, ningún import relativo funciona; si responde, el problema es específicamente
 * cruzar a `src/`, y el arreglo es mover el código compartido acá adentro.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "./_lib/env.js";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    sonda: "importa desde ./_lib (dentro de api/)",
    ghlModo: env.ghlModo(),
  });
}
