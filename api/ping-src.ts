/**
 * Sonda temporal — BORRAR cuando el 500 esté resuelto.
 *
 * Importa desde `src/`, o sea fuera de `api/`. Es la sospecha principal: con
 * `"type": "module"` en package.json, un import relativo sin extensión falla en tiempo de
 * ejecución si el bundler no lo resolvió antes.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TAGS } from "../src/lib/ghl/contrato";
import { hoyISO } from "../src/lib/fechas";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    sonda: "importa desde src/",
    tagDePrueba: TAGS.seguimientoRecupero.valor,
    hoy: hoyISO(),
  });
}
