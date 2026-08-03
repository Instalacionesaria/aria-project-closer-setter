/**
 * La píldora de situación, armada en un solo lugar.
 *
 * `CONTRATO-GHL.md` §0 es explícito sobre de quién es este trabajo: *"La píldora la ARMA
 * el tool: toma el stage (estado principal) + el custom field de la subcategoría del stage
 * actual"*. Kevin transporta los dos datos crudos y no concatena nada.
 *
 * Hoy la píldora se concatena a mano en seis puntos distintos de `ContactDrawer.tsx`, con
 * el resultado previsible: la semilla usa `"Seguimiento · Dudando"` y Avanzar produce
 * `"SEGUIMIENTO · DUDANDO"` para el mismo estado. Esta función es el único lugar donde se
 * decide el formato.
 *
 * Reglas que implementa (CLAUDE.md §12 / §39.3):
 *   - Formato `CATEGORÍA · SUBCATEGORÍA`, todo en mayúsculas.
 *   - La píldora es la situación REAL del contacto. Una condición temporal —vencido,
 *     estancado— es tinte de fila, NUNCA píldora.
 *   - Para el closer, un seguimiento siempre da `SEGUIMIENTO · {SITUACIÓN}`, sin importar
 *     si el modo fue automático o manual. La fecha del manual va en la segunda línea.
 *   - Sin subcategoría no se inventa una: queda solo la categoría (§4.10).
 *
 * Isomorfo: sin React, sin DOM, sin Node.
 */

import type { StageKey } from "./closerStore";

/** Etiqueta principal de la píldora, por stage del closer. */
const CATEGORIA_POR_STAGE: Readonly<Record<StageKey, string>> = {
  /** ⚠️ TEMPORAL — etapa de pruebas (Fabio, 2026-08-01). Se elimina junto con "limbo" en etapas.ts. */
  limbo: "LIMBO",
  agendado: "AGENDADO",
  seguimiento: "SEGUIMIENTO",
  cierre: "ACORDÓ COMPRAR",
  ganado: "VENTA",
  no_show: "NO-SHOW",
  nurture: "NURTURE",
  descalificado: "NO LE INTERESA",
};

const dinero = (n: number) => `$${n.toLocaleString("es-AR")}`;

export interface ArmarPildoraInput {
  stage: StageKey;
  /**
   * Valor crudo del custom field de subcategoría que corresponde al stage actual
   * (ver `CAMPO_SUBCATEGORIA_POR_STAGE` en `ghl/contrato.ts`). Ausente → píldora sin
   * subcategoría, que es lo correcto cuando GHL no tiene el dato.
   *
   * Para `ganado`, ese custom field es `formaPagoVenta` — o sea, la forma de pago ES la
   * subcategoría del stage, igual que la situación lo es para `seguimiento`.
   */
  subcategoria?: string | null;
  /** Solo para `ganado` y `cierre`: la plata que acompaña a la categoría. */
  monto?: number;
}

/**
 * `{ stage: "seguimiento", subcategoria: "Muy interesado" }` → `"SEGUIMIENTO · MUY INTERESADO"`.
 * `{ stage: "ganado", subcategoria: "Contado", monto: 100 }` → `"VENTA · CONTADO · $100"`.
 * `{ stage: "ganado", monto: 5000 }` → `"VENTA · $5.000"` (sin forma de pago conocida).
 * `{ stage: "nurture" }` → `"NURTURE"`.
 */
export function armarPildora({ stage, subcategoria, monto }: ArmarPildoraInput): string {
  const categoria = CATEGORIA_POR_STAGE[stage];
  const sub = subcategoria?.trim();

  // `ganado` es el único stage con TRES campos: categoría + forma de pago + monto.
  //
  // Antes esta rama devolvía `VENTA · $100` y trataba al monto como la subcategoría. Era
  // incoherente con `CAMPO_SUBCATEGORIA_POR_STAGE.ganado = "formaPagoVenta"` en
  // `ghl/contrato.ts`: el contrato ya decía que la subcategoría de `ganado` es la forma de
  // pago, no la plata. El modal de Venta pedía la forma de pago como campo OBLIGATORIO y
  // después la tiraba, así que el dato se capturaba y se perdía. Corregido con Francisco
  // el 2026-07-30.
  //
  // Los dos campos son opcionales por separado: un contacto traído de GHL puede tener la
  // forma de pago sin el monto, o al revés. Se muestra lo que haya, sin inventar (§4.10).
  if (stage === "ganado") {
    const partes = [categoria];
    if (sub) partes.push(sub.toUpperCase());
    if (typeof monto === "number") partes.push(dinero(monto));
    return partes.join(" · ");
  }

  // `cierre` sigue con dos campos: ahí el monto es una promesa, no un pago, y no hay forma
  // de pago que registrar todavía (§12: `ACORDÓ COMPRAR · $500`).
  if (stage === "cierre" && typeof monto === "number") {
    return `${categoria} · ${dinero(monto)}`;
  }

  return sub ? `${categoria} · ${sub.toUpperCase()}` : categoria;
}

/**
 * ⚠️ Divergencia conocida, sin resolver — no la toco acá porque cambiaría texto visible
 * fuera del alcance de Seguimientos.
 *
 * El stage `descalificado` produce la píldora `NO LE INTERESA · X` (es el nombre de la
 * tarjeta de Avanzar). Pero `CONTRATO-GHL.md` §4 dice que el campo `motivo_de_descalificacin`
 * pinta `DESCALIFICADO · X`, y `CLAUDE.md` §39.5 fijó "Descalificado" como el vocabulario
 * correcto. Encima la semilla usa una tercera variante, `NO INTERESADO · PRECIO`
 * (`ARIEL MENDEZ`, closerStore.tsx).
 *
 * Son tres strings para el mismo estado. Hay que elegir uno con Francisco; mi lectura es
 * que gana `DESCALIFICADO · X`, que es lo que dicen los dos documentos.
 */
export const PILDORA_DESCALIFICADO_PENDIENTE_DE_UNIFICAR = true;
