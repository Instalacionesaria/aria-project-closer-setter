/**
 * `POST /api/closer/avanzar` — el único registro de resultados humanos (CLAUDE.md §4.12).
 *
 * Hoy solo implementa la salida **Seguimiento**, que es el alcance de este trabajo. Las
 * otras cinco (Venta, Acordó, No le interesa, No-show, Nurture) devuelven 501 en vez de
 * fingir que funcionan: cada una tiene su tag y su custom field propios, y aplicarlos mal
 * en GHL dispara el workflow equivocado.
 *
 * El request manda la INTENCIÓN, nunca una fecha calculada por el browser
 * (`{ modo: "manual", preset: "en_3_dias" }`). El servidor la resuelve contra America/Lima.
 * Ese fue exactamente el bug de `isoInDays`: aritmética en la zona del cliente que después
 * de las 19:00 en Lima devolvía el día siguiente.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SITUACIONES, type SituacionSeguimiento } from "../../src/lib/ghl/contrato.js";
import {
  SeguimientoInvalidoError,
  permiteSeguimientoAutomatico,
  type ModoSeguimiento,
  type PresetManual,
} from "../../src/lib/seguimientos/dominio.js";
import { ghl } from "../_lib/ghl/index.js";
import { registrarSeguimiento } from "../_lib/seguimientos.js";

const PRESETS_VALIDOS: readonly string[] = ["manana", "en_3_dias", "una_semana", "personalizada"];
const SLUGS = SITUACIONES.map((s) => s.slug);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Solo POST." });
  }

  const cuerpo = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (!cuerpo) return res.status(400).json({ ok: false, error: "Cuerpo JSON inválido." });

  const { ghlContactId, resultado, situacion, modo, preset, fechaPersonalizada, nota, idempotencyKey } = cuerpo as Record<
    string,
    string | undefined
  >;

  /* ── Validación ── */
  if (!ghlContactId) return malo(res, "Falta ghlContactId.", "contacto_faltante");
  if (!idempotencyKey) return malo(res, "Falta idempotencyKey.", "idempotency_faltante");

  if (resultado && resultado !== "seguimiento") {
    return res.status(501).json({
      ok: false,
      codigo: "resultado_no_implementado",
      error: `La salida "${resultado}" todavía no está implementada. Este trabajo cubre solo Seguimiento.`,
    });
  }

  if (!situacion || !SLUGS.includes(situacion as SituacionSeguimiento)) {
    return malo(res, `Situación inválida. Esperada una de: ${SLUGS.join(", ")}.`, "situacion_invalida");
  }
  if (modo !== "automatico" && modo !== "manual") {
    return malo(res, 'Modo inválido: "automatico" o "manual".', "modo_invalido");
  }
  if (modo === "manual" && (!preset || !PRESETS_VALIDOS.includes(preset))) {
    return malo(res, `Preset inválido. Esperado uno de: ${PRESETS_VALIDOS.join(", ")}.`, "preset_invalido");
  }

  /**
   * Instagram no tiene bot ni workflow (§11), así que ofrecer la serie automática sería
   * prometer mensajes que nadie va a enviar. Se valida acá además de ocultarlo en la UI:
   * la UI se puede saltar, el servidor no.
   */
  if (modo === "automatico") {
    const contacto = await ghl().obtenerContacto(ghlContactId);
    const canal = detectarCanal(contacto?.tags ?? []);
    if (canal && !permiteSeguimientoAutomatico(canal)) {
      return res.status(422).json({
        ok: false,
        codigo: "canal_sin_automatico",
        error: `El canal ${canal} no admite seguimiento automático todavía. Usá el modo manual.`,
      });
    }
  }

  /* ── Registro ── */
  try {
    const r = await registrarSeguimiento({
      ghlContactId,
      situacion: situacion as SituacionSeguimiento,
      modo: modo as ModoSeguimiento,
      preset: preset as PresetManual | undefined,
      fechaPersonalizada,
      nota,
      idempotencyKey,
    });

    // Un efecto fallido no invalida el registro — el seguimiento ya existe y la intención
    // quedó en el outbox. Pero se reporta, porque significa que GHL todavía no lo sabe.
    const fallidos = r.efectosGhl.filter((e) => !e.ok);
    const sinAplicar = r.efectosGhl.filter((e) => e.ok && !e.aplicado);

    return res.status(200).json({
      ok: true,
      seguimientoId: r.seguimientoId,
      fechaObjetivo: r.fechaObjetivo,
      reemplazo: r.reemplazo,
      toast: r.toast,
      ghl: {
        modo: ghl().modo,
        efectos: r.efectosGhl,
        ...(fallidos.length ? { advertencia: `${fallidos.length} efecto(s) fallaron en GHL; quedaron en el outbox.` } : {}),
        ...(sinAplicar.length && ghl().modo === "stub"
          ? { nota: "Adapter en modo stub: los efectos se registraron pero NO se aplicaron en GHL." }
          : {}),
      },
    });
  } catch (e) {
    if (e instanceof SeguimientoInvalidoError) return malo(res, e.message, e.codigo);
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/** El canal sale de los tags de origen; sin tag reconocible no se asume nada (§4.10). */
function detectarCanal(tags: readonly string[]): string | undefined {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes("instagram") || x === "ig")) return "instagram";
  if (t.includes("lead_meta_ads")) return "meta_ads";
  return undefined;
}

const malo = (res: VercelResponse, error: string, codigo: string) => res.status(400).json({ ok: false, codigo, error });

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
