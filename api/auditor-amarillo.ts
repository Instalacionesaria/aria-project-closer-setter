/**
 * `GET /api/auditor-amarillo` — el cron diario del carril amarillo (ESPEC §1.2).
 *
 * Una pasada por empresa activa, misma estructura que `meta-respaldo` y `citas-respaldo`: falla
 * cerrado sin `CRON_SECRET`, un `try` por iteración, 207 si alguna falló. Reescribirlo distinto
 * sería mantener dos patrones para el mismo problema.
 *
 * ── Las 16:00 de Lima, y por qué esa hora ─────────────────────────────
 *
 * Le deja al técnico el resto de la jornada para aplicar el ajuste. Un aviso a las 23:00 se lee al
 * día siguiente, cuando el patrón ya corrió doce horas más.
 *
 * En UTC son las 21:00 — Lima es UTC-5 todo el año, sin horario de verano. El cron es uno solo y
 * dispara a una hora fija, pero **el borde del día se calcula en la zona de cada empresa**
 * (`env.zonaHoraria()`): una empresa en otro huso recibe su aviso a las 21:00 UTC igual, y "hoy"
 * significa su hoy, no el de Lima.
 *
 * ── El costo, que es el punto ─────────────────────────────────────────
 *
 * Como máximo **una llamada al modelo por empresa y por día**, y la mayoría de los días ninguna:
 * elegir a quién mirar se hace sobre `closer_mensajes`, y el descarte por `(error_code, agente,
 * prompt_hash)` corta antes de gastar cuando el patrón ya está reportado.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { conCredenciales, organizacionesActivas, resolverCredenciales } from "./_lib/credenciales.js";
import { pasadaAmarilla } from "./_lib/auditor/amarilloDiario.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Falla CERRADO. Sin la variable no corre: mejor un cron caído y visible que uno abierto.
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error("[auditor-amarillo] CRON_SECRET sin configurar: se rechaza todo hasta que exista.");
    return res.status(503).json({ ok: false, error: "CRON_SECRET sin configurar en el servidor." });
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ ok: false, error: "Solo el cron de Vercel." });
  }

  let organizaciones: string[];
  try {
    organizaciones = await organizacionesActivas();
  } catch (e) {
    console.error(`[auditor-amarillo] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  const porEmpresa: Record<string, unknown> = {};
  let fallaron = 0;

  for (const orgId of organizaciones) {
    try {
      const cred = await resolverCredenciales(orgId);

      /**
       * Una empresa sin key de Anthropic se saltea DICIÉNDOLO. Es el estado normal de un cliente
       * recién dado de alta, y confundirlo con un fallo haría que el 207 perdiera significado.
       */
      if (!cred.anthropicKey) {
        porEmpresa[cred.nombre] = { corrio: false, motivo: "sin key de Anthropic cargada" };
        continue;
      }

      // `conCredenciales` (run) y no `activar` (enterWith): cierra el contexto al terminar, así
      // dos iteraciones no se pisan.
      porEmpresa[cred.nombre] = await conCredenciales(cred, () => pasadaAmarilla());
    } catch (e) {
      fallaron++;
      porEmpresa[orgId] = { corrio: false, error: (e as Error).message };
      console.error(`[auditor-amarillo] empresa ${orgId}: ${(e as Error).message}`);
    }
  }

  const estado = fallaron === 0 ? 200 : 207;
  return res.status(estado).json({ ok: fallaron === 0, empresas: organizaciones.length, fallaron, porEmpresa });
}
