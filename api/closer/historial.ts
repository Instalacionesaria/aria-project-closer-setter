/**
 * `GET /api/closer/historial?ghlContactId=...` — el tab Historial de la ficha.
 *
 * ── Solo lectura, y a propósito ──
 *
 * No hay POST. El historial es un timeline inmutable (§7) que escriben los CASOS DE USO, no
 * las personas: registrar un seguimiento escribe su evento dentro de la misma transacción que
 * lo crea (`closer_registrar_seguimiento`), y los webhooks de GHL escriben los suyos con autor
 * `Sistema`. Un endpoint para agregar eventos a mano permitiría un historial que no
 * corresponde a nada que haya pasado — que es exactamente lo que la tabla existe para impedir.
 *
 * La base lo respalda: un trigger rechaza todo UPDATE (la historia no se reescribe), y un
 * CHECK impide que un evento firmado como `sistema` lleve otro nombre que `Sistema` — §2 como
 * constraint y no como buena intención.
 *
 * ── Los eventos viajan crudos ──
 *
 * `texto` sí viene resuelto de la base (así lo define la migración 001: el front no compone
 * strings de historial desde un payload), pero la fecha va en ISO y el autor es un nombre
 * suelto. Agrupar por día, decir "hace 2h" o pintar el ícono según `tipo` es de la vista.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { acotarLimite, leerEventos } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

/**
 * Cuántos eventos devuelve una lectura sin `?limite=`. Más alto que el de notas porque un
 * contacto acumula eventos sin hacer nada —cada toque de la serie, cada mensaje— mientras que
 * las notas las escribe una persona de a una.
 */
const EVENTOS_POR_DEFECTO = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  /**
   * `tecnico` entra desde el 2026-08-15, decisión de Fabio.
   *
   * Esta ficha se abre desde **Auditoría de Agentes**, que es una pantalla de rol `tecnico`
   * (`App.tsx`). Sin este rol acá, quien audita abría la ficha de una persona real y veía los tabs
   * vacíos: el 403 se lo tragaba el `catch` del front y parecía "este contacto no tiene nada".
   *
   * No es un permiso nuevo en el producto: `closer/llamadas.ts` ya lo tenía por exactamente el
   * mismo motivo —el tab Llamada de esta misma ficha— y los otros cuatro endpoints se quedaron
   * atrás. Lo que se corrige es la incoherencia, no la política.
   */
  const ctx = await exigir(req, res, ["closer", "setter", "tecnico"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      ok: false,
      codigo: "solo_lectura",
      error:
        "Solo GET: el historial es append-only y lo escriben los casos de uso, no el usuario.",
    });
  }

  const ghlContactId = contactoDeLaQuery(req);
  if (!ghlContactId)
    return res
      .status(400)
      .json({
        ok: false,
        codigo: "contacto_faltante",
        error: "Falta ghlContactId.",
      });

  try {
    const eventos = await leerEventos(
      ghlContactId,
      acotarLimite(unParametro(req.query.limite), EVENTOS_POR_DEFECTO),
    );

    return res.status(200).json({
      ok: true,
      ghlContactId,
      // El cero viaja igual; ocultarlo o pintar el estado vacío es decisión de la vista (§4.1).
      count: eventos.length,
      eventos,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/** Mismo criterio que `/api/closer/notas`: `ghlContactId` es el canónico, `contactId` el alias. */
function contactoDeLaQuery(req: VercelRequest): string | undefined {
  const v =
    unParametro(req.query.ghlContactId) ?? unParametro(req.query.contactId);
  return v?.trim() || undefined;
}

/** Un querystring repetido (`?limite=1&limite=2`) llega como array; se toma el primero. */
function unParametro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
