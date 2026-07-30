/**
 * Las dos validaciones que sostienen `POST /api/closer/avanzar`.
 *
 * Ambas cubren fallos que NO se ven compilando ni probando a mano:
 *
 *   1. **Traducción de etiquetas.** Un valor de dropdown que no matchea EXACTO hace que GHL
 *      devuelva 200 y no escriba nada (§50.5). Este test cruza los strings que manda hoy
 *      `src/views/ContactDrawer.tsx` contra las opciones declaradas en el catálogo — si
 *      alguien cambia una etiqueta de un lado y no del otro, se rompe acá y no en
 *      producción, en silencio, tres semanas después.
 *
 *      ⚠️ Los arrays de abajo son una COPIA de los del front (no están exportados, y
 *      importarlos traería React a un test de Node). Cambiar una etiqueta en la UI obliga a
 *      cambiarla acá también — que es justamente el momento en que este test hace su trabajo.
 *
 *   2. **Validación del `resultado`.** El helper del catálogo resuelve con `in`, que recorre
 *      la cadena de prototipos. El endpoint tapa ese agujero cruzando con las claves propias.
 */

import { describe, expect, it } from "vitest";
import { RESULTADOS, esResultadoValido } from "../../src/lib/ghl/resultados.js";
import { resolverSubcategoria } from "./seguimientos.js";

/* Copia literal de lo que manda `src/views/ContactDrawer.tsx`. */
const NO_INTERESA_RAZONES = ["Precio", "No es el momento", "Competencia", "No califica", "Otro"];
const NO_SHOW_RAZONES = ["Avisó · quiere reagendar", "Plantón · sin aviso", "Falla técnica", "Datos incorrectos"];
const TIPOS_PAGO = ["Contado", "Splitwise", "Buy Now Pay Later", "Cuotas"];
const NURTURE_MOTIVOS = ["Pidió tiempo", "Se enfrió"];
const SITUACIONES_UI = ["Próximo a pagar", "Muy interesado", "Dudando", "Enfriándose", "Otro"];

describe("traducción de la etiqueta de la UI al literal del dropdown de GHL", () => {
  it("no-show: el separador tipográfico desaparece y sale el literal del catálogo", () => {
    expect(NO_SHOW_RAZONES.map((r) => resolverSubcategoria("no_show", r))).toEqual([
      "Avisó quiere reagendar",
      "Plantón sin aviso",
      "Falla técnica",
      "Datos incorrectos",
    ]);
  });

  it("las cuatro pantallas restantes ya coinciden con el catálogo, sin traducir", () => {
    for (const r of NO_INTERESA_RAZONES) expect(resolverSubcategoria("no_interesa", r)).toBe(r);
    for (const r of TIPOS_PAGO) expect(resolverSubcategoria("venta", r)).toBe(r);
    for (const r of NURTURE_MOTIVOS) expect(resolverSubcategoria("nurture", r)).toBe(r);
    for (const r of SITUACIONES_UI) expect(resolverSubcategoria("seguimiento", r)).toBe(r);
  });

  it("tolera una tilde perdida, pero lo que sale es SIEMPRE el literal del catálogo", () => {
    expect(resolverSubcategoria("no_show", "planton sin aviso")).toBe("Plantón sin aviso");
    expect(resolverSubcategoria("seguimiento", "ENFRIANDOSE")).toBe("Enfriándose");
  });

  it("un valor desconocido devuelve null en vez de mandarse igual", () => {
    expect(resolverSubcategoria("no_show", "Se fue a pescar")).toBeNull();
    // Acordó comprar no tiene dropdown: no hay nada contra qué matchear.
    expect(resolverSubcategoria("acordo", "lo que sea")).toBeNull();
  });
});

describe("validación del resultado recibido", () => {
  const CLAVES = Object.keys(RESULTADOS);
  const esResultado = (v: string) => CLAVES.includes(v) && esResultadoValido(v);

  it("el catálogo tiene las 6 salidas del closer", () => {
    expect([...CLAVES].sort()).toEqual(["acordo", "no_interesa", "no_show", "nurture", "seguimiento", "venta"]);
  });

  it("`esResultadoValido` NO deja pasar las claves heredadas del prototipo", () => {
    // Antes resolvía con `in`, que recorre la cadena de prototipos: `"toString"` pasaba la
    // validación y después reventaba al buscarlo en el catálogo. Ahora usa `Object.hasOwn`,
    // así que el helper es correcto por sí mismo y no depende de que cada consumidor lo
    // cruce con las claves propias.
    expect(esResultadoValido("toString")).toBe(false);
    expect(esResultadoValido("constructor")).toBe(false);
    expect(esResultado("toString")).toBe(false);
    expect(esResultado("venta_lt")).toBe(false); // esa es una salida del setter, no del closer
    expect(esResultadoValido("venta")).toBe(true); // las reales siguen pasando
  });
});
