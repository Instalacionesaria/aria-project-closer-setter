/**
 * Rellena el historial de chat que la caché nunca tuvo.
 *
 * ── El hueco, medido (2026-08-16) ─────────────────────────────────────
 *
 * La ingesta de mensajes nació con el webhook y **solo mira hacia adelante**: un contacto entra a
 * la caché por el barrido de territorio, y sus mensajes recién empiezan a guardarse cuando llega
 * el primer `mensaje.entrante` posterior. Todo lo anterior no existe para nosotros.
 *
 * Contra producción, sobre 148 contactos:
 *
 *   · **33 no tenían un solo mensaje**, y en GHL sí — uno de ellos con 46.
 *   · Los que sí tenían, tenían de más para atrás: en una muestra de 12, faltaban ~51 mensajes,
 *     siempre los más viejos.
 *
 * Eso rompe tres cosas a la vez: el tab Chat muestra una conversación que empieza a la mitad, el
 * auditor juzga al agente por un fragmento sin principio, y el debounce cuenta mensajes de IA que
 * nunca vio.
 *
 * ── Por qué es seguro correrlo cuantas veces haga falta ───────────────
 *
 * `guardarMensajes` hace `upsert` por `id` con `ignoreDuplicates`, así que un mensaje ya guardado
 * no se duplica ni se pisa. Y **no se inventa ninguna hora**: `timestamp_ghl` sale del `dateAdded`
 * de GHL, que es el mismo campo del que sale la vía normal. Por eso el orden queda bien por
 * construcción — el chat ordena por esa columna, no por cuándo lo guardamos.
 *
 * ── Lo que NO hace ────────────────────────────────────────────────────
 *
 * No dispara efectos de entrante (nada de mover colas, marcar buzón ni tocar tags): son mensajes
 * VIEJOS, y tratarlos como recién llegados reabriría tareas cerradas hace semanas. Tampoco llama
 * al analizador — sería una inferencia por contacto sobre conversaciones que ya pasaron.
 *
 * Es la diferencia con `reconciliacion.ts`, que hace justo eso porque sus mensajes sí son nuevos.
 */

import {
  conversacionesDeContacto,
  esMensajeDeChat,
  mensajesDeConversacionPaginado,
} from "./ghl/lectura.js";
import { autorDeMensajeGhl } from "./autoria.js";
import { guardarMensajes, type MensajeNormalizado } from "./ingesta.js";
import { db } from "./repo.js";

/**
 * Cuántas páginas de 100 mensajes se piden por conversación.
 *
 * La más larga que se midió tiene ~120, así que 5 páginas (500) cubre con margen y deja dicho
 * cuando no alcanzó, en vez de recortar en silencio.
 */
const PAGINAS = 5;

export interface ResultadoBackfill {
  /** Contactos que se miraron en esta corrida. */
  revisados: number;
  /** Mensajes que NO estaban y ahora sí. */
  insertados: number;
  /** Contactos cuya conversación superó el tope de páginas: les falta historial más viejo. */
  truncados: string[];
  /** Contactos que fallaron, con su motivo. Se sigue con los demás. */
  errores: string[];
  /** Llamadas a GHL gastadas, para poder mirarlas contra el presupuesto. */
  llamadasGhl: number;
  /** Mensajes que GHL devolvió sin `dateAdded`: se descartan en vez de inventarles una hora. */
  sinFecha: number;
}

/**
 * Rellena los mensajes de una lista de contactos.
 *
 * Se recorren **todas** sus conversaciones, no solo la más reciente: un contacto puede tener
 * WhatsApp y SMS abiertos a la vez, y quedarse con una sola dejaría media conversación afuera.
 */
