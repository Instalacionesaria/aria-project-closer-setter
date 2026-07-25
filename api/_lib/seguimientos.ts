/**
 * Registrar un seguimiento: el caso de uso completo.
 *
 * Orden deliberado — primero SOFIA, después GHL:
 *
 *   1. Cierra el seguimiento abierto que hubiera (uno por contacto, lo garantiza el índice
 *      parcial único de la base).
 *   2. Inserta el nuevo.
 *   3. Escribe el evento en el historial.
 *   4. Recién ahí aplica los efectos en GHL.
 *
 * Si GHL falla en el paso 4, el seguimiento igual quedó registrado y la intención quedó en
 * el outbox — se reintenta. Al revés sería peor: un tag aplicado en GHL sin fila en la base
 * es un contacto que un workflow persigue y que nuestra cola no conoce.
 *
 * No es una transacción distribuida y no pretende serlo. Es "registrar primero, propagar
 * después", que para este dominio es la falla correcta.
 */

import {
  CAMPO_SUBCATEGORIA_POR_STAGE,
  CAMPOS,
  TAGS,
  TAGS_SEGUIMIENTO_EXCLUYENTES,
  assertEnviable,
  situacionPorSlug,
  type SituacionSeguimiento,
} from "../../src/lib/ghl/contrato";
import {
  DIAS_GRACIA_SERIE,
  SERIE_RECUPERO,
  resolverFechaObjetivo,
  type ModoSeguimiento,
  type PresetManual,
} from "../../src/lib/seguimientos/dominio";
import { env } from "./env";
import { ghl } from "./ghl";
import { ORG_ID, db } from "./repo";

const CLOSER_POR_DEFECTO = "00000000-0000-0000-0000-0000000000c1";

export interface RegistrarSeguimientoInput {
  ghlContactId: string;
  situacion: SituacionSeguimiento;
  modo: ModoSeguimiento;
  preset?: PresetManual;
  fechaPersonalizada?: string;
  nota?: string;
  idempotencyKey: string;
  closerId?: string;
}

export interface EfectoGhl {
  operacion: string;
  detalle: string;
  ok: boolean;
  aplicado: boolean;
  error?: string;
}

export interface ResultadoRegistro {
  seguimientoId: string;
  fechaObjetivo: string;
  reemplazo?: string;
  efectosGhl: EfectoGhl[];
  /** Texto para el toast. Se arma acá porque depende de la fecha que resolvió el servidor. */
  toast: string;
}

export async function registrarSeguimiento(input: RegistrarSeguimientoInput): Promise<ResultadoRegistro> {
  const closerId = input.closerId ?? CLOSER_POR_DEFECTO;
  const fechaObjetivo = resolverFechaObjetivo({ ...input, closerId });
  const ahora = new Date().toISOString();
  const esAutomatico = input.modo === "automatico";

  const situacionLabel = situacionPorSlug(input.situacion).label;
  const textoEvento = esAutomatico
    ? `Seguimiento automático · ${SERIE_RECUPERO.label}`
    : `Seguimiento manual · para el ${fechaObjetivo}`;

  /* ── 1. SOFIA, en una sola transacción ───────────────────────────────── */
  // Cerrar el anterior, crear el nuevo, escribir historial y completar la tarea del día son
  // cuatro escrituras. Hechas desde acá serían cuatro round trips sin transacción, y si la
  // creación fallara después de cerrar el anterior, el contacto se quedaría sin ningún
  // seguimiento en silencio. La función de Postgres las agrupa — ver 003_*.sql.
  const { data, error } = await db().rpc("closer_registrar_seguimiento", {
    p_ghl_contact_id: input.ghlContactId,
    p_closer_id: closerId,
    p_situacion: input.situacion,
    p_modo: input.modo,
    p_fecha_objetivo: fechaObjetivo,
    p_nota: input.nota ?? null,
    p_serie_key: esAutomatico ? SERIE_RECUPERO.key : null,
    p_serie_toques: esAutomatico ? SERIE_RECUPERO.toques : null,
    p_serie_dias: esAutomatico ? SERIE_RECUPERO.dias : null,
    p_texto_evento: textoEvento,
    p_autor_nombre: "Diego M.",
    p_org_id: ORG_ID,
  });

  if (error) throw new Error(`registrar seguimiento: ${error.message}`);

  const fila = Array.isArray(data) ? data[0] : data;
  const seguimientoId = fila?.seguimiento_id as string;
  const reemplazo = (fila?.reemplazo_id as string | null) ?? undefined;

  if (!seguimientoId) throw new Error("registrar seguimiento: la función no devolvió id");

  /* ── 2. Efectos en GHL ───────────────────────────────────────────────── */
  const efectos = await aplicarEfectosGhl({
    ghlContactId: input.ghlContactId,
    seguimientoId,
    situacionLabel,
    esAutomatico,
    idempotencyKey: input.idempotencyKey,
  });

  const toast = esAutomatico
    ? "Seguimiento automático activado"
    : `Seguimiento programado — ${fechaObjetivo}`;

  return { seguimientoId, fechaObjetivo, reemplazo, efectosGhl: efectos, toast };
}

