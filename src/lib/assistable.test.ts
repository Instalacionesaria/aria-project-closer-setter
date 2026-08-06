/**
 * Los fixtures NO son inventados: son los tres payloads que Assistable mandó de verdad el
 * 2026-08-06 entre las 00:45 y las 01:25 UTC, recortados a las claves que el parseo mira.
 *
 * Los tres cayeron en buzón de voz, así que el caso "contestada" se arma a mano a partir de
 * uno de ellos. Está marcado como tal: es el único dato de este archivo que no ocurrió.
 */

import { describe, expect, it } from "vitest";
import {
  aCallRecord,
  contestoAlguien,
  duracionLlamada,
  fechaDeLlamada,
  motivoEnCastellano,
  origenDeAsistente,
  parsearLlamada,
  redactarSecretos,
  resultadoDeLlamada,
  type PayloadLlamada,
} from "./assistable";

/** Real: buzón de voz, 1.86 s, CON grabación. El caso que rompe `duracion > 0`. */
const BUZON: PayloadLlamada = {
  call_id: "call_b002d913-c813-469e-b1f6-e69b54704ed9",
  contact_id: "VIbxTAxdI9fCcqEFuX2F",
  location_id: "DbWG5cimcumPcKk5p3xC",
  assistant_id: "cmrtd28sb0083l2048msdf9hk",
  direction: "outbound",
  from: "+16083365898",
  to: "+51939328653",
  start_timestamp: 1785977112064,
  end_timestamp: 1785977113924,
  call_time_seconds: 1.86,
  disconnection_reason: "voicemail_reached",
  call_completion_reason: "normal_clearing",
  call_summary: "No conversation data available",
  full_transcript: "",
  transcript_object: [],
  user_sentiment: "neutral",
  recording_url: "https://pub-9486772b00dc433094d297c5233f70d0.r2.dev/recordings/0b72df3e-primary.mp3",
  extractions: {},
  called_tools: [],
};

/** Real: rechazada. Duración 0 y **los dos timestamps en null** — por eso son nullables. */
const RECHAZADA: PayloadLlamada = {
  call_id: "call_0c82c9b3-78c4-4c66-b972-21c39021e4f7",
  contact_id: "VIbxTAxdI9fCcqEFuX2F",
  assistant_id: "cmrtd28sb0083l2048msdf9hk",
  direction: "outbound",
  start_timestamp: null,
  end_timestamp: null,
  call_time_seconds: 0,
  disconnection_reason: "user_declined",
  call_completion_reason: null,
  call_summary: "Call was not answered",
  full_transcript: "",
  transcript_object: [],
  user_sentiment: "neutral",
  recording_url: null,
};

/** SINTÉTICO: todavía no entró ninguna llamada atendida. Derivado de BUZON. */
const ATENDIDA: PayloadLlamada = {
  ...BUZON,
  call_id: "call_sintetica_atendida",
  call_time_seconds: 92.4,
  disconnection_reason: "user_hangup",
  call_summary: "El contacto confirmó su asistencia a la reunión del jueves.",
  full_transcript: "Agent: Hola Moises...\nUser: Sí, ahí estaré.",
  transcript_object: [
    { role: "agent", content: "Hola Moises..." },
    { role: "user", content: "Sí, ahí estaré." },
  ],
  user_sentiment: "positive",
};

describe("contestoAlguien", () => {
  it("un buzón de voz NO está contestado aunque dure segundos y tenga grabación", () => {
    // Es el caso real que hace que `duracion > 0` no alcance como regla.
    expect(contestoAlguien(BUZON)).toBe(false);
  });

  it("una llamada rechazada no está contestada", () => {
    expect(contestoAlguien(RECHAZADA)).toBe(false);
  });

  it("una llamada con turnos y duración sí está contestada", () => {
    expect(contestoAlguien(ATENDIDA)).toBe(true);
  });

  it("un motivo desconocido sin ningún rastro de conversación NO cuenta como contestada", () => {
    // La red de seguridad: si Retell agrega un motivo de no-contacto que no está en la lista,
    // la ausencia de turnos, transcripción y resumen igual lo delata.
    expect(contestoAlguien({ ...BUZON, disconnection_reason: "dial_rejected_by_carrier" })).toBe(false);
  });

  it("un motivo desconocido CON conversación sí cuenta", () => {
    expect(contestoAlguien({ ...ATENDIDA, disconnection_reason: "motivo_que_no_existe_todavia" })).toBe(true);
  });

  it("el placeholder de Assistable no cuenta como resumen", () => {
    // "No conversation data available" es relleno, no contenido.
    expect(contestoAlguien({ ...BUZON, disconnection_reason: undefined, call_time_seconds: 5 })).toBe(false);
  });
});

