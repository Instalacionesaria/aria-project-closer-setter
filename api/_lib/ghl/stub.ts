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

import { registrarEnOutbox } from "../repo";
import type { CampoInput, ContactoGhl, GhlPort, ResultadoGhl, TagsInput } from "./port";

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
   * Sin GHL no hay de dónde sacar el contacto. Devolver `null` es lo honesto: cualquier
   * dato inventado acá terminaría pintado en la ficha como si fuera real.
   */
  async obtenerContacto(_ghlContactId: string): Promise<ContactoGhl | null> {
    return null;
  },

  async verificarConexion() {
    return { ok: false, error: "Adapter en modo stub: no hay conexión con GHL (falta GHL_API_KEY o GHL_MODO=real)." };
  },
};
