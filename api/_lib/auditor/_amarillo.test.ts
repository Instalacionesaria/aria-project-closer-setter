/**
 * El carril amarillo — las dos reglas que fallan en silencio.
 *
 * Ninguna de las dos rompe nada visible si está mal: `elegirPatron` siempre elige *algo* y
 * `inicioDelDia` siempre devuelve *un* número. Simplemente eligen mal, o miran el día equivocado,
 * todos los días, hasta que alguien compara a mano.
 *
 * El guion bajo del nombre: Vercel despliega todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { describe, expect, it } from "vitest";
import { elegirPatron, inicioDelDia, type Candidato } from "./amarilloDiario.js";
import type { SenalHeuristica } from "./heuristicas.js";

const c = (contactId: string, cuando: number): Candidato => ({ contactId, cuando });

function mapa(entradas: Array<[SenalHeuristica, Candidato[]]>): Map<SenalHeuristica, Candidato[]> {
  return new Map(entradas);
}

describe("elegirPatron", () => {
  it("elige la señal más repetida del día", () => {
    const r = elegirPatron(
      mapa([
        ["contacto_se_fue", [c("a", 100)]],
        ["pregunta_repetida", [c("b", 50), c("d", 60), c("e", 70)]],
        ["frustracion_lexica", [c("f", 90), c("g", 95)]],
      ]),
    );
    expect(r?.senal).toBe("pregunta_repetida");
  });

  it("con empate en cantidad, gana la del candidato más reciente", () => {
    const r = elegirPatron(
      mapa([
        ["frustracion_lexica", [c("a", 100), c("b", 200)]],
        ["intencion_de_pago", [c("x", 150), c("y", 900)]],
      ]),
    );
    expect(r?.senal).toBe("intencion_de_pago");
  });

  it("dentro de la señal elegida, el contacto más reciente", () => {
    const r = elegirPatron(mapa([["agente_se_repite", [c("viejo", 10), c("nuevo", 999), c("medio", 500)]]]));
    expect(r?.elegido.contactId).toBe("nuevo");
  });

  it("un mapa vacío no elige nada", () => {
    expect(elegirPatron(mapa([]))).toBeNull();
  });

  /**
   * Una señal con lista vacía saldría de un filtro que no encontró nada. Sin descartarla,
   * `Math.max()` sobre un array vacío devuelve `-Infinity` y la señal vacía podría ganar el
   * desempate contra una real.
   */
  it("una señal sin candidatos no puede ganar", () => {
    const r = elegirPatron(
      mapa([
        ["contacto_se_fue", []],
        ["frustracion_lexica", [c("a", 5)]],
      ]),
    );
    expect(r?.senal).toBe("frustracion_lexica");
  });
});

describe("inicioDelDia", () => {
  /**
   * Lima es UTC-5 todo el año. La medianoche del 7 de agosto en Lima son las 05:00 UTC del 7.
   * Si el signo del offset estuviera invertido daría las 19:00 UTC del 6 — un día corrido, y la
   * consulta traería las conversaciones de ayer sin que nada falle.
   */
  it("la medianoche de Lima son las 05:00 UTC del mismo día", () => {
    const ahora = new Date("2026-08-07T21:00:00Z"); // las 16:00 de Lima, la hora del cron
    expect(new Date(inicioDelDia("America/Lima", ahora)).toISOString()).toBe("2026-08-07T05:00:00.000Z");
  });

  /** A las 21:00 UTC ya es el 8 en Madrid: el borde tiene que ser el del 8, no el del 7. */
  it("respeta la zona de cada empresa, no la de Lima", () => {
    const ahora = new Date("2026-08-07T21:00:00Z");
    expect(new Date(inicioDelDia("Europe/Madrid", ahora)).toISOString()).toBe("2026-08-06T22:00:00.000Z");
  });

  it("el inicio del día nunca queda en el futuro", () => {
    const ahora = new Date("2026-08-07T21:00:00Z");
    for (const zona of ["America/Lima", "America/Mexico_City", "America/Bogota", "Europe/Madrid"]) {
      expect(inicioDelDia(zona, ahora)).toBeLessThanOrEqual(ahora.getTime());
    }
  });

  it("el inicio del día está dentro de las 24 h previas", () => {
    const ahora = new Date("2026-08-07T21:00:00Z");
    for (const zona of ["America/Lima", "America/Mexico_City", "Europe/Madrid"]) {
      expect(ahora.getTime() - inicioDelDia(zona, ahora)).toBeLessThan(24 * 60 * 60_000);
    }
  });
});
