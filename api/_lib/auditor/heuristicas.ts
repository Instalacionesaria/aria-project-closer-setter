/**
 * Nivel 0 del carril rojo — las señales de alarma que **no cuestan nada**.
 *
 * ── Qué problema resuelve ─────────────────────────────────────────────
 *
 * El debounce de 5 mensajes tiene un agujero que está documentado como consecuencia matemática
 * de la regla: *una conversación donde la IA manda **4** mensajes y el contacto se va enojado
 * nunca se audita*, y el bot nunca se apaga. Ese es exactamente el caso que más duele.
 *
 * Estas heurísticas corren sobre la conversación que ya está en memoria, **sin llamar a ningún
 * modelo**. No deciden nada sobre el agente: deciden si vale la pena *mirar*. El análisis
 * dispara cuando ocurre lo primero de las dos cosas — `delta ≥ 5` **o** una alarma acá.
 *
 * Como no cuestan, cerrar el agujero es gratis: en una conversación normal el gasto es idéntico
 * al del debounce solo.
 *
 * ── Lo que NO son ─────────────────────────────────────────────────────
 *
 * No son un veredicto ni una versión barata de la rúbrica. Una alarma solo adelanta el momento
 * del análisis; el juicio sigue siendo del modelo, con su cita textual y su regla de atribución.
 * Si una heurística se equivoca, el costo es una inferencia de más — nunca un tag mal puesto.
 *
 * Por eso están calibradas para **errar hacia mirar**: un falso positivo cuesta centavos, un
 * falso negativo es un lead maltratado que nadie ve.
 */

import { LEXICO_FRUSTRACION, LEXICO_INTENCION_COMPRA } from "./lexico.js";
import type { MensajeClasificado } from "../analizador.js";

/** Las cinco señales. El nombre viaja en el análisis, así que se puede medir cuál sirve. */
export type SenalHeuristica =
  | "frustracion_lexica"
  | "intencion_de_pago"
  | "pregunta_repetida"
  | "agente_se_repite"
  | "contacto_se_fue";

export interface Alarma {
  senal: SenalHeuristica;
  /** Para el log y para el análisis: qué disparó, en una línea legible. */
  evidencia: string;
}

/**
 * Cuántos mensajes recientes del contacto se miran para el léxico.
 *
 * Tres y no toda la conversación: un "esto no me sirve" de hace dos semanas, ya resuelto, no es
 * una alarma de ahora. La ventana corta es lo que evita que una conversación larga viva alarmada
 * para siempre.
 */
const VENTANA_RECIENTE = 3;

/** Silencio del contacto que cuenta como "se fue". El mismo umbral que usa la rúbrica. */
const SILENCIO_MIN = 60;

/**
 * Similitud para "es la misma pregunta otra vez".
 *
 * Jaccard sobre palabras normalizadas: barato, sin dependencias, y suficiente para lo que hay
 * que detectar —la misma pregunta reformulada— sin marcar dos preguntas distintas del mismo
 * tema. Se descartó Levenshtein: es O(n·m) por par y acá se compara cada mensaje contra los
 * demás.
 */
const SIMILITUD_MINIMA = 0.6;

/** Palabras vacías. Sin quitarlas, dos preguntas cualesquiera comparten "el", "de", "que". */
const VACIAS = new Set([
  "el","la","los","las","un","una","de","del","en","y","o","que","qué","a","al","por","para",
  "con","sin","es","son","me","te","se","lo","mi","tu","su","este","esta","eso","hay","ya",
  "pero","si","sí","no","más","mas","como","cómo","cuando","cuándo","donde","dónde","muy",
]);

/**
 * Normaliza para comparar: minúsculas, sin acentos, sin puntuación.
 *
 * Sin quitar acentos, "está" y "esta" serían palabras distintas, y la gente escribe las dos.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Las palabras que importan de un texto. */
function palabras(texto: string): Set<string> {
  return new Set(
    normalizar(texto)
      .split(" ")
      .filter((p) => p.length > 2 && !VACIAS.has(p)),
  );
}

/** Jaccard: cuánto se solapan dos conjuntos de palabras. 0 = nada, 1 = idénticos. */
export function similitud(a: string, b: string): number {
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.size === 0 || pb.size === 0) return 0;
  let comunes = 0;
  for (const p of pa) if (pb.has(p)) comunes++;
  return comunes / (pa.size + pb.size - comunes);
}

/** ¿El texto contiene alguna de estas expresiones? Compara sobre el texto normalizado. */
function contiene(texto: string, lexico: readonly string[]): string | null {
  const n = ` ${normalizar(texto)} `;
  for (const termino of lexico) {
    // Con espacios alrededor: `caro` no debe matchear dentro de `carozo`.
    if (n.includes(` ${termino} `)) return termino;
  }
  return null;
}

