import { describe, expect, it } from "vitest";
import { botAtendiendo, TAGS, TAGS_BOT } from "../../src/lib/ghl/contrato";
import { autorDeMensaje } from "../../src/lib/ghl/autoria";
import {
  armarTranscript,
  CRITERIOS_CLOSER,
  hechosMedidos,
  rubricaDe,
  territorioDe,
  type MensajeClasificado,
} from "./analizador";

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
    expect(
      botAtendiendo([TAGS.zonaCloser.valor, TAGS_BOT.botActivado.valor]),
    ).toBe(true);
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
    expect(
      botAtendiendo([
        TAGS.zonaCloser.valor,
        TAGS_BOT.botDesactivadoPostcall.valor,
      ]),
    ).toBe(false);
  });

  it("tolera mayúsculas y espacios — GHL no garantiza higiene de tags", () => {
    expect(botAtendiendo([" Bot_Activado "])).toBe(true);
  });
});

/**
 * La otra mitad del mismo bug: "outbound" no quiere decir "IA". Las cuatro firmas de abajo
 * son literales, medidas contra la cuenta real el 2026-08-04 — si alguna se rompe, el
 * auditor vuelve a juzgar al agente por lo que escribió un humano o un workflow.
 */
describe("autorDeMensaje — quién escribió cada mensaje", () => {
  it("un entrante es siempre del contacto, sin importar source ni userId", () => {
    expect(
      autorDeMensaje({ direccion: "inbound", source: "api", userId: "" }),
    ).toBe("contacto");
    expect(
      autorDeMensaje({
        direccion: "inbound",
        source: "app",
        userId: "0peGoq7V",
      }),
    ).toBe("contacto");
  });

  it("source=app SIN userId es el chatbot — la firma real de las respuestas a Moisés", () => {
    expect(
      autorDeMensaje({
        direccion: "outbound",
        source: "app",
        messageType: "TYPE_WHATSAPP",
      }),
    ).toBe("agente_ia");
  });

  it("source=app CON userId es un humano tipeando en GHL", () => {
    expect(
      autorDeMensaje({
        direccion: "outbound",
        source: "app",
        userId: "BtefrkUaWSWBV4g72vbR",
      }),
    ).toBe("asesor");
  });

  /** El `userId` de un workflow es el de quien lo ARMÓ, no el autor del texto: se ignora. */
  it("source=workflow es una plantilla, aunque traiga userId", () => {
    expect(
      autorDeMensaje({
        direccion: "outbound",
        source: "workflow",
        userId: "0peGoq7VvFqnDGA7gxtX",
      }),
    ).toBe("workflow");
  });

  /**
   * El caso ambiguo. Se yerra hacia `desconocido` a propósito: llamarlo `agente_ia` puede
   * pausarle el bot a una persona real por algo que escribió una integración.
   */
  it("source=api sin userId es DESCONOCIDO, nunca el agente", () => {
    expect(autorDeMensaje({ direccion: "outbound", source: "api" })).toBe(
      "desconocido",
    );
    expect(autorDeMensaje({ direccion: "outbound" })).toBe("desconocido");
  });

  it("los eventos de actividad no son conversación", () => {
    expect(
      autorDeMensaje({
        direccion: "outbound",
        source: "app",
        messageType: "TYPE_ACTIVITY_APPOINTMENT",
      }),
    ).toBe("sistema");
  });

  it("la válvula de configuración permite reconocer otra firma sin desplegar", () => {
    expect(
      autorDeMensaje(
        { direccion: "outbound", source: "api" },
        { fuentesIa: ["api"] },
      ),
    ).toBe("agente_ia");
    expect(
      autorDeMensaje(
        { direccion: "outbound", source: "app", userId: "svc-bot" },
        { userIdsIa: ["svc-bot"] },
      ),
    ).toBe("agente_ia");
  });

  it("lo que mandó nuestro compositor es del asesor, sin inferir nada", () => {
    expect(
      autorDeMensaje({
        direccion: "outbound",
        source: "api",
        enviadoPorElTool: true,
      }),
    ).toBe("asesor");
  });
});

describe("territorioDe", () => {
  it("closer gana si por error conviven los dos tags (etapa más avanzada)", () => {
    expect(territorioDe([TAGS.zonaSetter.valor, TAGS.zonaCloser.valor])).toBe(
      "closer",
    );
  });

  it("sin ninguno, null", () => {
    expect(territorioDe(["lead_meta_ads"])).toBeNull();
  });
});

const m = (
  autor: MensajeClasificado["autor"],
  texto: string,
  minutosAtras = 0,
  sinTexto = false,
): MensajeClasificado => ({
  autor,
  texto,
  cuando: Date.parse("2026-08-04T18:00:00Z") - minutosAtras * 60_000,
  sinTexto,
});

