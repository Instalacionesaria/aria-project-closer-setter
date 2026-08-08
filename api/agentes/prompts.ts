/**
 * `GET/POST /api/agentes/prompts` — el prompt de cada agente (ESPEC-AUDITOR §2).
 *
 * ── Es una MUDANZA, no una copia ──────────────────────────────────────
 *
 * Hasta el 2026-08-07 estos cuatro campos se editaban en Ajustes › Credenciales, con el mismo
 * `admin` que las claves de API. Se movieron acá y **allá dejaron de existir**: dos campos
 * editando el mismo dato es el patrón que este proyecto ya pagó caro. Un solo lugar de edición.
 *
 * La columna no se mueve: sigue en `closer_org_config.prompt_*`, por empresa.
 *
 * ── Por qué el rol cambia, y por qué se verifica acá ──────────────────
 *
 * Quien mantiene el prompt del agente en GHL es el **técnico**, no el administrador. Pedirle
 * `admin` para editar un prompt obliga a darle también acceso a las claves de API de la empresa —
 * el PIT de GHL, la key de Anthropic, el token de Meta—, que es exactamente lo que no queremos.
 *
 * `exigir(req, res, ["tecnico", "admin", "super_admin"])` corre en el backend. Esconder la pestaña
 * en la UI no es un permiso: el endpoint queda expuesto igual y cualquiera con una sesión lo
 * llama con `fetch`.
 *
 * ── El hash se recalcula, no se lee ───────────────────────────────────
 *
 * `prompt_*_hash` existe como columna y este endpoint la escribe, pero para MOSTRAR la versión se
 * recalcula sobre el texto. Es lo mismo que hace `promptAgente.ts`, y por el mismo motivo: si
 * alguien edita la columna del texto por fuera del panel, el hash guardado queda mintiendo y
 * "el prompt cambió desde que se detectó esto" deja de funcionar justo cuando más importa.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash } from "node:crypto";
import { exigir, type Contexto } from "../_lib/auth.js";
import { activar } from "../_lib/credenciales.js";
import { db } from "../_lib/repo.js";
import { _limpiarCachePrompt } from "../_lib/promptAgente.js";
import { AUDITORES_ACTIVOS } from "../_lib/analizador.js";

/**
 * Los cuatro campos, y **quién los consume hoy**.
 *
 * `auditorId` es el agente de `AUDITORES_ACTIVOS` que lee ese prompt, o `null` si todavía no hay
 * auditor para él. Los tres que faltan lo dicen con todas las letras en vez de atenuarse como si
 * fueran un bug: un campo gris que nadie explica se lee como "está roto".
 */
const CAMPOS = [
  {
    clave: "promptAppointmentTexto",
    columna: "prompt_appointment_texto",
    agente: "Appointment Flow — chat (closer)",
    auditorId: "appointment-flow-ai" as const,
  },
  {
    clave: "promptLeadTexto",
    columna: "prompt_lead_texto",
    agente: "Lead Flow — chat (setter)",
    auditorId: "lead-flow-ai" as const,
  },
  {
    clave: "promptAppointmentVoz",
    columna: "prompt_appointment_voz",
    agente: "Appointment Flow — voz",
    auditorId: null,
  },
  {
    clave: "promptLeadVoz",
    columna: "prompt_lead_voz",
    agente: "Lead Flow — voz",
    auditorId: null,
  },
] as const;

/** Mismo hash que `promptAgente.ts`: 12 hex de un SHA-256. Es una versión, no una firma. */
function hashDe(texto: string): string {
  return createHash("sha256").update(texto, "utf8").digest("hex").slice(0, 12);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * El técnico entra; `admin` y `super_admin` por herencia. Verificado en el backend — ver el
   * comentario de arriba.
   */
  const ctx = await exigir(req, res, ["tecnico", "admin", "super_admin"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  if (req.method === "GET") return leer(res, ctx);
  if (req.method === "POST") return guardar(req, res, ctx);
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Usá GET o POST." });
}

async function leer(res: VercelResponse, ctx: Contexto) {
  const { data, error } = await db()
    .from("closer_org_config")
    .select(CAMPOS.map((c) => c.columna).join(", "))
    .maybeSingle();

  if (error) {
    return res.status(503).json({ ok: false, error: `No se pudo leer la configuración: ${error.message}` });
  }

  const fila = (data ?? {}) as Record<string, string | null>;

  return res.status(200).json({
    ok: true,
    empresa: { id: ctx.orgEfectiva, nombre: ctx.credenciales?.nombre ?? null },
    prompts: CAMPOS.map((c) => {
      const texto = fila[c.columna];
      return {
        clave: c.clave,
        agente: c.agente,
        // El texto viaja entero: no es un secreto, es lo que hay que poder editar.
        texto: texto ?? "",
        // Recalculado sobre el texto, no leído de la columna `*_hash`.
        hash: texto ? hashDe(texto) : null,
        lineas: texto ? texto.split("\n").length : 0,
        /**
         * `true` = hay un auditor consumiendo este prompt HOY. Los otros tres no están rotos:
         * su auditor todavía no existe, y la UI lo dice con esas palabras.
         */
        auditado: c.auditorId !== null && AUDITORES_ACTIVOS.includes(c.auditorId),
      };
    }),
  });
}

async function guardar(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const cuerpo = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) as
    | Record<string, unknown>
    | undefined;

  const parche: Record<string, string | null> = {};
  const tocados: string[] = [];

  for (const c of CAMPOS) {
    const valor = cuerpo?.[c.clave];
    if (typeof valor !== "string") continue;
    /**
     * Acá el vacío SÍ significa borrar, al revés que en las credenciales. Un prompt vacío es un
     * estado válido —el agente todavía no tiene uno cargado— y el auditor degrada limpio. La
     * diferencia con una credencial es que un prompt no se pierde para siempre por accidente:
     * está en GHL, de donde se copió.
     */
    const texto = valor.trim() || null;
    parche[c.columna] = texto;
    parche[`${c.columna}_hash`] = texto ? hashDe(texto) : null;
    tocados.push(c.clave);
  }

  if (tocados.length === 0) {
    return res.status(400).json({ ok: false, error: "No mandaste ningún prompt." });
  }

  const { error } = await db().from("closer_org_config").update(parche).eq("org_id", ctx.orgEfectiva);
  if (error) {
    return res.status(503).json({ ok: false, error: `No se pudo guardar: ${error.message}` });
  }

  /**
   * El caché de `promptAgente.ts` está indexado por empresa + agente y vive en el proceso. Sin
   * limpiarlo, esta instancia seguiría auditando con el texto viejo hasta que Vercel la reciclara
   * — y el panel diría "guardado". Guardar no requiere deploy, pero sí requiere esto.
   */
  _limpiarCachePrompt();

  return res.status(200).json({ ok: true, tocados });
}
