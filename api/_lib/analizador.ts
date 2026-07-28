/**
 * El analizador de conversaciones del Closer.
 *
 * Lee la conversación entre el agente de GHL y el contacto, la evalúa contra la rúbrica de
 * "la IA no atendió bien", y si encontró un fallo aplica `bot_pausado_fallo` + una nota
 * `[IA] …` con el motivo. Ese tag dispara el workflow que apaga al agente, y el par
 * tag+nota es exactamente lo que `/api/closer/urgentes` lee para pintar la cola roja.
 *
 * ## Qué mira y qué no
 *
 * SOLO contactos con `zona_closer` (§11: las urgencias se rutean por etapa — pre-agenda al
 * setter, post-agenda al closer). El analizador anterior barría por fecha, sin mirar
 * territorio, y por eso marcó leads que no eran del closer.
 *
 * ## Por qué no re-analiza
 *
 * Si el contacto ya tiene `bot_pausado_fallo`, se sale antes de gastar una llamada al
 * modelo: el bot ya está pausado y el caso ya está en la cola. Re-analizarlo no cambiaría
 * nada y duplicaría la nota.
 */

import Anthropic from "@anthropic-ai/sdk";
import { TAGS } from "../../src/lib/ghl/contrato.js";
import { ghl } from "./ghl/index.js";
import {
  contactosConTag,
  conversacionDeContacto,
  esMensajeDeChat,
  mensajesDeConversacion,
  type MensajeGhl,
} from "./ghl/lectura.js";

/** El tag que enciende la cola roja y apaga al agente de GHL. */
export const TAG_FALLO = "bot_pausado_fallo";

/** Prefijo de la nota, para poder releerla después sin confundirla con notas humanas. */
const PREFIJO_NOTA = "[IA]";

/** Solo se manda al modelo la cola de la conversación — lo viejo no explica el fallo de hoy. */
const MAX_MENSAJES = 40;

const RUBRICA = `Eres un auditor de calidad de un agente de IA que atiende conversaciones de ventas por WhatsApp/chat.
Tu tarea: determinar si la IA NO atendió bien al usuario, según estos criterios:

1. El usuario se frustró o se enojó y la IA no lo manejó.
2. La IA dejó de responder o ignoró al usuario.
3. La IA prometió algo incorrecto o se contradijo.
4. El usuario dijo que no es lo que busca.
5. El usuario insiste en algo y la IA no lo entiende.

Si ocurre AL MENOS UNO de estos, la conversación falló y requiere intervención humana.
Si NINGUNO ocurre, no falló.

Sé estricto pero justo: NO marques fallo por cosas normales (el usuario preguntando, negociando,
pidiendo info, o la IA respondiendo correctamente). En la conversación, "USUARIO" es el contacto
y "IA" es el agente automático.

El motivo debe ser una sola frase en español, concreta y específica de ESTA conversación —
es el texto que va a leer el closer humano en su cola de intervenciones urgentes.`;

/** El esquema es el contrato: el modelo no puede devolver otra forma. */
const ESQUEMA_VEREDICTO = {
  type: "object",
  properties: {
    fallo: { type: "boolean", description: "true si se cumplió al menos un criterio de la rúbrica" },
    criterio: {
      type: "string",
      enum: [
        "frustracion",
        "dejo_de_responder",
        "promesa_incorrecta",
        "no_es_lo_que_busca",
        "insiste_no_entiende",
        "ninguno",
      ],
    },
    motivo: { type: "string", description: "Una frase en español explicando el fallo. Vacío si no hubo fallo." },
  },
  required: ["fallo", "criterio", "motivo"],
  additionalProperties: false,
} as const;

export interface Veredicto {
  fallo: boolean;
  criterio: string;
  motivo: string;
}

/** Transcript cronológico (GHL devuelve del más reciente al más antiguo). */
export function armarTranscript(mensajes: MensajeGhl[]): string {
  return [...mensajes]
    .filter(esMensajeDeChat)
    .reverse()
    .slice(-MAX_MENSAJES)
    .map((m) => `${m.direction === "inbound" ? "USUARIO" : "IA"}: ${(m.body ?? "").trim()}`)
    .join("\n");
}

/**
 * Evalúa un transcript contra la rúbrica.
 *
 * Structured outputs (`output_config.format`) en vez de pedir "responde solo con JSON" y
 * parsear con un regex: la forma la garantiza la API, así que no hay respuesta a medio
 * parsear que haya que tratar como "no falló" por las dudas.
 *
 * `effort: "low"` porque esto es una clasificación contra cinco criterios explícitos, y el
 * webhook que la llama tiene presupuesto de tiempo acotado. Se deja el pensamiento adaptativo
 * encendido (el default del modelo) en vez de apagarlo — apagarlo agrega modos de fallo que
 * no compensan lo poco que ahorra acá.
 */
