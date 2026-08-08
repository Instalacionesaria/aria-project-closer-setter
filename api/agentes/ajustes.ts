/**
 * `GET/POST /api/agentes/ajustes` — el Historial de Ajustes, que hasta hoy era memoria pura.
 *
 * `GET`  → las correcciones ya aplicadas, opcionalmente filtradas por agente.
 * `POST` → "Marcar grupo resuelto": registra la corrección y cierra los casos.
 *
 * ## Qué manda el cliente y qué NO
 *
 * El cliente manda `{agenteId, errorCode, casosIds}` y nada más. El título, el diagnóstico,
 * la corrección y el autor los pone el SERVIDOR, que ya los tiene porque los produjo él.
 * Dejar que el browser los mandara permitiría que una pestaña vieja escriba texto viejo en
 * un registro que es permanente.
 *
 * Y se mandan los ids de los casos **que el técnico tenía en pantalla**, no "todos los de
 * este errorCode": entre que abrió el drawer y apretó el botón pudo entrar un caso nuevo, y
 * cerrarlo sin haberlo visto es justo lo que el botón promete no hacer ("cierra los ×N
 * casos" — los N que dice la pantalla).
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import type { AgenteTextoId } from "../_lib/analizador.js";
import { db } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

const AGENTES_VALIDOS: readonly string[] = ["lead-flow-ai", "appointment-flow-ai"];

interface FilaAjuste {
  id: string;
  agente_id: AgenteTextoId;
  error_code: string;
  titulo: string;
  categoria: string;
  casos_cerrados: number;
  diagnostico: string | null;
  fragmento_prompt: string | null;
  correccion: string | null;
  prompt_hash: string | null;
  autor: string;
  aplicado_el: string;
}

const aAjuste = (f: FilaAjuste) => ({
  id: f.id,
  agenteId: f.agente_id,
  errorCode: f.error_code,
  titulo: f.titulo,
  categoria: f.categoria,
  casosCerrados: f.casos_cerrados,
  diagnostico: f.diagnostico,
  fragmentoPrompt: f.fragmento_prompt,
  correccion: f.correccion,
  promptHash: f.prompt_hash,
  autor: f.autor,
  /** ISO real de la base. Nunca el literal "Hoy" que escribía el store en memoria. */
  aplicadoEl: f.aplicado_el,
});

const COLUMNAS =
  "id, agente_id, error_code, titulo, categoria, casos_cerrados, diagnostico, " +
  "fragmento_prompt, correccion, prompt_hash, autor, aplicado_el";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["tecnico"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  try {
    if (req.method === "GET") return await listar(req, res);
    if (req.method === "POST") return await registrar(req, res, ctx.nombre);
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Solo GET o POST." });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

async function listar(req: VercelRequest, res: VercelResponse) {
  const agenteId = typeof req.query.agenteId === "string" ? req.query.agenteId : null;

  let q = db()
    .from("closer_ajustes_agente")
    .select(COLUMNAS)
    .order("aplicado_el", { ascending: false })
    .limit(200);
  if (agenteId) q = q.eq("agente_id", agenteId);

  const { data, error } = await q;
  if (error) throw new Error(`closer_ajustes_agente: ${error.message}`);

  const ajustes = ((data ?? []) as unknown as FilaAjuste[]).map(aAjuste);
  return res.status(200).json({ ok: true, count: ajustes.length, ajustes });
}

async function registrar(req: VercelRequest, res: VercelResponse, autor: string) {
  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) ?? {};
  const { agenteId, errorCode, casosIds } = cuerpo as Record<string, unknown>;

  if (typeof agenteId !== "string" || !AGENTES_VALIDOS.includes(agenteId)) {
    return res.status(400).json({ ok: false, error: "agenteId inválido." });
  }
  if (typeof errorCode !== "string" || !errorCode) {
    return res.status(400).json({ ok: false, error: "Falta errorCode." });
  }
  if (!Array.isArray(casosIds) || casosIds.length === 0) {
    return res.status(400).json({ ok: false, error: "Falta la lista de casos a cerrar." });
  }

  const ids = casosIds.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (ids.length === 0) return res.status(400).json({ ok: false, error: "Ningún id de caso válido." });

  /**
   * El texto del ajuste sale del hallazgo MÁS RECIENTE del grupo, no de uno cualquiera: es
   * el que refleja el estado actual del patrón, y es el mismo criterio que usa
   * `/api/agentes/alertas` para elegir qué mostrar. Que los dos coincidan importa: lo que se
   * archiva tiene que ser lo que el técnico vio en pantalla.
   */
  const { data: fuente, error: errFuente } = await db()
    .from("closer_hallazgo_agente")
    .select("titulo, categoria, diagnostico, fragmento_prompt, correccion, prompt_hash")
    .eq("agente_id", agenteId)
    .eq("error_code", errorCode)
    .order("detectado_el", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errFuente) throw new Error(`closer_hallazgo_agente: ${errFuente.message}`);
  if (!fuente) return res.status(404).json({ ok: false, error: "No hay ningún hallazgo con ese patrón." });

  // Se cierran PRIMERO los casos: si esto falla, no queda una fila de historial afirmando
  // que se cerró algo que sigue abierto.
  const { data: cerrados, error: errCerrar } = await db()
    .from("closer_hallazgo_agente")
    .update({
      estado: "parcheado",
      resuelto_el: new Date().toISOString(),
      resuelto_por: autor,
    })
    .eq("agente_id", agenteId)
    .eq("error_code", errorCode)
    .in("id", ids)
    .neq("estado", "parcheado")
    .select("id");
  if (errCerrar) throw new Error(`cerrar hallazgos: ${errCerrar.message}`);

  const casosCerrados = cerrados?.length ?? 0;

  const { data: fila, error: errInsert } = await db()
    .from("closer_ajustes_agente")
    .insert({
      agente_id: agenteId,
      error_code: errorCode,
      titulo: (fuente as { titulo: string }).titulo,
      categoria: (fuente as { categoria: string }).categoria,
      casos_cerrados: casosCerrados,
      diagnostico: (fuente as { diagnostico: string | null }).diagnostico,
      fragmento_prompt: (fuente as { fragmento_prompt: string | null }).fragmento_prompt,
      correccion: (fuente as { correccion: string | null }).correccion,
      prompt_hash: (fuente as { prompt_hash: string | null }).prompt_hash,
      /**
       * Lo firma quien tiene la sesión, que acá es siempre un `tecnico` — el endpoint lo exige.
       *
       * Hasta el 2026-08-07 esto era `AUTOR_POR_DEFECTO`, o sea `"Jorge Q."`, que es el CLOSER; el
       * comentario de entonces lo admitía: *"es un dato falso, solo que menos visible que un cero
       * inventado"*. Quien aplica un ajuste al prompt es el técnico, y ahora queda su nombre.
       */
      autor,
    })
    .select(COLUMNAS)
    .single();
  if (errInsert) throw new Error(`closer_ajustes_agente: ${errInsert.message}`);

  // Se devuelve la fila YA escrita, con su id y su fecha REALES: la vista la agrega tal cual
  // en vez de fabricar una optimista que podría no coincidir con lo que quedó guardado.
  return res.status(200).json({
    ok: true,
    ajuste: aAjuste(fila as unknown as FilaAjuste),
    casosCerrados,
  });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
