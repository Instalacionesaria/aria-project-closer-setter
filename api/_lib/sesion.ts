/**
 * Sesiones y cookies (ESPEC-MULTIEMPRESA §4.2).
 *
 * ── No se usa Supabase Auth, y es una decisión ────────────────────────
 *
 * Supabase Auth exigiría la `anon key` en el bundle del browser. La arquitectura de este
 * proyecto evita eso a propósito (`docs/02-ARQUITECTURA.md`): el frontend nunca habla con
 * Supabase ni con GHL, solo con `api/`. Meter la anon key para tener login sería regalar el
 * único aislamiento que hoy sostiene todo.
 *
 * ── En la base va el hash, nunca el token ─────────────────────────────
 *
 * El token crudo existe en tres lugares: la cookie del navegador, el header del request y la
 * memoria del proceso mientras lo valida. En `closer_sesiones` va solo su SHA-256.
 * Consecuencia buscada: un volcado de esa tabla **no permite suplantar a nadie**.
 *
 * SHA-256 y no scrypt acá, al revés que con las contraseñas, porque el token ya es 32 bytes
 * aleatorios: no hay diccionario que probar, así que el costo extra no compraría nada y se
 * pagaría en cada request.
 */

import { createHash, randomBytes } from "node:crypto";
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { dbSinScope } from "./db.js";

export const COOKIE = "cc_sesion";

/** 7 días (§4.2), renovados en cada request mientras la persona siga usando la herramienta. */
const DURACION_MS = 7 * 24 * 60 * 60 * 1000;

/** Se renueva como mucho una vez por hora: un UPDATE por request sería gasto sin ganancia. */
const RENOVAR_SI_QUEDA_MENOS_DE_MS = 6 * 24 * 60 * 60 * 1000;

export interface SesionActiva {
  sesionId: string;
  usuarioId: string;
  empresaActiva: string | null;
  expiraEl: string;
}

const hashDe = (token: string) => createHash("sha256").update(token).digest("hex");

/* ────────────────────────────── Cookie ────────────────────────────── */

/**
 * `httpOnly` para que ningún script pueda leerla —un XSS deja de ser un robo de sesión—,
 * `Secure` para que no viaje en claro, y `SameSite=Lax` que corta el CSRF en las peticiones
 * que importan sin romper la navegación normal.
 *
 * `Lax` y no `Strict`: con `Strict` la cookie no viaja cuando alguien llega desde un enlace
 * externo, y la persona vería la pantalla de login aunque tenga sesión válida.
 */
export function ponerCookie(res: VercelResponse, token: string, expiraEl: Date): void {
  res.setHeader("Set-Cookie", [
    `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expiraEl.toUTCString()}`,
  ]);
}

export function borrarCookie(res: VercelResponse): void {
  res.setHeader("Set-Cookie", [`${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`]);
}

export function tokenDeRequest(req: VercelRequest): string | null {
  const crudo = req.headers.cookie;
  if (!crudo) return null;
  for (const parte of crudo.split(";")) {
    const i = parte.indexOf("=");
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === COOKIE) return decodeURIComponent(parte.slice(i + 1).trim()) || null;
  }
  return null;
}

/* ────────────────────────────── Ciclo de vida ────────────────────────────── */

/**
 * Crea la sesión y devuelve el token **crudo**, que es la única vez que existe fuera de la
 * cookie. Quien llama lo pone en el `Set-Cookie` y lo suelta.
 */
export async function crearSesion(
  usuarioId: string,
  datos: { ip?: string | null; userAgent?: string | null; empresaActiva?: string | null },
): Promise<{ token: string; expiraEl: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiraEl = new Date(Date.now() + DURACION_MS);

  // Sin scope: la tabla de sesiones es transversal (una sesión pertenece a un usuario, no a
  // una empresa) y además esto corre ANTES de saber con qué organización se va a trabajar.
  const { error } = await dbSinScope().from("closer_sesiones").insert({
    usuario_id: usuarioId,
    token_hash: hashDe(token),
    empresa_activa: datos.empresaActiva ?? null,
    expira_el: expiraEl.toISOString(),
    ip: datos.ip ?? null,
    user_agent: datos.userAgent ?? null,
  });
  if (error) throw new Error(`closer_sesiones: ${error.message}`);

  return { token, expiraEl };
}

