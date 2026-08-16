/**
 * Los cinco endpoints de la ficha del contacto aceptan los mismos roles.
 *
 * ── Por qué hace falta fijarlo ──
 *
 * La ficha se abre desde tres lugares: Closer, Setter y **Auditoría de Agentes**, que es una
 * pantalla de rol `tecnico` (`src/App.tsx`). Sus tabs se llenan con cinco endpoints distintos, y
 * hasta el 2026-08-15 solo UNO de los cinco —`llamadas.ts`— incluía a `tecnico`. Los otros cuatro
 * devolvían 403, y el `catch` del front lo convertía en un tab vacío: quien auditaba abría la
 * ficha de una persona real y veía "sin mensajes", "sin notas", "sin historial".
 *
 * Ese es el modo de fallo que este test impide: **el 403 no se ve como error, se ve como dato
 * vacío**. Nada falla, nadie se entera, y el contacto parece no tener nada.
 *
 * Es un test sobre el texto del fuente, como `aislamiento.test.ts`: lo que hay que impedir es que
 * un endpoint nuevo de la ficha —o una edición de uno viejo— se salga del conjunto sin que nadie
 * lo note. Eso no se ve desde una aserción sobre un resultado.
 *
 * El guion bajo del nombre: Vercel publica todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(import.meta.dirname, "../..");

/** Los que llenan los tabs de la ficha. Si nace un sexto, va acá. */
const ENDPOINTS_DE_LA_FICHA = [
  "api/closer/notas.ts",
  "api/closer/historial.ts",
  "api/closer/perfil.ts",
  "api/closer/chat.ts",
  "api/closer/llamadas.ts",
];

const fuente = (rel: string) => readFileSync(resolve(RAIZ, rel), "utf8");

/** La lista de roles del `exigir(...)` del handler, tal cual está escrita. */
function rolesDe(rel: string): string {
  const m = fuente(rel).match(/exigir\(\s*req,\s*res,\s*\[([^\]]*)\]/);
  expect(m, `${rel} no llama a exigir(req, res, [...])`).toBeTruthy();
  return (m?.[1] ?? "").replace(/\s+/g, "");
}

describe("la ficha se ve entera desde Auditoría de Agentes", () => {
  it.each(ENDPOINTS_DE_LA_FICHA)("%s acepta al técnico", (rel) => {
    expect(rolesDe(rel)).toContain('"tecnico"');
  });

  /**
   * Los cinco iguales, no "cada uno los suyos". Un tab que pide un rol distinto de sus hermanos
   * es una ficha que se ve a medias, y se descubre mirándola, no ejecutando nada.
   */
  it("los cinco piden exactamente el mismo conjunto de roles", () => {
    const conjuntos = new Set(ENDPOINTS_DE_LA_FICHA.map(rolesDe));
    expect(
      [...conjuntos],
      "los endpoints de la ficha divergieron en sus roles",
    ).toHaveLength(1);
  });

  /** Que se sumen roles no puede significar que se pierdan: closer y setter siguen entrando. */
  it("sin perder a closer ni a setter", () => {
    for (const rel of ENDPOINTS_DE_LA_FICHA) {
      expect(rolesDe(rel)).toContain('"closer"');
      expect(rolesDe(rel)).toContain('"setter"');
    }
  });

  /**
   * `mi-dia` NO está en la lista y es a propósito: es la cola de trabajo del closer, no un tab de
   * la ficha. Si algún día acepta `tecnico`, que sea por una decisión escrita y no por arrastre
   * de este test.
   */
  it("y la cola de trabajo del closer sigue siendo solo suya", () => {
    expect(rolesDe("api/closer/mi-dia.ts")).not.toContain('"tecnico"');
  });
});
