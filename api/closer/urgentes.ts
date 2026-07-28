/**
 * `GET /api/closer/urgentes` — las Intervenciones Urgentes REALES.
 *
 * Un contacto entra si tiene el tag `bot_pausado_fallo`: el analizador detectó que la IA no
 * atendió bien y pausó al bot. El motivo específico sale de la última nota `[IA] ...` que
 * dejó ese mismo analizador — no se inventa un texto genérico si existe el real.
 *
 * El prefijo "Falla detectada por IA:" lo pone la vista; acá viaja solo el motivo, para no
 * hornear copy de la UI en la respuesta del servidor (CONTRATO-GHL §0: la presentación es
 * del tool).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ghl } from "../_lib/ghl/index.js";
import { contactosConTag, ultimaNotaIa } from "../_lib/ghl/lectura.js";

/** El tag que enciende la cola roja. Lo aplica el analizador, y el workflow de GHL apaga el bot. */
const TAG_FALLO = "bot_pausado_fallo";

/** Cuando todavía no hay nota del analizador, se dice eso — no se inventa un diagnóstico. */
const MOTIVO_SIN_NOTA = "requiere intervención — revisar conversación";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const contactos = await contactosConTag(TAG_FALLO);

    /**
     * Una lectura de notas por contacto. La cola roja de un closer son pocos casos por
     * definición — si fuera una intervención urgente masiva, el problema no sería el número
     * de requests. Si la nota de uno falla, ese contacto igual se devuelve con el motivo
     * genérico: la urgencia existe aunque falte el detalle.
     */
    const urgentes = await Promise.all(
      contactos.map(async (c) => ({
        contactId: c.id,
        name: c.nombre,
        source: c.fuente,
        fallo: (await ultimaNotaIa(c.id).catch(() => null)) ?? MOTIVO_SIN_NOTA,
      })),
    );

    return res.status(200).json({ ok: true, ghlModo: ghl().modo, count: urgentes.length, urgentes });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
