/**
 * El cuerpo de la reconciliación: el "reloj de 10 segundos" de la ingesta de mensajes.
 *
 * Vive acá desde §56 porque tiene dos puntos de entrada: `POST /api/closer/tick` (el reloj
 * real) y `POST /api/closer/reconciliar` (que queda para el curl manual y el diagnóstico).
 *
 * ## El candado (claim atómico)
 *
 * `update ... set ultima_reconciliacion = now() where ultima_reconciliacion < now() - 10s
 * returning` — cero filas devueltas = otro request ya corrió hace <10s → se devuelve
 * `{corrio: false}` sin gastar NI UNA llamada a GHL. Es un UPDATE condicional, no un
 * SELECT+UPDATE: dos requests simultáneos no pueden ganar los dos.
 *
 * ## La marca de agua (por qué 15.000 conversaciones no cuestan 15.000 llamadas)
 *
 * El `tags=` del search SE IGNORA (verificado 2026-07-31), así que no se puede pedir "solo
 * las de zona_closer". En su lugar: el search viene ordenado por último mensaje DESC, y se
 * camina solo hasta cruzar `reconciliacion_marca_agua`. El costo es O(actividad en 10s), no
 * O(tamaño de la cuenta).
 *
 * ## ⚠ TRES INVARIANTES QUE SOSTIENEN LA REENTRANCIA — no son evidentes leyendo el código
 *
 * 1. **`closer_reconciliar_marca` es monotónica del lado de Postgres**
 *    (`greatest(coalesce(actual,'epoch'), p_marca)`, migración 012). Un cuerpo que quedó
 *    colgado y escribe tarde NO puede hacer retroceder la marca.
 * 2. **El paso 5 va al final y solo se alcanza si el paso 4 completó.** Un abandono nunca
 *    puede dejar la marca adelantada sobre trabajo que no se hizo.
 * 3. **`porId` es un snapshot tomado ANTES de las escrituras de este mismo ciclo.** Si
 *    alguien lo recargara entre el paso 3 y el 4, `yaVisto` (L~"¿De verdad hay algo nuevo?")
 *    empezaría a reflejar lo que el propio ciclo acaba de escribir y el paso 4 se
 *    auto-saltearía.
 *
 * **Prohibido, por si tienta:** escribir una marca parcial al vencer el deadline. Los
 * mensajes de ese tramo no se ingerirían jamás — `marcaNueva` avanza ANTES de los filtros,
 * así que cubre también conversaciones que todavía no se procesaron.
 *
 * ## Lo que NO hace
 *
 * No llama al analizador (eso es exclusivo del webhook: colgarlo de un bucle de 10s
 * convertiría cada ciclo con actividad en una inferencia). No crea contactos desconocidos.
 */

import { esMensajeDeChat, mensajesDeConversacion } from "./ghl/lectura.js";
import { autorDeMensajeGhl } from "./autoria.js";
import {
  actualizarEstados,
  efectosDeEntrante,
  guardarMensajes,
  paginaDeConversaciones,
  type ContactoCacheado,
  type MensajeNormalizado,
} from "./ingesta.js";
import { env } from "./env.js";
import { db, orgActiva } from "./repo.js";

/** La ventana del candado. El frontend pinga cada 10s; correr más seguido no aporta nada. */
const VENTANA_MS = 10_000;

/** Tamaño de página del search. Sobra: en 10s no entran 50 conversaciones nuevas. */
const POR_PAGINA = 50;

/**
 * Techo de páginas a caminar por ciclo. No es el caso esperado (1 página alcanza casi
 * siempre): es el freno si la marca de agua quedó vieja — p. ej. la primera corrida, o tras
 * horas sin nadie usando la app.
 */
const TOPE_PAGINAS = 4;

export interface OpcionesReconciliacion {
  /**
   * Cuántos ms puede tardar como máximo. Se chequea **entre** conversaciones, nunca a mitad
   * de una: abandonar entre el `update` de `last_message_ghl_at` y `efectosDeEntrante`
   * perdería para siempre el evento de historial, la cancelación del seguimiento automático
   * y el revive de la tarea.
   *
   * Por defecto **sin límite**, para que `POST /api/closer/reconciliar` se comporte
   * exactamente igual que antes de §56.
   */
  presupuestoMs?: number;
}

