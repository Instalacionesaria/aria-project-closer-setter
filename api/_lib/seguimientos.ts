/**
 * Los resultados de Avanzar (closer): el caso de uso, para las SEIS salidas.
 *
 * Hasta el 2026-07-30 este módulo solo sabía de Seguimiento y las otras cinco devolvían 501.
 * Ahora la lógica es una sola y la diferencia entre salidas vive en el catálogo
 * (`src/lib/ghl/resultados.ts`): cada una declara su tag, su custom field de subcategoría,
 * sus opciones válidas y si exige monto. Agregar una salida es agregar una entrada, no
 * tocar este archivo.
 *
 * Orden deliberado — primero SOFIA, después GHL:
 *
 *   1. Se cierra el seguimiento abierto que hubiera.
 *   2. Se registra el resultado (fila nueva si es Seguimiento; evento e historial siempre).
 *   3. Recién ahí se aplican los efectos en GHL.
 *
 * Si GHL falla en el paso 3, el resultado igual quedó registrado y la intención quedó en el
 * outbox — se reintenta. Al revés sería peor: un tag aplicado en GHL sin fila en la base es
 * un contacto que un workflow persigue y que nuestra cola no conoce.
 *
 * No es una transacción distribuida y no pretende serlo. Es "registrar primero, propagar
 * después", que para este dominio es la falla correcta.
 */

import {
  CAMPO_SUBCATEGORIA_POR_STAGE,
  CAMPOS,
  TAGS,
  TAGS_BOT,
  TAGS_SEGUIMIENTO_EXCLUYENTES,
  assertEnviable,
  situacionPorSlug,
  type Literal,
  type SituacionSeguimiento,
} from "../../src/lib/ghl/contrato.js";
import { desenlaceDesdeTags } from "../../src/lib/ghl/etapas.js";
import { RESULTADOS, TAGS_RESULTADO_EXCLUYENTES, type ResultadoAvanzar } from "../../src/lib/ghl/resultados.js";
import {
  DIAS_GRACIA_SERIE,
  SERIE_RECUPERO,
  resolverFechaObjetivo,
  type ModoSeguimiento,
  type PresetManual,
} from "../../src/lib/seguimientos/dominio.js";
import { sincronizarContacto } from "./contactos.js";
import { env } from "./env.js";
import { ghl } from "./ghl/index.js";
import type { ResultadoGhl } from "./ghl/port.js";
import { db, hoyOrg, orgActiva } from "./repo.js";

const CLOSER_POR_DEFECTO = "00000000-0000-0000-0000-0000000000c1";
/** Un solo closer mientras `zona_closer` sea territorio y no asignación (§50.7). */
const AUTOR_POR_DEFECTO = "Jorge Q.";

/** Toda salida que NO es Seguimiento — no crea fila, solo cierra la que hubiera. */
export type ResultadoSinSeguimiento = Exclude<ResultadoAvanzar, "seguimiento">;

export interface EfectoGhl {
  operacion: string;
  detalle: string;
  ok: boolean;
  /** `true` solo si GHL lo confirmó. El stub siempre devuelve `false` (§4 del puerto). */
  aplicado: boolean;
  error?: string;
  /**
   * Lo que devolvió el adapter, cuando dice algo que el resumen no puede inferir.
   *
   * Existe por un caso concreto: en modo stub casi todas las operaciones quedan anotadas en
   * `closer_ghl_outbox` (una cola de replay real), pero `fijar_valor_oportunidad` NO —
   * `operacion` es un enum cerrado en la base y no tiene ese valor. Sin propagar esto, la
   * respuesta decía "los efectos se registraron pero no se aplicaron" y el operador asumía
   * que había una cola pendiente con los montos. No la hay: se pierden. Y es dinero.
   */
  aviso?: string;
}

/* ================================================================== */
/* Traducción de etiquetas de la UI a valores literales de GHL         */
/* ================================================================== */

