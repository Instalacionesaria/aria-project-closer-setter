/**
 * `POST /api/webhooks/ghl` — la única puerta de entrada de eventos desde GoHighLevel.
 *
 * ## Por qué un solo endpoint y no uno por evento
 *
 * Una Private Integration NO puede suscribirse a webhooks — eso es para apps del
 * marketplace. El camino real en GHL, y el que encaja con la filosofía del contrato
 * ("Kevin decide y etiqueta; GHL ejecuta lo predecible"), es que Francisco cree un
 * **workflow con acción Webhook** por cada evento. Todos apuntan acá y se distinguen por el
 * campo `evento` del cuerpo. Un endpoint = una URL que copiar, un secreto que rotar.
 *
 * ## El cuerpo es mínimo a propósito
 *
 * Solo `evento` + `contactId`. Todo lo demás se le pregunta a GHL, que es la fuente de
 * verdad. Si el payload trajera el nombre, los tags y el stage, cada cambio de estructura en
 * GHL rompería la integración en silencio y quedaríamos con datos viejos cuando un workflow
 * dispare tarde. Preguntando siempre, el dato es el de este instante.
 *
 * ## Nada se procesa sin guardarse primero
 *
 * Todo cuerpo entra crudo a `closer_webhook_inbox` ANTES de interpretarlo, y se responde 200
 * enseguida. Si el mapeo falla, el evento no se perdió: queda la fila para reprocesarlo. El
 * mapeo va a estar mal las primeras veces — eso es lo que hace que se pueda corregir.
 *
 * ## Siempre 200, salvo credencial inválida
 *
 * GHL reintenta ante un error, y un reintento de algo que ya procesamos no aporta nada. Un
 * evento desconocido se guarda y se responde 200: mejor un registro sin interpretar que un
 * workflow desactivándose solo por errores repetidos.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "../_lib/repo.js";
import { analizarYMarcar } from "../_lib/analizador.js";
import { autorConEnv } from "../_lib/autoria.js";
import { sincronizarContacto } from "../_lib/contactos.js";
import {
  asegurarContacto,
  efectosDeEntrante,
  guardarMensajes,
  idDeMensaje,
  registrarEventoSistema,
} from "../_lib/ingesta.js";

/** Eventos que este endpoint entiende. Cualquier otro se guarda sin interpretar. */
export type EventoGhl =
  | "contacto.zona_closer"
  | "contacto.actualizado"
  | "mensaje.entrante"
  | "mensaje.saliente"
  | "cita.agendada"
  | "cita.cancelada"
  | "serie.toque"
  | "serie.agotada";

