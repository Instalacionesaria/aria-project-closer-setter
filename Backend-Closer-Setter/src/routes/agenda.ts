import { Router } from "express";
import {
  getCalendarEvents,
  listCalendars,
  searchConversation,
  getMessages,
  addContactTags,
  listRecentConversations,
  getContactsByTag,
  getLatestIaNote,
  type GhlCalendarEvent,
} from "../lib/ghl";
import { evaluateConversation } from "../lib/evaluator";
import { runAnalysis } from "../lib/scheduler";

export const agendaRouter = Router();

/** Formatea una fecha ISO a "10:00 AM" en la zona de la subcuenta. */
function fmtTime(iso: string | undefined, tz: string): string {
  if (!iso) return "";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
  } catch {
    return "";
  }
}

/** Rango [startMs, endMs] de "hoy" en la zona horaria de la subcuenta. */
function todayRange(tz: string, offset: string): { startMs: number; endMs: number; date: string } {
  // Fecha de HOY en la zona de la subcuenta (independiente de la zona del VPS).
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date()); // "2026-07-16"

  const startMs = new Date(`${date}T00:00:00${offset}`).getTime();
  const endMs = new Date(`${date}T23:59:59${offset}`).getTime();
  return { startMs, endMs, date };
}

/** Rango [hoy 00:00, hoy+days 23:59] en la zona de la subcuenta. */
function rangeForDays(tz: string, offset: string, days: number): { startMs: number; endMs: number; today: string } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const startMs = new Date(`${today}T00:00:00${offset}`).getTime();
  const endMs = startMs + (days + 1) * 24 * 3600 * 1000 - 1000; // fin del último día del rango
  return { startMs, endMs, today };
}

/** Normaliza un evento de GHL al shape que consume el widget "Agenda de Hoy" del frontend. */
function normalize(e: GhlCalendarEvent) {
  // startTime viene como "2026-07-16T10:00:00-05:00" → la hora local es HH:MM (posiciones 11-16).
  const time = typeof e.startTime === "string" ? e.startTime.slice(11, 16) : "";
  // El título suele ser "Discovery Call - Nombre"; extraemos el nombre.
  const rawTitle = e.title ?? "";
  const name = rawTitle.replace(/^.*?-\s*/, "").trim() || rawTitle || "Sin nombre";
  const date = typeof e.startTime === "string" ? e.startTime.slice(0, 10) : ""; // YYYY-MM-DD
  return {
    id: e.id,
    name,
    title: rawTitle,
    date,
    time,
    startTime: e.startTime,
    endTime: e.endTime ?? null,
    status: e.appointmentStatus ?? "unknown",
    meetUrl: e.address ?? null,
    contactId: e.contactId ?? null,
    // NOTA: score (A/B/C/D) y Briefing IA NO vienen de GHL — los pondrá el motor más adelante.
  };
}

/**
 * GET /api/agenda-hoy
 *   ?calendarId=...        (opcional; default = GHL_DEFAULT_CALENDAR_ID) — a futuro: el selector de calendario
 *   ?includeCancelled=true (opcional; default false = solo no-canceladas)
 */
agendaRouter.get("/agenda-hoy", async (req, res) => {
  try {
    const locationId = process.env.GHL_LOCATION_ID;
    const calendarId = (req.query.calendarId as string) || process.env.GHL_DEFAULT_CALENDAR_ID;
    if (!locationId) return res.status(500).json({ error: "Falta GHL_LOCATION_ID" });
    if (!calendarId) return res.status(400).json({ error: "Falta calendarId (ni query ni GHL_DEFAULT_CALENDAR_ID)" });

    const includeCancelled = req.query.includeCancelled === "true";
    const tz = process.env.GHL_TZ || "America/Bogota";
    const offset = process.env.GHL_TZ_OFFSET || "-05:00";
    const { startMs, endMs, date } = todayRange(tz, offset);

    const events = await getCalendarEvents({ locationId, calendarId, startMs, endMs });
    let appointments = events
      .map(normalize)
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

    if (!includeCancelled) {
      appointments = appointments.filter((a) => a.status !== "cancelled");
    }

    res.json({ date, calendarId, count: appointments.length, appointments });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});

/**
 * GET /api/agenda-range?days=N&calendarId=&includeCancelled=
 * Trae las citas de HOY hasta hoy+N días (default 6), cada una con su `date` (YYYY-MM-DD).
 * Alimenta "Próximos Días" y el mini-calendario, y permite ver la agenda de cualquier día del rango.
 */
agendaRouter.get("/agenda-range", async (req, res) => {
  try {
    const locationId = process.env.GHL_LOCATION_ID;
    const calendarId = (req.query.calendarId as string) || process.env.GHL_DEFAULT_CALENDAR_ID;
    if (!locationId) return res.status(500).json({ error: "Falta GHL_LOCATION_ID" });
    if (!calendarId) return res.status(400).json({ error: "Falta calendarId" });

    const days = Math.min(Math.max(parseInt(String(req.query.days ?? "6"), 10) || 6, 1), 31);
    const includeCancelled = req.query.includeCancelled === "true";
    const tz = process.env.GHL_TZ || "America/Bogota";
    const offset = process.env.GHL_TZ_OFFSET || "-05:00";
    const { startMs, endMs, today } = rangeForDays(tz, offset, days);

    const events = await getCalendarEvents({ locationId, calendarId, startMs, endMs });
    let appointments = events
      .map(normalize)
      .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));
    if (!includeCancelled) appointments = appointments.filter((a) => a.status !== "cancelled");

    res.json({ today, days, calendarId, count: appointments.length, appointments });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});

