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
/**
 * La etiqueta del separador de día, estilo WhatsApp.
 *
 * ── El bug que arregla (2026-08-16, reportado por Fabio con captura) ──
 *
 * El chat tenía **un "HOY" escrito a mano** arriba de todo y ningún separador más, así que una
 * conversación de varios días se veía como un bloque continuo donde solo cambia la hora:
 *
 *     19:13  ...no es mi plan por lo que busco
 *     19:14  Excelente
 *     19:14  Gracias los veo mañana
 *     08:09  Ya lo vi              <-- parece que retrocede en el tiempo
 *     09:05  Hola
 *
 * Los mensajes estaban en orden y con su hora correcta; lo que faltaba era decir que ahí cambió
 * el día. Sin eso, el orden correcto **se lee como desorden**, que es exactamente lo que se
 * reportó.
 *
 * El servidor ya mandaba la fecha de cada mensaje (`date`, en `YYYY-MM-DD` y en la zona horaria de
 * la organización) y el front la descartaba en el mapeo.
 */
export function etiquetaDeDia(fecha: string, hoy: string): string {
  if (fecha === hoy) return "HOY";
  if (fecha === dia(hoy, -1)) return "AYER";

  // `T12:00` y no medianoche: a las 00:00 un desfase de zona de pocas horas cae en el día
  // anterior, y el separador diría un día menos que el mensaje que encabeza.
  const d = new Date(`${fecha}T12:00:00`);
  if (Number.isNaN(d.getTime())) return fecha; // fecha ilegible: se muestra cruda, no se inventa
  return d
    .toLocaleDateString("es-PE", {
      day: "numeric",
      month: "long",
      year: "numeric",
    })
    .toUpperCase();
}

/** Suma días a un `YYYY-MM-DD` sin arrastrar la zona horaria del browser. */
function dia(iso: string, delta: number): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
}

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
