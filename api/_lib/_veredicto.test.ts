/**
 * El veredicto de tres niveles y el bloqueo de los auditores de voz.
 *
 * Las dos cosas que se prueban acá fallan **en silencio o tarde**:
 *
 *   1. **La coherencia `rojo ⟺ fallo`.** La migración `031` la hace cumplir con un CHECK, así
 *      que una derivación mal escrita no da un dato raro: tumba el INSERT **después** de haber
 *      gastado la inferencia. El análisis se pierde entero y en el log solo queda un 23514.
 *   2. **El bloqueo de la voz.** Un `false` que se vuelve `true` por accidente enciende un auditor
 *      que gasta plata. Nada falla; simplemente empieza a facturar.
 *
 * El guion bajo del nombre: Vercel despliega todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { describe, expect, it } from "vitest";
import { derivarNivel } from "./analizador.js";
import {
  AUDITOR_VOZ_HABILITADO,
  auditorHabilitado,
  elRojoApagaElBot,
  esAgenteDeVoz,
  MOTIVO_VOZ_BLOQUEADO,
} from "../../src/lib/auditores.js";

describe("derivarNivel · la tabla de verdad que sostiene el CHECK de la 031", () => {
  it("sin auditar no hay nivel: null, que no es un cuarto nivel", () => {
    expect(derivarNivel({ auditable: false, requiereIntervencion: false, hallazgos: 0 })).toBeNull();
  });

  it("una conversación no auditable NUNCA es verde", () => {
    /**
     * El error más caro posible de este cambio. Si un "no lo pude mirar" se guardara como verde,
     * la tarjeta afirmaría salud sobre conversaciones que nadie juzgó — que es exactamente lo que
     * D3 existe para impedir, y encima con el sello de "medido".
     */
    expect(derivarNivel({ auditable: false, requiereIntervencion: true, hallazgos: 3 })).toBeNull();
    expect(derivarNivel({ auditable: false, requiereIntervencion: false, hallazgos: 0, nivelDelModelo: "verde" })).toBeNull();
  });

  it("con intervención es rojo, aunque el modelo diga otra cosa", () => {
    // El caso que tumbaría el INSERT: `nivel='amarillo'` con `fallo=true` viola el CHECK.
    expect(
      derivarNivel({ auditable: true, requiereIntervencion: true, hallazgos: 1, nivelDelModelo: "amarillo" }),
    ).toBe("rojo");
    expect(
      derivarNivel({ auditable: true, requiereIntervencion: true, hallazgos: 0, nivelDelModelo: "verde" }),
    ).toBe("rojo");
  });

  it("con hallazgos es amarillo aunque el modelo diga verde", () => {
    // Reportar algo observable y llamarlo verde es contradecirse. Gana lo que reportó.
    expect(
      derivarNivel({ auditable: true, requiereIntervencion: false, hallazgos: 2, nivelDelModelo: "verde" }),
    ).toBe("amarillo");
  });

  it("sin hallazgos y sin intervención es verde", () => {
    expect(derivarNivel({ auditable: true, requiereIntervencion: false, hallazgos: 0 })).toBe("verde");
    expect(
      derivarNivel({ auditable: true, requiereIntervencion: false, hallazgos: 0, nivelDelModelo: "verde" }),
    ).toBe("verde");
  });

  it("el modelo puede pedir amarillo sin hallazgos: vio algo que no llegó a hallazgo", () => {
    expect(
      derivarNivel({ auditable: true, requiereIntervencion: false, hallazgos: 0, nivelDelModelo: "amarillo" }),
    ).toBe("amarillo");
  });

  it("un nivel que no reconocemos cae en verde, no en un valor inválido", () => {
    /**
     * `nivel` tiene su propio CHECK en la `031`. Si un valor basura del modelo llegara tal cual a
     * la base, el INSERT fallaría — así que cualquier cosa que no entendamos cae al nivel que los
     * HECHOS respaldan: se auditó, no hubo hallazgos, nadie pidió intervenir.
     */
    for (const basura of ["ROJO", "green", "", null, undefined, 42, {}]) {
      expect(
        derivarNivel({ auditable: true, requiereIntervencion: false, hallazgos: 0, nivelDelModelo: basura }),
      ).toBe("verde");
    }
  });

  /**
   * La invariante que el CHECK de Postgres exige, barrida sobre todas las combinaciones. Es la
   * aserción que de verdad protege: cualquier refactor de `derivarNivel` que la rompa falla acá y
   * no en producción con un 23514.
   */
  it("`nivel === 'rojo'` equivale SIEMPRE a `requiereIntervencion`, cuando hay nivel", () => {
    for (const auditable of [true, false]) {
      for (const requiereIntervencion of [true, false]) {
        for (const hallazgos of [0, 1, 5]) {
          for (const nivelDelModelo of ["verde", "amarillo", "rojo", undefined]) {
            const nivel = derivarNivel({ auditable, requiereIntervencion, hallazgos, nivelDelModelo });
            if (nivel === null) continue;
            expect(nivel === "rojo", JSON.stringify({ auditable, requiereIntervencion, hallazgos, nivelDelModelo })).toBe(
              requiereIntervencion,
            );
          }
        }
      }
    }
  });
});

describe("el bloqueo de los auditores de voz", () => {
  it("los dos agentes de voz se reconocen como tales", () => {
    expect(esAgenteDeVoz("lead-flow-voz")).toBe(true);
    expect(esAgenteDeVoz("appointment-flow-voz")).toBe(true);
    expect(esAgenteDeVoz("appointment-flow-ai")).toBe(false);
  });

  /**
   * Este test se cae **a propósito** el día que alguien encienda la voz, y ahí hay que actualizarlo
   * a conciencia. Es lo que convierte "desbloquear es cambiar un valor" en algo verificable: si el
   * flag cambia sin que nadie lo haya decidido, la suite lo dice.
   */
  it("hoy la voz está BLOQUEADA y el chat no", () => {
    expect(AUDITOR_VOZ_HABILITADO).toBe(false);
    expect(auditorHabilitado("lead-flow-voz")).toBe(false);
    expect(auditorHabilitado("appointment-flow-voz")).toBe(false);
    expect(auditorHabilitado("appointment-flow-ai")).toBe(true);
    expect(auditorHabilitado("lead-flow-ai")).toBe(true);
  });

  it("el motivo del bloqueo dice que las llamadas SÍ se siguen guardando", () => {
    /**
     * No es cosmético: el spec separa "el análisis está apagado" de "la ingesta está apagada", y
     * son cosas distintas. Un cliente que lea "apagado" a secas va a creer que perdió sus llamadas.
     */
    expect(MOTIVO_VOZ_BLOQUEADO).toMatch(/guardando|guardan/i);
    expect(MOTIVO_VOZ_BLOQUEADO).toMatch(/transcripción/i);
  });

  it("el rojo apaga el bot en chat y NO en voz", () => {
    // En voz la llamada ya terminó: no hay bot hablando que interrumpir. Y aplicar el tag pausaría
    // al agente de CHAT de ese contacto, que es otro agente y puede estar trabajando bien.
    expect(elRojoApagaElBot("appointment-flow-ai")).toBe(true);
    expect(elRojoApagaElBot("lead-flow-ai")).toBe(true);
    expect(elRojoApagaElBot("appointment-flow-voz")).toBe(false);
    expect(elRojoApagaElBot("lead-flow-voz")).toBe(false);
  });
});
