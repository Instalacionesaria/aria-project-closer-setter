import cron from "node-cron";
import { listRecentConversations, getMessages, addContactTags, addContactNote } from "./ghl";
import { evaluateConversation } from "./evaluator";

export interface AnalysisSummary {
  fecha: string;
  windowHours: number;
  analizadas: number;
  fallos: number;
  tagsAplicados: number;
  detalle: Array<{ name: string | undefined; contactId: string | undefined; criterio: string; motivo: string }>;
}

/**
 * Corre el análisis: toma las conversaciones con actividad en las últimas `windowHours`,
 * las evalúa con Claude, y (si apply) marca las que fallaron con `bot_pausado_fallo`.
 * Incremental por diseño: solo lo nuevo/reciente, no las ~856 de todo el mes cada vez.
 */
export async function runAnalysis(opts: { windowHours?: number; max?: number; apply?: boolean } = {}): Promise<AnalysisSummary> {
  const windowHours = opts.windowHours ?? Number(process.env.ANALYSIS_WINDOW_HOURS ?? 26);
  const max = opts.max ?? Number(process.env.ANALYSIS_MAX ?? 50);
  const apply = opts.apply ?? true;
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) throw new Error("Falta GHL_LOCATION_ID");

  const sinceMs = Date.now() - windowHours * 3600 * 1000;
  const convs = (await listRecentConversations(locationId, sinceMs, 100)).slice(0, max);

  let analizadas = 0;
  let fallos = 0;
  let tagsAplicados = 0;
  const detalle: AnalysisSummary["detalle"] = [];

  for (const c of convs) {
    try {
      const msgs = await getMessages(c.id);
      const v = await evaluateConversation(msgs);
      analizadas++;
      if (v.fallo) {
        fallos++;
        detalle.push({ name: c.fullName, contactId: c.contactId, criterio: v.criterio, motivo: v.motivo });
        if (apply && c.contactId) {
          try {
            await addContactTags(c.contactId, ["bot_pausado_fallo"]);
            // Guardamos el motivo en una nota para que "Intervenciones Urgentes" muestre el porqué real.
            await addContactNote(c.contactId, `[IA] ${v.motivo}`);
            tagsAplicados++;
          } catch {
            /* si el tag/nota de uno falla, sigue */
          }
        }
      }
    } catch {
      /* si una conversación falla al evaluar, sigue con las demás */
    }
  }

  const summary: AnalysisSummary = {
    fecha: new Date().toISOString(),
    windowHours,
    analizadas,
    fallos,
    tagsAplicados,
    detalle,
  };
  console.log(`[analisis] ${summary.fecha} · analizadas:${analizadas} · fallos:${fallos} · tags:${tagsAplicados} (ventana ${windowHours}h, apply:${apply})`);
  return summary;
}

/** Programa el análisis automático diario (node-cron). Se llama una vez al arrancar el servidor. */
export function startScheduler(): void {
  if (process.env.ANALYSIS_ENABLED === "false") {
    console.log("[analisis] scheduler DESHABILITADO (ANALYSIS_ENABLED=false)");
    return;
  }
  const schedule = process.env.ANALYSIS_CRON || "0 7 * * *"; // 7:00 AM por defecto
  const timezone = process.env.GHL_TZ || "America/Bogota";
  if (!cron.validate(schedule)) {
    console.error(`[analisis] cron inválido: "${schedule}" — scheduler no arrancó`);
    return;
  }
  cron.schedule(
    schedule,
    () => {
      runAnalysis({ apply: true }).catch((e) => console.error("[analisis] error en corrida programada:", e?.message));
    },
    { timezone },
  );
  console.log(`[analisis] programado "${schedule}" (${timezone}) — corre solo, 1 vez al día`);
}
