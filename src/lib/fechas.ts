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
 * Zona horaria de la organización. UTC-5 fijo, sin horario de verano — así que no hay
 * días de 23 o 25 horas y las diferencias en días son exactas.
 *
 * Cuando exista `org_config` en la base, este valor se lee de ahí y esta constante pasa
 * a ser solo el default. Hasta entonces vive acá y en un solo lugar.
 */
export const ZONA_HORARIA_ORG = "America/Lima";

/** Fecha civil `YYYY-MM-DD`. Nunca lleva hora ni zona. */
export type FechaISO = string;

const FORMATO_ISO = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_HORARIA_ORG,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * El día que es HOY en la organización, sin importar dónde esté el browser.
 * `en-CA` es el locale que formatea como `YYYY-MM-DD`.
 */
export function hoyISO(ahora: Date = new Date()): FechaISO {
  return FORMATO_ISO.format(ahora);
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
