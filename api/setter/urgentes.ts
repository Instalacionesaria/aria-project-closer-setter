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
import { env } from "../_lib/env.js";
import { contactosConTag } from "../_lib/ghl/lectura.js";
import { db } from "../_lib/repo.js";
import { exigir } from "../_lib/auth.js";

/** Cuando todavía no hay nota del analizador, se dice eso — no se inventa un diagnóstico. */
const MOTIVO_SIN_NOTA = "requiere intervención — revisar conversación";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["setter"]);
  if (!ctx) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    // Se pide por el tag del fallo y se filtra por territorio en memoria: la búsqueda de GHL
    // acepta un solo filtro por request, y los que tienen el bot caído son siempre pocos.
    //
    // Esta llamada NO se puede evitar: `closer_contactos` solo cachea territorio del closer
    // (`zona_closer` se aplica DESPUÉS de agendar, §51.3), así que el pre-agenda no está ahí.
    const { contactos: conFallo } = await contactosConTag(TAG_FALLO);
    const contactos = conFallo.filter((c) => c.tags.includes(TAGS.zonaSetter.valor));

    /**
     * El motivo del fallo, en UNA query — antes era `ultimaNotaIa(c.id)` por contacto dentro
     * de un `Promise.all`, o sea 1+N llamadas a GHL cada 60 segundos mientras el módulo Setter
     * estuviera abierto. El texto es el mismo: el analizador guarda `motivo` en esta tabla
     * (`analizador.ts:242`) y manda `[IA] ${motivo}` a la nota de GHL (`:330`) — misma frase,
     * dos destinos. Es exactamente la sustitución que `mi-dia.ts` ya había hecho del lado del
     * closer y que quedó pendiente acá.
     */
    const motivos = new Map<string, string>();
    if (contactos.length > 0) {
      const { data } = await db()
        .from("closer_analisis_agente")
        .select("ghl_contact_id, motivo, analizado_el")
        .eq("fallo", true)
        .in("ghl_contact_id", contactos.map((c) => c.id))
        .order("analizado_el", { ascending: false });
      for (const a of data ?? []) {
        if (a.motivo && !motivos.has(a.ghl_contact_id)) motivos.set(a.ghl_contact_id, a.motivo);
      }
    }

    const urgentes = contactos.map((c) => ({
      contactId: c.id,
      name: c.nombre,
      source: c.fuente,
      fallo: motivos.get(c.id) ?? MOTIVO_SIN_NOTA,
    }));

    return res.status(200).json({
      ok: true,
      ghlModo: env.ghlModo(),
      count: urgentes.length,
      /** Con el bot caído pero fuera de pre-agenda: esos son del closer, no de esta cola. */
      fueraDeZonaSetter: conFallo.length - contactos.length,
      /** Para que el presupuesto de §51.4 sea verificable con un curl, no declarativo. */
      llamadasGhl: 1,
      urgentes,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
