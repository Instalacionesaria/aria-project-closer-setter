/**
 * `POST /api/auth/login` — entrar (ESPEC-MULTIEMPRESA §4.3).
 *
 * Sin recuperación por correo, la fuerza bruta es el vector principal. Las cuatro defensas:
 *
 *   1. **Bloqueo por cuenta**: 5 intentos fallidos → 15 minutos.
 *   2. **Rate limit por IP**, además del de cuenta: si no, alguien prueba una contraseña común
 *      contra mil cuentas distintas y nunca bloquea ninguna.
 *   3. **Un solo mensaje de error**, exista el email o no. No se revela qué correos hay.
 *   4. **Todo intento va a auditoría**, exitoso o no.
 *
 * ── El mensaje único no alcanza si el tiempo delata ───────────────────
 *
 * Responder "no existe" al instante y "contraseña mal" 100 ms después dice lo mismo que el
 * texto que se está evitando. Por eso, cuando el email no existe, igual se hace una
 * derivación scrypt contra un hash señuelo: los dos caminos cuestan lo mismo.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auditar } from "../_lib/auth.js";
import { dbSinScope } from "../_lib/db.js";
import { verificarPassword } from "../_lib/password.js";
import { crearSesion, ipDe, ponerCookie } from "../_lib/sesion.js";

/** Idéntico para todos los fallos. Nunca decir si el email existe (§4.3). */
const CREDENCIALES_INVALIDAS = "Credenciales inválidas.";

const MAX_INTENTOS = 5;
const BLOQUEO_MINUTOS = 15;

/** Rate limit por IP: 20 intentos en 15 minutos, contados sobre la auditoría. */
const MAX_POR_IP = 20;
const VENTANA_IP_MIN = 15;

/**
 * Hash señuelo con los mismos parámetros que uno real, para gastar el mismo tiempo cuando el
 * email no existe. Su contraseña no la conoce nadie: es un `randomBytes` que se tiró.
 */
const SENUELO =
  "scrypt$16384$8$1$c2FsdC1zZW51ZWxvLTE2Yg==$" +
  "ZG9zLWNpZW50b3Mtb2NoZW50YS15LW9jaG8tYnl0ZXMtcXVlLW5vLWNvaW5jaWRlbi1jb24tbmFkYS1qYW1hcy0wMDA=";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Usá POST." });
  }

  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  const email = String(cuerpo?.email ?? "").trim().toLowerCase();
  const password = String(cuerpo?.password ?? "");
  const ip = ipDe(req);

  if (!email || !password) {
    return res.status(400).json({ ok: false, error: "Falta el email o la contraseña." });
  }

  /* ── Defensa 2: el rate limit por IP, antes de tocar la tabla de usuarios ── */
  if (ip && (await demasiadosIntentos(ip))) {
    await auditar("login_fallido", { ip, detalle: { email, motivo: "rate_limit_ip" } });
    return res.status(429).json({
      ok: false,
      codigo: "demasiados_intentos",
      error: "Demasiados intentos desde esta conexión. Esperá unos minutos.",
    });
  }

  const { data: usuario } = await dbSinScope()
    .from("closer_usuarios")
    .select("id, org_id, nombre, email, password_hash, roles, activo, debe_cambiar_password, intentos_fallidos, bloqueado_hasta")
    .eq("email", email)
    .maybeSingle();

  /* ── Defensa 1: el bloqueo por cuenta ── */
  if (usuario?.bloqueado_hasta && new Date(usuario.bloqueado_hasta as string) > new Date()) {
    await auditar("login_fallido", {
      usuarioId: usuario.id as string,
      orgId: usuario.org_id as string,
      ip,
      detalle: { motivo: "cuenta_bloqueada" },
    });
    // Se dice que está bloqueada, no que la contraseña esté mal: quien llegó hasta acá ya
    // sabe que la cuenta existe (la bloqueó él), y ocultarlo solo confunde al dueño legítimo.
    return res.status(429).json({
      ok: false,
      codigo: "cuenta_bloqueada",
      error: `Cuenta bloqueada por ${BLOQUEO_MINUTOS} minutos tras varios intentos fallidos.`,
    });
  }

  // Siempre se deriva, exista el usuario o no: los dos caminos tardan lo mismo.
  const coincide = await verificarPassword(password, (usuario?.password_hash as string | null) ?? SENUELO);

  if (!usuario || !usuario.activo || !coincide) {
    if (usuario) await sumarFallo(usuario as Record<string, unknown>);
    await auditar("login_fallido", {
      usuarioId: (usuario?.id as string) ?? null,
      orgId: (usuario?.org_id as string) ?? null,
      ip,
      // El email se registra; la contraseña NUNCA, ni la fallida (§4.1).
      detalle: { email, motivo: !usuario ? "email_inexistente" : !usuario.activo ? "cuenta_inactiva" : "password" },
    });
    return res.status(401).json({ ok: false, codigo: "credenciales", error: CREDENCIALES_INVALIDAS });
  }

  /* ── Entró ── */

  // El contador se resetea con un login exitoso (§4.3).
  await dbSinScope()
    .from("closer_usuarios")
    .update({ intentos_fallidos: 0, bloqueado_hasta: null, ultimo_acceso_el: new Date().toISOString() })
    .eq("id", usuario.id as string);

  const { token, expiraEl } = await crearSesion(usuario.id as string, {
    ip,
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
  });
  ponerCookie(res, token, expiraEl);

  await auditar("login", { usuarioId: usuario.id as string, orgId: usuario.org_id as string, ip });

  return res.status(200).json({
    ok: true,
    usuario: {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      roles: usuario.roles ?? [],
      orgId: usuario.org_id,
      debeCambiarPassword: Boolean(usuario.debe_cambiar_password),
    },
  });
}

/** Cuenta los fallidos de esa IP en la ventana. La auditoría ya los tiene: no hace falta otra tabla. */
async function demasiadosIntentos(ip: string): Promise<boolean> {
  const desde = new Date(Date.now() - VENTANA_IP_MIN * 60_000).toISOString();
  const { count, error } = await dbSinScope()
    .from("closer_auditoria_accesos")
    .select("id", { count: "exact", head: true })
    .eq("accion", "login_fallido")
    .eq("ip", ip)
    .gte("creado_el", desde);

  // Si la consulta falla, NO se bloquea: un error de lectura no puede dejar afuera a todo el
  // mundo. El bloqueo por cuenta sigue en pie, que es la defensa principal.
  if (error) return false;
  return (count ?? 0) >= MAX_POR_IP;
}

async function sumarFallo(usuario: Record<string, unknown>): Promise<void> {
  const intentos = Number(usuario.intentos_fallidos ?? 0) + 1;
  const bloquear = intentos >= MAX_INTENTOS;
  await dbSinScope()
    .from("closer_usuarios")
    .update({
      intentos_fallidos: bloquear ? 0 : intentos,
      bloqueado_hasta: bloquear ? new Date(Date.now() + BLOQUEO_MINUTOS * 60_000).toISOString() : null,
    })
    .eq("id", usuario.id as string);
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
