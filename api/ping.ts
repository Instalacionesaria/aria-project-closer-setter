/**
 * Sonda temporal — BORRAR cuando el 500 esté resuelto.
 *
 * Cero imports. Si esta responde y las otras no, el problema no es "las funciones no
 * corren" sino la resolución de alguno de los módulos que importan.
 */
import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    sonda: "sin imports",
    node: process.version,
    // Sin exponer valores: solo si están presentes.
    env: {
      supabase: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      ghlPit: Boolean(process.env.GHL_PIT),
      ghlLocation: Boolean(process.env.GHL_LOCATION_ID),
    },
  });
}
