/**
 * Las heurísticas del nivel 0 y su léxico.
 *
 * Dos cosas se prueban acá y las dos tienen un modo de fallar silencioso:
 *
 *   1. **La normalización del léxico.** Un término escrito con acento o mayúscula en
 *      `lexico.ts` no matchea NUNCA, porque el texto entrante llega normalizado. La lista
 *      seguiría ahí, con aspecto de funcionar, sin disparar jamás.
 *   2. **La frontera de palabra.** Sin ella, `caro` matchearía dentro de `carozo` y la alarma
 *      se volvería ruido.
 *
 * El guion bajo del nombre: Vercel despliega todo `.ts` bajo `api/` y su único filtro es `/_`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { alarmasDe, normalizar, similitud, type SenalHeuristica } from "./heuristicas.js";
import { LEXICO_FRUSTRACION, LEXICO_INTENCION_COMPRA } from "./lexico.js";
import type { MensajeClasificado } from "../analizador.js";

const AHORA = 1_800_000_000_000;
const min = (n: number) => n * 60_000;

function msg(autor: MensajeClasificado["autor"], texto: string, haceMin = 0): MensajeClasificado {
  return { autor, texto, cuando: AHORA - min(haceMin), sinTexto: false };
}

/** Qué señales levantó, para aserciones legibles. */
const senales = (ms: MensajeClasificado[]): SenalHeuristica[] => alarmasDe(ms, AHORA).map((a) => a.senal);

describe("el léxico está escrito como se compara", () => {
  /**
   * El bug silencioso número uno. `heuristicas.ts` normaliza el texto entrante —minúsculas, sin
   * acentos, sin puntuación— y compara contra estas cadenas tal cual. Un `"está"` en la lista es
   * una entrada muerta con aspecto de viva.
   */
  it("ningún término tiene acentos, mayúsculas ni puntuación", () => {
    const malos: string[] = [];
    for (const termino of [...LEXICO_FRUSTRACION, ...LEXICO_INTENCION_COMPRA]) {
      if (normalizar(termino) !== termino) malos.push(termino);
    }
    expect(malos, `estos términos nunca van a matchear: ${malos.join(", ")}`).toEqual([]);
  });

  it("no hay términos repetidos entre las dos listas", () => {
    const cruce = LEXICO_FRUSTRACION.filter((t) => LEXICO_INTENCION_COMPRA.includes(t));
    expect(cruce).toEqual([]);
  });

  /** Un término de una sola letra o dos matchearía en cualquier lado. */
  it("ningún término es demasiado corto para ser específico", () => {
    const cortos = [...LEXICO_FRUSTRACION, ...LEXICO_INTENCION_COMPRA].filter((t) => t.length < 4);
    expect(cortos).toEqual([]);
  });
});

describe("normalizar", () => {
  it("saca acentos, mayúsculas y puntuación", () => {
    expect(normalizar("¿Está PÉSIMO, no?")).toBe("esta pesimo no");
  });
  it("colapsa los espacios", () => {
    expect(normalizar("hola    que   tal")).toBe("hola que tal");
  });
});

describe("similitud", () => {
  it("dos textos iguales dan 1", () => {
    expect(similitud("cuanto cuesta el programa", "cuanto cuesta el programa")).toBe(1);
  });
  it("la misma pregunta reformulada es alta", () => {
    expect(similitud("cuanto cuesta el programa completo", "el programa completo cuanto cuesta")).toBeGreaterThan(0.6);
  });
  it("dos preguntas distintas del mismo tema son bajas", () => {
    expect(similitud("cuanto cuesta el programa", "cuando empiezan las clases")).toBeLessThan(0.4);
  });
  it("un texto vacío no se parece a nada", () => {
    expect(similitud("", "cualquier cosa")).toBe(0);
  });
});

