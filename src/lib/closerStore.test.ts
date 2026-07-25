import { describe, it, expect } from "vitest";
import { applyAdvance, type ClosurerContact, type AdvanceInput } from "./closerStore";

/** Contacto mínimo, con lo que cada test necesita encima. */
const contacto = (extra: Partial<ClosurerContact> = {}): ClosurerContact => ({
  name: "RODRIGO SILVA",
  grade: "C",
  stage: "seguimiento",
  situacion: "Seguimiento · Dudando",
  when: "hoy",
  activity: "esperando respuesta",
  fuente: "META ADS",
  historial: [],
  notas: [],
  ...extra,
});

const venta: AdvanceInput = {
  stage: "ganado",
  pildora: "VENTA · $5.000",
  texto: "Venta registrada · $5.000",
  monto: 5000,
};

const seguimientoAutomatico: AdvanceInput = {
  stage: "seguimiento",
  pildora: "SEGUIMIENTO · MUY INTERESADO",
  texto: "Seguimiento automático · Recupero",
  cadenciaActiva: true,
};

const seguimientoManual: AdvanceInput = {
  stage: "seguimiento",
  pildora: "SEGUIMIENTO · DUDANDO",
  texto: "Seguimiento manual · para el 28 jul",
  cadenciaActiva: false,
};

describe("applyAdvance — cancelación universal del seguimiento (⏱)", () => {
  it("registrar una Venta apaga el seguimiento automático", () => {
    const antes = contacto({ cadenciaActiva: true });
    expect(applyAdvance(antes, venta).cadenciaActiva).toBe(false);
  });

  it.each([
    ["Acordó comprar", { stage: "cierre", pildora: "ACORDÓ COMPRAR · $500", texto: "Acuerdo" }],
    ["No le interesa", { stage: "descalificado", pildora: "DESCALIFICADO · PRECIO", texto: "Descalificado" }],
    ["No-show", { stage: "no_show", pildora: "NO-SHOW · PLANTÓN", texto: "No-show" }],
    ["Nurture", { stage: "nurture", pildora: "NURTURE · SE ENFRIÓ", texto: "Nurture" }],
  ] as const)("%s también lo apaga", (_label, input) => {
    const resultado = applyAdvance(contacto({ cadenciaActiva: true }), input as AdvanceInput);
    expect(resultado.cadenciaActiva).toBe(false);
  });

  it("la salida Seguimiento en modo automático sí lo enciende", () => {
    expect(applyAdvance(contacto(), seguimientoAutomatico).cadenciaActiva).toBe(true);
  });

  it("la salida Seguimiento en modo manual lo deja apagado — el manual no corre serie (§16.1.C)", () => {
    const antes = contacto({ cadenciaActiva: true });
    expect(applyAdvance(antes, seguimientoManual).cadenciaActiva).toBe(false);
  });
});

describe("applyAdvance — un resultado cierra TODAS las tareas abiertas", () => {
  it("limpia respondido y seguimientoPendiente, no solo urgente y agenda", () => {
    const antes = contacto({
      urgente: { pill: "AGENDADO · 08 JUL", detail: "bot caído" },
      agenda: { time: "10:00" },
      respondido: { microtext: "mensaje sin responder hace 20 min" },
      seguimientoPendiente: { microtext: "vencido hace 1 día", vencido: true },
      pinned: true,
    });
    const despues = applyAdvance(antes, venta);

    expect(despues.urgente).toBeUndefined();
    expect(despues.agenda).toBeUndefined();
    expect(despues.respondido).toBeUndefined();
    expect(despues.seguimientoPendiente).toBeUndefined();
    expect(despues.pinned).toBeUndefined();
    expect(despues.completedToday).toBe(true);
  });

  /**
   * La regresión concreta: `hasConversationTask` = `respondido || seguimientoPendiente`.
   * Si Avanzar no los limpiaba, seguía siendo true después de una Venta, y FIJAR
   * (que pone `completedToday: false`) devolvía el contacto a la cola de Seguimientos
   * luciendo la píldora `VENTA · $5.000`.
   */
  it("tras una Venta el contacto ya no tiene tarea de conversación — FIJAR no puede resucitarlo", () => {
    const antes = contacto({ seguimientoPendiente: { microtext: "vencido hace 1 día", vencido: true } });
    const despues = applyAdvance(antes, venta);
    const tieneTareaDeConversacion = !!(despues.respondido || despues.seguimientoPendiente);
    expect(tieneTareaDeConversacion).toBe(false);
  });
});

describe("applyAdvance — reglas que ya existían y no deben romperse", () => {
  it("mata la IA tras el resultado (§34)", () => {
    expect(applyAdvance(contacto({ botEstado: "activo" }), venta).botEstado).toBe("muerto_postcall");
  });

  it("No-show es la excepción: reactiva la IA para el workflow de recuperación", () => {
    const noShow: AdvanceInput = { stage: "no_show", pildora: "NO-SHOW · PLANTÓN", texto: "No-show" };
    expect(applyAdvance(contacto({ botEstado: "activo" }), noShow).botEstado).toBe("activo");
  });

  it("Instagram no tiene bot — su estado no se toca (§11)", () => {
    const ig = contacto({ fuente: "📷 IG PROFILE", botEstado: undefined });
    expect(applyAdvance(ig, venta).botEstado).toBeUndefined();
  });

  it("la nota viaja al tab Notas con la píldora como contexto (§3)", () => {
    const despues = applyAdvance(contacto(), { ...venta, nota: "Pagó por transferencia" });
    expect(despues.notas[0]).toMatchObject({
      contexto: "VENTA · $5.000",
      texto: "Pagó por transferencia",
      autor: "Usuario Activo",
    });
  });

  it("sin nota no se agrega ninguna entrada", () => {
    expect(applyAdvance(contacto(), venta).notas).toHaveLength(0);
  });

  it("el evento entra al historial con el autor real, más reciente primero", () => {
    const antes = contacto({ historial: [{ fecha: "27 Jun", texto: "Interacción inicial", autor: "Sistema" }] });
    const despues = applyAdvance(antes, venta);
    expect(despues.historial[0]).toMatchObject({ texto: "Venta registrada · $5.000", autor: "Usuario Activo" });
    expect(despues.historial).toHaveLength(2);
  });

  it("conserva el monto previo cuando el resultado no trae uno", () => {
    const sinMonto: AdvanceInput = { stage: "seguimiento", pildora: "SEGUIMIENTO · DUDANDO", texto: "Seguimiento" };
    expect(applyAdvance(contacto({ monto: 3000 }), sinMonto).monto).toBe(3000);
  });
});
