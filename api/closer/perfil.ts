/**
 * `GET /api/closer/perfil?ghlContactId=...` — el tab Perfil de la ficha.
 *
 * ── Solo lectura, y GHL es el dueño ──
 *
 * No hay POST. Estos campos los escriben los formularios (VSL, Meta Lead Ads) y los agentes
 * de GHL; el tool los muestra y nada más. Un endpoint para editarlos desde la ficha crearía
 * una segunda verdad sobre la calificación de un lead, que es justo lo que §2 evita al poner
 * a GHL como archivador.
 *
 * ── Nada se cachea en SOFIA ──
 *
 * A diferencia de `closer_contactos` (que sí espeja lo que la app necesita para armar colas y
 * píldoras), el Perfil se lee en vivo contra GHL. Son ~18 campos que solo se miran cuando
 * alguien abre esa pestaña: espejarlos agregaría una tabla que mantener sincronizada y un modo
 * de falla nuevo —mostrar la calificación vieja de un lead que acabó de contestar el
 * formulario— a cambio de ahorrar una llamada que ocurre una vez por ficha abierta.
 *
 * ── Sin GHL no se responde "vacío" ──
 *
 * En modo stub `obtenerContacto` devuelve `null` siempre, porque no hay a quién preguntarle.
 * Contestar `{ ok: true, perfil: [] }` ahí sería decirle al front "este contacto no tiene
 * datos de perfil" cuando lo cierto es que no miramos — la misma mentira que el puerto evita
 * con `aplicado: false`. Se devuelve 503 con el motivo, y el front decide (hoy: se queda con
 * lo que ya tenía, §50.7).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { ghl } from "../_lib/ghl/index.js";
import { perfilDesdeContacto } from "../_lib/ghl/lectura.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      ok: false,
      codigo: "solo_lectura",
      error: "Solo GET: los campos del Perfil los escriben los formularios y los agentes de GHL, no el tool.",
    });
  }

  const ghlContactId = contactoDeLaQuery(req);
  if (!ghlContactId) {
    return res.status(400).json({ ok: false, codigo: "contacto_faltante", error: "Falta ghlContactId." });
  }

  const cliente = ghl();

  try {
    const contacto = await cliente.obtenerContacto(ghlContactId);

    if (!contacto) {
      // Dos causas distintas con la misma pinta desde acá, y conviene no confundirlas: el
      // stub siempre devuelve null (no hay conexión), mientras que en modo real un null es un
      // contacto que de verdad no está o al que el token no llega.
      if (cliente.modo === "stub") {
        return res.status(503).json({
          ok: false,
          codigo: "sin_conexion_ghl",
          modo: cliente.modo,
          error:
            "Adapter en modo stub: no hay conexión con GHL, así que no se leyó nada. " +
            "No se devuelve un perfil vacío para no hacerlo pasar por un contacto sin datos.",
        });
      }

      return res.status(404).json({
        ok: false,
        codigo: "contacto_no_encontrado",
        modo: cliente.modo,
        ghlContactId,
        error: `GHL no devolvió ningún contacto con id ${ghlContactId}.`,
      });
    }

    const perfil = perfilDesdeContacto(contacto);

    return res.status(200).json({
      ok: true,
      ghlContactId: contacto.id,
      modo: cliente.modo,
      // El cero viaja igual: si el contacto no llenó ningún formulario, la respuesta lo dice
      // con una lista vacía y el estado vacío lo pinta la vista (§4.1 / §4.10).
      count: perfil.length,
      perfil,

      /**
       * ⚠️ Alias TRANSITORIO, a borrar. `perfil` es el nombre canónico de esta lista; el
       * cliente del front (`fetchPerfil` en `src/lib/api.ts`) se escribió en paralelo
       * asumiendo `campos`, y su propio comentario dice que ese tipo es lo único a corregir.
       * Va duplicado para no dejar el árbol roto entre dos frentes que avanzaron a la vez.
       *
       * Se saca en cuanto `PerfilResponse` lea `perfil`. Dejarlo indefinidamente es el riesgo
       * que el propio `api.ts` describe para los alias: el alias pasa a ser el nombre de facto
       * y el canónico queda muerto.
       */
      campos: perfil,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/** Mismo criterio que `/api/closer/historial`: `ghlContactId` es el canónico, `contactId` el alias. */
function contactoDeLaQuery(req: VercelRequest): string | undefined {
  const v = unParametro(req.query.ghlContactId) ?? unParametro(req.query.contactId);
  return v?.trim() || undefined;
}

/** Un querystring repetido (`?ghlContactId=a&ghlContactId=b`) llega como array; se toma el primero. */
function unParametro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
