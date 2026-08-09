/**
 * El puerto de GoHighLevel. Dos implementaciones: `stub` (registra la intención) y
 * `real` (llama a la API v2).
 *
 * La clave del diseño es `aplicado: boolean` en el resultado. El stub devuelve
 * `{ ok: true, aplicado: false }` — la operación no falló, pero tampoco ocurrió. Así
 * ningún caller puede reportarle a la UI que aplicó un tag que en realidad no aplicó.
 * Es el mismo criterio de honestidad que el repo ya usa para los affordances de demo
 * (§30.B, §40.D de CLAUDE.md): cuando la capacidad real no existe, se dice, no se finge.
 */

export type ResultadoGhl =
  | { ok: true; aplicado: boolean; detalle?: unknown }
  | { ok: false; error: string; reintentable: boolean; status?: number };

export interface OperacionBase {
  ghlContactId: string;
  /** Para que un reintento no duplique el efecto ni la fila del outbox. */
  idempotencyKey: string;
  seguimientoId?: string;
}

export interface TagsInput extends OperacionBase {
  tags: string[];
}

export interface CampoInput extends OperacionBase {
  /** Unique key del custom field, ej. `contact.nivel_de_inters_seguimiento`. */
  campo: string;
  valor: string;
}

export interface NotaInput extends OperacionBase {
  /** Cuerpo de la nota. El analizador la prefija con `[IA]` para poder releerla después. */
  cuerpo: string;
}

export interface OportunidadInput extends OperacionBase {
  /** Monto que va al Opportunity Value, en la moneda de la subcuenta. Nunca negativo. */
  monto: number;
  /**
   * `true` cuando el monto viene de una Venta cerrada: además del valor, la oportunidad
   * pasa a `won`. Sin esto, un "Acordó comprar, falta pago" (§16.2) marcaría como ganado
   * un trato que todavía no se cobró.
   */
  ganada?: boolean;
}

export interface ContactoGhl {
  id: string;
  nombre: string;
  telefono?: string;
  email?: string;
  tags: string[];
  customFields: Record<string, string>;
}

export interface GhlPort {
  /** Modo activo — lo reporta el endpoint de diagnóstico. */
  readonly modo: "real" | "stub";

  aplicarTags(i: TagsInput): Promise<ResultadoGhl>;
  removerTags(i: TagsInput): Promise<ResultadoGhl>;
  escribirCampo(i: CampoInput): Promise<ResultadoGhl>;

  /**
   * Escribe una nota en el contacto. La usa el analizador para dejar el motivo del fallo,
   * que después lee `/api/closer/urgentes` para pintar la cola roja.
   *
   * A diferencia del resto, el stub NO la registra en el outbox: `operacion` es un enum
   * cerrado (`aplicar_tag | remover_tag | escribir_campo`) y ampliarlo pedía una migración.
   * Se puede omitir sin consecuencias porque una nota es descriptiva — no dispara ningún
   * workflow, así que no hay efecto que reproducir después. Igual devuelve `aplicado: false`.
   */
  escribirNota(i: NotaInput): Promise<ResultadoGhl>;

  /**
   * Fija el **Opportunity Value** de la oportunidad del contacto — el monto de una Venta
   * tiene que llegar ahí, no solo a un custom field (decisión de Fabio, 2026-07-30):
   * es el número con el que GHL arma sus propios reportes de pipeline.
   *
   * Es una operación idempotente por naturaleza: escribe un valor absoluto, no un delta,
   * así que reintentarla con el mismo monto deja el mismo resultado. `idempotencyKey`
   * viaja igual por `OperacionBase` para que el stub —y cualquier outbox futuro— puedan
   * deduplicar la intención sin tratar esta operación distinto del resto.
   *
   * **Requiere que el contacto YA tenga una oportunidad.** Crearla necesita `pipelineId` y
   * `stageId`, que este puerto no conoce; si no hay ninguna devuelve `ok: false` con el
   * motivo, nunca un éxito silencioso. El detalle de por qué está en `real.ts`.
   *
   * Igual que `escribirNota`, el stub NO la registra en el outbox: `operacion` es un enum
   * cerrado en la base y no incluye esta operación. Ver el comentario en `stub.ts`.
   */
  fijarValorOportunidad(i: OportunidadInput): Promise<ResultadoGhl>;

  obtenerContacto(ghlContactId: string): Promise<ContactoGhl | null>;

  /** Ids de los contactos que tienen un tag. Es cómo se descubre el territorio del closer. */
  buscarPorTag(tag: string, limite?: number): Promise<string[]>;

  /** Diagnóstico: ¿responde la cuenta? Devuelve los tags y campos que existen. */
  verificarConexion(): Promise<
    | { ok: true; locationId: string; tags: string[]; customFields: string[] }
    | { ok: false; error: string; status?: number }
  >;
}
