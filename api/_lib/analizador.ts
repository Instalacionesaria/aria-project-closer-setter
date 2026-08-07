/**
 * El auditor de conversaciones del agente de IA.
 *
 * Lee el chat entre el agente de GHL y el contacto, lo evalúa contra una rúbrica, y produce
 * dos salidas que ANTES eran una sola y no debían serlo:
 *
 *   · **Intervención** — hay daño en curso y un humano tiene que tomar la conversación ya.
 *     Aplica `bot_pausado_fallo` + nota `[IA] …`, que es lo que enciende la cola roja.
 *   · **Hallazgos** — qué se puede corregir en el PROMPT del agente. No interrumpe a nadie:
 *     alimenta la lista de trabajo del técnico en Auditoría de Agentes.
 *
 * Que fueran lo mismo es lo que hacía que un "podría ser más breve" le apagara el bot a una
 * persona real.
 *
 * ## Los portones (leer antes de tocar nada)
 *
 * En orden, de más barato a más caro de evaluar. Cada uno evita gasto y existe por una
 * razón distinta.
 *
 * 1. **Territorio = `zona_closer`.** Hoy este es el auditor de CHAT DEL CLOSER y nada más.
 *    Los otros tres —chat del setter, y las transcripciones de llamadas de los dos— van a
 *    ser agentes propios, con su rúbrica y su tarjeta (§53.4).
 *
 * 2. **El bot tiene que estar ATENDIENDO** (`botAtendiendo`). Sin este portón, el criterio
 *    "la IA dejó de responder" se cumple SIEMPRE que no hay agente, y eso produjo el falso
 *    positivo del 2026-08-04.
 *
 *    ⚠️ **Hoy este portón bloquea al 100%, a propósito.** Verificado contra la cuenta:
 *    `bot_activado` y `bot_reactivar` no los tiene NINGÚN contacto, y los workflows que los
 *    aplicarían (🟦 08.1 / 08.2) están en borrador. Decisión de Fabio: se espera a Francisco
 *    en vez de adivinar el estado del bot. `/api/agentes/auditor-estado` reporta el embudo
 *    para que ese cero sea un reclamo concreto y no un misterio.
 *
 * 3. **Ya marcado como fallo.** El bot ya está pausado y el caso ya está en la cola.
 *
 * 4. **Debounce: 5 mensajes nuevos de la IA** (regla de Fabio, `AUDITOR_UMBRAL_IA`). No se
 *    audita mensaje por mensaje; se espera a que haya conversación y se juzga entera con
 *    contexto. Ver `decidirAnalisis` para por qué es una resta y no un contador.
 *
 * 5. **Tiene que haber al menos un mensaje DEL AGENTE en el transcript.** Es el mismo
 *    chequeo que el portón 2 pero sobre los hechos en vez de los tags: cubre un tag que
 *    quedó mintiendo porque un workflow no corrió o alguien lo editó a mano.
 *
 * ## Quién escribió qué
 *
 * "Outbound" NO quiere decir "IA": por el mismo canal salen el chatbot, un humano tipeando
 * en GHL, y las plantillas de los workflows. La distinción vive en `src/lib/ghl/autoria.ts`
 * y acá se usa para dos cosas — contar los mensajes del agente (el debounce) y etiquetar el
 * transcript, para que el modelo no le impute al agente lo que escribió otro.
 *
 * ## Costo
 *
 * Una llamada al modelo por análisis. Antes se disparaba en CADA mensaje con el transcript
 * entero, así que el costo de una conversación crecía con el CUADRADO de su longitud; con
 * el debounce, una conversación de 20 mensajes pasa de ~20 llamadas a ~2. Ver §53.3.
 */

import Anthropic from "@anthropic-ai/sdk";
import { botAtendiendo, TAGS } from "../../src/lib/ghl/contrato.js";
import { ETIQUETA_AUTOR, type AutorMensaje } from "../../src/lib/ghl/autoria.js";
import { ZONA_HORARIA_ORG } from "../../src/lib/fechas.js";
import { autorDeMensajeGhl } from "./autoria.js";
import { env } from "./env.js";
import { ghl } from "./ghl/index.js";
import { cargarPromptAgente, type PromptAgente } from "./promptAgente.js";
import { credencialesActivas } from "./credenciales.js";
import { db, orgActiva } from "./repo.js";
import {
  contactosConTag,
  conversacionDeContacto,
  esMensajeDeChat,
  mensajesDeConversacionPaginado,
  textoDeMensaje,
  type MensajeGhl,
} from "./ghl/lectura.js";

/** El modelo de la empresa activa, o el default global. Un solo lugar que lo decide. */
const modeloDeLaEmpresa = (): string =>
  credencialesActivas()?.anthropicModelo ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-5";

/** El tag que enciende la cola roja y apaga al agente de GHL. */
export const TAG_FALLO = "bot_pausado_fallo";

/** Prefijo de la nota, para poder releerla después sin confundirla con notas humanas. */
const PREFIJO_NOTA = "[IA]";

/** Solo se manda al modelo la cola de la conversación — lo viejo no explica el fallo de hoy. */
const MAX_MENSAJES = 40;

/** Páginas de GHL que pide el analizador. 3×100 cubre cualquier conversación real. */
const PAGINAS_GHL = 3;

/**
 * A partir de cuántos minutos de silencio "la IA dejó de responder" deja de ser una
 * conjetura. Se mide en código y se le pasa al modelo como dato: los modelos calculan mal
 * el tiempo, y el criterio 2 es enteramente temporal.
 */
const UMBRAL_SILENCIO_MIN = 60;

/** Tope de hallazgos por análisis. Se recorta en código: `maxItems` no existe en el esquema. */
const MAX_HALLAZGOS = 3;

export type Territorio = "closer" | "setter";

/**
 * Los ids que usa la pestaña Auditoría de Agentes. Son los de Francisco (`AgentInfo.id`) y
 * NO se tocan: cada territorio audita a un agente distinto y su resultado va a su tarjeta.
 * Los agentes de VOZ (`lead-flow-voz`, `appointment-flow-voz`) no salen de acá — todavía no
 * tienen fuente: GHL no expone las llamadas ni sus transcripciones (§53.4).
 */
export type AgenteTextoId = "lead-flow-ai" | "appointment-flow-ai";

/** Qué agentes tienen auditor CABLEADO hoy. Un solo lugar, para que los endpoints no diverjan. */
export const AUDITORES_ACTIVOS: readonly AgenteTextoId[] = ["appointment-flow-ai"];

/**
 * Qué hace el agente en cada etapa. NO agrega criterios a la rúbrica — son los mismos para
 * ambos roles. Solo le dice al auditor cuál era el trabajo del agente, que es lo que permite
 * juzgar bien "prometió algo incorrecto": prometer una fecha significa algo distinto según
 * si el agente estaba agendando o acompañando una cita ya agendada.
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

/* ================================================================== */
/* La rúbrica                                                          */
/* ================================================================== */

