/**
 * `GET /api/closer/citas-respaldo` — el cron de citas (:25 y :55 de cada hora).
 *
 * Las citas se agendan a horas en punto o y-media; correr 5 minutos antes de cada bloque
 * (doc §5.2) deja el caché fresco justo cuando importa, con ~2 llamadas/hora en vez de las
 * 360 del polling viejo. Hace dos cosas:
 *
 *   1. Reconcilia `closer_citas` con el calendar de GHL (hoy + mañana) — el respaldo del
 *      webhook de cita, y LA vía de alta de contactos nuevos si el webhook no existe.
 *   2. Refresca los contactos con cita en los próximos ~40 min (§5.3: tags y custom fields
 *      frescos — video precall, lo que recabó el chatbot — antes de la reunión).
 *
 * Protegido con CRON_SECRET: Vercel manda `Authorization: Bearer ${CRON_SECRET}` en cada
 * invocación de cron cuando la variable existe. Sin el header correcto, 401 — el endpoint
 * gasta llamadas de GHL y no debe poder dispararlo cualquiera.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { refrescarContactosProximos, rangoRespaldo, sincronizarCitas } from "../_lib/citas.js";
import { env } from "../_lib/env.js";
import { activar, resolverCredenciales } from "../_lib/credenciales.js";
import { ORG_PRINCIPAL } from "../_lib/repo.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * §3.2 · Falla CERRADO. Cerrado de verdad desde el 2026-08-07, cuando `CRON_SECRET` se
   * configuró en Vercel.
   *
   * Antes era `if (secreto && …)`: **sin la variable pasaba cualquiera**. Se intentó cerrarlo
   * el 06/08 y se revirtió al comprobar contra producción que el endpoint respondía 200 —
   * o sea que la variable no existía y cerrarlo habría dejado la agenda sin sincronizar. Se
   * dejó abierto pero ruidoso hasta que Fabio la creó.
   *
   * Ahora sí: sin la variable, 503 y no corre. Mejor un cron caído y visible que uno abierto
   * y silencioso — que es el modo de fallar más peligroso, porque en un preview sin variables
   * todo "funciona" y nadie se entera.
   *
   * Vercel manda `Authorization: Bearer ${CRON_SECRET}` solo en las invocaciones de cron.
   */
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error("[citas-respaldo] CRON_SECRET sin configurar: se rechaza todo hasta que exista.");
    return res.status(503).json({ ok: false, error: "CRON_SECRET sin configurar en el servidor." });
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ ok: false, error: "Solo el cron de Vercel." });
  }

  if (env.ghlModo() === "stub") {
    return res.status(200).json({ ok: true, corrio: false, motivo: "Modo stub." });
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
    activar(await resolverCredenciales(ORG_PRINCIPAL));
  } catch (e) {
    console.error(`[credenciales] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  try {
    const { desde, hasta } = rangoRespaldo();
    const sync = await sincronizarCitas(desde, hasta);
    const refrescados = await refrescarContactosProximos();

    return res.status(200).json({ ok: true, corrio: true, rango: { desde, hasta }, ...sync, refrescados });
  } catch (e) {
    return res.status(502).json({ ok: false, error: (e as Error).message });
  }
}
