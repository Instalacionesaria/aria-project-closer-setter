/**
 * `GET /api/closer/agenda` — las citas, desde la CACHÉ (`closer_citas`). Cero GHL.
 *
 *   ?days=0   (default) solo HOY  → widget "Agenda de Hoy" de Mi Día
 *   ?days=N   hoy .. hoy+N        → tab Agenda y "Próximos Días"
 *   ?refrescar=1                  → 1 llamada a GHL para ese rango ANTES de leer la caché
 *   ?includeCancelled=true        → default: se ocultan las canceladas
 *
 * Hasta el 2026-07-31 este endpoint llamaba a GHL en cada request — y el frontend lo
 * pedía cada 10s desde TRES vistas a la vez. Ahora la caché la mantienen el webhook de
 * cita y el cron de :25/:55 (`citas-respaldo.ts`), y esto es una query a Supabase.
 *
 * `refrescar=1` es el escape para el clic en un día no cacheado y el botón "Refrescar"
 * de la Agenda (doc §8.5): exactamente 1 llamada a GHL, por acción explícita del usuario.
 * Red de seguridad adicional: si el rango pedido está VACÍO en caché y hay credenciales,
 * se refresca solo una vez — cubre la primera carga después del deploy, cuando el cron
 * todavía no corrió.
 *
 * El shape de la respuesta es el MISMO que tenía (appointments normalizados): el frontend
 * no distingue de dónde salieron.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hoyISO, sumarDias, ZONA_HORARIA_ORG } from "../../src/lib/fechas.js";
import { fechaHoraOrg, offsetOrg, sincronizarCitas } from "../_lib/citas.js";
import { env } from "../_lib/env.js";
import { ghl } from "../_lib/ghl/index.js";
import { db } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

interface FilaCita {
  ghl_appointment_id: string;
  ghl_contact_id: string;
  fecha_hora: string;
  estado_ghl: string | null;
  titulo: string | null;
  meet_url: string | null;
}

/** Normaliza una fila de la caché al shape que el frontend ya consume. */
function normalizar(c: FilaCita) {
  // `fecha_hora` es timestamptz (UTC en el wire); la hora local se reconstruye en la zona
  // de la organización — igual que hacía la versión GHL-directa con el offset del evento.
  // `fechaHoraOrg` es compartida con el Pipeline: una sola definición de "la hora de la cita".
  const { fecha, hora } = fechaHoraOrg(c.fecha_hora);
  const titulo = c.titulo ?? "";
  const nombre = titulo.replace(/^.*?-\s*/, "").trim() || titulo || "Sin nombre";

  return {
    id: c.ghl_appointment_id,
    name: nombre,
    title: titulo,
    date: fecha,
    time: hora,
    startTime: c.fecha_hora,
    endTime: null,
    status: c.estado_ghl ?? "unknown",
    meetUrl: c.meet_url,
    contactId: c.ghl_contact_id || null,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const dias = Math.min(Math.max(parseInt(String(req.query.days ?? "0"), 10) || 0, 0), 31);
    const incluirCanceladas = req.query.includeCancelled === "true";
    const hoy = hoyISO();
    const ultimo = sumarDias(hoy, dias);
    const desdeIso = `${hoy}T00:00:00${offsetOrg(hoy)}`;
    const hastaIso = `${ultimo}T23:59:59${offsetOrg(ultimo)}`;

    const leer = async (): Promise<FilaCita[]> => {
      const { data, error } = await db()
        .from("closer_citas")
        .select("ghl_appointment_id, ghl_contact_id, fecha_hora, estado_ghl, titulo, meet_url")
        .gte("fecha_hora", desdeIso)
        .lte("fecha_hora", hastaIso)
        .order("fecha_hora", { ascending: true });
      if (error) throw new Error(`closer_citas: ${error.message}`);
      return (data ?? []) as FilaCita[];
    };

    let refresco = false;
    let filas = req.query.refrescar === "1" ? [] : await leer();

    /**
     * Refresco automático SOLO si el rango está vacío Y nadie sincronizó nada en los
     * últimos 35 min (la cadencia del cron). Sin la segunda condición, un día genuinamente
     * sin citas dispararía 1 llamada a GHL por cada poll del widget — el patrón exacto que
     * esta arquitectura vino a matar. Con ella, el peor caso queda acotado a ~2/hora,
     * igual que el cron.
     */
    const necesitaAuto = async (): Promise<boolean> => {
      if (filas.length > 0) return false;
      const { data } = await db()
        .from("closer_citas")
        .select("actualizado_el")
        .order("actualizado_el", { ascending: false })
        .limit(1)
        .maybeSingle();
      const ultimoSync = data?.actualizado_el ? new Date(data.actualizado_el).getTime() : 0;
      return Date.now() - ultimoSync > 35 * 60_000;
    };

    if (env.tieneCredencialesGhl() && (req.query.refrescar === "1" || (await necesitaAuto()))) {
      await sincronizarCitas(hoy, ultimo);
      refresco = true;
      filas = await leer();
    }

    let citas = filas.map(normalizar);
    if (!incluirCanceladas) citas = citas.filter((c) => c.status !== "cancelled");

    return res.status(200).json({
      ok: true,
      date: hoy,
      hasta: ultimo,
      days: dias,
      calendarId: env.ghlCalendarioPorDefecto() ?? null,
      zonaHoraria: ZONA_HORARIA_ORG,
      ghlModo: ghl().modo,
      fuente: refresco ? "ghl+cache" : "cache",
      count: citas.length,
      appointments: citas,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
