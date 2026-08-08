/**
 * `GET/POST /api/admin/configuracion` — las credenciales de una empresa (ESPEC §7.3).
 *
 * Los prompts de los agentes **ya no están acá**: se mudaron a `api/agentes/prompts.ts` el
 * 2026-08-07, con rol `tecnico` en vez de `admin`. Ver el comentario más abajo.
 *
 * ── La regla que gobierna este archivo ────────────────────────────────
 *
 * > *"Descifrado solo en memoria, en el momento de usar la credencial. **Nunca se devuelve al
 * > frontend, ni siquiera al super admin**."* (§5.1)
 *
 * Este endpoint **jamás** devuelve un secreto. Devuelve `••••••1234` — los últimos cuatro
 * caracteres, que alcanzan para reconocer cuál está cargada y no para reconstruirla. No hay
 * botón de "ver", y no lo hay porque no existe la ruta que lo alimentaría.
 *
 * ── Guardar es reemplazar ─────────────────────────────────────────────
 *
 * Un campo que llega vacío **no borra**: se ignora. Es lo que permite que el formulario mande
 * el objeto entero con las máscaras sin pisar las credenciales que nadie tocó. Para borrar una
 * hay que pedirlo explícitamente con `{ borrar: ["ghlPit"] }`.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auditar, exigir, type Contexto } from "../_lib/auth.js";
import { cifrar, descifrar, enmascarar, hayClaveMaestra } from "../_lib/cifrado.js";
import { activar, olvidarCredenciales } from "../_lib/credenciales.js";
import { dbSinScope } from "../_lib/db.js";

/**
 * El mapa entre el nombre que usa el frontend y la columna. Existe para que agregar una
 * credencial sea agregar una fila acá, y no tocar cuatro lugares.
 *
 * `cifrado: true` decide si el valor pasa por AES antes de guardarse. Ver el pie de
 * `cifrado.ts` para por qué los secretos compartidos van en claro.
 *
 * ── Los dos secretos de webhook se fueron de acá (2026-08-07) ──────────────
 *
 * `ghl_webhook_secret` y `assistable_token` estaban en esta lista, o sea que la UI se los **pedía
 * al cliente** como si fueran credenciales suyas. El cliente no tiene de dónde sacarlos, y un
 * campo que se puede dejar vacío se deja vacío — dejando la URL del webhook sin secreto, abierta
 * a que cualquiera inyecte eventos y dispare gasto de API.
 *
 * Ahora los genera `api/admin/webhooks.ts` y el cliente los copia. Las columnas siguen siendo las
 * mismas: lo que cambió es de qué lado nace el valor.
 */
const CREDENCIALES = [
  { clave: "ghlPit", columna: "ghl_pit_cifrado", cifrado: true, etiqueta: "Private Integration Token de GHL" },
  { clave: "ghlLocationId", columna: "ghl_location_id", cifrado: false, etiqueta: "Location ID de GHL" },
  /**
   * El calendario del que el cron lee las citas. **Sin él la empresa no sincroniza agenda**, así
   * que es tan obligatorio como el PIT para un cliente que use citas — y el cron lo reporta por
   * separado justamente para que se sepa cuál de los dos falta.
   */
  { clave: "ghlCalendarioId", columna: "ghl_calendario_id", cifrado: false, etiqueta: "Calendario de GHL" },
  { clave: "anthropicKey", columna: "anthropic_key_cifrada", cifrado: true, etiqueta: "API key de Anthropic" },
  { clave: "metaAdAccountId", columna: "meta_ad_account_id", cifrado: false, etiqueta: "Cuenta publicitaria de Meta" },
  { clave: "metaToken", columna: "meta_token_cifrado", cifrado: true, etiqueta: "Token de Meta" },
] as const;

/**
 * ── Los prompts se fueron de acá (2026-08-07) ──────────────────────────────
 *
 * Los cuatro campos `prompt_*` se editaban en este endpoint, con el mismo `admin` que las claves
 * de API. Se **mudaron** a `api/agentes/prompts.ts`, que habilita `tecnico`: quien mantiene el
 * prompt del agente es el técnico, y pedirle `admin` para eso obligaba a darle también acceso al
 * PIT de GHL, a la key de Anthropic y al token de Meta.
 *
 * Es una mudanza y no una copia: acá no quedó ni la lectura. Dos campos editando el mismo dato es
 * el patrón que este proyecto ya pagó caro.
 *
 * Las columnas NO se movieron: siguen en `closer_org_config.prompt_*`, por empresa.
 */
