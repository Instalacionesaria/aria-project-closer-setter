/**
 * `GET /api/voz-respaldo` — la red del auditor de voz, programada (cada 2 h).
 *
 * ── El agujero que cierra, medido ─────────────────────────────────────
 *
 * Al 2026-08-16, de **17 llamadas contestadas con transcripción, solo 13 tenían análisis**. Tres de
 * las cuatro faltantes son posteriores al encendido del auditor (2026-08-10) y tienen todo lo que
 * hace falta —turnos, transcripción y `ghl_contact_id`—, así que deberían haberse auditado:
 *
 *     2026-08-13 14:46 ·  76 s · agent_hangup
 *     2026-08-13 22:23 ·  26 s · user_hangup
 *     2026-08-15 13:11 · 127 s · user_hangup
 *
 * ── Por qué se perdieron, y por qué el arreglo es un cron ─────────────
 *
 * `analizarLlamada()` tenía **un solo llamador**: `api/webhooks/llamada.ts`. La inferencia corre
 * ahí adentro, síncrona, dentro de un presupuesto de 60 s (`vercel.json`) — y una llamada larga
 * con `effort: high` y 16.000 tokens de techo puede tardar más que eso. Cuando Vercel corta la
 * función, el análisis muere **sin dejar rastro**: no hay fila, no hay error persistido, y el
 * único lugar donde se habría dicho algo es el cuerpo de una respuesta HTTP que Assistable
 * descarta. La de 127 s —la más larga, la que más tokens produce— es exactamente la que uno
 * esperaría que se caiga primero.
 *
 * Y Assistable **no reintenta indefinidamente**: si el reintento no llega, esa llamada no se
 * audita nunca. Sin este cron, "el auditor de voz falló" y "la llamada no era auditable" se ven
 * igual desde la pantalla — que es la confusión que la regla 2 existe para impedir.
 *
 * Subir `maxDuration` no alcanza: mueve el techo, no crea el reintento. El problema no es que 60 s
 * sean pocos, es que **no había segunda oportunidad**. Se subió igual a 300 s —el mismo techo que
 * los otros barridos— porque cortar una inferencia a mitad tira lo ya pagado; pero el que cierra
 * el agujero es este cron. Mismo razonamiento que `territorio-respaldo`: el webhook tapa el caso
 * frecuente, el cron cierra el conjunto.
 *
 * ── El tope, que acá cuesta plata de verdad ───────────────────────────
 *
 * Cada llamada de este barrido es **una inferencia paga**, al revés del barrido de territorio,
 * donde el costo son llamadas a la API de GHL. Por eso el tope es chico y por empresa: 5 por
 * corrida, 12 corridas diarias, o sea un techo de 60 análisis diarios por empresa aunque entren
 * mil llamadas. Con el volumen real (66 llamadas en 10 días) recupera el atraso en una corrida.
 *
 * Si quedaron más de `TOPE`, la respuesta lo dice con `pendientes`. Un barrido que se guarda para
 * sí que dejó cosas afuera se lee como "ya está todo auditado", y es el mismo silencio que este
 * archivo vino a cerrar.
 *
 * ── Mismo patrón que los otros cuatro crons ───────────────────────────
 *
 * Falla cerrado sin `CRON_SECRET`, un `try` por empresa, `conCredenciales` y no `activar` (el
 * contexto se cierra entre iteraciones), y 207 si alguna falló.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  conCredenciales,
  organizacionesActivas,
  resolverCredenciales,
} from "./_lib/credenciales.js";
import { analizarLlamada } from "./_lib/analizadorVoz.js";
import { DIAS_VENTANA_AUDITOR } from "./_lib/analizador.js";
import { db } from "./_lib/repo.js";
import type { FilaLlamada } from "../src/lib/assistable.js";

/**
 * Inferencias por empresa y por corrida. Bajo a propósito: cada una se paga. Ver la cabecera.
 */
const TOPE = 5;

