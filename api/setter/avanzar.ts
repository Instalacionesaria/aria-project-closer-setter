/**
 * `POST /api/setter/avanzar` — las cinco salidas del Avanzar del setter.
 *
 * ⚠️ ESCRIBE EN GHL y en Supabase. Es el primer endpoint del setter que escribe algo: hasta hoy
 * `api/setter/` tenía un solo archivo, de solo lectura, y un Avanzar del setter era una mutación
 * de `useState` que moría al refrescar.
 *
 * ── Qué copia del closer y qué no ─────────────────────────────────────
 *
 * La estructura es la de `api/closer/avanzar.ts` a propósito: mismo portero, misma validación
 * contra catálogo, misma bifurcación Seguimiento / resto, mismo shape de respuesta. Donde el
 * closer ya resolvió algo, se replica en vez de reinventarlo.
 *
 * Lo que **no** comparte son los efectos en GHL (`aplicarEfectosSetter`), y el motivo está
 * escrito en ese archivo: el closer apaga el bot en toda salida porque cualquier resultado suyo
 * prueba que hubo una llamada de venta; el setter es pre-agenda y ninguna de sus salidas lo
 * prueba. Trenzar las dos reglas con un `if` habría sido peor que separarlas.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigir } from "../_lib/auth.js";
import { activar } from "../_lib/credenciales.js";
import { db } from "../_lib/repo.js";
import { proyectarAvance, registrarSeguimiento, type EfectoGhl } from "../_lib/seguimientos.js";
import { SeguimientoInvalidoError } from "../../src/lib/seguimientos/dominio.js";
import { aplicarEfectosSetter } from "../_lib/setter/efectos.js";
import { TAGS } from "../../src/lib/ghl/contrato.js";
import {
  esResultadoSetter,
  RESULTADOS_SETTER,
  SERIES_SETTER,
  type ResultadoSetter,
  type SerieSetter,
} from "../../src/lib/ghl/resultadosSetter.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["setter"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Solo POST." });
  }

  const cuerpo = (typeof req.body === "string" ? safeJson(req.body) : req.body) as Record<string, unknown> | null;
  if (!cuerpo) return res.status(400).json({ ok: false, codigo: "cuerpo_invalido", error: "Cuerpo JSON inválido." });

  const texto = (clave: string): string | undefined => {
    const v = cuerpo[clave];
    if (typeof v !== "string") return undefined;
    const t = v.trim();
    return t === "" ? undefined : t;
  };

  const ghlContactId = texto("ghlContactId");
  if (!ghlContactId) return res.status(400).json({ ok: false, codigo: "contacto_faltante", error: "Falta ghlContactId." });

  const idempotencyKey = texto("idempotencyKey");
  if (!idempotencyKey) {
    return res.status(400).json({ ok: false, codigo: "idempotency_faltante", error: "Falta idempotencyKey." });
  }

  const nota = texto("nota");
  const resultado = texto("resultado");
  if (!resultado) return res.status(400).json({ ok: false, codigo: "resultado_faltante", error: "Falta el resultado." });
  if (!esResultadoSetter(resultado)) {
    return res.status(400).json({
      ok: false,
      codigo: "resultado_invalido",
      error: `"${resultado}" no es una salida del setter.`,
      opciones: Object.keys(RESULTADOS_SETTER),
    });
  }

  try {
    if (resultado === "seguimiento") {
      return await salidaSeguimiento({ req, res, ctx, ghlContactId, idempotencyKey, nota, cuerpo, texto });
    }
    return await otraSalida({ res, ctx, ghlContactId, idempotencyKey, nota, resultado, cuerpo, texto });
  } catch (e) {
    if (e instanceof SeguimientoInvalidoError) {
      return res.status(400).json({ ok: false, codigo: e.codigo, error: e.message });
    }
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

type Ctx = { usuarioId: string; nombre: string };

/* ─────────────────────── Seguimiento ─────────────────────── */

