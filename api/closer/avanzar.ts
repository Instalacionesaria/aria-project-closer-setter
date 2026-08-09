/**
 * `POST /api/closer/avanzar` — el único registro de resultados humanos (CLAUDE.md §4.12).
 *
 * Las SEIS salidas del closer entran por acá: Venta, Acordó comprar, Seguimiento, No le
 * interesa, No-show y Nurture. Hasta el 2026-07-30 solo estaba implementada Seguimiento y
 * las otras cinco devolvían 501; ahora todas se resuelven contra el mismo catálogo
 * (`src/lib/ghl/resultados.ts`), que declara para cada una su tag, su custom field y sus
 * opciones válidas.
 *
 * Este archivo hace tres cosas y ninguna más:
 *
 *   1. **Valida contra el catálogo.** Un `resultado` que no está en él es 400. Una
 *      subcategoría que no matchea EXACTO una opción del dropdown también es 400 — porque
 *      si la dejamos pasar, GHL responde 200 y no escribe nada, y nadie se entera.
 *   2. **Traduce la etiqueta de la UI al literal de GHL.** El front manda
 *      `"Avisó · quiere reagendar"`; GHL espera `"Avisó quiere reagendar"`. La traducción
 *      vive en `resolverSubcategoria()`, en un solo lugar.
 *   3. **Cuenta la verdad.** La respuesta dice, efecto por efecto, qué se aplicó y qué no.
 *      Si el tag entró pero el custom field falló, eso se ve; no se colapsa en un `ok: true`.
 *
 * El request manda la INTENCIÓN, nunca una fecha calculada por el browser
 * (`{ modo: "manual", preset: "en_3_dias" }`). El servidor la resuelve contra America/Lima.
 * Ese fue exactamente el bug de `isoInDays`: aritmética en la zona del cliente que después
 * de las 19:00 en Lima devolvía el día siguiente.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { SITUACIONES, situacionPorSlug, type SituacionSeguimiento } from "../../src/lib/ghl/contrato.js";
import {
  RESULTADOS,
  esResultadoValido,
  type ResultadoAvanzar,
  type ResultadoDef,
} from "../../src/lib/ghl/resultados.js";
import {
  SeguimientoInvalidoError,
  permiteSeguimientoAutomatico,
  type ModoSeguimiento,
  type PresetManual,
} from "../../src/lib/seguimientos/dominio.js";
import { ghl } from "../_lib/ghl/index.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";
import {
  registrarResultadoAvanzar,
  registrarSeguimiento,
  resolverSubcategoria,
  type EfectoGhl,
  type ResultadoSinSeguimiento,
} from "../_lib/seguimientos.js";

const PRESETS_VALIDOS: readonly string[] = ["manana", "en_3_dias", "una_semana", "personalizada"];
const SLUGS = SITUACIONES.map((s) => s.slug);

/**
 * `esResultadoValido()` resuelve con `v in RESULTADOS`, y `in` recorre la cadena de
 * prototipos: `"toString" in RESULTADOS` es `true`. Con ese body, la validación pasaría y
 * `RESULTADOS["toString"]` daría `undefined` — un 500 en vez de un 400.
 *
 * Se cruza con las claves PROPIAS, que son el conjunto real, y se conserva el helper del
 * catálogo para que el estrechamiento de tipo siga saliendo de ahí. No se toca
 * `resultados.ts`: lo está usando otro frente en paralelo.
 */
