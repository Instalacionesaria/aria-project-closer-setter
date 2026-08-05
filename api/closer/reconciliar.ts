/**
 * `POST /api/closer/reconciliar` — el "reloj de 10 segundos" de la ingesta de mensajes.
 *
 * ## Por qué lo dispara el frontend y manda el backend
 *
 * Vercel es serverless: no existe un proceso residente que corra cada 10s, y los crons
 * tienen granularidad mínima de 1 minuto. Decisión de Fabio (2026-07-31): el frontend pinga
 * este endpoint cada 10s SOLO con la pestaña visible, y un candado en `closer_org_config`
 * garantiza que corra a lo sumo una vez por ventana aunque haya N pestañas o N closers —
 * el reloj efectivo vive acá, no en el navegador. Con la app cerrada, ingiere el webhook.
 *
 * ## El candado (claim atómico)
 *
 * `update ... set ultima_reconciliacion = now() where ultima_reconciliacion < now() - 10s
 * returning` — cero filas devueltas = otro request ya corrió hace <10s → se responde
 * `{corrio: false}` sin gastar NI UNA llamada a GHL. Es un UPDATE condicional, no un
 * SELECT+UPDATE: dos requests simultáneos no pueden ganar los dos.
 *
 * ## La marca de agua (por qué 15.000 conversaciones no cuestan 15.000 llamadas)
 *
 * Verificado contra la cuenta real (2026-07-31): el `tags=` del search SE IGNORA, así que
 * no se puede pedir "solo las de zona_closer". En su lugar: el search viene ordenado por
 * último mensaje DESC, y se camina solo hasta cruzar `reconciliacion_marca_agua` (el
 * lastMessageDate más nuevo ya procesado). Entre ciclo y ciclo solo aparecen por encima de
 * la marca las conversaciones con mensajes NUEVOS — el costo es O(actividad en 10s), no
 * O(tamaño de la cuenta). El ruido de Instagram se salta gratis: sus contactos no están en
 * `closer_contactos`.
 *
 * ## Presupuesto (§9 del doc): 1 llamada en reposo, 1 + 2×cambiados con actividad
 *
 * Por cada conversación nueva de un contacto DEL TERRITORIO: 1× messages + (si hace falta)
 * el refresh de tags que ya hace `asegurarContacto` para desconocidos. Los `congelado` se
 * saltean sin gastar nada (§7).
 *
 * ## Lo que NO hace
 *
 * No llama al analizador de Kevin (eso es exclusivo del webhook — colgarlo de un bucle de
 * 10s convertiría cada ciclo con actividad en una inferencia de ~$0,02). No crea contactos
 * desconocidos (decisión de Fabio: el alta llega por cita; un contacto sin fila acá es casi
 * seguro ruido de IG).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { esMensajeDeChat, mensajesDeConversacion } from "../_lib/ghl/lectura.js";
import { autorDeMensajeGhl } from "../_lib/autoria.js";
import {
  efectosDeEntrante,
  guardarMensajes,
  paginaDeConversaciones,
  type ContactoCacheado,
  type MensajeNormalizado,
} from "../_lib/ingesta.js";
import { env } from "../_lib/env.js";
import { ORG_ID, db } from "../_lib/repo.js";

/** La ventana del candado. El frontend pinga cada 10s; correr más seguido no aporta nada. */
const VENTANA_MS = 10_000;

/** Tamaño de página del search. Sobra: en 10s no entran 50 conversaciones nuevas. */
const POR_PAGINA = 50;

/**
 * Techo de páginas a caminar por ciclo. No es el caso esperado (1 página alcanza casi
 * siempre): es el freno si la marca de agua quedó vieja — p. ej. la primera corrida, o tras
 * horas sin nadie usando la app. Lo que quede detrás del techo se recupera en los ciclos
 * siguientes, porque la marca solo avanza hasta donde se leyó.
 */