/**
 * Reusa `registrarSeguimiento()` entero — la RPC transaccional que cierra el anterior, crea el
 * nuevo, escribe el historial y completa la tarea del día. Es la misma acción del negocio; lo
 * único propio del setter son sus dos series y el rol con el que se registra.
 */
async function salidaSeguimiento(a: {
  req: VercelRequest;
  res: VercelResponse;
  ctx: Ctx;
  ghlContactId: string;
  idempotencyKey: string;
  nota?: string;
  cuerpo: Record<string, unknown>;
  texto: (c: string) => string | undefined;
}) {
  const { res, ctx, ghlContactId, idempotencyKey, nota, texto } = a;

  const situacion = texto("situacion");
  if (!situacion) {
    return res.status(400).json({ ok: false, codigo: "situacion_faltante", error: "Falta la situación." });
  }

  const modo = texto("modo") ?? "manual";
  if (modo !== "automatico" && modo !== "manual") {
    return res.status(400).json({ ok: false, codigo: "modo_invalido", error: 'El modo es "automatico" o "manual".' });
  }

  /**
   * La serie solo aplica al modo automático, y **las del setter son las suyas**: `para_agendar`
   * (3 toques · 5 días) y `decision_lt` (2 · 3). Las del closer son otras y no se mezclan.
   */
  let serie: SerieSetter | undefined;
  if (modo === "automatico") {
    const pedida = texto("serie") ?? "para_agendar";
    if (!(pedida in SERIES_SETTER)) {
      return res.status(400).json({
        ok: false,
        codigo: "serie_invalida",
        error: `"${pedida}" no es una serie del setter.`,
        opciones: Object.keys(SERIES_SETTER),
      });
    }
    serie = pedida as SerieSetter;
  }

  const r = await registrarSeguimiento({
    rol: "setter",
    // El latch: el setter que trabaja el lead queda atribuido, y no se lo pisa el siguiente.
    atribucionSetterId: ctx.usuarioId,
    // Un setter tambien es "el usuario que registra": la columna se llama `closer_id` por historia.
    closerId: ctx.usuarioId,
    autor: ctx.nombre,
    ghlContactId,
    situacion: situacion as never,
    modo,
    preset: texto("preset") as never,
    fechaPersonalizada: texto("fechaPersonalizada"),
    nota,
    idempotencyKey,
  });

  const efectos = await aplicarEfectosSetter({
    ghlContactId,
    resultado: "seguimiento",
    subcategoria: situacion,
    tagSerie: serie ? TAGS[SERIES_SETTER[serie].tag] : undefined,
    seguimientoId: r.seguimientoId,
    idempotencyKey,
  });

  return res.status(200).json({
    ok: true,
    stage: RESULTADOS_SETTER.seguimiento.stage,
    seguimientoId: r.seguimientoId,
    fechaObjetivo: r.fechaObjetivo,
    reemplazo: r.reemplazo,
    toast: r.toast,
    ...resumen(efectos),
  });
}

/* ─────────────────────── Las otras cuatro ─────────────────────── */

