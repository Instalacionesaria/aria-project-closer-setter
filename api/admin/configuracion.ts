/**
 * `GET/POST /api/admin/configuracion` — credenciales y prompts de una empresa (ESPEC §7.3).
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
import { createHash } from "node:crypto";
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
 */
const CREDENCIALES = [
  { clave: "ghlPit", columna: "ghl_pit_cifrado", cifrado: true, etiqueta: "Private Integration Token de GHL" },
  { clave: "ghlLocationId", columna: "ghl_location_id", cifrado: false, etiqueta: "Location ID de GHL" },
  { clave: "ghlWebhookSecret", columna: "ghl_webhook_secret", cifrado: false, etiqueta: "Secreto del webhook de GHL" },
  { clave: "anthropicKey", columna: "anthropic_key_cifrada", cifrado: true, etiqueta: "API key de Anthropic" },
  { clave: "assistableToken", columna: "assistable_token", cifrado: false, etiqueta: "Token del webhook de Assistable" },
  { clave: "assistableCuentaId", columna: "assistable_cuenta_id", cifrado: false, etiqueta: "Cuenta de Assistable" },
  { clave: "metaAdAccountId", columna: "meta_ad_account_id", cifrado: false, etiqueta: "Cuenta publicitaria de Meta" },
  { clave: "metaToken", columna: "meta_token_cifrado", cifrado: true, etiqueta: "Token de Meta" },
] as const;

/** Los cuatro prompts de §7.3. Reemplazan a `docs/prompts/<agente>.md`. */
const PROMPTS = [
  { clave: "promptAppointmentTexto", columna: "prompt_appointment_texto", agente: "Appointment Flow — chat (closer)" },
  { clave: "promptLeadTexto", columna: "prompt_lead_texto", agente: "Lead Flow — chat (setter)" },
  { clave: "promptAppointmentVoz", columna: "prompt_appointment_voz", agente: "Appointment Flow — voz" },
  { clave: "promptLeadVoz", columna: "prompt_lead_voz", agente: "Lead Flow — voz" },
] as const;

/** El `ghl_location_id` no es secreto pero tampoco hace falta mostrarlo entero. */
const CLARAS_VISIBLES = new Set(["ghlLocationId", "assistableCuentaId", "metaAdAccountId"]);

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
    "anthropic_modelo",
    "anthropic_thinking",
    ...CREDENCIALES.map((c) => c.columna),
    ...PROMPTS.map((p) => p.columna),
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

  const prompts = PROMPTS.map((p) => {
    const texto = fila[p.columna];
    return {
      clave: p.clave,
      agente: p.agente,
      // El texto del prompt SÍ viaja entero: no es un secreto, es lo que el cliente pegó y
      // tiene que poder editarlo. Lo que no viaja es ninguna credencial.
      texto: texto ?? "",
      hash: texto ? hashDe(texto) : null,
      lineas: texto ? texto.split("\n").length : 0,
    };
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
    auditor: {
      modelo: fila.anthropic_modelo ?? null,
      thinking: fila.anthropic_thinking ?? null,
      /** Lo que se usa si la empresa no define el suyo. La UI lo muestra como placeholder. */
      modeloPorDefecto: "claude-sonnet-5",
      thinkingPorDefecto: "high",
    },
    prompts,
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

  /* ── Prompts ── */
  for (const p of PROMPTS) {
    const valor = cuerpo?.[p.clave];
    if (typeof valor !== "string") continue;
    // Acá el vacío SÍ significa borrar: un prompt vacío es un estado válido —el agente todavía
    // no tiene uno cargado— y el auditor degrada limpio (§7.3). Es lo contrario que arriba, y
    // la diferencia es que un prompt no es un secreto que se pueda perder por accidente.
    const texto = valor.trim() || null;
    parche[p.columna] = texto;
    parche[`${p.columna}_hash`] = texto ? hashDe(texto) : null;
    tocadas.push(p.clave);
  }

  /* ── Modelo y esfuerzo del auditor ── */
  if (typeof cuerpo?.anthropicModelo === "string") {
    parche.anthropic_modelo = cuerpo.anthropicModelo.trim() || null;
    tocadas.push("anthropicModelo");
  }
  if (typeof cuerpo?.anthropicThinking === "string") {
    const t = cuerpo.anthropicThinking.trim();
    // El CHECK de la 018 lo rechazaría igual, pero acá el mensaje es útil: dice cuáles valen.
    if (t && !["low", "medium", "high"].includes(t)) {
      return res.status(400).json({ ok: false, codigo: "thinking_invalido", error: "El esfuerzo es low, medium o high." });
    }
    parche.anthropic_thinking = t || null;
    tocadas.push("anthropicThinking");
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

/**
 * El hash del prompt (§7.3). Se guarda junto al texto para poder avisar *"el prompt cambió
 * desde que se detectó este hallazgo"*.
 *
 * Se recorta a 12 caracteres: es un identificador de versión para mostrar, no una firma
 * criptográfica. Mismo criterio que el hash que hoy usa `promptAgente.ts`.
 */
function hashDe(texto: string): string {
  return createHash("sha256").update(texto).digest("hex").slice(0, 12);
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