describe("las cinco señales", () => {
  it("frustración: el contacto se queja", () => {
    expect(senales([msg("agente_ia", "Hola! En qué te ayudo?"), msg("contacto", "esto no me sirve")])).toContain(
      "frustracion_lexica",
    );
  });

  it("frustración: solo mira los mensajes RECIENTES", () => {
    // La queja quedó cuatro mensajes atrás y ya se resolvió. No debería alarmar hoy.
    const ms = [
      msg("contacto", "no me sirve", 200),
      msg("agente_ia", "Perdón! Te explico mejor", 190),
      msg("contacto", "ah buenísimo", 180),
      msg("contacto", "gracias", 170),
      msg("contacto", "perfecto", 160),
    ];
    expect(senales(ms)).not.toContain("frustracion_lexica");
  });

  it("intención de pago: el caso que más duele", () => {
    expect(senales([msg("contacto", "ya quiero pagar, donde pago?")])).toContain("intencion_de_pago");
  });

  it("intención de pago: preguntar el PRECIO no alcanza", () => {
    // Es la conversación normal del embudo. Si alarmara, alarmaría siempre.
    expect(senales([msg("contacto", "cuanto cuesta el programa?")])).not.toContain("intencion_de_pago");
  });

  it("pregunta repetida: el contacto insiste porque no le contestaron", () => {
    const ms = [
      msg("contacto", "cuanto dura el programa completo"),
      msg("agente_ia", "Te cuento sobre nuestra metodología..."),
      msg("contacto", "si pero cuanto dura el programa completo"),
    ];
    expect(senales(ms)).toContain("pregunta_repetida");
  });

  it("pregunta repetida: dos mensajes SEGUIDOS parecidos no cuentan", () => {
    /**
     * Suele ser una frase partida en dos, no una repetición por no haber sido entendido. Por eso
     * la comparación salta el mensaje contiguo.
     */
    const ms = [msg("contacto", "te consulto por el programa"), msg("contacto", "te consulto por el programa completo")];
    expect(senales(ms)).not.toContain("pregunta_repetida");
  });

  it("el agente se repite", () => {
    const ms = [
      msg("agente_ia", "Con gusto te paso la información del programa"),
      msg("agente_ia", "Con gusto te paso la informacion del programa"),
    ];
    expect(senales(ms)).toContain("agente_se_repite");
  });

  it("el contacto se fue: último del agente y silencio largo", () => {
    const ms = [msg("contacto", "hola", 200), msg("agente_ia", "Hola! Contame", 180)];
    expect(senales(ms)).toContain("contacto_se_fue");
  });

  it("el contacto se fue: NO cuenta si el contacto nunca habló", () => {
    /**
     * Una conversación que arranca con un saludo automático y nadie contesta no es un abandono:
     * es un lead que nunca entró. Sin esta condición, cada contacto frío sería una alarma.
     */
    expect(senales([msg("agente_ia", "Hola! Vi que te interesó nuestro programa", 200)])).not.toContain(
      "contacto_se_fue",
    );
  });

  it("el contacto se fue: NO cuenta si el silencio es corto", () => {
    const ms = [msg("contacto", "hola", 20), msg("agente_ia", "Hola! Contame", 10)];
    expect(senales(ms)).not.toContain("contacto_se_fue");
  });
});

/**
 * ── El criterio de aceptación del spec ────────────────────────────────
 *
 * *"Una conversación donde el agente manda 4 mensajes y el contacto se va enojado sí se audita, y
 * el bot se apaga."*
 *
 * Cuatro mensajes del agente es **exactamente** un debajo del umbral de 5, así que el debounce
 * solo nunca la dejaría pasar: el análisis no corre, no hay veredicto y el bot sigue hablando.
 * Este test fija el caso completo, no una señal suelta — es el que tiene que fallar si alguien
 * sube `VENTANA_RECIENTE`, afloja el léxico o desconecta las alarmas del portón.
 */
describe("el caso que el debounce solo nunca atrapa", () => {
  it("4 mensajes del agente y el contacto que se va enojado levanta alarma", () => {
    const ms = [
      msg("contacto", "hola, quiero info del programa", 30),
      msg("agente_ia", "Hola! Con gusto. Te cuento que trabajamos con empresas...", 29),
      msg("contacto", "si pero cuanto dura", 25),
      msg("agente_ia", "Nuestra metodología tiene tres pilares...", 24),
      msg("contacto", "no es lo que pregunte, cuanto dura", 20),
      msg("agente_ia", "Los tres pilares son diagnóstico, plan y seguimiento", 19),
      msg("agente_ia", "Te sirve que agendemos una llamada?", 18),
      msg("contacto", "olvidalo, no me estas ayudando", 15),
    ];
    // El agente mandó 4 → delta = 4 < 5. El debounce solo la dejaría pasar de largo.
    expect(ms.filter((m) => m.autor === "agente_ia")).toHaveLength(4);
    expect(senales(ms)).toContain("frustracion_lexica");
  });
});

