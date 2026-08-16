/**
 * La ficha huérfana: la que se abre desde Auditoría de Agentes sobre alguien que no está en las
 * colas de hoy.
 *
 * ── Por qué estos tests son sobre el texto del fuente ──
 *
 * El defecto que fijan no es un valor mal calculado: es una prop que se pasa siempre y una rama
 * que no persiste. Eso no se ve desde una aserción sobre un resultado — se ve mirando quién le
 * pasa qué a quién. Mismo criterio que `aislamiento.test.ts` y `_notasAvanzar.test.ts`. Montar el
 * drawer entero para probarlo exigiría los tres stores, el auth y el reloj del chat.
 *
 * El bug (2026-08-15): `AgentsAudit` abre la ficha de CUALQUIER conversación de los últimos 30
 * días, y casi ninguna de esas personas está en las colas del día. Con `contact` en `null`, las
 * notas caían al `useState` local del drawer y se descartaban sin guardarse ni avisar. Y como
 * `onAddNota` se pasaba SIEMPRE —aunque ninguna de sus dos ramas se cumpliera— el camino propio
 * del drawer no llegaba a correr nunca.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(import.meta.dirname, "../..");

const fuente = (rel: string) =>
  readFileSync(resolve(RAIZ, rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

const DRAWER = fuente("src/views/ContactDrawer.tsx");
const AUDITORIA = fuente("src/views/AgentsAudit.tsx");

describe("la ficha sin store guarda sus notas contra el servidor", () => {
  it("el drawer sabe reconocerla", () => {
    expect(DRAWER).toContain("const fichaHuerfana =");
    // La definición importa: con un store dueño del contacto, el camino propio NO debe correr.
    expect(DRAWER).toMatch(
      /fichaHuerfana\s*=\s*Boolean\(ghlContactId\)\s*&&\s*!contact\s*&&\s*!setterContact/,
    );
  });

  it("las pide, las crea y las borra contra la API real", () => {
    for (const fn of ["fetchNotas(", "crearNota(", "eliminarNota("]) {
      expect(DRAWER, `el drawer no llama a ${fn}`).toContain(fn);
    }
  });

  /**
   * El guard que evita el doble guardado: si hay `onAddNota`, manda el store y el drawer no
   * toca la red. Sin este `return`, un contacto del closer guardaría DOS notas por cada una
   * escrita — una por `closerStore.addNota` y otra por el camino propio.
   */
  it("cuando hay store, el drawer se aparta: no duplica la escritura", () => {
    expect(DRAWER).toContain("if (onAddNota) return onAddNota(texto);");
    expect(DRAWER).toContain("if (onDeleteNota) return onDeleteNota(id);");
  });

  /** Sin `ghlContactId` no hay a quién guardársela: es la semilla de `npm run dev`. */
  it("sin contacto real no inventa una escritura", () => {
    expect(DRAWER).toContain("if (!fichaHuerfana || !ghlContactId) return;");
  });

  it("un fallo se marca en pantalla, no solo en la consola", () => {
    expect(DRAWER).toContain("⚠ no se guardó");
  });
});

describe("Auditoría de Agentes no tapa el camino propio de la ficha", () => {
  /**
   * EL test del bug. Si `onAddNota` vuelve a pasarse incondicionalmente, el drawer nunca usa su
   * propio camino y la nota se evapora igual que antes — sin que falle nada más.
   */
  it("pasa onAddNota y onDeleteNota como undefined cuando ningún store es dueño", () => {
    for (const prop of ["onAddNota", "onDeleteNota"]) {
      const i = AUDITORIA.indexOf(`${prop}={`);
      expect(i, `${prop} no se le pasa al drawer`).toBeGreaterThan(-1);
      const bloque = AUDITORIA.slice(i, i + 420);
      expect(bloque, `${prop} no está condicionado al store`).toContain(
        "contactoFicha || setterFicha",
      );
      expect(bloque, `${prop} no cae en undefined`).toContain("undefined");
    }
  });

  it("y cuando sí hay store, sigue delegando en el que corresponde", () => {
    expect(AUDITORIA).toContain("closer.addNota(fichaAbierta, texto)");
    expect(AUDITORIA).toContain("setter.addNota(fichaAbierta, texto)");
    expect(AUDITORIA).toContain("closer.removeNota(fichaAbierta, id)");
    expect(AUDITORIA).toContain("setter.removeNota(fichaAbierta, id)");
  });
});

describe("NotaItem es uno solo", () => {
  /**
   * El drawer tenía su propia copia del tipo, idéntica salvo por `realId` —el uuid de
   * `closer_notas`—. Sin ese campo, una nota de la base es indistinguible de una optimista y no
   * hay forma de borrarla del servidor: la copia le quitaba a la ficha la única forma de
   * identificar lo que muestra (regla 3).
   */
  it("el drawer no vuelve a declarar el suyo", () => {
    expect(DRAWER).not.toMatch(/^type NotaItem = \{/m);
    expect(DRAWER).toContain("type NotaItem,");
  });
});
