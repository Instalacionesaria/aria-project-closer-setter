/**
 * Los efectos en GHL de un Avanzar del **setter**.
 *
 * ── Por qué no se parametriza `aplicarEfectosGhl` ─────────────────────
 *
 * Era la salida obvia y es la equivocada. Las reglas del closer y las del setter no difieren en
 * un parámetro: difieren en el negocio, y la diferencia que lo decide es ésta:
 *
 * **El closer aplica `bot_desactivado_postcall` en TODA salida menos No-show**, porque cualquier
 * resultado suyo demuestra que el contacto ya tuvo su llamada de venta. El setter es **pre-agenda
 * por definición**: ninguna de sus cinco salidas prueba que hubo una call. Aplicar ese tag desde
 * acá mataría el chatbot de un lead que todavía está calificándose — y peor, en la salida
 * Seguimiento, que es justamente la que lo deja en manos del bot durante días.
 *
 * Bendecir esa regla con un `if (rol === "setter")` adentro de la función del closer habría
 * dejado las dos lógicas trenzadas en un archivo que ya tiene 700 líneas. Separadas, cada una
 * dice lo que hace.
 *
 * Lo que sí se comparte de verdad —el puerto, el tipo `EfectoGhl`, el portón de congelado— se usa
 * tal cual desde acá.
 */

import { db } from "../repo.js";
import { env } from "../env.js";
import { ghl } from "../ghl/index.js";
import { sincronizarContacto } from "../contactos.js";
import type { EfectoGhl } from "../seguimientos.js";
import type { ResultadoGhl } from "../ghl/port.js";
import { assertEnviable, CAMPOS, TAGS, type Literal } from "../../../src/lib/ghl/contrato.js";
import {
  RESULTADOS_SETTER,
  TAGS_SERIE_SETTER,
  type ResultadoSetter,
} from "../../../src/lib/ghl/resultadosSetter.js";

export interface EfectosSetterInput {
  ghlContactId: string;
  resultado: ResultadoSetter;
  /** Ya resuelto contra `def.opciones`. Solo viaja a GHL si la salida tiene `campo`. */
  subcategoria?: string | null;
  /** Solo Seguimiento: el tag de la serie elegida, que convive con `seguimiento`. */
  tagSerie?: Literal;
  seguimientoId?: string;
  idempotencyKey: string;
}

/**
 * Los tags de resultado del setter que son mutuamente excluyentes.
 *
 * Se arma del catálogo y no a mano: si mañana una salida gana un tag —`venta_lt` lo va a ganar
 * cuando Kevin lo cree— entra acá sola. Una lista paralela escrita a mano se olvidaría.
 */
function tagsDeResultadoSetter(): Literal[] {
  const vistos = new Set<string>();
  const salida: Literal[] = [];
  for (const def of Object.values(RESULTADOS_SETTER)) {
    if (!def.tag) continue;
    const t = TAGS[def.tag];
    if (vistos.has(t.valor)) continue;
    vistos.add(t.valor);
    salida.push(t);
  }
  return salida;
}

/**
 * Qué se le quita al contacto.
 *
 * **Toda salida cancela las series del setter.** Si el lead agendó, se descalificó o compró, que
 * le siga llegando "para agendar" durante cinco días es peor que no haber hecho nada — y esas
 * series las manda un workflow que no sabe nada de nuestro Avanzar.
 *
 * En Seguimiento se quitan las OTRAS series, no la propia: es la que se acaba de elegir.
 */
function tagsAQuitarSetter(resultado: ResultadoSetter, tagSerie?: Literal): Literal[] {
  const series = TAGS_SERIE_SETTER.map((k) => TAGS[k]).filter((t) => t.valor !== tagSerie?.valor);
  if (resultado === "seguimiento") return series;

  const propio = RESULTADOS_SETTER[resultado].tag;
  const propioValor = propio ? TAGS[propio].valor : null;
  const otros = tagsDeResultadoSetter().filter((t) => t.valor !== propioValor);
  return [...series, ...otros];
}

export async function aplicarEfectosSetter(args: EfectosSetterInput): Promise<EfectoGhl[]> {
  const def = RESULTADOS_SETTER[args.resultado];
  const cliente = ghl();
  const modoReal = env.ghlModo() === "real";
  const efectos: EfectoGhl[] = [];
  const base = { ghlContactId: args.ghlContactId, seguimientoId: args.seguimientoId };

  /**
   * El portón de congelado, con el mismo criterio que el closer pero **sobre su territorio**:
   * un contacto del setter congelado es el que perdió `zona_setter`. La columna `congelado` la
   * mantiene `sincronizarTerritorio()`, que desde el Bloque C barre los dos territorios.
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
          "El contacto no tiene su tag de territorio en GHL (verificado recién, no solo caché): " +
          "se registró en el tool, sin mandar nada a GHL.",
        ok: true,
        aplicado: false,
      },
    ];
  }

  /**
   * `def.tag` puede ser `null` — dos de las cinco salidas no tienen tag y eso es correcto, no un
   * agujero: `agendo` porque el swap de territorio lo hace el WF 04.1 de GHL cuando la cita
   * existe de verdad, y `venta_lt` porque todavía no hay literal para ella. Ver `resultadosSetter.ts`.
   *
   * Con `null` no se manda nada a GHL y **la salida se registra igual** en Supabase. Lo que no se
   * hace es mandar el tag más parecido para que "algo pase".
   */
  const aAplicar: Literal[] = [];
  if (def.tag) aAplicar.push(TAGS[def.tag]);
  if (args.tagSerie) aAplicar.push(args.tagSerie);

  const aQuitar = tagsAQuitarSetter(args.resultado, args.tagSerie);
  const campo = def.campo ? CAMPOS[def.campo] : null;

  // Portón: un literal sin confirmar no sale nunca en modo real.
  for (const t of [...aAplicar, ...aQuitar]) assertEnviable(t, modoReal);
  if (campo) assertEnviable(campo, modoReal);

  const anotar = (operacion: string, detalle: string, r: ResultadoGhl) => {
    if (!r.ok) {
      efectos.push({ operacion, detalle, ok: false, aplicado: false, error: r.error });
      return;
    }
    const d = r.detalle as Record<string, unknown> | undefined;
    const aviso = typeof d?.aviso === "string" ? d.aviso : typeof d?.sinOutbox === "string" ? d.sinOutbox : undefined;
    efectos.push({ operacion, detalle, ok: true, aplicado: r.aplicado, ...(aviso ? { aviso } : {}) });
  };

  if (aQuitar.length > 0) {
    anotar(
      "quitar_tags",
      aQuitar.map((t) => t.valor).join(", "),
      await cliente.removerTags({ ...base, tags: aQuitar.map((t) => t.valor), idempotencyKey: `${args.idempotencyKey}:quitar` }),
    );
  }

  if (aAplicar.length > 0) {
    anotar(
      "aplicar_tags",
      aAplicar.map((t) => t.valor).join(", "),
      await cliente.aplicarTags({ ...base, tags: aAplicar.map((t) => t.valor), idempotencyKey: `${args.idempotencyKey}:aplicar` }),
    );
  }

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
   * **No se toca el Opportunity Value**, aunque `venta_lt` lleve monto.
   *
   * El closer solo lo fija en `venta` —no en `acordo`— porque una seña pisaría el valor real del
   * trato. Un low-ticket del setter es peor: es una venta distinta y mucho menor sobre el mismo
   * contacto, y escribirla ahí destruiría el valor del high-ticket que el closer todavía puede
   * cerrar. El monto del LT vive en `closer_avances.detalle`, que es donde el cockpit lo lee.
   */

  return efectos;
}