/**
 * La UI escribe las subcategorías con separador tipográfico —`"Avisó · quiere reagendar"`—
 * y GHL espera el valor EXACTO de su dropdown —`"Avisó quiere reagendar"`—. Si no matchea
 * carácter por carácter, GHL devuelve **200 y no escribe nada**: el fallo más caro de esta
 * integración, porque no se nota.
 *
 * Por eso la traducción vive acá y en ningún otro lado, y por eso siempre se devuelve el
 * literal DEL CATÁLOGO, nunca el string que mandó el cliente: aunque venga con una tilde de
 * más o de menos, lo que sale hacia GHL es la opción declarada.
 *
 * Tres pasadas, de la más estricta a la más tolerante:
 *   1. Igualdad exacta contra `def.opciones`.
 *   2. Igualdad tras quitar los separadores `·`.
 *   3. Igualdad sin tildes ni mayúsculas, por si el front cambia una etiqueta.
 *
 * `null` = no matchea ninguna opción. El endpoint responde 400 con la lista, que es
 * infinitamente mejor que un 200 que no escribió nada.
 */
export function resolverSubcategoria(resultado: ResultadoAvanzar, valorUi: string): string | null {
  const opciones = RESULTADOS[resultado].opciones;
  if (opciones.length === 0) return null;

  const crudo = valorUi.trim();
  const sinSeparador = quitarSeparadores(crudo);

  const exacta = opciones.find((o) => o === crudo || o === sinSeparador);
  if (exacta) return exacta;

  const plano = aplanar(crudo);
  return opciones.find((o) => aplanar(o) === plano) ?? null;
}