describe("parsearLlamada", () => {
  it("mapea el buzón de voz completo", () => {
    const f = parsearLlamada(BUZON)!;
    expect(f.call_id).toBe(BUZON.call_id);
    expect(f.ghl_contact_id).toBe("VIbxTAxdI9fCcqEFuX2F");
    expect(f.origen).toBe("app_flow_voz");
    expect(f.contestada).toBe(false);
    expect(f.duracion_segundos).toBe(1.86);
    expect(f.motivo_desconexion).toBe("voicemail_reached");
    // El placeholder no se guarda.
    expect(f.resumen).toBeNull();
    // Los vacíos van a null, no a {} ni [] — así `is null` en SQL significa una sola cosa.
    expect(f.turnos).toBeNull();
    expect(f.extracciones).toBeNull();
    expect(f.herramientas).toBeNull();
  });

  it("convierte los epoch en milisegundos a ISO", () => {
    const f = parsearLlamada(BUZON)!;
    expect(f.inicio_el).toBe(new Date(1785977112064).toISOString());
    expect(f.fin_el).toBe(new Date(1785977113924).toISOString());
  });

  it("tolera los timestamps en null de una llamada que nunca conectó", () => {
    const f = parsearLlamada(RECHAZADA)!;
    expect(f.inicio_el).toBeNull();
    expect(f.fin_el).toBeNull();
    expect(f.duracion_segundos).toBe(0);
  });

  it("devuelve null sin call_id: no hay clave de idempotencia", () => {
    expect(parsearLlamada({ ...BUZON, call_id: undefined })).toBeNull();
  });

  it("devuelve null sin contact_id: no hay ficha donde mostrarla", () => {
    expect(parsearLlamada({ ...BUZON, contact_id: "" })).toBeNull();
  });

  it("no explota con un payload vacío", () => {
    expect(parsearLlamada({})).toBeNull();
  });
});

describe("origenDeAsistente", () => {
  it("reconoce a Appointment Flow", () => {
    expect(origenDeAsistente("cmrtd28sb0083l2048msdf9hk")).toBe("app_flow_voz");
  });

  it("un asistente desconocido NO se asume Appointment Flow", () => {
    // Asumirlo pondría llamadas del setter en la ficha como si fueran del closer.
    expect(origenDeAsistente("otro_asistente_cualquiera")).toBe("voz_ia");
    expect(origenDeAsistente(null)).toBe("voz_ia");
  });

  it("el mapa extra pisa al de código, para agregar agentes sin deploy", () => {
    expect(origenDeAsistente("nuevo", { nuevo: "lead_flow_voz" })).toBe("lead_flow_voz");
  });
});

