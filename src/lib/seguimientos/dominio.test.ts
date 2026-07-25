import { describe, it, expect } from "vitest";
import {
  resolverFechaObjetivo,
  estaEnColaDeHoy,
  derivarFila,
  cerrarPorAvanzar,
  cerrarPorRespuesta,
  marcarReemplazado,
  tieneSeguimientoAutomaticoActivo,
  permiteSeguimientoAutomatico,
  SeguimientoInvalidoError,
  SERIE_RECUPERO,
  DIAS_GRACIA_SERIE,
  type Seguimiento,
  type CrearSeguimientoInput,
} from "./dominio";

/** 09:00 en Lima del 25 de julio de 2026. */
const HOY = new Date("2026-07-25T09:00:00-05:00");
/** 23:00 en Lima del mismo día: en UTC ya es el 26. */
const HOY_DE_NOCHE = new Date("2026-07-25T23:00:00-05:00");

const seg = (extra: Partial<Seguimiento> = {}): Seguimiento => ({
  id: "s1",
  ghlContactId: "ghl_1",
  closerId: "closer_1",
  situacion: "dudando",
  modo: "manual",
  fechaObjetivo: "2026-07-28",
  estado: "pendiente",
  creadoEl: "2026-07-25T14:00:00Z",
  creadoPor: "closer_1",
  ...extra,
});

const crear = (extra: Partial<CrearSeguimientoInput> = {}): CrearSeguimientoInput => ({
  ghlContactId: "ghl_1",
  closerId: "closer_1",
  situacion: "dudando",
  modo: "manual",
  preset: "manana",
  ...extra,
});

describe("resolverFechaObjetivo — la intención se resuelve en el servidor, no en el browser", () => {
  it("los presets manuales cuentan desde el día civil de la organización", () => {
    expect(resolverFechaObjetivo(crear({ preset: "manana" }), HOY)).toBe("2026-07-26");
    expect(resolverFechaObjetivo(crear({ preset: "en_3_dias" }), HOY)).toBe("2026-07-28");
    expect(resolverFechaObjetivo(crear({ preset: "una_semana" }), HOY)).toBe("2026-08-01");
  });

  it('a las 23:00 de Lima, "Mañana" sigue siendo el 26 — no el 27', () => {
    expect(resolverFechaObjetivo(crear({ preset: "manana" }), HOY_DE_NOCHE)).toBe("2026-07-26");
  });

  it("la fecha personalizada se toma tal cual", () => {
    const input = crear({ preset: "personalizada", fechaPersonalizada: "2026-08-15" });
    expect(resolverFechaObjetivo(input, HOY)).toBe("2026-08-15");
  });

  it("rechaza hoy y el pasado: caerían en el día en que la tarea ya se completó", () => {
    const hoyMismo = crear({ preset: "personalizada", fechaPersonalizada: "2026-07-25" });
    expect(() => resolverFechaObjetivo(hoyMismo, HOY)).toThrow(SeguimientoInvalidoError);

    const ayer = crear({ preset: "personalizada", fechaPersonalizada: "2026-07-24" });
    expect(() => resolverFechaObjetivo(ayer, HOY)).toThrow(/futura/);
  });

  it("personalizada sin fecha es un error explícito, no un undefined que se propaga", () => {
    expect(() => resolverFechaObjetivo(crear({ preset: "personalizada" }), HOY)).toThrow(/Falta la fecha/);
  });

  it("el automático apunta al fin proyectado de la serie más la gracia — no al próximo toque", () => {
    const fecha = resolverFechaObjetivo(crear({ modo: "automatico", preset: undefined }), HOY);
    expect(fecha).toBe("2026-08-04"); // 25 jul + 7 días de serie + 3 de gracia
    expect(SERIE_RECUPERO.dias + DIAS_GRACIA_SERIE).toBe(10);
  });
});

describe("estaEnColaDeHoy — la regla que define la sección", () => {
  it("un manual vencido entra", () => {
    expect(estaEnColaDeHoy(seg({ fechaObjetivo: "2026-07-24" }), HOY)).toBe(true);
  });

  it("un manual que vence hoy entra", () => {
    expect(estaEnColaDeHoy(seg({ fechaObjetivo: "2026-07-25" }), HOY)).toBe(true);
  });

  it("un manual futuro no entra", () => {
    expect(estaEnColaDeHoy(seg({ fechaObjetivo: "2026-07-28" }), HOY)).toBe(false);
  });

  /**
   * La decisión de producto del 2026-07-25, y la razón de ser de esta función.
   * Automático = "el sistema persigue por ti" (§16.1.B): no hay tarea humana mientras corre.
   */
  it("una serie automática EN CURSO no genera fila, aunque su fecha ya haya llegado", () => {
    const automatico = seg({ modo: "automatico", fechaObjetivo: "2026-07-20", estado: "pendiente" });
    expect(estaEnColaDeHoy(automatico, HOY)).toBe(false);
  });

  it("pero una serie AGOTADA sí entra — es la tarea de §16.1.D", () => {
    const agotado = seg({ modo: "automatico", fechaObjetivo: "2026-07-24", estado: "agotado" });
    expect(estaEnColaDeHoy(agotado, HOY)).toBe(true);
  });

  it.each(["completado", "cancelado", "reemplazado"] as const)("un seguimiento %s nunca entra", (estado) => {
    expect(estaEnColaDeHoy(seg({ fechaObjetivo: "2026-07-20", estado }), HOY)).toBe(false);
  });

  it("a las 23:00 de Lima un seguimiento de mañana todavía no entra", () => {
    expect(estaEnColaDeHoy(seg({ fechaObjetivo: "2026-07-26" }), HOY_DE_NOCHE)).toBe(false);
  });
});

