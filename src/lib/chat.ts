/**
 * La fusión entre lo que dice el servidor y lo que el closer acaba de escribir.
 *
 * ── El bug que motivó esto (2026-08-16, reportado por Fabio) ──────────
 *
 * El chat repregunta cada 5 segundos y **pisaba la lista entera** con la respuesta. Un mensaje
 * recién enviado todavía no está ahí —GHL tarda un momento en devolverlo—, así que la burbuja
 * desaparecía de la pantalla y volvía unos segundos después. En WhatsApp eso no pasa nunca, y es
 * lo que se veía como "desincronización".
 *
 * El caso peor era el otro: un envío que falló de verdad (sin red) se marcaba `failed` en local, y
 * como el servidor nunca lo tuvo, el siguiente reemplazo lo borraba. El closer veía el error un
 * segundo y después nada — un mensaje que el contacto no recibió, desaparecido sin rastro.
 *
 * ── Por qué vive acá y no dentro del componente ───────────────────────
 *
 * Es la única parte del chat que puede estar mal sin que se vea al mirar: el orden se nota, el
 * scroll se nota, pero "un mensaje que se perdió en el merge" solo aparece cuando ya pasó. Acá se
 * puede probar contra los casos que importan, incluido el de mandar el mismo texto dos veces.
 */

/** Lo mínimo que la fusión necesita saber de un mensaje. El componente pasa los suyos enteros. */
export interface MensajeFusionable {
  text: string;
  outgoing: boolean;
  /** `enviando` y `failed` son locales: marcan una burbuja que el servidor todavía no confirmó. */
  estado?: string | null;
}

/** `true` si esta burbuja todavía no fue confirmada por el servidor. */
function enVuelo(m: MensajeFusionable): boolean {
  return m.outgoing && (m.estado === "enviando" || m.estado === "failed");
}

/**
 * Devuelve la lista a mostrar: lo del servidor, y detrás lo que sigue viajando.
 *
 * ── Se cuentan COPIAS, no presencia ──────────────────────────────────
 *
 * Mandar "ok" dos veces seguidas es normal. Comparando con un `Set`, la segunda burbuja se daba
 * por confirmada apenas llegaba la primera del servidor: el mensaje desaparecía de la pantalla
 * habiendo salido de verdad. Cada copia del servidor cancela **una** burbuja en vuelo, no todas
 * las que digan lo mismo.
 *
 * El texto es el único puente disponible entre las dos: la burbuja optimista se identifica con el
 * reloj del browser y la fila real con el uuid de la base, y no hay forma de atarlas antes de que
 * el servidor la devuelva.
 */
export function fusionarMensajes<T extends MensajeFusionable>(
  delServidor: readonly T[],
  previos: readonly T[],
): T[] {
  const disponibles = new Map<string, number>();
  for (const m of delServidor) {
    if (m.outgoing) disponibles.set(m.text, (disponibles.get(m.text) ?? 0) + 1);
  }

  const pendientes = previos.filter((m) => {
    if (!enVuelo(m)) return false;
    const quedan = disponibles.get(m.text) ?? 0;
    // Hay una copia del servidor sin reclamar: ésta ya llegó, se consume y se suelta.
    if (quedan > 0) {
      disponibles.set(m.text, quedan - 1);
      return false;
    }
    return true;
  });

  // Los pendientes van al final: son los más nuevos de la conversación.
  return [...delServidor, ...pendientes];
}