describe("presentación", () => {
  it("formatea la duración en mm:ss y redondea los decimales hacia abajo", () => {
    expect(duracionLlamada(1.86)).toBe("0:01");
    expect(duracionLlamada(0)).toBe("0:00");
    expect(duracionLlamada(92.4)).toBe("1:32");
    expect(duracionLlamada(3600)).toBe("60:00");
  });

  it("la fecha lleva día, mes y hora rellenados a dos dígitos", () => {
    // El regreso del bug de es-PE, que ignora `2-digit` y devolvería "6 ago 9:44".
    const f = fechaDeLlamada(new Date(Date.UTC(2026, 7, 6, 14, 5)).toISOString());
    expect(f).toMatch(/^\d{2} \w+ \d{2}:\d{2}$/);
    expect(f.startsWith("06 ")).toBe(true);
  });

  it("sin fecha lo dice, no muestra una inventada", () => {
    expect(fechaDeLlamada(null)).toBe("Sin fecha");
    expect(fechaDeLlamada("no es una fecha")).toBe("Sin fecha");
  });

  it("traduce los motivos conocidos y deja crudos los que no", () => {
    expect(motivoEnCastellano("voicemail_reached")).toBe("Buzón de voz");
    expect(motivoEnCastellano("motivo_nuevo_de_retell")).toBe("motivo_nuevo_de_retell");
    expect(motivoEnCastellano(null)).toBeNull();
  });

  it("el resultado respeta el formato del tipo", () => {
    expect(resultadoDeLlamada(false, "voicemail_reached")).toBe("No contestó · Buzón de voz");
    expect(resultadoDeLlamada(true, "user_hangup")).toBe("Contestó · Cortó el contacto");
    // Sin motivo no se rellena con texto de relleno.
    expect(resultadoDeLlamada(true, null)).toBe("Contestó");
  });
});

describe("aCallRecord", () => {
  it("una llamada no contestada no ofrece audio, resumen ni sentimiento", () => {
    // El buzón real TIENE grabación y sentimiento `neutral`. Ofrecer "escuchar el audio" de
    // algo que nadie atendió, y un veredicto emocional sobre un silencio, es dato falso.
    const r = aCallRecord(parsearLlamada(BUZON)!);
    expect(r.contestada).toBe(false);
    expect(r.audioUrl).toBeUndefined();
    expect(r.resumenIA).toBeUndefined();
    expect(r.sentimiento).toBeUndefined();
    expect(r.resultado).toBe("No contestó · Buzón de voz");
  });

  it("una llamada contestada sí los lleva", () => {
    const r = aCallRecord(parsearLlamada(ATENDIDA)!);
    expect(r.contestada).toBe(true);
    expect(r.resumenIA).toContain("confirmó su asistencia");
    expect(r.sentimiento).toBe("positivo");
    expect(r.audioUrl).toBeTruthy();
    expect(r.duracion).toBe("1:32");
  });

  it("el origen viaja para que los contadores de la ficha lo cuenten como llamada de IA", () => {
    expect(aCallRecord(parsearLlamada(BUZON)!).origin).not.toBe("sales_call");
  });
});

describe("redactarSecretos", () => {
  it("borra el access token de Facebook que viene en custom_values", () => {
    // Real: `variables.custom_values.access_token_fb` llega con el token entero de la
    // subcuenta. Nadie lo pidió y no se usa para nada.
    const payload = {
      call_id: "x",
      variables: {
        custom_values: { access_token_fb: "EAANlI87cZCh8BO5ZCxT5IK", client_name: "Jorge" },
      },
    };
    const limpio = redactarSecretos(payload) as typeof payload;
    expect(limpio.variables.custom_values.access_token_fb).not.toContain("EAAN");
    // Lo de al lado no se toca.
    expect(limpio.variables.custom_values.client_name).toBe("Jorge");
  });

  it("no muta el original: el parseo sigue leyendo el payload entero", () => {
    const payload = { variables: { api_key: "secreto" } };
    redactarSecretos(payload);
    expect(payload.variables.api_key).toBe("secreto");
  });

  it("recorta dentro de arrays y en cualquier profundidad", () => {
    const limpio = redactarSecretos({ a: [{ b: { my_secret_value: "uy" } }] }) as {
      a: { b: { my_secret_value: string } }[];
    };
    expect(limpio.a[0].b.my_secret_value).not.toBe("uy");
  });

  it("deja pasar lo que no es string: un booleano bajo una clave *_token no es una credencial", () => {
    const limpio = redactarSecretos({ has_token: false, token_count: 3 }) as Record<string, unknown>;
    expect(limpio.has_token).toBe(false);
    expect(limpio.token_count).toBe(3);
  });
});