export async function backfillMensajes(
  ghlContactIds: readonly string[],
): Promise<ResultadoBackfill> {
  const r: ResultadoBackfill = {
    revisados: 0,
    insertados: 0,
    truncados: [],
    errores: [],
    llamadasGhl: 0,
    sinFecha: 0,
  };

  for (const ghlContactId of ghlContactIds) {
    r.revisados++;
    try {
      const conversaciones = await conversacionesDeContacto(ghlContactId);
      r.llamadasGhl++;

      for (const conversationId of conversaciones) {
        const {
          mensajes: crudos,
          truncado,
          paginas,
        } = await mensajesDeConversacionPaginado(conversationId, {
          limite: 100,
          paginas: PAGINAS,
        });
        // Las páginas que se pidieron DE VERDAD. Sumar el tope reportaría un gasto que no
        // ocurrió: una conversación de 3 mensajes cuesta una llamada, no cinco.
        r.llamadasGhl += paginas;
        if (truncado && !r.truncados.includes(ghlContactId))
          r.truncados.push(ghlContactId);

        /**
         * La MISMA normalización que `reconciliacion.ts`. Copiarla distinto haría que una fila
         * rellenada y una ingerida en vivo no fueran comparables — y el `autor` es justo lo que
         * el auditor usa para saber quién habló.
         */
        /**
         * Sin `dateAdded` el mensaje se DESCARTA, no se estampa con la hora de ahora.
         *
         * El chat ordena por `timestamp_ghl`, así que un mensaje de hace tres semanas con la
         * hora de la corrida se clavaría al final de la conversación — justo el desorden que
         * este relleno viene a arreglar. Y encima sería una hora inventada con cara de dato.
         * Se cuentan aparte para que el resultado lo diga.
         */
        const sinFecha = crudos.filter(
          (m) => esMensajeDeChat(m) && Boolean(m.body) && !m.dateAdded,
        ).length;
        r.sinFecha += sinFecha;

        const normalizados: MensajeNormalizado[] = crudos
          .filter(
            (m) =>
              esMensajeDeChat(m) && Boolean(m.body) && Boolean(m.dateAdded),
          )
          .map((m) => ({
            id: String(m.id),
            ghlContactId,
            conversationId,
            direccion:
              m.direction === "inbound"
                ? ("inbound" as const)
                : ("outbound" as const),
            body: String(m.body ?? ""),
            timestampGhl: new Date(m.dateAdded as string).toISOString(),
            autor: autorDeMensajeGhl(m),
            estado: m.status ?? null,
            errorEnvio: m.error ?? null,
          }));

        r.insertados += await guardarMensajes(normalizados);
      }
    } catch (e) {
      r.errores.push(`${ghlContactId}: ${(e as Error).message}`);
    }
  }

  return r;
}

/**
 * Los contactos de la empresa activa que conviene rellenar, los más vacíos primero.
 *
 * El orden importa cuando el lote se corta por tope: un contacto con cero mensajes es una ficha
 * que se ve rota, y uno al que le faltan los tres más viejos es una molestia. Se atiende primero
 * lo que se nota.
 */
export async function contactosParaBackfill(limite: number): Promise<string[]> {
  const contactos = await todasLasFilas<{ ghl_contact_id: string }>(
    "closer_contactos",
    "ghl_contact_id",
  );
  const mensajes = await todasLasFilas<{ ghl_contact_id: string }>(
    "closer_mensajes",
    "ghl_contact_id",
  );

  const cuenta = new Map<string, number>();
  for (const m of mensajes)
    cuenta.set(m.ghl_contact_id, (cuenta.get(m.ghl_contact_id) ?? 0) + 1);

  return contactos
    .map((c) => c.ghl_contact_id)
    .sort((a, b) => (cuenta.get(a) ?? 0) - (cuenta.get(b) ?? 0))
    .slice(0, limite);
}

/** Cuántas filas pide por vuelta. Por debajo del tope de PostgREST, para que el corte sea nuestro. */
const PAGINA_FILAS = 1000;

/**
 * Todas las filas de una tabla, paginando.
 *
 * ── Por qué no alcanza un `select` a secas ────────────────────────────
 *
 * **PostgREST recorta en 1000 filas y no avisa**: devuelve 200 con la lista corta, sin error ni
 * marca. Verificado contra la base el 2026-08-16 — `closer_mensajes` tiene 1330 y el select
 * devolvía 1000.
 *
 * Acá eso no habría explotado: habría contado de menos para 330 mensajes, y el orden de "quién
 * necesita más el relleno" habría salido mal en silencio, mandando primero a contactos que ya
 * estaban completos. El modo de fallar de siempre — un número con toda la cara de un dato.
 *
 * Se corta cuando una página vuelve incompleta: es el fin real de la tabla, no una suposición.
 */
async function todasLasFilas<T>(tabla: string, columnas: string): Promise<T[]> {
  const filas: T[] = [];
  for (let desde = 0; ; desde += PAGINA_FILAS) {
    const { data, error } = await db()
      .from(tabla)
      .select(columnas)
      .range(desde, desde + PAGINA_FILAS - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    const lote = (data ?? []) as T[];
    filas.push(...lote);
    if (lote.length < PAGINA_FILAS) return filas;
  }
}