/**
 * GET /api/conversation?contactId=...
 * Trae la conversación real del contacto desde GHL, normalizada para el Chat de Frank.
 * Excluye las entradas de actividad (TYPE_ACTIVITY_*) — esas son eventos, no mensajes de chat.
 */
agendaRouter.get("/conversation", async (req, res) => {
  try {
    const locationId = process.env.GHL_LOCATION_ID;
    const contactId = req.query.contactId as string;
    if (!locationId) return res.status(500).json({ error: "Falta GHL_LOCATION_ID" });
    if (!contactId) return res.status(400).json({ error: "Falta contactId" });

    const conversationId = await searchConversation(locationId, contactId);
    if (!conversationId) return res.json({ conversationId: null, count: 0, messages: [] });

    const tz = process.env.GHL_TZ || "America/Bogota";
    const raw = await getMessages(conversationId);
    const messages = raw
      .filter((m) => m.body && !(m.messageType ?? "").startsWith("TYPE_ACTIVITY"))
      .map((m) => ({
        id: m.id,
        text: m.body ?? "",
        outgoing: m.direction === "outbound",
        type: m.messageType ?? "",
        date: m.dateAdded ?? "",
        time: fmtTime(m.dateAdded, tz),
      }))
      .reverse(); // GHL devuelve más reciente primero → lo pasamos a orden cronológico

    res.json({ conversationId, count: messages.length, messages });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});

/**
 * POST /api/contacts/:contactId/tags   body: { tags: string[] }
 * Aplica tags reales al contacto en GHL — dispara los workflows atados (mueve stage, etc.).
 * Es la escritura del "Avanzar" (rol de Kevin, que por ahora hace este backend).
 */
agendaRouter.post("/contacts/:contactId/tags", async (req, res) => {
  try {
    const { contactId } = req.params;
    const tags = (req.body?.tags ?? []) as string[];
    if (!contactId) return res.status(400).json({ error: "Falta contactId" });
    if (!Array.isArray(tags) || tags.length === 0) return res.status(400).json({ error: "Falta tags[]" });
    const result = await addContactTags(contactId, tags);
    res.json({ ok: true, contactId, tagsApplied: tags, ghl: result });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});

/**
 * GET /api/evaluate-urgentes?days=30&limit=10&apply=false
 * Analiza las conversaciones de los ÚLTIMOS `days` días con Claude contra la rúbrica de "la IA no atendió bien".
 * Por defecto es DRY-RUN (apply=false): solo devuelve el reporte, NO toca GHL.
 * Con apply=true: aplica el tag `bot_pausado_fallo` a los contactos de las conversaciones que fallaron
 * → aparecen en "Intervenciones Urgentes" y disparan el workflow de GHL (apaga el bot).
 */
agendaRouter.get("/evaluate-urgentes", async (req, res) => {
  try {
    const locationId = process.env.GHL_LOCATION_ID;
    if (!locationId) return res.status(500).json({ error: "Falta GHL_LOCATION_ID" });

    const days = Math.min(Math.max(parseInt(String(req.query.days ?? "30"), 10) || 30, 1), 60);
    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "10"), 10) || 10, 1), 100);
    const apply = req.query.apply === "true";
    const sinceMs = Date.now() - days * 24 * 3600 * 1000;

    const convs = await listRecentConversations(locationId, sinceMs, 100);
    const toAnalyze = convs.slice(0, limit);

    const resultados: any[] = [];
    for (const c of toAnalyze) {
      try {
        const msgs = await getMessages(c.id);
        const v = await evaluateConversation(msgs);
        resultados.push({ conversationId: c.id, contactId: c.contactId ?? null, name: c.fullName ?? null, ...v });
      } catch (e: any) {
        resultados.push({ conversationId: c.id, contactId: c.contactId ?? null, name: c.fullName ?? null, error: e?.message ?? "error al evaluar" });
      }
    }

    const fallidos = resultados.filter((r) => r.fallo === true);
    let aplicados = 0;
    if (apply) {
      for (const f of fallidos) {
        if (f.contactId) {
          try {
            await addContactTags(f.contactId, ["bot_pausado_fallo"]);
            aplicados++;
          } catch {
            /* si falla el tag de uno, sigue con los demás */
          }
        }
      }
    }

    res.json({
      dias: days,
      dryRun: !apply,
      conversacionesEnRango: convs.length,
      analizadas: toAnalyze.length,
      noAnalizadasPorTope: Math.max(0, convs.length - toAnalyze.length),
      fallos: fallidos.length,
      tagsAplicados: aplicados,
      resultados,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});

/**
 * POST /api/run-analysis?hours=26&limit=50&apply=true
 * Dispara el análisis manualmente (el cron lo hace solo cada día). Para probar/demostrar.
 */
agendaRouter.post("/run-analysis", async (req, res) => {
  try {
    const hours = req.query.hours ? parseInt(String(req.query.hours), 10) : undefined;
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : undefined;
    const apply = req.query.apply === "true";
    const summary = await runAnalysis({ windowHours: hours, max: limit, apply });
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});

/**
 * GET /api/urgentes
 * Contactos REALES marcados por la IA como fallo (tag `bot_pausado_fallo`) → para "Intervenciones Urgentes".
 * El tool los muestra junto a los EJEMPLO, en el mismo formato.
 */
agendaRouter.get("/urgentes", async (req, res) => {
  try {
    const locationId = process.env.GHL_LOCATION_ID;
    if (!locationId) return res.status(500).json({ error: "Falta GHL_LOCATION_ID" });
    const contactos = await getContactsByTag(locationId, "bot_pausado_fallo");
    // Para cada contacto, leemos su última nota "[IA] ..." (el motivo real que dejó el analizador).
    const urgentes = await Promise.all(
      contactos.map(async (c) => {
        let fallo = "requiere intervención — revisar conversación"; // fallback si aún no hay nota
        try {
          const motivo = await getLatestIaNote(c.id);
          if (motivo) fallo = motivo;
        } catch {
          /* si falla la lectura de notas de uno, usamos el genérico */
        }
        return {
          contactId: c.id,
          name: c.name,
          source: c.source,
          // El prefijo "Falla detectada por IA:" lo pone el tool; aquí va el motivo específico.
          fallo,
        };
      }),
    );
    res.json({ count: urgentes.length, urgentes });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});

/** Tags de desenlace del closer (los que aplica el botón "Avanzar"). El orden = prioridad de píldora
 * cuando un contacto acumuló varios en el tiempo (regla §4 del contrato: gana el del stage vigente). */
const CLOSER_OUTCOME_TAGS = ["venta_ganada", "adelanto_ganado", "no_show", "noshow", "seguimiento", "nurture_appflow", "descalificado"];

/** Texto relativo "hace 2h" a partir de una fecha ISO. */
function relativeTime(iso: string | undefined): string {
  if (!iso) return "";
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "recién";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d} día${d > 1 ? "s" : ""}`;
}

/**
 * GET /api/respondieron
 * "Respondieron · Buzón General" del CLOSER. Un contacto entra si cumple LAS 3:
 *   1. tiene tag `zona_closer` (territorio closer, ya agendó/tuvo call)
 *   2. tiene un tag de desenlace de "Avanzar" (venta_ganada / adelanto_ganado / seguimiento / ...)
 *   3. su ÚLTIMO mensaje es entrante (el contacto volvió a escribir y NADIE respondió)
 * La píldora se deriva del desenlace; el tool la pinta con su color.
 */
agendaRouter.get("/respondieron", async (_req, res) => {
  try {
    const locationId = process.env.GHL_LOCATION_ID;
    if (!locationId) return res.status(500).json({ error: "Falta GHL_LOCATION_ID" });

    const closerContacts = await getContactsByTag(locationId, "zona_closer");
    const contactos: any[] = [];
    for (const c of closerContacts) {
      const outcome = CLOSER_OUTCOME_TAGS.find((t) => c.tags.includes(t));
      if (!outcome) continue; // (2) sin desenlace de Avanzar → no va al buzón

      const convId = await searchConversation(locationId, c.id);
      if (!convId) continue;
      const msgs = await getMessages(convId);
      const real = msgs.filter((m) => m.body && !(m.messageType ?? "").startsWith("TYPE_ACTIVITY"));
      if (!real.length) continue;

      const last = real[0]; // GHL devuelve más reciente primero
      if (last.direction !== "inbound") continue; // (3) el último es nuestro → ya respondido, fuera del buzón

      contactos.push({
        contactId: c.id,
        name: c.name,
        source: c.source,
        outcome: outcome === "no_show" ? "noshow" : outcome, // normalizamos el alias
        snippet: (last.body ?? "").slice(0, 80),
        when: relativeTime(last.dateAdded),
      });
    }
    res.json({ count: contactos.length, contactos });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});

/** GET /api/calendars — lista los calendarios de la subcuenta (para el futuro selector). */
agendaRouter.get("/calendars", async (_req, res) => {
  try {
    const locationId = process.env.GHL_LOCATION_ID;
    if (!locationId) return res.status(500).json({ error: "Falta GHL_LOCATION_ID" });
    const calendars = await listCalendars(locationId);
    res.json({ calendars });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? "Error inesperado" });
  }
});
