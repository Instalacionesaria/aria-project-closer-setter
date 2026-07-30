/**
 * `GET /api/closer/respondieron` — "Respondieron · Buzón General" del closer, con datos reales.
 *
 * ## El criterio, tal como lo define el modelo de negocio (Fabio, 2026-07-30)
 *
 * > Buzón general: contactos con `zona_closer` que escribieron un mensaje Y que NO tienen el
 * > bot de IA activo — por eso necesitan que los atienda un humano.
 *
 * Son TRES condiciones, y las tres se aplican acá:
 *   1. **Territorio closer** (`zona_closer`, §11) — el traspaso setter→closer es el mismo
 *      contacto cambiando de dueño.
 *   2. **Su ÚLTIMO mensaje es entrante** — escribió y nadie le respondió. Esta lectura es más
 *      estricta que "escribió un mensaje" a propósito: el buzón no agrupa "contactos con
 *      mensajes", agrupa DEUDAS de respuesta. Si ya le contestamos (humano o bot), la deuda no
 *      existe y la fila desaparece sola.
 *   3. **El bot NO está activo.** Si la IA está trabajando, no hay tarea humana (§40.E). Esta
 *      condición NO se estaba aplicando: el buzón mostraba contactos que el agente iba a
 *      atender igual, y el closer terminaba respondiendo encima del bot.
 *
 * ## Lo que se quitó: el filtro por tag de desenlace
 *
 * Hasta el 2026-07-30 se exigía además un tag de desenlace de Avanzar (venta_ganada,
 * seguimiento, noshow…). Ese criterio no existe en el modelo y dejaba invisible justo al caso
 * que más duele: el contacto en la etapa de ENTRADA. El modelo es explícito — "`agendado` es
 * la etapa de entrada: el contacto que tiene zona_closer y todavía no recibió ningún Avanzar
 * cae ahí". Con el filtro viejo, ese contacto podía escribir con el bot apagado y no aparecer
 * en NINGUNA cola.
 *
 * El desenlace sigue viajando en la respuesta (`desenlace`), porque la píldora se arma con él;
 * lo que ya no hace es decidir quién entra.
 *
 * ## Solapamiento con Urgentes: se resuelve excluyendo, no duplicando
 *
 * `bot_pausado_fallo` también apaga el bot, así que por el criterio 3 entraría acá — pero ese
 * contacto YA está en Intervenciones Urgentes (`/api/closer/urgentes`), que es una cola con su
 * propio flujo: banner rojo, mensaje manual obligatorio y botón "Marcar como Resuelto" (§22).
 * Aparecer en dos colas a la vez haría que atender una no cierre la otra, y el closer no
 * sabría cuál es la buena. Gana Urgentes: es la más específica y la que va primero en Mi Día
 * (§6.A). El contrato lo dice igual (§0): "tag `bot_pausado_fallo` → Urgentes".
 * Cuántos se excluyeron por eso viaja en `descartados.enUrgentes`, para poder responder "¿por
 * qué no aparece este contacto?" sin abrir GHL.
 *
 * Los nombres de los tags de resultado salen de `src/lib/ghl/contrato.ts`, nunca de literales
 * acá — evita que un rename en la subcuenta rompa esto en silencio.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { perteneceAlCloser, TAGS } from "../../src/lib/ghl/contrato.js";
import { ghl } from "../_lib/ghl/index.js";
import {
  contactosConTag,
  conversacionDeContacto,
  esMensajeDeChat,
  mensajesDeConversacion,
  type ContactoConTag,
} from "../_lib/ghl/lectura.js";

/**
 * Tags de desenlace del closer, en orden de prioridad: si un contacto acumuló varios con el
 * tiempo (el contrato §4 dice que escribir uno nuevo no borra los viejos), gana el primero
 * de esta lista. Ya no filtra — solo informa cuál mostrar en la píldora.
 */
const DESENLACES_CLOSER = [
  TAGS.ventaGanada.valor,
  TAGS.adelantoGanado.valor,
  TAGS.noshow.valor,
  TAGS.seguimiento.valor,
  TAGS.nurtureAppflow.valor,
  TAGS.descalificado.valor,
] as const;

