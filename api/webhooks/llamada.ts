/**
 * `POST /api/webhooks/llamada?token=…` — las llamadas de los agentes de voz, desde Assistable.
 *
 * Es la fuente que faltaba para los dos auditores de VOZ (§53.4): hasta hoy GHL no exponía
 * las llamadas ni sus transcripciones y no había de dónde sacarlas.
 *
 * ## Por qué el secreto va en la URL y no en un header
 *
 * Assistable solo ofrece **un campo de URL**: no deja configurar headers. Es peor que un
 * header —una URL se copia, se pega en un chat, queda en logs de proxies— así que el diseño
 * compensa por el lado del daño posible, no por el de la probabilidad:
 *
 *   1. **Token PROPIO** (`LLAMADAS_TOKEN` / `assistable_token` por empresa), distinto de
 *      `WEBHOOK_SECRET`.
 *   2. **La dedupe por `call_id` acota el gasto.** Desde el 2026-08-10 este endpoint SÍ llama
 *      al modelo (el auditor de voz), así que la inercia dejó de ser el argumento — lo que lo
 *      reemplaza es que un `call_id` repetido no se re-analiza nunca (`analizarLlamada` consulta
 *      antes de gastar), y un payload inventado sin transcripción se corta en los portones
 *      gratis. El peor caso de un token filtrado es una inferencia por call_id falso, con la
 *      basura visible en la bandeja y en Auditoría.
 *   3. Rotar es un clic en Ajustes › Credenciales › Webhooks y volver a pegar la URL.
 *
 * ## De inerte a conectado (2026-08-06)
 *
 * Nació guardando el cuerpo crudo y nada más, para que los datos reales decidieran el
 * esquema en vez de inventar columnas y descubrir después que faltaba la mitad. Llegaron tres
 * llamadas de prueba y respondieron la pregunta que bloqueaba todo: **la transcripción viene
 * en este mismo payload** (`full_transcript` + `transcript_object`), con el resumen, el
 * sentimiento y la grabación. No hay que pedir nada aparte con el `call_id`.
 *
 * Así que ahora también escribe en `closer_llamadas` (016). Sigue valiendo el principio de
 * `api/webhooks/ghl.ts`: **nada se procesa sin guardarse primero**. La bandeja se escribe
 * antes de parsear, y si el parseo falla el payload queda igual — se pierde la fila, nunca
 * el dato.
 *
 * ## De conectado a auditor (2026-08-10)
 *
 * Tras archivar la fila, si la llamada fue **contestada y tiene transcripción**, se analiza acá
 * mismo con el auditor de voz (`analizadorVoz.ts`): mismo modelo y misma rúbrica-molde que el
 * chat, con el prompt del agente si está cargado. El resultado viaja en la respuesta
 * (`analisisVoz`) y es best-effort declarado: un análisis fallido nunca le cuesta el 200 a un
 * evento que ya se guardó.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../_lib/env.js";
import { db } from "../_lib/repo.js";
import { parsearLlamada, redactarSecretos, type PayloadLlamada } from "../../src/lib/assistable.js";
import type { CallOrigin } from "../../src/lib/closerStore.js";
import { activar } from "../_lib/credenciales.js";
import { atribuirPorToken, guardarHuerfano } from "../_lib/ruteoWebhook.js";
import { analizarLlamada, type ResultadoVoz } from "../_lib/analizadorVoz.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * Un GET sin token responde que está vivo, y nada más. Es para poder pegar la URL en el
   * navegador y confirmar que el deploy llegó, sin tener que armar un curl — el momento en
   * que más se necesita es justo cuando se está configurando Assistable.
   */
  if (req.method === "GET") {
    return res.status(200).json({ ok: true, listo: true, endpoint: "webhooks/llamada", metodo: "POST" });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, GET");
    return res.status(405).json({ ok: false, error: "Solo POST." });
  }

  /**
   * ── El token de la URL identifica la empresa (2026-08-07) ────────────
   *
   * Antes la empresa salía del `location_id` del payload y el token era solo una contraseña.
   * Ahora es al revés, porque la URL que se le entrega al cliente **ya lleva su token adentro**:
   * Assistable no deja configurar headers, así que la URL ES la credencial. Un payload sin
   * `location_id` antes quedaba huérfano aunque el token dijera perfectamente de quién era.
   *
   * Y si el payload trae un `location_id` que contradice al token, no se procesa: eso es
   * configuración cruzada o token reutilizado. Ver `atribuirPorToken`.
   */
  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  if (!cuerpo) return res.status(400).json({ ok: false, error: "Cuerpo JSON inválido." });

  /* ── Autenticación y atribución de empresa (§6.3) ────────────────────── */
  let atribucion;
  try {
    atribucion = await atribuirPorToken(cuerpo, String(req.query.token ?? "") || undefined, process.env.LLAMADAS_TOKEN);
  } catch (e) {
    console.error(`[llamada] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  if (atribucion.estado === "sin_secreto_configurado") {
    // Falla cerrado, igual que el webhook de GHL. 503 y no 401 porque el problema es
    // configuración nuestra, no la credencial de quien llama.
    console.error("[llamada] ni la empresa ni LLAMADAS_TOKEN tienen token: se rechaza todo.");
    return res.status(503).json({ ok: false, error: "Webhook de llamadas sin token configurado en el servidor." });
  }
  if (atribucion.estado === "secreto_invalido") {
    return res.status(401).json({ ok: false, error: "Token inválido." });
  }

  /**
   * D15 · Sin empresa atribuible, el crudo se guarda y no se procesa. 200 a propósito: el
   * evento llegó bien y no hay nada que reintentar. Una llamada de voz que no se puede
   * atribuir es justamente lo que hay que poder auditar después, no descartar.
   */
  if (atribucion.estado === "sin_empresa" || atribucion.estado === "empresa_inactiva") {
    const marca = atribucion.estado === "sin_empresa" ? "huerfano" : "inactiva";
    await guardarHuerfano("assistable", `${marca}:${String(cuerpo.call_id ?? cuerpo.callId ?? Date.now())}`, redactarSecretos(cuerpo));
    const motivo =
      atribucion.estado === "sin_empresa"
        ? atribucion.motivo
        : `La empresa "${atribucion.credenciales.nombre}" está desactivada.`;
    console.warn(`[llamada] no se procesa: ${motivo}`);
    return res.status(200).json({ ok: true, procesado: false, motivo });
  }

  activar(atribucion.credenciales);

  /**
   * `call_id` como clave de idempotencia: si Assistable reintenta la misma llamada, el índice
   * único de la bandeja lo corta acá y no quedan dos filas del mismo evento. Sin `call_id`
   * se cae a la hora de llegada, que sacrifica la dedupe pero nunca pierde el payload.
   */
  const callId = String(cuerpo.call_id ?? cuerpo.callId ?? "");
  const externalId = callId ? `assistable:${callId}` : `assistable:sin-id:${Date.now()}`;

  /**
   * ── Se recorta antes de guardar ─────────────────────────────────────
   *
   * `variables` trae 160 claves, y adentro `custom_values` con los valores personalizados de
   * la subcuenta de GHL: en esta cuenta, eso incluye el **access token de Facebook entero**.
   * Nadie lo pidió — viaja porque el agente recibe todos. Guardarlo sería copiar una
   * credencial viva a una segunda base, con su propio backup y su propio riesgo, para no
   * usarla nunca. Se redacta acá y el parseo sigue leyendo el objeto original.
   */
  const { error } = await db()
    .from("closer_webhook_inbox")
    .insert({ proveedor: "assistable", external_id: externalId, payload: redactarSecretos(cuerpo) });

  // 23505 = clave duplicada: ya teníamos el cuerpo. NO se corta acá — un reintento de
  // Assistable puede traer campos que la primera vez faltaban (la transcripción es lo que
  // más tarda en cerrar), y el upsert de abajo es idempotente. Cortar antes dejaría la fila
  // de la llamada congelada en la versión más pobre del payload.
  const duplicado = error?.code === "23505";
  if (error && !duplicado) {
    // El único caso donde conviene que Assistable reintente: no llegamos a guardar nada.
    return res.status(500).json({ ok: false, error: `inbox: ${error.message}` });
  }

  /**
   * ── La fila de la llamada ───────────────────────────────────────────
   *
   * Todo lo de acá para abajo es best-effort **a propósito**. El cuerpo ya está a salvo; si
   * el parseo o el upsert fallan, devolver 500 haría que Assistable reintente para siempre
   * un payload que sí recibimos, y cada reintento chocaría contra el mismo bug. Se responde
   * 200 con el motivo adentro, y la fila se recupera después desde la bandeja.
   */
  let archivada: string | null = null;
  let motivo: string | null = null;

  const fila = parsearLlamada(cuerpo as PayloadLlamada, env.asistentesVozExtra() as Record<string, CallOrigin>);
  if (!fila) {
    motivo = callId ? "el payload no trae contact_id: no hay ficha donde mostrarla" : "el payload no trae call_id";
    console.error(`[llamada] sin archivar (${externalId}): ${motivo}`);
  } else {
    const { error: eLlamada } = await db().from("closer_llamadas").upsert(fila, { onConflict: "call_id" });
    if (eLlamada) {
      motivo = `closer_llamadas: ${eLlamada.message}`;
      console.error(`[llamada] no se pudo archivar ${fila.call_id}: ${eLlamada.message}`);
    } else {
      archivada = fila.call_id;
    }
  }

  /**
   * El auditor de voz corre DESPUÉS de archivar y solo si la fila quedó en la base: si el
   * análisis explota, la llamada ya está a salvo y el reintento de Assistable la encuentra
   * analizable (la dedupe por call_id evita pagar dos veces). `analizarLlamada` nunca lanza.
   */
  let analisisVoz: ResultadoVoz | null = null;
  if (archivada && fila) {
    analisisVoz = await analizarLlamada(fila);
  }

  return res.status(200).json({
    ok: true,
    guardado: !duplicado,
    duplicado,
    // Se distingue "llegó" de "quedó en la ficha": son dos hechos distintos y confundirlos
    // haría que una llamada perdida se vea igual que una archivada (regla 2).
    archivada: Boolean(archivada),
    ...(motivo ? { motivo } : {}),
    // Qué hizo el auditor de voz con esta llamada. `null` = ni se intentó (no archivada).
    analisisVoz,
    callId: callId || null,
    contactId: String(cuerpo.contact_id ?? cuerpo.contactId ?? "") || null,
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
