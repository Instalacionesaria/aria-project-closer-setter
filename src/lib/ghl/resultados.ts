/**
 * Las 6 salidas de Avanzar (closer) → qué tag y qué custom field escribe cada una.
 *
 * Antes solo estaba implementada Seguimiento; las otras cinco devolvían 501. Este catálogo
 * es la tabla que faltaba, y está construido para que agregar una salida sea agregar una
 * entrada, no tocar la lógica.
 *
 * Regla de acumulación (`CONTRATO-GHL.md` §4): al escribir la subcategoría de un resultado
 * NO se borran las de resultados anteriores. Un contacto puede haber sido No-show en junio y
 * Venta en julio, y los dos campos quedan llenos — la píldora muestra solo el del stage
 * actual, el resto queda para Gerencia ("clientes que fueron no-show y luego compraron").
 *
 * El stage NO lo escribe el tool: lo mueve el workflow de GHL disparado por el tag (§3 del
 * contrato). Acá solo se declara a qué stage debería llegar, para poder pintar la píldora
 * sin esperar el webhook de vuelta.
 */

// La extensión `.js` es obligatoria, no cosmética: este módulo lo importan las funciones de
// `api/`, que corren como ESM nativo en Node y no resuelven un import relativo sin ella
// (CLAUDE.md §50.9). `tsc` no lo detecta —con `moduleResolution: "bundler"` es válido— y
// falla recién en runtime, con un FUNCTION_INVOCATION_FAILED que no dice qué módulo fue.
// Vite lo resuelve igual, así que el front no cambia.
import { CAMPOS, TAGS, type CampoKey, type Literal, type TagKey } from "./contrato.js";

export type ResultadoAvanzar = "venta" | "acordo" | "seguimiento" | "no_interesa" | "no_show" | "nurture";

export interface ResultadoDef {
  readonly key: ResultadoAvanzar;
  /** Tag que dispara el workflow. Es el que mueve el stage. */
  readonly tag: TagKey;
  /** StageKey del front al que llega el contacto. Optimista: lo confirma el webhook. */
  readonly stage: string;
  /**
   * Custom field donde va la subcategoría. `null` = este resultado no tiene subcategoría
   * (Acordó comprar solo lleva monto).
   */
  readonly campo: CampoKey | null;
  /** Valores válidos del dropdown en GHL. Vacío = campo de texto libre o sin campo. */
  readonly opciones: readonly string[];
  /** Exige monto para poder registrarse. */
  readonly requiereMonto: boolean;
  /** Categoría de la píldora (§12: CATEGORÍA · SUBCATEGORÍA). */
  readonly categoriaPildora: string;
}

/**
 * Las opciones son los valores LITERALES del dropdown de GHL, no etiquetas de UI. Están
 * tomadas del contrato §4. Si alguna no coincide exactamente con la del dropdown, la
 * escritura del campo falla en silencio — GHL devuelve 200 igual (§50.5).
 *
 * ⚠️ Sin verificar contra la cuenta: solo `nivel_de_inters_seguimiento` se comprobó valor
 * por valor el 2026-07-25. Los otros cuatro dropdowns existen pero sus opciones no se
 * listaron. `verificarOpciones()` en el diagnóstico lo chequea contra GHL en vivo.
 */
export const RESULTADOS: Readonly<Record<ResultadoAvanzar, ResultadoDef>> = {
  venta: {
    key: "venta",
    tag: "ventaGanada",
    stage: "ganado",
    campo: "formaPagoVenta",
    opciones: ["Contado", "Splitwise", "Buy Now Pay Later", "Cuotas"],
    requiereMonto: true,
    categoriaPildora: "VENTA",
  },

  acordo: {
    key: "acordo",
    tag: "adelantoGanado",
    // El contrato §3 lista un stage "Adelanto" separado de "Cierre en curso"; el front
    // tiene un solo `cierre`. Ver la discrepancia anotada en STAGE_GHL_A_FRONT.
    stage: "cierre",
    campo: null,
    opciones: [],
    requiereMonto: true,
    categoriaPildora: "ACORDÓ COMPRAR",
  },

  seguimiento: {
    key: "seguimiento",
    tag: "seguimiento",
    stage: "seguimiento",
    campo: "nivelInteresSeguimiento",
    opciones: ["Próximo a pagar", "Muy interesado", "Dudando", "Enfriándose", "Otro"],
    requiereMonto: false,
    categoriaPildora: "SEGUIMIENTO",
  },

  no_interesa: {
    key: "no_interesa",
    tag: "descalificado",
    stage: "descalificado",
    campo: "motivoDescalificacion",
    opciones: ["Precio", "No es el momento", "Competencia", "No califica", "Otro"],
    requiereMonto: false,
    // ⚠️ Tres nombres para el mismo estado, sin resolver: "NO LE INTERESA" (lo que produce
    // Avanzar hoy), "DESCALIFICADO" (contrato §4 y CLAUDE.md §39.5) y "NO INTERESADO" (la
    // semilla). Se usa el del contrato, que es el que coincide con el nombre del campo.
    categoriaPildora: "DESCALIFICADO",
  },

  no_show: {
    key: "no_show",
    tag: "noshow",
    stage: "no_show",
    campo: "razonNoshow",
    opciones: ["Avisó quiere reagendar", "Plantón sin aviso", "Falla técnica", "Datos incorrectos"],
    requiereMonto: false,
    categoriaPildora: "NO-SHOW",
  },

  nurture: {
    key: "nurture",
    tag: "nurtureAppflow",
    stage: "nurture",
    campo: "origenNurture",
    opciones: ["No-show", "Pidió tiempo", "Se enfrió"],
    requiereMonto: false,
    categoriaPildora: "NURTURE",
  },
};

/**
 * Propiedad propia, no `in`: el operador `in` recorre la cadena de prototipos, así que
 * `esResultadoValido("toString")` devolvía `true` y un body con `resultado: "constructor"`
 * pasaba la validación del endpoint para después no encontrar nada en el catálogo.
 *
 * Se usa `hasOwnProperty.call` y no `Object.hasOwn` porque el `lib` del proyecto es ES2020
 * y `hasOwn` llegó en ES2022 — subir el target por una línea traería cambios que nadie pidió.
 */
export const esResultadoValido = (v: string): v is ResultadoAvanzar =>
  Object.prototype.hasOwnProperty.call(RESULTADOS, v);

/** El tag y el campo de un resultado, ya resueltos a sus literales. */
export function literalesDe(r: ResultadoAvanzar): { tag: Literal; campo: Literal | null } {
  const def = RESULTADOS[r];
  return { tag: TAGS[def.tag], campo: def.campo ? CAMPOS[def.campo] : null };
}

/**
 * Los tags de resultado son mutuamente excluyentes entre sí — un contacto no puede estar
 * simultáneamente en Venta y en No-show. Registrar uno quita los otros cinco, igual que la
 * exclusión que ya existía entre los tags de seguimiento.
 *
 * `seguimiento` es la excepción: el contrato §9 aclara que "sirve pre y post call", así que
 * convive con los demás en vez de excluirlos. Lo que sí se limpia al registrar cualquier
 * otro resultado son los tags de MODO de seguimiento (`seguimiento_recupero`,
 * `seguimiento_manual`) — es la cancelación universal de §50.2.
 */
export const TAGS_RESULTADO_EXCLUYENTES: readonly TagKey[] = [
  "ventaGanada",
  "adelantoGanado",
  "descalificado",
  "noshow",
  "nurtureAppflow",
];