/**
 * Estado del agente de IA, derivado de los tags. Son los mismos seis valores que usa
 * `BotEstado` en el front, menos `pausa_temporal`: el contrato §9 aclara que ESE no existe
 * como tag (la pausa al intervenir a mano es el auto-pause nativo del agente, 2h de config),
 * así que desde GHL es indistinguible de `activo` y no se puede reportar sin inventarlo.
 */
export type EstadoBot = "activo" | "pausado_fallo" | "apagado_manual" | "muerto_postcall" | "derivado_lt" | "sin_bot";

/**
 * Los interruptores del bot — CONTRATO-GHL §9 ("Interruptores del bot" y "Ruteo y
 * derivaciones"). El orden importa: un contacto puede acumular varios y gana el primero.
 * `bot_pausado_fallo` va primero porque es el que decide el ruteo a Urgentes.
 *
 * ⚠️ Duplica el mapa de `botDesdeTags()` en `api/_lib/contactos.ts`, que hoy es privado de ese
 * módulo. Es una duplicación conocida y anotada: son los mismos literales leídos del mismo
 * contrato, y unificarlos exige exportar esa función (archivo de otro frente).
 */
const TAGS_BOT_APAGADO: ReadonlyArray<readonly [string, EstadoBot]> = [
  ["bot_pausado_fallo", "pausado_fallo"],
  ["bot_desactivado_postcall", "muerto_postcall"],
  ["bot_apagado_manual", "apagado_manual"],
  ["derivado_lt", "derivado_lt"],
];

/** Instagram no tiene agente (§11): ahí TODO mensaje entrante es tarea humana, sin tag de por medio. */
const FUENTE_SIN_BOT = "📷 IG PROFILE";

/**
 * ¿Está el agente atendiendo a este contacto?
 *
 * Se decide SOLO con los tags que ya trajo la búsqueda — cero requests extra. Eso además
 * permite descartar antes de gastar las dos llamadas a GHL de la conversación.
 *
 * `bot_reactivar` (§9) se ignora a propósito. Reactiva el agente, pero el contrato no dice si
 * al hacerlo se quitan los tags de apagado, así que usarlo para dar por activo a un contacto
 * que conserva un tag de apagado significaría, cuando la suposición falle, un contacto que
 * escribió y no aparece en ninguna cola: un lead perdido en silencio. El error contrario es
 * barato y se corrige solo — si el bot de verdad está activo, contesta, el último mensaje pasa
 * a saliente y la fila se cae del buzón sin que nadie haga nada.
 */
function estadoDelBot(c: ContactoConTag): EstadoBot {
  const apagado = TAGS_BOT_APAGADO.find(([tag]) => c.tags.includes(tag));
  if (apagado) return apagado[1];
  // Después de los tags: un `bot_pausado_fallo` sobre una conversación de IG igual tiene que
  // rutear a Urgentes, igual que hace `/api/closer/urgentes`, que no mira el canal.
  if (c.fuente === FUENTE_SIN_BOT) return "sin_bot";
  return "activo";
}

/** Por qué un contacto de `zona_closer` no llegó al buzón. Solo para el conteo de diagnóstico. */
type MotivoDescarte =
  | "fueraDeZonaCloser"
  | "botActivo"
  | "enUrgentes"
  | "sinConversacion"
  | "yaRespondido"
  | "ilegible";

