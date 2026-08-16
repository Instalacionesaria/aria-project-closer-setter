/**
 * El chip "N verdes de M" cuenta UNA población.
 *
 * ── Por qué existe este test ──
 *
 * Este bug ya se rompió dos veces, con la misma forma y en el mismo chip:
 *
 *   1. La query del numerador no filtraba `auditable` ni `disparo`, y la vista del denominador sí:
 *      un análisis no auditable podía sumar arriba y no abajo, y "3 verdes de 2" es un número
 *      imposible. Se arregló agregando los filtros a la query.
 *   2. Ese arreglo agregó además `nivel is not null` al numerador — correcto, porque una fila sin
 *      nivel no puede ser verde— pero **no** al denominador. Resultado medido en producción el
 *      2026-08-16: la tarjeta de `appointment-flow-ai` decía **"0 VERDES de 3"** cuando lo honesto
 *      era "0 de 1". Las otras dos filas son legado de la `031` y no pueden ser verdes nunca.
 *      Se arregló con la `040`, que agrega `con_veredicto` a la vista.
 *
 * Las dos veces el error fue el mismo: **alguien tocó una mitad del chip y no la otra**. Ninguna
 * de las dos rompió un test ni lanzó un error — el número simplemente quedó mal, con toda la cara
 * de un dato medido. Este test hace que tocar una mitad y no la otra falle.
 *
 * Es un test sobre el texto del fuente y del SQL, como `aislamiento.test.ts`: las dos mitades viven
 * en lenguajes distintos —una query de PostgREST y una vista de Postgres— y lo único que las ata
 * es que digan lo mismo. Eso no se ve desde una aserción sobre un resultado.
 *
 * El guion bajo del nombre: Vercel publica todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(import.meta.dirname, "../..");
const leer = (rel: string) => readFileSync(resolve(RAIZ, rel), "utf8");

const TEXTO = leer("api/agentes/texto.ts");
const VISTA = leer("docs/db/040_denominador_con_veredicto.sql");

/** El cuerpo de `verdesDe()`, que es el numerador. */
const NUMERADOR = (() => {
  const i = TEXTO.indexOf("async function verdesDe(");
  expect(i, "no se encontró verdesDe()").toBeGreaterThan(-1);
  const desde = TEXTO.slice(i);
  return desde.slice(0, desde.indexOf("\n}") + 2);
})();

describe("las dos mitades del chip filtran lo mismo", () => {
  /**
   * Los tres filtros que definen "análisis que PUEDE ser verde". Si el numerador gana o pierde uno,
   * el denominador tiene que moverse con él.
   */
  it("el numerador exige auditable, no linea_base y nivel presente", () => {
    expect(NUMERADOR).toContain('.eq("auditable", true)');
    expect(NUMERADOR).toContain('.neq("disparo", "linea_base")');
    expect(NUMERADOR).toContain('.not("nivel", "is", null)');
  });

  it("y el denominador (con_veredicto) exige exactamente lo mismo", () => {
    // Los dos primeros, en el WHERE de la vista; el tercero, en el FILTER de la columna.
    expect(VISTA).toMatch(/where[\s\S]*and auditable/);
    expect(VISTA).toMatch(/where[\s\S]*disparo <> 'linea_base'/);
    expect(VISTA).toMatch(
      /count\(\*\) filter \(where nivel is not null\) as con_veredicto/,
    );
  });

  /**
   * El error de la segunda vez, fijado: la vista tiene DOS contadores y hay que usar el correcto.
   * `analisis` cuenta todo lo medido (población del sentimiento) y siempre es >= `con_veredicto`.
   */
  it("la tarjeta usa con_veredicto como denominador, no analisis", () => {
    expect(TEXTO).toContain("conVeredicto: Number(data.con_veredicto ?? 0)");
    // La métrica de voz es "% de llamadas verdes sobre las que tienen veredicto".
    expect(TEXTO).toContain("const analizadas = agregado?.conVeredicto ?? 0;");
  });

  it("y lo publica en el contrato, porque quien pinta el chip está del otro lado", () => {
    expect(TEXTO).toContain("conVeredicto: agregado?.conVeredicto ?? 0,");
    expect(leer("src/views/AgentsAudit.tsx")).toContain(
      "de {agent.conVeredicto}",
    );
  });
});

describe("el sentimiento conserva su propia población", () => {
  /**
   * La tentación al arreglar esto era meter `nivel is not null` en el WHERE de la vista. Habría
   * roto el panel de ánimo: el sentimiento de una fila legacy es un dato válido —el modelo lo
   * midió— y no depende del veredicto. Este test impide ese "arreglo".
   */
  it("los porcentajes de ánimo NO se filtran por nivel", () => {
    const pcts = VISTA.match(/round\(100\.0[\s\S]*?as pct_\w+/g) ?? [];
    expect(
      pcts.length,
      "no se encontraron los tres porcentajes de sentimiento",
    ).toBe(3);
    for (const p of pcts) {
      expect(p, "un porcentaje de ánimo se filtró por nivel").not.toContain(
        "nivel",
      );
    }
  });

  it("y `analisis` sigue contando todo lo medido", () => {
    expect(VISTA).toContain("count(*) as analisis");
  });
});