async function otraSalida(a: {
  res: VercelResponse;
  ctx: Ctx;
  ghlContactId: string;
  idempotencyKey: string;
  nota?: string;
  resultado: Exclude<ResultadoSetter, "seguimiento">;
  cuerpo: Record<string, unknown>;
  texto: (c: string) => string | undefined;
}) {
  const { res, ctx, ghlContactId, idempotencyKey, nota, resultado, cuerpo, texto } = a;
  const def = RESULTADOS_SETTER[resultado];

  /* ── Monto ── */
  let monto: number | undefined;
  if (def.requiereMonto) {
    const crudo = cuerpo.monto;
    const n = typeof crudo === "number" ? crudo : typeof crudo === "string" ? Number(crudo) : NaN;
    if (crudo === undefined || crudo === null || crudo === "") {
      return res.status(400).json({ ok: false, codigo: "monto_faltante", error: "Esta salida necesita el monto." });
    }
    if (!Number.isFinite(n) || n <= 0) {
      return res.status(400).json({ ok: false, codigo: "monto_invalido", error: "El monto tiene que ser un número mayor a cero." });
    }
    monto = n;
  }

  /* ── Subcategoría ── */
  let subcategoria: string | undefined;
  if (def.opciones.length > 0) {
    // Se aceptan los alias que ya manda el frontend, igual que en el endpoint del closer.
    const pedida = texto("subcategoria") ?? texto("razon") ?? texto("formaPago") ?? texto("forma_pago");
    if (!pedida) {
      return res.status(400).json({
        ok: false,
        codigo: "subcategoria_faltante",
        error: "Esta salida necesita una subcategoría.",
        opciones: def.opciones,
      });
    }
    if (!def.opciones.includes(pedida)) {
      return res.status(400).json({
        ok: false,
        codigo: "subcategoria_invalida",
        error: `"${pedida}" no es una opción válida.`,
        recibido: pedida,
        opciones: def.opciones,
      });
    }
    subcategoria = pedida;
  }

  const pildora = [def.categoriaPildora, subcategoria, monto ? `$${monto.toLocaleString("es-PE")}` : null]
    .filter(Boolean)
    .join(" · ");

  /**
   * Se cancela el seguimiento abierto, si lo hay. Mismo criterio que el closer: cualquier salida
   * que no sea Seguimiento cierra el que estuviera vivo — el contacto ya avanzó a otra cosa.
   */
  const ahora = new Date().toISOString();
  const advertencias: string[] = [];
  const { error: errCerrar } = await db()
    .from("closer_seguimientos")
    .update({ estado: "cancelado", motivo_cierre: "avanzar", cerrado_el: ahora, cerrado_por: ctx.usuarioId })
    .eq("ghl_contact_id", ghlContactId)
    .in("estado", ["pendiente", "agotado"]);
  if (errCerrar) advertencias.push(`no se pudo cerrar el seguimiento abierto: ${errCerrar.message}`);

  /* ── La proyección: el avance, la etapa y el latch ── */
  advertencias.push(
    ...(await proyectarAvance({
      ghlContactId,
      rol: "setter",
      atribucionSetterId: ctx.usuarioId,
      resultado,
      subcategoria,
      monto,
      nota,
      detalleExtra: {
        pildora,
        // El producto del catálogo LT, cuando venga. No se valida contra una lista hardcodeada:
        // el catálogo es por empresa y vive en Ajustes › Operación.
        ...(texto("producto") ? { producto: texto("producto") } : {}),
        ...(texto("fecha") ? { fecha_acordada: texto("fecha") } : {}),
      },
      tagsEnviados: def.tag ? [TAGS[def.tag].valor] : [],
      autorUsuarioId: ctx.usuarioId,
    })),
  );

  const efectos = await aplicarEfectosSetter({
    ghlContactId,
    resultado,
    subcategoria,
    idempotencyKey,
  });

  return res.status(200).json({
    ok: true,
    stage: def.stage,
    pildora,
    ...(advertencias.length > 0 ? { advertencias } : {}),
    ...resumen(efectos),
  });
}

/* ─────────────────────── Helpers ─────────────────────── */

/**
 * El mismo shape que el resumen del closer: `aplicado` distingue `true` / `false` / `null`, donde
 * `null` es "ni se intentó". Nunca se colapsa en un `ok: true` que taparía un tag que no salió.
 */
function resumen(efectos: EfectoGhl[]) {
  const buscar = (op: string) => efectos.find((e) => e.operacion === op);
  const fallidos = efectos.filter((e) => !e.ok);
  const tag = buscar("aplicar_tags");
  const quitados = buscar("quitar_tags");
  const campo = buscar("escribir_campo");

  return {
    aplicado: {
      tag: tag ? tag.aplicado : null,
      tagsRemovidos: quitados ? quitados.aplicado : null,
      campo: campo ? campo.aplicado : null,
    },
    ghl: {
      todoAplicado: efectos.length > 0 && efectos.every((e) => e.ok && e.aplicado),
      efectos,
      ...(fallidos.length > 0
        ? { advertencia: `No se aplicó: ${fallidos.map((e) => `${e.operacion} (${e.error})`).join("; ")}` }
        : {}),
    },
  };
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
