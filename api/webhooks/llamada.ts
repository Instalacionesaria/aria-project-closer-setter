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
 *   1. **Token PROPIO** (`LLAMADAS_TOKEN`), distinto de `WEBHOOK_SECRET`. Ese otro protege
 *      un endpoint que aplica tags, escribe notas en GHL y dispara al auditor (dinero real).
 *      Si esta URL se filtra, no puede tocar nada de eso.
 *   2. **El endpoint es INERTE.** Guarda el cuerpo crudo y responde 200. No llama a GHL, no
 *      llama al modelo, no escribe en ninguna otra tabla, no dispara ningún efecto. El peor
 *      caso de un token filtrado es que alguien meta filas de basura en la bandeja.
 *   3. Rotar es cambiar una variable de entorno y volver a pegar la URL en Assistable.
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
 * El endpoint dejó de ser inerte, pero no mucho: escribe dos tablas nuestras y sigue sin
 * llamar a GHL, sin llamar al modelo y sin disparar efectos. El peor caso de un token
 * filtrado sigue siendo basura en dos tablas.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../_lib/env.js";
import { ORG_ID, db } from "../_lib/repo.js";
import { parsearLlamada, redactarSecretos, type PayloadLlamada } from "../../src/lib/assistable.js";
import type { CallOrigin } from "../../src/lib/closerStore.js";
import { activar, resolverCredenciales } from "../_lib/credenciales.js";

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

  const esperado = process.env.LLAMADAS_TOKEN;
  if (!esperado) {
    // Falla cerrado, igual que el webhook de GHL: sin token configurado no se acepta nada.
    // 503 y no 401 porque el problema es configuración nuestra, no la credencial del que llama.
    console.error("[llamada] LLAMADAS_TOKEN sin configurar: se rechaza todo hasta que exista.");
    return res.status(503).json({ ok: false, error: "LLAMADAS_TOKEN sin configurar en el servidor." });
  }

  const token = String(req.query.token ?? "");
  if (token !== esperado) {
    return res.status(401).json({ ok: false, error: "Token inválido." });
  }

  /**
   * Camino de MÁQUINA: no hay sesión, así que las credenciales de la empresa se resuelven acá.
   * Sin esto la ingesta y el auditor correrían con las variables globales — correcto hoy con
   * una sola empresa, y una fuga el día que haya dos (§5.2).
   *
   * **Provisorio:** usa `ORG_ID` porque el ruteo por `locationId` del payload es §6.3, de la
   * fase 5. Cuando eso exista, la organización sale del `locationId` y esta línea cambia.
   */
  try {
    activar(await resolverCredenciales(ORG_ID));
  } catch (e) {
    console.error(`[credenciales] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  if (!cuerpo) return res.status(400).json({ ok: false, error: "Cuerpo JSON inválido." });

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

  return res.status(200).json({
    ok: true,
    guardado: !duplicado,
    duplicado,
    // Se distingue "llegó" de "quedó en la ficha": son dos hechos distintos y confundirlos
    // haría que una llamada perdida se vea igual que una archivada (regla 2).
    archivada: Boolean(archivada),
    ...(motivo ? { motivo } : {}),
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
