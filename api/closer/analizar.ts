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
 *   POST /api/closer/analizar { …, forzar: true }      → ignora el debounce de 5 mensajes
 *   POST /api/closer/analizar { …, dryRun: true }      → devuelve el veredicto SIN escribir
 *
 * `dryRun` es hoy la ÚNICA forma de probar la rúbrica: el portón del bot bloquea al 100% de
 * los contactos porque `bot_activado` no existe en la cuenta (§54.1). Por eso `dryRun` lo
 * saltea — no escribe nada, así que no puede hacer daño — pero sigue exigiendo que la
 * conversación tenga mensajes reales del agente. Conviene combinarlo con `forzar` para que
 * el debounce tampoco lo frene:
 *
 *     curl -X POST .../api/closer/analizar -H "x-webhook-secret: …" \
 *       -d '{"ghlContactId":"…","dryRun":true,"forzar":true}'
 *
 * ⚠️ ESCRIBE EN GHL. Un fallo detectado aplica `bot_pausado_fallo`, que dispara el workflow
 * que apaga al agente en la conversación de una persona real. No es un simulacro — salvo con
 * `dryRun`, que es exactamente para eso.
 *
 * Es POST y no GET justamente por eso: un GET es lo que precargan los navegadores, los
 * crawlers y los previews de link. Esto no puede dispararse por mirar una URL.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { analizarTerritorio, analizarYMarcar, type Territorio } from "../_lib/analizador.js";
import { ghl } from "../_lib/ghl/index.js";
import { activar, resolverCredenciales } from "../_lib/credenciales.js";
import { ORG_ID } from "../_lib/repo.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Solo POST." });
  }

  /**
   * Misma credencial que el webhook, y con el mismo rigor.
   *
   * Antes era `if (secreto && …)`: sin `WEBHOOK_SECRET` configurado el endpoint quedaba
   * ABIERTO, y este endpoint aplica tags y escribe notas en GHL sobre personas reales,
   * además de gastar en el modelo. 503 y no 401 cuando falta la variable, porque el
   * problema es configuración nuestra y no la credencial de quien llama — el mismo criterio
   * que ya usaba `api/webhooks/ghl.ts`.
   */
  const secreto = process.env.WEBHOOK_SECRET;
  if (!secreto) {
    console.error("[analizar] WEBHOOK_SECRET sin configurar: se rechaza todo hasta que exista.");
    return res.status(503).json({ ok: false, error: "WEBHOOK_SECRET sin configurar en el servidor." });
  }
  if (req.headers["x-webhook-secret"] !== secreto) {
    return res.status(401).json({ ok: false, error: "Secreto inválido." });
  }

  /**
   * Camino de MÁQUINA: no hay sesión, así que las credenciales de la empresa se resuelven acá.
   * Sin esto el auditor y la ingesta correrían con las variables globales — correcto hoy con
   * una sola empresa, y una fuga el día que haya dos (§5.2).
   *
   * Se resuelve ANTES del `try` de la lógica para que un fallo de credenciales se vea como lo
   * que es —configuración— y no como un error de la operación que iba a hacer.
   */
  try {
    activar(await resolverCredenciales(ORG_ID));
  } catch (e) {
    console.error(`[credenciales] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  try {
    const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) ?? {};
    const { ghlContactId, zona, forzar, dryRun } = cuerpo as Record<string, unknown>;
    const opts = { forzar: forzar === true, dryRun: dryRun === true, disparo: "manual" as const };

    if (typeof ghlContactId === "string" && ghlContactId) {
      const resultado = await analizarYMarcar(ghlContactId, opts);
      return res.status(200).json({ ok: true, ghlModo: ghl().modo, ghlContactId, ...opts, ...resultado });
    }

    if (zona !== undefined && zona !== "closer" && zona !== "setter") {
      return res.status(400).json({ ok: false, error: 'zona inválida: "closer" o "setter".' });
    }
    const territorio: Territorio = zona === "setter" ? "setter" : "closer";

    const { encontrados, revisados, omitidos, truncado, resultados } = await analizarTerritorio(territorio, opts);
    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      territorio,
      ...opts,
      encontrados,
      revisados,
      omitidos,
      // Se dice cuando GHL devolvió el tope: "revisé el territorio" habiendo visto solo los
      // primeros 50 sería una afirmación falsa.
      truncado,
      // Cuántos terminaron en la cola roja de verdad, que es lo que se va a ver en el tool.
      marcados: resultados.filter((r) => r.fallo).length,
      hallazgos: resultados.reduce((n, r) => n + (r.hallazgos ?? 0), 0),
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