const EVENTOS_CONOCIDOS: readonly string[] = [
  "contacto.zona_closer",
  "contacto.actualizado",
  "mensaje.entrante",
  "mensaje.saliente",
  "cita.agendada",
  "cita.cancelada",
  "serie.toque",
  "serie.agotada",
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Solo POST." });
  }

  /* ── Autenticación ───────────────────────────────────────────────────── */
  // El endpoint es público: sin esto, cualquiera que descubra la URL puede inyectar
  // contactos y eventos falsos. Los workflows de GHL permiten headers personalizados, así
  // que un secreto compartido es la protección proporcionada al riesgo.
  // Sin secreto configurado el endpoint se RECHAZA a sí mismo (antes solo avisaba por
  // consola y aceptaba todo). Cambio del 2026-07-31: este endpoint dispara el analizador de
  // Kevin (~$0,02 por inferencia) y escribe contactos — abierto, cualquiera que descubra la
  // URL puede inyectar eventos falsos y generar gasto. 503 y no 401 porque el problema es
  // configuración nuestra, no la credencial del que llama.
  const secretoEsperado = process.env.WEBHOOK_SECRET;
  if (!secretoEsperado) {
    console.error("[webhook] WEBHOOK_SECRET sin configurar: se rechaza todo hasta que exista.");
    return res.status(503).json({ ok: false, error: "WEBHOOK_SECRET sin configurar en el servidor." });
  }
  if (req.headers["x-webhook-secret"] !== secretoEsperado) {
    return res.status(401).json({ ok: false, error: "Secreto inválido." });
  }

  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  if (!cuerpo) return res.status(400).json({ ok: false, error: "Cuerpo JSON inválido." });

  /**
   * El `evento` viaja en la URL (`?evento=cita.agendada`) — cambio del 2026-07-31.
   *
   * Motivo: la acción Webhook ESTÁNDAR de GHL (la gratis) no permite editar el cuerpo JSON;
   * manda su payload nativo tal cual. La URL sí se puede editar, así que cada workflow se
   * distingue por el query param y el handler lee los campos del payload nativo con
   * fallbacks (ver `procesar`). El `evento` en el cuerpo sigue funcionando (webhook premium
   * o pruebas por curl) — la URL gana si vienen los dos.
   */
  const evento = String((req.query.evento as string) ?? cuerpo.evento ?? "");
  const contactId = String(cuerpo.contactId ?? cuerpo.contact_id ?? (cuerpo.contact as Record<string, unknown>)?.id ?? "");

  /* ── 1. Guardar crudo, antes de interpretar ──────────────────────────── */
  // `external_id` da idempotencia: GHL reintenta, y el índice único evita procesar dos
  // veces el mismo evento. Sin id del proveedor, se compone con el dato más específico
  // disponible. El último recurso es Date.now(): sacrifica la dedupe del inbox ante un
  // reintento, pero el procesamiento aguas abajo ES idempotente (pk de closer_mensajes,
  // pk de closer_citas) — la alternativa era peor: el fallback viejo (evento+contacto)
  // hacía COLISIONAR dos mensajes distintos del mismo contacto y el segundo se descartaba
  // como "duplicado".
  const discriminador =
    cuerpo.messageId ??
    (cuerpo.message as Record<string, unknown>)?.id ??
    cuerpo.appointmentId ??
    (cuerpo.calendar as Record<string, unknown>)?.appointmentId ??
    (cuerpo.calendar as Record<string, unknown>)?.id ??
    cuerpo.ocurridoEl ??
    cuerpo.timestamp ??
    Date.now();
  const externalId = String(cuerpo.eventId ?? cuerpo.external_id ?? `${evento}:${contactId}:${discriminador}`);

  const { error: errInbox } = await db()
    .from("closer_webhook_inbox")
    .insert({ proveedor: "ghl", external_id: externalId, payload: cuerpo });

  // 23505 = clave duplicada: ya lo recibimos. Es éxito, no error.
  if (errInbox?.code === "23505") {
    return res.status(200).json({ ok: true, duplicado: true });
  }
  if (errInbox) {
    // Si ni siquiera se pudo guardar, sí devolvemos error para que GHL reintente — es el
    // único caso donde perder el evento es peor que un reintento.
    return res.status(500).json({ ok: false, error: `inbox: ${errInbox.message}` });
  }

  if (!contactId) {
    return res.status(200).json({ ok: true, ignorado: "sin contactId" });
  }

  /* ── 2. Interpretar ──────────────────────────────────────────────────── */
  try {
    const resultado = await procesar(evento, contactId, cuerpo);

    await db()
      .from("closer_webhook_inbox")
      .update({ procesado_el: new Date().toISOString() })
      .eq("external_id", externalId);

    return res.status(200).json({ ok: true, evento, ...resultado });
  } catch (e) {
    // El evento ya está guardado: se anota el error y se responde 200 igual. Reintentar no
    // ayudaría —el problema es nuestro mapeo, no la entrega— y haría que GHL desactive el
    // workflow por fallos repetidos.
    await db()
      .from("closer_webhook_inbox")
      .update({ error: (e as Error).message })
      .eq("external_id", externalId);

    console.error(`[webhook] ${evento} falló para ${contactId}:`, e);
    return res.status(200).json({ ok: false, guardado: true, error: (e as Error).message });
  }
}

/**
 * La hora del MENSAJE, o la de llegada del webhook si el payload no la trae.
 *
 * `date_created` estaba en esta cadena y era la trampa (encontrada el 2026-08-04 con los
 * webhooks reales de Fabio): en el payload del webhook estándar de GHL, ese campo es la
 * fecha en que se creó **el contacto**, no el mensaje — llegaba idéntica en los tres
 * webhooks de la prueba (`2026-08-03T20:16:09.600Z`), fechando mensajes de hoy 20 horas en
 * el pasado y ordenando mal el chat.
 *
 * `ocurridoEl`/`timestamp` sí son nuestros por contrato (los mandaría un workflow con cuerpo
 * JSON editable, plan de paga). Sin ellos, la hora de llegada es una aproximación honesta:
 * el webhook llega segundos después del mensaje.
 */
