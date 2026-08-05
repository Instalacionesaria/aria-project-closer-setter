import { describe, expect, it } from "vitest";
import { duracionCorta, ventanaWhatsapp, VENTANA_WHATSAPP_MS } from "./whatsapp";

const AHORA = Date.parse("2026-08-05T20:00:00Z");
const haceHoras = (h: number) => new Date(AHORA - h * 3_600_000).toISOString();

describe("ventanaWhatsapp", () => {
  it("abierta si el contacto escribió hace menos de 24 h", () => {
    const v = ventanaWhatsapp(haceHoras(3), AHORA);
    expect(v.abierta).toBe(true);
    expect(v.motivo).toBeNull();
    expect(v.restanteMs).toBe(21 * 3_600_000);
  });

  /**
   * El caso exacto del bug: Fabio escribió el 04/08 a las 16:21 UTC y el envío salió el 05/08
   * a las 19:47. GHL devolvió 2xx y Meta lo rechazó después.
   */
  it("cerrada pasadas las 24 h — el caso que causó el bug", () => {
    const v = ventanaWhatsapp("2026-08-04T16:21:44.152Z", Date.parse("2026-08-05T19:47:30Z"));
    expect(v.abierta).toBe(false);
    expect(v.motivo).toContain("24 horas");
    expect(v.restanteMs! < 0).toBe(true);
  });

  /** El borde exacto: a las 24 h justas ya está cerrada, igual que la trata Meta. */
  it("el límite es estricto: exactamente 24 h ya es tarde", () => {
    const justo = new Date(AHORA - VENTANA_WHATSAPP_MS).toISOString();
    expect(ventanaWhatsapp(justo, AHORA).abierta).toBe(false);
    expect(ventanaWhatsapp(new Date(AHORA - VENTANA_WHATSAPP_MS + 1000).toISOString(), AHORA).abierta).toBe(true);
  });

  it("sin ningún mensaje del contacto, cerrada y con su propio motivo", () => {
    const v = ventanaWhatsapp(null, AHORA);
    expect(v.abierta).toBe(false);
    expect(v.venceEl).toBeNull();
    expect(v.motivo).toContain("todavía no escribió");
  });

  /**
   * Una fecha ilegible no puede hacerse pasar por ventana abierta: sería exactamente el
   * "parece que salió" que este módulo existe para evitar.
   */
  it("una fecha corrupta cierra la ventana, no la abre", () => {
    expect(ventanaWhatsapp("no-es-una-fecha", AHORA).abierta).toBe(false);
  });

  it("el motivo dice hace cuánto venció, para que el closer sepa qué pasó", () => {
    expect(ventanaWhatsapp(haceHoras(26), AHORA).motivo).toContain("2 h");
  });
});

describe("duracionCorta", () => {
  it("minutos, horas y días", () => {
    expect(duracionCorta(45 * 60_000)).toBe("45 min");
    expect(duracionCorta(3 * 3_600_000)).toBe("3 h");
    expect(duracionCorta(3.5 * 3_600_000)).toBe("3 h 30 min");
    expect(duracionCorta(50 * 3_600_000)).toBe("2 días");
  });

  /** Se usa tanto para "te quedan X" como para "venció hace X", que llega en negativo. */
  it("el signo no importa: siempre habla de una duración", () => {
    expect(duracionCorta(-2 * 3_600_000)).toBe("2 h");
  });
});
