/**
 * Adapter de GHL en modo stub: no llama a nadie, pero **no pierde la intención**.
 *
 * Un stub que solo hace `console.log` tira a la basura lo que el sistema quiso hacer. Si
 * se crean doscientos seguimientos antes de tener el token, no habría forma de aplicarlos
 * después. Acá cada operación es una fila en `closer_ghl_outbox` con estado
 * `omitido_stub` — o sea, una cola de replay.
 *
 * Devuelve siempre `aplicado: false`, para que ninguna capa de arriba pueda decirle al
 * usuario que se aplicó un tag que en realidad no se aplicó.
 */

import { registrarEnOutbox } from "../repo.js";
import type {
  CampoInput,
  ContactoGhl,
  GhlPort,
  NotaInput,
  OportunidadInput,
  ResultadoGhl,
  TagsInput,
} from "./port.js";

async function anotar(
  operacion: "aplicar_tag" | "remover_tag" | "escribir_campo",
  ghlContactId: string,
  args: Record<string, unknown>,
  idempotencyKey: string,
  seguimientoId?: string,
): Promise<ResultadoGhl> {
  try {
    await registrarEnOutbox({
      ghlContactId,
      seguimientoId,
      operacion,
      args,
      idempotencyKey,
      estado: "omitido_stub",
    });
    return { ok: true, aplicado: false, detalle: { anotadoEnOutbox: true } };
  } catch (e) {
    // Que falle el registro de la intención SÍ es un error: significa que la perdimos.
    return { ok: false, error: `No se pudo registrar en el outbox: ${(e as Error).message}`, reintentable: true };
  }
}

export const ghlStub: GhlPort = {
  modo: "stub",

  aplicarTags: ({ ghlContactId, tags, idempotencyKey, seguimientoId }: TagsInput) =>
    anotar("aplicar_tag", ghlContactId, { tags }, idempotencyKey, seguimientoId),

  removerTags: ({ ghlContactId, tags, idempotencyKey, seguimientoId }: TagsInput) =>
    anotar("remover_tag", ghlContactId, { tags }, idempotencyKey, seguimientoId),

  escribirCampo: ({ ghlContactId, campo, valor, idempotencyKey, seguimientoId }: CampoInput) =>
    anotar("escribir_campo", ghlContactId, { campo, valor }, idempotencyKey, seguimientoId),

  /**
   * Única operación que no pasa por el outbox: `operacion` es un enum cerrado y una nota no
   * dispara workflows, así que no hay efecto que reproducir. Ver el comentario en el puerto.
   */
  async escribirNota(_i: NotaInput): Promise<ResultadoGhl> {
    return { ok: true, aplicado: false, detalle: { omitido: "nota no registrada en modo stub" } };
  },

  /**
   * Segunda operación fuera del outbox, por el mismo motivo estructural que la nota:
   * `closer_ghl_outbox.operacion` es un enum cerrado en la base
   * (`aplicar_tag | remover_tag | escribir_campo | mover_stage`, ver `docs/db/001_seguimientos.sql`)
   * y no tiene un valor para esto. Insertar uno inventado no "queda pendiente": la check
   * constraint lo rechaza, `registrarEnOutbox` lanza, y el stub devolvería `ok: false` —
   * o sea, una operación que en modo stub no debería fallar pasaría a romper el registro
   * de la venta entera. Se elige el camino que no rompe.
   *
   * **Pero acá sí se pierde algo.** Una nota es descriptiva y no dispara nada (por eso su
   * omisión es inocua); un Opportunity Value es dinero, y es exactamente el tipo de efecto
   * que el outbox existe para poder reproducir. Hasta que una migración agregue
   * `fijar_valor_oportunidad` al enum, en modo stub el monto NO queda anotado en ningún
   * lado: se dice en el `detalle` para que ningún caller lo interprete como diferido.
   */
  async fijarValorOportunidad(_i: OportunidadInput): Promise<ResultadoGhl> {
    return {
      ok: true,
      aplicado: false,
      detalle: {
        omitido: "valor de oportunidad no aplicado en modo stub",
        sinOutbox:
          "la operación no existe en el enum de closer_ghl_outbox — la intención NO quedó registrada",
      },
    };
  },

  /**
   * Sin GHL no hay de dónde sacar el contacto. Devolver `null` es lo honesto: cualquier
   * dato inventado acá terminaría pintado en la ficha como si fuera real.
   */
  async obtenerContacto(_ghlContactId: string): Promise<ContactoGhl | null> {
    return null;
  },

  /** Sin GHL no hay a quién buscar. Lista vacía, no una inventada. */
  async buscarPorTag(): Promise<string[]> {
    return [];
  },

  async verificarConexion() {
    return { ok: false, error: "Adapter en modo stub: no hay conexión con GHL (falta GHL_API_KEY o GHL_MODO=real)." };
  },
};
