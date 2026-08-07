/**
 * `GET /api/meta-respaldo` — el cron diario de Meta (ESPEC §9.1).
 *
 * Una pasada por empresa activa, igual que `citas-respaldo`. La estructura es la misma a propósito:
 * un cron que recorre empresas es un patrón del proyecto ya resuelto —falla cerrado sin
 * `CRON_SECRET`, un `try` por iteración, 207 si alguna falló— y reescribirlo distinto acá sería
 * mantener dos.
 *
 * Diario y no cada hora: Meta agrega por día y sus cifras del día en curso están incompletas. Más
 * frecuencia no daría más precisión, solo más llamadas.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { conCredenciales, organizacionesActivas, resolverCredenciales } from "./_lib/credenciales.js";
import { sincronizarMeta } from "./_lib/meta/colector.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · Falla CERRADO. Sin la variable no corre: mejor un cron caído y visible que uno abierto.
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error("[meta-respaldo] CRON_SECRET sin configurar: se rechaza todo hasta que exista.");
    return res.status(503).json({ ok: false, error: "CRON_SECRET sin configurar en el servidor." });
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ ok: false, error: "Solo el cron de Vercel." });
  }

  let organizaciones: string[];
  try {
    organizaciones = await organizacionesActivas();
  } catch (e) {
    console.error(`[meta-respaldo] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  const porEmpresa: Record<string, unknown> = {};
  let fallaron = 0;

  for (const orgId of organizaciones) {
    try {
      const cred = await resolverCredenciales(orgId);

      /**
       * Una empresa sin credenciales de Meta se saltea DICIÉNDOLO, no en silencio: es el estado
       * normal de cualquier cliente que todavía no conectó su cuenta publicitaria, y confundirlo
       * con un fallo haría que el 207 de abajo perdiera significado.
       */
      if (!cred.metaToken || !cred.metaAdAccountId) {
        porEmpresa[cred.nombre] = { corrio: false, motivo: "sin credenciales de Meta cargadas" };
        continue;
      }

      // `conCredenciales` (run) y no `activar` (enterWith): cierra el contexto al terminar, así dos
      // iteraciones no se pisan.
      porEmpresa[cred.nombre] = await conCredenciales(cred, () => sincronizarMeta());
    } catch (e) {
      fallaron++;
      porEmpresa[orgId] = { corrio: false, error: (e as Error).message };
      console.error(`[meta-respaldo] empresa ${orgId}: ${(e as Error).message}`);
    }
  }

  const estado = fallaron === 0 ? 200 : 207;
  return res.status(estado).json({ ok: fallaron === 0, empresas: organizaciones.length, fallaron, porEmpresa });
}
