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
import { ORG_ID, db } from "../_lib/repo.js";
import { analizarYMarcar } from "../_lib/analizador.js";
import { sincronizarContacto } from "../_lib/contactos.js";

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
  const secretoEsperado = process.env.WEBHOOK_SECRET;
  if (secretoEsperado) {
    const recibido = req.headers["x-webhook-secret"];
    if (recibido !== secretoEsperado) {
      return res.status(401).json({ ok: false, error: "Secreto inválido." });
    }
  }
  // Sin `WEBHOOK_SECRET` configurado se acepta todo — necesario para poder probar antes de
  // que Francisco ponga el header en los workflows. Se avisa en cada request para que no
  // pase inadvertido si queda así en producción.
  else console.warn("[webhook] WEBHOOK_SECRET sin configurar: el endpoint acepta cualquier origen.");

  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  if (!cuerpo) return res.status(400).json({ ok: false, error: "Cuerpo JSON inválido." });

  const evento = String(cuerpo.evento ?? "");
  const contactId = String(cuerpo.contactId ?? cuerpo.contact_id ?? "");

  /* ── 1. Guardar crudo, antes de interpretar ──────────────────────────── */
  // `external_id` da idempotencia: GHL reintenta, y el índice único evita procesar dos
  // veces el mismo evento. Si el workflow no lo manda, se compone uno con lo que hay.
  const externalId = String(cuerpo.eventId ?? cuerpo.external_id ?? `${evento}:${contactId}:${cuerpo.ocurridoEl ?? ""}`);

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
        await registrarEvento(contactId, "entro_zona_closer", "Entró a territorio del closer");
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
      const texto = String(cuerpo.mensaje ?? cuerpo.body ?? "").slice(0, 500);

      await db()
        .from("closer_contactos")
        .update({ ultimo_entrante_el: ahora, ultimo_entrante_texto: texto || null })
        .eq("ghl_contact_id", contactId);

      await registrarEvento(contactId, "mensaje_entrante", texto ? `Escribió: "${texto.slice(0, 120)}"` : "El contacto escribió");

      // Si el contacto responde, la serie muere: perseguir a alguien que ya contestó es
      // exactamente lo que la regla de cancelación evita.
      await db()
        .from("closer_seguimientos")
        .update({ estado: "cancelado", motivo_cierre: "respondio", cerrado_el: ahora })
        .eq("ghl_contact_id", contactId)
        .eq("estado", "pendiente")
        .eq("modo", "automatico");

      // Volver a escribir reabre la tarea del día (§40.D: el `reviveTask` que hasta ahora
      // solo existía como botón de demo).
      await db()
        .from("closer_contacto_tarea")
        .update({ completada_dia: null, actualizado_el: ahora })
        .eq("ghl_contact_id", contactId);

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
      await db().from("closer_contactos").update({ ultimo_saliente_el: ahora }).eq("ghl_contact_id", contactId);

      const analisis = await analizarYMarcar(contactId);

      return { registrado: true, analisis };
    }

    /** Puebla la Agenda de Hoy. */
    case "cita.agendada": {
      const cuando = String(cuerpo.citaEl ?? cuerpo.startTime ?? "");
      await db()
        .from("closer_contactos")
        .update({
          cita_el: cuando || null,
          cita_meet_url: String(cuerpo.meetUrl ?? cuerpo.address ?? "") || null,
          cita_estado: String(cuerpo.estado ?? "confirmada"),
        })
        .eq("ghl_contact_id", contactId);

      await registrarEvento(contactId, "cita_agendada", cuando ? `Cita agendada para ${cuando}` : "Cita agendada");
      return { cita: cuando };
    }

    case "cita.cancelada": {
      await db()
        .from("closer_contactos")
        .update({ cita_el: null, cita_meet_url: null, cita_estado: "cancelada" })
        .eq("ghl_contact_id", contactId);
      await registrarEvento(contactId, "cita_cancelada", "Se canceló la cita");
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

      await registrarEvento(
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

      await registrarEvento(contactId, "serie_agotada", "Serie completada sin respuesta — revisar", data?.id);
      return { agotada: true };
    }
  }
}

/** Todo evento automático lleva autor `Sistema` y jamás pasa por Avanzar (§2). */
async function registrarEvento(
  contactId: string,
  tipo: string,
  texto: string,
  seguimientoId?: string,
  payload: Record<string, unknown> = {},
) {
  await db().from("closer_contacto_eventos").insert({
    org_id: ORG_ID,
    ghl_contact_id: contactId,
    seguimiento_id: seguimientoId ?? null,
    tipo,
    texto,
    autor_tipo: "sistema",
    autor_nombre: "Sistema",
    payload,
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
