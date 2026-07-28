/**
 * `GET /api/setter/urgentes` — las Intervenciones Urgentes REALES del SETTER.
 *
 * Espejo exacto de `/api/closer/urgentes`, cambiando el territorio. Un contacto entra si
 * cumple LAS DOS:
 *   1. `bot_pausado_fallo` — el analizador detectó que la IA no atendió bien y pausó al bot;
 *   2. `zona_setter` — está en territorio pre-agenda.
 *
 * Los dos endpoints juntos cubren el ruteo por etapa de §11 sin solaparse: los tags de
 * territorio son mutuamente excluyentes, así que un contacto aparece en la cola de un rol o
 * en la del otro, nunca en las dos. Hasta que existió este endpoint, un lead con el bot
 * caído en pre-agenda quedaba marcado y sin que ninguna vista lo mostrara.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { TAGS } from "../../src/lib/ghl/contrato.js";
import { TAG_FALLO } from "../_lib/analizador.js";
import { ghl } from "../_lib/ghl/index.js";
import { contactosConTag, ultimaNotaIa } from "../_lib/ghl/lectura.js";

/** Cuando todavía no hay nota del analizador, se dice eso — no se inventa un diagnóstico. */
const MOTIVO_SIN_NOTA = "requiere intervención — revisar conversación";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    // Se pide por el tag del fallo y se filtra por territorio en memoria: la búsqueda de GHL
    // acepta un solo filtro por request, y los que tienen el bot caído son siempre pocos.
    const conFallo = await contactosConTag(TAG_FALLO);
    const contactos = conFallo.filter((c) => c.tags.includes(TAGS.zonaSetter.valor));

    const urgentes = await Promise.all(
      contactos.map(async (c) => ({
        contactId: c.id,
        name: c.nombre,
        source: c.fuente,
        fallo: (await ultimaNotaIa(c.id).catch(() => null)) ?? MOTIVO_SIN_NOTA,
      })),
    );

    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      count: urgentes.length,
      /** Con el bot caído pero fuera de pre-agenda: esos son del closer, no de esta cola. */
      fueraDeZonaSetter: conFallo.length - contactos.length,
      urgentes,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