/**
 * ## Qué cambió respecto de la versión original, y por qué
 *
 * La rúbrica vieja tenía cinco criterios sueltos y un booleano. Cinco defectos, todos
 * verificados contra conversaciones reales:
 *
 * 1. Un solo `fallo` decidía a la vez "apagar el bot" y "hay algo que mejorar".
 * 2. Ningún criterio exigía evidencia, así que un veredicto era infalsificable y los
 *    motivos salían genéricos ("requiere intervención").
 * 3. "Dejó de responder" es una afirmación temporal y el transcript no tenía ni una fecha.
 * 4. No existía "no auditable": tres audios sin transcripción se juzgaban igual que veinte
 *    mensajes de texto.
 * 5. Un traspaso a un humano se leía como abandono del agente.
 *
 * Cada criterio pasa a tener una condición de DISPARO y una lista de DESCARTES. Los
 * descartes son la parte que importa: son los que evitan que el modelo confirme el criterio
 * por parecido semántico.
 */
const RUBRICA = `Sos un auditor de calidad de agentes de IA que atienden conversaciones de venta por
WhatsApp. Tu trabajo tiene dos salidas distintas y no hay que mezclarlas:

  A. INTERVENCIÓN: ¿hay que apagar al agente y que un humano tome esta conversación AHORA?
     Esto le corta el bot a una persona real y le suma una tarea urgente al closer. Se
     reserva para daño en curso.
  B. HALLAZGOS: ¿qué le pasa al AGENTE que se pueda corregir en su prompt? Esto no
     interrumpe a nadie: alimenta la lista de trabajo del técnico.

Una conversación puede tener hallazgos sin necesitar intervención, y puede necesitar
intervención sin que el agente haya hecho nada mal.

──────────────────────────────────────────────────────────────────────
CÓMO LEER EL TRANSCRIPT
──────────────────────────────────────────────────────────────────────

Cada línea viene con fecha, hora y AUTOR REAL:

  CONTACTO ............... la persona. Es a quien se atiende.
  AGENTE IA .............. el agente automático que estás auditando.
  ASESOR HUMANO .......... una persona del equipo escribiendo a mano.
  AUTOMATIZACIÓN ......... una plantilla enviada por un flujo automatizado (recordatorios,
                           confirmaciones). NO la escribió el agente.
  ORIGEN NO IDENTIFICADO . el sistema no pudo atribuir este mensaje.

REGLA DE ATRIBUCIÓN, INNEGOCIABLE: solo podés imputarle al agente lo que dice una línea
"AGENTE IA". Si el problema lo causó una AUTOMATIZACIÓN, un ASESOR HUMANO o una línea de
ORIGEN NO IDENTIFICADO, no es un hallazgo del agente — mencionalo en el diagnóstico si hace
falta para entender la conversación, pero no lo reportes como falla suya ni propongas
corregir su prompt por eso.

Un texto entre corchetes como [nota de voz sin transcripción] es un mensaje que existió pero
cuyo contenido no tenemos. No supongas qué decía.

──────────────────────────────────────────────────────────────────────
PRECONDICIÓN — CUÁNDO NO SE AUDITA
──────────────────────────────────────────────────────────────────────

Antes de evaluar nada, verificá que la conversación se pueda auditar. Si NO se puede,
devolvé auditable=false con el motivo, hallazgos vacíos, requiere_intervencion=false, y nada
más. No fuerces un veredicto.

No es auditable cuando:
  · No hay ninguna línea "AGENTE IA". Sin agente no hay nada que auditar, y bajo ninguna
    circunstancia eso es una falla del agente: es la ausencia de un agente.
  · Más de la mitad de los mensajes son [audio]/[imagen] sin texto.
  · Hay menos de dos intercambios reales (menos de 2 del contacto o menos de 2 del agente).

──────────────────────────────────────────────────────────────────────
LOS CRITERIOS
──────────────────────────────────────────────────────────────────────

Cada criterio tiene una condición de DISPARO y una lista de DESCARTES. Si aplica cualquier
descarte, el criterio NO se cumple, por más que el disparo parezca darse. Y cada hallazgo
exige una CITA TEXTUAL del transcript: si no podés copiar la línea exacta que lo prueba, el
hallazgo no existe y no lo reportás.

1. FRUSTRACIÓN NO MANEJADA  (frustracion)
   Disparo: el contacto expresa fastidio, queja, reproche o enojo, y la respuesta siguiente
   del AGENTE IA lo ignora, lo repite con otras palabras, o sigue con su guion.
   Descartes: · el agente reconoció el fastidio y cambió de enfoque, aunque no lo resolviera;
              · quien respondió después fue un ASESOR HUMANO;
              · el contacto está molesto con un tercero (el precio, la empresa, otra
                persona), no con la atención del agente.

2. ABANDONÓ LA CONVERSACIÓN  (dejo_de_responder)
   Disparo: los TRES a la vez —
     (a) el último mensaje del transcript es del CONTACTO;
     (b) nadie respondió después: ni AGENTE IA, ni ASESOR HUMANO, ni AUTOMATIZACIÓN;
     (c) el silencio supera el umbral que figura en HECHOS MEDIDOS.
   Descartes: · alguien respondió después, aunque sea una AUTOMATIZACIÓN — eso es un
                traspaso o un seguimiento, no un abandono;
              · el silencio no llega al umbral: la conversación sigue viva;
              · el último mensaje del contacto es un cierre que no pide respuesta
                ("dale, gracias", "perfecto", "ahí lo veo").
   NUNCA uses este criterio para decir que "el agente no estuvo presente" o que "no hubo
   respuesta automática": la ausencia de agente ya se filtró en la precondición. Este
   criterio es sobre un agente que SÍ estaba atendiendo y dejó colgada una pregunta concreta.

3. PROMESA INCORRECTA O CONTRADICCIÓN  (promesa_incorrecta)
   Disparo: el AGENTE IA afirma algo verificablemente falso, se contradice con algo que él
   mismo dijo antes, o promete un precio, una fecha, un descuento, un plan de pago o una
   condición que no le corresponde ofrecer.
   Descartes: · la promesa la hizo una AUTOMATIZACIÓN o un ASESOR HUMANO;
              · el agente aclaró o corrigió en el mismo tramo de la conversación;
              · es una respuesta genérica y prudente ("un asesor lo va a confirmar").

4. NO ES LO QUE BUSCA  (no_es_lo_que_busca)
   Disparo: el contacto dice explícitamente que el producto, el precio o la modalidad no le
   sirven, y el agente sigue empujando el mismo camino sin registrar la objeción.
   Descartes: · el contacto está negociando o pidiendo información, que es comportamiento
                normal de compra;
              · el agente registró la objeción y ofreció una alternativa real.

5. INSISTE Y NO LO ENTIENDE  (insiste_no_entiende)
   Disparo: el contacto pide LO MISMO tres veces o más y el agente responde tres veces sin
   darle lo que pide.
   Descartes: · el agente pidió un dato que necesitaba para poder resolverlo;
              · lo que pide está fuera de lo que el agente puede hacer y el agente lo dijo
                con claridad (eso, si acaso, es el criterio 6).

6. FUERA DE ALCANCE SIN SALIDA  (fuera_de_alcance)
   Disparo: el contacto necesita algo que el agente no puede resolver y el agente ni lo
   deriva a un humano ni dice qué va a pasar: lo deja en un callejón.
   Descartes: · el agente derivó, o dijo explícitamente que un asesor iba a continuar.

7. LE FALTÓ UN DATO QUE DEBERÍA TENER  (dato_faltante)
   Disparo: el contacto pregunta algo razonable sobre el producto, el proceso o la
   logística, y el agente no lo sabe o lo esquiva — cuando es información que debería estar
   en su base de conocimiento.
   Descartes: · es información que legítimamente depende del caso puntual y requiere a un
                humano.

──────────────────────────────────────────────────────────────────────
INTERVENCIÓN HUMANA — CUÁNDO SÍ
──────────────────────────────────────────────────────────────────────

requiere_intervencion=true SOLO si se cumple al menos una:
  · el contacto está claramente enojado o a punto de irse, y el agente no lo está manejando;
  · el agente dio información incorrecta sobre dinero, fechas o condiciones, y el contacto
    la está tomando por buena;
  · el contacto pidió algo concreto tres o más veces sin obtenerlo;
  · el contacto pidió expresamente hablar con una persona.

NO es intervención: que el agente sea verboso, formal, repetitivo, poco cálido, o que se le
escape una oportunidad de venta. Todo eso son hallazgos.

Si requiere_intervencion es true, motivo_intervencion es UNA frase en español, concreta y
específica de ESTA conversación — la va a leer el closer en su cola de urgencias y tiene que
saber qué pasó sin abrir el chat. Nada de "requiere revisión".

──────────────────────────────────────────────────────────────────────
SEVERIDAD DE CADA HALLAZGO
──────────────────────────────────────────────────────────────────────

  rojo ...... le cuesta clientes o le da información falsa a la gente. Si se repite, hay que
              corregir el prompt esta semana.
  amarillo .. le baja la conversión o la calidad, sin daño directo.

Un hallazgo puede ser rojo sin que la conversación requiera intervención (el daño ya ocurrió
y el contacto se fue tranquilo), y puede haber intervención con hallazgos solo amarillos.

CATEGORÍA de cada hallazgo:
  comportamiento ....... cómo se comporta el agente (tono, largo, insistencia, manejo).
  base_conocimiento .... le falta un dato o tiene uno equivocado.
  informacion_adicional  debería estar diciendo algo que hoy no dice.

──────────────────────────────────────────────────────────────────────
LA CORRECCIÓN AL PROMPT
──────────────────────────────────────────────────────────────────────

Si recibiste un bloque <prompt_del_agente>:
  · Citá en fragmento_prompt el texto EXACTO Y LITERAL del prompt que causa o permite la
    falla. No lo parafrasees. Si no encontrás ningún fragmento que la explique, dejalo en
    null — no inventes una cita.
  · correccion_tipo="reemplazo" y en correccion escribí el texto que va EN LUGAR de ese
    fragmento: listo para pegar, en el mismo idioma, tono y formato que el resto del prompt,
    sin comentarios ni explicaciones alrededor.
  · La corrección no puede contradecir otras partes del prompt. Si el conflicto es
    inevitable, decilo en el diagnóstico.

Si NO recibiste el prompt del agente:
  · fragmento_prompt=null, correccion_tipo="agregado".
  · En correccion escribí una instrucción autónoma, lista para agregar al prompt, que evite
    esta falla. Empezá indicando a qué sección debería ir.

En los dos casos: la corrección arregla el PATRÓN, no este caso puntual. No menciones al
contacto ni cites la conversación adentro del bloque de corrección.

──────────────────────────────────────────────────────────────────────
EL CÓDIGO DE PATRÓN (error_code)
──────────────────────────────────────────────────────────────────────

Agrupa casos iguales bajo un mismo nombre, así el técnico ve "×15 casos" en vez de quince
problemas sueltos. En <patrones_conocidos> tenés los que ya se detectaron: SI TU HALLAZGO ES
EL MISMO PATRÓN, REUSÁ ESE CÓDIGO EXACTO, aunque vos lo hubieras nombrado distinto. Inventá
uno nuevo solo si de verdad no existe.

Formato: minúsculas, guiones bajos, 3 a 48 caracteres, sin acentos ni espacios. Describe la
FALLA, no la conversación: "promete_financiamiento_inexistente", no "caso_juan_perez". El
titulo es ese mismo patrón en lenguaje humano, 6 palabras o menos.

Reportá como máximo ${MAX_HALLAZGOS} hallazgos, los más importantes.

──────────────────────────────────────────────────────────────────────
SENTIMIENTO DEL CONTACTO
──────────────────────────────────────────────────────────────────────

Del CONTACTO, no del agente, a lo largo de toda la conversación:
  positivo · receptivo, interesado, conforme
  neutral  · intercambio informativo, sin carga emocional
  molesto  · fastidio, impaciencia, queja o enojo

Es independiente del resto: una conversación puede fallar con un contacto que se mantuvo
amable, y otra puede tener un contacto molesto sin que el agente haya hecho nada mal.`;

