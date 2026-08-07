/**
 * Las seis secciones "En desarrollo" (§8).
 *
 * Lo que este test protege es una asimetría: **destapar una sección por accidente es peor que
 * dejarla tapada**. Una clave mal escrita, una entrada borrada de la lista o un `false` puesto de
 * más terminan mostrándole a un cliente que paga un panel con números que nadie midió — la regla
 * D3. Al revés, una sección tapada de más solo es una función que todavía no se ve.
 *
 * Por eso el test fija la lista completa en vez de comprobar el helper en abstracto: si alguien
 * activa una sección, tiene que actualizar esto también, y eso lo obliga a mirar lo que activó.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { _CLAVES, estaEnDesarrollo, queVaAHacer, type ClaveEnDesarrollo } from "./enDesarrollo";

/** Las seis de §8, literales. Si esta lista y el módulo divergen, el test falla. */
const ESPERADAS: ClaveEnDesarrollo[] = [
  "acquisition.atribucion",
  "acquisition.alertas",
  "acquisition.recomendaciones",
  "acquisition.tracking",
  "ci.auditor_setter",
  "ci.auditor_voz",
];

describe("enDesarrollo · §8", () => {
  it("están las seis claves de la especificación, y ninguna más", () => {
    expect([..._CLAVES].sort()).toEqual([...ESPERADAS].sort());
  });

  /**
   * Hoy las seis están bloqueadas. Cuando alguna se active, este test falla y hay que sacarla de
   * la lista a mano — que es el punto: activar una sección que muestra números no debería poder
   * pasar sin que alguien lo escriba.
   */
  it("las seis están bloqueadas", () => {
    for (const clave of ESPERADAS) {
      expect(estaEnDesarrollo(clave), `${clave} debería estar en desarrollo`).toBe(true);
    }
  });

  describe("el texto que ve el cliente", () => {
    it("todas tienen una línea de qué van a hacer", () => {
      for (const clave of ESPERADAS) {
        expect(queVaAHacer(clave).length, `${clave} sin texto`).toBeGreaterThan(20);
      }
    });

    /**
     * §8 pide decir *qué va a hacer*, no *por qué todavía no lo hace*. Un velo que se disculpa
     * ("todavía no está listo", "falta definir") no le sirve a nadie: el motivo va en
     * `docs/10-ESTADO.md`. Y sobre todo, el texto no puede traer un número — sería exactamente
     * el dato inventado que la sección existe para no mostrar.
     */
    it("ninguna se disculpa ni promete una fecha", () => {
      const prohibidas = [/todav[íi]a no/i, /pr[óo]ximamente/i, /pendiente/i, /falta/i, /en breve/i, /\b20\d\d\b/];
      for (const clave of ESPERADAS) {
        const texto = queVaAHacer(clave);
        for (const patron of prohibidas) {
          expect(patron.test(texto), `${clave} dice "${texto}" y matchea ${patron}`).toBe(false);
        }
      }
    });

    it("ninguna trae un número, que sería el dato inventado", () => {
      for (const clave of ESPERADAS) {
        // Se permite el 0 de nada; lo que no se permite es una cifra presentada como medición.
        expect(/\d+([.,]\d+)?\s*(%|USD|\$)/.test(queVaAHacer(clave)), `${clave} trae una cifra`).toBe(false);
      }
    });

    it("están escritas en presente y desde el producto, no desde el código", () => {
      for (const clave of ESPERADAS) {
        const texto = queVaAHacer(clave);
        expect(texto.startsWith("Va a"), `${clave} no arranca con "Va a": "${texto}"`).toBe(true);
      }
    });
  });

  /**
   * ── Las dos `ci.*` no pueden contradecir al backend ─────────────────
   *
   * Quién decide de verdad si un auditor existe es `AUDITORES_ACTIVOS` en
   * `api/_lib/analizador.ts`: de ahí sale `agentesConAuditor`, y con eso la tarjeta de
   * `AgentsAudit` decide si muestra métricas o el motivo de su ausencia.
   *
   * Las entradas `ci.*` de este catálogo son la versión de producto del mismo hecho. Si alguien
   * enciende el auditor del setter en el backend y se olvida de acá, la app quedaría diciendo
   * dos cosas a la vez. Este test lo impide.
   *
   * Se lee el FUENTE en vez de importar el módulo a propósito: `analizador.ts` arrastra el SDK
   * de Anthropic y la capa de base de datos, y este test no necesita nada de eso para comparar
   * una lista. Es la misma técnica de `api/_lib/aislamiento.test.ts`.
   */
  describe("coherencia con AUDITORES_ACTIVOS del backend", () => {
    const AQUI = dirname(fileURLToPath(import.meta.url)); // …/src/lib
    const fuente = readFileSync(resolve(AQUI, "..", "..", "api", "_lib", "analizador.ts"), "utf8");
    const linea = /export const AUDITORES_ACTIVOS: readonly AgenteTextoId\[\] = \[([^\]]*)\]/.exec(fuente);

    it("se pudo leer la lista del backend (el test no se rompió en silencio)", () => {
      expect(linea, "no se encontró AUDITORES_ACTIVOS en api/_lib/analizador.ts").not.toBeNull();
    });

    const activos = (linea?.[1] ?? "").split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);

    it("el auditor del setter está en desarrollo exactamente si no está activo en el backend", () => {
      expect(estaEnDesarrollo("ci.auditor_setter")).toBe(!activos.includes("lead-flow-ai"));
    });

    /** Los dos de voz: mientras ninguno esté activo, la clave sigue en desarrollo. */
    it("los de voz están en desarrollo exactamente si no hay ninguno activo", () => {
      const hayVoz = activos.some((a) => a.endsWith("-voz"));
      expect(estaEnDesarrollo("ci.auditor_voz")).toBe(!hayVoz);
    });
  });
});
