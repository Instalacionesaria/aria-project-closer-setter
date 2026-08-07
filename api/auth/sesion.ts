/**
 * `GET    /api/auth/sesion` — quién soy, qué roles tengo, qué empresa estoy mirando.
 * `DELETE /api/auth/sesion` — salir.
 * `POST   /api/auth/sesion` — cambiar la contraseña.
 *
 * Los tres en un archivo porque son el mismo recurso —la sesión— y porque cada archivo de
 * `api/` es una función serverless más: agrupar lo que se despliega junto tiene un costo
 * concreto en arranques en frío.
 *
 * ── Este es el endpoint que arma el sidebar ───────────────────────────
 *
 * El frontend no decide qué módulos existen: los pide acá. Es cosmética igual —la protección
 * real es el 403 del backend (§3.2)— pero evita mostrarle a alguien una pestaña que le va a
 * rebotar.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auditar, contextoDe, exigir } from "../_lib/auth.js";
import { dbSinScope } from "../_lib/db.js";
import { hashearPassword, motivoPasswordInvalida, verificarPassword } from "../_lib/password.js";
import { borrarCookie, cerrarSesion, cerrarSesionesDe, crearSesion, ponerCookie } from "../_lib/sesion.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "GET") return quienSoy(req, res);
  if (req.method === "DELETE") return salir(req, res);
  if (req.method === "POST") return cambiarPassword(req, res);
  res.setHeader("Allow", "GET, DELETE, POST");
  return res.status(405).json({ ok: false, error: "Usá GET, DELETE o POST." });
}

/* ─────────────────────────── Quién soy ─────────────────────────── */

async function quienSoy(req: VercelRequest, res: VercelResponse) {
  const ctx = await contextoDe(req, res);

  // 200 con `autenticado: false` y no 401: para el frontend "no hay sesión" es un estado
  // normal —la pantalla de login— y no un error que haya que mostrar en rojo.
  if (!ctx) return res.status(200).json({ ok: true, autenticado: false });

  const { data: empresa } = await dbSinScope()
    .from("closer_org_config")
    .select("org_id, nombre, slug, es_principal, activa")
    .eq("org_id", ctx.orgEfectiva)
    .maybeSingle();

  return res.status(200).json({
    ok: true,
    autenticado: true,
    usuario: {
      id: ctx.usuarioId,
      nombre: ctx.nombre,
      email: ctx.email,
      roles: ctx.roles,
      esSuperAdmin: ctx.esSuperAdmin,
      debeCambiarPassword: ctx.debeCambiarPassword,
    },
    empresa: empresa
      ? { id: empresa.org_id, nombre: empresa.nombre, slug: empresa.slug, esPrincipal: empresa.es_principal }
      : null,
    /**
     * `true` cuando el super admin está mirando una empresa que no es la suya. La UI muestra
     * un banner permanente con esto (§7.1): que nadie confunda de qué empresa son los datos
     * que tiene delante.
     */
    mirandoOtraEmpresa: ctx.orgEfectiva !== ctx.orgPropia,
  });
}

/* ─────────────────────────── Salir ─────────────────────────── */

async function salir(req: VercelRequest, res: VercelResponse) {
  const ctx = await contextoDe(req, res);

  if (ctx) {
    await cerrarSesion(ctx.sesionId);
    await auditar("logout", { usuarioId: ctx.usuarioId, orgId: ctx.orgEfectiva, ip: ctx.ip });
  }

  // La cookie se borra SIEMPRE, aunque no hubiera sesión válida: si el navegador tiene una
  // cookie vencida o de una sesión ya borrada, esta es la forma de que deje de mandarla.
  borrarCookie(res);
  return res.status(200).json({ ok: true });
}

/* ─────────────────────── Cambiar la contraseña ─────────────────────── */

async function cambiarPassword(req: VercelRequest, res: VercelResponse) {
  // `"cualquiera"`: este es el único endpoint que tiene que funcionar con la contraseña
  // temporal sin cambiar. Si exigiera un rol, el usuario quedaría encerrado sin poder salir.
  const ctx = await exigir(req, res, "cualquiera");
  if (!ctx) return;

  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  const actual = String(cuerpo?.actual ?? "");
  const nueva = String(cuerpo?.nueva ?? "");

  const motivo = motivoPasswordInvalida(nueva);
  if (motivo) return res.status(400).json({ ok: false, codigo: "password_debil", error: motivo });

  const { data: usuario } = await dbSinScope()
    .from("closer_usuarios")
    .select("id, org_id, password_hash")
    .eq("id", ctx.usuarioId)
    .maybeSingle();

  if (!usuario) return res.status(401).json({ ok: false, error: "Sesión inválida." });

  // Se pide la actual aunque haya sesión: sin esto, una sesión robada permite cambiar la
  // contraseña y quedarse con la cuenta para siempre.
  if (!(await verificarPassword(actual, usuario.password_hash as string | null))) {
    await auditar("cambio_password", {
      usuarioId: ctx.usuarioId,
      orgId: ctx.orgEfectiva,
      ip: ctx.ip,
      detalle: { resultado: "actual_incorrecta" },
    });
    return res.status(401).json({ ok: false, codigo: "actual_incorrecta", error: "La contraseña actual no es correcta." });
  }

  if (await verificarPassword(nueva, usuario.password_hash as string | null)) {
    return res.status(400).json({ ok: false, codigo: "password_repetida", error: "La contraseña nueva tiene que ser distinta." });
  }

  const { error } = await dbSinScope()
    .from("closer_usuarios")
    .update({ password_hash: await hashearPassword(nueva), debe_cambiar_password: false })
    .eq("id", ctx.usuarioId);

  if (error) return res.status(500).json({ ok: false, error: `No se pudo guardar: ${error.message}` });

  /**
   * Cambiar la contraseña **cierra todas las sesiones**, incluida esta. Es el motivo por el
   * que uno la cambia cuando cree que se la robaron: si las demás sobrevivieran, el cambio no
   * serviría de nada. Se abre una sesión nueva acto seguido para no echar a quien la cambió.
   */
  await cerrarSesionesDe(ctx.usuarioId);
  const { token, expiraEl } = await crearSesion(ctx.usuarioId, {
    ip: ctx.ip,
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
  });
  ponerCookie(res, token, expiraEl);

  await auditar("cambio_password", {
    usuarioId: ctx.usuarioId,
    orgId: ctx.orgEfectiva,
    ip: ctx.ip,
    detalle: { resultado: "ok", sesiones_cerradas: true },
  });

  return res.status(200).json({ ok: true, sesionesCerradas: true });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