export interface ResultadoReconciliacion {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Corre un ciclo. **Nunca lanza**: devuelve el status y el cuerpo que el caller responde
 * tal cual. Que la firma sea `{status, body}` no es cosmético — es lo que hace que la
 * cáscara de `reconciliar.ts` sea `res.status(r.status).json(r.body)` y por lo tanto
 * imposible de desincronizar.
 */
export async function ejecutarReconciliacion(
  opts: OpcionesReconciliacion = {},
): Promise<ResultadoReconciliacion> {
  if (env.ghlModo() === "stub") {
    return { status: 200, body: { ok: true, corrio: false, motivo: "Modo stub: no hay GHL que reconciliar." } };
  }

  const vence = opts.presupuestoMs ? Date.now() + opts.presupuestoMs : Infinity;
  const sinTiempo = () => Date.now() > vence;

  /* ── 1. El candado (RPC — migración 012) ───────────────────────────── */
  const { data: claim, error: errClaim } = await db().rpc("closer_reconciliar_claim", {
    p_org_id: orgActiva(),
    p_ventana_segundos: Math.round(VENTANA_MS / 1000),
  });

  if (errClaim) return { status: 500, body: { ok: false, error: `candado: ${errClaim.message}` } };
  const fila = Array.isArray(claim) ? claim[0] : claim;
  if (!fila?.gano) {
    // Otro request (otra pestaña, otro usuario) corrió hace menos de 10s. Es el camino
    // feliz de la concurrencia, no un error: N pestañas = el mismo costo que una.
    return { status: 200, body: { ok: true, corrio: false, motivo: "Ya corrió hace <10s." } };
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
      .limit(2000);
    if (errContactos) throw new Error(`closer_contactos: ${errContactos.message}`);

    const porId = new Map<string, ContactoCacheado>();
    for (const f of (filas ?? []) as ContactoCacheado[]) porId.set(f.ghl_contact_id, f);

    /* ── 3. Caminar el search por marca de agua ────────────────────────── */
    let llamadasGhl = 0;
    let marcaNueva = marcaAgua;
    let truncado = false;
    const cambiadas: { conversationId: string; contacto: ContactoCacheado; lastMessageDate: number }[] = [];

    let startAfterDate: number | undefined;
    for (let pagina = 0; pagina < TOPE_PAGINAS; pagina++) {
      // Entre páginas es seguro cortar: `marcaNueva` solo cubre lo ya caminado.
      if (pagina > 0 && sinTiempo()) {
        truncado = true;
        break;
      }
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
    let estadosActualizados = 0;

    for (const { conversationId, contacto, lastMessageDate } of cambiadas) {
      /**
       * El chequeo va ACÁ ARRIBA y en ningún otro lado del bucle: una vez que se entra a
       * procesar una conversación hay que llegar hasta `efectosDeEntrante`. Cortar en el
       * medio dejaría `last_message_ghl_at` avanzado con los efectos sin disparar, y el
       * ciclo siguiente ya no vería esa conversación como nueva.
       */
      if (sinTiempo()) {
        truncado = true;
        break;
      }

      const crudos = await mensajesDeConversacion(conversationId);
      llamadasGhl++;

      /**
       * `esMensajeDeChat` dejó de exigir `body` (§54: un audio de WhatsApp es un mensaje que
       * existió, y el auditor tiene que verlo). Acá se sigue exigiendo, y a propósito: el
       * caché alimenta el tab Chat de la ficha, donde una burbuja vacía no comunica nada.
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
          // El estado de entrega solo se conoce por acá: el webhook no lo manda, y la
          // respuesta del POST de envío es anterior al veredicto de Meta (§55).
          estado: m.status ?? null,
          errorEnvio: m.error ?? null,
        }));

      const nuevos = await guardarMensajes(normalizados);
      mensajesNuevos += nuevos;

      // Los que YA estaban: su cuerpo no cambia, pero su estado sí. Un saliente rechazado por
      // la ventana de 24 h se marca `failed` minutos después de haberse guardado como enviado.
      estadosActualizados += await actualizarEstados(normalizados);

      // El más reciente decide los efectos: si es entrante y es NUEVO (el webhook no lo
      // trajo), se disparan los mismos efectos que dispararía el webhook.
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

    /**
     * ── 4.b Cerrar los mensajes que quedaron en el aire ──────────────────
     *
     * El paso anterior solo relee conversaciones con actividad NUEVA, y un saliente que Meta
     * rechaza minutos después **no cambia la fecha de la conversación**: sin esto, su estado
     * se quedaría en `pending` para siempre (§55).
     *
     * Dos acotaciones que NO son opcionales, porque sin ellas la consulta nunca se vacía:
     * solo la última hora (esto resuelve un veredicto que está por llegar, no rellena el
     * pasado) y sin los ids fabricados `wh:…` (no existen del lado de GHL, así que releer la
     * conversación jamás les asignaría un estado).
     */
    const { data: enElAire } = await db()
      .from("closer_mensajes")
      .select("ghl_contact_id, conversation_id")
      .eq("direccion", "outbound")
      .or("estado.is.null,estado.eq.pending")
      .not("id", "like", "wh:%")
      .gte("timestamp_ghl", new Date(Date.now() - 3_600_000).toISOString())
      .order("timestamp_ghl", { ascending: false })
      .limit(50);

    const yaLeidas = new Set(cambiadas.map((c) => c.conversationId));
    const pendientes = [
      ...new Map(
        ((enElAire ?? []) as { ghl_contact_id: string; conversation_id: string | null }[])
          .filter((m) => m.conversation_id && !yaLeidas.has(m.conversation_id) && porId.has(m.ghl_contact_id))
          .map((m) => [m.conversation_id!, m.ghl_contact_id]),
      ).keys(),
    ].slice(0, 2);

    for (const conversationId of pendientes) {
      if (sinTiempo()) {
        truncado = true;
        break;
      }
      const crudos = await mensajesDeConversacion(conversationId);
      llamadasGhl++;
      estadosActualizados += await actualizarEstados(
        crudos
          .filter((m) => esMensajeDeChat(m) && Boolean(m.body))
          .map((m) => ({ id: String(m.id), estado: m.status ?? null, errorEnvio: m.error ?? null })),
      );
    }

    /**
     * ── 5. Avanzar la marca de agua ─────────────────────────────────────
     *
     * **Se saltea entero si hubo truncamiento.** `marcaNueva` avanzó sobre TODA la página
     * caminada, incluidas conversaciones que quedaron sin procesar: persistirla las dejaría
     * detrás de la marca, el walk nunca volvería a alcanzarlas y sus mensajes se perderían
     * para siempre. Es la misma semántica que el 502 de siempre, que ya era segura.
     *
     * No perder el trabajo hecho no depende de esta marca: el paso 4 guarda el progreso
     * contacto por contacto en `last_message_ghl_at`, así que el ciclo siguiente vuelve a
     * caminar las mismas páginas pero se saltea lo ya ingerido (`yaVisto`). Cuesta llamadas,
     * no corrección.
     */
    if (!truncado && marcaNueva > marcaAgua) {
      await db().rpc("closer_reconciliar_marca", {
        p_org_id: orgActiva(),
        p_marca: new Date(marcaNueva).toISOString(),
      });
    }

    return {
      status: 200,
      body: { ok: true, corrio: true, cambiadas: cambiadas.length, mensajesNuevos, estadosActualizados, truncado, llamadasGhl },
    };
  } catch (e) {
    // El candado ya quedó tomado por esta ventana — no se libera: reintentar en caliente
    // duplicaría llamadas justo cuando GHL puede estar fallando. El próximo ciclo (≤10s)
    // reintenta solo, y la marca de agua no avanzó, así que no se pierde nada.
    return { status: 502, body: { ok: false, corrio: true, error: (e as Error).message } };
  }
}
