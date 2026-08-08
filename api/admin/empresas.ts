/**
 * `GET/POST/PATCH/DELETE /api/admin/empresas` — el panel de empresas (ESPEC §7.1).
 *
 * **Solo `super_admin`.** Un `admin` de una empresa cliente no ve que existen las otras: ni
 * sus nombres, ni cuántas hay.
 *
 * ── Los guards duros NO están acá ─────────────────────────────────────
 *
 * "No se puede borrar ni desmarcar la empresa principal" lo garantizan triggers de la 018, no
 * este archivo. La especificación §2.2 lo pide así con un motivo: *"un bug en un endpoint las
 * rompería para siempre"*. Acá se traduce el error de la base a un mensaje legible, pero si
 * este código desapareciera, la regla seguiría en pie.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { activar, olvidarCredenciales } from "../_lib/credenciales.js";
import { auditar, exigir } from "../_lib/auth.js";
import { dbSinScope } from "../_lib/db.js";

/** Lo que viaja al browser. **Ni un secreto**, ni siquiera enmascarado (§7.1 es el listado). */
const COLUMNAS = "org_id, nombre, slug, es_principal, activa, zona_horaria, ghl_location_id, creado_el";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Solo super_admin. `exigir` deja pasar a cualquier super_admin y a nadie más con esta lista.
  const ctx = await exigir(req, res, ["super_admin"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  /**
   * Doble verificación. `exigir(["super_admin"])` ya lo garantiza, pero este endpoint crea
   * empresas y este chequeo es el que quiero que salte a la vista al leer el archivo: si
   * mañana alguien afloja la lista de roles de arriba, esto sigue cerrado.
   */
  if (!ctx.esSuperAdmin) {
    return res.status(403).json({ ok: false, codigo: "solo_super_admin", error: "Solo el super admin gestiona empresas." });
  }

  if (req.method === "GET") return listar(res);
  if (req.method === "POST") return crear(req, res, ctx);
  if (req.method === "PATCH") return editar(req, res, ctx);
  if (req.method === "DELETE") return desactivar(req, res, ctx);
  res.setHeader("Allow", "GET, POST, PATCH, DELETE");
  return res.status(405).json({ ok: false, error: "Usá GET, POST, PATCH o DELETE." });
}

/* ─────────────────────────────── Listar ─────────────────────────────── */

async function listar(res: VercelResponse) {
  const { data, error } = await dbSinScope()
    .from("closer_org_config")
    .select(COLUMNAS)
    .order("es_principal", { ascending: false })
    .order("nombre", { ascending: true });

  if (error) return res.status(500).json({ ok: false, error: error.message });

  const empresas = (data ?? []) as unknown as Record<string, unknown>[];

  /**
   * La cantidad de usuarios y la última actividad, en DOS consultas para todo el lote y no
   * una por empresa: con 5 empresas un N+1 no se nota, pero es el tipo de cosa que después
   * nadie revisa.
   */
  const { data: usuarios } = await dbSinScope().from("closer_usuarios").select("org_id, ultimo_acceso_el");
  const porOrg = new Map<string, { usuarios: number; ultimoAcceso: string | null }>();
  for (const u of (usuarios ?? []) as { org_id: string; ultimo_acceso_el: string | null }[]) {
    const actual = porOrg.get(u.org_id) ?? { usuarios: 0, ultimoAcceso: null };
    actual.usuarios++;
    if (u.ultimo_acceso_el && (!actual.ultimoAcceso || u.ultimo_acceso_el > actual.ultimoAcceso)) {
      actual.ultimoAcceso = u.ultimo_acceso_el;
    }
    porOrg.set(u.org_id, actual);
  }

  return res.status(200).json({
    ok: true,
    count: empresas.length,
    empresas: empresas.map((e) => {
      const extra = porOrg.get(e.org_id as string);
      return {
        id: e.org_id,
        nombre: e.nombre,
        slug: e.slug,
        esPrincipal: e.es_principal,
        activa: e.activa,
        zonaHoraria: e.zona_horaria,
        // Solo los últimos 4: alcanza para reconocer la subcuenta, no para usarla.
        ghlLocationId: e.ghl_location_id ? `…${String(e.ghl_location_id).slice(-4)}` : null,
        creadoEl: e.creado_el,
        usuarios: extra?.usuarios ?? 0,
        // `null` = nadie entró nunca. La vista lo muestra como tal, no como una fecha vieja.
        ultimoAcceso: extra?.ultimoAcceso ?? null,
      };
    }),
  });
}

/* ─────────────────────────────── Crear ─────────────────────────────── */

async function crear(req: VercelRequest, res: VercelResponse, ctx: { usuarioId: string; ip: string | null }) {
  const cuerpo = leerCuerpo(req);
  const nombre = String(cuerpo?.nombre ?? "").trim();
  const slug = String(cuerpo?.slug ?? "").trim().toLowerCase();
  const zonaHoraria = String(cuerpo?.zonaHoraria ?? "America/Lima").trim();

  if (!nombre) return res.status(400).json({ ok: false, error: "Falta el nombre." });
  if (!/^[a-z0-9-]{2,40}$/.test(slug)) {
    return res.status(400).json({
      ok: false,
      codigo: "slug_invalido",
      error: "El identificador va en minúsculas, sin espacios ni acentos: solo letras, números y guiones.",
    });
  }
  // Se valida contra Intl y no contra una lista propia: mantener una lista de zonas horarias
  // al día es trabajo que el runtime ya hace.
  if (!zonaValida(zonaHoraria)) {
    return res.status(400).json({ ok: false, codigo: "zona_invalida", error: `"${zonaHoraria}" no es una zona horaria válida.` });
  }

  const { data, error } = await dbSinScope()
    .from("closer_org_config")
    .insert({
      /**
       * ── El id se genera ACÁ, y por eso este endpoint nunca había funcionado ──────
       *
       * `org_id` es la PRIMARY KEY de `closer_org_config` y es `not null` **sin default**, así que
       * este INSERT venía fallando desde siempre con `null value in column "org_id" ... violates
       * not-null constraint`. No se había notado porque la única empresa que existe —ARIA— la
       * sembró la migración `018` con el UUID escrito a mano: el panel se construyó y nunca se
       * ejercitó creando una de verdad.
       *
       * Se genera en Node y no con un `default gen_random_uuid()` en la columna a propósito. Un
       * default haría que **cualquier** INSERT que olvide el id cree una empresa fantasma en
       * silencio, y una fila de esta tabla no es un registro más: es una EMPRESA, con once tablas
       * apuntándole por FK. Que siga siendo obligatorio explícito es lo que hace que un olvido
       * futuro falle ruidoso en vez de ensuciar la base.
       */
      org_id: randomUUID(),
      nombre,
      slug,
      zona_horaria: zonaHoraria,
      canales_sin_seguimiento_automatico: ["instagram"],
      // Nace ACTIVA pero SIN credenciales: hasta que alguien cargue su PIT no puede hablar con
      // GHL, y `resolverCredenciales` devuelve null sin fallback. Es lo correcto — una empresa
      // a medio configurar no debe operar con las credenciales de ARIA.
      activa: true,
      es_principal: false,
    })
    .select(COLUMNAS)
    .single();

  if (error) {
    // 23505 = slug o locationId repetido. Es un error del usuario, no del servidor.
    if (error.code === "23505") {
      return res.status(409).json({ ok: false, codigo: "duplicado", error: "Ya existe una empresa con ese identificador." });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }

  await auditar("crear_empresa", {
    usuarioId: ctx.usuarioId,
    orgId: data.org_id as string,
    ip: ctx.ip,
    detalle: { nombre, slug },
  });

  return res.status(201).json({ ok: true, empresa: { id: data.org_id, nombre, slug, activa: true } });
}

/* ─────────────────────────────── Editar ─────────────────────────────── */

async function editar(req: VercelRequest, res: VercelResponse, ctx: { usuarioId: string; ip: string | null }) {
  const cuerpo = leerCuerpo(req);
  const orgId = String(cuerpo?.orgId ?? "").trim();
  if (!orgId) return res.status(400).json({ ok: false, error: "Falta orgId." });

  /**
   * Lista blanca de campos editables. **Ni `es_principal` ni los `*_cifrado` entran acá**: lo
   * primero lo protege un trigger, y las credenciales tienen su propio endpoint que las cifra
   * (§7.3). Un `...cuerpo` genérico habría dejado escribir un secreto en claro desde el
   * browser.
   */
  const parche: Record<string, unknown> = {};
  if (typeof cuerpo?.nombre === "string" && cuerpo.nombre.trim()) parche.nombre = cuerpo.nombre.trim();
  if (typeof cuerpo?.activa === "boolean") parche.activa = cuerpo.activa;
  if (typeof cuerpo?.zonaHoraria === "string") {
    if (!zonaValida(cuerpo.zonaHoraria)) {
      return res.status(400).json({ ok: false, codigo: "zona_invalida", error: `"${cuerpo.zonaHoraria}" no es una zona horaria válida.` });
    }
    parche.zona_horaria = cuerpo.zonaHoraria;
  }

  if (Object.keys(parche).length === 0) {
    return res.status(400).json({ ok: false, error: "No hay nada que cambiar." });
  }
  parche.actualizado_el = new Date().toISOString();

  const { error } = await dbSinScope().from("closer_org_config").update(parche).eq("org_id", orgId);

  if (error) {
    // Los triggers de la 018 son conflictos de negocio (409), no errores del servidor (500):
    // "la empresa principal no se puede desactivar" es una respuesta, no una caída.
    const codigo = traducirGuard(error.message);
    return res.status(codigo).json({
      ok: false,
      ...(codigo === 409 ? { codigo: "protegida" } : {}),
      error: error.message,
    });
  }

  // La caché de credenciales tiene un TTL de 60 s; cambiar la zona horaria o desactivar una
  // empresa tiene que verse YA, no en un minuto.
  olvidarCredenciales(orgId);

  await auditar("editar_empresa", { usuarioId: ctx.usuarioId, orgId, ip: ctx.ip, detalle: { campos: Object.keys(parche) } });
  return res.status(200).json({ ok: true });
}

/* ──────────────────────── Desactivar (baja lógica) ──────────────────────── */

/**
 * §7.1: *"La eliminación es lógica (`activa = false`) más un borrado real explícito y
 * separado"*. Este endpoint hace **solo la lógica**.
 *
 * El borrado real no está construido a propósito: con las FKs `on delete restrict` de la 022,
 * borrar una empresa con datos falla, y vaciarla antes es una operación destructiva que no
 * debería vivir detrás de un botón. Cuando haga falta, va a ser un procedimiento aparte y
 * pedido explícitamente, no una variante de este DELETE.
 */
async function desactivar(req: VercelRequest, res: VercelResponse, ctx: { usuarioId: string; ip: string | null }) {
  const orgId = String(req.query.orgId ?? leerCuerpo(req)?.orgId ?? "").trim();
  if (!orgId) return res.status(400).json({ ok: false, error: "Falta orgId." });

  const { error } = await dbSinScope()
    .from("closer_org_config")
    .update({ activa: false, actualizado_el: new Date().toISOString() })
    .eq("org_id", orgId);

  if (error) {
    // El trigger de la 018 impide desactivar la principal. Su mensaje ya está en castellano.
    return res.status(409).json({ ok: false, codigo: "protegida", error: error.message });
  }

  olvidarCredenciales(orgId);
  await auditar("editar_empresa", { usuarioId: ctx.usuarioId, orgId, ip: ctx.ip, detalle: { accion: "desactivar" } });
  return res.status(200).json({ ok: true, desactivada: true });
}

/* ─────────────────────────────── Piezas ─────────────────────────────── */

function zonaValida(zona: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zona });
    return true;
  } catch {
    return false;
  }
}

/** Los mensajes de los triggers de la 018 son conflictos de negocio, no errores del servidor. */
function traducirGuard(mensaje: string): number {
  return /no se puede (eliminar|desmarcar|desactivar)/i.test(mensaje) ? 409 : 500;
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
