/**
 * `GET /api/closer/urgentes` — las Intervenciones Urgentes REALES del CLOSER.
 *
 * Un contacto entra si cumple LAS DOS:
 *   1. `bot_pausado_fallo` — el analizador detectó que la IA no atendió bien y pausó al bot;
 *   2. `zona_closer` — está en territorio post-agenda.
 *
 * La segunda no es un detalle: las urgencias se rutean por etapa (§11), pre-agenda al setter
 * y post-agenda al closer. Sin ese filtro, un lead con el bot caído que todavía está en
 * calificación aparecería en la cola del closer, que no es quien tiene que atenderlo.
 *
 * El motivo específico sale de la última nota `[IA] ...` que dejó ese mismo analizador — no
 * se inventa un texto genérico si existe el real. El prefijo "Falla detectada por IA:" lo
 * pone la vista; acá viaja solo el motivo, para no hornear copy de la UI en la respuesta del
 * servidor (CONTRATO-GHL §0: la presentación es del tool).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { perteneceAlCloser, TAGS, TAGS_BOT } from "../../src/lib/ghl/contrato.js";
import { ghl } from "../_lib/ghl/index.js";
import { contactosConTag, ultimaNotaIa } from "../_lib/ghl/lectura.js";

/** El tag que enciende la cola roja. Lo aplica el analizador, y el workflow de GHL apaga el bot. */
const TAG_FALLO = TAGS_BOT.botPausadoFallo.valor;

/** Cuando todavía no hay nota del analizador, se dice eso — no se inventa un diagnóstico. */
const MOTIVO_SIN_NOTA = "requiere intervención — revisar conversación";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    /**
     * Se pide por el tag del fallo y se filtra por territorio en memoria: la búsqueda de GHL
     * acepta un solo filtro por request, y los que tienen el bot caído son siempre pocos.
     * `exigirZonaCloser: true` es explícito — el default de la función es `false` porque la
     * semilla del demo no tiene tags, pero acá los contactos vienen de GHL y sí los tienen.
     */
    const conFallo = await contactosConTag(TAG_FALLO);
    const contactos = conFallo.filter((c) => perteneceAlCloser(c.tags, true));

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
        /**
         * Los tags crudos viajan para que el front pueda derivar la ETAPA real del contacto
         * con `etapaDesdeTags()`. Sin esto, la urgencia entraba a la vista con un stage
         * inventado (`descalificado`, elegido solo porque pinta la píldora de rojo) y, al
         * mover estos contactos al store, ese invento los habría metido en la columna
         * Descalificado del Pipeline. La urgencia es un MARCADOR, no una etapa: un contacto
         * con el bot caído sigue estando donde su historia lo dejó.
         */
        tags: c.tags,
        fallo: (await ultimaNotaIa(c.id).catch(() => null)) ?? MOTIVO_SIN_NOTA,
      })),
    );

    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      count: urgentes.length,
      /**
       * Cuántos tienen el bot caído pero NO son del closer. No se muestra en la cola —
       * viaja para poder responder "¿por qué no aparece este contacto?" sin abrir GHL.
       * Si es > 0, esas urgencias son del setter (§11) y hoy no las atiende nadie: el
       * territorio setter todavía no tiene su propio endpoint de urgentes.
       */
      fueraDeZonaCloser: conFallo.length - contactos.length,
      urgentes,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
