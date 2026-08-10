/**
 * Las piezas puras del auditor de voz. El flujo completo (`analizarLlamada`) toca la base y el
 * modelo, así que acá se prueban las derivaciones que deciden QUÉ se audita y CON QUÉ — que es
 * donde un error produce veredictos convincentes sobre el agente equivocado.
 *
 * El guion bajo del nombre: Vercel publica todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { describe, expect, it } from "vitest";
import type { FilaLlamada } from "../../src/lib/assistable.js";
import { CRITERIOS_CLOSER, CRITERIOS_SETTER } from "./analizador.js";
import { armarTranscriptVoz, hechosDeLlamada, RUBRICAS_VOZ, TERRITORIOS_VOZ, turnosValidos } from "./analizadorVoz.js";

const fila = (p: Partial<FilaLlamada> = {}): FilaLlamada => ({
  call_id: "call_test",
  ghl_contact_id: "contacto_test",
  location_id: null,
  assistant_id: "asst",
  origen: "app_flow_voz",
  direccion: "outbound",
  numero_desde: null,
  numero_hacia: null,
  inicio_el: "2026-08-10T15:00:00Z",
  fin_el: null,
  duracion_segundos: 95,
  contestada: true,
  motivo_desconexion: "user_hangup",
  motivo_cierre: null,
  resumen: null,
  transcripcion: null,
  turnos: null,
  sentimiento: "neutral",
  grabacion_url: null,
  extracciones: null,
  herramientas: null,
  ...p,
});

describe("TERRITORIOS_VOZ · qué agente se audita según el origen", () => {
  it("app_flow_voz es el Appointment Flow de voz, con la rúbrica del closer", () => {
    expect(TERRITORIOS_VOZ.app_flow_voz?.agenteId).toBe("appointment-flow-voz");
    expect(TERRITORIOS_VOZ.app_flow_voz?.territorio).toBe("closer");
  });

  it("lead_flow_voz es el Lead Flow de voz, con la rúbrica del setter", () => {
    expect(TERRITORIOS_VOZ.lead_flow_voz?.agenteId).toBe("lead-flow-voz");
    expect(TERRITORIOS_VOZ.lead_flow_voz?.territorio).toBe("setter");
  });

  /**
   * La regla entera: un asistente no mapeado (`voz_ia`) y una reunión humana (`sales_call`) NO
   * tienen entrada. Auditar "al más parecido" imputaría fallos al agente equivocado — el mismo
   * criterio de `origenDeAsistente`, que no asume `app_flow_voz` para un id desconocido.
   */
  it("voz_ia y sales_call NO se auditan", () => {
    expect(TERRITORIOS_VOZ.voz_ia).toBeUndefined();
    expect(TERRITORIOS_VOZ.sales_call).toBeUndefined();
  });
});

describe("turnosValidos · la forma de Retell no se presume", () => {
  it("acepta la forma {role, content} conocida", () => {
    expect(
      turnosValidos([
        { role: "agent", content: "Hola, ¿hablo con Ana?" },
        { role: "user", content: "Sí, soy yo." },
      ]),
    ).toHaveLength(2);
  });

  /** `turnos` es `unknown[]`: basura, turnos sin texto y formas ajenas se descartan sin explotar. */
  it("descarta turnos malformados sin tumbar el resto", () => {
    const sucios = [
      { role: "agent", content: "Válido." },
      { role: "agent" }, // sin content
      { content: "sin role" },
      "un string suelto",
      null,
      42,
      { role: "user", content: "   " }, // vacío tras trim
    ];
    const limpios = turnosValidos(sucios as unknown[]);
    expect(limpios).toHaveLength(1);
    expect(limpios[0].content).toBe("Válido.");
  });

  it("null y vacío devuelven lista vacía", () => {
    expect(turnosValidos(null)).toEqual([]);
    expect(turnosValidos([])).toEqual([]);
  });
});