/** El `ghl_location_id` no es secreto pero tampoco hace falta mostrarlo entero. */
const CLARAS_VISIBLES = new Set(["ghlLocationId", "ghlCalendarioId", "metaAdAccountId"]);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.1: *"La configuración solo se toca desde `admin` o `super_admin`"*. Un técnico con rol
  // operativo no configura nada, ni siquiera para ver las máscaras.
  const ctx = await exigir(req, res, ["admin"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  if (req.method === "GET") return leer(req, res, ctx);
  if (req.method === "POST") return guardar(req, res, ctx);
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Usá GET o POST." });
}

/**
 * Qué empresa se está configurando.
 *
 * Un `admin` **siempre** la suya, aunque mande otra por query. El super admin puede pedir
 * otra explícitamente; si no la pide, la de su sesión.
 */
function empresaObjetivo(req: VercelRequest, ctx: Contexto): string {
  if (!ctx.esSuperAdmin) return ctx.orgPropia;
  const pedida = String(req.query.orgId ?? leerCuerpo(req)?.orgId ?? "").trim();
  return pedida || ctx.orgEfectiva;
}

/* ─────────────────────────────── Leer ─────────────────────────────── */

async function leer(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const orgId = empresaObjetivo(req, ctx);

  const columnas = [
    "org_id",
    "nombre",
    "slug",
    "es_principal",
    "activa",
    "zona_horaria",
    ...CREDENCIALES.map((c) => c.columna),
  ].join(", ");

  const { data, error } = await dbSinScope().from("closer_org_config").select(columnas).eq("org_id", orgId).maybeSingle();
  if (error) return res.status(500).json({ ok: false, error: error.message });
  if (!data) return res.status(404).json({ ok: false, error: "Esa empresa no existe." });

  const fila = data as unknown as Record<string, string | null>;

  /**
   * Enmascarar exige descifrar primero: los últimos 4 caracteres son los del secreto, no los
   * del blob. Se hace en memoria y el valor descifrado no sale de esta función.
   *
   * Si el descifrado falla —clave maestra rotada sin recargar credenciales— se dice
   * `"error"` en vez de `null`. `null` significa "no hay credencial cargada" y son dos
   * hechos distintos: uno se arregla cargándola, el otro revisando la clave maestra.
   */
  const credenciales = CREDENCIALES.map((c) => {
    const crudo = fila[c.columna];
    let estado: string | null;
    if (!crudo) estado = null;
    else if (!c.cifrado) estado = CLARAS_VISIBLES.has(c.clave) ? crudo : enmascarar(crudo);
    else {
      try {
        estado = enmascarar(descifrar(crudo));
      } catch {
        estado = "error";
      }
    }
    return { clave: c.clave, etiqueta: c.etiqueta, cifrado: c.cifrado, valor: estado, cargada: Boolean(crudo) };
  });

  return res.status(200).json({
    ok: true,
    empresa: {
      id: fila.org_id,
      nombre: fila.nombre,
      slug: fila.slug,
      esPrincipal: fila.es_principal as unknown as boolean,
      activa: fila.activa as unknown as boolean,
      zonaHoraria: fila.zona_horaria,
    },
    credenciales,
    /**
     * Sin clave maestra no se puede guardar nada cifrado. Se dice acá para que la UI
     * deshabilite el formulario con el motivo, en vez de dejar intentar y fallar al guardar.
     */
    puedeGuardarCifrado: hayClaveMaestra(),
  });
}

/* ─────────────────────────────── Guardar ─────────────────────────────── */

async function guardar(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const cuerpo = leerCuerpo(req);
  const orgId = empresaObjetivo(req, ctx);

  const parche: Record<string, unknown> = {};
  const tocadas: string[] = [];

  /* ── Credenciales ── */
  for (const c of CREDENCIALES) {
    const valor = cuerpo?.[c.clave];
    if (typeof valor !== "string") continue;
    const limpio = valor.trim();
    // Vacío = "no lo toqué". El formulario manda el objeto entero y las que nadie editó
    // llegan con su máscara o vacías; pisarlas con null borraría credenciales por accidente.
    if (!limpio) continue;
    // Una máscara devuelta tal cual tampoco se guarda: significa que el campo no se editó.
    if (limpio.startsWith("••")) continue;

    if (c.cifrado && !hayClaveMaestra()) {
      return res.status(503).json({
        ok: false,
        codigo: "sin_clave_maestra",
        error: "Falta CIFRADO_MASTER_KEY en el servidor: no se puede guardar una credencial cifrada.",
      });
    }
    parche[c.columna] = c.cifrado ? cifrar(limpio) : limpio;
    tocadas.push(c.clave);
  }

  /* ── Borrado explícito ── */
  const borrar = Array.isArray(cuerpo?.borrar) ? (cuerpo.borrar as string[]) : [];
  for (const clave of borrar) {
    const c = CREDENCIALES.find((x) => x.clave === clave);
    if (!c) continue;
    parche[c.columna] = null;
    tocadas.push(`${clave} (borrada)`);
  }

  if (Object.keys(parche).length === 0) {
    return res.status(400).json({ ok: false, error: "No hay nada que guardar." });
  }
  parche.actualizado_el = new Date().toISOString();

  const { error } = await dbSinScope().from("closer_org_config").update(parche).eq("org_id", orgId);
  if (error) {
    if (error.code === "23505") {
      return res.status(409).json({
        ok: false,
        codigo: "duplicado",
        error: "Ese Location ID de GHL ya está en uso por otra empresa. Dos empresas no pueden compartir subcuenta.",
      });
    }
    return res.status(500).json({ ok: false, error: error.message });
  }

  // La caché de credenciales tiene 60 s de TTL. Rotar un PIT filtrado tiene que tener efecto
  // ya, no dentro de un minuto.
  olvidarCredenciales(orgId);

  await auditar("rotar_credencial", {
    usuarioId: ctx.usuarioId,
    orgId,
    ip: ctx.ip,
    // QUÉ se tocó, nunca el valor — ni siquiera cifrado (§2.1).
    detalle: { campos: tocadas },
  });

  return res.status(200).json({ ok: true, guardadas: tocadas.length, campos: tocadas });
}

/* ─────────────────────────────── Piezas ─────────────────────────────── */

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
