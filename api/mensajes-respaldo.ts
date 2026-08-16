/**
 * `GET /api/mensajes-respaldo` — rellena el historial de chat que la caché nunca tuvo.
 *
 * ── Por qué existe ────────────────────────────────────────────────────
 *
 * La ingesta de mensajes nació con el webhook y solo mira hacia adelante. Medido contra
 * producción el 2026-08-16, sobre 148 contactos: **33 sin un solo mensaje** (uno de ellos con 46
 * en GHL) y, de los que sí tenían, faltaban los más viejos — ~51 en una muestra de 12.
 *
 * El detalle de qué rompe eso y por qué es idempotente está en `_lib/backfillMensajes.ts`.
 *
 * ── Manual, no programado ─────────────────────────────────────────────
 *
 * **No está en `crons` de `vercel.json` a propósito.** Es una reparación de una sola vez: una vez
 * que el historial está completo, quien lo mantiene al día es la reconciliación (cada 10 s) y el
 * webhook. Dejarlo como cron sería gastar ~300 llamadas a GHL por corrida para no traer nada.
 *
 * Se dispara a mano con el `CRON_SECRET`, y acepta `?tope=` para partirlo en tandas. Si algún día
 * hace falta que corra solo —una empresa nueva que se da de alta con historial— se agrega a
 * `crons` y este comentario cambia.
 *
 * ── El presupuesto ───────────────────────────────────────────────────
 *
 * Cuesta `1 + 5` llamadas por contacto (la búsqueda de conversaciones y hasta 5 páginas de 100
 * mensajes). Los 148 son ~900 contra un presupuesto de 200.000 por subcuenta: **0,45 %**.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  conCredenciales,
  organizacionesActivas,
  resolverCredenciales,
} from "./_lib/credenciales.js";
import {
  backfillMensajes,
  contactosParaBackfill,
} from "./_lib/backfillMensajes.js";

/** Contactos por corrida. Con `maxDuration: 300` entran cómodos; se puede bajar con `?tope=`. */
const TOPE_POR_DEFECTO = 60;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Falla CERRADO, igual que los crons: esto escribe en la base y gasta llamadas a GHL.
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error(
      "[mensajes-respaldo] CRON_SECRET sin configurar: se rechaza todo hasta que exista.",
    );
    return res
      .status(503)
      .json({ ok: false, error: "CRON_SECRET sin configurar en el servidor." });
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    return res
      .status(401)
      .json({ ok: false, error: "Solo con el secreto del cron." });
  }

  const crudo = Number(
    Array.isArray(req.query.tope) ? req.query.tope[0] : req.query.tope,
  );
  const tope =
    Number.isFinite(crudo) && crudo > 0
      ? Math.min(crudo, 200)
      : TOPE_POR_DEFECTO;

  let organizaciones: string[];
  try {
    organizaciones = await organizacionesActivas();
  } catch (e) {
    console.error(`[mensajes-respaldo] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  const porEmpresa: Record<string, unknown> = {};
  let fallaron = 0;

  for (const orgId of organizaciones) {
    try {
      const cred = await resolverCredenciales(orgId);

      // Sin PIT no hay de dónde traer: se saltea DICIÉNDOLO, no heredando el token de otra.
      if (!cred.ghlPit || !cred.ghlLocationId) {
        porEmpresa[cred.nombre] = {
          corrio: false,
          motivo: "sin credenciales de GHL cargadas",
        };
        continue;
      }

      porEmpresa[cred.nombre] = await conCredenciales(cred, async () => {
        const ids = await contactosParaBackfill(tope);
        const r = await backfillMensajes(ids);
        return { corrio: true, ...r };
      });
    } catch (e) {
      fallaron++;
      porEmpresa[orgId] = { corrio: false, error: (e as Error).message };
      console.error(
        `[mensajes-respaldo] empresa ${orgId}: ${(e as Error).message}`,
      );
    }
  }

  const estado = fallaron === 0 ? 200 : 207;
  return res.status(estado).json({
    ok: fallaron === 0,
    corrio: true,
    tope,
    empresas: organizaciones.length,
    fallaron,
    porEmpresa,
  });
}