function horaDelMensaje(cuerpo: Record<string, unknown>, ahora: string): string {
  const declarada = String(cuerpo.ocurridoEl ?? cuerpo.timestamp ?? "").trim();
  if (!declarada) return ahora;
  const ms = Date.parse(declarada);
  return Number.isNaN(ms) ? ahora : new Date(ms).toISOString();
}

async function procesar(evento: string, contactId: string, cuerpo: Record<string, unknown>) {
  if (!EVENTOS_CONOCIDOS.includes(evento)) {
    // No es un error: es un workflow nuevo que todavía no sabemos interpretar. Queda en el
    // inbox para poder mapearlo después sin haber perdido nada.
    return { desconocido: true };
  }

  const ahora = new Date().toISOString();

  switch (evento as EventoGhl) {
    /**
     * El contacto entra al territorio del closer. Es el evento de la prueba: crear un
     * contacto en GHL con `zona_closer` y verlo aparecer en la herramienta.
     */
    case "contacto.zona_closer":
    case "contacto.actualizado": {
      // Se reporta lo que REALMENTE pasó, no lo que se intentó: `sincronizarContacto`
      // devuelve false cuando GHL no encuentra el contacto (id equivocado, contacto
      // borrado, credencial sin permiso). Antes esto devolvía `true` siempre — un webhook
      // apuntado a un id inexistente respondía "sincronizado" sin haber sincronizado nada.
      const ok = await sincronizarContacto(contactId);

      // Y el evento solo se registra si el contacto existe. Si no, quedaría una línea de
      // historial de alguien que no está en el sistema: imposible de ver en ninguna ficha
      // y contaminando la tabla.
      if (ok && evento === "contacto.zona_closer") {
        await registrarEventoSistema(contactId, "entro_zona_closer", "Entró a territorio del closer");
      }

      return ok
        ? { sincronizado: true }
        : { sincronizado: false, motivo: "GHL no devolvió ese contacto — ¿id equivocado o contacto borrado?" };
    }

    /**
     * El contacto escribió. Puebla Respondieron / Buzón general, y cancela la serie
     * automática si había una (WF 02.6 del contrato ya la corta del lado de GHL; acá se
     * refleja para que la cola no siga mostrándola).
     */
    case "mensaje.entrante": {
      // Fallbacks al payload NATIVO del webhook estándar de GHL (cuerpo no editable):
      // `message` puede venir como objeto {id, body} o como string suelto.
      const msgNativo = cuerpo.message as Record<string, unknown> | string | undefined;
      const texto = String(
        cuerpo.mensaje ?? cuerpo.body ?? (typeof msgNativo === "string" ? msgNativo : (msgNativo?.body ?? "")),
      ).slice(0, 500);
      const timestampGhl = horaDelMensaje(cuerpo, ahora);

      // Red de seguridad del alta (decisión de Fabio, 2026-07-31): si el contacto no está
      // en la caché —el webhook de mensaje llegó antes que el de cita, o ese se perdió—
      // se crea acá mismo con 1 llamada a GHL, en vez de ignorar a alguien del territorio.
      const contacto = await asegurarContacto(contactId);
      if (!contacto) return { ignorado: "GHL no devolvió ese contacto" };

      // El mensaje al caché de conversaciones. El id de GHL deduplica contra la
      // reconciliación; si el workflow no lo manda, el determinístico cumple el mismo rol.
      const msgObj = typeof msgNativo === "object" ? msgNativo : undefined;
      await guardarMensajes([
        {
          id:
            String(cuerpo.messageId ?? msgObj?.id ?? "") ||
            idDeMensaje(String(cuerpo.conversationId ?? "") || null, timestampGhl, texto),
          ghlContactId: contactId,
          conversationId: String(cuerpo.conversationId ?? msgObj?.conversationId ?? "") || null,
          direccion: "inbound",
          body: texto,
          timestampGhl,
          // Un entrante es del contacto y no hay ambigüedad posible: es el único autor que
          // el webhook puede afirmar sin depender de campos que su payload no manda.
          autor: "contacto",
        },
      ]);

      await db()
        .from("closer_contactos")
        .update({ last_message_ghl_at: timestampGhl })
        .eq("ghl_contact_id", contactId);

      // Efectos compartidos con la reconciliación: ultimo_entrante_*, evento, cancelación
      // de serie, reapertura de tarea. Un solo lugar para que las dos vías no diverjan.
      await efectosDeEntrante(contactId, texto, timestampGhl);

      // El contacto escribió: se audita cómo viene atendiendo el agente. Ver nota abajo.
      const analisis = await analizarYMarcar(contactId);

      return { respondio: true, analisis };
    }

    /**
     * El agente de GHL respondió. Es el momento con más información para auditarlo — ya se
     * puede juzgar SU respuesta, no solo lo que dijo el contacto.
     *
     * Se analiza en los dos eventos de mensaje porque los criterios de la rúbrica se
     * reparten entre ambos: la frustración y el "no es lo que busco" se ven en el entrante,
     * la promesa incorrecta y el "insiste y no entiende" recién en el saliente. El
     * analizador se corta solo antes de llamar al modelo si el contacto no es `zona_closer`
     * o si ya está marcado, así que la mayoría de los eventos no cuestan una inferencia.
     */
    case "mensaje.saliente": {
      const msgNativoOut = cuerpo.message as Record<string, unknown> | string | undefined;
      const msgObjOut = typeof msgNativoOut === "object" ? msgNativoOut : undefined;
      const texto = String(
        cuerpo.mensaje ?? cuerpo.body ?? (typeof msgNativoOut === "string" ? msgNativoOut : (msgObjOut?.body ?? "")),
      ).slice(0, 500);
      const timestampGhl = horaDelMensaje(cuerpo, ahora);

      const contacto = await asegurarContacto(contactId);
      if (!contacto) return { ignorado: "GHL no devolvió ese contacto" };

      /**
       * El payload del webhook ESTÁNDAR de GHL casi nunca trae `source`/`userId`, así que
       * la mayoría de los salientes van a caer en `desconocido`. No es un descuido: es la
       * respuesta honesta, y se corrige sola cuando la reconciliación trae el mismo mensaje
       * con su payload completo y su gemelo real reemplaza al fabricado (§51.2).
       *
       * La consecuencia hay que tenerla presente: con la app cerrada solo ingiere el
       * webhook, así que el contador de mensajes de la IA no avanza y el auditor no dispara
       * hasta que alguien abra la herramienta. El diagnóstico lo muestra como el renglón
       * `desconocido` de `salientes7d`.
       */
      await guardarMensajes([
        {
          id:
            String(cuerpo.messageId ?? msgObjOut?.id ?? "") ||
            idDeMensaje(String(cuerpo.conversationId ?? "") || null, timestampGhl, texto),
          ghlContactId: contactId,
          conversationId: String(cuerpo.conversationId ?? msgObjOut?.conversationId ?? "") || null,
          direccion: "outbound",
          body: texto,
          timestampGhl,
          autor: autorConEnv({
            direccion: "outbound",
            source: String(cuerpo.source ?? msgObjOut?.source ?? "") || null,
            userId: String(cuerpo.userId ?? msgObjOut?.userId ?? "") || null,
            messageType: String(cuerpo.messageType ?? msgObjOut?.messageType ?? "") || null,
          }),
        },
      ]);

      await db()
        .from("closer_contactos")
        .update({ ultimo_saliente_el: timestampGhl, last_message_ghl_at: timestampGhl })
        .eq("ghl_contact_id", contactId);

      const analisis = await analizarYMarcar(contactId);

      return { registrado: true, analisis };
    }

    /**
     * Puebla la Agenda. La cita es LA vía de alta de contactos nuevos (decisión de Fabio,
     * 2026-07-31: `zona_closer` se aplica DESPUÉS de agendar, así que todo contacto nuevo
     * llega con una cita) — por eso el `asegurarContacto` va acá primero.
     */
    case "cita.agendada": {
      const contacto = await asegurarContacto(contactId);
      if (!contacto) return { ignorado: "GHL no devolvió ese contacto" };

      // Fallbacks al payload NATIVO del webhook estándar (trae la cita bajo `calendar`).
      const cal = (cuerpo.calendar ?? cuerpo.appointment ?? {}) as Record<string, unknown>;
      const cuando = String(cuerpo.citaEl ?? cuerpo.startTime ?? cal.startTime ?? cal.start_time ?? "");
      const meetUrl = String(cuerpo.meetUrl ?? cuerpo.address ?? cal.address ?? "") || null;
      const appointmentId = String(
        cuerpo.appointmentId ?? cuerpo.appointment_id ?? cal.appointmentId ?? cal.id ?? "",
      );

      // El caché real de la Agenda es `closer_citas` (un contacto puede tener más de una
      // cita en el rango visible). Sin appointmentId no hay pk — queda solo en el contacto
      // y el respaldo de :25/:55 completa la fila con el id real.
      if (appointmentId && cuando) {
        const { error } = await db()
          .from("closer_citas")
          .upsert(
            {
              ghl_appointment_id: appointmentId,
              ghl_contact_id: contactId,
              fecha_hora: cuando,
              estado_ghl: String(cuerpo.estado ?? cal.status ?? "confirmed"),
              meet_url: meetUrl,
              titulo: String(cuerpo.titulo ?? cuerpo.title ?? cal.title ?? "") || null,
              actualizado_el: ahora,
            },
            { onConflict: "ghl_appointment_id" },
          );
        if (error) throw new Error(`closer_citas: ${error.message}`);
      }

      // Las columnas del contacto se mantienen como resumen "próxima cita" (las usan los
      // íconos 📅/📹 de las filas sin joinear).
      await db()
        .from("closer_contactos")
        .update({
          cita_el: cuando || null,
          cita_meet_url: meetUrl,
          cita_estado: String(cuerpo.estado ?? "confirmada"),
        })
        .eq("ghl_contact_id", contactId);

      await registrarEventoSistema(contactId, "cita_agendada", cuando ? `Cita agendada para ${cuando}` : "Cita agendada");
      return { cita: cuando, sinAppointmentId: !appointmentId || undefined };
    }

    case "cita.cancelada": {
      const calCanc = (cuerpo.calendar ?? cuerpo.appointment ?? {}) as Record<string, unknown>;
      const appointmentId = String(
        cuerpo.appointmentId ?? cuerpo.appointment_id ?? calCanc.appointmentId ?? calCanc.id ?? "",
      );
      if (appointmentId) {
        await db()
          .from("closer_citas")
          .update({ estado_ghl: "cancelled", actualizado_el: ahora })
          .eq("ghl_appointment_id", appointmentId);
      }
      await db()
        .from("closer_contactos")
        .update({ cita_el: null, cita_meet_url: null, cita_estado: "cancelada" })
        .eq("ghl_contact_id", contactId);
      await registrarEventoSistema(contactId, "cita_cancelada", "Se canceló la cita");
      return { cancelada: true };
    }

    /** Un toque de la serie salió. El índice único evita contarlo dos veces si GHL reintenta. */
    case "serie.toque": {
      const n = Number(cuerpo.toque ?? cuerpo.toque_n ?? 0) || null;
      const { data: seg } = await db()
        .from("closer_seguimientos")
        .select("id, serie_toques")
        .eq("ghl_contact_id", contactId)
        .eq("estado", "pendiente")
        .maybeSingle();

      await registrarEventoSistema(
        contactId,
        "serie_toque_enviado",
        n && seg?.serie_toques ? `Toque ${n} de ${seg.serie_toques} enviado` : "Toque de la serie enviado",
        seg?.id,
        { toque_n: n },
      );
      return { toque: n };
    }

    /**
     * La serie terminó sin respuesta. Recién ACÁ el contacto aparece en "Seguimientos de
     * hoy" — es la única forma en que un automático genera tarea humana (§16.1.D).
     */
    case "serie.agotada": {
      const { data } = await db()
        .from("closer_seguimientos")
        .update({ estado: "agotado" })
        .eq("ghl_contact_id", contactId)
        .eq("estado", "pendiente")
        .eq("modo", "automatico")
        .select("id")
        .maybeSingle();

      await registrarEventoSistema(contactId, "serie_agotada", "Serie completada sin respuesta — revisar", data?.id);
      return { agotada: true };
    }
  }
}

/* `registrarEvento` (privado) se movió a `api/_lib/ingesta.ts` como `registrarEventoSistema`
   para que la reconciliación escriba eventos idénticos a los del webhook. */

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
