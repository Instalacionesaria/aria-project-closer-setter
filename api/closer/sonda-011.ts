/**
 * Sonda temporal (borrar tras diagnosticar): ¿qué ve PRODUCCIÓN de la migración 011?
 *
 * El síntoma que investiga: `reconciliar` falla con "column closer_org_config.
 * ultima_reconciliacion does not exist", pero la columna existe y el REST directo desde la
 * máquina de desarrollo la lee sin problema. Misma URL, misma base (los conteos de filas
 * coinciden). Esto aísla: host efectivo, SELECT de la columna, y el UPDATE del candado —
 * cada uno reportando su error crudo.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "../_lib/env.js";
import { db } from "../_lib/repo.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const host = new URL(env.supabaseUrl()).host;

  const sel = await db()
    .from("closer_org_config")
    .select("org_id, ultima_reconciliacion, reconciliacion_marca_agua")
    .maybeSingle();

  const corte = new Date(Date.now() - 10_000).toISOString();
  const upd = await db()
    .from("closer_org_config")
    .update({ ultima_reconciliacion: new Date().toISOString() })
    .eq("org_id", "00000000-0000-0000-0000-000000000001")
    .or(`ultima_reconciliacion.is.null,ultima_reconciliacion.lt.${corte}`)
    .select("org_id");

  const mensajes = await db().from("closer_mensajes").select("id").limit(1);

  return res.status(200).json({
    host,
    select: { data: sel.data, error: sel.error?.message ?? null },
    update: { data: upd.data, error: upd.error?.message ?? null, code: upd.error?.code ?? null },
    mensajes: { ok: !mensajes.error, error: mensajes.error?.message ?? null },
  });
}