/** Cuántas se pueden mirar hacia atrás. La misma ventana que audita el resto del sistema. */
const DIAS = DIAS_VENTANA_AUDITOR;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Falla CERRADO. Sin la variable no corre: mejor un cron caído y visible que uno abierto.
  const secreto = process.env.CRON_SECRET;
  if (!secreto) {
    console.error(
      "[voz-respaldo] CRON_SECRET sin configurar: se rechaza todo hasta que exista.",
    );
    return res
      .status(503)
      .json({ ok: false, error: "CRON_SECRET sin configurar en el servidor." });
  }
  if (req.headers.authorization !== `Bearer ${secreto}`) {
    return res
      .status(401)
      .json({ ok: false, error: "Solo el cron de Vercel." });
  }

  let organizaciones: string[];
  try {
    organizaciones = await organizacionesActivas();
  } catch (e) {
    console.error(`[voz-respaldo] ${(e as Error).message}`);
    return res.status(503).json({ ok: false, error: (e as Error).message });
  }

  const porEmpresa: Record<string, unknown> = {};
  let fallaron = 0;

  for (const orgId of organizaciones) {
    try {
      const cred = await resolverCredenciales(orgId);
      porEmpresa[cred.nombre] = await conCredenciales(cred, () =>
        barrerEmpresa(),
      );
    } catch (e) {
      fallaron++;
      porEmpresa[orgId] = { corrio: false, error: (e as Error).message };
      console.error(`[voz-respaldo] empresa ${orgId}: ${(e as Error).message}`);
    }
  }

  const estado = fallaron === 0 ? 200 : 207;
  return res.status(estado).json({
    ok: fallaron === 0,
    corrio: true,
    tope: TOPE,
    dias: DIAS,
    empresas: organizaciones.length,
    fallaron,
    porEmpresa,
  });
}

/**
 * Las llamadas auditables de ESTA empresa que no tienen análisis, hasta el tope.
 *
 * El filtro replica los portones baratos de `analizarLlamada()` —contestada y con algo que leer—
 * para no traer filas que el auditor va a descartar igual. Los portones caros (origen mapeado,
 * dedupe) los sigue haciendo él: duplicar esa lógica acá sería la regla 3 al revés.
 */
async function barrerEmpresa() {
  const desde = new Date(Date.now() - DIAS * 86_400_000).toISOString();

  const { data: candidatas, error } = await db()
    .from("closer_llamadas")
    .select("*")
    .eq("contestada", true)
    .not("ghl_contact_id", "is", null)
    .gte("inicio_el", desde)
    .order("inicio_el", { ascending: false });

  if (error) throw new Error(`closer_llamadas: ${error.message}`);
  const filas = (candidatas ?? []) as FilaLlamada[];
  if (filas.length === 0)
    return { corrio: true, candidatas: 0, analizadas: 0, pendientes: 0 };

  /**
   * Qué llamadas YA tienen análisis. Una sola consulta con todos los `call_id` en vez de una por
   * fila: con 66 llamadas la diferencia es de 66 round trips a 1.
   *
   * No se filtra por `agente_id`: si existe cualquier análisis de esa llamada, `analizarLlamada`
   * lo va a cortar con su propia dedupe. Acá solo se evita traerla.
   */
  const ids = filas.map((f) => f.call_id);
  const { data: yaAnalizadas, error: eAn } = await db()
    .from("closer_analisis_agente")
    .select("conversation_id")
    .in("conversation_id", ids);

  if (eAn) throw new Error(`closer_analisis_agente: ${eAn.message}`);
  const conAnalisis = new Set(
    (yaAnalizadas ?? []).map((a) => a.conversation_id as string),
  );

  // Sin transcripción no hay qué leer: el auditor lo descartaría, y traerlo solo infla el conteo.
  const sinAnalizar = filas.filter(
    (f) =>
      !conAnalisis.has(f.call_id) &&
      (f.turnos !== null || f.transcripcion !== null),
  );

  const lote = sinAnalizar.slice(0, TOPE);
  const resultados: { callId: string; analizado: boolean; motivo?: string }[] =
    [];

  for (const fila of lote) {
    // `analizarLlamada` nunca lanza: devuelve `analizado: false` con su motivo.
    const r = await analizarLlamada(fila);
    resultados.push({
      callId: fila.call_id,
      analizado: r.analizado,
      ...(r.motivo ? { motivo: r.motivo } : {}),
    });
  }

  return {
    corrio: true,
    candidatas: filas.length,
    sinAnalisis: sinAnalizar.length,
    analizadas: resultados.filter((r) => r.analizado).length,
    /** Las que quedaron para la próxima corrida. Se dice: ver la cabecera. */
    pendientes: Math.max(0, sinAnalizar.length - lote.length),
    resultados,
  };
}
