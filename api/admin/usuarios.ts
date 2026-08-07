/**
 * `GET/POST/PATCH/DELETE /api/admin/usuarios` — el panel de usuarios (ESPEC §7.2).
 *
 * ── Las tres reglas que hacen todo el trabajo ─────────────────────────
 *
 * 1. **Un `admin` solo ve y toca los usuarios de SU empresa.** No por filtrar la lista en el
 *    frontend: cada operación resuelve la empresa objetivo y la compara contra la suya antes
 *    de tocar la base.
 * 2. **Un `admin` no puede crear ni otorgar `super_admin`.** Ni siquiera dentro de ARIA. Es la
 *    escalada de privilegios más obvia y la más fácil de dejar abierta.
 * 3. **El admin principal es intocable.** Lo garantizan triggers de la 023; acá solo se
 *    traduce el error para que se lea bien.
 *
 * ── La contraseña temporal se muestra UNA vez ─────────────────────────
 *
 * Se devuelve en la respuesta de creación y de regeneración, y **no se guarda en ningún lado
 * en claro** — en la base va su hash. Si quien la creó cierra la pantalla sin copiarla, hay
 * que regenerarla. Es incómodo a propósito: la alternativa es poder recuperarla después, y
 * eso significa tenerla guardada.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { activar } from "../_lib/credenciales.js";
import { auditar, exigir, type Contexto, type Rol } from "../_lib/auth.js";
import { dbSinScope } from "../_lib/db.js";
import { generarPasswordTemporal, hashearPassword } from "../_lib/password.js";
import { cerrarSesionesDe } from "../_lib/sesion.js";

const ROLES_VALIDOS: Rol[] = ["super_admin", "admin", "closer", "setter", "tecnico", "media_buyer"];
/** Los que un `admin` común puede otorgar. `super_admin` y `admin` quedan fuera a propósito. */
const ROLES_OPERATIVOS: Rol[] = ["closer", "setter", "tecnico", "media_buyer"];
const MAX_ROLES = 4;

const COLUMNAS =
  "id, org_id, nombre, email, roles, activo, es_admin_principal, debe_cambiar_password, " +
  "bloqueado_hasta, ultimo_acceso_el, creado_el";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await exigir(req, res, ["admin"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  if (req.method === "GET") return listar(res, ctx);
  // Una sola función serverless para todo el recurso: cada archivo de `api/` es una función
  // más que Vercel arranca en frío por separado.
  if (req.method === "POST" && req.query.accion === "regenerar-password") return regenerar(req, res, ctx);
  if (req.method === "POST") return crear(req, res, ctx);
  if (req.method === "PATCH") return editar(req, res, ctx);
  if (req.method === "DELETE") return eliminar(req, res, ctx);
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ ok: false, error: "Usá GET, POST, PATCH o DELETE." });
}

/* ─────────────────────────────── Listar ─────────────────────────────── */

async function listar(res: VercelResponse, ctx: Contexto) {
  let q = dbSinScope().from("closer_usuarios").select(COLUMNAS).order("creado_el", { ascending: true });

  // El super admin ve todas; el admin, solo la suya. El filtro va en la CONSULTA, no en el
  // mapeo: si estuviera después, los datos de las otras empresas ya habrían salido de la base.
  if (!ctx.esSuperAdmin) q = q.eq("org_id", ctx.orgPropia);

  const { data, error } = await q;
  if (error) return res.status(500).json({ ok: false, error: error.message });

  const filas = (data ?? []) as unknown as Record<string, unknown>[];

  return res.status(200).json({
    ok: true,
    count: filas.length,
    usuarios: filas.map((u) => ({
      id: u.id,
      orgId: u.org_id,
      nombre: u.nombre,
      email: u.email,
      roles: u.roles ?? [],
      activo: u.activo,
      // La UI lo marca y le esconde las acciones destructivas (§7.2). El backend igual lo
      // protege con triggers: esto es para que no aparezca un botón que va a fallar.
      esAdminPrincipal: u.es_admin_principal,
      debeCambiarPassword: u.debe_cambiar_password,
      bloqueado: Boolean(u.bloqueado_hasta && new Date(u.bloqueado_hasta as string) > new Date()),
      ultimoAcceso: u.ultimo_acceso_el ?? null,
      creadoEl: u.creado_el,
    })),
    /** Qué roles puede otorgar QUIEN PREGUNTA. La UI arma el selector con esto. */
    rolesQuePuedeOtorgar: ctx.esSuperAdmin ? ROLES_VALIDOS : ROLES_OPERATIVOS,
  });
}

