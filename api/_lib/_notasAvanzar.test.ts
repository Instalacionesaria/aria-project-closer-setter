/**
 * Toda ruta de Avanzar que acepte una nota tiene que dejarla en `closer_notas`.
 *
 * ── El bug que motivó estos tests (2026-08-15) ──
 *
 * Fabio reportó que las notas no se guardaban. Había tres rutas de Avanzar y solo UNA escribía
 * en `closer_notas`:
 *
 *   · `registrarResultadoAvanzar` — las cinco salidas del closer que no son Seguimiento. ✅
 *   · `registrarSeguimiento` — Seguimiento, de closer Y setter. Mandaba la nota a la RPC, que la
 *     guarda en `closer_seguimientos.nota`: otra tabla, otro lector. La ficha nunca la veía. ❌
 *   · El `otraSalida` del setter — la dejaba en `closer_avances.detalle->>'nota'`, JSON del
 *     timeline que nadie lee para pintar la ficha. ❌
 *
 * Las tres pintaban la nota en pantalla igual, así que las dos rotas producían el peor síntoma
 * posible: el usuario la veía guardada y desaparecía al recargar. El éxito falso de la regla 2.
 *
 * Son tests sobre el TEXTO del fuente, como `aislamiento.test.ts`: lo que hay que impedir no es
 * un valor mal calculado sino una ruta que se olvida de persistir, y eso no se ve desde una
 * aserción sobre un resultado — se ve mirando quién llama a quién. Un test de comportamiento
 * exigiría la base real, que es justo lo que no corre en `npm test`.
 *
 * El guion bajo del nombre: Vercel publica todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(import.meta.dirname, "../..");

/** Sin comentarios: esta misma cabecera nombra `closer_notas` y haría fallar la regla de abajo. */
function fuente(rel: string): string {
  return readFileSync(resolve(RAIZ, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const SEGUIMIENTOS = fuente("api/_lib/seguimientos.ts");
const AVANZAR_SETTER = fuente("api/setter/avanzar.ts");
const AVANZAR_CLOSER = fuente("api/closer/avanzar.ts");

/** El cuerpo de una función exportada, de su firma a la que le sigue. */
function cuerpoDe(codigo: string, nombre: string): string {
  const i = codigo.indexOf(`export async function ${nombre}(`);
  expect(i, `no se encontró ${nombre}()`).toBeGreaterThan(-1);
  const desde = codigo.slice(i + 1);
  const j = desde.indexOf("\nexport async function ");
  return j === -1 ? desde : desde.slice(0, j);
}

describe("las tres rutas de Avanzar guardan la nota en el tab Notas", () => {
  it("Seguimiento (closer y setter) llama a guardarNotaDeAvance", () => {
    // El setter reusa esta función entera, así que este test cubre los dos roles.
    expect(cuerpoDe(SEGUIMIENTOS, "registrarSeguimiento")).toContain(
      "guardarNotaDeAvance(",
    );
  });

  it("las otras cinco salidas del closer también", () => {
    expect(cuerpoDe(SEGUIMIENTOS, "registrarResultadoAvanzar")).toContain(
      "guardarNotaDeAvance(",
    );
  });

  it("y las cuatro salidas del setter, que van por proyectarAvance", () => {
    expect(AVANZAR_SETTER).toContain("guardarNotaDeAvance(");
    // Donde importa: la salida que NO es seguimiento. Si solo estuviera en `salidaSeguimiento`,
    // el test de arriba pasaría y una venta LT con nota la seguiría perdiendo.
    const otra = AVANZAR_SETTER.slice(
      AVANZAR_SETTER.indexOf("async function otraSalida("),
    );
    expect(otra).toContain("guardarNotaDeAvance(");
  });

  /**
   * La regla que evita que esto vuelva: **una sola** función escribe en `closer_notas` del lado
   * de Avanzar. Con tres inserts sueltos, agregar una salida nueva y olvidarse de la nota no
   * rompe nada visible — que es exactamente cómo nacieron los dos casos rotos.
   */
  it("nadie inserta en closer_notas por su cuenta: solo el helper", () => {
    const inserts = SEGUIMIENTOS.split('from("closer_notas")').length - 1;
    expect(
      inserts,
      "hay más de un escritor de closer_notas en seguimientos.ts",
    ).toBe(1);
    expect(AVANZAR_SETTER).not.toContain('from("closer_notas")');
    expect(AVANZAR_CLOSER).not.toContain('from("closer_notas")');
  });
});

describe("si la nota no se guarda, la respuesta lo dice (regla 2)", () => {
  it("guardarNotaDeAvance devuelve la advertencia en vez de tragarse el error", () => {
    const helper = cuerpoDe(SEGUIMIENTOS, "guardarNotaDeAvance");
    expect(helper).toContain("La nota no se guardó");
    // No lanza: una nota que falla no puede impedir registrar una venta.
    expect(helper).not.toContain("throw");
  });

  it("registrarSeguimiento devuelve advertencias, y los dos endpoints las publican", () => {
    expect(cuerpoDe(SEGUIMIENTOS, "registrarSeguimiento")).toContain(
      "advertencias",
    );
    for (const endpoint of [AVANZAR_CLOSER, AVANZAR_SETTER]) {
      expect(endpoint).toContain("advertencias");
    }
  });
});
