import { env } from "../env";
import type { GhlPort } from "./port";
import { ghlReal } from "./real";
import { ghlStub } from "./stub";

/**
 * Elige el adapter. El default es el stub: si alguien despliega sin configurar nada, el
 * sistema anota lo que habría hecho en vez de escribir en la cuenta real por accidente.
 *
 * Para pasar a `real` hacen falta las dos cosas — el modo Y las credenciales. Con
 * `GHL_MODO=real` pero sin token, la primera llamada explotaría en runtime; mejor quedarse
 * en stub, que registra la intención y no pierde nada.
 */
export function ghl(): GhlPort {
  return env.ghlModo() === "real" && env.tieneCredencialesGhl() ? ghlReal : ghlStub;
}

export type { GhlPort, ResultadoGhl, ContactoGhl } from "./port";