/* ─────────────────────────────── Crear ─────────────────────────────── */

async function crear(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const cuerpo = leerCuerpo(req);
  const nombre = String(cuerpo?.nombre ?? "").trim();
  const email = String(cuerpo?.email ?? "").trim().toLowerCase();
  const roles = Array.isArray(cuerpo?.roles) ? (cuerpo.roles as string[]) : [];

  /**
   * La empresa destino: el super admin puede elegirla, un admin **siempre** crea en la suya.
   * Aunque mande otra en el cuerpo, se ignora — no se rechaza con un error que le enseñe que
   * el campo existe.
   */
  const orgDestino = ctx.esSuperAdmin ? String(cuerpo?.orgId ?? ctx.orgEfectiva) : ctx.orgPropia;

  if (!nombre) return res.status(400).json({ ok: false, error: "Falta el nombre." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, codigo: "email_invalido", error: "Ese email no tiene forma de email." });
  }

  const problema = validarRoles(roles, ctx);
  if (problema) return res.status(problema.status).json({ ok: false, codigo: problema.codigo, error: problema.error });

  const temporal = generarPasswordTemporal();
  const { data, error } = await dbSinScope()
    .from("closer_usuarios")
    .insert({
      org_id: orgDestino,
      nombre,
      email,
      password_hash: await hashearPassword(temporal),
      roles,
      activo: true,
      // §4.4: entra obligado a definir una propia. `exigir()` lo bloquea de todo lo demás
      // hasta que lo haga.
      debe_cambiar_password: true,
      creado_por: ctx.usuarioId,
    })
    .select("id, email")
    .single();

  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({ ok: false, codigo: "email_duplicado", error: "Ya existe una cuenta con ese email." });
    }
    // Los triggers de la 023: super_admin fuera de la principal, tope de roles, rol inválido.
    return res.status(409).json({ ok: false, codigo: "rechazado", error: error.message });
  }

  await auditar("crear_usuario", {
    usuarioId: ctx.usuarioId,
    orgId: orgDestino,
    ip: ctx.ip,
    // El email sí; la contraseña temporal NUNCA, ni siquiera acá (§2.1).
    detalle: { creado: data.id, email, roles },
  });

  return res.status(201).json({
    ok: true,
    usuario: { id: data.id, email: data.email, nombre, roles },
    /**
     * La única vez que esta contraseña existe fuera del hash. La UI la muestra con un aviso
     * de que no se puede volver a ver.
     */
    passwordTemporal: temporal,
    aviso: "Copiala ahora: no se puede volver a ver. Si se pierde, hay que generar otra.",
  });
}

/* ─────────────────────────────── Editar ─────────────────────────────── */

async function editar(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const cuerpo = leerCuerpo(req);
  const id = String(cuerpo?.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "Falta el id." });

  const objetivo = await cargarObjetivo(id, ctx);
  if ("error" in objetivo) return res.status(objetivo.status).json({ ok: false, error: objetivo.error });

  const parche: Record<string, unknown> = {};

  if (typeof cuerpo?.nombre === "string" && cuerpo.nombre.trim()) parche.nombre = cuerpo.nombre.trim();
  if (typeof cuerpo?.activo === "boolean") parche.activo = cuerpo.activo;

  if (Array.isArray(cuerpo?.roles)) {
    // Se pasan los roles actuales: la validación mira el CAMBIO, no la lista suelta.
    const problema = validarRoles(cuerpo.roles as string[], ctx, objetivo.roles);
    if (problema) return res.status(problema.status).json({ ok: false, codigo: problema.codigo, error: problema.error });
    parche.roles = cuerpo.roles;
  }

  /**
   * `org_id` NO es editable. Mover un usuario de empresa es cambiar de qué datos es dueño, y
   * hacerlo con un PATCH lo convertiría en la vía más silenciosa de darle acceso a otra
   * empresa. Si algún día hace falta, va a ser una operación con su propio nombre.
   */

  if (Object.keys(parche).length === 0) return res.status(400).json({ ok: false, error: "No hay nada que cambiar." });

  const { error } = await dbSinScope().from("closer_usuarios").update(parche).eq("id", id);
  if (error) return res.status(409).json({ ok: false, codigo: "rechazado", error: error.message });

  /**
   * Desactivar una cuenta tiene que echarla YA. Sin esto seguiría entrando con su cookie
   * hasta que venciera la sesión, que son 7 días — o sea que "desactivar" no desactivaría.
   */
  if (parche.activo === false) await cerrarSesionesDe(id);
  // Cambiarle los roles también: si no, sigue viendo lo que ya no le corresponde hasta que
  // recargue. `contextoDe` los relee en cada request, así que alcanza con eso; el cierre de
  // sesión sería innecesariamente agresivo.

  await auditar("editar_usuario", {
    usuarioId: ctx.usuarioId,
    orgId: objetivo.orgId,
    ip: ctx.ip,
    detalle: { objetivo: id, campos: Object.keys(parche) },
  });
  return res.status(200).json({ ok: true });
}

