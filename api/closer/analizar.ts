/**
 * `POST /api/closer/analizar` — dispara el analizador a mano.
 *
 * El camino normal es el webhook: cada mensaje nuevo audita esa conversación. Este endpoint
 * existe para probar la rúbrica sin esperar a que alguien escriba, y para una pasada de
 * recuperación sobre todo el territorio si el webhook estuvo caído.
 *
 *   POST /api/closer/analizar                          → todos los de zona_closer
 *   POST /api/closer/analizar { zona: "setter" }       → todos los de zona_setter
 *   POST /api/closer/analizar { ghlContactId: "…" }    → uno solo (el territorio se deduce
 *                                                         de sus tags, no hace falta decirlo)
 *
 * ⚠️ ESCRIBE EN GHL. Un fallo detectado aplica `bot_pausado_fallo`, que dispara el workflow
 * que apaga al agente en la conversación de una persona real. No es un simulacro.
 *
 * Es POST y no GET justamente por eso: un GET es lo que precargan los navegadores, los
 * crawlers y los previews de link. Esto no puede dispararse por mirar una URL.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { analizarTerritorio, analizarYMarcar, type Territorio } from "../_lib/analizador.js";
import { ghl } from "../_lib/ghl/index.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Solo POST." });
  }

  /**
   * Misma credencial que el webhook. El endpoint escribe en GHL sobre contactos reales, así
   * que no puede quedar abierto a cualquiera que descubra la URL.
   */
  const secreto = process.env.WEBHOOK_SECRET;
  if (secreto && req.headers["x-webhook-secret"] !== secreto) {
    return res.status(401).json({ ok: false, error: "Secreto inválido." });
  }

  try {
    const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) ?? {};
    const { ghlContactId, zona } = cuerpo as Record<string, unknown>;

    if (typeof ghlContactId === "string" && ghlContactId) {
      const resultado = await analizarYMarcar(ghlContactId);
      return res.status(200).json({ ok: true, ghlModo: ghl().modo, ghlContactId, ...resultado });
    }

    if (zona !== undefined && zona !== "closer" && zona !== "setter") {
      return res.status(400).json({ ok: false, error: 'zona inválida: "closer" o "setter".' });
    }
    const territorio: Territorio = zona === "setter" ? "setter" : "closer";

    const { revisados, resultados } = await analizarTerritorio(territorio);
    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      territorio,
      revisados,
      // Cuántos terminaron en la cola roja de verdad, que es lo que se va a ver en el tool.
      marcados: resultados.filter((r) => r.fallo).length,
      resultados,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
