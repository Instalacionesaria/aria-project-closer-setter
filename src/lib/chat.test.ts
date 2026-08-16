import { describe, expect, it } from "vitest";
import { fusionarMensajes, type MensajeFusionable } from "./chat";

const srv = (text: string, outgoing = true): MensajeFusionable => ({
  text,
  outgoing,
  estado: "delivered",
});
const enviando = (text: string): MensajeFusionable => ({
  text,
  outgoing: true,
  estado: "enviando",
});
const fallido = (text: string): MensajeFusionable => ({
  text,
  outgoing: true,
  estado: "failed",
});

const textos = (ms: MensajeFusionable[]) => ms.map((m) => m.text);

describe("lo que el closer acaba de mandar no desaparece", () => {
  /**
   * EL bug reportado: el reloj repregunta cada 5 s, la respuesta todavía no trae el mensaje
   * recién enviado, y el reemplazo lo borraba de la pantalla. Volvía unos segundos después.
   */
  it("una burbuja en vuelo sobrevive al poll que todavía no la trae", () => {
    const r = fusionarMensajes(
      [srv("Hola"), srv("¿Cómo estás?", false)],
      [enviando("Te mando el link")],
    );
    expect(textos(r)).toEqual(["Hola", "¿Cómo estás?", "Te mando el link"]);
  });

  it("y se suelta en cuanto el servidor la devuelve", () => {
    const r = fusionarMensajes(
      [srv("Hola"), srv("Te mando el link")],
      [enviando("Te mando el link")],
    );
    expect(textos(r)).toEqual(["Hola", "Te mando el link"]);
    // Una sola vez: no puede quedar duplicada al confirmarse.
    expect(r.filter((m) => m.text === "Te mando el link")).toHaveLength(1);
  });

  /**
   * El caso peor del bug viejo: un envío que falló de verdad se marcaba `failed` en local, y como
   * el servidor nunca lo tuvo, el siguiente poll lo borraba. El closer veía el error un segundo y
   * después nada — un mensaje que el contacto no recibió, desaparecido sin rastro.
   */
  it("un envío fallido NO se borra: es lo único que dice que el contacto no lo recibió", () => {
    const r = fusionarMensajes([srv("Hola")], [fallido("Esto no salió")]);
    expect(textos(r)).toEqual(["Hola", "Esto no salió"]);
    expect(r[1].estado).toBe("failed");
  });
});

describe("se cuentan copias, no presencia", () => {
  /**
   * Mandar "ok" dos veces seguidas es normal. Con un `Set`, la segunda burbuja se daba por
   * confirmada apenas llegaba la primera del servidor y desaparecía habiendo salido de verdad.
   */
  it("dos mensajes de igual texto: el servidor confirma uno y el otro sigue en vuelo", () => {
    const r = fusionarMensajes([srv("ok")], [enviando("ok"), enviando("ok")]);
    expect(textos(r)).toEqual(["ok", "ok"]);
    expect(r.filter((m) => m.estado === "enviando")).toHaveLength(1);
  });

  it("y cuando llegan las dos, no queda ninguna en vuelo", () => {
    const r = fusionarMensajes(
      [srv("ok"), srv("ok")],
      [enviando("ok"), enviando("ok")],
    );
    expect(textos(r)).toEqual(["ok", "ok"]);
    expect(r.some((m) => m.estado === "enviando")).toBe(false);
  });
});

describe("lo que NO se conserva de la lista anterior", () => {
  /**
   * El servidor manda la verdad de todo lo confirmado. Conservar copias locales de mensajes ya
   * entregados los duplicaría, y peor: dejaría en pantalla un estado viejo (un `delivered` que
   * después pasó a `failed` en Meta, que es el bug del 2026-08-05).
   */
  it("un mensaje ya confirmado no se arrastra desde la lista vieja", () => {
    const r = fusionarMensajes([srv("Hola")], [srv("Hola"), srv("Algo viejo")]);
    expect(textos(r)).toEqual(["Hola"]);
  });

  /** Un entrante nunca está "en vuelo": lo escribió el contacto y solo el servidor lo conoce. */
  it("los entrantes locales tampoco: mandan los del servidor", () => {
    const r = fusionarMensajes(
      [srv("Hola", false)],
      [{ text: "fantasma", outgoing: false, estado: null }],
    );
    expect(textos(r)).toEqual(["Hola"]);
  });
});

describe("bordes", () => {
  it("sin nada previo devuelve lo del servidor tal cual", () => {
    expect(textos(fusionarMensajes([srv("a"), srv("b")], []))).toEqual([
      "a",
      "b",
    ]);
  });

  /**
   * Conversación nueva: el servidor todavía no tiene nada y el primer mensaje ya se envió. Si
   * esto devolviera vacío, el chat se vería en blanco justo después de escribir.
   */
  it("con el servidor vacío conserva lo que está viajando", () => {
    expect(textos(fusionarMensajes([], [enviando("primero")]))).toEqual([
      "primero",
    ]);
  });

  it("no muta las listas que recibe", () => {
    const servidor = [srv("a")];
    const previos = [enviando("b")];
    fusionarMensajes(servidor, previos);
    expect(servidor).toHaveLength(1);
    expect(previos).toHaveLength(1);
  });
});
