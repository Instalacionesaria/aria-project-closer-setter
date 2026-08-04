/**
 * El analizador de conversaciones. Uno solo, para los dos territorios.
 *
 * Lee la conversación entre el agente de GHL y el contacto, la evalúa contra la rúbrica de
 * "la IA no atendió bien", y si encontró un fallo aplica `bot_pausado_fallo` + una nota
 * `[IA] …` con el motivo. Ese tag dispara el workflow que apaga al agente, y el par
 * tag+nota es lo que leen `/api/closer/urgentes` y `/api/setter/urgentes` para pintar la
 * cola roja de cada rol.
 *
 * ## Los CUATRO portones (leer antes de tocar nada acá)
 *
 * Cada uno evita una llamada al modelo, y los cuatro existen por una razón distinta. En
 * orden, de más barato a más caro de evaluar:
 *
 * 1. **Territorio = `zona_closer`.** Hoy este es el auditor de CHAT DEL CLOSER y nada más.
 *    Los otros tres que faltan —chat del setter, transcripciones de llamadas del closer y
 *    del setter— van a ser agentes propios, con su rúbrica y su tarjeta. Ver §53.
 *
 * 2. **El bot tiene que estar ATENDIENDO** (`botAtendiendo`, en `contrato.ts`). Este portón
 *    no existía y es el que causó el bug del 2026-08-04: el auditor analizaba cualquier
 *    contacto del territorio, tuviera agente o no. Con el bot apagado la conversación no
 *    tiene ni un mensaje de la IA, y el criterio 2 de la rúbrica es *"la IA dejó de responder
 *    o ignoró al usuario"* — **se cumple siempre**. Fabio Malpartida terminó en la cola roja
 *    con "la IA no respondió a los últimos mensajes" sobre una IA que nunca estuvo prendida.
 *
 * 3. **Ya marcado como fallo.** El bot ya está pausado y el caso ya está en la cola:
 *    re-analizarlo no cambiaría nada y duplicaría la nota.
 *
 * 4. **La conversación tiene que contener al menos un mensaje DE LA IA.** Es el mismo
 *    chequeo que el portón 2, pero sobre los hechos en vez de sobre los tags — cubre el caso
 *    de un tag que miente (quedó puesto, el workflow no corrió, alguien lo editó a mano).
 *    Sin una sola línea "IA:" en el transcript no hay agente que auditar.
 *
 * ## Costo
 *
 * Cada análisis es UNA llamada a Opus 5 y el webhook la dispara en CADA mensaje, entrante y
 * saliente. El transcript se re-manda entero cada vez (hasta 40 mensajes), así que el costo
 * de una conversación crece con el CUADRADO de su longitud. Los portones de arriba son, en
 * la práctica, el control de gasto de este agente. Ver §53 para los números medidos.
 */

import Anthropic from "@anthropic-ai/sdk";
import { botAtendiendo, TAGS } from "../../src/lib/ghl/contrato.js";
import { ghl } from "./ghl/index.js";
import { ORG_ID, db } from "./repo.js";
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

export type Territorio = "closer" | "setter";

/**
 * Los ids que usa la pestaña Auditoría de Agentes. Son los de Francisco (`AgentInfo.id`) y
 * NO se tocan: cada territorio audita a un agente distinto y su resultado va a su tarjeta.
 * Los agentes de VOZ (`lead-flow-voz`, `appointment-flow-voz`) no salen de acá — los audita
 * Fabio con sus propias analizadoras.
 */
export type AgenteTextoId = "lead-flow-ai" | "appointment-flow-ai";

/**
 * Qué hace el agente en cada etapa. NO agrega criterios a la rúbrica — los cinco son los
 * mismos para ambos roles. Solo le dice al auditor cuál era el trabajo del agente, que es
 * lo que permite juzgar bien "prometió algo incorrecto" o "insiste y no entiende": prometer
 * una fecha de cita significa algo distinto según si el agente estaba agendando o
 * acompañando una cita ya agendada.
 *
 * Sale de CLAUDE.md §1 y §11 (el embudo y los dos copilotos), no de una decisión mía.
 */
const TERRITORIOS: Record<Territorio, { tag: string; agenteId: AgenteTextoId; contexto: string }> = {
  closer: {
    tag: TAGS.zonaCloser.valor,
    agenteId: "appointment-flow-ai",
    contexto:
      "El agente auditado es Appointment Flow: atiende la etapa POST-AGENDA. El contacto ya tiene " +
      "una cita agendada, y el trabajo del agente es confirmarla y acompañarla hasta la llamada de venta.",
  },
  setter: {
    tag: TAGS.zonaSetter.valor,
    agenteId: "lead-flow-ai",
    contexto:
      "El agente auditado es Lead Flow: atiende la etapa PRE-AGENDA. El contacto es un lead que todavía " +
      "no agendó, y el trabajo del agente es calificarlo y conseguir que agende la llamada.",
  },
};

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
es el texto que va a leer el closer humano en su cola de intervenciones urgentes.