/* ──────────────────── Regenerar la contraseña temporal ──────────────────── */

/**
 * §4.4 · El reemplazo del "olvidé mi contraseña" por correo.
 *
 * Un admin genera una temporal, se la pasa al usuario por el canal que sea, y el usuario está
 * obligado a cambiarla al entrar. No hay tokens de reset ni correos: cada uno de esos habría
 * sido una superficie más que asegurar para un sistema de cinco empresas.
 *
 * Cierra todas las sesiones del usuario. Es el punto: si esto se hace porque alguien perdió el
 * acceso o porque se sospecha que se lo robaron, dejar viva la sesión anterior no arreglaría
 * nada.
 */
async function regenerar(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const id = String(leerCuerpo(req)?.id ?? req.query.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "Falta el id." });

  const objetivo = await cargarObjetivo(id, ctx);
  if ("error" in objetivo) return res.status(objetivo.status).json({ ok: false, error: objetivo.error });

  /**
   * Al admin principal SÍ se le puede cambiar la contraseña (§2.2.2: lo inmutable es quién es
   * y qué puede hacer, no su clave). Pero no se le fuerza el cambio: su contraseña se mantiene
   * fija por decisión explícita de §4.5, así que forzarlo contradiría esa decisión.
   */
  const temporal = generarPasswordTemporal();
  const { error } = await dbSinScope()
    .from("closer_usuarios")
    .update({
      password_hash: await hashearPassword(temporal),
      debe_cambiar_password: !objetivo.esAdminPrincipal,
      intentos_fallidos: 0,
      bloqueado_hasta: null,
    })
    .eq("id", id);

  if (error) return res.status(409).json({ ok: false, codigo: "rechazado", error: error.message });

  await cerrarSesionesDe(id);
  await auditar("cambio_password", {
    usuarioId: ctx.usuarioId,
    orgId: objetivo.orgId,
    ip: ctx.ip,
    detalle: { objetivo: id, accion: "regenerada_por_admin" },
  });

  return res.status(200).json({
    ok: true,
    passwordTemporal: temporal,
    sesionesCerradas: true,
    aviso: "Copiala ahora: no se puede volver a ver. Se le cerraron todas las sesiones.",
  });
}

/* ─────────────────────────────── Eliminar ─────────────────────────────── */

async function eliminar(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const id = String(req.query.id ?? leerCuerpo(req)?.id ?? "").trim();
  if (!id) return res.status(400).json({ ok: false, error: "Falta el id." });

  const objetivo = await cargarObjetivo(id, ctx);
  if ("error" in objetivo) return res.status(objetivo.status).json({ ok: false, error: objetivo.error });

  const { error } = await dbSinScope().from("closer_usuarios").delete().eq("id", id);
  if (error) {
    /**
     * Dos motivos posibles y hay que distinguirlos: el trigger del admin principal (409, es
     * una regla), o una FK — el usuario firmó seguimientos, notas o eventos, y borrarlo
     * dejaría esa historia sin autor. En ese caso lo correcto es desactivarlo, no borrarlo.
     */
    const esFk = error.code === "23503";
    return res.status(409).json({
      ok: false,
      codigo: esFk ? "tiene_historial" : "protegido",
      error: esFk
        ? "Este usuario tiene trabajo registrado (seguimientos, notas o eventos). Desactivalo en vez de borrarlo: así su historial sigue teniendo autor."
        : error.message,
    });
  }

  await cerrarSesionesDe(id);
  await auditar("eliminar_usuario", { usuarioId: ctx.usuarioId, orgId: objetivo.orgId, ip: ctx.ip, detalle: { objetivo: id } });
  return res.status(200).json({ ok: true, eliminado: true });
}

/* ─────────────────────────────── Piezas ─────────────────────────────── */