/**
 * Las alarmas de una conversación. Vacío = nada que mirar todavía.
 *
 * `ahoraMs` es un parámetro y no `Date.now()` adentro para que los tests puedan fijar el reloj:
 * dos de las señales dependen del tiempo transcurrido.
 */
export function alarmasDe(mensajes: MensajeClasificado[], ahoraMs = Date.now()): Alarma[] {
  const alarmas: Alarma[] = [];
  const conTexto = mensajes.filter((m) => !m.sinTexto && m.texto.trim());
  const delContacto = conTexto.filter((m) => m.autor === "contacto");
  const delAgente = conTexto.filter((m) => m.autor === "agente_ia");

  /* ── 1. Léxico de frustración, en lo reciente ─────────────────────── */
  for (const m of delContacto.slice(-VENTANA_RECIENTE)) {
    const termino = contiene(m.texto, LEXICO_FRUSTRACION);
    if (termino) {
      alarmas.push({ senal: "frustracion_lexica", evidencia: `el contacto dijo "${termino}"` });
      break;
    }
  }

  /* ── 2. Intención de compra o de pago ─────────────────────────────── */
  /**
   * Este es el que más duele si la IA lo maneja mal: alguien que quiere pagar y se encuentra
   * con un bot que no entiende. Se mira la ventana reciente por el mismo motivo que arriba.
   */
  for (const m of delContacto.slice(-VENTANA_RECIENTE)) {
    const termino = contiene(m.texto, LEXICO_INTENCION_COMPRA);
    if (termino) {
      alarmas.push({ senal: "intencion_de_pago", evidencia: `el contacto dijo "${termino}"` });
      break;
    }
  }

  /* ── 3. El contacto repitió sustancialmente la misma pregunta ─────── */
  /**
   * Solo entre mensajes que **no son contiguos en la conversación**: dos mensajes seguidos del
   * contacto suelen ser una frase partida en dos ("te consulto algo" / "te consulto por el
   * precio"), no una repetición por no haber sido entendido.
   *
   * La contigüidad se mide sobre la conversación COMPLETA, no sobre los mensajes del contacto.
   * La primera versión comparaba índices dentro del array filtrado, y con eso dos preguntas
   * separadas por una respuesta del agente —que es justamente el caso a detectar— quedaban
   * "contiguas" y no se comparaban nunca. Lo cazó el test.
   */
  const indicesContacto = conTexto.map((m, i) => ({ m, i })).filter(({ m }) => m.autor === "contacto");
  buscar: for (let a = 0; a < indicesContacto.length; a++) {
    for (let b = a + 1; b < indicesContacto.length; b++) {
      // Contiguos en la conversación: nada en el medio.
      if (indicesContacto[b].i - indicesContacto[a].i === 1) continue;
      if (similitud(indicesContacto[a].m.texto, indicesContacto[b].m.texto) >= SIMILITUD_MINIMA) {
        alarmas.push({
          senal: "pregunta_repetida",
          evidencia: `el contacto repitió "${indicesContacto[b].m.texto.slice(0, 60)}"`,
        });
        break buscar; // una alarma alcanza
      }
    }
  }

  /* ── 4. El agente mandó dos mensajes casi idénticos seguidos ──────── */
  for (let i = 1; i < delAgente.length; i++) {
    if (similitud(delAgente[i - 1].texto, delAgente[i].texto) >= SIMILITUD_MINIMA) {
      alarmas.push({
        senal: "agente_se_repite",
        evidencia: `el agente repitió "${delAgente[i].texto.slice(0, 60)}"`,
      });
      break;
    }
  }

  /* ── 5. El contacto dejó de responder después del agente ──────────── */
  /**
   * Tres condiciones, y las tres hacen falta: el último mensaje es del agente, pasó el umbral
   * de silencio, y **el contacto había hablado antes**. Sin la tercera, una conversación que
   * arranca con un saludo automático y nadie contesta se marcaría como abandono.
   */
  const ultimo = conTexto[conTexto.length - 1];
  if (
    ultimo?.autor === "agente_ia" &&
    ultimo.cuando > 0 &&
    ahoraMs - ultimo.cuando > SILENCIO_MIN * 60_000 &&
    delContacto.length > 0
  ) {
    const min = Math.round((ahoraMs - ultimo.cuando) / 60_000);
    alarmas.push({ senal: "contacto_se_fue", evidencia: `sin respuesta hace ${min} min` });
  }

  return alarmas;
}
