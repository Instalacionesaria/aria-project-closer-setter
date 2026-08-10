/**
 * Los eventos que entiende `POST /api/webhooks/ghl`, con su texto para el panel.
 *
 * ── Por qué existe este archivo ───────────────────────────────────────
 *
 * El handler tenía los 8 strings **dos veces** —el tipo `EventoGhl` y el array
 * `EVENTOS_CONOCIDOS`— sin ningún test que las comparara, y el panel de Ajustes › Webhooks
 * necesitaba una tercera copia para mostrar las 8 URLs completas. Tres listas del mismo hecho
 * divergen en silencio (regla 3 de `CLAUDE.md`): un noveno evento agregado al tipo y olvidado en
 * el array quedaría muerto detrás del guard del handler, y olvidado acá sería una URL que el
 * panel nunca ofrece.
 *
 * Ahora hay UNA: el handler deriva su tipo y su guard de este catálogo, el panel lo importa para
 * armar las URLs, y `eventosWebhook.test.ts` verifica contra el fuente del handler que cada
 * entrada tenga su `case` — la misma técnica de `enDesarrollo.test.ts` con `AUDITORES_ACTIVOS`.
 *
 * Isomorfo a propósito: sin React, sin Node, sin imports de `api/`. Lo cargan el browser (el
 * panel) y la función serverless (el handler), igual que `contrato.ts`.
 *
 * ── Las descripciones están verificadas contra el código, no contra la intención ──
 *
 * Cada `descripcion` dice lo que la rama del `switch` HACE hoy, revisado rama por rama el
 * 2026-08-10 (incluyendo lo que depende de otra cosa para notarse — está dicho, no suavizado).
 * Si una rama cambia, su texto se actualiza acá: es lo que lee el cliente al configurar.
 */

export interface EventoWebhookDef {
  /** El valor exacto del query param: `?evento=<esto>`. */
  readonly evento: string;
  /** Nombre corto para el panel. */
  readonly titulo: string;
  /** Qué hace Comando Central al recibirlo. Una línea, sin promesas. */
  readonly descripcion: string;
}

export const EVENTOS_WEBHOOK = [
  {
    evento: "mensaje.entrante",
    titulo: "Mensaje entrante",
    descripcion:
      "Guarda el mensaje del contacto, alimenta el Buzón, cancela su serie automática y —con el bot activo— dispara el auditor IA.",
  },
  {
    evento: "mensaje.saliente",
    titulo: "Mensaje saliente",
    descripcion: "Guarda la respuesta del agente en el chat de la ficha y la somete al auditor IA.",
  },
  {
    evento: "cita.agendada",
    titulo: "Cita agendada",
    descripcion:
      "Guarda la cita (alimenta la Agenda y Mi Día) y da de alta el contacto si no existía. Es la vía de entrada de contactos nuevos.",
  },
  {
    evento: "cita.cancelada",
    titulo: "Cita cancelada",
    descripcion: "Marca la cita como cancelada: sale de la Agenda y de las citas de hoy.",
  },
  {
    evento: "contacto.zona_closer",
    titulo: "Entró a zona del closer",
    descripcion:
      "Refresca el contacto en la caché al instante y anota «Entró a territorio del closer» en su historial.",
  },
  {
    evento: "contacto.actualizado",
    titulo: "Contacto actualizado",
    descripcion:
      "Refresca tags, campos del perfil y estado del contacto en la caché, sin escribir historial. Da inmediatez a los cambios de tags.",
  },
  {
    evento: "serie.toque",
    titulo: "Toque de serie enviado",
    descripcion: "Anota «Toque N de M enviado» en el historial de la ficha, para ver la serie avanzar.",
  },
  {
    evento: "serie.agotada",
    titulo: "Serie agotada",
    descripcion:
      "Marca la serie automática como agotada sin respuesta; el contacto aparece en Seguimientos de hoy al vencer su fecha.",
  },
] as const satisfies readonly EventoWebhookDef[];

/** El tipo del handler, derivado del catálogo — no una segunda lista. */
export type EventoGhl = (typeof EVENTOS_WEBHOOK)[number]["evento"];

/** El guard del handler, derivado del catálogo — tampoco una segunda lista. */
export const EVENTOS_CONOCIDOS: readonly string[] = EVENTOS_WEBHOOK.map((e) => e.evento);

/** La URL completa de un evento, a partir de la base que devuelve `/api/admin/webhooks`. */
export function urlDeEvento(urlBase: string, evento: string): string {
  return `${urlBase}?evento=${encodeURIComponent(evento)}`;
}