interface ContactoBuzon {
  contactId: string;
  name: string;
  source: string;
  /** Tag de desenlace real de GHL, o `null` si todavía no recibió ningún Avanzar (§4.10: no se inventa). */
  desenlace: string | null;
  /**
   * COMPAT — lo consume hoy `CloserAI.tsx` para armar la píldora. Es `desenlace`, y cuando no
   * hay ninguno, la etapa de entrada del modelo (`agendado`): un contacto con `zona_closer` sin
   * Avanzar está, por definición del modelo, en Agendado. No es un tag de GHL; el dato crudo
   * es `desenlace`. Se mantiene para no romper el front, que hoy hace `outcome.toUpperCase()`.
   */
  outcome: string;
  /** Por qué necesita un humano. Crudo — el color y el tooltip los pone la vista. */
  botEstado: EstadoBot;
  snippet: string;
  /** ISO del último mensaje entrante. Es el dato; `when` es su presentación. */
  ultimoMensajeEl: string | null;
  /** COMPAT — "hace 2h" ya formateado. Debería derivarlo el front desde `ultimoMensajeEl`. */
  when: string;
}

type Revision = { ok: true; contacto: ContactoBuzon } | { ok: false; motivo: MotivoDescarte };

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

async function revisar(c: ContactoConTag): Promise<Revision> {
  try {
    // (1) Territorio. Redundante con la búsqueda por tag, y explícito a propósito: es un
    // criterio del modelo y tiene que verse aplicado, no deducirse de qué query se usó.
    if (!perteneceAlCloser(c.tags, true)) return { ok: false, motivo: "fueraDeZonaCloser" };

    // (3) El bot. Va antes que la conversación porque no cuesta ningún request: descartar acá
    // ahorra las dos llamadas a GHL por contacto que antes se pagaban siempre.
    const botEstado = estadoDelBot(c);
    if (botEstado === "activo") return { ok: false, motivo: "botActivo" };
    if (botEstado === "pausado_fallo") return { ok: false, motivo: "enUrgentes" };

    // (2) La deuda de respuesta.
    const conversationId = await conversacionDeContacto(c.id);
    if (!conversationId) return { ok: false, motivo: "sinConversacion" };

    // GHL devuelve del más reciente al más antiguo: el [0] es el último mensaje.
    const mensajes = (await mensajesDeConversacion(conversationId)).filter(esMensajeDeChat);
    const ultimo = mensajes[0];
    if (!ultimo) return { ok: false, motivo: "sinConversacion" };
    if (ultimo.direction !== "inbound") return { ok: false, motivo: "yaRespondido" };

    const desenlace = DESENLACES_CLOSER.find((t) => c.tags.includes(t)) ?? null;

    return {
      ok: true,
      contacto: {
        contactId: c.id,
        name: c.nombre,
        source: c.fuente,
        desenlace,
        outcome: desenlace ?? "agendado",
        botEstado,
        snippet: (ultimo.body ?? "").slice(0, 80),
        ultimoMensajeEl: ultimo.dateAdded ?? null,
        when: haceCuanto(ultimo.dateAdded),
      },
    };
  } catch {
    // Un contacto ilegible no puede dejar sin buzón a los demás. Se cuenta, no se esconde.
    return { ok: false, motivo: "ilegible" };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const enZonaCloser = await contactosConTag(TAGS.zonaCloser.valor);

    /**
     * En paralelo: cada contacto que sobrevive al filtro de bot cuesta dos requests a GHL
     * (buscar conversación + traer mensajes), y en serie la cola entera esperaba al anterior.
     */
    const revisados = await Promise.all(enZonaCloser.map(revisar));

    const contactos = revisados.filter((r): r is Extract<Revision, { ok: true }> => r.ok).map((r) => r.contacto);

    /**
     * Cuántos quedaron afuera y por qué. No se muestra en la cola: viaja para poder contestar
     * "¿por qué no aparece este contacto?" sin abrir GHL, igual que `fueraDeZonaCloser` en
     * `/api/closer/urgentes`. `botActivo` es el número que dice cuánto trabajo se está
     * ahorrando el closer porque la IA lo está haciendo.
     */
    const descartados: Record<MotivoDescarte, number> = {
      fueraDeZonaCloser: 0,
      botActivo: 0,
      enUrgentes: 0,
      sinConversacion: 0,
      yaRespondido: 0,
      ilegible: 0,
    };
    for (const r of revisados) if (!r.ok) descartados[r.motivo]++;

    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      revisados: enZonaCloser.length,
      count: contactos.length,
      contactos,
      descartados,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
