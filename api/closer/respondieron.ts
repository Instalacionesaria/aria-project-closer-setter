/**
 * `GET /api/closer/respondieron` — "Respondieron · Buzón General" del closer, con datos reales.
 *
 * Un contacto entra si cumple LAS TRES:
 *   1. está en territorio closer (`perteneceAlCloser`, §11 — el traspaso setter→closer es el
 *      mismo contacto cambiando de dueño);
 *   2. tiene un tag de desenlace de Avanzar (ya pasó por la cabina, no es un lead crudo);
 *   3. su ÚLTIMO mensaje es entrante — el contacto volvió a escribir y nadie le respondió.
 *
 * La condición (3) es la que define el buzón: no agrupa "contactos con mensajes", agrupa
 * DEUDAS de respuesta. Por eso el contacto conserva su píldora de situación (§13): el buzón
 * agrupa mensajes, no cambia categorías.
 *
 * Los nombres de los tags salen de `src/lib/ghl/contrato.ts`, nunca de literales acá — es la
 * misma regla que sigue `real.ts`, y evita que un rename en la subcuenta rompa esto en
 * silencio.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { perteneceAlCloser, TAGS } from "../../src/lib/ghl/contrato.js";
import { ghl } from "../_lib/ghl/index.js";
import {
  contactosConTag,
  conversacionDeContacto,
  esMensajeDeChat,
  mensajesDeConversacion,
} from "../_lib/ghl/lectura.js";

/**
 * Tags de desenlace del closer, en orden de prioridad: si un contacto acumuló varios con el
 * tiempo (el contrato §4 dice que escribir uno nuevo no borra los viejos), gana el primero
 * de esta lista.
 */
const DESENLACES_CLOSER = [
  TAGS.ventaGanada.valor,
  TAGS.adelantoGanado.valor,
  TAGS.noshow.valor,
  TAGS.seguimiento.valor,
  TAGS.nurtureAppflow.valor,
  TAGS.descalificado.valor,
] as const;

/** "hace 2h" a partir de una fecha ISO — el microtexto gris de la fila. */
function haceCuanto(iso: string | undefined): string {
  if (!iso) return "";
  const minutos = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas}h`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} día${dias > 1 ? "s" : ""}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const enZonaCloser = await contactosConTag(TAGS.zonaCloser.valor);

    /**
     * Se revisan en paralelo: cada uno cuesta dos requests a GHL (buscar conversación +
     * traer mensajes) y en serie la cola entera esperaba a que terminara el anterior.
     * Si uno falla, cae a `null` y se descarta — un contacto ilegible no puede dejar sin
     * buzón a los demás.
     */
    const revisados = await Promise.all(
      enZonaCloser.map(async (c) => {
        try {
          if (!perteneceAlCloser(c.tags)) return null;

          const desenlace = DESENLACES_CLOSER.find((t) => c.tags.includes(t));
          if (!desenlace) return null; // (2) todavía no pasó por Avanzar

          const conversationId = await conversacionDeContacto(c.id);
          if (!conversationId) return null;

          // GHL devuelve del más reciente al más antiguo: el [0] es el último mensaje.
          const mensajes = (await mensajesDeConversacion(conversationId)).filter(esMensajeDeChat);
          const ultimo = mensajes[0];
          if (!ultimo) return null;
          if (ultimo.direction !== "inbound") return null; // (3) ya le respondimos

          return {
            contactId: c.id,
            name: c.nombre,
            source: c.fuente,
            outcome: desenlace,
            snippet: (ultimo.body ?? "").slice(0, 80),
            when: haceCuanto(ultimo.dateAdded),
          };
        } catch {
          return null;
        }
      }),
    );

    const contactos = revisados.filter((c): c is NonNullable<typeof c> => c !== null);

    return res.status(200).json({ ok: true, ghlModo: ghl().modo, count: contactos.length, contactos });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