/**
 * Resuelve el token a una sesión viva, o `null`.
 *
 * La expiración se compara **en la consulta** y no en JavaScript: si se filtrara acá, el reloj
 * del proceso decidiría la validez, y en serverless eso son procesos distintos con relojes que
 * pueden diferir. La base es el único reloj compartido.
 */
export async function resolverSesion(token: string | null): Promise<SesionActiva | null> {
  if (!token) return null;

  const { data, error } = await dbSinScope()
    .from("closer_sesiones")
    .select("id, usuario_id, empresa_activa, expira_el")
    .eq("token_hash", hashDe(token))
    .gt("expira_el", new Date().toISOString())
    .maybeSingle();

  // Un error de red se trata como "no hay sesión": ante la duda, no se entra. Es lo contrario
  // de la regla habitual de no confundir "no hay" con "no pude averiguar", y acá es a
  // propósito — en autenticación, fallar cerrado es lo correcto.
  if (error || !data) return null;

  return {
    sesionId: data.id as string,
    usuarioId: data.usuario_id as string,
    empresaActiva: (data.empresa_activa as string | null) ?? null,
    expiraEl: data.expira_el as string,
  };
}

/**
 * Renovación deslizante (§4.2): mientras la persona use la herramienta, la sesión no vence.
 *
 * Solo escribe cuando queda menos de un día de los siete. Renovar en cada request sería un
 * UPDATE por request contra la tabla más caliente del sistema, para mover una fecha que casi
 * siempre ya está lejos.
 */
export async function renovarSiHaceFalta(sesion: SesionActiva, res: VercelResponse, token: string): Promise<void> {
  const restante = new Date(sesion.expiraEl).getTime() - Date.now();
  if (restante > RENOVAR_SI_QUEDA_MENOS_DE_MS) return;

  const nuevo = new Date(Date.now() + DURACION_MS);
  const { error } = await dbSinScope()
    .from("closer_sesiones")
    .update({ expira_el: nuevo.toISOString() })
    .eq("id", sesion.sesionId);

  // Si la renovación falla, la sesión sigue siendo válida hasta su vencimiento original: no
  // hay motivo para echar a nadie por un error transitorio de escritura.
  if (!error) ponerCookie(res, token, nuevo);
}

export async function cerrarSesion(sesionId: string): Promise<void> {
  await dbSinScope().from("closer_sesiones").delete().eq("id", sesionId);
}

/** Todas las sesiones de un usuario. Se usa al cambiar la contraseña y al desactivar la cuenta. */
export async function cerrarSesionesDe(usuarioId: string): Promise<void> {
  await dbSinScope().from("closer_sesiones").delete().eq("usuario_id", usuarioId);
}

/** La empresa que el super admin está mirando (§7.1). Queda registrada en auditoría. */
export async function cambiarEmpresaActiva(sesionId: string, orgId: string | null): Promise<void> {
  await dbSinScope().from("closer_sesiones").update({ empresa_activa: orgId }).eq("id", sesionId);
}

/**
 * La IP del cliente. En Vercel viene en `x-forwarded-for`, que puede traer una cadena de
 * proxies; el primero es el origen real. Es un dato para auditoría, no para autorizar nada:
 * se puede falsificar, así que ninguna decisión de seguridad se apoya en él.
 */
export function ipDe(req: VercelRequest): string | null {
  const h = req.headers["x-forwarded-for"];
  const crudo = Array.isArray(h) ? h[0] : h;
  return crudo?.split(",")[0]?.trim() || null;
}