const CLAVES = Object.keys(RESULTADOS) as ResultadoAvanzar[];
const esResultado = (v: string): v is ResultadoAvanzar => CLAVES.includes(v as ResultadoAvanzar) && esResultadoValido(v);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Solo POST." });
  }

  const cuerpo = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (!cuerpo || typeof cuerpo !== "object") {
    return res.status(400).json({ ok: false, codigo: "cuerpo_invalido", error: "Cuerpo JSON inválido." });
  }

  const campos = cuerpo as Record<string, unknown>;
  const texto = (clave: string): string | undefined => {
    const v = campos[clave];
    return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
  };

  const ghlContactId = texto("ghlContactId");
  const idempotencyKey = texto("idempotencyKey");
  const nota = texto("nota");

  /* ── Validación común ── */
  if (!ghlContactId) return malo(res, "Falta ghlContactId.", "contacto_faltante");
  if (!idempotencyKey) return malo(res, "Falta idempotencyKey.", "idempotency_faltante");

  const resultadoCrudo = texto("resultado");
  if (!resultadoCrudo) {
    return malo(res, `Falta resultado. Esperado uno de: ${CLAVES.join(", ")}.`, "resultado_faltante");
  }
  if (!esResultado(resultadoCrudo)) {
    return malo(res, `Resultado inválido: "${resultadoCrudo}". Esperado uno de: ${CLAVES.join(", ")}.`, "resultado_invalido");
  }

  const resultado = resultadoCrudo;
  const def = RESULTADOS[resultado];

  try {
    if (resultado === "seguimiento") {
      return await registrarSalidaSeguimiento({ res, campos, texto, ghlContactId, idempotencyKey, nota, def, autor: ctx.nombre });
    }
    return await registrarOtraSalida({
      res,
      campos,
      texto,
      ghlContactId,
      idempotencyKey,
      nota,
      resultado: resultado as ResultadoSinSeguimiento,
      def,
      autor: ctx.nombre,
    });
  } catch (e) {
    if (e instanceof SeguimientoInvalidoError) return malo(res, e.message, e.codigo);
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/* ================================================================== */
/* Salida Seguimiento                                                  */
/* ================================================================== */

async function registrarSalidaSeguimiento(args: {
  res: VercelResponse;
  campos: Record<string, unknown>;
  texto: (clave: string) => string | undefined;
  ghlContactId: string;
  idempotencyKey: string;
  nota?: string;
  def: ResultadoDef;
  /** Quién lo registra: `ctx.nombre`. Explícito, para no volver a firmar con una constante. */
  autor: string;
}) {
  const { res, texto, ghlContactId, idempotencyKey, nota, def, autor } = args;

  const situacion = texto("situacion");
  const modo = texto("modo");
  const preset = texto("preset");
  const fechaPersonalizada = texto("fechaPersonalizada");

  if (!situacion || !SLUGS.includes(situacion as SituacionSeguimiento)) {
    return malo(res, `Situación inválida. Esperada una de: ${SLUGS.join(", ")}.`, "situacion_invalida");
  }
  if (modo !== "automatico" && modo !== "manual") {
    return malo(res, 'Modo inválido: "automatico" o "manual".', "modo_invalido");
  }
  if (modo === "manual" && (!preset || !PRESETS_VALIDOS.includes(preset))) {
    return malo(res, `Preset inválido. Esperado uno de: ${PRESETS_VALIDOS.join(", ")}.`, "preset_invalido");
  }

  /**
   * Instagram no tiene bot ni workflow (§11), así que ofrecer la serie automática sería
   * prometer mensajes que nadie va a enviar. Se valida acá además de ocultarlo en la UI:
   * la UI se puede saltar, el servidor no.
   */
  if (modo === "automatico") {
    const contacto = await ghl().obtenerContacto(ghlContactId);
    const canal = detectarCanal(contacto?.tags ?? []);
    if (canal && !permiteSeguimientoAutomatico(canal)) {
      return res.status(422).json({
        ok: false,
        codigo: "canal_sin_automatico",
        error: `El canal ${canal} no admite seguimiento automático todavía. Usá el modo manual.`,
      });
    }
  }

  const r = await registrarSeguimiento({
    // Quien lo registra es quien tiene la sesión, no un nombre fijo del código.
    autor,
    ghlContactId,
    situacion: situacion as SituacionSeguimiento,
    modo: modo as ModoSeguimiento,
    preset: preset as PresetManual | undefined,
    fechaPersonalizada,
    nota,
    idempotencyKey,
  });

  const situacionLabel = situacionPorSlug(situacion as SituacionSeguimiento).label;

  return res.status(200).json({
    ok: true,
    resultado: "seguimiento",
    stage: def.stage,
    pildora: armarPildora(def, situacionLabel),
    // La fecha del manual va en la 2ª línea de la fila, NUNCA en la píldora (§12/§39.3).
    seguimientoId: r.seguimientoId,
    fechaObjetivo: r.fechaObjetivo,
    reemplazo: r.reemplazo,
    // El ⏱ es derivado, nunca un campo escribible: se enciende solo con la serie corriendo.
    seguimientoAutomaticoActivo: modo === "automatico",
    toast: r.toast,
    ...resumen(r.efectosGhl),
  });
}

/* ================================================================== */
/* Las otras cinco salidas                                             */
/* ================================================================== */

async function registrarOtraSalida(args: {
  res: VercelResponse;
  campos: Record<string, unknown>;
  texto: (clave: string) => string | undefined;
  ghlContactId: string;
  idempotencyKey: string;
  nota?: string;
  resultado: ResultadoSinSeguimiento;
  def: ResultadoDef;
  autor: string;
}) {
  const { res, campos, texto, ghlContactId, idempotencyKey, nota, resultado, def, autor } = args;

  /* ── Monto ── */
  let monto: number | undefined;
  if (def.requiereMonto) {
    const crudo = campos.monto;
    monto = typeof crudo === "number" ? crudo : typeof crudo === "string" && crudo.trim() !== "" ? Number(crudo) : undefined;

    if (monto === undefined) {
      return malo(res, `La salida "${resultado}" exige monto.`, "monto_faltante");
    }
    if (!Number.isFinite(monto) || monto <= 0) {
      return malo(res, `Monto inválido: ${String(campos.monto)}. Tiene que ser un número mayor que cero.`, "monto_invalido");
    }
  }

  /* ── Subcategoría ── */
  // `subcategoria` es el nombre canónico. Se aceptan los tres alias con los que el front ya
  // nombra el dato en cada pantalla (`razon`, `formaPago`, `origen`) para que integrarlo no
  // dependa de renombrar variables — un 400 por un nombre de campo sería una fricción sin
  // ninguna contrapartida.
  let subcategoria: string | null = null;
  if (def.campo) {
    const crudo = texto("subcategoria") ?? texto("razon") ?? texto("formaPago") ?? texto("origen");
    if (!crudo) {
      return res.status(400).json({
        ok: false,
        codigo: "subcategoria_faltante",
        error: `La salida "${resultado}" exige subcategoría (campo "subcategoria").`,
        opciones: def.opciones,
      });
    }

    subcategoria = resolverSubcategoria(resultado, crudo);
    if (!subcategoria) {
      // 400 y no "lo mando igual": un valor que no matchea el dropdown hace que GHL
      // responda 200 sin escribir nada. Es preferible un error visible a un éxito falso.
      return res.status(400).json({
        ok: false,
        codigo: "subcategoria_invalida",
        error: `"${crudo}" no es una opción válida de ${def.campo}. GHL aceptaría el PUT y no escribiría nada.`,
        recibido: crudo,
        opciones: def.opciones,
      });
    }
  }

  const pildora = armarPildora(def, subcategoria, monto);
  const { textoEvento, toast } = narrar(resultado, subcategoria, monto);

  const r = await registrarResultadoAvanzar({
    autor,
    ghlContactId,
    resultado,
    subcategoria,
    monto,
    nota,
    pildora,
    textoEvento,
    idempotencyKey,
  });

  return res.status(200).json({
    ok: true,
    resultado,
    stage: def.stage,
    pildora,
    toast,
    // Cancelación universal: cualquier resultado cierra el seguimiento abierto y apaga el ⏱.
    seguimientoAutomaticoActivo: false,
    seguimientoCancelado: r.seguimientoCancelado ?? null,
    ...(r.advertencias.length ? { advertencias: r.advertencias } : {}),
    ...resumen(r.efectosGhl),
  });
}

/* ================================================================== */
/* Presentación de la respuesta                                        */
/* ================================================================== */

/**
 * `CATEGORÍA · SUBCATEGORÍA · MONTO`, con la categoría que declara el catálogo.
 *
 * Se compone desde `categoriaPildora` y no desde `armarPildora()` de `src/lib/pildora.ts` a
 * propósito: son dos fuentes que hoy discrepan en un caso —`no_interesa` produce
 * `NO LE INTERESA` en el front y `DESCALIFICADO` en el catálogo— y el catálogo es el que
 * coincide con `CONTRATO-GHL.md` §4 y con el vocabulario fijado en §39.5. Queda anotado
 * para unificarlo con Fabio; mientras tanto, el backend dice lo que dice el contrato.
 *
 * La subcategoría es el valor REAL del custom field, no una versión recortada: la píldora de
 * un No-show sale `NO-SHOW · PLANTÓN SIN AVISO` y no `NO-SHOW · PLANTÓN`, porque es lo que
 * quedó escrito en GHL y lo que Gerencia va a leer.
 */
function armarPildora(def: ResultadoDef, subcategoria?: string | null, monto?: number): string {
  const partes = [def.categoriaPildora];
  if (subcategoria) partes.push(subcategoria.toUpperCase());
  if (typeof monto === "number") partes.push(dinero(monto));
  return partes.join(" · ");
}

const dinero = (n: number) => `$${n.toLocaleString("es-AR")}`;

/** El texto del Historial y el del toast. Mismos strings que ya usa el front (§16). */
function narrar(
  resultado: ResultadoSinSeguimiento,
  subcategoria: string | null,
  monto?: number,
): { textoEvento: string; toast: string } {
  switch (resultado) {
    case "venta":
      return {
        textoEvento: `Registró Venta — ${dinero(monto ?? 0)} (${subcategoria})`,
        toast: `Venta registrada — ${dinero(monto ?? 0)}`,
      };
    case "acordo":
      return {
        textoEvento: `Registró Acordó comprar, falta pago — seña ${dinero(monto ?? 0)}`,
        toast: `Acuerdo registrado — seña ${dinero(monto ?? 0)}`,
      };
    case "no_interesa":
      return { textoEvento: `Registró No le interesa — ${subcategoria}`, toast: "Prospecto descalificado" };
    case "no_show":
      return { textoEvento: `Registró No-show — ${subcategoria}`, toast: "No-show registrado" };
    case "nurture":
      return { textoEvento: `Registró Nurture — ${subcategoria}`, toast: "Nurture registrado" };
  }
}

/**
 * El bloque `ghl` de la respuesta. Existe para que sea imposible reportar como éxito algo
 * que no se aplicó (regla 4 / §50.5):
 *
 *   · `aplicado` — por operación: `true` aplicado, `false` intentado y fallado, `null` ni
 *     siquiera se intentó (esta salida no escribe campo, o no lleva monto).
 *   · `todoAplicado` — el atajo para la UI: ¿llegó TODO a GHL?
 *   · `advertencia` — la frase para mostrarle a un humano cuando la respuesta no es limpia.
 *
 * `ok: true` de arriba significa "el resultado quedó registrado en SOFIA", que es cierto
 * aunque GHL falle: la intención queda en el outbox y se reintenta. Lo que pasó en GHL se
 * lee acá, no en el `ok`.
 */
function resumen(efectos: EfectoGhl[]) {
  const de = (operacion: string): boolean | null => {
    const e = efectos.find((x) => x.operacion === operacion);
    return e ? e.aplicado : null;
  };

  const fallidos = efectos.filter((e) => !e.ok);
  const sinAplicar = efectos.filter((e) => e.ok && !e.aplicado);
  const modo = ghl().modo;

  return {
    aplicado: {
      tag: de("aplicar_tag"),
      tagsRemovidos: de("remover_tag"),
      campo: de("escribir_campo"),
      valorOportunidad: de("fijar_valor_oportunidad"),
    },
    ghl: {
      modo,
      todoAplicado: efectos.length > 0 && efectos.every((e) => e.ok && e.aplicado),
      efectos,
      ...(fallidos.length
        ? {
            advertencia:
              `${fallidos.length} de ${efectos.length} efecto(s) fallaron en GHL: ` +
              fallidos.map((f) => `${f.operacion} (${f.error ?? "sin detalle"})`).join(" · ") +
              ". El resultado quedó registrado y la intención en el outbox.",
          }
        : {}),
      /* En modo stub NO todos los efectos quedan en la cola de replay: los tags y el campo
         sí, pero el Opportunity Value no (el enum `operacion` de closer_ghl_outbox no tiene
         ese valor). Decir "se registraron" a secas hacía creer que había una cola pendiente
         con los montos, y no la hay. Se listan aparte los que se perdieron. */
      ...(sinAplicar.length && modo === "stub"
        ? (() => {
            const perdidos = efectos.filter((e) => e.aviso).map((e) => e.operacion);
            return {
              nota:
                "Adapter en modo stub: nada se aplicó en GHL. " +
                (perdidos.length
                  ? `La intención quedó en el outbox salvo para ${perdidos.join(", ")}, que NO se registró en ningún lado.`
                  : "La intención quedó registrada en el outbox."),
            };
          })()
        : {}),
    },
  };
}

/* ================================================================== */
/* Utilidades                                                          */
/* ================================================================== */

/** El canal sale de los tags de origen; sin tag reconocible no se asume nada (§4.10). */
function detectarCanal(tags: readonly string[]): string | undefined {
  const t = tags.map((x) => x.toLowerCase());
  if (t.some((x) => x.includes("instagram") || x === "ig")) return "instagram";
  if (t.includes("lead_meta_ads")) return "meta_ads";
  return undefined;
}

const malo = (res: VercelResponse, error: string, codigo: string) => res.status(400).json({ ok: false, codigo, error });

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
