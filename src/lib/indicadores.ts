/**
 * Los 6 indicadores de estado de un contacto — el contrato de la fila de íconos (§8).
 *
 * ## Por qué existe este archivo
 *
 * Hasta el 2026-08-04 los 6 íconos se derivaban de campos que solo existían en la semilla
 * (`llamadas: CallRecord[]`, `agenda`, `botEstado`), así que para un contacto REAL de GHL
 * cinco de los seis estaban permanentemente apagados. Y el bloque de render vivía duplicado
 * en cinco vitrinas con lógica distinta: el mismo contacto se veía "sin bot" en las listas y
 * "IA activa" en la ficha.
 *
 * Fabio lo pidió así: *"estos símbolos deben aparecer como información del contacto, o sea
 * que si ese contacto se mueve a otra parte del pipeline esto siempre lo acompañará... por
 * lo que cuando se muestre en cualquier parte traerá esa información."*
 *
 * Este bloque lo calcula el BACKEND y viaja dentro de cada contacto en todos los endpoints
 * que listan contactos. El front no deriva ningún ícono por su cuenta: lo pinta un único
 * componente (`src/components/StatusIcons.tsx`) a partir de este objeto.
 *
 * ## De dónde sale cada uno (migración 013)
 *
 * | Ícono | Origen |
 * |---|---|
 * | 📹 `reuniones` | `closer_citas` pasadas no canceladas − los No-show de `closer_avances` |
 * | 📅 `citaFutura` | `closer_citas` con fecha futura no cancelada |
 * | 📞 `llamadasIa*` | columnas de `closer_contactos`, cacheadas de los custom fields de GHL |
 * | 🤖 `bot` | derivado de los tags (`botDesdeTags`), NUNCA de una columna |
 * | ⏱ `seguimientoAuto` | `closer_seguimientos` con modo automático pendiente |
 * | 💰 `ventaMonto` | `monto` cuando la etapa es `ganado` |
 *
 * Isomorfo: sin React, sin DOM, sin Node — lo importan `api/` (con `.js`) y `src/`.
 */

import type { BotEstado } from "./ghl/contrato";

export interface IndicadoresContacto {
  /** 📹 Reuniones con el closer que YA ocurrieron. 0 → ícono atenuado sin número (§4.1). */
  reuniones: number;

  /** 📅 Tiene una cita futura vigente. "Está agendado actualmente", en palabras de Fabio. */
  citaFutura: boolean;

  /** ISO de la próxima cita, o `null`. Alimenta el tooltip y la columna del Pipeline. */
  proximaCitaEl: string | null;

  /**
   * Sala de Meet de esa próxima cita. Es una ACCIÓN (el botón "Unirse"), no el ícono 📹 —
   * son cosas distintas desde §35.C y conviene que sigan siéndolo.
   */
  proximaMeetUrl: string | null;

  /**
   * La última cita que ya pasó. No enciende ningún ícono: existe para que el Pipeline pueda
   * mostrar "Cita vencida · {fecha}". Una cita pasada sin Avanzar nunca desaparece (§50.10).
   */
  ultimaCitaVencidaEl: string | null;

  /**
   * 📞 Llamadas del agente de voz que el contacto CONTESTÓ.
   * `null` = nunca se sincronizó desde GHL; `0` = GHL dice que no contestó ninguna. La UI
   * pinta lo mismo en los dos casos, pero la diferencia importa para diagnosticar.
   */
  llamadasIaContestadas: number | null;

  /** Intentos totales del agente de voz. Sin ícono propio: decide el "✗" atenuado de 📞. */
  llamadasIaIntentos: number | null;

  /**
   * 🤖 Estado del bot derivado de los tags. `null` = el contacto no tiene bot (IG) o no hay
   * ningún tag que lo diga — que bajo el default APAGADO de §51.3 se pinta igual: atenuado.
   * NUNCA se rellena con `"activo"` por conveniencia.
   */
  bot: BotEstado | null;

  /** ⏱ Tiene una serie de seguimiento automático corriendo ahora mismo. */
  seguimientoAuto: boolean;

  /**
   * 💰 Venta COBRADA. `null` sin venta. Una promesa de "Acordó comprar" no cuenta, aunque
   * también escriba `monto` — esa vive solo en la píldora (§27.A).
   */
  ventaMonto: number | null;
}

/**
 * Todo apagado. Se usa donde de verdad no hay dato que mostrar, nunca como reemplazo de una
 * derivación que sí podría hacerse.
 */
export const INDICADORES_VACIOS: IndicadoresContacto = {
  reuniones: 0,
  citaFutura: false,
  proximaCitaEl: null,
  proximaMeetUrl: null,
  ultimaCitaVencidaEl: null,
  llamadasIaContestadas: null,
  llamadasIaIntentos: null,
  bot: null,
  seguimientoAuto: false,
  ventaMonto: null,
};
