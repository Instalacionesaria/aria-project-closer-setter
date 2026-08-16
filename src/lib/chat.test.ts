import { describe, expect, it } from "vitest";
import {
  etiquetaDeDia,
  fusionarMensajes,
  type MensajeFusionable,
} from "./chat";

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

describe("el separador de día: el orden correcto no se puede leer como desorden", () => {
  /**
   * El bug de la captura de Fabio (2026-08-16): el chat tenía UN "HOY" escrito a mano arriba de
   * todo y ningún separador más, así que días distintos quedaban pegados y solo cambiaba la hora:
   *
   *     19:14  Gracias los veo mañana
   *     08:09  Ya lo vi               <-- parece que retrocede en el tiempo
   *
   * Los mensajes estaban bien ordenados. Lo que faltaba era decir dónde cambia el día.
   */
  const HOY = "2026-08-16";

  it("hoy y ayer se dicen con palabras, no con fecha", () => {
    expect(etiquetaDeDia("2026-08-16", HOY)).toBe("HOY");
    expect(etiquetaDeDia("2026-08-15", HOY)).toBe("AYER");
  });

  it("más atrás, la fecha completa", () => {
    expect(etiquetaDeDia("2026-08-12", HOY)).toContain("12");
    expect(etiquetaDeDia("2026-08-12", HOY)).toContain("2026");
  });

  /** Cruzar mes y año son los dos bordes donde un cálculo de días a mano se equivoca. */
  it("cruza el fin de mes", () => {
    expect(etiquetaDeDia("2026-07-31", "2026-08-01")).toBe("AYER");
  });

  it("y el fin de año", () => {
    expect(etiquetaDeDia("2025-12-31", "2026-01-01")).toBe("AYER");
  });

  /** Una fecha ilegible se muestra cruda: inventar un día sería peor que no saberlo. */
  it("una fecha rota no se inventa", () => {
    expect(etiquetaDeDia("no-es-fecha", HOY)).toBe("no-es-fecha");
  });
});
