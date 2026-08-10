/**
 * `GET /api/territorio-respaldo` — el barrido de territorio, programado (cada 2 h).
 *
 * ── El agujero que cierra ─────────────────────────────────────────────
 *
 * `sincronizarTerritorio()` es lo único que mantiene tres cosas: los **tags** de un contacto ya
 * cacheado, la columna **`congelado`** y la **pertenencia a un territorio**. Y hasta hoy corría
 * solo cuando alguien apretaba "Sincronizar CRM" en el Pipeline.
 *
 * ── Medido contra producción, no supuesto (2026-08-10) ───────────────
 *
 * Se compararon los tags de los **22 contactos** de la caché contra los de GHL, uno por uno:
 *
 *     coinciden 12 · divergen 10
 *
 * Y divergen siempre en la misma dirección: **faltan en la caché**, nunca sobran. Tags que GHL
 * aplicó y que acá nunca llegaron — `cita_agendada` en cinco contactos, cinco tags de resultado de
 * llamada en otro, y `bot_pausado_fallo` en `Quiroz Prueba`, que es un tag que escribe **nuestro
 * propio auditor**. Tres más devuelven 400 en GHL: ya no existen ahí y siguen en la caché.
 *
 * El primer diagnóstico fue otro y estaba mal: `ultima_sincronizacion_territorio` decía 2026-08-04,
 * pero resulta que **ninguna parte del código escribía esa columna** — su fecha no probaba nada. De
 * ahí que este handler ahora sí la escriba: una marca que nadie actualiza es peor que no tenerla,
 * porque se lee como un hecho.
 *
 * De la caché de tags salen cuatro derivaciones:
 *
 *   · **El módulo Setter entero.** Sus contactos llegan por este barrido —y por ninguna otra vía—
 *     desde el Bloque C. El día que se publiquen los workflows `🟨 04.1/04.2`, los contactos con
 *     `zona_setter` **no aparecerían** hasta que alguien apretara el botón. Mi Día y el Pipeline se
 *     verían vacíos y la conclusión natural sería "el módulo del setter no funciona".
 *   · **`congelado`**, que decide quién se puede accionar. Un contacto que perdió su territorio
 *     seguía accionable durante días, y uno que lo recuperó seguía inerte.
 *   · **El carril amarillo**, cuyo `elAgenteAtiende()` lee los tags de la caché: con la foto vieja
 *     puede mirar un contacto cuyo bot ya está pausado.
 *   · **La etapa del pipeline** cuando no hay `stage_key` guardado: se deriva de los tags.
 *
 * Nada de esto fallaba. Servía una foto vieja con cara de foto de hoy — el modo de fallar que este
 * proyecto viene pagando desde los prompts que no existían (ver D36).
 *
 * El webhook de GHL refresca **un** contacto cuando llega un evento suyo, y eso tapa el caso
 * frecuente. Lo que no existe es quien relea el conjunto: un tag aplicado por un workflow que no
 * dispara webhook hacia nosotros no tiene ninguna otra vía de entrar.
 *
 * ── Por qué cada 2 h y no cada 15 minutos ─────────────────────────────
 *
 * El barrido cuesta `2 + 1 por contacto activo` llamadas a GHL, y el tope acá es 100 — o sea ~102
 * por empresa y por corrida. Doce corridas diarias son ~1.224 llamadas por empresa contra un
 * presupuesto de 200.000 por subcuenta: **0,6 %**. Cada 15 minutos serían 9.800, que sigue
 * entrando, pero no compra nada: un cambio de territorio lo dispara además el webhook de GHL por
 * contacto. Esto es la red, no el mecanismo principal.
 *
 * El tope de 100 es el mismo que acepta `sincronizarTerritorio` como máximo. Si una empresa tiene
 * más contactos activos que eso, el resultado viene con `truncado: true` y **se reporta**: media
 * verdad silenciosa sobre qué se sincronizó sería peor que no correr.
 *
 * ── Mismo patrón que los otros tres crons ─────────────────────────────
 *
 * Falla cerrado sin `CRON_SECRET`, un `try` por empresa para que una con el PIT vencido no se lleve
 * puestas a las demás, `conCredenciales` y no `activar` (el contexto tiene que cerrarse entre
 * iteraciones), y 207 si alguna falló. Escribirlo distinto sería mantener dos patrones para el
 * mismo problema.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { conCredenciales, organizacionesActivas, resolverCredenciales } from "./_lib/credenciales.js";
import { sincronizarTerritorio } from "./_lib/contactos.js";
import { db } from "./_lib/repo.js";

/** El máximo que acepta `sincronizarTerritorio`. Los congelados no cuestan llamada. */
const TOPE = 100;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Falla CERRADO. Sin la variable no corre: mejor un cron caído y visible que uno abierto.
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error("[territorio-respaldo] CRON_SECRET sin configurar: se rechaza todo hasta que exista.");
    return res.status(503).json({ ok: false, error: "CRON_SECRET sin configurar en el servidor." });
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ ok: false, error: "Solo el cron de Vercel." });
  }

  /**
   * El freno global. Se lee de `process.env` y no de `env.ghlModo()` porque ése depende de la
   * empresa activa y acá todavía no hay ninguna.
   */
  if (process.env.GHL_MODO === "stub") {
    return res.status(200).json({ ok: true, corrio: false, motivo: "Modo stub." });
  }

  let organizaciones: string[];
  try {
    organizaciones = await organizacionesActivas();
  } catch (e) {
    console.error(`[territorio-respaldo] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  const porEmpresa: Record<string, unknown> = {};
  let fallaron = 0;

  for (const orgId of organizaciones) {
    try {
      const cred = await resolverCredenciales(orgId);

      /**
       * El corte le pregunta a la empresa, no al entorno: una recién creada no tiene PIT, y lo
       * correcto es saltearla **diciéndolo** — no que herede el token de otra.
       */
      if (!cred.ghlPit || !cred.ghlLocationId) {
        porEmpresa[cred.nombre] = { corrio: false, motivo: "sin credenciales de GHL cargadas" };
        continue;
      }

      porEmpresa[cred.nombre] = await conCredenciales(cred, async () => {
        const r = await sincronizarTerritorio({ tope: TOPE });

        /**
         * La marca de la última corrida, que **hasta hoy no la escribía nadie**: la columna existía
         * con una fecha del 2026-08-04 que nadie actualizaba, así que leerla daba una
         * respuesta falsa con toda la cara de un dato. Ahora tiene un solo autor.
         *
         * Se sella **solo cuando el barrido de verdad tocó GHL**: un `0 llamadas` —adapter en stub,
         * o empresa sin contactos activos— no es una sincronización, y estamparlo como tal dejaría
         * la columna afirmando que todo está fresco. El mismo error, otra vez.
         */
        if (r.llamadasGhl > 0) {
          await db().from("closer_org_config").update({ ultima_sincronizacion_territorio: new Date().toISOString() });
        }

        return { corrio: true, ...r };
      });
    } catch (e) {
      fallaron++;
      porEmpresa[orgId] = { corrio: false, error: (e as Error).message };
      console.error(`[territorio-respaldo] empresa ${orgId}: ${(e as Error).message}`);
    }
  }

  /**
   * 207 cuando alguna falló: no es un éxito —regla 2— y tampoco un fracaso, porque las demás sí
   * corrieron. El cuerpo dice cuál fue cuál.
   */
  const estado = fallaron === 0 ? 200 : 207;
  return res.status(estado).json({
    ok: fallaron === 0,
    corrio: true,
    tope: TOPE,
    empresas: organizaciones.length,
    fallaron,
    porEmpresa,
  });
}
