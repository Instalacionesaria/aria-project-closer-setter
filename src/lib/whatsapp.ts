/**
 * La ventana de servicio de 24 horas de WhatsApp Business.
 *
 * Meta solo permite mandar texto libre dentro de las 24 h posteriores al ÚLTIMO mensaje que
 * escribió el contacto. Pasada esa ventana, lo único que acepta son plantillas aprobadas.
 *
 * ## Por qué esto vive en el código y no solo en GHL
 *
 * Bug del 2026-08-05: el closer escribió desde Comando Central, la plataforma lo dio por
 * enviado, y el mensaje nunca llegó. `POST /conversations/messages` había devuelto 2xx —
 * GHL acepta el mensaje y recién después Meta lo rechaza. Para el código, un envío condenado
 * y uno exitoso se veían idénticos.
 *
 * Conocer la regla acá permite las dos cosas que faltaban: **no gastar la llamada** en un
 * mensaje que ya sabemos que va a rebotar, y **decirle al closer por qué** en vez de dejarlo
 * esperando una respuesta que nunca va a llegar.
 *
 * ## El dato del que depende
 *
 * `ultimo_entrante_el` de `closer_contactos`, que mantienen las dos vías de ingesta (webhook
 * y reconciliación) y que solo AVANZA, nunca retrocede (§51.3). Puede estar hasta unos
 * segundos viejo; las consecuencias de cada error están anotadas en `ventanaWhatsapp`.
 *
 * Módulo isomorfo: lo importan `api/closer/mensajes.ts`, `api/closer/chat.ts` y el ChatTab.
 */

export const VENTANA_WHATSAPP_MS = 24 * 60 * 60 * 1000;

export interface VentanaWhatsapp {
  /** `true` = se puede mandar texto libre. */
  abierta: boolean;
  /** ISO del momento en que la ventana se cierra (o se cerró). `null` si nunca escribió. */
  venceEl: string | null;
  /** Cuánto falta para que cierre. Negativo = hace cuánto que cerró. `null` si nunca escribió. */
  restanteMs: number | null;
  /** Por qué no se puede mandar. `null` cuando está abierta. */
  motivo: string | null;
}

/** "3 h 20 min" / "45 min" — para decirle al closer cuánto le queda o hace cuánto venció. */
export function duracionCorta(ms: number): string {
  const min = Math.max(0, Math.round(Math.abs(ms) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  if (h < 24) return resto > 0 ? `${h} h ${resto} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return `${d} día${d > 1 ? "s" : ""}`;
}

/**
 * ¿Se le puede escribir a este contacto ahora mismo?
 *
 * ## Los dos errores posibles, y por qué este diseño elige el que elige
 *
 * - **La caché dice CERRADA y en realidad está abierta** (el contacto acaba de escribir y la
 *   reconciliación todavía no corrió): se bloquea un mensaje legítimo. Dura segundos — el
 *   webhook actualiza al instante y la reconciliación cada 10 s — y el chat repregunta cada
 *   5 s, así que el compositor se vuelve a habilitar solo.
 * - **La caché dice ABIERTA y en realidad está cerrada**: se manda, Meta lo rechaza, y el
 *   mensaje queda marcado como fallido con su motivo cuando la reconciliación lee el estado.
 *
 * Ninguno de los dos miente: el primero se corrige solo en segundos y el segundo termina
 * mostrando el fallo real. Lo que NO se hace es preguntarle a GHL antes de cada envío — sería
 * una llamada por mensaje para adelantar un dato que ya está en la caché (§51.4).
 */
export function ventanaWhatsapp(
  ultimoEntranteEl: string | null | undefined,
  ahoraMs: number = Date.now(),
): VentanaWhatsapp {
  if (!ultimoEntranteEl) {
    return {
      abierta: false,
      venceEl: null,
      restanteMs: null,
      motivo:
        "Este contacto todavía no escribió por WhatsApp. Meta solo deja iniciar una conversación " +
        "con una plantilla aprobada, no con un mensaje libre.",
    };
  }

  const ultimoMs = Date.parse(ultimoEntranteEl);
  if (Number.isNaN(ultimoMs)) {
    // Una fecha ilegible no puede hacerse pasar por ventana abierta: sería exactamente el
    // "parece que salió" que este módulo existe para evitar.
    return {
      abierta: false,
      venceEl: null,
      restanteMs: null,
      motivo: "No se pudo leer cuándo escribió el contacto por última vez.",
    };
  }

  const venceMs = ultimoMs + VENTANA_WHATSAPP_MS;
  const restanteMs = venceMs - ahoraMs;
  const abierta = restanteMs > 0;

  return {
    abierta,
    venceEl: new Date(venceMs).toISOString(),
    restanteMs,
    motivo: abierta
      ? null
      : `Pasaron más de 24 horas desde el último mensaje del contacto (venció hace ${duracionCorta(restanteMs)}). ` +
        "WhatsApp solo permite escribir texto libre dentro de esa ventana; para reabrirla tiene que " +
        "escribir él, o hay que mandarle una plantilla aprobada desde GHL.",
  };
}
