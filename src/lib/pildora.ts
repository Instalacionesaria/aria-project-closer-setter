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
   */
  subcategoria?: string | null;
  /** Solo para `ganado` y `cierre`: ahí el monto ES la subcategoría visible. */
  monto?: number;
}

/**
 * `{ stage: "seguimiento", subcategoria: "Muy interesado" }` → `"SEGUIMIENTO · MUY INTERESADO"`.
 * `{ stage: "ganado", monto: 5000 }` → `"VENTA · $5.000"`.
 * `{ stage: "nurture" }` → `"NURTURE"`.
 */
export function armarPildora({ stage, subcategoria, monto }: ArmarPildoraInput): string {
  const categoria = CATEGORIA_POR_STAGE[stage];

  // En estos dos stages la plata es la subcategoría — así lo produce Avanzar hoy y así lo
  // documenta §12 (`VENTA · $3.000`, `ACORDÓ COMPRAR · $500`).
  if ((stage === "ganado" || stage === "cierre") && typeof monto === "number") {
    return `${categoria} · ${dinero(monto)}`;
  }

  const sub = subcategoria?.trim();
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