const CRITERIOS = [
  "frustracion",
  "dejo_de_responder",
  "promesa_incorrecta",
  "no_es_lo_que_busca",
  "insiste_no_entiende",
  "fuera_de_alcance",
  "dato_faltante",
  "ninguno",
] as const;

/**
 * El esquema es el contrato: el modelo no puede devolver otra forma.
 *
 * Tres restricciones reales de structured outputs que hay que respetar:
 *   · `maxItems` no está soportado — el tope de hallazgos se recorta en código.
 *   · `additionalProperties: false` es obligatorio en CADA objeto, incluidos los anidados.
 *   · Nada de `minLength`/`pattern`. El formato de `error_code` lo valida el CHECK de
 *     Postgres y lo normaliza `normalizarErrorCode` antes de insertar.
 *
 * `fragmento_prompt` va en `required` con tipo nullable en vez de ser opcional: una clave
 * opcional en un esquema estricto es más frágil que una obligatoria que puede ser null.
 */
const ESQUEMA_VEREDICTO = {
  type: "object",
  properties: {
    auditable: { type: "boolean" },
    motivo_no_auditable: {
      type: "string",
      enum: ["", "sin_mensajes_del_agente", "mayormente_audio", "conversacion_muy_corta"],
    },
    requiere_intervencion: { type: "boolean" },
    motivo_intervencion: { type: "string" },
    criterio_principal: { type: "string", enum: [...CRITERIOS] },
    sentimiento: { type: "string", enum: ["positivo", "neutral", "molesto"] },
    hallazgos: {
      type: "array",
      items: {
        type: "object",
        properties: {
          error_code: { type: "string" },
          titulo: { type: "string" },
          categoria: {
            type: "string",
            enum: ["comportamiento", "base_conocimiento", "informacion_adicional"],
          },
          severidad: { type: "string", enum: ["rojo", "amarillo"] },
          criterio: { type: "string", enum: [...CRITERIOS] },
          diagnostico: { type: "string" },
          fragmento_prompt: { type: ["string", "null"] },
          prompt_seccion: { type: ["string", "null"] },
          correccion_tipo: { type: "string", enum: ["reemplazo", "agregado"] },
          correccion: { type: "string" },
          evidencia_usuario: { type: "string" },
          evidencia_ia: { type: "string" },
        },
        required: [
          "error_code",
          "titulo",
          "categoria",
          "severidad",
          "criterio",
          "diagnostico",
          "fragmento_prompt",
          "prompt_seccion",
          "correccion_tipo",
          "correccion",
          "evidencia_usuario",
          "evidencia_ia",
        ],
        additionalProperties: false,
      },
    },
  },
  required: [
    "auditable",
    "motivo_no_auditable",
    "requiere_intervencion",
    "motivo_intervencion",
    "criterio_principal",
    "sentimiento",
    "hallazgos",
  ],
  additionalProperties: false,
} as const;

