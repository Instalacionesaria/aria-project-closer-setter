/**
 * La autoría de un mensaje, ya atada a la configuración del servidor.
 *
 * La decisión en sí vive en `src/lib/ghl/autoria.ts`, que es isomorfo y no sabe de variables
 * de entorno. Este módulo es la capa de una línea que le pasa las válvulas de `env` para que
 * ni la ingesta, ni el analizador, ni el diagnóstico tengan que acordarse de hacerlo — tres
 * llamadas con opciones distintas serían tres clasificaciones distintas del mismo mensaje.
 */

import { autorDeMensaje, type AutorMensaje, type SenalesMensaje } from "../../src/lib/ghl/autoria.js";
import type { MensajeGhl } from "./ghl/lectura.js";
import { env } from "./env.js";

/** El autor de un mensaje, con las válvulas `AUDITOR_FUENTES_IA` / `AUDITOR_USER_IDS_IA` aplicadas. */
export function autorConEnv(senales: SenalesMensaje): AutorMensaje {
  return autorDeMensaje(senales, {
    fuentesIa: env.auditorFuentesIa(),
    userIdsIa: env.auditorUserIdsIa(),
  });
}

/** Lo mismo, para un mensaje tal como lo devuelve la API de conversaciones de GHL. */
export function autorDeMensajeGhl(m: MensajeGhl): AutorMensaje {
  return autorConEnv({
    direccion: m.direction,
    source: m.source,
    userId: m.userId,
    messageType: m.messageType,
  });
}

export type { AutorMensaje, SenalesMensaje };