/** `"Avisó · quiere reagendar"` → `"Avisó quiere reagendar"`. */
const quitarSeparadores = (v: string) =>
  v
    .replace(/\s*[·•]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Sin separadores, sin tildes y en minúsculas — solo para COMPARAR, nunca para enviar.
 * `NFD` parte la "ó" en "o" + acento combinante, y `\p{Diacritic}` se lleva el acento; se usa
 * la propiedad Unicode en vez de un rango literal para que el rango no viva en el código
 * fuente como caracteres invisibles pegados al corchete.
 */
const aplanar = (v: string) =>
  quitarSeparadores(v)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");

/* ================================================================== */
/* Efectos en GHL — el motor genérico de las 6 salidas                 */
/* ================================================================== */

export interface EfectosGhlInput {
  ghlContactId: string;
  resultado: ResultadoAvanzar;
  /** Valor YA resuelto contra `def.opciones` por `resolverSubcategoria`. */
  subcategoria?: string | null;
  /** Venta y Acordó comprar: va al Opportunity Value. */
  monto?: number;
  /** Solo Seguimiento: el tag del modo elegido, que convive con `seguimiento`. */
  tagModo?: Literal;
  seguimientoId?: string;
  idempotencyKey: string;
}

/**
 * Aplica CUALQUIERA de las seis salidas a partir de su definición del catálogo.
 *
 * Ningún efecto interrumpe a los otros: si uno falla se anota y se sigue. El resultado dice
 * exactamente qué se aplicó y qué no — el caller decide si eso es aceptable, y la respuesta
 * del endpoint lo muestra tal cual.
 */
export async function aplicarEfectosGhl(args: EfectosGhlInput): Promise<EfectoGhl[]> {
  const def = RESULTADOS[args.resultado];
  const cliente = ghl();
  const modoReal = env.ghlModo() === "real";
  const efectos: EfectoGhl[] = [];
  const base = { ghlContactId: args.ghlContactId, seguimientoId: args.seguimientoId };

  /**
   * Contacto congelado (§7 del doc de conexiones): perdió `zona_closer`, así que hacia GHL
   * es un cuerpo inerte — el Avanzar se registra COMPLETO del lado del tool (Supabase), pero
   * no viaja ni un tag. Se dice en el efecto en vez de omitirse, porque "no se aplicó nada"
   * sin motivo se lee como un fallo.
   *
   * ⚠️ La caché puede estar VIEJA (bug de Fabio Malpartida, 2026-08-03): el contacto se dio
   * de alta por su cita ANTES de que el workflow le aplicara `zona_closer`, quedó
   * `congelado: true`, y nada lo refrescó — así que su primer Avanzar registró todo en
   * Supabase y no mandó NI UN tag a GHL, en silencio. Por eso, antes de declarar inerte a
   * alguien, se le pregunta a GHL (1 llamada, SOLO en este camino excepcional): si el tag
   * está, el refresco lo descongela y los efectos siguen su curso normal.
   */
  const leerCongelado = async () => {
    const { data } = await db()
      .from("closer_contactos")
      .select("congelado")
      .eq("ghl_contact_id", args.ghlContactId)
      .maybeSingle();
    return data;
  };

  let fila = await leerCongelado();
  if (fila?.congelado && modoReal) {
    const refrescado = await sincronizarContacto(args.ghlContactId).catch(() => false);
    if (refrescado) fila = await leerCongelado();
  }
  if (fila?.congelado) {
    return [
      {
        operacion: "omitido_congelado",
        detalle:
          "El contacto no tiene zona_closer en GHL (verificado recién, no solo caché): se registró " +
          "en el tool, sin mandar nada a GHL (§7).",
        ok: true,
        aplicado: false,
      },
    ];
  }

  const tagResultado = TAGS[def.tag];
  const aAplicar: Literal[] = args.tagModo ? [tagResultado, args.tagModo] : [tagResultado];

  /**
   * La regla del bot post-call (doc §8.6): TODA salida de Avanzar menos No-show demuestra
   * que el contacto ya conversó con el closer → se manda `bot_desactivado_postcall` y el
   * chatbot muere. No-show es la excepción: su workflow de recuperación NECESITA al bot
   * trabajando, así que no solo no se manda — se QUITA si quedó de un resultado anterior
   * (espejo del §34 del front: no_show → bot activo).
   */
  if (args.resultado !== "no_show") {
    aAplicar.push(TAGS_BOT.botDesactivadoPostcall);
  }

  const aQuitar = tagsAQuitar(args.resultado, args.tagModo);
  if (args.resultado === "no_show") {
    aQuitar.push(TAGS_BOT.botDesactivadoPostcall);
  }

  const campo = def.campo ? CAMPOS[def.campo] : null;

  // Portón: un literal sin confirmar no sale nunca en modo real.
  for (const t of [...aAplicar, ...aQuitar]) assertEnviable(t, modoReal);
  if (campo) assertEnviable(campo, modoReal);

  const anotar = (operacion: string, detalle: string, r: ResultadoGhl) => {
    if (!r.ok) {
      efectos.push({ operacion, detalle, ok: false, aplicado: false, error: r.error });
      return;
    }
    // El adapter puede dejar un aviso en `detalle` que el resumen no puede deducir solo con
    // `ok`/`aplicado` — el caso real es el stub avisando que esta operación NO quedó en el
    // outbox. Se propaga en vez de descartarse.
    const d = r.detalle as Record<string, unknown> | undefined;
    const aviso = typeof d?.aviso === "string" ? d.aviso : typeof d?.sinOutbox === "string" ? d.sinOutbox : undefined;
    efectos.push({ operacion, detalle, ok: true, aplicado: r.aplicado, ...(aviso ? { aviso } : {}) });
  };

  if (aQuitar.length > 0) {
    anotar(
      "remover_tag",
      aQuitar.map((t) => t.valor).join(", "),
      await cliente.removerTags({
        ...base,
        tags: aQuitar.map((t) => t.valor),
        idempotencyKey: `${args.idempotencyKey}:quitar`,
      }),
    );
  }

  anotar(
    "aplicar_tag",
    aAplicar.map((t) => t.valor).join(", "),
    await cliente.aplicarTags({
      ...base,
      tags: aAplicar.map((t) => t.valor),
      idempotencyKey: `${args.idempotencyKey}:aplicar`,
    }),
  );

  // Sin campo declarado (Acordó comprar) o sin valor no hay nada que escribir. Que el valor
  // exista cuando el catálogo lo exige lo garantiza la validación del endpoint.
  if (campo && args.subcategoria) {
    anotar(
      "escribir_campo",
      `${campo.valor} = ${args.subcategoria}`,
      await cliente.escribirCampo({
        ...base,
        campo: campo.valor,
        valor: args.subcategoria,
        idempotencyKey: `${args.idempotencyKey}:campo`,
      }),
    );
  }

  /**
   * El monto no es un custom field: es el **Opportunity Value** de la oportunidad del
   * contacto — lo que después alimenta Cash Collected y las métricas de Gerencia.
   *
   * **Solo lo escribe Venta** (regla de Fabio, 2026-07-30). Antes el gate era
   * `def.requiereMonto`, que también es `true` en "Acordó comprar", así que una seña de $500
   * pisaba el Opportunity Value con un valor que no es una venta. El Opportunity Value
   * representa plata cobrada: una promesa de pago no tiene por qué moverlo.
   *
   * `requiereMonto` sigue existiendo pero significa otra cosa — que la UI y el endpoint
   * exigen un monto para esa salida— y por eso ya no sirve como gate acá. La seña de un
   * acuerdo se guarda igual del lado del tool (`closer_notas` y el evento del Historial), no
   * en GHL.
   *
   * Es el único efecto que puede fallar por una razón de negocio y no técnica: si el contacto
   * no tiene exactamente una oportunidad abierta en GHL, el puerto devuelve `ok: false` con
   * el motivo en vez de escribir sobre el trato equivocado. Ese error llega tal cual a la
   * respuesta — el tag y la subcategoría se aplicaron, el monto no, y eso se dice.
   */
  if (args.resultado === "venta" && typeof args.monto === "number") {
    anotar(
      "fijar_valor_oportunidad",
      `Opportunity Value = ${args.monto} (ganada)`,
      await cliente.fijarValorOportunidad({
        ...base,
        monto: args.monto,
        ganada: true,
        idempotencyKey: `${args.idempotencyKey}:valor`,
      }),
    );
  }

  return efectos;
}

/**
 * Qué tags se quitan al registrar cada salida. Son dos reglas distintas:
 *
 * **Seguimiento** — exclusión entre MODOS: un contacto está en manual, o en una serie, o en
 * ninguna, nunca en dos. No toca los tags de los otros resultados: el contrato §9 aclara que
 * `seguimiento` "sirve pre y post call", así que convive con ellos.
 *
 * **Las otras cinco** — exclusión entre RESULTADOS (no se puede estar en Venta y en No-show
 * a la vez) **más la cancelación universal**: se quitan `seguimiento_recupero` y
 * `seguimiento_manual` sí o sí. Sin eso, registrar un No-show sobre un contacto con serie
 * activa deja el tag puesto y el workflow de GHL sigue persiguiendo a alguien ya resuelto.
 *
 * Las series del setter (`seguimiento_para_agendar`, `seguimiento_decision_lt`) se dejan
 * intactas a propósito: desde el territorio del closer son de solo lectura (ver su `uso` en
 * `contrato.ts`), y pisarlas sería resolverle la cola a otro rol.
 */
function tagsAQuitar(resultado: ResultadoAvanzar, tagModo?: Literal): Literal[] {
  if (resultado === "seguimiento") {
    return TAGS_SEGUIMIENTO_EXCLUYENTES.map((k) => TAGS[k]).filter((t) => t.valor !== tagModo?.valor);
  }

  const propio = TAGS[RESULTADOS[resultado].tag].valor;
  const otrosResultados = TAGS_RESULTADO_EXCLUYENTES.map((k) => TAGS[k]).filter((t) => t.valor !== propio);

  return [...otrosResultados, TAGS.seguimientoRecupero, TAGS.seguimientoManual];
}

/* ================================================================== */
/* Proyección — Supabase como fuente de verdad del stage y del dinero  */
/* ================================================================== */

/** Columna de `closer_contactos` donde vive la subcategoría de cada etapa. */
const COLUMNA_SUBCATEGORIA: Record<string, string> = {
  ganado: "forma_pago_venta",
  seguimiento: "nivel_interes_seguimiento",
  no_show: "razon_noshow",
  nurture: "origen_nurture",
  descalificado: "motivo_descalificacion",
};

export interface ProyeccionInput {
  ghlContactId: string;
  resultado: ResultadoAvanzar;
  subcategoria?: string | null;
  monto?: number;
  nota?: string;
  /** Contexto extra de la salida (modo/fecha del seguimiento, tipo de pago...). */
  detalleExtra?: Record<string, unknown>;
  /** Los tags que viajaron a GHL, para el registro inmutable. */
  tagsEnviados: string[];
}

/**
 * La proyección de CADA uso de Avanzar (doc §1/§8.3):
 *
 *   1. Fila en `closer_avances` — el timeline inmutable del que el dashboard de Inicio
 *      CALCULA cash collected y ventas por query. Nunca contadores sueltos.
 *   2. `closer_contactos.stage_key` — desde acá, la fuente de verdad del stage es Supabase:
 *      GHL recibe tags para sus workflows pero nunca vuelve a pisar la etapa. El refresco de
 *      contacto (`sincronizarContacto`) no escribe stage_key a propósito.
 *
 * Se llama DESPUÉS de que el registro principal quedó firme y ANTES de los efectos GHL: si
 * GHL falla, la proyección ya está; si esto falla, se anota como advertencia — no puede
 * impedir registrar una venta.
 */
export async function proyectarAvance(input: ProyeccionInput): Promise<string[]> {
  const advertencias: string[] = [];

  const { error: errAvance } = await db()
    .from("closer_avances")
    .insert({
      ghl_contact_id: input.ghlContactId,
      salida: input.resultado,
      detalle: {
        ...(input.subcategoria ? { subcategoria: input.subcategoria } : {}),
        ...(typeof input.monto === "number" ? { monto: input.monto } : {}),
        ...(input.nota?.trim() ? { nota: input.nota.trim() } : {}),
        ...(input.detalleExtra ?? {}),
      },
      tags_enviados: input.tagsEnviados,
    });
  if (errAvance) advertencias.push(`closer_avances: ${errAvance.message}`);

  // La etapa se deriva del MISMO tag que viaja a GHL — la única fuente coherente con lo que
  // el resto de las vistas derivan de tags. Un resultado siempre resuelve etapa.
  const etapa = desenlaceDesdeTags([TAGS[RESULTADOS[input.resultado].tag].valor])?.etapa;
  if (etapa) {
    const cambios: Record<string, unknown> = { stage_key: etapa };
    const columna = COLUMNA_SUBCATEGORIA[etapa];
    if (columna && input.subcategoria) cambios[columna] = input.subcategoria;
    if (input.resultado === "venta" && typeof input.monto === "number") cambios.monto = input.monto;

    const { error } = await db().from("closer_contactos").update(cambios).eq("ghl_contact_id", input.ghlContactId);
    if (error) advertencias.push(`closer_contactos.stage_key: ${error.message}`);
  }

  return advertencias;
}

/* ================================================================== */
/* Salida Seguimiento — crea fila, con su fecha y su serie             */
/* ================================================================== */

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
    p_autor_nombre: AUTOR_POR_DEFECTO,
    p_org_id: orgActiva(),
  });

  if (error) throw new Error(`registrar seguimiento: ${error.message}`);

  const fila = Array.isArray(data) ? data[0] : data;
  const seguimientoId = fila?.seguimiento_id as string;
  const reemplazo = (fila?.reemplazo_id as string | null) ?? undefined;

  if (!seguimientoId) throw new Error("registrar seguimiento: la función no devolvió id");

  /* ── 2. Proyección (timeline + stage en Supabase) ────────────────────── */
  const tagModo = esAutomatico ? TAGS.seguimientoRecupero : TAGS.seguimientoManual;
  await proyectarAvance({
    ghlContactId: input.ghlContactId,
    resultado: "seguimiento",
    subcategoria: situacionLabel,
    nota: input.nota,
    detalleExtra: { modo: input.modo, fecha_objetivo: fechaObjetivo },
    tagsEnviados: [TAGS.seguimiento.valor, tagModo.valor, TAGS_BOT.botDesactivadoPostcall.valor],
  });

  /* ── 3. Efectos en GHL ───────────────────────────────────────────────── */
  const efectos = await aplicarEfectosGhl({
    ghlContactId: input.ghlContactId,
    resultado: "seguimiento",
    subcategoria: situacionLabel,
    tagModo,
    seguimientoId,
    idempotencyKey: input.idempotencyKey,
  });

  const toast = esAutomatico ? "Seguimiento automático activado" : `Seguimiento programado — ${fechaObjetivo}`;

  return { seguimientoId, fechaObjetivo, reemplazo, efectosGhl: efectos, toast };
}