export type Sentimiento = "positivo" | "neutral" | "molesto";
export type Severidad = "rojo" | "amarillo";
export type CategoriaHallazgo = "comportamiento" | "base_conocimiento" | "informacion_adicional";

export interface Hallazgo {
  errorCode: string;
  titulo: string;
  categoria: CategoriaHallazgo;
  severidad: Severidad;
  criterio: string;
  diagnostico: string;
  /** Cita literal del prompt del agente. `null` = el auditor no lo tenía o no encontró el fragmento. */
  fragmentoPrompt: string | null;
  promptSeccion: string | null;
  correccionTipo: "reemplazo" | "agregado";
  correccion: string;
  evidenciaUsuario: string;
  evidenciaIa: string;
}

export interface Veredicto {
  auditable: boolean;
  motivoNoAuditable: string;
  requiereIntervencion: boolean;
  motivoIntervencion: string;
  criterioPrincipal: string;
  /** Del CONTACTO, no de la IA. Alimenta el panel de tres tramos de Auditoría de Agentes. */
  sentimiento: Sentimiento;
  hallazgos: Hallazgo[];
}

/* ================================================================== */
/* El transcript y los hechos medidos                                  */
/* ================================================================== */

export interface MensajeClasificado {
  autor: AutorMensaje;
  texto: string;
  /** epoch ms. 0 si GHL no mandó fecha. */
  cuando: number;
  /** `true` si el mensaje existió pero no tenemos su contenido (audio, imagen). */
  sinTexto: boolean;
}

