// @vitest-environment jsdom
//
// El único archivo del proyecto que pide jsdom: la config global es `node` porque hasta hoy
// todo lo testeado era lógica pura. Acá hace falta un `window` de verdad — lo que se prueba es
// que el evento llegue, y eso no se puede probar sin quien lo despacha y quien lo escucha.

/**
 * El canal de avisos: lo que convierte un `console.warn` que nadie lee en algo que la persona ve.
 *
 * Se prueba de verdad —con `window` y listeners reales, no con mocks— porque lo único que
 * importa de este módulo es que el evento LLEGUE. Un test que espíe la función y no el evento
 * pasaría con un `dispatchEvent` mal escrito.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { EVENTO_AVISO, emitirAviso, emitirAvisos } from "./avisos";

/** Escucha y devuelve los textos recibidos, más la función para dejar de escuchar. */
function espiar() {
  const recibidos: string[] = [];
  const oyente = (e: Event) =>
    recibidos.push((e as CustomEvent<string>).detail);
  window.addEventListener(EVENTO_AVISO, oyente);
  return {
    recibidos,
    parar: () => window.removeEventListener(EVENTO_AVISO, oyente),
  };
}

describe("emitirAviso", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publica el texto tal cual en el detail del evento", () => {
    const { recibidos, parar } = espiar();
    emitirAviso("La nota no se guardó: permiso denegado.");
    parar();
    expect(recibidos).toEqual(["La nota no se guardó: permiso denegado."]);
  });

  /**
   * Un aviso en blanco abriría un toast que no dice nada, y el usuario aprendería a ignorarlos.
   * `undefined` y `null` entran de verdad: el backend manda `advertencias` opcional.
   */
  it("no publica nada vacío, ni undefined, ni null, ni espacios", () => {
    const { recibidos, parar } = espiar();
    emitirAviso("");
    emitirAviso("   ");
    emitirAviso(undefined);
    emitirAviso(null);
    parar();
    expect(recibidos).toEqual([]);
  });

  it("recorta los espacios de los bordes", () => {
    const { recibidos, parar } = espiar();
    emitirAviso("  con espacios  ");
    parar();
    expect(recibidos).toEqual(["con espacios"]);
  });

  /**
   * Los tests del backend y cualquier import desde Node corren sin `window`. Que esto lance
   * convertiría un aviso —lo menos importante de la operación— en el error que la tumba.
   */
  it("no lanza cuando no hay window", () => {
    vi.stubGlobal("window", undefined);
    expect(() => emitirAviso("algo")).not.toThrow();
  });
});

describe("emitirAvisos", () => {
  it("publica uno por cada advertencia, en orden", () => {
    const { recibidos, parar } = espiar();
    emitirAvisos([
      "La nota no se guardó: timeout.",
      "closer_avances: permiso denegado.",
    ]);
    parar();
    expect(recibidos).toEqual([
      "La nota no se guardó: timeout.",
      "closer_avances: permiso denegado.",
    ]);
  });

  /** `advertencias` es opcional en la respuesta: sin ella no pasa nada, no revienta. */
  it("undefined y lista vacía no publican nada", () => {
    const { recibidos, parar } = espiar();
    emitirAvisos(undefined);
    emitirAvisos([]);
    parar();
    expect(recibidos).toEqual([]);
  });
});
