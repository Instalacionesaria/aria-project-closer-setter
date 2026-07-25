import { describe, it, expect } from "vitest";
import { hoyISO, isoEnDias, sumarDias, diasEntre, diasVencido, fechaCorta } from "./fechas";

/**
 * El caso que motiva todo el módulo: en Lima (UTC-5), a partir de las 19:00 el
 * instante ya cayó en el día siguiente en UTC. La implementación vieja truncaba
 * `toISOString()`, así que devolvía un día de más durante las últimas cinco horas
 * de cada jornada.
 */
describe("hoyISO — el día civil de la organización, no el del browser ni el de UTC", () => {
  it("a las 20:00 de Lima sigue siendo el mismo día, aunque en UTC ya sea el siguiente", () => {
    const veinteHorasLima = new Date("2026-07-25T20:00:00-05:00");
    expect(veinteHorasLima.toISOString().slice(0, 10)).toBe("2026-07-26"); // lo que hacía el bug
    expect(hoyISO(veinteHorasLima)).toBe("2026-07-25"); // lo correcto
  });

  it("a las 23:00 de Lima — el caso extremo — todavía es el 25", () => {
    expect(hoyISO(new Date("2026-07-25T23:00:00-05:00"))).toBe("2026-07-25");
  });

  it("un minuto después de medianoche ya es el día siguiente", () => {
    expect(hoyISO(new Date("2026-07-26T00:01:00-05:00"))).toBe("2026-07-26");
  });

  it("no depende de la zona del cliente: el mismo instante da el mismo día civil", () => {
    const instante = new Date("2026-07-26T02:00:00Z"); // 21:00 del 25 en Lima
    expect(hoyISO(instante)).toBe("2026-07-25");
  });
});

describe("isoEnDias — los presets del modal de Seguimiento", () => {
  const nocheDeLima = new Date("2026-07-25T20:00:00-05:00");

  it('"Mañana" a las 20:00 de Lima devuelve el 26, no el 27', () => {
    expect(isoEnDias(1, nocheDeLima)).toBe("2026-07-26");
  });

  it('"En 3 días" y "1 semana" cuentan desde el día civil de Lima', () => {
    expect(isoEnDias(3, nocheDeLima)).toBe("2026-07-28");
    expect(isoEnDias(7, nocheDeLima)).toBe("2026-08-01");
  });

  it("de madrugada en Lima cuenta desde el día que empieza, no desde el anterior", () => {
    expect(isoEnDias(1, new Date("2026-07-26T00:30:00-05:00"))).toBe("2026-07-27");
  });
});

describe("sumarDias — aritmética de calendario, sin zonas", () => {
  it("cruza fin de mes", () => {
    expect(sumarDias("2026-07-31", 1)).toBe("2026-08-01");
  });

  it("cruza fin de año", () => {
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
  });

  it("respeta los años bisiestos", () => {
    expect(sumarDias("2028-02-28", 1)).toBe("2028-02-29");
    expect(sumarDias("2027-02-28", 1)).toBe("2027-03-01");
  });

  it("acepta días negativos", () => {
    expect(sumarDias("2026-08-01", -1)).toBe("2026-07-31");
  });
});

describe("diasEntre / diasVencido — deciden el tinte de la fila", () => {
  it("cuenta días completos en ambos sentidos", () => {
    expect(diasEntre("2026-07-25", "2026-07-28")).toBe(3);
    expect(diasEntre("2026-07-28", "2026-07-25")).toBe(-3);
    expect(diasEntre("2026-07-25", "2026-07-25")).toBe(0);
  });

  it("vencer HOY no es estar vencido — es 0, y la fila no se tiñe de rojo", () => {
    const hoy = new Date("2026-07-25T09:00:00-05:00");
    expect(diasVencido("2026-07-25", hoy)).toBe(0);
  });

  it("ayer es 1 día de atraso; mañana es negativo (todavía no vence)", () => {
    const hoy = new Date("2026-07-25T09:00:00-05:00");
    expect(diasVencido("2026-07-24", hoy)).toBe(1);
    expect(diasVencido("2026-07-26", hoy)).toBe(-1);
  });

  it("a las 23:00 de Lima un seguimiento de hoy sigue sin estar vencido", () => {
    expect(diasVencido("2026-07-25", new Date("2026-07-25T23:30:00-05:00"))).toBe(0);
  });
});

describe("fechaCorta — segunda línea de la fila", () => {
  it("formatea sin punto abreviador", () => {
    expect(fechaCorta("2026-07-24")).toBe("24 jul");
  });

  it("no se corre un día por la zona del cliente", () => {
    expect(fechaCorta("2026-01-01")).toBe("01 ene");
  });

  it("string vacío no rompe", () => {
    expect(fechaCorta("")).toBe("");
  });
});
