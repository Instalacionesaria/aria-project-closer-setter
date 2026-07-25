import { describe, it, expect } from "vitest";
import {
  TAGS,
  CAMPOS,
  SITUACIONES,
  TAGS_SEGUIMIENTO_EXCLUYENTES,
  CAMPO_SUBCATEGORIA_POR_STAGE,
  STAGE_GHL_A_FRONT,
  situacionDesdeGhl,
  situacionPorSlug,
  perteneceAlCloser,
  assertEnviable,
  literalesPendientes,
  LiteralNoConfirmadoError,
} from "./contrato";
import { armarPildora } from "../pildora";

describe("assertEnviable — un literal inventado no puede llegar a GHL", () => {
  it("en modo stub deja pasar todo, para poder ejercitar la lógica completa", () => {
    expect(() => assertEnviable(TAGS.seguimientoManual, false)).not.toThrow();
  });

  it("en modo real lanza ante un literal pendiente de confirmar", () => {
    expect(() => assertEnviable(TAGS.seguimientoManual, true)).toThrow(LiteralNoConfirmadoError);
  });

  it("en modo real deja pasar los confirmados por el contrato", () => {
    expect(() => assertEnviable(TAGS.seguimientoRecupero, true)).not.toThrow();
    expect(() => assertEnviable(TAGS.ventaGanada, true)).not.toThrow();
    expect(() => assertEnviable(CAMPOS.nivelInteresSeguimiento, true)).not.toThrow();
  });

  it("el error dice qué falta y a quién pedírselo", () => {
    expect(() => assertEnviable(TAGS.seguimientoManual, true)).toThrow(/seguimiento_manual/);
    expect(() => assertEnviable(TAGS.seguimientoManual, true)).toThrow(/Francisco/);
  });
});

describe("literales del contrato", () => {
  it("hoy falta confirmar exactamente uno: el tag de modo manual", () => {
    expect(literalesPendientes().map((l) => l.valor)).toEqual(["seguimiento_manual"]);
  });

  it("el tag de la serie del closer es seguimiento_recupero — seguimiento_activo fue ELIMINADO", () => {
    // CONTRATO-GHL.md §9: "`seguimiento_activo`: ELIMINADO (se decidió trabajar con los
    // tags detallados directamente)". CLAUDE.md §8 todavía lo declara como fuente del ⏱;
    // esa línea queda corregida en la sección nueva.
    expect(TAGS.seguimientoRecupero.valor).toBe("seguimiento_recupero");
    const todos = Object.values(TAGS).map((t) => t.valor);
    expect(todos).not.toContain("seguimiento_activo");
  });

  it("los custom fields conservan los typos reales de GHL — son unique keys, no prosa", () => {
    // "inters" y "razn" están así en la subcuenta. Corregirlos rompe la escritura.
    expect(CAMPOS.nivelInteresSeguimiento.valor).toBe("contact.nivel_de_inters_seguimiento");
    expect(CAMPOS.razonNoshow.valor).toBe("contact.razn_de_noshow");
    expect(CAMPOS.motivoDescalificacion.valor).toBe("contact.motivo_de_descalificacin");
  });

  it("los tags de seguimiento son mutuamente excluyentes y están todos listados", () => {
    expect(TAGS_SEGUIMIENTO_EXCLUYENTES).toHaveLength(4);
    expect(TAGS_SEGUIMIENTO_EXCLUYENTES).toContain("seguimientoRecupero");
    expect(TAGS_SEGUIMIENTO_EXCLUYENTES).toContain("seguimientoManual");
  });
});

describe("zona_closer — el portón de entrada al módulo del closer", () => {
  it("es el tag que GHL aplica al agendar (WF 04.1), no uno llamado `closer`", () => {
    // El prompt original pedía filtrar por un tag `closer`. Ese tag no existe en la
    // subcuenta; el real es `zona_closer`. Verificado contra CONTRATO-GHL.md §3 y §9.
    expect(TAGS.zonaCloser.valor).toBe("zona_closer");
    expect(Object.values(TAGS).map((t) => t.valor)).not.toContain("closer");
  });

  it("deja entrar a quien lo tiene y bloquea a quien no", () => {
    expect(perteneceAlCloser(["zona_closer", "cita_agendada"], true)).toBe(true);
    expect(perteneceAlCloser(["zona_setter"], true)).toBe(false);
    expect(perteneceAlCloser([], true)).toBe(false);
  });

  /**
   * `cita_agendada` se quita al cerrar o cancelar la cita (§9). Filtrar por ahí sacaría al
   * contacto de las vistas del closer justo al terminar la llamada — que es cuando queda
   * todo el trabajo por hacer.
   */
  it("un contacto post-call, ya sin cita viva, sigue perteneciendo al closer", () => {
    expect(perteneceAlCloser(["zona_closer"], true)).toBe(true);
  });

  it("apagado por defecto: la semilla del demo no tiene tags y el filtro la vaciaría", () => {
    expect(perteneceAlCloser([])).toBe(true);
  });
});

