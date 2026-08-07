/**
 * `POST /api/closer/mensajes` — el envío real: el closer escribe y sale por WhatsApp.
 *
 * Era EL hueco funcional del chat (confirmado por exploración el 2026-07-31): el ChatTab
 * "enviaba" solo a estado local del navegador — el mensaje se pintaba y no llegaba a nadie.
 *
 * Flujo (doc §4.4): validar → `POST /conversations/messages` de GHL (tipo WhatsApp,
 * 1 llamada por mensaje — dentro del presupuesto §9) → guardar el saliente en
 * `closer_mensajes` con el messageId real → responder. El frontend pinta optimista y esta
 * respuesta confirma o corrige.
 *
 * Congelados (§7): ni un mensaje. El contacto perdió `zona_closer` y hacia GHL es inerte —
 * se responde 409 con el motivo para que la UI lo diga en vez de fingir que salió.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sincronizarContacto } from "../_lib/contactos.js";
import { env } from "../_lib/env.js";
import { guardarMensajes } from "../_lib/ingesta.js";
import { db } from "../_lib/repo.js";
import { ventanaWhatsapp } from "../../src/lib/whatsapp.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

const BASE = "https://services.leadconnectorhq.com";
const VERSION = "2021-07-28";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Usá POST." });
  }

  const cuerpo = (typeof req.body === "string" ? JSON.parse(req.body) : req.body) as Record<string, unknown> | null;
  const contactId = String(cuerpo?.contactId ?? "");
  const message = String(cuerpo?.message ?? "").trim();

  if (!contactId) return res.status(400).json({ ok: false, error: "Falta contactId." });
  if (!message) return res.status(400).json({ ok: false, error: "El mensaje está vacío." });

  if (env.ghlModo() === "stub") {
    return res.status(200).json({ ok: true, enviado: false, motivo: "Modo stub: el mensaje no salió a ningún lado." });
  }

  try {
    const leerCongelado = async () => {
      const { data } = await db()
        .from("closer_contactos")
        .select("congelado, ultimo_entrante_el")
        .eq("ghl_contact_id", contactId)
        .maybeSingle();
      return data;
    };
    let contacto = await leerCongelado();
    // La caché puede estar vieja (mismo caso que aplicarEfectosGhl, bug 2026-08-03): antes
    // de negarle el envío, se verifica contra GHL — si el tag está, se descongela y sigue.
    if (contacto?.congelado) {
      const refrescado = await sincronizarContacto(contactId).catch(() => false);
      if (refrescado) contacto = await leerCongelado();
    }
    if (contacto?.congelado) {
      return res.status(409).json({
        ok: false,
        error: "El contacto no tiene zona_closer en GHL (verificado recién): no se le envían mensajes desde acá (§7).",
      });
    }

    /**
     * ── La ventana de 24 h de WhatsApp ──────────────────────────────────
     *
     * Bug del 2026-08-05: fuera de la ventana, GHL devuelve **2xx** igual, crea el mensaje, y
     * recién después Meta lo rechaza. La plataforma daba el envío por bueno y el closer se
     * quedaba esperando una respuesta que nunca iba a llegar.
     *
     * Se corta ACÁ, antes de gastar la llamada: ya sabemos que va a rebotar. El 409 lleva la
     * ventana entera para que la UI explique el motivo en vez de mostrar un error genérico.
     */
    const ventana = ventanaWhatsapp(contacto?.ultimo_entrante_el as string | null | undefined);
    if (!ventana.abierta) {
      return res.status(409).json({
        ok: false,
        codigo: "ventana_24h_cerrada",
        error: ventana.motivo,
        ventana,
      });
    }

    /* ── 1 llamada a GHL: el envío ───────────────────────────────────────── */
    const r = await fetch(`${BASE}/conversations/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.ghlApiKey()}`,
        Version: VERSION,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type: "WhatsApp", contactId, message }),
    });

    if (!r.ok) {
      const detalle = await r.text();
      // 4xx de GHL = el mensaje NO salió. Se dice tal cual — el front debe deshacer el
      // pintado optimista, no dejar un mensaje fantasma que el contacto nunca recibió.
      return res.status(502).json({ ok: false, error: `GHL ${r.status}: ${detalle.slice(0, 300)}` });
    }

    const datos = await r.json().catch(() => ({}) as Record<string, unknown>);
    const messageId = String(datos?.messageId ?? datos?.id ?? "") || `out:${contactId}:${Date.now()}`;
    const conversationId = String(datos?.conversationId ?? "") || null;
    const ahora = new Date().toISOString();

    /* ── Caché: el saliente entra igual que si viniera del webhook ───────── */
    await guardarMensajes([
      {
        id: messageId,
        ghlContactId: contactId,
        conversationId,
        direccion: "outbound",
        body: message,
        timestampGhl: ahora,
        // Lo acaba de escribir el closer en el compositor: es el único saliente cuya autoría
        // no hay que inferir de `source`/`userId`, la sabemos de primera mano. Importa que
        // quede bien: si contara como del agente, el auditor juzgaría al bot por lo que
        // escribió un humano — y encima le avanzaría el contador del debounce.
        autor: "asesor",
        /**
         * `pending`, no `enviado`: GHL aceptó el mensaje, Meta todavía no lo entregó. El
         * veredicto llega después y lo escribe la reconciliación (`actualizarEstados`).
         * Registrarlo como entregado acá sería repetir el bug que este cambio arregla.
         */
        estado: "pending",
      },
    ]);

    await db()
      .from("closer_contactos")
      .update({ ultimo_saliente_el: ahora, last_message_ghl_at: ahora })
      .eq("ghl_contact_id", contactId);

    return res.status(200).json({ ok: true, enviado: true, messageId, conversationId });
  } catch (e) {
    return res.status(502).json({ ok: false, error: (e as Error).message });
  }
}
