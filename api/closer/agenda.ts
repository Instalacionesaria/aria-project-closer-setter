/**
 * `GET /api/closer/agenda` — las citas reales del calendario de la subcuenta.
 *
 *   ?days=0   (default) solo HOY  → widget "Agenda de Hoy" de Mi Día
 *   ?days=N   hoy .. hoy+N        → tab Agenda y "Próximos Días"
 *   ?calendarId=...               → default: GHL_DEFAULT_CALENDAR_ID
 *   ?includeCancelled=true        → default: se ocultan las canceladas
 *
 * Un solo handler para los dos casos: "hoy" es el rango de 0 días. Dos funciones separadas
 * eran el mismo código dos veces, y en Hobby cada archivo de `api/` gasta uno de los 12
 * slots de funciones que tiene el proyecto.
 *
 * Devuelve SOLO lo que GHL sabe. El score (A/B/C/D) y el Briefing IA no salen de acá: los
 * pinta el motor cuando exista, y hasta entonces la UI muestra "—" en vez de inventarlos
 * (§4.7 / §4.10).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hoyISO, sumarDias, ZONA_HORARIA_ORG } from "../../src/lib/fechas.js";
import { env } from "../_lib/env.js";
import { ghl } from "../_lib/ghl/index.js";
import { eventosDeCalendario, type EventoCalendario } from "../_lib/ghl/lectura.js";

/**
 * Rango epoch-ms que cubre desde el arranque de hoy hasta el final del día `hoy + dias`,
 * en la zona de la organización. El offset sale del propio `Intl` en vez de hardcodearse,
 * así el día no se corre si la subcuenta cambia de zona o entra en horario de verano.
 */
function rangoEnMs(dias: number): { desdeMs: number; hastaMs: number; hoy: string; ultimo: string } {
  const hoy = hoyISO();
  const ultimo = sumarDias(hoy, dias);
  const desdeMs = new Date(`${hoy}T00:00:00${offsetOrg(hoy)}`).getTime();
  const hastaMs = new Date(`${ultimo}T23:59:59${offsetOrg(ultimo)}`).getTime();
  return { desdeMs, hastaMs, hoy, ultimo };
}

/** Offset (`-05:00`) de la zona de la organización para una fecha dada. */
function offsetOrg(iso: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_HORARIA_ORG,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${iso}T12:00:00Z`));
  const nombre = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  return nombre.replace("GMT", "") || "-05:00";
}

/** Normaliza un evento de GHL al shape que consume el frontend. */
function normalizar(e: EventoCalendario) {
  // `startTime` viene como "2026-07-27T11:00:00-05:00": la hora local son las posiciones 11-16.
  const hora = typeof e.startTime === "string" ? e.startTime.slice(11, 16) : "";
  const fecha = typeof e.startTime === "string" ? e.startTime.slice(0, 10) : "";
  // El título suele ser "Discovery Call - Nombre"; nos quedamos con el nombre.
  const titulo = e.title ?? "";
  const nombre = titulo.replace(/^.*?-\s*/, "").trim() || titulo || "Sin nombre";

  return {
    id: e.id,
    name: nombre,
    title: titulo,
    date: fecha,
    time: hora,
    startTime: e.startTime,
    endTime: e.endTime ?? null,
    status: e.appointmentStatus ?? "unknown",
    meetUrl: e.address ?? null,
    contactId: e.contactId ?? null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const calendarId = (req.query.calendarId as string) || env.ghlCalendarioPorDefecto();
    const dias = Math.min(Math.max(parseInt(String(req.query.days ?? "0"), 10) || 0, 0), 31);
    const incluirCanceladas = req.query.includeCancelled === "true";
    const { desdeMs, hastaMs, hoy, ultimo } = rangoEnMs(dias);

    // Sin calendario configurado no hay nada que consultar. No es un error del cliente: es
    // configuración que falta, y la UI tiene que poder decirlo sin pintar una pantalla rota.
    if (!calendarId) {
      return res.status(200).json({
        ok: true,
        date: hoy,
        hasta: ultimo,
        days: dias,
        calendarId: null,
        ghlModo: ghl().modo,
        count: 0,
        appointments: [],
        aviso: "Falta GHL_DEFAULT_CALENDAR_ID (o el parámetro calendarId).",
      });
    }

    const eventos = await eventosDeCalendario({ calendarId, desdeMs, hastaMs });
    let citas = eventos
      .map(normalizar)
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
    if (!incluirCanceladas) citas = citas.filter((c) => c.status !== "cancelled");

    return res.status(200).json({
      ok: true,
      date: hoy,
      hasta: ultimo,
      days: dias,
      calendarId,
      zonaHoraria: ZONA_HORARIA_ORG,
      ghlModo: ghl().modo,
      count: citas.length,
      appointments: citas,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