/**
 * Carga el usuario objetivo y **verifica que quien pide tenga derecho a tocarlo**.
 *
 * Es el chequeo que impide que un `admin` de la empresa B edite a alguien de la A pasando su
 * id. Devuelve 404 y no 403 cuando es de otra empresa: confirmar que el id existe ya sería
 * filtrar información.
 */
async function cargarObjetivo(
  id: string,
  ctx: Contexto,
): Promise<{ orgId: string; esAdminPrincipal: boolean; roles: Rol[] } | { error: string; status: number }> {
  const { data, error } = await dbSinScope()
    .from("closer_usuarios")
    .select("id, org_id, es_admin_principal, roles")
    .eq("id", id)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: "Ese usuario no existe.", status: 404 };

  if (!ctx.esSuperAdmin && data.org_id !== ctx.orgPropia) {
    return { error: "Ese usuario no existe.", status: 404 };
  }
  return {
    orgId: data.org_id as string,
    esAdminPrincipal: Boolean(data.es_admin_principal),
    // Los roles que YA tiene hacen falta para comparar contra los que se piden: sin eso no se
    // puede distinguir "me estás otorgando admin" de "admin ya lo tenía y no lo tocaste".
    roles: ((data.roles as Rol[] | null) ?? []),
  };
}

/**
 * @param previos Los roles que el usuario YA tenía. `[]` en un alta.
 *
 * ── Se compara el CAMBIO, no la lista (corregido el 2026-08-07) ───────
 *
 * La primera versión rechazaba cualquier lista que contuviera un rol no operativo. Suena
 * bien y estaba mal: un `admin` de empresa cliente que quisiera **corregirle el nombre** a
 * otro admin —o a sí mismo— mandaba la lista de roles sin tocar, con `admin` adentro, y se
 * comía un 403 `rol_no_permitido`. O sea que editar a un admin era imposible para un admin.
 *
 * Lo que §7.2 prohíbe es *asignar* roles que no le corresponden. Preservar los que ya
 * estaban no es asignar. La regla correcta es: **el conjunto de roles no operativos tiene que
 * quedar idéntico**. Así un admin no puede otorgarse `super_admin` (agregar) ni degradar al
 * admin principal de su empresa (quitar), pero sí puede editar a cualquiera.
 */
export function validarRoles(
  roles: string[],
  // Solo necesita saber si quien pide es super admin. Pedir el `Contexto` entero obligaría a
  // fabricar una sesión completa para probarlo, y esta es la regla que más merece un test.
  ctx: { esSuperAdmin: boolean },
  previos: Rol[] = [],
): { error: string; codigo: string; status: number } | null {
  if (roles.length === 0) {
    return { error: "Elegí al menos un rol.", codigo: "sin_roles", status: 400 };
  }
  if (roles.length > MAX_ROLES) {
    return { error: `Hasta ${MAX_ROLES} roles por usuario.`, codigo: "demasiados_roles", status: 400 };
  }
  const invalido = roles.find((r) => !ROLES_VALIDOS.includes(r as Rol));
  if (invalido) {
    return { error: `"${invalido}" no es un rol.`, codigo: "rol_invalido", status: 400 };
  }
  if (new Set(roles).size !== roles.length) {
    return { error: "Hay un rol repetido.", codigo: "rol_repetido", status: 400 };
  }

  if (ctx.esSuperAdmin) return null;

  /**
   * La escalada de privilegios que esto existe para cortar: un `admin` de empresa cliente que
   * se otorgue `super_admin` vería los datos de todas. El trigger de la 023 lo bloquea fuera
   * de la principal, pero un admin DE ARIA sí podría — y no debe.
   */
  const noOperativos = (lista: string[]) =>
    [...new Set(lista.filter((r) => !ROLES_OPERATIVOS.includes(r as Rol)))].sort();

  const antes = noOperativos(previos);
  const despues = noOperativos(roles);

  const otorgado = despues.find((r) => !antes.includes(r));
  if (otorgado) {
    return {
      error: `Solo el super admin puede otorgar el rol "${otorgado}".`,
      codigo: "rol_no_permitido",
      status: 403,
    };
  }
  const quitado = antes.find((r) => !despues.includes(r));
  if (quitado) {
    return {
      error: `Solo el super admin puede quitar el rol "${quitado}".`,
      codigo: "rol_no_permitido",
      status: 403,
    };
  }
  return null;
}

function leerCuerpo(req: VercelRequest): Record<string, unknown> | null {
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return (req.body as Record<string, unknown> | undefined) ?? null;
}
