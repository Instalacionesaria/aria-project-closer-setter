/**
 * Qué auditores están encendidos, y el veredicto de tres niveles.
 *
 * Vive en `src/lib/` y no en `api/` porque lo leen **los dos lados**: el backend para no gastar
 * una llamada al modelo, y la vista para explicar por qué una tarjeta está bloqueada. Dos
 * constantes, una por lado, se separan — y el día que se separen, la pantalla diría "activo"
 * mientras el cron no corre, o al revés.
 */

/**
 * ── El único valor que desbloquea los auditores de voz ────────────────
 *
 * **Encendido el 2026-08-10** (pedido de Fabio: empiezan las pruebas de los agentes de llamadas).
 * Con esto en `true`: las tarjetas de voz dejan de decir "apagado a propósito", sus prompts cuentan
 * en el checklist de alta, y el guard del analizador deja de frenarlos.
 *
 * ── Lo que este flag NO crea, dicho de frente ─────────────────────────
 *
 * La ingesta ya funcionaba (el webhook de llamadas guarda transcripción, resumen, sentimiento y
 * grabación, y el tab Llamada los muestra) y los dos prompts de voz ya se pueden pegar en
 * Auditoría de Agentes › Prompts. Lo que **todavía no existe** es el motor que tome una
 * transcripción de `closer_llamadas` y la someta a una rúbrica: el analizador de hoy audita
 * conversaciones de chat. Hasta que ese alimentador exista, las tarjetas de voz muestran "sin
 * auditor conectado" con su motivo — que es la verdad, no un bug.
 *
 * Sigue siendo constante del código y no variable de entorno, por el motivo de la `028`: encender
 * un auditor que gasta plata tiene que aparecer en un diff que alguien mire.
 */
export const AUDITOR_VOZ_HABILITADO = true;

/** Los dos agentes de voz. Se nombran acá para que el guard no dependa de un string suelto. */
export const AGENTES_VOZ = ["lead-flow-voz", "appointment-flow-voz"] as const;
export type AgenteVozId = (typeof AGENTES_VOZ)[number];

export function esAgenteDeVoz(id: string): id is AgenteVozId {
  return (AGENTES_VOZ as readonly string[]).includes(id);
}

/**
 * `true` si ese agente puede ser auditado hoy. Un agente de voz con el flag apagado devuelve
 * `false` **aunque tenga rúbrica y datos**: es la diferencia entre "no existe" y "está apagado".
 */
export function auditorHabilitado(agenteId: string): boolean {
  return esAgenteDeVoz(agenteId) ? AUDITOR_VOZ_HABILITADO : true;
}

/**
 * Por qué está bloqueado, para mostrarlo en la tarjeta.
 *
 * Está acá y no en la vista para que el motivo viaje con la decisión. Una tarjeta que dice
 * "bloqueado" sin decir por qué se lee como un bug.
 */
export const MOTIVO_VOZ_BLOQUEADO =
  "Los agentes de llamadas todavía no están en funcionamiento, así que su auditor está apagado a " +
  "propósito: no analiza ni gasta una sola llamada al modelo. Las llamadas SÍ se siguen recibiendo " +
  "y guardando — transcripción, resumen, sentimiento y grabación están en el tab Llamada de cada " +
  "ficha. El día que se enciendan hay material real esperando.";

/* ================================================================== */
/* El veredicto de tres niveles                                        */
/* ================================================================== */

/**
 * ── Por qué tres y no un booleano ─────────────────────────────────────
 *
 * Antes había `fallo: boolean`, y eso mete dos hechos distintos en la misma casilla: "no falló" y
 * "no se pudo decir nada". Un análisis que salió limpio **es un dato medido**, y es lo que
 * permite que una tarjeta afirme salud en vez de mostrar `—` por falta de datos.
 *
 *   · `verde`    el agente trabajó bien. Se guarda QUÉ estuvo bien, con su cita.
 *   · `amarillo` sin fallo, pero mejorable. Sin corrección de prompt.
 *   · `rojo`     fallo crítico. Diagnóstico + corrección de prompt citada.
 */
export type NivelVeredicto = "verde" | "amarillo" | "rojo";

export const NIVELES: readonly NivelVeredicto[] = ["verde", "amarillo", "rojo"];

/**
 * La única diferencia entre chat y voz está en el rojo.
 *
 * En chat el rojo apaga el bot con `bot_pausado_fallo` y el contacto entra a Urgentes. En voz
 * **no puede**: la llamada ya terminó, no hay nada que apagar ni nadie a quien interrumpir. Lo que
 * sí hace en los dos casos es escribir la nota y generar la corrección de prompt — que es el
 * objetivo de fondo: que el agente no repita el error.
 */
export function elRojoApagaElBot(agenteId: string): boolean {
  return !esAgenteDeVoz(agenteId);
}
