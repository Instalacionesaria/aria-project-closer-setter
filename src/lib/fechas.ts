/**
 * Fechas civiles de la organización.
 *
 * Toda fecha de negocio de este producto es una fecha CIVIL (un día del calendario),
 * no un instante: "el seguimiento es el 28 de julio" no tiene hora. El bug que este
 * módulo existe para matar es mezclar las dos cosas.
 *
 * El código anterior (`isoInDays` en `ContactDrawer.tsx`) hacía:
 *
 *     const d = new Date();          // instante, en la zona del browser
 *     d.setDate(d.getDate() + days); // aritmética en la zona del browser
 *     return d.toISOString().slice(0, 10);   // ← convierte a UTC y RECIÉN truncа
 *
 * En Lima (UTC-5) a las 20:00 del 25 de julio, `new Date()` ya es el 26 en UTC, así que
 * "Mañana" devolvía el 27: el día equivocado durante las últimas cinco horas de cada
 * jornada laboral, que para un closer son las horas buenas. No se notaba porque la fecha
 * se descartaba; al persistirla se vuelve una cita equivocada con una persona.
 *
 * Regla: el "hoy" se lee de un reloj con zona explícita; sumar días es aritmética de
 * calendario pura, sin zonas de por medio.
 */

/**
 * El **default** de zona horaria: el que se usa cuando no hay empresa de la cual leerla.
 *
 * ── Dejó de ser "la zona de la organización" (2026-08-08) ─────────────
 *
 * Nació como la zona única del producto, y su propio comentario anticipaba el cambio: *"cuando
 * exista `org_config` en la base, este valor se lee de ahí y esta constante pasa a ser solo el
 * default"*. `closer_org_config.zona_horaria` existe desde la `020` y `env.zonaHoraria()` la lee
 * hace semanas — pero ocho archivos del backend seguían importando la constante, así que una
 * empresa en Bogotá o en Ciudad de México recibía fechas de Lima. No fallaba: mostraba el día
 * equivocado durante las últimas horas de su jornada, que es el bug que el encabezado de este
 * archivo describe, ahora entre empresas.
 *
 * **En `api/` no se usa: ahí va `env.zonaHoraria()`**, que sale de la empresa activa. Acá queda
 * para el browser —que no tiene contexto de empresa y recibe la zona resuelta en cada
 * respuesta— y como fallback de `env.zonaHoraria()` cuando no hay contexto (un test, el arranque).
 *
 * UTC-5 fijo, sin horario de verano: no hay días de 23 ni de 25 horas, así que las diferencias en
 * días son exactas.
 */
export const ZONA_HORARIA_ORG = "America/Lima";

/**
 * Un `Intl.DateTimeFormat` por (locale, opciones), construido una sola vez.
 *
 * ── Por qué existe, y qué reemplaza ───────────────────────────────────
 *
 * Los formateadores estaban **izados a nivel de módulo** con `timeZone: ZONA_HORARIA_ORG`. Eso es
 * lo correcto para el costo —construir un `Intl.DateTimeFormat` no es gratis y el auditor formatea
 * un sello por mensaje— y lo incorrecto para el multi-empresa: un módulo se carga una vez por
 * instancia de lambda y esa instancia atiende a varias empresas, así que la zona de la primera
 * quedaba congelada para todas. Un `const` a nivel de módulo no puede depender del request.
 *
 * Bajarlos adentro de la función arreglaba la corrección y perdía el costo. Esto conserva las dos:
 * la zona entra como argumento en cada llamada y el objeto se construye una sola vez por
 * combinación distinta —que son un puñado, fijas en el código.
 *
 * La clave incluye las opciones porque dos formateadores de la misma zona con distinto esqueleto
 * son objetos distintos; serializar el objeto es más barato que la construcción que evita.
 */
const formateadores = new Map<string, Intl.DateTimeFormat>();

export function formateador(locale: string, opciones: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const clave = `${locale}|${JSON.stringify(opciones)}`;
  let f = formateadores.get(clave);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, opciones);
    formateadores.set(clave, f);
  }
  return f;
}

/** Fecha civil `YYYY-MM-DD`. Nunca lleva hora ni zona. */
export type FechaISO = string;

/**
 * El día que es HOY en la empresa, sin importar dónde esté el browser.
 * `en-CA` es el locale que formatea como `YYYY-MM-DD`.
 *
 * `zona` es el segundo parámetro y no el primero por compatibilidad con los cuarenta llamadores
 * que ya pasaban una fecha. En `api/` conviene pasar `env.zonaHoraria()`: los llamadores de allá
 * usan esto **como fallback de `hoyOrg()`**, la función SQL que ya resuelve la zona de la empresa,
 * y un fallback que cambia de zona horaria respecto de lo que reemplaza es un fallback que miente.
 */
export function hoyISO(ahora: Date = new Date(), zona: string = ZONA_HORARIA_ORG): FechaISO {
  return formateador("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ahora);
}

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/**
 * Aritmética de calendario pura: parsea a mediodía UTC, suma, vuelve a formatear.
 * No interviene ninguna zona horaria, así que no hay forma de cruzar un límite de día
 * por accidente.
 */
export function sumarDias(iso: FechaISO, dias: number): FechaISO {
  const [y, m, d] = iso.split("-").map(Number);
  const resultado = new Date(Date.UTC(y, m - 1, d) + dias * 86_400_000);
  return `${resultado.getUTCFullYear()}-${dosDigitos(resultado.getUTCMonth() + 1)}-${dosDigitos(resultado.getUTCDate())}`;
}

/** El día que será dentro de `dias` días en la organización. Reemplaza a `isoInDays`. */
export function isoEnDias(dias: number, ahora: Date = new Date()): FechaISO {
  return sumarDias(hoyISO(ahora), dias);
}

/** Días completos de `desde` a `hasta`. Negativo si `hasta` es anterior. */
export function diasEntre(desde: FechaISO, hasta: FechaISO): number {
  const aUtc = (iso: FechaISO) => {
    const [y, m, d] = iso.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((aUtc(hasta) - aUtc(desde)) / 86_400_000);
}

/**
 * Días de atraso de una fecha objetivo respecto de hoy. 0 = vence hoy (no está vencido).
 * Positivo = vencido hace N días.
 */
export function diasVencido(fechaObjetivo: FechaISO, ahora: Date = new Date()): number {
  return diasEntre(fechaObjetivo, hoyISO(ahora));
}

/** "24 jul" — para la segunda línea de la fila. La píldora nunca lleva fecha (§12/§39.3). */
export function fechaCorta(iso: FechaISO): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d))
    .toLocaleDateString("es-ES", { day: "2-digit", month: "short", timeZone: "UTC" })
    .replace(".", "");
}

/**
 * `"miércoles, 8 de julio"` — el encabezado de Mi Día.
 *
 * Vive acá y no en cada vista porque el closer y el setter muestran **el mismo hecho**: qué día
 * es hoy para la organización. Dos formateadores divergen (regla 3), y ya venían divergiendo de
 * la peor forma posible: los dos tenían la fecha escrita a mano como texto.
 *
 * Se construye en UTC a partir del ISO y se formatea con `timeZone: "UTC"`, igual que
 * `fechaCorta`. Es lo que evita el clásico corrimiento de un día: `new Date("2026-08-08")` se
 * interpreta como medianoche UTC, y un browser en Lima (UTC-5) lo mostraría como el 7.
 */
export function fechaLarga(iso: FechaISO): string {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}