/* ================================================================== */
/* Las otras cinco salidas                                             */
/* ================================================================== */

export interface RegistrarResultadoInput {
  ghlContactId: string;
  resultado: ResultadoSinSeguimiento;
  /** Valor ya resuelto contra el catálogo. `null` = esta salida no escribe campo. */
  subcategoria?: string | null;
  monto?: number;
  nota?: string;
  /** Píldora ya compuesta. Va como contexto de la nota en el tab Notas (§3). */
  pildora: string;
  /** Texto exacto que se escribe en el Historial. */
  textoEvento: string;
  idempotencyKey: string;
  closerId?: string;
}

export interface ResultadoRegistroAvanzar {
  /** El seguimiento que cerró la cancelación universal, si había uno abierto. */
  seguimientoCancelado?: { id: string; modo: ModoSeguimiento; situacion: SituacionSeguimiento };
  efectosGhl: EfectoGhl[];
  /** Lo que falló sin ser fatal (la nota, la tarea del día). Se reporta, no se esconde. */
  advertencias: string[];
}

/**
 * Registra cualquier salida que no sea Seguimiento.
 *
 * Lo que hace, en orden, y por qué cada paso está donde está:
 *
 *   1. **Cancelación universal.** Cierra el seguimiento abierto con motivo `avanzar` y autor
 *      `Sistema` — el closer registró un resultado, no canceló un seguimiento a mano. Es lo
 *      que apaga el ⏱ y lo que evita que un trato ganado siga en la cola.
 *   2. **Historial.** `avanzar_registrado`, con autor real: esto lo hizo una persona.
 *   3. **Nota** al tab Notas, con la píldora como contexto (§3).
 *   4. **Tarea del día completada** — el closer ya trabajó a este contacto hoy, así que cae
 *      en "Completadas Hoy", igual que hace la RPC de Seguimiento.
 *   5. **Efectos en GHL.**
 *
 * Los pasos 1 y 2 lanzan si fallan: son EL registro, y sin ellos no hay nada que propagar.
 * Los pasos 3 y 4 son accesorios de la cola de trabajo — que falle la nota no puede impedir
 * registrar una venta, así que se anotan en `advertencias` y se sigue.
 *
 * No es atómico: son escrituras separadas desde Node, sin transacción. Meterlas en una
 * función de Postgres —como se hizo con Seguimiento en 003_*.sql— sería mejor, y hace falta
 * una migración para eso. Queda anotado, no disimulado.
 */