describe("armarTranscript", () => {
  /**
   * Etiquetar en vez de filtrar es la decisión central. Si el transcript volviera a decir
   * "IA:" para todo saliente, el auditor le imputaría al agente las plantillas de workflow
   * y los mensajes del closer.
   */
  it("cada autor lleva su etiqueta, y no se filtra a nadie", () => {
    const t = armarTranscript([
      m("contacto", "hola"),
      m("agente_ia", "¡Hola! ¿En qué te ayudo?"),
      m("workflow", "Te recordamos tu sesión de mañana."),
      m("asesor", "Perdón la demora, acá va el link."),
      m("desconocido", "Tu sesión fue confirmada."),
    ]);
    expect(t).toContain("CONTACTO: hola");
    expect(t).toContain("AGENTE IA: ¡Hola! ¿En qué te ayudo?");
    expect(t).toContain("AUTOMATIZACIÓN: Te recordamos tu sesión de mañana.");
    expect(t).toContain("ASESOR HUMANO: Perdón la demora, acá va el link.");
    expect(t).toContain("ORIGEN NO IDENTIFICADO: Tu sesión fue confirmada.");
  });

  it("una conversación sin agente no tiene ninguna línea AGENTE IA — el portón 5 la descarta", () => {
    const clasificados = [
      m("contacto", "hola"),
      m("contacto", "¿hay alguien?"),
    ];
    expect(clasificados.some((x) => x.autor === "agente_ia")).toBe(false);
    expect(armarTranscript(clasificados)).not.toContain("AGENTE IA:");
  });

  /**
   * Sin fecha el criterio 2 es una conjetura: el modelo no puede medir un silencio que no ve.
   * El sello se compone a mano justamente para que este formato no dependa del ICU del
   * runtime — `es-PE` con `format()` devolvía `4/8, 13:00`, sin rellenar el día.
   */
  it("cada línea lleva fecha y hora con formato estable", () => {
    expect(armarTranscript([m("contacto", "hola")])).toMatch(
      /^\[\d{2}\/\d{2} \d{2}:\d{2}\] CONTACTO: hola$/,
    );
  });

  /** La hora va en la zona de la org, no en UTC: 18:00Z es la 1 de la tarde en Lima. */
  it("usa la zona horaria de la organización", () => {
    expect(armarTranscript([m("contacto", "hola")])).toContain("[04/08 13:00]");
  });

  it("avisa cuando el transcript viene recortado", () => {
    const t = armarTranscript([m("contacto", "hola")], true);
    expect(t.startsWith("[…la conversación es más larga")).toBe(true);
  });
});

describe("el verde tiene que sostenerse, como el amarillo (2026-08-16)", () => {
  /**
   * Medido en producción: 8 de 9 llamadas auditables salieron verdes, y la rúbrica le exigía al
   * amarillo tres artefactos (hallazgo + cita + error_code) y al verde ninguno. El verde era la
   * opción barata. Decisión de Fabio: que cite qué hizo bien, igual que el amarillo cita el fallo.
   *
   * Lo que NO se hizo, y por eso estos tests fijan las dos mitades: quitar la salida de "no hay
   * nada citable". Sin ella el modelo fabrica méritos, y un destacado inventado afirma salud que
   * nadie midió — peor que un verde callado.
   */
  const RUBRICA = rubricaDe(CRITERIOS_CLOSER);

  it("le pide al verde el mismo esfuerzo que al amarillo", () => {
    expect(RUBRICA).toContain(
      'UN VERDE SIN "destacado" ES UN VEREDICTO A MEDIAS',
    );
    expect(RUBRICA).toContain("no la salida fácil");
  });

  it("y le da ejemplos de dónde buscar antes de rendirse", () => {
    expect(RUBRICA).toContain("cómo abrió");
    expect(RUBRICA).toContain("cómo cerró");
  });

  it("pero conserva la salida honesta, con su precio: hay que justificarla", () => {
    expect(RUBRICA).toContain('dejá "destacado" y "evidencia" vacíos');
    expect(RUBRICA).toContain("por qué no la había");
  });

  it("y sigue prohibiendo inventar el mérito", () => {
    expect(RUBRICA).toContain("NO se hace es inventar un mérito");
  });
});

describe("hechosMedidos", () => {
  const ahora = Date.parse("2026-08-04T18:00:00Z");

  it("cuenta los mensajes por autor", () => {
    const h = hechosMedidos(
      [m("contacto", "a", 10), m("agente_ia", "b", 9), m("workflow", "c", 8)],
      ahora,
    );
    expect(h).toContain("contacto 1");
    expect(h).toContain("agente IA 1");
    expect(h).toContain("automatización 1");
  });

  /**
   * La condición (b) del criterio 2. Es un hecho estructural del arreglo, no una lectura:
   * si el último mensaje es del contacto, nadie respondió después.
   */
  it("dice NO cuando el último mensaje quedó sin respuesta", () => {
    const h = hechosMedidos(
      [m("agente_ia", "hola", 30), m("contacto", "¿y el link?", 5)],
      ahora,
    );
    expect(h).toContain(
      "¿Alguien respondió después del último mensaje del contacto?: NO",
    );
  });

  it("dice SÍ cuando contestó una AUTOMATIZACIÓN — eso es seguimiento, no abandono", () => {
    const h = hechosMedidos(
      [m("contacto", "¿y el link?", 30), m("workflow", "recordatorio", 5)],
      ahora,
    );
    expect(h).toContain(
      "¿Alguien respondió después del último mensaje del contacto?: SÍ",
    );
  });

  it("informa el umbral de silencio en vez de pedirle al modelo que lo invente", () => {
    expect(hechosMedidos([m("contacto", "hola")], ahora)).toContain(
      "60 minutos",
    );
  });

  it("distingue 'nunca escribió' de 'hace rato' para el agente", () => {
    expect(hechosMedidos([m("contacto", "hola", 5)], ahora)).toContain(
      "Último mensaje del AGENTE IA: nunca escribió",
    );
  });

  it("cuenta los mensajes sin texto — el modelo tiene que saber qué no puede leer", () => {
    const h = hechosMedidos(
      [m("contacto", "[nota de voz sin transcripción]", 5, true)],
      ahora,
    );
    expect(h).toContain("Mensajes sin texto (audio/imagen): 1 de 1");
  });
});