describe("armarTranscriptVoz · lo que lee el modelo", () => {
  it("con turnos: una línea por turno, con el autor que la rúbrica exige", () => {
    const t = armarTranscriptVoz(
      fila({
        turnos: [
          { role: "agent", content: "Hola, llamo para confirmar tu cita." },
          { role: "user", content: "Ah sí, ahí estaré." },
        ],
      }),
    );
    expect(t).toBe("AGENTE IA: Hola, llamo para confirmar tu cita.\nCONTACTO: Ah sí, ahí estaré.");
  });

  /**
   * Sin turnos válidos cae al texto plano — PERO avisándole al modelo que no tiene roles por
   * línea, porque la regla de atribución exige líneas "AGENTE IA" y sobre un bloque sin roles lo
   * honesto es `auditable: false`, no un veredicto adivinado.
   */
  it("sin turnos cae al full_transcript, con la advertencia de que no hay roles", () => {
    const t = armarTranscriptVoz(fila({ transcripcion: "hola sí confirmo la cita gracias" }));
    expect(t).toContain("transcripción sin roles");
    expect(t).toContain("auditable=false");
    expect(t).toContain("hola sí confirmo la cita gracias");
  });

  it("sin turnos ni transcripción devuelve vacío — el portón corta antes de gastar", () => {
    expect(armarTranscriptVoz(fila())).toBe("");
  });
});

describe("hechosDeLlamada · lo temporal se mide, no se estima", () => {
  it("incluye duración, turnos por autor y el cómo terminó", () => {
    const turnos = [
      { role: "agent", content: "a" },
      { role: "agent", content: "b" },
      { role: "user", content: "c" },
    ];
    const h = hechosDeLlamada(fila(), turnos);
    expect(h).toContain("95 segundos");
    expect(h).toContain("3 (2 del agente, 1 del contacto)");
    expect(h).toContain("user_hangup");
  });

  /** El sentimiento de Retell viaja como dato de terceros, subordinado al del auditor. */
  it("el sentimiento de la plataforma se marca como dato de terceros", () => {
    expect(hechosDeLlamada(fila(), [])).toContain("el tuyo manda");
  });

  it("lo que no vino no se inventa: sin motivo de cierre no hay línea de motivo de cierre", () => {
    const h = hechosDeLlamada(fila({ motivo_desconexion: null, sentimiento: null }), []);
    expect(h).not.toContain("telefonía");
    expect(h).not.toContain("Sentimiento");
  });
});

describe("RUBRICAS_VOZ · el molde compartido con el medio de voz", () => {
  it("hay una por territorio y usan los criterios del territorio (los de la 034)", () => {
    // Los criterios son LOS MISMOS del chat: mismo trabajo juzgado, otro canal. Eso es lo que
    // evita ampliar el CHECK de `criterio` y lo que mantiene los "×N casos" del técnico juntos.
    expect(RUBRICAS_VOZ.closer).toContain(CRITERIOS_CLOSER.slice(0, 40));
    expect(RUBRICAS_VOZ.setter).toContain(CRITERIOS_SETTER.slice(0, 40));
  });

  it("leen una llamada, no un chat", () => {
    for (const r of [RUBRICAS_VOZ.closer, RUBRICAS_VOZ.setter]) {
      expect(r).toContain("llamadas telefónicas");
      expect(r).toContain("error del ASR");
      expect(r).not.toContain("WhatsApp");
    }
  });

  /** La rama sin-prompt es la que permite auditar "de forma general" cuando nadie cargó el prompt. */
  it("conservan la rama de auditar sin prompt del agente", () => {
    expect(RUBRICAS_VOZ.closer).toContain("Si NO recibiste el prompt del agente");
  });

  it("la consecuencia de intervenir es la de voz: la llamada ya terminó", () => {
    expect(RUBRICAS_VOZ.closer).toContain("La llamada ya terminó");
    expect(RUBRICAS_VOZ.closer).not.toContain("le corta el bot");
  });
});
