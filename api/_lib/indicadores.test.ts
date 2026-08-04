import { describe, expect, it } from "vitest";
import { TAGS_BOT } from "../../src/lib/ghl/contrato";
import { combinar, type DatosParaIndicadores } from "./indicadores";

/** Contacto mínimo; cada test pisa solo lo que le interesa. */
const contacto = (extra: Partial<DatosParaIndicadores> = {}): DatosParaIndicadores => ({
  ghl_contact_id: "c1",
  tags: [],
  fuente: "META ADS",
  llamadas_ia_intentos: null,
  llamadas_ia_contestadas: null,
  etapa: "agendado",
  monto: null,
  ...extra,
});

const vista = {
  ghl_contact_id: "c1",
  reuniones: 2,
  cita_futura: true,
  proxima_cita_el: "2026-08-05T16:00:00Z",
  proxima_meet_url: "https://meet.example/abc",
  ultima_cita_vencida_el: "2026-08-01T16:00:00Z",
  seguimiento_auto: true,
};

describe("sin fila en la vista, todo apagado — nunca inventa", () => {
  it("un contacto que la vista no devolvió no rompe ni miente", () => {
    const i = combinar(contacto());
    expect(i.reuniones).toBe(0);
    expect(i.citaFutura).toBe(false);
    expect(i.proximaCitaEl).toBeNull();
    expect(i.seguimientoAuto).toBe(false);
  });

  /**
   * `0` y `null` se pintan igual (atenuado, sin número) pero NO son lo mismo: `null` dice
   * "nunca se sincronizó desde GHL". Perder esa distinción fue lo que dejó pasar semanas de
   * `bot_estado` muerta sin que nadie lo notara.
   */
  it("los contadores de llamadas conservan el null en vez de caer a 0", () => {
    expect(combinar(contacto()).llamadasIaContestadas).toBeNull();
    expect(combinar(contacto({ llamadas_ia_contestadas: 0 })).llamadasIaContestadas).toBe(0);
  });
});

describe("la vista manda en 📹 · 📅 · ⏱", () => {
  it("pasa los valores tal cual, sin recalcular nada", () => {
    const i = combinar(contacto(), vista);
    expect(i.reuniones).toBe(2);
    expect(i.citaFutura).toBe(true);
    expect(i.proximaMeetUrl).toBe("https://meet.example/abc");
    expect(i.ultimaCitaVencidaEl).toBe("2026-08-01T16:00:00Z");
    expect(i.seguimientoAuto).toBe(true);
  });
});

describe("🤖 se deriva de los tags, con los apagados ganando", () => {
  it("sin ningún tag de bot → null, no 'activo' (default APAGADO, §51.3)", () => {
    expect(combinar(contacto()).bot).toBeNull();
  });

  it("bot_activado solo → activo", () => {
    expect(combinar(contacto({ tags: [TAGS_BOT.botActivado.valor] })).bot).toBe("activo");
  });

  /**
   * El caso que motiva el orden: un contacto puede arrastrar `bot_activado` residual junto a
   * un tag de apagado. Si ganara el activado, la ficha diría "IA activa" sobre un contacto
   * cuyos mensajes el propio sistema está mandando al Buzón.
   */
  it("un tag de apagado le gana a bot_activado residual", () => {
    const tags = [TAGS_BOT.botActivado.valor, TAGS_BOT.botDesactivadoPostcall.valor];
    expect(combinar(contacto({ tags })).bot).toBe("muerto_postcall");
  });

  it("el fallo del auditor gana sobre todos: pide acción humana", () => {
    const tags = [TAGS_BOT.botDesactivadoPostcall.valor, TAGS_BOT.botPausadoFallo.valor];
    expect(combinar(contacto({ tags })).bot).toBe("pausado_fallo");
  });

  it("Instagram no tiene bot, sin importar qué tags arrastre (§11)", () => {
    const c = contacto({ tags: [TAGS_BOT.botActivado.valor], fuente: "📷 IG PROFILE" });
    expect(combinar(c).bot).toBeNull();
  });
});

describe("💰 solo con venta cobrada", () => {
  it("etapa ganado con monto → el monto", () => {
    expect(combinar(contacto({ etapa: "ganado", monto: 5000 })).ventaMonto).toBe(5000);
  });

  /**
   * "Acordó comprar" escribe `monto` igual, pero es una promesa, no un cobro (§27.A). Si el
   * ícono se encendiera acá, el dinero del Pipeline dejaría de coincidir con el del cockpit.
   */
  it("etapa cierre con monto → null, es una promesa", () => {
    expect(combinar(contacto({ etapa: "cierre", monto: 500 })).ventaMonto).toBeNull();
  });
});