const TOPE_PAGINAS = 4;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Usá POST." });
  }

  if (env.ghlModo() === "stub") {
    return res.status(200).json({ ok: true, corrio: false, motivo: "Modo stub: no hay GHL que reconciliar." });
  }

  /* ── 1. El candado (RPC — migración 012) ───────────────────────────── */
  // Era un `.update().or(...)` de PostgREST y falló en producción con 42703 "column does
  // not exist" pese a que la columna existe y el SELECT funciona (réplica con schema cache
  // viejo tras el ALTER de 011). La RPC esquiva el camino de filtros por completo y deja el
  // claim en UNA sentencia atómica del lado de Postgres.
  const { data: claim, error: errClaim } = await db().rpc("closer_reconciliar_claim", {
    p_org_id: ORG_ID,
    p_ventana_segundos: Math.round(VENTANA_MS / 1000),
  });

  if (errClaim) return res.status(500).json({ ok: false, error: `candado: ${errClaim.message}` });
  const fila = Array.isArray(claim) ? claim[0] : claim;
  if (!fila?.gano) {
    // Otro request (otra pestaña, otro usuario) corrió hace menos de 10s. Es el camino
    // feliz de la concurrencia, no un error: N pestañas = el mismo costo que una.
    return res.status(200).json({ ok: true, corrio: false, motivo: "Ya corrió hace <10s." });
  }

  const marcaAgua = fila.marca_agua ? new Date(fila.marca_agua).getTime() : 0;

  try {
    /* ── 2. Los contactos del territorio, desde la caché (0 llamadas) ──── */
    const { data: filas, error: errContactos } = await db()
      .from("closer_contactos")
      .select("ghl_contact_id, tags, congelado, buzon_resuelto_el, last_message_ghl_at")
      // Con una sola org el comportamiento no cambia, pero es lo que vuelve elegibles los
      // índices compuestos `(org_id, …)` que ya existen — sin WHERE ningún índice puede
      // ayudar, y esta query corre cada 10 segundos.
      .eq("org_id", ORG_ID)
      .limit(2000);
    if (errContactos) throw new Error(`closer_contactos: ${errContactos.message}`);

    const porId = new Map<string, ContactoCacheado>();
    for (const f of (filas ?? []) as ContactoCacheado[]) porId.set(f.ghl_contact_id, f);

    /* ── 3. Caminar el search por marca de agua ────────────────────────── */
    let llamadasGhl = 0;
    let marcaNueva = marcaAgua;
    const cambiadas: { conversationId: string; contacto: ContactoCacheado; lastMessageDate: number }[] = [];

    let startAfterDate: number | undefined;
    for (let pagina = 0; pagina < TOPE_PAGINAS; pagina++) {
      const conversaciones = await paginaDeConversaciones({ limit: POR_PAGINA, startAfterDate });
      llamadasGhl++;
      if (conversaciones.length === 0) break;

      let cruzoLaMarca = false;
      for (const conv of conversaciones) {
        if (conv.lastMessageDate <= marcaAgua) {
          cruzoLaMarca = true;
          break;
        }
        marcaNueva = Math.max(marcaNueva, conv.lastMessageDate);

        const contacto = porId.get(conv.contactId);
        if (!contacto) continue; // fuera del territorio (casi seguro ruido de IG) — gratis
        if (contacto.congelado) continue; // §7: ni una llamada por él

        // ¿De verdad hay algo nuevo? El webhook pudo haberlo traído ya.
        const yaVisto = contacto.last_message_ghl_at ? new Date(contacto.last_message_ghl_at).getTime() : 0;
        if (conv.lastMessageDate <= yaVisto) continue;

        cambiadas.push({ conversationId: conv.id, contacto, lastMessageDate: conv.lastMessageDate });
      }

      if (cruzoLaMarca || conversaciones.length < POR_PAGINA) break;
      startAfterDate = conversaciones[conversaciones.length - 1].lastMessageDate;
    }

    /* ── 4. Solo para las cambiadas: traer mensajes, upsert, efectos ───── */
    let mensajesNuevos = 0;
    for (const { conversationId, contacto, lastMessageDate } of cambiadas) {
      const crudos = await mensajesDeConversacion(conversationId);
      llamadasGhl++;

      /**
       * `esMensajeDeChat` dejó de exigir `body` (§54: un audio de WhatsApp es un mensaje que
       * existió, y el auditor tiene que verlo). Acá se sigue exigiendo, y a propósito: el
       * caché alimenta el tab Chat de la ficha, donde una burbuja vacía no comunica nada. El
       * marcador `[nota de voz…]` es una decisión del transcript del auditor, que lee de GHL
       * directo — no un dato que corresponda guardar como si fuera el texto del mensaje.
       */
      const normalizados: MensajeNormalizado[] = crudos
        .filter((m) => esMensajeDeChat(m) && Boolean(m.body))
        .map((m) => ({
          id: String(m.id),
          ghlContactId: contacto.ghl_contact_id,
          conversationId,
          direccion: m.direction === "inbound" ? ("inbound" as const) : ("outbound" as const),
          body: String(m.body ?? ""),
          timestampGhl: new Date(m.dateAdded ?? lastMessageDate).toISOString(),
          // Esta vía trae el payload completo de GHL, así que es la que clasifica BIEN.
          // La del webhook casi nunca tiene `source` y cae en `desconocido`; cuando el
          // gemelo real entra por acá, reemplaza al fabricado y corrige la autoría.
          autor: autorDeMensajeGhl(m),
        }));

      const nuevos = await guardarMensajes(normalizados);
      mensajesNuevos += nuevos;

      // El más reciente decide los efectos: si es entrante y es NUEVO (el webhook no lo
      // trajo), se disparan los mismos efectos que dispararía el webhook. El upsert
      // idempotente ya resolvió el doble origen — `nuevos === 0` significa que todo esto
      // ya pasó por la otra vía.
      const ultimo = normalizados[0];
      const marcaIso = new Date(lastMessageDate).toISOString();
      await db()
        .from("closer_contactos")
        .update({
          last_message_ghl_at: marcaIso,
          ...(ultimo && ultimo.direccion === "outbound" ? { ultimo_saliente_el: ultimo.timestampGhl } : {}),
        })
        .eq("ghl_contact_id", contacto.ghl_contact_id);

      if (nuevos > 0 && ultimo && ultimo.direccion === "inbound") {
        await efectosDeEntrante(contacto.ghl_contact_id, ultimo.body, ultimo.timestampGhl);
      }
    }

    /* ── 5. Avanzar la marca de agua (RPC, misma razón que el candado) ──── */
    if (marcaNueva > marcaAgua) {
      await db().rpc("closer_reconciliar_marca", {
        p_org_id: ORG_ID,
        p_marca: new Date(marcaNueva).toISOString(),
      });
    }

    return res.status(200).json({
      ok: true,
      corrio: true,
      cambiadas: cambiadas.length,
      mensajesNuevos,
      llamadasGhl,
    });
  } catch (e) {
    // El candado ya quedó tomado por esta ventana — no se libera: reintentar en caliente
    // duplicaría llamadas justo cuando GHL puede estar fallando. El próximo ciclo (≤10s)
    // reintenta solo, y la marca de agua no avanzó, así que no se pierde nada.
    return res.status(502).json({ ok: false, corrio: true, error: (e as Error).message });
  }
}
