/**
 * Sonda temporal — BORRAR cuando el 500 esté resuelto.
 *
 * Igual que `ping-src` pero con extensión `.js` explícita en el import. Es lo que exige
 * ESM nativo: sin extensión, Node no resuelve el módulo en runtime. Si esta responde y
 * `ping-src` no, el arreglo es agregar la extensión y nada más.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hoyISO } from "../src/lib/fechas.js";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({ ok: true, sonda: "importa src/ con extension .js", hoy: hoyISO() });
}
