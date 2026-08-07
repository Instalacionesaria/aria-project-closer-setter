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
import { conCredenciales, organizacionesActivas, resolverCredenciales } from "../_lib/credenciales.js";

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

  // El freno manual sigue siendo global: `GHL_MODO=stub` corta el cron entero, para todas.
  // Se lee de `process.env` y no de `env.ghlModo()` porque ese ahora depende de la empresa
  // activa, y acá todavía no hay ninguna — la decisión de saltear se toma por empresa, abajo.
  if (process.env.GHL_MODO === "stub") {
    return res.status(200).json({ ok: true, corrio: false, motivo: "Modo stub." });
  }

  /**
   * ── Una pasada por cada empresa activa (§6.2) ─────────────────────────
   *
   * Hasta el 2026-08-07 esto resolvía `ORG_PRINCIPAL` y corría una sola vez: la agenda de
   * cualquier otra empresa no se reconciliaba nunca. Y como este cron es además **la vía de
   * alta de contactos nuevos** cuando no hay webhook configurado, sus contactos tampoco
   * aparecían. No fallaba — simplemente no existían, que es peor de detectar.
   */
  let organizaciones: string[];
  try {
    organizaciones = await organizacionesActivas();
  } catch (e) {
    console.error(`[citas-respaldo] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  const { desde, hasta } = rangoRespaldo();
  const porEmpresa: Record<string, unknown> = {};
  let fallaron = 0;

  for (const orgId of organizaciones) {
    /**
     * ── Una empresa que falla NO se lleva puestas a las demás ───────────
     *
     * Sin este `try` por iteración, una empresa con el PIT vencido cortaba el bucle y las que
     * vinieran después se quedaban sin sincronizar. El síntoma sería "la agenda de la empresa D
     * no se actualiza", que no se parece en nada a la causa. Cada una reporta lo suyo.
     */
    try {
      const cred = await resolverCredenciales(orgId);

      /**
       * El corte por credenciales va DENTRO del bucle y le pregunta a la empresa, no al
       * entorno: una empresa recién creada todavía no tiene PIT, y lo correcto es saltearla
       * diciéndolo — no que herede el token de ARIA, que es lo que hacía el `env.ghlModo()`
       * global de antes.
       */
      if (!cred.ghlPit || !cred.ghlLocationId) {
        porEmpresa[cred.nombre] = { corrio: false, motivo: "sin credenciales de GHL cargadas" };
        continue;
      }

      /**
       * El calendario es su propio corte, separado del PIT, porque es su propia falla: una
       * empresa puede tener el token bien y el calendario sin cargar. Se dice cuál de las dos
       * cosas falta en vez de un "sin credenciales" que manda a revisar la equivocada.
       *
       * `ghl_calendario_id` es por empresa desde la `027`. Era una variable de entorno global, y
       * mientras lo fue el cron le habría pedido a cada empresa los eventos del calendario de
       * ARIA con su propio token — 404, o peor, cero citas sin explicación.
       */
      if (!cred.ghlCalendarioId) {
        porEmpresa[cred.nombre] = {
          corrio: false,
          motivo: "sin calendario de GHL cargado — se configura en Ajustes › Credenciales",
        };
        continue;
      }

      /**
       * `conCredenciales` usa `almacen.run()`, que abre el contexto y lo **cierra** al resolver
       * la promesa. Es lo que hace que dos iteraciones no se pisen: con `activar()`
       * (`enterWith`) el contexto quedaría vivo después de la iteración y la empresa siguiente
       * podría leer el de la anterior.
       */
      porEmpresa[cred.nombre] = await conCredenciales(cred, async () => {
        const sync = await sincronizarCitas(desde, hasta);
        const refrescados = await refrescarContactosProximos();
        return { corrio: true, ...sync, refrescados };
      });
    } catch (e) {
      fallaron++;
      porEmpresa[orgId] = { corrio: false, error: (e as Error).message };
      console.error(`[citas-respaldo] empresa ${orgId}: ${(e as Error).message}`);
    }
  }

  /**
   * 207 cuando alguna falló. No es un éxito —§4.2: nunca reportar un éxito que no ocurrió— y
   * tampoco un fracaso, porque las demás sí corrieron. El cuerpo dice cuál fue cuál.
   */
  const estado = fallaron === 0 ? 200 : 207;
  return res.status(estado).json({
    ok: fallaron === 0,
    corrio: true,
    rango: { desde, hasta },
    empresas: organizaciones.length,
    fallaron,
    porEmpresa,
  });
}