describe("la conversación normal no alarma", () => {
  /**
   * Es la aserción que sostiene la economía del nivel 0: si una conversación sana disparara
   * alarmas, el análisis correría siempre y el debounce dejaría de existir.
   */
  it("un ida y vuelta sano no levanta ninguna señal", () => {
    const ms = [
      msg("contacto", "hola, vi el video", 50),
      msg("agente_ia", "Hola! Qué bueno. Contame en qué etapa está tu negocio", 49),
      msg("contacto", "recién arranco, facturo poco todavía", 40),
      msg("agente_ia", "Perfecto. Te sirve una llamada el jueves?", 39),
      msg("contacto", "dale, el jueves me viene bien", 30),
    ];
    expect(alarmasDe(ms, AHORA)).toEqual([]);
  });

  it("los mensajes sin texto (audio) no rompen nada", () => {
    const ms: MensajeClasificado[] = [
      { autor: "contacto", texto: "", cuando: AHORA - min(10), sinTexto: true },
      { autor: "agente_ia", texto: "", cuando: AHORA - min(9), sinTexto: true },
    ];
    expect(() => alarmasDe(ms, AHORA)).not.toThrow();
    expect(alarmasDe(ms, AHORA)).toEqual([]);
  });

  it("una conversación vacía no alarma", () => {
    expect(alarmasDe([], AHORA)).toEqual([]);
  });
});

/**
 * ── El doc y el código no pueden separarse ────────────────────────────
 *
 * `docs/13-LEXICO-AUDITOR.md` existe para que Fabio revise la lista y decida qué agregar. Si el
 * doc y el archivo se separan, el doc deja de servir para eso — y peor, alguien agrega un término
 * ahí creyendo que ya está activo.
 *
 * Es el mismo problema que este proyecto ya tuvo dos veces: `10-ESTADO` afirmando que faltaba
 * `quitarTags` cuando existía, y el README de `docs/prompts` describiendo dos archivos que nunca
 * existieron. Un documento que miente es peor que no tenerlo.
 */
describe("el doc y el léxico dicen lo mismo", () => {
  const AQUI = dirname(fileURLToPath(import.meta.url)); // …/api/_lib/auditor
  const doc = readFileSync(resolve(AQUI, "..", "..", "..", "docs", "13-LEXICO-AUDITOR.md"), "utf8");

  /**
   * Los términos del doc son los que están entre backticks **en las secciones de listas**, no en
   * todo el archivo: la tabla de "lo que dejé afuera" también usa backticks, y sus términos son
   * justamente los que NO tienen que estar.
   */
  function terminosDelDoc(desde: string, hasta: string): string[] {
    const i = doc.indexOf(desde);
    const j = doc.indexOf(hasta, i);
    expect(i, `no encontré la sección "${desde}"`).toBeGreaterThan(-1);

    /**
     * Se saltean las líneas de cita (`>`), y no es un detalle: ahí viven las explicaciones, y
     * usan backticks para nombrar términos que **no** están en la lista. El caso concreto es la
     * nota de "`precio` NO está, y es deliberado" — si contara como parte de la lista, el test
     * exigiría agregar justo lo que el doc explica que hay que dejar afuera.
     */
    const cuerpo = doc
      .slice(i, j)
      .split("\n")
      .filter((l) => !l.trimStart().startsWith(">"))
      .join("\n");

    // Un Set: un mismo término puede aparecer dos veces en el doc por estar en dos familias.
    return [...new Set([...cuerpo.matchAll(/`([^`]+)`/g)].map((m) => m[1]))];
  }

  it("el doc lista exactamente los términos de frustración", () => {
    const enDoc = terminosDelDoc("## Frustración", "## Intención de compra");
    expect([...enDoc].sort()).toEqual([...LEXICO_FRUSTRACION].sort());
  });

  it("el doc lista exactamente los términos de intención de compra", () => {
    const enDoc = terminosDelDoc("## Intención de compra", "## Lo que decidí dejar afuera");
    expect([...enDoc].sort()).toEqual([...LEXICO_INTENCION_COMPRA].sort());
  });

  /** Lo que el doc declara excluido no puede estar en las listas. */
  it("nada de la tabla de exclusiones está en el léxico", () => {
    const excluidos = terminosDelDoc("## Lo que decidí dejar afuera", "## Pendientes");
    const infiltrados = excluidos.filter(
      (t) => LEXICO_FRUSTRACION.includes(t) || LEXICO_INTENCION_COMPRA.includes(t),
    );
    expect(infiltrados, `están excluidos en el doc y presentes en el código: ${infiltrados.join(", ")}`).toEqual([]);
  });
});
