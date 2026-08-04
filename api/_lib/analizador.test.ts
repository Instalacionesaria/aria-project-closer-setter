import { describe, expect, it } from "vitest";
import { botAtendiendo, TAGS, TAGS_BOT } from "../../src/lib/ghl/contrato";
import { armarTranscript, territorioDe } from "./analizador";
import type { MensajeGhl } from "./ghl/lectura";

const msg = (direction: "inbound" | "outbound", body: string): MensajeGhl =>
  ({ id: Math.random().toString(36), direction, body, messageType: "TYPE_WHATSAPP" }) as MensajeGhl;

/**
 * El portón que no existía y costó el bug del 2026-08-04. Estos casos son el contrato: si
 * alguno se rompe, el auditor vuelve a analizar contactos sin agente y a mandarlos a la cola
 * roja con "la IA dejó de responder" sobre una IA que nunca estuvo prendida.
 */
describe("botAtendiendo — el portón del auditor", () => {
  it("sin ningún tag de bot NO se audita (default APAGADO, §51.3)", () => {
    expect(botAtendiendo([])).toBe(false);
    expect(botAtendiendo([TAGS.zonaCloser.valor])).toBe(false);
  });

  it("bot_activado sí", () => {
    expect(botAtendiendo([TAGS.zonaCloser.valor, TAGS_BOT.botActivado.valor])).toBe(true);
  });

  /**
   * `bot_reactivar` es una ORDEN, no un estado (contrato §9), así que el ruteo del Buzón no
   * lo cuenta como prendido. Para el auditor sí: ya hay un agente que va a contestar y su
   * respuesta es auditable. Es la única diferencia entre los dos predicados.
   */
  it("bot_reactivar sí, aunque el Buzón no lo trate como prendido", () => {
    expect(botAtendiendo([TAGS_BOT.botReactivar.valor])).toBe(true);
  });

  it("cualquier tag de apagado gana, incluso junto a uno de encendido", () => {
    for (const off of [
      TAGS_BOT.botDesactivadoPostcall.valor,
      TAGS_BOT.botPausadoFallo.valor,
      TAGS_BOT.botApagadoManual.valor,
      TAGS_BOT.derivadoLt.valor,
    ]) {
      expect(botAtendiendo([TAGS_BOT.botActivado.valor, off])).toBe(false);
      expect(botAtendiendo([TAGS_BOT.botReactivar.valor, off])).toBe(false);
    }
  });

  /**
   * El caso exacto de Fabio Malpartida: post-call, sin bot. El auditor lo analizó igual y lo
   * mandó a Intervenciones Urgentes.
   */
  it("el caso que causó el bug: zona_closer post-call, sin bot", () => {
    expect(botAtendiendo([TAGS.zonaCloser.valor, TAGS_BOT.botDesactivadoPostcall.valor])).toBe(false);
  });

  it("tolera mayúsculas y espacios — GHL no garantiza higiene de tags", () => {
    expect(botAtendiendo([" Bot_Activado "])).toBe(true);
  });
});

describe("territorioDe", () => {
  it("closer gana si por error conviven los dos tags (etapa más avanzada)", () => {
    expect(territorioDe([TAGS.zonaSetter.valor, TAGS.zonaCloser.valor])).toBe("closer");
  });

  it("sin ninguno, null", () => {
    expect(territorioDe(["lead_meta_ads"])).toBeNull();
  });
});

describe("armarTranscript", () => {
  /**
   * El portón 4 se apoya en que un mensaje del agente se etiqueta "IA:". Si el formato
   * cambiara, el chequeo `transcript.includes("IA:")` dejaría de proteger en silencio.
   */
  it("etiqueta al agente como IA y al contacto como USUARIO", () => {
    const t = armarTranscript([msg("outbound", "Hola, soy el agente"), msg("inbound", "hola")]);
    expect(t).toContain("IA: Hola, soy el agente");
    expect(t).toContain("USUARIO: hola");
  });

  it("una conversación sin agente no contiene ninguna línea IA: — el portón 4 la descarta", () => {
    const t = armarTranscript([msg("inbound", "hola"), msg("inbound", "¿hay alguien?")]);
    expect(t.includes("IA:")).toBe(false);
  });

  it("invierte el orden: GHL devuelve del más reciente al más antiguo", () => {
    const t = armarTranscript([msg("inbound", "segundo"), msg("inbound", "primero")]);
    expect(t.indexOf("primero")).toBeLessThan(t.indexOf("segundo"));
  });
});
