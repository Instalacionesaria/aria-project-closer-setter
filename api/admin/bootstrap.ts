/**
 * `POST /api/admin/bootstrap` — crea el super admin, una sola vez (ESPEC-MULTIEMPRESA §4.5).
 *
 * ── Por qué no está en una migración ──────────────────────────────────
 *
 * Porque las migraciones viven en el repositorio, y la contraseña inicial no puede estar ahí.
 * El criterio de aceptación lo dice explícito: *"Esa contraseña no aparece en el repositorio,
 * en ninguna migración ni archivo"*.
 *
 * Así que la migración crea la empresa y nada más; el usuario lo crea este endpoint leyendo
 * `ADMIN_PRINCIPAL_EMAIL` y `ADMIN_PRINCIPAL_PASSWORD` de las variables de entorno de Vercel,
 * que no están en git.
 *
 * ── Se desactiva solo ─────────────────────────────────────────────────
 *
 * Si ya existe un usuario con `es_admin_principal`, responde 409 y no hace nada. No hay forma
 * de usarlo para pisar la cuenta del dueño ni para crear un segundo super admin: el índice
 * único de la 023 lo impediría igual a nivel base.
 *
 * ── Y aun así pide un token ───────────────────────────────────────────
 *
 * `BOOTSTRAP_TOKEN`. Sin él, cualquiera que conozca la URL podría dispararlo antes que el
 * dueño y quedarse con la cuenta —las variables de entorno ya estarían puestas—. Es la única
 * ventana en la que este endpoint es peligroso, y dura hasta que se usa una vez.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auditar } from "../_lib/auth.js";
import { dbSinScope } from "../_lib/db.js";
import { hashearPassword, motivoPasswordInvalida } from "../_lib/password.js";
import { ipDe } from "../_lib/sesion.js";

/**
 * §4.4: el forzado de cambio es una constante única en el código. Para el admin principal
 * queda en `false` **por decisión explícita** de la especificación: su contraseña se mantiene
 * fija. Si mañana se quiere que la cambie al entrar, es cambiar este valor y nada más.
 */
const FORZAR_CAMBIO_PASSWORD_TEMPORAL = false;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Usá POST." });
  }

  const tokenEsperado = process.env.BOOTSTRAP_TOKEN;
  if (!tokenEsperado) {
    console.error("[bootstrap] BOOTSTRAP_TOKEN sin configurar: se rechaza todo.");
    return res.status(503).json({ ok: false, error: "BOOTSTRAP_TOKEN sin configurar en el servidor." });
  }
  const recibido = String(req.headers["x-bootstrap-token"] ?? req.query.token ?? "");
  if (recibido !== tokenEsperado) {
    return res.status(401).json({ ok: false, error: "Token inválido." });
  }

  const email = String(process.env.ADMIN_PRINCIPAL_EMAIL ?? "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PRINCIPAL_PASSWORD ?? "");
  if (!email || !password) {
    return res.status(503).json({
      ok: false,
      error: "Faltan ADMIN_PRINCIPAL_EMAIL y/o ADMIN_PRINCIPAL_PASSWORD en el servidor.",
    });
  }
  const motivo = motivoPasswordInvalida(password);
  if (motivo) return res.status(400).json({ ok: false, codigo: "password_debil", error: motivo });

  /* ── Se desactiva solo ── */
  const { data: yaExiste } = await dbSinScope()
    .from("closer_usuarios")
    .select("id, email")
    .eq("es_admin_principal", true)
    .maybeSingle();

  if (yaExiste) {
    return res.status(409).json({
      ok: false,
      codigo: "ya_existe",
      error: "El admin principal ya existe. Este endpoint no hace nada una segunda vez.",
    });
  }

  /* ── La empresa principal tiene que existir (la crea la 018) ── */
  const { data: principal } = await dbSinScope()
    .from("closer_org_config")
    .select("org_id, nombre")
    .eq("es_principal", true)
    .maybeSingle();

  if (!principal) {
    return res.status(500).json({
      ok: false,
      error: "No hay empresa principal. Falta correr docs/db/018_multiempresa_org.sql.",
    });
  }

  /**
   * Si ya hay una fila con ese email —por ejemplo un registro de atribución al que alguien le
   * puso el correo— se PROMUEVE en vez de insertar otra. Insertar chocaría contra el índice
   * único y dejaría el bootstrap trabado sin explicar por qué.
   */
  const { data: porEmail } = await dbSinScope()
    .from("closer_usuarios")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  const fila = {
    org_id: principal.org_id as string,
    email,
    password_hash: await hashearPassword(password),
    nombre: "Administrador ARIA",
    roles: ["super_admin", "admin"],
    activo: true,
    es_admin_principal: true,
    debe_cambiar_password: FORZAR_CAMBIO_PASSWORD_TEMPORAL,
  };

  const { data: creado, error } = porEmail
    ? await dbSinScope().from("closer_usuarios").update(fila).eq("id", porEmail.id as string).select("id, email").single()
    : await dbSinScope().from("closer_usuarios").insert(fila).select("id, email").single();

  if (error) return res.status(500).json({ ok: false, error: `No se pudo crear: ${error.message}` });

  await auditar("bootstrap", {
    usuarioId: creado.id as string,
    orgId: principal.org_id as string,
    ip: ipDe(req),
    // El email sí, la contraseña NUNCA (§4.1).
    detalle: { email: creado.email, promovido: Boolean(porEmail) },
  });

  return res.status(201).json({
    ok: true,
    creado: true,
    usuario: { id: creado.id, email: creado.email },
    empresa: { id: principal.org_id, nombre: principal.nombre },
    aviso: "Guardá el BOOTSTRAP_TOKEN o borralo de Vercel: este endpoint ya no hace nada.",
  });
}