describe("situaciones del seguimiento", () => {
  it("las cuatro del contrato están confirmadas", () => {
    const confirmadas = SITUACIONES.filter((s) => s.confianza === "confirmado").map((s) => s.label);
    expect(confirmadas).toEqual(["Próximo a pagar", "Muy interesado", "Dudando", "Enfriándose"]);
  });

  it('"Otro" existe en la pantalla aprobada (§39.1) pero no en el dropdown de GHL', () => {
    expect(situacionPorSlug("otro").confianza).toBe("pendiente");
  });

  it("lee el valor que devuelve GHL, tolerando espacios y mayúsculas", () => {
    expect(situacionDesdeGhl("Muy interesado")).toBe("muy_interesado");
    expect(situacionDesdeGhl("  próximo a pagar  ")).toBe("proximo_a_pagar");
    expect(situacionDesdeGhl("Enfriándose")).toBe("enfriandose");
  });

  it("un valor desconocido o vacío no se adivina — devuelve undefined (§4.10)", () => {
    expect(situacionDesdeGhl("Tibio")).toBeUndefined();
    expect(situacionDesdeGhl("")).toBeUndefined();
    expect(situacionDesdeGhl(null)).toBeUndefined();
  });
});

describe("mapa de stages y regla de acumulación (§4 del contrato)", () => {
  it("cada stage con subcategoría apunta a SU campo, no a otro", () => {
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.seguimiento).toBe("nivelInteresSeguimiento");
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.ganado).toBe("formaPagoVenta");
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.no_show).toBe("razonNoshow");
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.nurture).toBe("origenNurture");
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.descalificado).toBe("motivoDescalificacion");
  });

  it("agendado y cierre no tienen campo de subcategoría", () => {
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.agendado).toBeUndefined();
    expect(CAMPO_SUBCATEGORIA_POR_STAGE.cierre).toBeUndefined();
  });

  it('los stages de GHL "Cierre en curso" y "Adelanto" caen en el mismo `cierre` del front', () => {
    expect(STAGE_GHL_A_FRONT["Cierre en curso"]).toBe("cierre");
    expect(STAGE_GHL_A_FRONT["Adelanto"]).toBe("cierre");
  });
});

describe("armarPildora — CATEGORÍA · SUBCATEGORÍA en mayúsculas (§12/§39.3)", () => {
  it("un seguimiento siempre lleva la situación, nunca la fecha", () => {
    expect(armarPildora({ stage: "seguimiento", subcategoria: "Muy interesado" })).toBe("SEGUIMIENTO · MUY INTERESADO");
    expect(armarPildora({ stage: "seguimiento", subcategoria: "Dudando" })).toBe("SEGUIMIENTO · DUDANDO");
  });

  it("no se inventa subcategoría cuando GHL no tiene el dato (§4.10)", () => {
    expect(armarPildora({ stage: "seguimiento" })).toBe("SEGUIMIENTO");
    expect(armarPildora({ stage: "seguimiento", subcategoria: "  " })).toBe("SEGUIMIENTO");
    expect(armarPildora({ stage: "nurture", subcategoria: null })).toBe("NURTURE");
  });

  it("en venta y acuerdo la plata es la subcategoría", () => {
    expect(armarPildora({ stage: "ganado", monto: 5000 })).toBe("VENTA · $5.000");
    expect(armarPildora({ stage: "cierre", monto: 500 })).toBe("ACORDÓ COMPRAR · $500");
  });

  it("reproduce exactamente lo que Avanzar produce hoy", () => {
    expect(armarPildora({ stage: "no_show", subcategoria: "Plantón" })).toBe("NO-SHOW · PLANTÓN");
    expect(armarPildora({ stage: "nurture", subcategoria: "Se enfrió" })).toBe("NURTURE · SE ENFRIÓ");
  });
});