/**
 * Los tres efectos, en orden de importancia:
 *   - Quitar los tags de seguimiento que hubiera (son mutuamente excluyentes: un contacto
 *     está en manual, o en una serie, o en ninguna — nunca en dos).
 *   - Aplicar el del modo elegido, más `seguimiento`, que es el que mueve el stage.
 *   - Escribir la situación en el custom field, que es lo que pinta la subcategoría.
 *
 * Ninguno interrumpe a los otros: si uno falla, se anota y se sigue. El resultado dice
 * exactamente qué se aplicó y qué no — el caller decide si eso es aceptable.
 */
async function aplicarEfectosGhl(args: {
  ghlContactId: string;
  seguimientoId: string;
  situacionLabel: string;
  esAutomatico: boolean;
  idempotencyKey: string;
}): Promise<EfectoGhl[]> {
  const cliente = ghl();
  const modoReal = env.ghlModo() === "real";
  const efectos: EfectoGhl[] = [];
  const base = { ghlContactId: args.ghlContactId, seguimientoId: args.seguimientoId };

  const tagModo = args.esAutomatico ? TAGS.seguimientoRecupero : TAGS.seguimientoManual;
  const aQuitar = TAGS_SEGUIMIENTO_EXCLUYENTES.map((k) => TAGS[k]).filter((t) => t.valor !== tagModo.valor);

  // Portón: un literal sin confirmar no sale nunca en modo real.
  for (const t of [tagModo, TAGS.seguimiento, ...aQuitar]) assertEnviable(t, modoReal);
  assertEnviable(CAMPOS.nivelInteresSeguimiento, modoReal);

  const anotar = (operacion: string, detalle: string, r: Awaited<ReturnType<typeof cliente.aplicarTags>>) =>
    efectos.push(
      r.ok
        ? { operacion, detalle, ok: true, aplicado: r.aplicado }
        : { operacion, detalle, ok: false, aplicado: false, error: r.error },
    );

  anotar(
    "remover_tag",
    aQuitar.map((t) => t.valor).join(", "),
    await cliente.removerTags({ ...base, tags: aQuitar.map((t) => t.valor), idempotencyKey: `${args.idempotencyKey}:quitar` }),
  );

  anotar(
    "aplicar_tag",
    [TAGS.seguimiento.valor, tagModo.valor].join(", "),
    await cliente.aplicarTags({
      ...base,
      tags: [TAGS.seguimiento.valor, tagModo.valor],
      idempotencyKey: `${args.idempotencyKey}:aplicar`,
    }),
  );

  anotar(
    "escribir_campo",
    `${CAMPOS.nivelInteresSeguimiento.valor} = ${args.situacionLabel}`,
    await cliente.escribirCampo({
      ...base,
      campo: CAMPOS.nivelInteresSeguimiento.valor,
      valor: args.situacionLabel,
      idempotencyKey: `${args.idempotencyKey}:campo`,
    }),
  );

  return efectos;
}

/** Lo que el módulo espera del catálogo de series — expuesto para el diagnóstico. */
export const CONFIG_SERIE = {
  ...SERIE_RECUPERO,
  diasGracia: DIAS_GRACIA_SERIE,
  stageSubcategoria: CAMPO_SUBCATEGORIA_POR_STAGE.seguimiento,
};