describe("derivarFila — texto y tinte, calculados en vez de escritos a mano", () => {
  it("vencido: rojo, con los días de atraso", () => {
    const fila = derivarFila(seg({ fechaObjetivo: "2026-07-24" }), HOY);
    expect(fila).toEqual({ microtext: "vencido hace 1 día", tono: "vencido", vencido: true });
  });

  it("singular y plural bien puestos", () => {
    expect(derivarFila(seg({ fechaObjetivo: "2026-07-22" }), HOY).microtext).toBe("vencido hace 3 días");
  });

  it("vencer hoy NO es estar vencido — la fila no se tiñe de rojo", () => {
    const fila = derivarFila(seg({ fechaObjetivo: "2026-07-25" }), HOY);
    expect(fila).toEqual({ microtext: "seguimiento programado para hoy", tono: "neutral", vencido: false });
  });

  it("futuro: cuenta cuánto falta", () => {
    expect(derivarFila(seg({ fechaObjetivo: "2026-07-26" }), HOY).microtext).toBe("seguimiento programado para mañana");
    expect(derivarFila(seg({ fechaObjetivo: "2026-07-28" }), HOY).microtext).toBe("seguimiento programado en 3 días");
  });

  it("serie agotada: su propio tinte y el texto de §16.1.D", () => {
    const agotado = seg({ modo: "automatico", estado: "agotado", fechaObjetivo: "2026-07-24", serie: { key: "recupero", toques: 3, dias: 7 } });
    expect(derivarFila(agotado, HOY)).toEqual({
      microtext: "serie completada sin respuesta · hace 1 día",
      tono: "agotado",
      vencido: false,
    });
  });

  it("serie en curso: sin contador de toques inventado (§4.10)", () => {
    const enCurso = seg({ modo: "automatico", fechaObjetivo: "2026-08-04", serie: { key: "recupero", toques: 3, dias: 7 } });
    const fila = derivarFila(enCurso, HOY);
    expect(fila.microtext).toBe("Seguimiento automático · Recupero");
    expect(fila.microtext).not.toMatch(/toque|0 de/);
  });
});

describe("cierre — la cancelación universal", () => {
  it("cualquier Avanzar cancela el seguimiento abierto, con su motivo", () => {
    const cerrado = cerrarPorAvanzar(seg(), "2026-07-25T14:00:00Z");
    expect(cerrado.estado).toBe("cancelado");
    expect(cerrado.motivoCierre).toBe("avanzar");
    expect(cerrado.cerradoEl).toBe("2026-07-25T14:00:00Z");
  });

  it("la respuesta del contacto también lo cierra, con otro motivo", () => {
    expect(cerrarPorRespuesta(seg(), "2026-07-25T14:00:00Z").motivoCierre).toBe("respondio");
  });

  it("pactar uno nuevo marca el anterior como reemplazado, sin borrar historia", () => {
    const viejo = marcarReemplazado(seg(), "2026-07-25T14:00:00Z");
    expect(viejo.estado).toBe("reemplazado");
    expect(viejo.id).toBe("s1");
  });

  it("un seguimiento cerrado sale de la cola inmediatamente", () => {
    const vencido = seg({ fechaObjetivo: "2026-07-20" });
    expect(estaEnColaDeHoy(vencido, HOY)).toBe(true);
    expect(estaEnColaDeHoy(cerrarPorAvanzar(vencido, "2026-07-25T14:00:00Z"), HOY)).toBe(false);
  });
});

describe("tieneSeguimientoAutomaticoActivo — el ⏱ es derivado, no un campo", () => {
  it("se enciende solo con una serie automática pendiente", () => {
    expect(tieneSeguimientoAutomaticoActivo([seg({ modo: "automatico" })])).toBe(true);
  });

  it("un seguimiento manual no lo enciende (§16.1.C)", () => {
    expect(tieneSeguimientoAutomaticoActivo([seg({ modo: "manual" })])).toBe(false);
  });

  /** La regresión del latch: antes el campo se conservaba tras cualquier otro resultado. */
  it("se apaga solo al cancelar por Avanzar — nada de tratos ganados con el reloj prendido", () => {
    const activo = seg({ modo: "automatico" });
    expect(tieneSeguimientoAutomaticoActivo([activo])).toBe(true);
    expect(tieneSeguimientoAutomaticoActivo([cerrarPorAvanzar(activo, "2026-07-25T14:00:00Z")])).toBe(false);
  });

  it("una serie agotada tampoco lo enciende: ya no hay nada corriendo", () => {
    expect(tieneSeguimientoAutomaticoActivo([seg({ modo: "automatico", estado: "agotado" })])).toBe(false);
  });

  it("sin seguimientos, apagado", () => {
    expect(tieneSeguimientoAutomaticoActivo([])).toBe(false);
  });
});

describe("permiteSeguimientoAutomatico — Instagram, por configuración", () => {
  it("IG no admite serie automática: no hay workflow que la envíe (§11)", () => {
    expect(permiteSeguimientoAutomatico("📷 IG PROFILE")).toBe(false);
  });

  it("los demás canales sí", () => {
    expect(permiteSeguimientoAutomatico("META ADS")).toBe(true);
    expect(permiteSeguimientoAutomatico("VSL OPT-IN")).toBe(true);
    expect(permiteSeguimientoAutomatico(undefined)).toBe(true);
  });

  it("vaciar la lista de canales bloqueados lo re-habilita sin tocar código", () => {
    expect(permiteSeguimientoAutomatico("📷 IG PROFILE", [])).toBe(true);
  });
});
