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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * ⚠️ EL ÚNICO ENDPOINT QUE TODAVÍA PUEDE ESTAR ABIERTO. Verificado el 2026-08-06:
   * `CRON_SECRET` **no está configurado en Vercel**, así que hoy lo dispara cualquiera que
   * conozca la URL.
   *
   * Se intentó cerrarlo (503 sin la variable) y se revirtió al comprobar contra producción
   * que el endpoint responde 200: cerrarlo **habría dejado la agenda sin sincronizar** hasta
   * que alguien pusiera la variable. Romper el cron es peor que el agujero, que cuesta ~2
   * llamadas a GHL y es idempotente.
   *
   * **Lo que hay que hacer, y es de Fabio:** definir `CRON_SECRET` en Vercel. Vercel lo manda
   * solo en `Authorization: Bearer …` cuando la variable existe, así que con solo crearla
   * este endpoint queda cerrado sin tocar código. Hasta entonces cada corrida sin proteger
   * grita por consola y lo dice en la respuesta — el agujero es visible, no silencioso.
   *
   * Con multi-empresa el argumento de "el riesgo es bajo" se debilita: son 2 llamadas **por
   * empresa** por corrida.
   */
  const secreto = process.env.CRON_SECRET;
  const protegido = Boolean(secreto);
  if (secreto && req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ ok: false, error: "Solo el cron de Vercel." });
  }
  if (!protegido) {
    console.error(
      "[citas-respaldo] CORRIENDO SIN PROTECCIÓN: falta CRON_SECRET en Vercel. " +
        "Cualquiera con la URL puede dispararlo. Definir la variable lo cierra sin desplegar.",
    );
  }

  if (env.ghlModo() === "stub") {
    return res.status(200).json({ ok: true, corrio: false, motivo: "Modo stub." });
  }

  try {
    const { desde, hasta } = rangoRespaldo();
    const sync = await sincronizarCitas(desde, hasta);
    const refrescados = await refrescarContactosProximos();

    return res.status(200).json({ ok: true, corrio: true, protegido, rango: { desde, hasta }, ...sync, refrescados });
  } catch (e) {
    return res.status(502).json({ ok: false, error: (e as Error).message });
  }
}