export async function registrarResultadoAvanzar(
  input: RegistrarResultadoInput,
): Promise<ResultadoRegistroAvanzar> {
  const closerId = input.closerId ?? CLOSER_POR_DEFECTO;
  const ahora = new Date().toISOString();
  const advertencias: string[] = [];

  /* ── 1. Cancelación universal ────────────────────────────────────────── */
  // El índice parcial único garantiza como mucho un seguimiento abierto por contacto, así
  // que `maybeSingle()` es exacto y no una apuesta.
  const { data: cerrado, error: errCerrar } = await db()
    .from("closer_seguimientos")
    .update({ estado: "cancelado", motivo_cierre: "avanzar", cerrado_el: ahora, cerrado_por: closerId })
    .eq("ghl_contact_id", input.ghlContactId)
    .in("estado", ["pendiente", "agotado"])
    .select("id, modo, situacion")
    .maybeSingle();

  if (errCerrar) throw new Error(`cancelar el seguimiento abierto: ${errCerrar.message}`);

  const seguimientoCancelado = cerrado
    ? { id: cerrado.id as string, modo: cerrado.modo as ModoSeguimiento, situacion: cerrado.situacion as SituacionSeguimiento }
    : undefined;

  if (seguimientoCancelado) {
    // Autor `Sistema`: nadie canceló este seguimiento, lo cerró la consecuencia de otro
    // resultado (§2 — los eventos automáticos llevan autor Sistema y no pasan por Avanzar).
    await registrarEvento({
      ghlContactId: input.ghlContactId,
      seguimientoId: seguimientoCancelado.id,
      tipo: "seguimiento_cancelado",
      texto: `Seguimiento cerrado automáticamente al registrar ${RESULTADOS[input.resultado].categoriaPildora}`,
      autor: { tipo: "sistema" },
      payload: { motivo: "avanzar", resultado: input.resultado },
    });
  }

  /* ── 2. Historial ────────────────────────────────────────────────────── */
  await registrarEvento({
    ghlContactId: input.ghlContactId,
    tipo: "avanzar_registrado",
    texto: input.textoEvento,
    autor: { tipo: "usuario", nombre: AUTOR_POR_DEFECTO, usuarioId: closerId },
    payload: {
      resultado: input.resultado,
      subcategoria: input.subcategoria ?? null,
      monto: input.monto ?? null,
      pildora: input.pildora,
    },
  });

  /* ── 3. Nota ─────────────────────────────────────────────────────────── */
  const nota = input.nota?.trim();
  if (nota) {
    const { error } = await db().from("closer_notas").insert({
      ghl_contact_id: input.ghlContactId,
      texto: nota,
      contexto: input.pildora,
      autor_nombre: AUTOR_POR_DEFECTO,
      autor_usuario_id: closerId,
    });
    if (error) advertencias.push(`La nota no se guardó: ${error.message}`);
  }

  /* ── 4. Tarea del día ────────────────────────────────────────────────── */
  // El día lo calcula Postgres, nunca Node: la sesión de Supabase corre en UTC y a las 20:00
  // de Lima daría el día siguiente. Si no se puede resolver, no se escribe un día inventado.
  const hoy = await hoyOrg();
  if (!hoy) {
    advertencias.push("No se pudo resolver el día de la organización: el contacto no se marcó como completado hoy.");
  } else {
    const { error } = await db()
      .from("closer_contacto_tarea")
      .upsert(
        {
          ghl_contact_id: input.ghlContactId,
          fijada: false,
          completada_dia: hoy,
          completada_el: ahora,
          completada_por: closerId,
          actualizado_el: ahora,
        },
        { onConflict: "ghl_contact_id" },
      );
    if (error) advertencias.push(`El contacto no se marcó como completado hoy: ${error.message}`);
  }

  /* ── 4.5 Proyección (timeline + stage en Supabase) ───────────────────── */
  const tagsEnviados = [
    TAGS[RESULTADOS[input.resultado].tag].valor,
    ...(input.resultado !== "no_show" ? [TAGS_BOT.botDesactivadoPostcall.valor] : []),
  ];
  advertencias.push(
    ...(await proyectarAvance({
      ghlContactId: input.ghlContactId,
      resultado: input.resultado,
      subcategoria: input.subcategoria,
      monto: input.monto,
      nota: input.nota,
      detalleExtra: { pildora: input.pildora },
      tagsEnviados,
    })),
  );

  /* ── 5. Efectos en GHL ───────────────────────────────────────────────── */
  const efectosGhl = await aplicarEfectosGhl({
    ghlContactId: input.ghlContactId,
    resultado: input.resultado,
    subcategoria: input.subcategoria,
    monto: input.monto,
    idempotencyKey: input.idempotencyKey,
  });

  return { seguimientoCancelado, efectosGhl, advertencias };
}