export async function evaluarConversacion(transcript: string): Promise<Veredicto | null> {
  if (!transcript.trim()) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const cliente = new Anthropic();
  const respuesta = await cliente.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-opus-5",
    max_tokens: 2000,
    system: RUBRICA,
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: ESQUEMA_VEREDICTO },
    },
    messages: [{ role: "user", content: `Conversación a auditar:\n\n${transcript}` }],
  });

  // Las clasificadoras pueden declinar. No es un fallo del agente de ventas: no se marca nada.
  if (respuesta.stop_reason === "refusal") return null;

  const texto = respuesta.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!texto) return null;

  const crudo = JSON.parse(texto) as Partial<Veredicto>;
  return {
    fallo: Boolean(crudo.fallo),
    criterio: typeof crudo.criterio === "string" ? crudo.criterio : "ninguno",
    motivo: typeof crudo.motivo === "string" ? crudo.motivo : "",
  };
}

export interface ResultadoAnalisis {
  analizado: boolean;
  /** Por qué no se analizó, cuando `analizado` es false. */
  motivo?: string;
  fallo?: boolean;
  criterio?: string;
  /** Si el tag llegó de verdad a GHL (false en modo stub). */
  tagAplicado?: boolean;
}

/**
 * Analiza la conversación de un contacto y, si falló, lo manda a la cola roja.
 *
 * Devuelve siempre — nunca lanza. Lo llama el webhook, que debe responder 200 aunque el
 * análisis no se pueda hacer: un error acá no puede provocar que GHL reintente el evento ni
 * que desactive el workflow.
 */
export async function analizarYMarcar(ghlContactId: string): Promise<ResultadoAnalisis> {
  try {
    if (!process.env.ANTHROPIC_API_KEY) {
      return { analizado: false, motivo: "sin ANTHROPIC_API_KEY" };
    }

    // Territorio + estado actual en una sola lectura del contacto.
    const contacto = await ghl().obtenerContacto(ghlContactId);
    if (!contacto) return { analizado: false, motivo: "GHL no devolvió el contacto" };

    const tags = contacto.tags ?? [];
    if (!tags.includes(TAGS.zonaCloser.valor)) {
      return { analizado: false, motivo: "no es zona_closer" };
    }
    if (tags.includes(TAG_FALLO)) {
      // Ya está en la cola y el bot ya está pausado: no hay nada que decidir de nuevo.
      return { analizado: false, motivo: "ya marcado como fallo" };
    }

    const conversationId = await conversacionDeContacto(ghlContactId);
    if (!conversationId) return { analizado: false, motivo: "sin conversación" };

    const transcript = armarTranscript(await mensajesDeConversacion(conversationId));
    const veredicto = await evaluarConversacion(transcript);
    if (!veredicto) return { analizado: false, motivo: "sin veredicto del modelo" };

    if (!veredicto.fallo) {
      return { analizado: true, fallo: false, criterio: veredicto.criterio };
    }

    /**
     * La nota va PRIMERO. Es el tag el que dispara el workflow y hace aparecer al contacto
     * en la cola; si se aplicara antes, existiría una ventana en la que el closer ve la
     * urgencia sin el motivo y lee el texto genérico.
     */
    const idempotencyKey = `analisis:${ghlContactId}:${conversationId}`;
    await ghl().escribirNota({
      ghlContactId,
      cuerpo: `${PREFIJO_NOTA} ${veredicto.motivo}`,
      idempotencyKey: `${idempotencyKey}:nota`,
    });

    const aplicacion = await ghl().aplicarTags({
      ghlContactId,
      tags: [TAG_FALLO],
      idempotencyKey: `${idempotencyKey}:tag`,
    });

    return {
      analizado: true,
      fallo: true,
      criterio: veredicto.criterio,
      // Se reporta lo que REALMENTE pasó, no lo que se intentó (§ puerto: `aplicado`).
      tagAplicado: aplicacion.ok ? aplicacion.aplicado : false,
    };
  } catch (e) {
    return { analizado: false, motivo: (e as Error).message };
  }
}

/**
 * Pasada manual sobre TODOS los contactos de `zona_closer`. La usa el endpoint de disparo
 * manual; el camino normal es el webhook, que analiza de a un contacto por mensaje nuevo.
 */
export async function analizarTerritorioCloser(): Promise<{
  revisados: number;
  resultados: Array<{ contactId: string; nombre: string } & ResultadoAnalisis>;
}> {
  const contactos = await contactosConTag(TAGS.zonaCloser.valor);
  const resultados = await Promise.all(
    contactos.map(async (c) => ({ contactId: c.id, nombre: c.nombre, ...(await analizarYMarcar(c.id)) })),
  );
  return { revisados: contactos.length, resultados };
}
