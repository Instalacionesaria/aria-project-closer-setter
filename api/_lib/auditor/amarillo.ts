/**
 * Carril AMARILLO — no hay daño, hay algo que mejorar.
 *
 * ── En qué se diferencia del rojo ─────────────────────────────────────
 *
 * El rojo corre por conversación, en caliente, y su consecuencia es apagarle el bot a alguien.
 * El amarillo corre **una vez por día y por empresa**, en frío, y su consecuencia es una línea en
 * Auditoría de Agentes para el técnico. No genera tarea para ningún closer, no entra a Mi Día ni a
 * Urgentes, y no propone corrección de prompt: redactar el reemplazo es la parte cara del
 * veredicto y acá no hace falta.
 *
 * ── Por qué una dimensión aparte y no un octavo criterio ──────────────
 *
 * Los siete criterios de la rúbrica son de **fallo**: cada uno describe algo que salió mal. El
 * amarillo necesita decir "esto se podía hacer mejor" sin que sea un defecto, y eso no se consigue
 * aflojándole el umbral a los siete. Un criterio con umbral flojo produce ruido, y el ruido le
 * enseña al técnico a ignorar la pestaña — que es exactamente perder la herramienta.
 *
 * ── La escala, y por qué solo el peldaño de abajo se reporta ──────────
 *
 *   · `acompano`    el agente leyó dónde estaba el lead y le respondió a eso.
 *   · `respondio`   contestó bien, pero pasó por alto una señal del lead. Correcto y plano.
 *   · `desacompaso` el lead estaba en un lugar y el agente siguió con su agenda.
 *
 * **Solo `desacompaso` produce hallazgo.** `respondio` se mide y se descarta a propósito: casi
 * toda conversación tiene algo que se podía decir mejor, así que reportarlo sería un amarillo
 * diario garantizado, sin señal. Se pide igual en el esquema para que el modelo tenga dónde poner
 * lo tibio en vez de empujarlo hacia `desacompaso`.
 */

import Anthropic from "@anthropic-ai/sdk";
import { MODELO_AUDITOR, ESFUERZO_AUDITOR } from "../analizador.js";

/** El único valor de `criterio` que escribe este carril. No es de la rúbrica de fallo. */
export const CRITERIO_AMARILLO = "acompanamiento";

export type NivelAcompanamiento = "acompano" | "respondio" | "desacompaso";

export interface MejoraAmarilla {
  nivel: NivelAcompanamiento;
  errorCode: string;
  titulo: string;
  categoria: "comportamiento" | "base_conocimiento" | "informacion_adicional";
  diagnostico: string;
  /** La línea del contacto que marcó dónde estaba. Sin ella no hay hallazgo. */
  evidenciaContacto: string;
  /** La línea `AGENTE IA` que vino después. Sin ella no hay hallazgo. */
  evidenciaIa: string;
}

export type ResultadoAmarillo =
  | { ok: true; mejora: MejoraAmarilla | null; motivo: string }
  | { ok: false; motivo: string };

const DIMENSION = `
──────────────────────────────────────────────────────────────────────
LA DIMENSIÓN: ACOMPAÑAMIENTO
──────────────────────────────────────────────────────────────────────

Esto NO es una auditoría de fallas. Ninguna conversación que llega acá tiene un fallo
detectado — ya pasaron por el carril que los busca. Lo que se evalúa es otra cosa:

  ¿El agente leyó DÓNDE ESTABA EL LEAD, y le respondió a eso?

Primero describís el comportamiento del lead: qué estaba haciendo, qué señal dio. Después
juzgás si la respuesta del agente lo acompañó. En ese orden. Un juicio sobre el agente sin
haber leído primero al lead es una opinión sobre estilo, y de eso no sirve nada.

LA ESCALA — tres niveles, y solo uno se reporta:

  acompano ..... el agente registró la señal del lead y su respuesta va hacia ahí. Aunque no
                 haya resuelto nada todavía.
  respondio .... la respuesta es correcta pero pasó de largo una señal: una duda insinuada,
                 una prioridad que compite, un interés que subió o bajó. Sin daño, sin
                 desconexión. ESTE NIVEL NO SE REPORTA — es la mayoría de las conversaciones
                 buenas, y reportarlo sería un aviso por día sin ninguna señal adentro.
  desacompaso .. el lead estaba en un lugar y el agente siguió con su agenda. Nadie se enojó
                 ni se fue, por eso no es rojo. Pero la conversación perdió temperatura y se
                 puede señalar QUÉ momento exacto la perdió.

REGLA DE ATRIBUCIÓN, INNEGOCIABLE: solo podés imputarle al agente lo que dice una línea
"AGENTE IA". Si quien respondió después de la señal del lead fue un ASESOR HUMANO, una
AUTOMATIZACIÓN o una línea de ORIGEN NO IDENTIFICADO, no hay nada que evaluar del agente.

DESCARTES — si aplica cualquiera, el nivel es "acompano" y no reportás nada:

  · El contacto mandó menos de 3 mensajes con texto. No dio señal suficiente que leer, y
    juzgar el acompañamiento sobre dos líneas es inventar.
  · La conversación terminó en cita agendada, en una confirmación de compra o en un "sí"
    explícito. El agente llegó a donde tenía que llegar; una nota de estilo sobre un cierre
    que funcionó no vale el día del técnico.
  · Quien respondió después de la señal no fue el AGENTE IA.
  · El lead pidió algo que el prompt del agente explícitamente no cubre. Es un límite de
    diseño, no un desacople del agente.
  · No podés copiar LAS DOS citas —la línea del contacto y la línea "AGENTE IA" siguiente—.
    Sin las dos, el hallazgo no existe y no lo reportás. Es la misma regla del carril rojo:
    una recomendación sin la línea que la prueba no se puede verificar ni discutir.

QUÉ DEVOLVÉS SI ES "desacompaso":

  · error_code: un identificador estable en snake_case de ESTE patrón, no de esta
    conversación. Va a servir para agrupar el mismo problema entre días distintos, así que
    tiene que describir la forma del error ("ignora_objecion_de_tiempo"), no el caso
    ("juan_no_contesto").
  · titulo: una línea, en español, que el técnico entienda sin abrir nada.
  · diagnostico: qué señal dio el lead, qué hizo el agente, y qué convenía hacer. Sin
    redactar el reemplazo del prompt: eso NO se pide acá.
  · Las dos citas, textuales.
`;

