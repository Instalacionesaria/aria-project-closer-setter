/**
 * El portero de `api/` (ESPEC-MULTIEMPRESA §3.2).
 *
 * Resuelve, en este orden: cookie → sesión → usuario → **empresa efectiva** → roles. Y rechaza
 * con 403 **antes de tocar un solo dato**.
 *
 * > *"Un endpoint sin verificación explícita se considera un bug de seguridad, no un
 * > descuido."* (§3.2)
 *
 * ── La empresa sale de la sesión, nunca del request ───────────────────
 *
 * Ningún endpoint acepta la organización por query string ni por body. Si la aceptara, el
 * aislamiento entero se caería con cambiar un id en la URL — que es literalmente el primer
 * criterio de aceptación de la especificación (§12).
 *
 * La única excepción es el **super admin**, que puede mirar otra empresa. Pero incluso ahí el
 * dato no viaja en el request: vive en `closer_sesiones.empresa_activa`, se cambia con un
 * endpoint propio y **queda registrado en auditoría**.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { resolverCredenciales, type Credenciales } from "./credenciales.js";
import { dbSinScope } from "./db.js";
import { ipDe, renovarSiHaceFalta, resolverSesion, tokenDeRequest } from "./sesion.js";

export type Rol = "super_admin" | "admin" | "closer" | "setter" | "tecnico" | "media_buyer";

export interface Contexto {
  usuarioId: string;
  nombre: string;
  email: string | null;
  roles: Rol[];
  /** La organización DUEÑA del usuario. */
  orgPropia: string;
  /** Sobre la que se está trabajando. Distinta de la propia solo para un super admin. */
  orgEfectiva: string;
  esSuperAdmin: boolean;
  debeCambiarPassword: boolean;
  sesionId: string;
  ip: string | null;
  /**
   * Las credenciales de la empresa efectiva, ya resueltas y descifradas. El handler las
   * activa con `activar(ctx.credenciales)` — ver el comentario de esa función para por qué no
   * se activan acá adentro.
   */
  credenciales: Credenciales;
}

/**
 * Acciones registrables. Lista cerrada a propósito: un `accion` libre termina siendo texto
 * distinto para el mismo hecho y una auditoría que no se puede consultar.
 */
export type AccionAuditada =
  | "login"
  | "login_fallido"
  | "logout"
  | "cambio_password"
  | "crear_usuario"
  | "editar_usuario"
  | "eliminar_usuario"
  | "crear_empresa"
  | "editar_empresa"
  | "cambiar_empresa_activa"
  | "rotar_credencial"
  | "bootstrap";

/**
 * Deja constancia. **Nunca secretos, ni siquiera cifrados ni fallidos** (§2.1): registrar la
 * contraseña que alguien tipeó mal es la forma más común de terminar con contraseñas reales
 * en una tabla de logs.
 *
 * No lanza: que la auditoría falle no puede impedir la operación que estaba auditando. Se
 * grita por consola y se sigue.
 */
export async function auditar(
  accion: AccionAuditada,
  datos: { usuarioId?: string | null; orgId?: string | null; detalle?: Record<string, unknown>; ip?: string | null },
): Promise<void> {
  const { error } = await dbSinScope().from("closer_auditoria_accesos").insert({
    usuario_id: datos.usuarioId ?? null,
    org_id: datos.orgId ?? null,
    accion,
    detalle: datos.detalle ?? null,
    ip: datos.ip ?? null,
  });
  if (error) console.error(`[auditoria] no se pudo registrar '${accion}': ${error.message}`);
}

/**
 * Resuelve el contexto, o `null` si no hay sesión válida.
 *
 * Sin scope al leer el usuario, y tiene que ser así: la organización todavía no se conoce —es
 * justamente lo que esta función averigua—. Es el caso que la escotilla existe para cubrir.
 */
export async function contextoDe(req: VercelRequest, res: VercelResponse): Promise<Contexto | null> {
  const token = tokenDeRequest(req);
  const sesion = await resolverSesion(token);
  if (!sesion || !token) return null;

  const { data, error } = await dbSinScope()
    .from("closer_usuarios")
    .select("id, org_id, nombre, email, roles, activo, debe_cambiar_password")
    .eq("id", sesion.usuarioId)
    .maybeSingle();

  if (error || !data) return null;
  // Una cuenta desactivada tiene que dejar de entrar YA, sin esperar a que venza su sesión.
  if (!data.activo) return null;

  const roles = ((data.roles as string[] | null) ?? []) as Rol[];
  const esSuperAdmin = roles.includes("super_admin");
  const orgPropia = data.org_id as string;

  /**
   * La empresa efectiva. `empresa_activa` solo se respeta si quien mira es super admin: si un
   * `admin` común consiguiera escribirla en su fila de sesión, seguiría viendo la suya.
   * La autorización se decide con el rol, no con el dato guardado.
   */
  const orgEfectiva = esSuperAdmin && sesion.empresaActiva ? sesion.empresaActiva : orgPropia;

  await renovarSiHaceFalta(sesion, res, token);

  return {
    usuarioId: data.id as string,
    nombre: data.nombre as string,
    email: (data.email as string | null) ?? null,
    roles,
    orgPropia,
    orgEfectiva,
    esSuperAdmin,
    debeCambiarPassword: Boolean(data.debe_cambiar_password),
    sesionId: sesion.sesionId,
    ip: ipDe(req),
    // `exigir()` la reemplaza por la resuelta. `contextoDe` sola no las necesita: la usan el
    // login y `/api/auth/sesion`, que no hablan con GHL.
    credenciales: undefined as unknown as Credenciales,
  };
}