const partesFechaHora = new Intl.DateTimeFormat("es-PE", {
  timeZone: ZONA_HORARIA_ORG,
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * `dd/MM HH:mm` en la zona de la org, compuesto y rellenado a mano.
 *
 * Ni `format()` ni `formatToParts()` alcanzan solos: con `es-PE`, pedir fecha y hora juntas
 * hace que el locale elija su propio esqueleto e IGNORE el `2-digit` del día y el mes —
 * devuelve `4/8, 13:00`. El `padStart` no es paranoia: el sello lo lee un modelo que tiene
 * que comparar horas entre líneas, y un ancho variable es exactamente lo que lo confunde.
 * Del formateador se usa solo la conversión de zona horaria, que es lo que sí hace bien.
 */
function selloDeTiempo(d: Date): string {
  const p = Object.fromEntries(partesFechaHora.formatToParts(d).map((x) => [x.type, x.value]));
  const dd = (v: string | undefined) => String(v ?? "").padStart(2, "0");
  return `${dd(p.day)}/${dd(p.month)} ${dd(p.hour)}:${dd(p.minute)}`;
}

/**
 * Los mensajes de GHL, en orden cronológico y con su autor resuelto.
 *
 * GHL los devuelve del más reciente al más antiguo. Se invierte, se descartan los eventos
 * del sistema, y se recorta a los últimos `MAX_MENSAJES` — lo viejo no explica el fallo de
 * hoy y el transcript es lo que domina el costo del análisis.
 */
export function clasificarMensajes(mensajes: MensajeGhl[]): MensajeClasificado[] {
  return [...mensajes]
    .filter(esMensajeDeChat)
    .reverse()
    .slice(-MAX_MENSAJES)
    .map((m) => ({
      autor: autorDeMensajeGhl(m),
      texto: textoDeMensaje(m),
      cuando: m.dateAdded ? Date.parse(m.dateAdded) : 0,
      sinTexto: !(m.body ?? "").trim(),
    }));
}

/**
 * El transcript que ve el modelo: una línea por mensaje, con fecha, hora y autor real.
 *
 * Se ETIQUETA en vez de filtrar. El razonamiento completo está en `autoria.ts`, pero el
 * resumen es que sin ver la plantilla de workflow que enojó al contacto, el auditor le
 * atribuye el enojo al agente y escribe un motivo falso en la nota `[IA]`.
 */
export function armarTranscript(clasificados: MensajeClasificado[], truncado = false): string {
  const lineas = clasificados.map((m) => {
    const sello = m.cuando ? `[${selloDeTiempo(new Date(m.cuando))}] ` : "";
    return `${sello}${ETIQUETA_AUTOR[m.autor]}: ${m.texto}`;
  });
  if (truncado) {
    lineas.unshift("[…la conversación es más larga; se muestran solo los mensajes más recientes]");
  }
  return lineas.join("\n");
}

/**
 * Los hechos que el modelo NO tiene que estimar.
 *
 * "Dejó de responder" es una afirmación temporal, y los modelos calculan mal el tiempo. Se
 * mide acá y se le pasa como dato, con la instrucción de no recalcularlo.
 */
export function hechosMedidos(clasificados: MensajeClasificado[], ahoraMs = Date.now()): string {
  const cuenta = (a: AutorMensaje) => clasificados.filter((m) => m.autor === a).length;
  const ultimo = clasificados[clasificados.length - 1];
  const ultimoAgente = [...clasificados].reverse().find((m) => m.autor === "agente_ia");
  const sinTexto = clasificados.filter((m) => m.sinTexto).length;

  const hace = (ms: number | undefined) => {
    if (!ms) return "sin fecha";
    const min = Math.max(0, Math.round((ahoraMs - ms) / 60_000));
    if (min < 60) return `hace ${min} min`;
    const h = Math.floor(min / 60);
    return h < 48 ? `hace ${h} h ${min % 60} min` : `hace ${Math.floor(h / 24)} días`;
  };

  // ¿Quedó una pregunta del contacto sin que nadie —ni el agente, ni un humano, ni una
  // plantilla— dijera nada después? Es la condición (b) del criterio 2, y es un hecho
  // estructural del arreglo, no una interpretación.
  const respondieronDespues = ultimo ? ultimo.autor !== "contacto" : false;

  return [
    "HECHOS MEDIDOS (calculados por el sistema — no los recalcules, no los contradigas):",
    `- Mensajes en el transcript: ${clasificados.length} (contacto ${cuenta("contacto")} · ` +
      `agente IA ${cuenta("agente_ia")} · asesor humano ${cuenta("asesor")} · ` +
      `automatización ${cuenta("workflow")} · sin identificar ${cuenta("desconocido")})`,
    `- Último mensaje: de ${ultimo ? ETIQUETA_AUTOR[ultimo.autor] : "—"}, ${hace(ultimo?.cuando)}`,
    `- Último mensaje del AGENTE IA: ${ultimoAgente ? hace(ultimoAgente.cuando) : "nunca escribió"}`,
    `- ¿Alguien respondió después del último mensaje del contacto?: ${respondieronDespues ? "SÍ" : "NO"}`,
    `- Mensajes sin texto (audio/imagen): ${sinTexto} de ${clasificados.length}`,
    `- Umbral de silencio para "dejó de responder": ${UMBRAL_SILENCIO_MIN} minutos`,
  ].join("\n");
}

/* ================================================================== */
/* La llamada al modelo                                                */
/* ================================================================== */

export type ResultadoEvaluacion = { ok: true; veredicto: Veredicto } | { ok: false; motivo: string };

const normalizarErrorCode = (crudo: string): string =>
  crudo
    .normalize("NFD")
    // Los diacríticos combinantes, por code point y no como literales: un editor que
    // normalice el archivo dejaría la clase de caracteres vacía sin que nada falle.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);

/** Patrones ya vistos, para que el modelo reuse el código en vez de inventar uno por caso. */
async function patronesConocidos(agenteId: AgenteTextoId): Promise<string> {
  const { data } = await db()
    .from("closer_hallazgo_agente")
    .select("error_code, titulo")
    .eq("agente_id", agenteId)
    .order("detectado_el", { ascending: false })
    .limit(200);

  const vistos = new Map<string, string>();
  for (const f of (data ?? []) as { error_code: string; titulo: string }[]) {
    if (!vistos.has(f.error_code)) vistos.set(f.error_code, f.titulo);
  }
  if (vistos.size === 0) return "(todavía no se detectó ningún patrón — este sería el primero)";
  return [...vistos.entries()].map(([code, titulo]) => `- ${code}: ${titulo}`).join("\n");
}

/**
 * Evalúa una conversación contra la rúbrica.
 *
 * `max_tokens` es 8000 y no 2000. El techo cubre **pensamiento + texto**, y con el
 * pensamiento adaptativo encendido (el default del modelo) un veredicto que ahora incluye
 * diagnóstico y corrección redactada se pasaba de largo: el JSON salía cortado, `JSON.parse`
 * lanzaba, el `catch` de arriba lo convertía en "sin veredicto" y nadie se enteraba. Por eso
 * también se chequea `stop_reason` explícitamente en vez de dejar que reviente el parser.
 */
/**
 * La API key de Anthropic de la empresa activa, o `null` si no hay ninguna disponible.
 *
 * ── Por qué esto importa más que el modelo (2026-08-07) ───────────────
 *
 * El modelo y el esfuerzo ya salían de la empresa; la key no. `new Anthropic()` sin argumentos
 * lee `process.env.ANTHROPIC_API_KEY`, así que **todas las auditorías se le facturaban a ARIA**
 * — las de sus clientes también. No es una fuga de datos: es una fuga de plata, y del tipo que
 * no se nota hasta la factura.
 *
 * El fallback global se mantiene porque `resolverCredenciales` ya lo restringe a la empresa
 * principal (§5.2): una empresa cliente sin key propia devuelve `null` y no audita, que es lo
 * correcto — auditar con la cuenta de otro es peor que no auditar.
 */
function keyDeLaEmpresa(): string | null {
  const cred = credencialesActivas();
  if (cred) return cred.anthropicKey ?? null;
  return process.env.ANTHROPIC_API_KEY ?? null;
}

export async function evaluarConversacion(opts: {
  transcript: string;
  hechos: string;
  territorio: Territorio;
  prompt: PromptAgente;
  patrones: string;
}): Promise<ResultadoEvaluacion> {
  if (!opts.transcript.trim()) return { ok: false, motivo: "transcript vacío" };

  const apiKey = keyDeLaEmpresa();
  if (!apiKey) {
    const cred = credencialesActivas();
    return {
      ok: false,
      motivo: cred
        ? `la empresa "${cred.nombre}" no tiene cargada su API key de Anthropic`
        : "sin ANTHROPIC_API_KEY",
    };
  }

  const sinPrompt =
    "No tenés acceso al prompt del agente auditado. Poné fragmento_prompt en null y escribí " +
    'la corrección como una instrucción autónoma para agregar (correccion_tipo="agregado").';

  /**
   * Las de la empresa activa, con el default global de `credenciales.ts`. Fuera de un request
   * con contexto —un cron que todavía no activó organización— cae al default, que es el
   * comportamiento correcto: mejor auditar con el modelo por defecto que no auditar.
   */
  const modelo = modeloDeLaEmpresa();
  const esfuerzo = credencialesActivas()?.anthropicThinking ?? env.auditorEsfuerzo();

  // La key va EXPLÍCITA: sin el argumento el SDK lee `process.env.ANTHROPIC_API_KEY` y la
  // empresa activa deja de importar.
  const cliente = new Anthropic({ apiKey });
  const respuesta = await cliente.messages.create({
    /**
     * §5.3 · El modelo y el esfuerzo salen de la EMPRESA activa, con default global.
     *
     * El default pasó de `claude-opus-5` a `claude-sonnet-5` con esfuerzo `high`, y vive en
     * `credenciales.ts` — un solo lugar. Cada empresa lo pisa con `anthropic_modelo` /
     * `anthropic_thinking` sin desplegar, así que revertir es cambiar un campo.
     */
    model: modelo,
    max_tokens: 8000,
    system: [
      { type: "text" as const, text: TERRITORIOS[opts.territorio].contexto },
      {
        type: "text" as const,
        text: opts.prompt.presente
          ? `<prompt_del_agente version="${opts.prompt.hash}" archivo="${opts.prompt.ruta}">\n${opts.prompt.texto}\n</prompt_del_agente>`
          : sinPrompt,
      },
      { type: "text" as const, text: RUBRICA },
      {
        type: "text" as const,
        text: `<patrones_conocidos>\n${opts.patrones}\n</patrones_conocidos>`,
        // El system es idéntico entre análisis del mismo agente. Con el prompt adentro son
        // varios miles de tokens: cachearlo cuesta una línea y el día que suba el volumen
        // se paga solo.
        cache_control: { type: "ephemeral" as const },
      },
    ],
    output_config: {
      effort: esfuerzo,
      format: { type: "json_schema", schema: ESQUEMA_VEREDICTO },
    },
    messages: [{ role: "user", content: `${opts.hechos}\n\nConversación a auditar:\n\n${opts.transcript}` }],
  } as Anthropic.MessageCreateParamsNonStreaming);

  // Las clasificadoras pueden declinar. No es un fallo del agente de ventas: no se marca nada.
  if (respuesta.stop_reason === "refusal") return { ok: false, motivo: "el modelo declinó responder" };
  if (respuesta.stop_reason === "max_tokens") {
    return { ok: false, motivo: "el veredicto salió truncado (max_tokens) — subir el techo" };
  }

  const texto = respuesta.content.find((b): b is Anthropic.TextBlock => b.type === "text")?.text;
  if (!texto) return { ok: false, motivo: "el modelo no devolvió texto" };

  let crudo: any;
  try {
    crudo = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: "el veredicto no era JSON válido" };
  }

  const sentimientos: Sentimiento[] = ["positivo", "neutral", "molesto"];
  const auditable = Boolean(crudo.auditable);

  const hallazgos: Hallazgo[] = auditable
    ? ((crudo.hallazgos ?? []) as any[])
        .map((h) => ({
          errorCode: normalizarErrorCode(String(h.error_code ?? "")),
          titulo: String(h.titulo ?? "").slice(0, 120),
          categoria: h.categoria as CategoriaHallazgo,
          severidad: (h.severidad === "rojo" ? "rojo" : "amarillo") as Severidad,
          criterio: String(h.criterio ?? "ninguno"),
          diagnostico: String(h.diagnostico ?? ""),
          fragmentoPrompt: typeof h.fragmento_prompt === "string" ? h.fragmento_prompt : null,
          promptSeccion: typeof h.prompt_seccion === "string" ? h.prompt_seccion : null,
          correccionTipo: (h.correccion_tipo === "reemplazo" ? "reemplazo" : "agregado") as Hallazgo["correccionTipo"],
          correccion: String(h.correccion ?? ""),
          evidenciaUsuario: String(h.evidencia_usuario ?? ""),
          evidenciaIa: String(h.evidencia_ia ?? ""),
        }))
        // Un error_code que no sobrevive la normalización violaría el CHECK de Postgres y
        // tumbaría el INSERT entero. Se descarta el hallazgo, no el análisis.
        .filter((h) => /^[a-z0-9_]{3,48}$/.test(h.errorCode) && h.titulo)
        .slice(0, MAX_HALLAZGOS)
    : [];

  return {
    ok: true,
    veredicto: {
      auditable,
      motivoNoAuditable: String(crudo.motivo_no_auditable ?? ""),
      // Una conversación no auditable no puede pedir intervención: no se juzgó nada.
      requiereIntervencion: auditable && Boolean(crudo.requiere_intervencion),
      motivoIntervencion: String(crudo.motivo_intervencion ?? ""),
      criterioPrincipal: CRITERIOS.includes(crudo.criterio_principal) ? crudo.criterio_principal : "ninguno",
      sentimiento: sentimientos.includes(crudo.sentimiento) ? crudo.sentimiento : "neutral",
      hallazgos,
    },
  };
}

/* ================================================================== */
/* Persistencia                                                        */
/* ================================================================== */

/** Persiste el veredicto. Devuelve el id del análisis, o null si no se pudo guardar. */
async function guardarAnalisis(e: {
  agenteId: AgenteTextoId;
  ghlContactId: string;
  conversationId: string | null;
  veredicto: Veredicto;
  iaEnCache: number;
  promptHash: string;
  disparo: "webhook" | "manual" | "linea_base";
}): Promise<string | null> {
  try {
    const { data, error } = await db()
      .from("closer_analisis_agente")
      .insert({
        agente_id: e.agenteId,
        ghl_contact_id: e.ghlContactId,
        conversation_id: e.conversationId,
        // `fallo` es lo que enciende la cola roja, así que espeja la INTERVENCIÓN, no los
        // hallazgos. Un hallazgo rojo no le apaga el bot a nadie.
        fallo: e.veredicto.requiereIntervencion,
        criterio: e.veredicto.criterioPrincipal,
        motivo: e.veredicto.motivoIntervencion || null,
        sentimiento: e.veredicto.sentimiento,
        // Se guarda el modelo REAL con el que se juzgó: si mañana cambia, los análisis
        // viejos siguen diciendo con qué se produjeron.
        modelo: modeloDeLaEmpresa(),
        ia_cache_al_analizar: e.iaEnCache,
        prompt_hash: e.promptHash,
        auditable: e.veredicto.auditable,
        disparo: e.disparo,
      })
      .select("id")
      .single();

    if (error) {
      console.warn("[analizador] no se pudo guardar el análisis:", error.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.warn("[analizador] no se pudo guardar el análisis:", (err as Error).message);
    return null;
  }
}

async function guardarHallazgos(
  analisisId: string,
  agenteId: AgenteTextoId,
  ghlContactId: string,
  hallazgos: Hallazgo[],
  promptHash: string,
  cuando: string,
): Promise<number> {
  if (hallazgos.length === 0) return 0;
  const { data, error } = await db()
    .from("closer_hallazgo_agente")
    .insert(
      hallazgos.map((h) => ({
        analisis_id: analisisId,
        agente_id: agenteId,
        ghl_contact_id: ghlContactId,
        error_code: h.errorCode,
        titulo: h.titulo,
        categoria: h.categoria,
        severidad: h.severidad,
        criterio: h.criterio,
        diagnostico: h.diagnostico || null,
        fragmento_prompt: h.fragmentoPrompt,
        prompt_seccion: h.promptSeccion,
        correccion_tipo: h.correccionTipo,
        correccion: h.correccion || null,
        prompt_hash: promptHash,
        evidencia_usuario: h.evidenciaUsuario || null,
        evidencia_ia: h.evidenciaIa || null,
        evidencia_el: cuando,
      })),
    )
    .select("id");

  if (error) {
    console.warn("[analizador] no se pudieron guardar los hallazgos:", error.message);
    return 0;
  }
  return data?.length ?? 0;
}

/* ================================================================== */
/* El debounce                                                         */
/* ================================================================== */

export interface DecisionAuditor {
  correr: boolean;
  motivo: string;
  iaAhora: number;
  lineaBase: number;
  delta: number;
  /** `true` = conversación vieja sin actividad: se siembra la línea base sin llamar al modelo. */
  soloSembrar: boolean;
}

/**
 * ¿Toca analizar? La regla de Fabio: esperar a que la IA mande 5 mensajes y recién ahí
 * auditar la conversación completa con contexto.
 *
 * **No hay contador. Se resta.**
 *
 *   delta = (mensajes con autor='agente_ia' AHORA) − (ese conteo guardado al analizar)
 *
 * Una columna incremental en `closer_contactos` sería más directa y peor: la 013 acaba de
 * declarar muertas tres columnas denormalizadas de esa misma tabla justamente porque se
 * desactualizaban, y un contador se desincroniza con un backfill o con el borrado de
 * gemelos de `ingesta.ts`. La resta se auto-cura: las dos puntas salen de la misma fuente,
 * así que si aparecen o desaparecen mensajes se mueven juntas.
 *
 * Tampoco se cuenta contra GHL: serían 2 llamadas por evento incluso cuando la respuesta es
 * "no analizar", y el presupuesto de GHL es más escaso que los centavos del modelo (§51.4).
 *
 * **El agujero, dicho en voz alta:** una conversación donde la IA manda 4 mensajes y el
 * contacto se va enojado nunca se audita. Es consecuencia matemática de la regla, no un bug
 * tapable. La salida es `POST /api/closer/analizar {forzar:true}`, que ignora el debounce.
 */
export async function decidirAnalisis(ghlContactId: string): Promise<DecisionAuditor> {
  const umbral = env.auditorUmbralIa();

  const { count } = await db()
    .from("closer_mensajes")
    .select("id", { count: "exact", head: true })
    .eq("ghl_contact_id", ghlContactId)
    .eq("autor", "agente_ia");
  const iaAhora = count ?? 0;

  const { data: ultimo } = await db()
    .from("closer_analisis_agente")
    .select("ia_cache_al_analizar")
    .eq("ghl_contact_id", ghlContactId)
    .order("analizado_el", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lineaBase = Number(ultimo?.ia_cache_al_analizar ?? 0);
  const delta = iaAhora - lineaBase;

  if (delta < umbral) {
    return {
      correr: false,
      motivo: `debounce: faltan ${umbral - delta} mensajes de la IA (${delta}/${umbral})`,
      iaAhora,
      lineaBase,
      delta,
      soloSembrar: false,
    };
  }

  /**
   * Arranque en frío. Un contacto que ya tenía 30 mensajes cuando se activó esto supera el
   * umbral de una: si la conversación está viva, es lo que se quiere (un veredicto sobre lo
   * que está pasando). Si lleva semanas muerta, no — se siembra la línea base sin gastar.
   * Con 7 contactos da igual; el guard existe para el día del backfill de 2.000.
   */
  if (lineaBase === 0 && delta > umbral) {
    const { data: contacto } = await db()
      .from("closer_contactos")
      .select("last_message_ghl_at")
      .eq("ghl_contact_id", ghlContactId)
      .maybeSingle();

    const ultimoMs = contacto?.last_message_ghl_at ? Date.parse(contacto.last_message_ghl_at as string) : 0;
    const diasSinActividad = ultimoMs ? (Date.now() - ultimoMs) / 86_400_000 : Infinity;
    if (diasSinActividad > env.auditorDiasArranque()) {
      return {
        correr: false,
        motivo: `conversación sin actividad hace ${Math.round(diasSinActividad)} días: se siembra la línea base`,
        iaAhora,
        lineaBase,
        delta,
        soloSembrar: true,
      };
    }
  }

  return { correr: true, motivo: "", iaAhora, lineaBase, delta, soloSembrar: false };
}

/* ================================================================== */
/* El flujo completo                                                   */
/* ================================================================== */

export interface ResultadoAnalisis {
  analizado: boolean;
  /** Por qué no se analizó, cuando `analizado` es false. */
  motivo?: string;
  territorio?: Territorio;
  auditable?: boolean;
  /** `true` = se pidió intervención humana. Es lo que enciende la cola roja. */
  fallo?: boolean;
  criterio?: string;
  sentimiento?: Sentimiento;
  hallazgos?: number;
  /** Si la fila de estadística llegó a la base. Falso no invalida el análisis. */
  guardado?: boolean;
  /** Si el tag llegó de verdad a GHL (false en modo stub). */
  tagAplicado?: boolean;
  /** Solo en `dryRun`: el veredicto completo, sin haber escrito nada. */
  veredicto?: Veredicto;
  debounce?: { iaAhora: number; lineaBase: number; delta: number };
}

export interface OpcionesAnalisis {
  /** Ignora el debounce. Para el disparo manual. */
  forzar?: boolean;
  /** Evalúa y devuelve el veredicto SIN escribir nada: ni tag, ni nota, ni filas. */
  dryRun?: boolean;
  disparo?: "webhook" | "manual";
}

/**
 * Analiza la conversación de un contacto y, si hace falta, la manda a la cola roja.
 *
 * Devuelve siempre — nunca lanza. Lo llama el webhook, que debe responder 200 aunque el
 * análisis no se pueda hacer: un error acá no puede provocar que GHL reintente el evento ni
 * que desactive el workflow.
 */
export async function analizarYMarcar(
  ghlContactId: string,
  opts: OpcionesAnalisis = {},
): Promise<ResultadoAnalisis> {
  const disparo = opts.disparo ?? "webhook";
  try {
    if (!keyDeLaEmpresa()) {
      const cred = credencialesActivas();
      return {
        analizado: false,
        motivo: cred
          ? `la empresa "${cred.nombre}" no tiene cargada su API key de Anthropic`
          : "sin ANTHROPIC_API_KEY",
      };
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
    if (!AUDITORES_ACTIVOS.includes(TERRITORIOS[territorio].agenteId)) {
      // Auditar pre-agenda con la rúbrica de post-agenda daría veredictos malos sobre un
      // trabajo distinto, y encima gastando. El auditor del setter será su propio agente.
      return { analizado: false, motivo: "el auditor de chat del setter todavía no existe", territorio };
    }

    /**
     * ── Portón 2: el bot tiene que estar atendiendo ────────────────────
     *
     * `dryRun` lo saltea, y es deliberado: no escribe ni un tag, ni una nota, ni una fila —
     * lo único que produce es el veredicto de vuelta. Sin esta salida la rúbrica sería
     * imposible de probar contra conversaciones reales mientras los workflows de Francisco
     * sigan en borrador, porque este portón bloquea al 100% de los contactos (§54.1).
     *
     * Lo que `dryRun` NO saltea es el portón 5: que haya de verdad un mensaje del agente en
     * la conversación. Ese es el chequeo factual, y saltearlo sería volver a evaluar una IA
     * que no habló — el bug original.
     */
    if (!botAtendiendo(tags) && !opts.dryRun && !env.auditorSinPortonTags()) {
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

    /* ── Portón 4: el debounce ────────────────────────────────────────── */
    const decision = await decidirAnalisis(ghlContactId);
    const debounce = { iaAhora: decision.iaAhora, lineaBase: decision.lineaBase, delta: decision.delta };

    if (!decision.correr && !opts.forzar) {
      if (decision.soloSembrar && !opts.dryRun) {
        await guardarAnalisis({
          agenteId: TERRITORIOS[territorio].agenteId,
          ghlContactId,
          conversationId: null,
          veredicto: {
            auditable: false,
            motivoNoAuditable: "conversacion_muy_corta",
            requiereIntervencion: false,
            motivoIntervencion: "",
            criterioPrincipal: "ninguno",
            sentimiento: "neutral",
            hallazgos: [],
          },
          iaEnCache: decision.iaAhora,
          promptHash: "linea_base",
          disparo: "linea_base",
        });
      }
      return { analizado: false, motivo: decision.motivo, territorio, debounce };
    }

    /**
     * El candado, ANTES de gastar. Los webhooks de entrante y saliente llegan casi juntos
     * todo el tiempo y los dos verían el mismo delta. No se libera al terminar: si el
     * análisis explota, la resta sigue por encima del umbral y el próximo mensaje reintenta.
     */
    if (!opts.dryRun) {
      /**
       * `p_org_id` no estaba, y sin él Postgres resolvía a la sobrecarga vieja de la `014`,
       * cuyo UPDATE filtra solo por `ghl_contact_id`. La `020` agregó la versión por empresa
       * para que el candado falle CERRADO: dos empresas que tuvieran el mismo contacto en GHL
       * compartían una sola ranura y una de las dos se quedaba sin auditar en silencio.
       */
      const { data: gano } = await db().rpc("closer_auditor_claim", {
        p_org_id: orgActiva(),
        p_contact_id: ghlContactId,
        p_ventana_segundos: env.auditorClaimSegundos(),
      });
      if (gano === false) {
        return { analizado: false, motivo: "otro análisis de este contacto está corriendo", territorio, debounce };
      }
    }

    const conversationId = await conversacionDeContacto(ghlContactId);
    if (!conversationId) return { analizado: false, motivo: "sin conversación", territorio, debounce };

    const { mensajes, truncado } = await mensajesDeConversacionPaginado(conversationId, {
      limite: 100,
      paginas: PAGINAS_GHL,
    });
    const clasificados = clasificarMensajes(mensajes);

    /* ── Portón 5: los hechos, no los tags ────────────────────────────── */
    if (!clasificados.some((m) => m.autor === "agente_ia")) {
      return {
        analizado: false,
        motivo: "la conversación no tiene ningún mensaje del agente: no hay nada que auditar",
        territorio,
        debounce,
      };
    }

    const agenteId = TERRITORIOS[territorio].agenteId;
    const prompt = cargarPromptAgente(agenteId);

    const evaluacion = await evaluarConversacion({
      transcript: armarTranscript(clasificados, truncado),
      hechos: hechosMedidos(clasificados),
      territorio,
      prompt,
      patrones: await patronesConocidos(agenteId),
    });

    if (!evaluacion.ok) {
      return { analizado: false, motivo: evaluacion.motivo, territorio, debounce };
    }
    const veredicto = evaluacion.veredicto;

    if (opts.dryRun) {
      return {
        analizado: true,
        territorio,
        auditable: veredicto.auditable,
        fallo: veredicto.requiereIntervencion,
        criterio: veredicto.criterioPrincipal,
        sentimiento: veredicto.sentimiento,
        hallazgos: veredicto.hallazgos.length,
        veredicto,
        debounce,
      };
    }

    /**
     * Se guarda SIEMPRE, pida intervención o no. El panel de sentimiento de Auditoría de
     * Agentes se calcula sobre todos los análisis: el "85% positivos" sale justamente de
     * las conversaciones que NO fallaron. Guardar solo los fallos dejaría ese panel midiendo
     * únicamente lo que salió mal.
     */
    const analisisId = await guardarAnalisis({
      agenteId,
      ghlContactId,
      conversationId,
      veredicto,
      iaEnCache: decision.iaAhora,
      promptHash: prompt.hash,
      disparo,
    });

    if (analisisId && veredicto.hallazgos.length > 0) {
      await guardarHallazgos(
        analisisId,
        agenteId,
        ghlContactId,
        veredicto.hallazgos,
        prompt.hash,
        new Date().toISOString(),
      );
    }

    const base: ResultadoAnalisis = {
      analizado: true,
      territorio,
      auditable: veredicto.auditable,
      criterio: veredicto.criterioPrincipal,
      sentimiento: veredicto.sentimiento,
      hallazgos: veredicto.hallazgos.length,
      guardado: Boolean(analisisId),
      debounce,
    };

    if (!veredicto.requiereIntervencion) return { ...base, fallo: false };

    /**
     * La nota va PRIMERO. Es el tag el que dispara el workflow y hace aparecer al contacto
     * en la cola; si se aplicara antes, existiría una ventana en la que el closer ve la
     * urgencia sin el motivo y lee el texto genérico.
     */
    const idempotencyKey = `analisis:${ghlContactId}:${conversationId}`;
    await ghl().escribirNota({
      ghlContactId,
      cuerpo: `${PREFIJO_NOTA} ${veredicto.motivoIntervencion}`,
      idempotencyKey: `${idempotencyKey}:nota`,
    });

    const aplicacion = await ghl().aplicarTags({
      ghlContactId,
      tags: [TAG_FALLO],
      idempotencyKey: `${idempotencyKey}:tag`,
    });

    return {
      ...base,
      fallo: true,
      // Se reporta lo que REALMENTE pasó, no lo que se intentó (§ puerto: `aplicado`).
      tagAplicado: aplicacion.ok ? aplicacion.aplicado : false,
    };
  } catch (e) {
    return { analizado: false, motivo: (e as Error).message };
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
 * Pasada manual sobre los contactos de un territorio. La usa el endpoint de disparo manual;
 * el camino normal es el webhook.
 *
 * **Los candidatos se filtran ACÁ, antes de llamar a `analizarYMarcar`.** Esa función vuelve
 * a pedirle el contacto a GHL para decidir, así que sin este filtro un barrido sobre 200
 * contactos gastaría 200 llamadas a GHL para descartar a los 190 que no tienen bot. Como
 * `contactosConTag` ya devuelve los tags, la decisión es gratis.
 *
 * En serie y no en paralelo: `Promise.all` sobre cientos de contactos dispara cientos de
 * llamadas al modelo a la vez. Es un disparo manual — que tarde no molesta a nadie.
 */
export async function analizarTerritorio(
  territorio: Territorio,
  opts: OpcionesAnalisis = {},
): Promise<{
  territorio: Territorio;
  encontrados: number;
  revisados: number;
  omitidos: number;
  /** `true` = GHL devolvió el tope y puede haber más contactos sin revisar. */
  truncado: boolean;
  resultados: Array<{ contactId: string; nombre: string } & ResultadoAnalisis>;
}> {
  const { contactos, truncado } = await contactosConTag(TERRITORIOS[territorio].tag);
  const candidatos = contactos.filter((c) => botAtendiendo(c.tags) && !c.tags.includes(TAG_FALLO));

  const resultados: Array<{ contactId: string; nombre: string } & ResultadoAnalisis> = [];
  for (const c of candidatos) {
    resultados.push({
      contactId: c.id,
      nombre: c.nombre,
      ...(await analizarYMarcar(c.id, { ...opts, disparo: "manual" })),
    });
  }

  return {
    territorio,
    encontrados: contactos.length,
    revisados: candidatos.length,
    omitidos: contactos.length - candidatos.length,
    truncado,
    resultados,
  };
}