/**
 * Un evento del timeline. La tabla es append-only por trigger, así que esto es la única
 * forma de escribir historia — y el CHECK `sistema_se_llama_sistema` obliga a que el autor
 * `sistema` se llame literalmente "Sistema".
 */
async function registrarEvento(args: {
  ghlContactId: string;
  tipo: string;
  texto: string;
  seguimientoId?: string;
  autor: { tipo: "sistema" } | { tipo: "usuario"; nombre: string; usuarioId: string };
  payload?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await db()
    .from("closer_contacto_eventos")
    .insert({
      ghl_contact_id: args.ghlContactId,
      seguimiento_id: args.seguimientoId ?? null,
      tipo: args.tipo,
      texto: args.texto,
      autor_tipo: args.autor.tipo,
      autor_nombre: args.autor.tipo === "sistema" ? "Sistema" : args.autor.nombre,
      autor_usuario_id: args.autor.tipo === "usuario" ? args.autor.usuarioId : null,
      payload: args.payload ?? {},
    });

  if (error) throw new Error(`historial (${args.tipo}): ${error.message}`);
}

/** Lo que el módulo espera del catálogo de series — expuesto para el diagnóstico. */
export const CONFIG_SERIE = {
  ...SERIE_RECUPERO,
  diasGracia: DIAS_GRACIA_SERIE,
  stageSubcategoria: CAMPO_SUBCATEGORIA_POR_STAGE.seguimiento,
};
