/**
 * `GET /api/setter/inicio` — el cockpit del setter, calculado.
 *
 * ── Qué reemplaza ─────────────────────────────────────────────────────
 *
 * `SETTER_COCKPIT_BASE`: **diez constantes** en el store del browser (`ltBruto: 500`,
 * `diferidaBruto: 10000`, `agendasAutomaticas: 33`, `showRatePct: 78`…). De las cifras que el
 * cockpit mostraba, solo tres tenían aritmética — y las tres multiplicaban una base fija. El hero
 * de comisiones era, literalmente, un porcentaje configurable por una constante inventada.
 *
 * ── Las dos comisiones, y por qué la diferida necesitaba la migración 032 ──
 *
 *   LT cobradas = bruto low-ticket × % directa
 *   Diferidas   = bruto de ventas HT **originadas por este setter** × % diferida
 *
 * La segunda no se podía calcular hasta ahora: exigía saber qué contactos trabajó a mano un
 * setter, y ese latch vivía en el browser —se escribía en seis lugares y no se leía en ninguno—
 * así que moría al refrescar. `closer_contactos.atribucion_setter_id` es lo que lo hace
 * responder, y por eso el cockpit es lo último de la fase y no lo primero.
 *
 * ── Sin dato, `null` ──────────────────────────────────────────────────
 *
 * Un setter sin comisión cargada no ve `$0`: ve el campo sin renderizar. `$0` afirma que ganó
 * cero, y eso es distinto de "nadie configuró su porcentaje" — que es lo que pasa el primer día
 * de cualquier empresa nueva.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigir } from "../_lib/auth.js";
import { activar } from "../_lib/credenciales.js";
import { db, hoyOrg } from "../_lib/repo.js";
import { offsetOrg } from "../_lib/citas.js";
import { hoyISO } from "../../src/lib/fechas.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["setter"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const hoy = (await hoyOrg()) ?? hoyISO();
    // El mes corriente en la zona de la empresa. Nunca aritmética de zona en Node.
    const desde = `${hoy.slice(0, 7)}-01T00:00:00${offsetOrg(hoy)}`;

    /* ── Los porcentajes de ESTA persona ────────────────────────────── */
    const { data: pcts } = await db()
      .from("closer_comisiones")
      .select("tipo, pct")
      .eq("usuario_id", ctx.usuarioId);

    const porTramo = new Map(
      ((pcts ?? []) as { tipo: string; pct: string | number }[]).map((c) => [c.tipo, Number(c.pct)]),
    );
    const pctLt = porTramo.get("setter_lt") ?? null;
    const pctDiferida = porTramo.get("setter_diferida") ?? null;

    /* ── Su low-ticket del mes ──────────────────────────────────────── */
    const { data: lts } = await db()
      .from("closer_avances")
      .select("detalle")
      .eq("rol", "setter")
      .eq("salida", "venta_lt")
      .eq("autor_usuario_id", ctx.usuarioId)
      .gte("created_at", desde);

    const ventasLt = (lts ?? []) as { detalle: Record<string, unknown> }[];
    const ltBruto = ventasLt.reduce((s, v) => s + (typeof v.detalle?.monto === "number" ? v.detalle.monto : 0), 0);

    /* ── Las agendas que generó él ──────────────────────────────────── */
    /**
     * Separadas de las automáticas a propósito: **lo que agendó el bot solo no es mérito del
     * setter**. Las suyas son sus avances con salida `agendo`; las automáticas son las citas de
     * contactos que ningún setter tocó a mano.
     */
    const { data: agendas } = await db()
      .from("closer_avances")
      .select("ghl_contact_id")
      .eq("rol", "setter")
      .eq("salida", "agendo")
      .eq("autor_usuario_id", ctx.usuarioId)
      .gte("created_at", desde);

    const agendasGeneradas = (agendas ?? []).length;

    /* ── Las diferidas: HT del closer sobre leads que él originó ────── */
    /**
     * Dos queries y no un join: PostgREST no expone joins entre tablas sin FK declarada, y
     * `closer_avances` referencia al contacto por `ghl_contact_id` (texto), no por FK. Traer los
     * ids atribuidos y filtrar es exacto y barato — son pocos por definición.
     */
    const { data: misContactos } = await db()
      .from("closer_contactos")
      .select("ghl_contact_id")
      .eq("atribucion_setter_id", ctx.usuarioId);

    const idsAtribuidos = ((misContactos ?? []) as { ghl_contact_id: string }[]).map((c) => c.ghl_contact_id);

    let diferidaBruto = 0;
    let diferidaVentas = 0;
    if (idsAtribuidos.length > 0) {
      const { data: hts } = await db()
        .from("closer_avances")
        .select("detalle")
        .eq("rol", "closer")
        .eq("salida", "venta")
        .in("ghl_contact_id", idsAtribuidos)
        .gte("created_at", desde);

      const ventasHt = (hts ?? []) as { detalle: Record<string, unknown> }[];
      diferidaVentas = ventasHt.length;
      diferidaBruto = ventasHt.reduce((s, v) => s + (typeof v.detalle?.monto === "number" ? v.detalle.monto : 0), 0);
    }

    /**
     * `null` cuando no hay porcentaje cargado, no cero. La vista no renderiza el elemento en vez
     * de afirmar que ganó $0 — es la regla 1 del proyecto.
     */
    const comisionLt = pctLt !== null ? Math.round(ltBruto * (pctLt / 100)) : null;
    const comisionDiferida = pctDiferida !== null ? Math.round(diferidaBruto * (pctDiferida / 100)) : null;
    const comisionTotal =
      comisionLt === null && comisionDiferida === null ? null : (comisionLt ?? 0) + (comisionDiferida ?? 0);

    return res.status(200).json({
      ok: true,
      // Cero llamadas a GHL: todo sale de la base.
      llamadasGhl: 0,
      periodo: hoy.slice(0, 7),
      cockpit: {
        comisionLt,
        comisionDiferida,
        comisionTotal,
        // Las bases viajan junto a la comisión: un número sin su base no se puede verificar (§4.9).
        ltBruto,
        ltVentas: ventasLt.length,
        diferidaBruto,
        diferidaVentas,
        agendasGeneradas,
        /**
         * Los que NO se pueden calcular todavía, y por qué. Viajan `null` con su motivo en vez de
         * desaparecer: la vista los muestra como pendientes y no como ceros.
         */
        sinDato: {
          agendasAutomaticas:
            "Falta distinguir una cita agendada por el bot de una agendada por un humano: " +
            "`closer_citas` no guarda quién la creó.",
          showRate:
            "El show-rate del setter necesita saber si el contacto asistió, y GHL nunca marca " +
            "`showed` (ver 10-ESTADO § Huecos conocidos).",
        },
        // Falta el porcentaje: la vista lo dice y linkea a Ajustes, no muestra $0.
        faltaPctLt: pctLt === null,
        faltaPctDiferida: pctDiferida === null,
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