/**
 * El guardia que usa cada endpoint. Devuelve el contexto o **ya respondió** — quien llama
 * solo tiene que cortar.
 *
 *     const ctx = await exigir(req, res, ["closer"]);
 *     if (!ctx) return;
 *
 * Ese patrón es a propósito: obliga a escribir el `if (!ctx) return` y hace que olvidarse se
 * vea en el diff, en vez de esconderse en un decorador que alguien no puso.
 */
export async function exigir(
  req: VercelRequest,
  res: VercelResponse,
  roles: Rol[] | "cualquiera",
): Promise<Contexto | null> {
  const ctx = await contextoDe(req, res);

  if (!ctx) {
    res.status(401).json({ ok: false, codigo: "sin_sesion", error: "Necesitás iniciar sesión." });
    return null;
  }

  /**
   * Con la contraseña temporal sin cambiar, lo único que se puede hacer es cambiarla (§4.4).
   * El propio endpoint de cambio pasa `"cualquiera"`, así que no se bloquea a sí mismo.
   */
  if (ctx.debeCambiarPassword && roles !== "cualquiera") {
    res.status(403).json({
      ok: false,
      codigo: "password_temporal",
      error: "Tenés que definir una contraseña nueva antes de seguir.",
    });
    return null;
  }

  /**
   * ── Se activan las credenciales de la empresa (§5.2) ──────────────
   *
   * Desde acá y hasta el final del request, `env.ghlApiKey()` y `env.ghlLocationId()`
   * devuelven las de ESTA empresa, no las globales. Es lo que permite que los catorce sitios
   * que las leen de forma síncrona sigan sin cambiar.
   *
   * Va **después** de resolver el rol y antes de devolver el contexto: una empresa
   * desactivada no opera, y averiguarlo acá evita que cada endpoint tenga que acordarse.
   *
   * Si la resolución falla —la organización no existe, o su credencial está cifrada con otra
   * clave maestra— se responde 503 y se dice cuál es el problema. Dejar pasar el request
   * produciría llamadas a GHL con un token vacío y un 401 imposible de diagnosticar.
   */
  try {
    const cred = await resolverCredenciales(ctx.orgEfectiva);
    if (!cred.activa) {
      res.status(403).json({
        ok: false,
        codigo: "empresa_inactiva",
        error: "Esta empresa está desactivada. Hablá con el administrador.",
      });
      return null;
    }
    ctx.credenciales = cred;
  } catch (e) {
    console.error(`[auth] credenciales de ${ctx.orgEfectiva}: ${(e as Error).message}`);
    res.status(503).json({
      ok: false,
      codigo: "credenciales_irresolubles",
      error: (e as Error).message,
    });
    return null;
  }

  if (roles === "cualquiera") return ctx;

  // El super admin pasa por todos lados: es el dueño de la plataforma (§3.1).
  if (ctx.esSuperAdmin) return ctx;

  if (!roles.some((r) => ctx.roles.includes(r))) {
    res.status(403).json({
      ok: false,
      codigo: "sin_permiso",
      error: "Tu rol no tiene acceso a esta sección.",
    });
    return null;
  }

  return ctx;
}

/**
 * Para los endpoints de máquina (crons y webhooks): no hay sesión, hay un secreto compartido.
 *
 * **Falla cerrado**: sin la variable configurada devuelve 503 y no acepta nada. La versión
 * anterior de este chequeo era `if (secreto && …)`, que sin la variable dejaba pasar a todos —
 * el modo de fallar más peligroso que existe, porque en local y en un preview sin variables
 * parece que funciona.
 */
export function exigirSecreto(req: VercelRequest, res: VercelResponse, nombreVar: string): boolean {
  const esperado = process.env[nombreVar];
  if (!esperado) {
    console.error(`[auth] ${nombreVar} sin configurar: se rechaza todo hasta que exista.`);
    res.status(503).json({ ok: false, error: `${nombreVar} sin configurar en el servidor.` });
    return false;
  }
  const recibido = String(req.headers["x-webhook-secret"] ?? req.query.secret ?? "");
  if (recibido !== esperado) {
    res.status(401).json({ ok: false, error: "Secreto inválido." });
    return false;
  }
  return true;
}