Además, clasifica el SENTIMIENTO DEL CONTACTO (no el de la IA) a lo largo de la conversación:
- "positivo": el contacto está receptivo, interesado o conforme.
- "neutral": intercambio informativo, sin carga emocional en ninguna dirección.
- "molesto": el contacto muestra fastidio, impaciencia, queja o enojo.

El sentimiento es independiente del fallo: una conversación puede fallar con un contacto que
siguió amable, y otra puede tener un contacto molesto sin que la IA haya hecho nada mal.`;

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
    sentimiento: {
      type: "string",
      enum: ["positivo", "neutral", "molesto"],
      description: "Cómo se fue sintiendo el CONTACTO (no la IA) a lo largo de la conversación.",
    },
  },
  required: ["fallo", "criterio", "motivo", "sentimiento"],
  additionalProperties: false,
} as const;

export type Sentimiento = "positivo" | "neutral" | "molesto";

export interface Veredicto {
  fallo: boolean;
  criterio: string;
  motivo: string;
  /** Alimenta el panel de tres tramos de Auditoría de Agentes. Es del CONTACTO, no de la IA. */
  sentimiento: Sentimiento;
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
export async function evaluarConversacion(
  transcript: string,
  territorio: Territorio = "closer",
): Promise<Veredicto | null> {
  if (!transcript.trim()) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const cliente = new Anthropic();
  const respuesta = await cliente.messages.create({
    model: process.env.CLAUDE_MODEL || "claude-opus-5",
    max_tokens: 2000,
    system: `${TERRITORIOS[territorio].contexto}\n\n${RUBRICA}`,
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
  const sentimientos: Sentimiento[] = ["positivo", "neutral", "molesto"];
  return {
    fallo: Boolean(crudo.fallo),
    criterio: typeof crudo.criterio === "string" ? crudo.criterio : "ninguno",
    motivo: typeof crudo.motivo === "string" ? crudo.motivo : "",
    // El esquema ya lo garantiza; el default existe solo por si algún día se relaja.
    sentimiento: sentimientos.includes(crudo.sentimiento as Sentimiento)
      ? (crudo.sentimiento as Sentimiento)
      : "neutral",
  };
}

export interface ResultadoAnalisis {
  analizado: boolean;
  /** Por qué no se analizó, cuando `analizado` es false. */
  motivo?: string;
  /** Territorio detectado por sus tags. Ausente si no pertenece a ninguno. */
  territorio?: Territorio;
  fallo?: boolean;
  criterio?: string;
  sentimiento?: Sentimiento;
  /** Si la fila de estadística llegó a la base. Falso no invalida el análisis. */
  guardado?: boolean;
  /** Si el tag llegó de verdad a GHL (false en modo stub). */
  tagAplicado?: boolean;
}

/** Persiste el veredicto para que la pestaña de Auditoría de Agentes pueda agregarlo. */
async function guardarAnalisis(e: {
  agenteId: AgenteTextoId;
  ghlContactId: string;
  conversationId: string;
  veredicto: Veredicto;
}): Promise<boolean> {
  try {
    const { error } = await db()
      .from("closer_analisis_agente")
      .insert({
        org_id: ORG_ID,
        agente_id: e.agenteId,
        ghl_contact_id: e.ghlContactId,
        conversation_id: e.conversationId,
        fallo: e.veredicto.fallo,
        criterio: e.veredicto.criterio,
        motivo: e.veredicto.motivo || null,
        sentimiento: e.veredicto.sentimiento,
        modelo: process.env.CLAUDE_MODEL || "claude-opus-5",
      });
    if (error) console.warn("[analizador] no se pudo guardar el análisis:", error.message);
    return !error;
  } catch (err) {
    console.warn("[analizador] no se pudo guardar el análisis:", (err as Error).message);
    return false;
  }
}

/**
 * De qué territorio es este contacto, según sus tags. `null` si de ninguno.
 *
 * El contrato garantiza que los dos tags no conviven (al agendar, el swap reemplaza
 * `zona_setter` por `zona_closer`). Si aun así aparecieran los dos —un workflow a medio
 * migrar, una edición a mano— gana closer: es la etapa más avanzada, y auditar con el
 * contexto de post-agenda a alguien que ya agendó es lo correcto.
 */
export function territorioDe(tags: readonly string[]): Territorio | null {
  if (tags.includes(TERRITORIOS.closer.tag)) return "closer";
  if (tags.includes(TERRITORIOS.setter.tag)) return "setter";
  return null;
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

    /* ── Portón 1: territorio ─────────────────────────────────────────── */
    const territorio = territorioDe(tags);
    if (!territorio) {
      return { analizado: false, motivo: "sin territorio (ni zona_closer ni zona_setter)" };
    }
    if (territorio !== "closer") {
      // El auditor de chat del SETTER va a ser su propio agente (§53). Hasta que exista, este
      // no lo cubre: auditar pre-agenda con la rúbrica de post-agenda daría veredictos malos
      // sobre un trabajo distinto, y encima gastando.
      return { analizado: false, motivo: "el auditor de chat del setter todavía no existe", territorio };
    }

    /* ── Portón 2: el bot tiene que estar atendiendo ──────────────────── */
    if (!botAtendiendo(tags)) {
      return {
        analizado: false,
        motivo: "el agente de IA no está atendiendo a este contacto (sin bot_activado ni bot_reactivar)",
        territorio,
      };
    }

    /* ── Portón 3: ya está en la cola ─────────────────────────────────── */
    if (tags.includes(TAG_FALLO)) {
      return { analizado: false, motivo: "ya marcado como fallo", territorio };
    }

    const conversationId = await conversacionDeContacto(ghlContactId);
    if (!conversationId) return { analizado: false, motivo: "sin conversación", territorio };

    const transcript = armarTranscript(await mensajesDeConversacion(conversationId));

    /* ── Portón 4: los hechos, no los tags ────────────────────────────── */
    if (!transcript.includes("IA:")) {
      return {
        analizado: false,
        motivo: "la conversación no tiene ningún mensaje del agente: no hay nada que auditar",
        territorio,
      };
    }

    const veredicto = await evaluarConversacion(transcript, territorio);
    if (!veredicto) return { analizado: false, motivo: "sin veredicto del modelo", territorio };

    /**
     * Se guarda SIEMPRE, falle o no. El panel de sentimiento de Auditoría de Agentes se
     * calcula sobre todos los análisis: el "85% positivos" sale justamente de las
     * conversaciones que NO fallaron. Guardar solo los fallos dejaría ese panel midiendo
     * únicamente lo que salió mal.
     *
     * Si la escritura falla no se corta el flujo: perder una fila de estadística es mucho
     * menos grave que no pausar un bot que está maltratando a un contacto.
     */
    const guardado = await guardarAnalisis({
      agenteId: TERRITORIOS[territorio].agenteId,
      ghlContactId,
      conversationId,
      veredicto,
    });

    if (!veredicto.fallo) {
      return { analizado: true, territorio, fallo: false, criterio: veredicto.criterio, sentimiento: veredicto.sentimiento, guardado };
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
      territorio,
      fallo: true,
      criterio: veredicto.criterio,
      sentimiento: veredicto.sentimiento,
      guardado,
      // Se reporta lo que REALMENTE pasó, no lo que se intentó (§ puerto: `aplicado`).
      tagAplicado: aplicacion.ok ? aplicacion.aplicado : false,
    };
  } catch (e) {
    return { analizado: false, motivo: (e as Error).message };
  }
}

/**
 * Pasada manual sobre los contactos de un territorio. La usa el endpoint de disparo manual;
 * el camino normal es el webhook, que analiza de a un contacto por mensaje nuevo.
 *
 * **Los candidatos se filtran ACÁ, antes de llamar a `analizarYMarcar`.** Esa función vuelve
 * a pedirle el contacto a GHL para decidir, así que sin este filtro un barrido sobre 200
 * contactos gastaría 200 llamadas a GHL para descartar a los 190 que no tienen bot. Como
 * `contactosConTag` ya devuelve los tags, la decisión es gratis.
 *
 * En serie y no en paralelo: `Promise.all` sobre cientos de contactos dispara cientos de
 * llamadas al modelo a la vez. Es un disparo manual — que tarde no molesta a nadie.
 */
export async function analizarTerritorio(territorio: Territorio): Promise<{
  territorio: Territorio;
  encontrados: number;
  revisados: number;
  omitidos: number;
  resultados: Array<{ contactId: string; nombre: string } & ResultadoAnalisis>;
}> {
  const contactos = await contactosConTag(TERRITORIOS[territorio].tag);
  const candidatos = contactos.filter((c) => botAtendiendo(c.tags) && !c.tags.includes(TAG_FALLO));

  const resultados: Array<{ contactId: string; nombre: string } & ResultadoAnalisis> = [];
  for (const c of candidatos) {
    resultados.push({ contactId: c.id, nombre: c.nombre, ...(await analizarYMarcar(c.id)) });
  }

  return {
    territorio,
    encontrados: contactos.length,
    revisados: candidatos.length,
    omitidos: contactos.length - candidatos.length,
    resultados,
  };
}
