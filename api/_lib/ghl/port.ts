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

  obtenerContacto(ghlContactId: string): Promise<ContactoGhl | null>;

  /** Ids de los contactos que tienen un tag. Es cómo se descubre el territorio del closer. */
  buscarPorTag(tag: string, limite?: number): Promise<string[]>;

  /** Diagnóstico: ¿responde la cuenta? Devuelve los tags y campos que existen. */
  verificarConexion(): Promise<
    | { ok: true; locationId: string; tags: string[]; customFields: string[] }
    | { ok: false; error: string; status?: number }
  >;
}
