/**
 * `POST /api/closer/sincronizar` — barre el territorio del closer desde GHL.
 *
 * Es la red de seguridad del webhook, y también lo que puebla la app la primera vez: sin
 * esto, un contacto que ya tenía `zona_closer` antes de que existiera el webhook no
 * aparecería nunca, porque nadie va a disparar un evento retroactivo por él.
 *
 * ## Dos modos, y por qué uno va sin secreto (2026-08-04)
 *
 * Desde que el botón "Sincronizar CRM" del Pipeline llama acá, el endpoint tiene dos vías:
 *
 * | | con `x-webhook-secret` (ops/cron) | sin secreto (la UI) |
 * |---|---|---|
 * | Tope | hasta 100, vía `?limite=` | 25 por defecto, máximo 40 |
 * | Freno | ninguno | candado de 60 s en Postgres |
 * | Citas | no | sí, hoy→hoy+15 antes del barrido |
 *
 * Abrir la vía sin secreto es deliberado y tiene precedente exacto: `POST /api/closer/reconciliar`
 * ya es público y su freno es un candado en la base, no un secreto. El `WEBHOOK_SECRET` es
 * server-only — el browser no lo tiene y no debe tenerlo. El riesgo que el secreto cubría
 * (quemar la cuota de GHL a pedido) queda acotado por el candado a `2 + tope` llamadas por
 * ventana de 60 segundos.
 *
 * ## Qué refresca de verdad
 *
 * Hasta hoy el botón solo traía las citas: los tags, el estado del bot y los contadores de
 * llamadas de un contacto YA cacheado no se releían nunca. Ahora sí — y de paso el barrido
 * descongela al que recuperó `zona_closer` y congela al que lo perdió, las dos direcciones
 * con una sola llamada a GHL.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hoyISO, sumarDias } from "../../src/lib/fechas.js";
import { sincronizarCitas } from "../_lib/citas.js";
import { sincronizarTerritorio } from "../_lib/contactos.js";
import { env } from "../_lib/env.js";
import { db, ORG_ID } from "../_lib/repo.js";

/** Cuántos contactos refresca como mucho el botón de la UI. Cada uno es 1 llamada a GHL. */
const TOPE_UI = 25;
const TOPE_UI_MAXIMO = 40;

/** Ventana del candado. Un clic por minuto alcanza de sobra para una acción manual. */
const VENTANA_SEGUNDOS = 60;

/** Cuántos días de agenda trae el botón — el mismo rango que ya pedía el Pipeline. */
const DIAS_AGENDA = 15;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST" && req.method !== "GET") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ ok: false, error: "Solo POST o GET." });
  }

  const secreto = process.env.WEBHOOK_SECRET;
  const esOps = !!secreto && req.headers["x-webhook-secret"] === secreto;

  try {
    if (env.ghlModo() !== "real") {
      return res.status(200).json({
        ok: true,
        corrio: false,
        modo: "stub",
        motivo: "Adapter en modo stub: no hay conexión con GHL, así que no hay nada que sincronizar.",
      });
    }

    /* ── Vía de operaciones: sin freno, tope alto ─────────────────────────── */
    if (esOps) {
      const tope = Number(req.query.limite ?? 100) || 100;
      const r = await sincronizarTerritorio({ tope });
      return res.status(r.errores.length && !r.sincronizados ? 503 : 200).json({
        ok: r.errores.length === 0,
        corrio: true,
        modo: "real",
        contactos: r,
        llamadasGhl: r.llamadasGhl,
      });
    }

    /* ── Vía de la UI: candado + citas + tope bajo ────────────────────────── */
    const { data: gano, error: errClaim } = await db().rpc("closer_sincronizar_claim", {
      p_org_id: ORG_ID,
      p_ventana_segundos: VENTANA_SEGUNDOS,
    });
    if (errClaim) throw new Error(`closer_sincronizar_claim: ${errClaim.message}`);

    if (!gano) {
      // Se responde 200 con `corrio: false`, no un error: no falló nada, simplemente ya se
      // sincronizó hace un momento. La UI muestra el motivo tal cual en vez de fingir éxito.
      return res.status(200).json({
        ok: true,
        corrio: false,
        modo: "real",
        motivo: "Ya se sincronizó hace menos de un minuto.",
      });
    }

    const hoy = hoyISO();
    const citas = await sincronizarCitas(hoy, sumarDias(hoy, DIAS_AGENDA));

    const tope = Math.min(Number(req.query.limite ?? TOPE_UI) || TOPE_UI, TOPE_UI_MAXIMO);
    const contactos = await sincronizarTerritorio({ tope });

    return res.status(200).json({
      ok: contactos.errores.length === 0,
      corrio: true,
      modo: "real",
      citas: { eventos: citas.eventos, contactosNuevos: citas.contactosNuevos },
      contactos,
      llamadasGhl: citas.llamadasGhl + contactos.llamadasGhl,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, corrio: false, error: (e as Error).message });
  }
}
