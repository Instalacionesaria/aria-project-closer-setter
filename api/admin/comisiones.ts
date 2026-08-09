/**
 * `GET/PUT /api/admin/comisiones` — el % de comisión por persona y tramo.
 *
 * ── Por qué existe ────────────────────────────────────────────────────
 *
 * El porcentaje vivía en `settingsStore` → `localStorage`, o sea **por navegador**. Dos admins de
 * la misma empresa podían ver números distintos del mismo closer y ninguno estaba equivocado:
 * cada uno leía su propio blob. Ese número multiplica plata cobrada.
 *
 * Y estaba indexado por **nombre** (`comisiones["Jorge Q."]`), lo que tiene una consecuencia que
 * no se nota hasta el día de pago: renombrar a un usuario le borra su comisión en silencio — la
 * fila del panel se arma desde `closer_usuarios`, así que aparece con el nombre nuevo y el campo
 * vacío, y nada falla. Con la FK a `usuario_id`, renombrar es renombrar.
 *
 * ── Los tres tramos ───────────────────────────────────────────────────
 *
 *   closer           · % sobre el cash collected
 *   setter_lt        · % directa, sobre el low-ticket que vende el setter
 *   setter_diferida  · % sobre el high-ticket que cierra el closer de un lead que el setter
 *                      originó (ver `closer_contactos.atribucion_setter_id`)
 *
 * Una persona puede tener los tres: los roles no son excluyentes y alguien puede ser closer y
 * setter a la vez.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auditar, exigir, type Contexto } from "../_lib/auth.js";
import { activar } from "../_lib/credenciales.js";
import { db } from "../_lib/repo.js";

const TRAMOS = ["closer", "setter_lt", "setter_diferida"] as const;
type Tramo = (typeof TRAMOS)[number];

const esTramo = (v: string): v is Tramo => (TRAMOS as readonly string[]).includes(v);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Mismo rol que el resto de la configuración de la empresa: un rol operativo no fija sueldos.
  const ctx = await exigir(req, res, ["admin"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  try {
    if (req.method === "GET") return await leer(res);
    if (req.method === "PUT") return await guardar(req, res, ctx);
    res.setHeader("Allow", "GET, PUT");
    return res.status(405).json({ ok: false, error: "Usá GET o PUT." });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

async function leer(res: VercelResponse) {
  const { data, error } = await db().from("closer_comisiones").select("usuario_id, tipo, pct");
  if (error) throw new Error(`closer_comisiones: ${error.message}`);

  /**
   * Se devuelve indexado por `usuario_id` y tramo. **No se rellenan los que faltan con cero**: un
   * 0% afirma que esa persona no cobra comisión, y eso es un hecho distinto de "todavía no lo
   * configuraron". La vista muestra el campo vacío con su placeholder.
   */
  const comisiones: Record<string, Partial<Record<Tramo, number>>> = {};
  for (const fila of (data ?? []) as { usuario_id: string; tipo: Tramo; pct: string | number }[]) {
    (comisiones[fila.usuario_id] ??= {})[fila.tipo] = Number(fila.pct);
  }

  return res.status(200).json({ ok: true, comisiones });
}

async function guardar(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const cuerpo = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) as {
    usuarioId?: string;
    tipo?: string;
    pct?: number | string | null;
  };

  const usuarioId = String(cuerpo?.usuarioId ?? "").trim();
  const tipo = String(cuerpo?.tipo ?? "").trim();

  if (!usuarioId) return res.status(400).json({ ok: false, codigo: "usuario_faltante", error: "Falta usuarioId." });
  if (!esTramo(tipo)) {
    return res.status(400).json({ ok: false, codigo: "tipo_invalido", error: `"${tipo}" no es un tramo.`, opciones: TRAMOS });
  }

  /**
   * `null` o vacío **borra la fila** en vez de guardar un cero, y la diferencia importa: dejar el
   * campo vacío significa "esta persona todavía no tiene comisión fijada", no "cobra 0%".
   */
  const crudo = cuerpo?.pct;
  if (crudo === null || crudo === undefined || crudo === "") {
    const { error } = await db()
      .from("closer_comisiones")
      .delete()
      .eq("usuario_id", usuarioId)
      .eq("tipo", tipo);
    if (error) throw new Error(`borrar comisión: ${error.message}`);
    await auditar("fijar_comision", {
      usuarioId: ctx.usuarioId,
      orgId: ctx.orgEfectiva,
      detalle: { accion: "comision_borrada", usuario: usuarioId, tipo },
    });
    return res.status(200).json({ ok: true, borrada: true });
  }

  const pct = Number(crudo);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    return res.status(400).json({
      ok: false,
      codigo: "pct_invalido",
      error: "El porcentaje va entre 0 y 100.",
    });
  }

  /**
   * `upsert` sobre la PK `(org_id, usuario_id, tipo)`. El `org_id` lo inyecta el Proxy de `db()`,
   * así que un admin no puede escribirle la comisión a alguien de otra empresa ni equivocándose.
   */
  const { error } = await db().from("closer_comisiones").upsert(
    {
      usuario_id: usuarioId,
      tipo,
      pct,
      actualizado_el: new Date().toISOString(),
      actualizado_por: ctx.usuarioId,
    },
    { onConflict: "org_id,usuario_id,tipo" },
  );
  if (error) throw new Error(`closer_comisiones: ${error.message}`);

  /**
   * Queda en auditoría: es un número que decide cuánto cobra una persona, así que quién lo cambió
   * y cuándo tiene que ser reconstruible.
   */
  await auditar("fijar_comision", {
    usuarioId: ctx.usuarioId,
    orgId: ctx.orgEfectiva,
    detalle: { accion: "comision_fijada", usuario: usuarioId, tipo, pct },
  });

  return res.status(200).json({ ok: true, pct });
}
