/**
 * El puerto de Meta (ESPEC §9 · fase 7).
 *
 * Mismo patrón que `api/_lib/ghl/`: un puerto, dos adapters —real y stub— y el modo **deducido de
 * las credenciales**, no de una variable aparte. Se copia deliberadamente en vez de inventar otro
 * esquema: el de GHL ya resolvió el problema de "desplegar sin credenciales no debe escribir en la
 * cuenta de nadie", y dos formas distintas de hacer lo mismo en el mismo repo son dos formas de
 * mantener.
 *
 * ── Solo lectura ──────────────────────────────────────────────────────
 *
 * A diferencia del puerto de GHL, acá **no hay escrituras**. Fase 7 es "leer y mostrar", y el
 * puerto no expone nada más porque la superficie que no existe no se puede usar por accidente. El
 * día que haya que pausar un anuncio desde la plataforma, eso es una decisión de producto con su
 * propia conversación — no una función más en esta interfaz.
 */

/** Los cuatro niveles de la jerarquía de Meta que pide §9. */
export type NivelMeta = "cuenta" | "campana" | "adset" | "anuncio";

/**
 * Una fila de métricas tal como la vamos a guardar.
 *
 * **Todo lo numérico es `number | null`**, y el `null` significa "Meta no mandó el campo". Es lo
 * mismo que decide el esquema de la `026`: un anuncio sin video no trae retención, y un 0 ahí
 * afirmaría una medición que nadie hizo (§4.1).
 */
export interface MetricaMeta {
  nivel: NivelMeta;
  objetoId: string;
  nombre: string | null;
  /** De quién cuelga. `null` en el nivel cuenta. */
  padreId: string | null;
  /** La fecha del NEGOCIO (el día de Meta), en formato YYYY-MM-DD. */
  fecha: string;

  gasto: number | null;
  impresiones: number | null;
  clics: number | null;
  alcance: number | null;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  leads: number | null;
  cpl: number | null;

  videoReproducciones: number | null;
  video25: number | null;
  video50: number | null;
  video75: number | null;
  video100: number | null;
}

/**
 * El resultado de una sincronización.
 *
 * Trae `crudo` además de las filas mapeadas: quien llama lo guarda en `closer_meta_crudo` **antes**
 * de mapear (D15). Nadie de este equipo vio todavía una respuesta real de la Graph API de esta
 * cuenta, así que el mapeo de abajo es una apuesta informada y el crudo es el seguro.
 */
export interface ResultadoMeta {
  ok: boolean;
  /** Vacío si falló, o si de verdad no hubo actividad en el rango. Los dos casos se distinguen por `ok`. */
  metricas: MetricaMeta[];
  crudo: unknown;
  error?: string;
  /** `false` en el stub: la intención se registra y nada sale a la red. */
  real: boolean;
}

export interface MetaPort {
  readonly modo: "real" | "stub";
  /**
   * Las métricas de un nivel, día por día, entre dos fechas inclusive.
   *
   * El rango va explícito y no "los últimos N días" porque Meta **reajusta las cifras de los días
   * recientes** —las conversiones tardan en atribuirse— así que el colector necesita poder volver
   * a pedir una fecha ya sincronizada. Con la clave única de la `026`, repetir corrige en vez de
   * duplicar.
   */
  insights(opts: { nivel: NivelMeta; desde: string; hasta: string }): Promise<ResultadoMeta>;
}