const ESQUEMA_AMARILLO = {
  type: "object",
  properties: {
    comportamiento_lead: { type: "string" },
    nivel: { type: "string", enum: ["acompano", "respondio", "desacompaso"] },
    motivo_descarte: { type: "string" },
    error_code: { type: "string" },
    titulo: { type: "string" },
    categoria: {
      type: "string",
      enum: ["comportamiento", "base_conocimiento", "informacion_adicional"],
    },
    diagnostico: { type: "string" },
    evidencia_contacto: { type: "string" },
    evidencia_ia: { type: "string" },
  },
  required: [
    "comportamiento_lead",
    "nivel",
    "motivo_descarte",
    "error_code",
    "titulo",
    "categoria",
    "diagnostico",
    "evidencia_contacto",
    "evidencia_ia",
  ],
  additionalProperties: false,
} as const;

/** Mismo saneo que el carril rojo: el CHECK de Postgres exige `^[a-z0-9_]{3,48}$`. */
function normalizar(code: string): string {
  return code
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

/**
 * Una sola llamada al modelo. Devuelve `mejora: null` cuando no hay nada que reportar, que es el
 * caso esperado la mayoría de los días.
 *
 * `ok: false` es distinto de `mejora: null` y la diferencia importa: `null` = se miró y no había
 * nada; `ok: false` = no se pudo mirar. Confundirlos haría que un día con la API caída se viera
 * igual que un día sin hallazgos.
 */
export async function buscarMejora(opts: {
  apiKey: string;
  contexto: string;
  prompt: string;
  transcript: string;
}): Promise<ResultadoAmarillo> {
  const cliente = new Anthropic({ apiKey: opts.apiKey });

  let respuesta: Anthropic.Message;
  try {
    respuesta = await cliente.messages.create({
      model: MODELO_AUDITOR,
      // El mismo techo que el rojo: cubre pensamiento MÁS texto, y con esfuerzo `high` un techo
      // corto devuelve un JSON cortado que se reporta como "sin veredicto" sin decir por qué.
      max_tokens: 8000,
      system: [
        { type: "text" as const, text: opts.contexto },
        {
          type: "text" as const,
          text: `<prompt_del_agente>\n${opts.prompt}\n</prompt_del_agente>`,
        },
        {
          type: "text" as const,
          text: DIMENSION,
          // El system no cambia entre corridas de la misma empresa. Es el bloque grande —la
          // dimensión más el prompt del agente— y cachearlo cuesta una línea.
          cache_control: { type: "ephemeral" as const },
        },
      ],
      output_config: {
        effort: ESFUERZO_AUDITOR,
        format: { type: "json_schema", schema: ESQUEMA_AMARILLO },
      },
      messages: [{ role: "user", content: `Conversación:\n\n${opts.transcript}` }],
    } as Anthropic.MessageCreateParamsNonStreaming);
  } catch (e) {
    return { ok: false, motivo: `la llamada al modelo falló: ${(e as Error).message}` };
  }

  if (respuesta.stop_reason === "refusal") return { ok: false, motivo: "el modelo declinó responder" };
  if (respuesta.stop_reason === "max_tokens") {
    return { ok: false, motivo: "la respuesta salió truncada (max_tokens) — subir el techo" };
  }

  const texto = respuesta.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!texto) return { ok: false, motivo: "el modelo no devolvió texto" };

  let crudo: Record<string, unknown>;
  try {
    crudo = JSON.parse(texto) as Record<string, unknown>;
  } catch {
    return { ok: false, motivo: "la respuesta no era JSON válido" };
  }

  const nivel = String(crudo.nivel ?? "") as NivelAcompanamiento;
  if (nivel !== "desacompaso") {
    return { ok: true, mejora: null, motivo: `nivel ${nivel || "sin nivel"}: no se reporta` };
  }

  const errorCode = normalizar(String(crudo.error_code ?? ""));
  const evidenciaContacto = String(crudo.evidencia_contacto ?? "").trim();
  const evidenciaIa = String(crudo.evidencia_ia ?? "").trim();
  const titulo = String(crudo.titulo ?? "").trim();

  /**
   * Se descarta acá y no en el prompt: el modelo puede decir `desacompaso` y no traer las citas,
   * y un hallazgo sin la línea que lo prueba no se puede verificar. El rojo hace lo mismo.
   */
  if (!errorCode || errorCode.length < 3 || !titulo || !evidenciaContacto || !evidenciaIa) {
    return { ok: true, mejora: null, motivo: "desacompaso sin las dos citas o sin código: se descarta" };
  }

  const categoria = crudo.categoria as MejoraAmarilla["categoria"];
  return {
    ok: true,
    motivo: "hay una mejora",
    mejora: {
      nivel,
      errorCode,
      titulo: titulo.slice(0, 120),
      categoria: ["comportamiento", "base_conocimiento", "informacion_adicional"].includes(categoria)
        ? categoria
        : "comportamiento",
      diagnostico: String(crudo.diagnostico ?? "").trim(),
      evidenciaContacto,
      evidenciaIa,
    },
  };
}
