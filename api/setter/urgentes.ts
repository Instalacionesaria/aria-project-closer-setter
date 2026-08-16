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
import { TAGS, tieneFalloDeAuditor } from "../../src/lib/ghl/contrato.js";
import { env } from "../_lib/env.js";
import { db } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

/** Cuando todavía no hay nota del analizador, se dice eso — no se inventa un diagnóstico. */
const MOTIVO_SIN_NOTA = "requiere intervención — revisar conversación";

interface FilaCache {
  ghl_contact_id: string;
  nombre: string | null;
  fuente: string | null;
  tags: string[] | null;
  congelado: boolean;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["setter"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    /**
     * ── De GHL en vivo a la caché (2026-08-08) ────────────────────────
     *
     * Este bloque decía que la llamada a GHL **no se podía evitar**, y era cierto cuando se
     * escribió: `closer_contactos` cacheaba solo territorio del closer, así que el pre-agenda no
     * estaba ahí. Por eso este endpoint corría cada 60 s en vez de cada 10 — el presupuesto no
     * daba para más.
     *
     * Desde que `sincronizarTerritorio()` barre los dos territorios, el pre-agenda SÍ está en la
     * caché. La llamada se fue: de 1 a 0.
     */
    const { data: filas } = await db()
      .from("closer_contactos")
      .select("ghl_contact_id, nombre, fuente, tags, congelado");

    const delSetter = ((filas ?? []) as FilaCache[]).filter((c) =>
      (c.tags ?? [])
        .map((t) => t.trim().toLowerCase())
        .includes(TAGS.zonaSetter.valor),
    );
    const contactos = delSetter
      .filter((c) => !c.congelado && tieneFalloDeAuditor(c.tags ?? []))
      .map((c) => ({
        id: c.ghl_contact_id,
        nombre: c.nombre ?? c.ghl_contact_id,
        fuente: c.fuente,
        tags: c.tags ?? [],
      }));

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
        .in(
          "ghl_contact_id",
          contactos.map((c) => c.id),
        )
        .order("analizado_el", { ascending: false });
      for (const a of data ?? []) {
        if (a.motivo && !motivos.has(a.ghl_contact_id))
          motivos.set(a.ghl_contact_id, a.motivo);
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
      /** Cuántos del territorio del setter NO están en esta cola. Para leer la proporción. */
      enZonaSetter: delSetter.length,
      /** Para que el presupuesto de §51.4 sea verificable con un curl, no declarativo. */
      llamadasGhl: 0,
      urgentes,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
