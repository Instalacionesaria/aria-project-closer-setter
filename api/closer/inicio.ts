/**
 * `GET /api/closer/inicio` — las métricas del dashboard, del MES CALENDARIO en curso (Lima).
 *
 * Todo calculado por query sobre `closer_avances` + `closer_citas` (doc §8.1): nada
 * hardcodeado, nada contado a mano, ningún contador suelto que pueda desincronizarse. El
 * dinero sale de los formularios de Avanzar — el Opportunity Value se manda a GHL al
 * registrar la venta pero NUNCA se lee de vuelta (decisión de Fabio, 2026-07-31).
 *
 * Consecuencia honesta: el mes arranca de CERO. No hay historial anterior a este sistema, y
 * las semillas EJEMPLO no suman (no existen en `closer_avances`). El nombre del mes viaja en
 * la respuesta para que la vista lo muestre y nadie confunda "el mes empezó" con "no vendo".
 *
 * // FUTURO (no implementar): filtro para ver otros meses / configurar qué métricas se
 * // muestran. La query ya recibe los límites como rango — cambiar de mes es cambiar dos
 * // parámetros, no reescribir el endpoint.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hoyISO, ZONA_HORARIA_ORG } from "../../src/lib/fechas.js";
import { offsetOrg } from "../_lib/citas.js";
import { env } from "../_lib/env.js";
import { db, hoyOrg } from "../_lib/repo.js";
import { exigir } from "../_lib/auth.js";

/** Fecha civil (YYYY-MM-DD) de un timestamp, en la zona de la organización. */
function diaLima(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA_ORG }).format(new Date(iso));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer"]);
  if (!ctx) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const hoy = (await hoyOrg()) ?? hoyISO();
    const inicioMesIso = `${hoy.slice(0, 7)}-01`;
    const desde = `${inicioMesIso}T00:00:00${offsetOrg(inicioMesIso)}`;
    const hasta = `${hoy}T23:59:59${offsetOrg(hoy)}`;
    const nombreMes = new Intl.DateTimeFormat("es-PE", { timeZone: ZONA_HORARIA_ORG, month: "long" }).format(
      new Date(`${hoy}T12:00:00Z`),
    );

    /* ── Avances del mes ─────────────────────────────────────────────────── */
    const { data: avances, error: errAvances } = await db()
      .from("closer_avances")
      .select("ghl_contact_id, salida, detalle, created_at")
      .gte("created_at", desde)
      .lte("created_at", hasta);
    if (errAvances) throw new Error(`closer_avances: ${errAvances.message}`);

    const ventas = (avances ?? []).filter((a) => a.salida === "venta");
    const cashCollected = ventas.reduce((s, a) => {
      const monto = Number((a.detalle as Record<string, unknown>)?.monto ?? 0);
      return s + (Number.isFinite(monto) && monto > 0 ? monto : 0);
    }, 0);

    /**
     * Pagos posteriores de un "Acordó comprar" (doc §8.1: "si el formulario registra monto
     * cobrado"): el formulario actual de Acordó guarda `monto` como SEÑA/promesa, no como
     * pago verificado — así que NO se suma al cash. Queda visible como "sobre la mesa".
     */
    const acuerdos = (avances ?? []).filter((a) => a.salida === "acordo");
    const sobreLaMesa = acuerdos.reduce((s, a) => {
      const monto = Number((a.detalle as Record<string, unknown>)?.monto ?? 0);
      return s + (Number.isFinite(monto) && monto > 0 ? monto : 0);
    }, 0);

    /* ── Citas del mes ───────────────────────────────────────────────────── */
    const { data: citas, error: errCitas } = await db()
      .from("closer_citas")
      .select("ghl_contact_id, fecha_hora, estado_ghl")
      .gte("fecha_hora", desde)
      .lte("fecha_hora", hasta)
      .neq("estado_ghl", "cancelled");
    if (errCitas) throw new Error(`closer_citas: ${errCitas.message}`);

    const agendadas = citas ?? [];
    const pasadas = agendadas.filter((c) => new Date(c.fecha_hora).getTime() < Date.now());

    /**
     * "Llamadas que sí ocurrieron" (doc §8.1): citas pasadas del mes cuya salida de Avanzar
     * NO fue `no_show`. La relación cita↔avance es por contacto y mismo día civil (Lima) —
     * no hay FK entre las dos tablas, y el mismo día es el vínculo honesto disponible.
     */
    const noShowPorContactoDia = new Set(
      (avances ?? [])
        .filter((a) => a.salida === "no_show")
        .map((a) => `${a.ghl_contact_id}:${diaLima(a.created_at)}`),
    );
    const ocurridas = pasadas.filter(
      (c) => !noShowPorContactoDia.has(`${c.ghl_contact_id}:${diaLima(c.fecha_hora)}`),
    ).length;

    return res.status(200).json({
      ok: true,
      mes: nombreMes,
      rango: { desde: inicioMesIso, hasta: hoy },
      zonaHoraria: ZONA_HORARIA_ORG,
      ghlModo: env.ghlModo(),
      cashCollected,
      ventas: ventas.length,
      sobreLaMesa,
      acuerdos: acuerdos.length,
      /** Base explícita para el "X de Y" (§4.9 de CLAUDE.md). */
      llamadas: { ocurridas, agendadas: agendadas.length, pasadas: pasadas.length },
      showRate: pasadas.length > 0 ? Math.round((ocurridas / pasadas.length) * 100) : null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
