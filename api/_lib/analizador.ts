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
 *    aplicarían (🟦 08.1 / 08.2) están en borrador. Decisión de Fabio: se espera a Fabio
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
import { formateador } from "../../src/lib/fechas.js";
import { autorDeMensajeGhl } from "./autoria.js";
import { env } from "./env.js";
import { ghl } from "./ghl/index.js";
import { cargarPromptAgente, type PromptAgente } from "./promptAgente.js";
import { credencialesActivas } from "./credenciales.js";
import { alarmasDe, type Alarma } from "./auditor/heuristicas.js";
import { AGENTES_VOZ, AUDITOR_VOZ_HABILITADO, auditorHabilitado, elRojoApagaElBot, type AgenteVozId, type NivelVeredicto } from "../../src/lib/auditores.js";
import { db, orgActiva } from "./repo.js";
import {
  contactosConTag,
  conversacionDeContacto,
  esMensajeDeChat,
  mensajesDeConversacionPaginado,
  textoDeMensaje,
  type MensajeGhl,
} from "./ghl/lectura.js";

/**
 * El modelo y el esfuerzo del auditor. **Constantes, para todas las empresas.**
 *
 * ── Por qué no son configurables (2026-08-07) ─────────────────────────
 *
 * Eran columnas de `closer_org_config` con fallback a variables de entorno, y la cadena entera
 * se eliminó a pedido de Fabio. El motivo sale de este mismo repo: `AUDITOR_SIN_PORTON_TAGS`
 * demostró que un comportamiento gobernado por una variable de entorno **se vuelve a encender
 * solo** en cualquier entorno donde la variable no esté — un preview, un clon local, un
 * proyecto nuevo. Un modelo elegido por config tiene el mismo problema al revés: una empresa
 * podía quedar auditando con un modelo distinto sin que nadie lo hubiera decidido.
 *
 * Cambiar el modelo pasa a ser un cambio de código, que aparece en un diff y alguien lo mira.
 */
export const MODELO_AUDITOR = "claude-sonnet-5";
export const ESFUERZO_AUDITOR = "high";

/** El tag que enciende la cola roja y apaga al agente de GHL. */
export const TAG_FALLO = "bot_pausado_fallo";

/** Prefijo de la nota, para poder releerla después sin confundirla con notas humanas. */
export const PREFIJO_NOTA = "[IA]";

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
 * Los ids que usa la pestaña Auditoría de Agentes. Son los de Fabio (`AgentInfo.id`) y
 * NO se tocan: cada territorio audita a un agente distinto y su resultado va a su tarjeta.
 *
 * Los agentes de VOZ ya no salen de acá (la premisa "no tienen fuente" murió con el webhook de
 * Assistable): su motor vive en `analizadorVoz.ts` y sus ids en `AGENTES_VOZ` (`src/lib/auditores`).
 * La persistencia acepta a los cuatro vía `AgenteAuditableId`.
 */
export type AgenteTextoId = "lead-flow-ai" | "appointment-flow-ai";

/**
 * Todo agente cuyo análisis puede persistirse. Es la unión texto + voz, y existe para que
 * `guardarAnalisis`/`guardarHallazgos`/`patronesConocidos`/`cargarPromptAgente` sirvan a los dos
 * motores sin duplicarse — el CHECK de la `038` es su espejo en Postgres.
 */
export type AgenteAuditableId = AgenteTextoId | AgenteVozId;

/**
 * Qué agentes tienen auditor CABLEADO hoy. Un solo lugar, para que los endpoints no diverjan.
 *
 * `lead-flow-ai` entró el 2026-08-08 con su propia rúbrica de pre-agenda (`CRITERIOS_SETTER`). No
 * es el auditor del closer con otro contexto: los criterios son otros porque la misión del agente
 * es otra — calificar y agendar, no confirmar y acompañar.
 *
 * Su rojo alimenta la cola de urgentes del **setter**, no la del closer: `miDiaSetter.ts` deriva
 * urgentes de `bot_pausado_fallo` + `zona_setter`, así que el ruteo sale solo del territorio del
 * contacto y no hizo falta una línea nueva.
 */
export const AUDITORES_ACTIVOS: readonly AgenteTextoId[] = ["appointment-flow-ai", "lead-flow-ai"];

/**
 * TODO agente con auditor cableado — texto y voz. Es lo que los endpoints devuelven como
 * `agentesConAuditor` y lo que enciende las tarjetas de la vitrina.
 *
 * Vive aparte de `AUDITORES_ACTIVOS` a propósito: esa lista es SOLO de texto (la itera el carril
 * amarillo, que audita conversaciones de chat, y la parsea un test de coherencia por regex), y
 * meterle ids de voz habría mandado al cron amarillo a buscar mensajes de un agente que no
 * escribe mensajes. La voz entra y sale de acá con su propio flag.
 */
export const AGENTES_CON_AUDITOR: readonly AgenteAuditableId[] = [
  ...AUDITORES_ACTIVOS,
  ...(AUDITOR_VOZ_HABILITADO ? AGENTES_VOZ : []),
];

/**
 * Qué hace el agente en cada etapa. Desde el 2026-08-08 **sí** cambia la rúbrica: cada territorio
 * tiene sus siete criterios (ver `RUBRICAS`). Antes eran los mismos para
 * ambos roles. Solo le dice al auditor cuál era el trabajo del agente, que es lo que permite
 * juzgar bien "prometió algo incorrecto": prometer una fecha significa algo distinto según
 * si el agente estaba agendando o acompañando una cita ya agendada.
 */
/**
 * Exportado para el carril amarillo (`auditor/amarilloDiario.ts`): los dos carriles auditan a los
 * mismos agentes con el mismo contexto, y duplicar estos textos garantizaría que un día digan
 * cosas distintas del mismo agente.
 */
export const TERRITORIOS: Record<Territorio, { tag: string; agenteId: AgenteTextoId; contexto: string }> = {
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
/**
 * ── La rúbrica es una FUNCIÓN del territorio (2026-08-08) ─────────────
 *
 * Era una constante con los siete criterios del closer adentro. El auditor del setter no puede
 * usarla: audita **pre-agenda**, donde la misión del agente es calificar y agendar — no confirmar
 * y acompañar. "Abandonó la conversación" significa otra cosa cuando el contacto todavía no
 * agendó, y "promesa incorrecta sobre el programa" no aplica a quien nunca habló del programa.
 *
 * Lo que se comparte es todo lo demás, y no es poco: el formato del transcript, la **regla de
 * atribución innegociable**, la precondición de auditabilidad, el bloque de corrección, el código
 * de patrón, los tres niveles y el sentimiento. Duplicar la rúbrica entera para cambiar una
 * sección habría garantizado que las dos divergieran en la regla de atribución, que es justo la
 * que no puede divergir.
 */
/**
 * Lo que cambia entre auditar un CHAT y auditar una LLAMADA. Todo lo demás de la rúbrica —
 * criterios, severidad, corrección, error_code, niveles, sentimiento— es idéntico a propósito:
 * "presión por agendar" es el mismo fallo dicho por WhatsApp o por teléfono, y partir los
 * patrones por canal solo repartiría los "×N casos" del técnico en dos mitades más chicas.
 */
export interface MedioRubrica {
  /** Qué atiende el agente auditado ("conversaciones de venta por WhatsApp" / "llamadas…"). */
  descripcion: string;
  /** La sección CÓMO LEER EL TRANSCRIPT: autores/roles y sus reglas de atribución. */
  comoLeer: string;
  /** Qué consecuencia tiene requiere_intervencion=true, para calibrar la vara. */
  consecuenciaIntervencion: string;
  /** La sección CUÁNDO NO SE AUDITA, con las condiciones propias del medio. */
  noAuditable: string;
}

const MEDIO_CHAT: MedioRubrica = {
  descripcion: "conversaciones de venta por WhatsApp",
  comoLeer: `Cada línea viene con fecha, hora y AUTOR REAL:

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
cuyo contenido no tenemos. No supongas qué decía.`,
  consecuenciaIntervencion: `Esto le corta el bot a una persona real y le suma una tarea urgente al closer. Se
     reserva para daño en curso.`,
  noAuditable: `  · No hay ninguna línea "AGENTE IA". Sin agente no hay nada que auditar, y bajo ninguna
    circunstancia eso es una falla del agente: es la ausencia de un agente.
  · Más de la mitad de los mensajes son [audio]/[imagen] sin texto.
  · Hay menos de dos intercambios reales (menos de 2 del contacto o menos de 2 del agente).`,
};

export function rubricaDe(criterios: string, medio: MedioRubrica = MEDIO_CHAT): string {
  return `Sos un auditor de calidad de agentes de IA que atienden ${medio.descripcion}. Tu trabajo tiene dos salidas distintas y no hay que mezclarlas:

  A. INTERVENCIÓN: ¿hay que apagar al agente y que un humano tome esta conversación AHORA?
     ${medio.consecuenciaIntervencion}
  B. HALLAZGOS: ¿qué le pasa al AGENTE que se pueda corregir en su prompt? Esto no
     interrumpe a nadie: alimenta la lista de trabajo del técnico.

Una conversación puede tener hallazgos sin necesitar intervención, y puede necesitar
intervención sin que el agente haya hecho nada mal.

──────────────────────────────────────────────────────────────────────
CÓMO LEER EL TRANSCRIPT
──────────────────────────────────────────────────────────────────────

${medio.comoLeer}

──────────────────────────────────────────────────────────────────────
PRECONDICIÓN — CUÁNDO NO SE AUDITA
──────────────────────────────────────────────────────────────────────

Antes de evaluar nada, verificá que la conversación se pueda auditar. Si NO se puede,
devolvé auditable=false con el motivo, hallazgos vacíos, requiere_intervencion=false, y nada
más. No fuerces un veredicto.

No es auditable cuando:
${medio.noAuditable}

──────────────────────────────────────────────────────────────────────
LOS CRITERIOS
──────────────────────────────────────────────────────────────────────

Cada criterio tiene una condición de DISPARO y una lista de DESCARTES. Si aplica cualquier
descarte, el criterio NO se cumple, por más que el disparo parezca darse. Y cada hallazgo
exige una CITA TEXTUAL del transcript: si no podés copiar la línea exacta que lo prueba, el
hallazgo no existe y no lo reportás.

${criterios}

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
EL NIVEL DEL VEREDICTO — verde, amarillo o rojo
──────────────────────────────────────────────────────────────────────

Todo análisis auditable termina en UNO de estos tres. No es opcional y no hay un cuarto.

  verde ...... el agente trabajó bien. Ningún criterio se cumplió.
  amarillo ... ningún fallo crítico, pero hay algo observable. Hallazgos de severidad
               amarilla, sin corrección de prompt.
  rojo ....... al menos un criterio se cumplió con la gravedad suficiente para pedir que un
               humano intervenga. Lleva "requiere_intervencion=true".

La coherencia es OBLIGATORIA y la verifica el código: rojo ⟺ "requiere_intervencion=true".
Un veredicto verde con hallazgos, o un rojo sin intervención, se rechaza.

EL VERDE NO ES "NO ENCONTRÉ NADA". Es una afirmación medida, y por eso hay que sostenerla:

  · "destacado": en una línea, QUÉ hizo bien el agente. Concreto, no elogio genérico.
    Sí: "reconoció la objeción de precio y la respondió con el desglose de pagos".
    No: "buena atención", "respondió correctamente", "todo bien".
  · "evidencia": la línea "AGENTE IA" EXACTA Y LITERAL que lo demuestra, copiada del
    transcript. Sin ella el destacado no se guarda.

Si la conversación salió limpia pero no podés señalar nada concreto que el agente haya hecho
BIEN, dejá "destacado" y "evidencia" vacíos. El nivel sigue siendo verde: no encontrar un
elogio no es lo mismo que encontrar una falla. Lo que NO se hace es inventar un mérito.

En amarillo, "destacado" dice qué se puede mejorar y "evidencia" la línea que lo muestra.
En rojo los dos van vacíos: para eso están el diagnóstico y la corrección de cada hallazgo.

──────────────────────────────────────────────────────────────────────
SENTIMIENTO DEL CONTACTO
──────────────────────────────────────────────────────────────────────

Del CONTACTO, no del agente, a lo largo de toda la conversación:
  positivo · receptivo, interesado, conforme
  neutral  · intercambio informativo, sin carga emocional
  molesto  · fastidio, impaciencia, queja o enojo

Es independiente del resto: una conversación puede fallar con un contacto que se mantuvo
amable, y otra puede tener un contacto molesto sin que el agente haya hecho nada mal.`;
}

/** Los siete criterios del CLOSER: post-agenda, confirmar y acompañar hasta la llamada. */
export const CRITERIOS_CLOSER = `1. FRUSTRACIÓN NO MANEJADA  (frustracion)
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
                humano.`;

/**
 * Los siete del SETTER: pre-agenda, calificar y conseguir la cita.
 *
 * No son los del closer con otro nombre. La misión del agente es distinta, así que lo que cuenta
 * como falla también: acá el daño caro es **agendar a quien no puede comprar** —le llena la agenda
 * al closer— y **prometer algo que el prompt no respalda**, porque esa promesa llega a la llamada
 * de venta como una expectativa que el closer tiene que romper.
 *
 * Tres no tienen equivalente en el closer (`calificacion_saltada`, `presiono_sin_calificar`,
 * `sin_derivacion`) y uno se comparte tal cual (`dato_faltante`), porque significa lo mismo en las
 * dos etapas.
 */
export const CRITERIOS_SETTER = `1. CALIFICACIÓN SALTADA  (calificacion_saltada)
   Disparo: el agente empujó a agendar SIN haber preguntado nada que permita calificar —
   facturación, etapa del negocio, capacidad de inversión. Agendar a ciegas le llena la agenda
   al closer de gente que no puede comprar, que es el costo más caro de este embudo.
   Descartes: · el contacto ya venía calificado desde el formulario y el transcript lo muestra;
              · el contacto pidió agendar por su cuenta antes de que el agente preguntara nada;
              · sí preguntó y el contacto esquivó — eso no es culpa del agente.

2. PRESIONÓ A QUIEN NO CALIFICA  (presiono_sin_calificar)
   Disparo: el contacto dijo con claridad que no tiene capital, no es el perfil o no es el
   momento, y el agente **siguió empujando la cita**.
   Descartes: · el agente reconoció el límite y ofreció una alternativa (low-ticket, nurture);
              · la objeción era ambigua o el contacto se contradijo después;
              · quien insistió fue un ASESOR HUMANO.

3. NO OFRECIÓ LA SALIDA QUE CORRESPONDÍA  (sin_derivacion)
   Disparo: el contacto no califica para high-ticket pero mostró interés real, y el agente
   cerró la conversación sin ofrecerle nada — ni low-ticket, ni quedar en contacto.
   Descartes: · el contacto dijo explícitamente que no quería nada más;
              · el prompt del agente no menciona ninguna alternativa que pudiera ofrecer;
              · la conversación sigue abierta: todavía puede ofrecerla.

4. INFORMACIÓN FALSA SOBRE EL SERVICIO  (info_falsa)
   Disparo: el agente afirmó algo sobre precio, duración, garantía o resultados que **contradice
   el prompt** o que el prompt no respalda. Es el criterio más grave de pre-agenda: una promesa
   inventada acá llega a la llamada de venta como una expectativa que el closer tiene que romper.
   Descartes: · el prompt sí lo respalda, aunque con otras palabras;
              · lo dijo el CONTACTO y el agente no lo confirmó;
              · fue una AUTOMATIZACIÓN o un ASESOR HUMANO.

5. ABANDONÓ A UN LEAD CALIFICADO  (abandono_calificado)
   Disparo: el contacto mostró que califica —dio números, mostró urgencia, preguntó cómo
   seguir— y la conversación se cortó sin que el agente propusiera un próximo paso.
   Descartes: · el agente propuso agendar y el contacto no respondió;
              · el último mensaje es del contacto y hace menos de 60 minutos: todavía no es
                abandono, es una conversación en curso;
              · un ASESOR HUMANO tomó la conversación después.

6. NO ENTENDIÓ LA OBJECIÓN  (objecion_no_entendida)
   Disparo: el contacto planteó una objeción concreta —precio, tiempo, desconfianza— y el
   agente respondió algo que no la toca, o la repitió con otras palabras.
   Descartes: · el agente la reconoció y respondió al fondo, aunque no la resolviera;
              · la objeción venía dentro de un mensaje largo y ambiguo;
              · el contacto la retiró él mismo en el mensaje siguiente.

7. LE FALTÓ UN DATO QUE DEBERÍA TENER  (dato_faltante)
   Disparo: el contacto preguntó algo que el prompt del agente SÍ contesta, y el agente dijo
   que no sabía o derivó sin necesidad.
   Descartes: · el dato no está en el prompt — eso es un hueco del prompt, no del agente;
              · la pregunta era sobre su caso particular y requiere un humano.`;

/** La rúbrica de cada territorio, compuesta una sola vez. */
const RUBRICAS: Record<Territorio, string> = {
  closer: rubricaDe(CRITERIOS_CLOSER),
  setter: rubricaDe(CRITERIOS_SETTER),
};

/**
 * Todos los criterios que un veredicto puede nombrar, de los dos territorios.
 *
 * Es una lista sola y no dos porque `closer_analisis_agente.criterio` es una columna sola: el
 * esquema del modelo la valida contra este enum y el CHECK de Postgres contra el mismo conjunto.
 * Que un criterio de setter aparezca en un análisis de closer es imposible por otra vía — la
 * rúbrica que se le manda al modelo solo describe los siete de su territorio.
 */
const CRITERIOS = [
  // ── Closer: post-agenda ──
  "frustracion",
  "dejo_de_responder",
  "promesa_incorrecta",
  "no_es_lo_que_busca",
  "insiste_no_entiende",
  "fuera_de_alcance",
  // ── Setter: pre-agenda ──
  "calificacion_saltada",
  "presiono_sin_calificar",
  "sin_derivacion",
  "info_falsa",
  "abandono_calificado",
  "objecion_no_entendida",
  // ── Compartido: significa lo mismo en las dos etapas ──
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
    nivel: { type: "string", enum: ["verde", "amarillo", "rojo"] },
    destacado: { type: "string" },
    evidencia: { type: "string" },
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
    "nivel",
    "destacado",
    "evidencia",
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
  /**
   * El nivel del veredicto, o `null` si **no se juzgó nada** — una conversación no auditable o
   * una siembra de línea base.
   *
   * `null` no es un cuarto nivel: es la ausencia de veredicto, y por eso la `031` lo permite. Que
   * un verde y un "no lo miré" sean distinguibles es toda la razón de este cambio; colapsarlos en
   * `verde` acá arruinaría el dato en el mismo commit que lo crea.
   *
   * `rojo` ⟺ `requiereIntervencion`, y la coherencia se fuerza al normalizar: el modelo puede
   * equivocarse y el CHECK de la `031` no perdona.
   */
  nivel: NivelVeredicto | null;
  /** Qué estuvo bien (verde) o qué mejorar (amarillo). Vacío si no se pudo señalar nada. */
  destacado: string;
  /** La línea del transcript que sostiene el `destacado`. Sin ella el destacado no se guarda. */
  evidencia: string;
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

/**
 * El sello va en la zona de la EMPRESA, no en la de Lima.
 *
 * Era un `const` a nivel de modulo, y ahi estaba el problema: el modulo se carga una vez por
 * instancia y esa instancia audita conversaciones de varias empresas, asi que la zona de la
 * primera quedaba congelada para todas. Estos sellos los lee el modelo para comparar horas entre
 * lineas: una empresa en otra zona recibia la conversacion con los horarios corridos y el
 * veredicto se calculaba sobre eso. `formateador()` memoiza por zona, asi que se resuelve por
 * llamada sin volver a construir el objeto.
 */
const partesFechaHora = () =>
  formateador("es-PE", {
    timeZone: env.zonaHoraria(),
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
  const p = Object.fromEntries(partesFechaHora().formatToParts(d).map((x) => [x.type, x.value]));
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
export async function patronesConocidos(agenteId: AgenteAuditableId): Promise<string> {
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
  /**
   * El motor de VOZ pasa su propio contexto y su propia rúbrica (mismo molde, otro medio) y
   * reusa todo lo demás: la llamada al modelo, el parseo, la normalización y la derivación del
   * nivel. Sin esto, `analizadorVoz.ts` habría duplicado las 150 líneas más delicadas del módulo.
   */
  encuadre?: { contexto: string; rubrica: string };
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
  const modelo = MODELO_AUDITOR;
  const esfuerzo = ESFUERZO_AUDITOR;

  // La key va EXPLÍCITA: sin el argumento el SDK lee `process.env.ANTHROPIC_API_KEY` y la
  // empresa activa deja de importar.
  const cliente = new Anthropic({ apiKey });
  const respuesta = await cliente.messages.create({
    /**
     * `claude-sonnet-5` con esfuerzo `high`, igual para los dos carriles y para todas las
     * empresas. Ver el comentario de `MODELO` arriba: dejó de ser configurable a propósito.
     */
    model: modelo,
    max_tokens: 8000,
    system: [
      { type: "text" as const, text: opts.encuadre?.contexto ?? TERRITORIOS[opts.territorio].contexto },
      {
        type: "text" as const,
        text: opts.prompt.presente
          ? `<prompt_del_agente version="${opts.prompt.hash}" archivo="${opts.prompt.ruta}">\n${opts.prompt.texto}\n</prompt_del_agente>`
          : sinPrompt,
      },
      {
        type: "text" as const,
        text: opts.encuadre?.rubrica ?? RUBRICAS[opts.territorio],
        /**
         * ── El breakpoint va ACÁ, no al final (2026-08-07) ─────────────
         *
         * `cache_control` cachea **todo el prefijo hasta ese bloque inclusive** (verificado contra
         * la documentación vigente, no de memoria). Estaba en `<patrones_conocidos>`, que es el
         * último — o sea que el prefijo cacheado incluía los patrones, y **los patrones cambian
         * solos**: salen de `closer_hallazgo_agente`, así que cada hallazgo nuevo invalidaba el
         * caché entero de esa empresa. Se pagaba el 1,25x de escritura una y otra vez sin llegar
         * a cobrar una sola lectura.
         *
         * Movido a la rúbrica, el prefijo estable es contexto + prompt del agente + rúbrica, que
         * es exactamente lo que el spec describe como "grande y no cambia entre análisis de la
         * misma empresa". Los patrones quedan afuera y ya no invalidan nada.
         *
         * `ttl: "1h"` y no el default de 5 minutos: con el debounce de 5 mensajes, dos análisis
         * de la misma empresa separados por menos de 5 minutos son la excepción, así que el
         * default casi nunca llegaba a cobrarse. La escritura sube de 1,25x a 2x y la lectura
         * sigue en 0,1x — se paga sola con una sola lectura por hora.
         */
        cache_control: { type: "ephemeral" as const, ttl: "1h" as const },
      },
      {
        type: "text" as const,
        text: `<patrones_conocidos>
${opts.patrones}
</patrones_conocidos>`,
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

  // Una conversación no auditable no puede pedir intervención: no se juzgó nada.
  const requiereIntervencion = auditable && Boolean(crudo.requiere_intervencion);

  /**
   * ── El nivel se DERIVA, no se cree ────────────────────────────────────
   *
   * El modelo devuelve `nivel`, pero acá manda `requiereIntervencion`, y no es desconfianza
   * gratuita: la `031` tiene un CHECK `(nivel = 'rojo') = fallo`, así que un modelo que devuelva
   * "amarillo" junto a `requiere_intervencion=true` **tumbaría el INSERT entero** y el análisis se
   * perdería. Forzar la coherencia acá convierte un error del modelo en una fila correcta.
   *
   * Con intervención es rojo, sin discusión. Sin intervención, la frontera verde/amarillo la
   * decide si hay hallazgos: un veredicto que reportó algo observable no es verde por más que el
   * modelo lo haya etiquetado así.
   */
  // La escalera vive en `derivarNivel` (única derivación, regla 3) — acá era una copia inline
  // que hoy coincidía y mañana no.
  const nivel = derivarNivel({
    auditable,
    requiereIntervencion,
    hallazgos: hallazgos.length,
    nivelDelModelo: crudo.nivel,
  });

  /**
   * `destacado` y `evidencia` viajan juntos o no viajan. Un mérito afirmado sin la línea que lo
   * prueba es la misma clase de dato que un hallazgo sin cita textual — y en el verde es peor,
   * porque nadie audita un elogio. En rojo se descartan los dos: ahí hablan los hallazgos.
   */
  const destacadoCrudo = String(crudo.destacado ?? "").trim();
  const evidenciaCruda = String(crudo.evidencia ?? "").trim();
  const conRespaldo = nivel !== "rojo" && destacadoCrudo !== "" && evidenciaCruda !== "";

  return {
    ok: true,
    veredicto: {
      auditable,
      motivoNoAuditable: String(crudo.motivo_no_auditable ?? ""),
      nivel,
      destacado: conRespaldo ? destacadoCrudo.slice(0, 240) : "",
      evidencia: conRespaldo ? evidenciaCruda.slice(0, 400) : "",
      requiereIntervencion,
      motivoIntervencion: String(crudo.motivo_intervencion ?? ""),
      criterioPrincipal: CRITERIOS.includes(crudo.criterio_principal) ? crudo.criterio_principal : "ninguno",
      sentimiento: sentimientos.includes(crudo.sentimiento) ? crudo.sentimiento : "neutral",
      hallazgos,
    },
  };
}

/**
 * El nivel del veredicto, derivado de los hechos y **no** de lo que dijo el modelo.
 *
 * ── Por qué no se le cree al modelo ───────────────────────────────────
 *
 * No es desconfianza gratuita. La `031` tiene un CHECK `(nivel = 'rojo') = fallo`, así que un
 * modelo que devuelva `"amarillo"` junto a `requiere_intervencion: true` **tumbaría el INSERT
 * entero** y el análisis se perdería — el peor final posible, porque la inferencia ya se gastó.
 * Derivar acá convierte un error del modelo en una fila correcta.
 *
 * Las reglas, en orden:
 *
 *   1. Sin auditar no hay nivel. `null`, que no es un cuarto nivel sino la ausencia de veredicto.
 *   2. Con intervención es rojo, sin discusión. Es la definición de rojo.
 *   3. Con hallazgos es amarillo aunque el modelo diga verde: reportar algo observable y llamarlo
 *      verde es contradecirse, y gana lo que reportó.
 *   4. Sin hallazgos, el modelo puede pedir amarillo (vio algo que no llegó a hallazgo). Cualquier
 *      otra cosa —incluido un valor que no reconocemos— cae en verde, que es lo que los hechos
 *      dicen: se auditó, no se encontró nada, nadie pidió intervenir.
 *
 * Exportada para poder probarla: es una tabla de verdad cuyo error no se ve hasta que Postgres
 * rechaza una escritura en producción.
 */
export function derivarNivel(e: {
  auditable: boolean;
  requiereIntervencion: boolean;
  hallazgos: number;
  nivelDelModelo?: unknown;
}): NivelVeredicto | null {
  if (!e.auditable) return null;
  if (e.requiereIntervencion) return "rojo";
  if (e.hallazgos > 0) return "amarillo";
  return e.nivelDelModelo === "amarillo" ? "amarillo" : "verde";
}

/* ================================================================== */
/* Persistencia                                                        */
/* ================================================================== */

/** Persiste el veredicto. Devuelve el id del análisis, o null si no se pudo guardar. */
export async function guardarAnalisis(e: {
  agenteId: AgenteAuditableId;
  ghlContactId: string;
  conversationId: string | null;
  veredicto: Veredicto;
  iaEnCache: number;
  promptHash: string;
  // `llamada` es el disparo del motor de voz (la columna no tiene CHECK; las vistas de 30 días
  // solo excluyen `linea_base`, así que la voz entra a las métricas sola).
  disparo: "webhook" | "manual" | "linea_base" | "llamada";
  /** Las señales del nivel 0 que lo adelantaron, si lo adelantaron. */
  alarmas?: Alarma[];
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
        /**
         * El nivel, y con él el verde. La `031` tiene un CHECK `(nivel = 'rojo') = fallo`, así que
         * estas dos líneas no pueden contradecirse ni por error de tipeo: Postgres rechaza la fila.
         *
         * `fallo` no se fue: lo leen la cola de Urgentes, `setter/urgentes.ts` y el panel de
         * sentimiento. Pasa a ser la **proyección booleana** de `nivel`, no un dato paralelo.
         */
        nivel: e.veredicto.nivel,
        // Van juntos o no van. Ver `evaluarConversacion`: un mérito sin la línea que lo prueba no
        // se guarda, porque nadie audita un elogio.
        destacado: e.veredicto.destacado || null,
        evidencia: e.veredicto.evidencia || null,
        criterio: e.veredicto.criterioPrincipal,
        motivo: e.veredicto.motivoIntervencion || null,
        sentimiento: e.veredicto.sentimiento,
        // Se guarda el modelo REAL con el que se juzgó: si mañana cambia, los análisis
        // viejos siguen diciendo con qué se produjeron.
        modelo: MODELO_AUDITOR,
        ia_cache_al_analizar: e.iaEnCache,
        prompt_hash: e.promptHash,
        auditable: e.veredicto.auditable,
        disparo: e.disparo,
        /**
         * `null` y `[]` no significan lo mismo, así que no se escribe `[]`: `null` = salió por el
         * debounce normal y nadie miró alarmas. Es la regla 2 de CLAUDE.md aplicada a una columna.
         */
        alarmas: e.alarmas?.length ? e.alarmas.map((a) => a.senal) : null,
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

export async function guardarHallazgos(
  analisisId: string,
  agenteId: AgenteAuditableId,
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

/**
 * Las alarmas del nivel 0, calculadas sobre `closer_mensajes`.
 *
 * De nuestra caché y NO de GHL, y esa es la diferencia entre "gratis" y "carísimo": el transcript
 * que se le manda al modelo sí sale de GHL, pero eso ocurre después, cuando ya se decidió gastar.
 * Acá solo hay que decidir si vale la pena mirar.
 *
 * Se traen los últimos 40 mensajes: alcanza para las cinco señales —las tres de léxico miran los
 * 3 más recientes del contacto, y las de repetición no necesitan la conversación entera— y acota
 * el costo de la consulta en un contacto con historia larga.
 */
async function alarmasDelCache(ghlContactId: string): Promise<Alarma[]> {
  const { data } = await db()
    .from("closer_mensajes")
    .select("autor, direccion, body, timestamp_ghl")
    .eq("ghl_contact_id", ghlContactId)
    .order("timestamp_ghl", { ascending: false })
    .limit(40);

  if (!data || data.length === 0) return [];

  // La consulta viene descendente para que el `limit` agarre los ÚLTIMOS; las heurísticas
  // necesitan orden cronológico.
  const mensajes: MensajeClasificado[] = (data as unknown as FilaMensajeCache[]).reverse().map((m) => ({
    autor: autorDeFila(m),
    texto: m.body ?? "",
    cuando: m.timestamp_ghl ? new Date(m.timestamp_ghl).getTime() : 0,
    sinTexto: !m.body?.trim(),
  }));

  return alarmasDe(mensajes);
}

/**
 * El autor de una fila de la caché, con `direccion` como red.
 *
 * 61 de las 418 filas de `closer_mensajes` tienen `autor` en NULL —anteriores al clasificador—, y
 * 18 de esas son entrantes. Sin esta red, esas 18 no contarían como mensajes del contacto y las
 * heurísticas quedarían ciegas justo en las conversaciones más viejas.
 *
 * `inbound` ⇒ `contacto` no tiene ambigüedad: un mensaje entrante es de la persona atendida, por
 * definición. Al revés no vale — un saliente sin autor puede ser el bot, un workflow o un asesor,
 * y adivinar ahí sería imputarle al agente algo que quizá no dijo. Por eso el saliente sin autor
 * cae en `desconocido`, que las heurísticas ignoran.
 */
function autorDeFila(m: FilaMensajeCache): AutorMensaje {
  if (m.autor) return m.autor as AutorMensaje;
  return m.direccion === "inbound" ? "contacto" : "desconocido";
}

interface FilaMensajeCache {
  autor: string | null;
  direccion: string | null;
  body: string | null;
  timestamp_ghl: string | null;
}

export interface DecisionAuditor {
  correr: boolean;
  motivo: string;
  iaAhora: number;
  lineaBase: number;
  delta: number;
  /** `true` = conversación vieja sin actividad: se siembra la línea base sin llamar al modelo. */
  soloSembrar: boolean;
  /**
   * Las señales del nivel 0 que adelantaron el análisis, si lo adelantaron.
   *
   * Se guardan en `closer_analisis_agente.disparo` para poder medir después **cuál sirve**: una
   * señal que dispara seguido y nunca termina en veredicto rojo es gasto, y sin este dato no hay
   * forma de saberlo.
   */
  alarmas?: Alarma[];
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
/**
 * ¿El agente de IA está atendiendo a este contacto? La respuesta ÚNICA para los dos carriles.
 *
 * ── Por qué existe esta función y no cada carril con su filtro ────────
 *
 * El carril amarillo nació copiando el filtro del endpoint manual —`botAtendiendo(tags) &&
 * !TAG_FALLO`— y contra los datos reales de producción eso matchea **cero contactos**: los
 * workflows de GHL que aplican `bot_activado` (🟦 08.1 / 08.2) siguen en BORRADOR, así que hoy
 * nadie lleva el tag. El cron habría corrido todos los días devolviendo "sin conversaciones" sin
 * que nada fallara — el mismo modo de falla que los prompts que no existían mientras el panel
 * reportaba éxito.
 *
 * Lo que faltaba no era el filtro sino la escotilla: el carril rojo automático salta el portón
 * cuando `AUDITOR_SIN_PORTON_TAGS=1`, y por eso sí audita. Dos definiciones de "el bot atiende"
 * divergen en silencio; es la regla 3 de CLAUDE.md. Ahora hay una.
 *
 * El día que Fabio publique los workflows, la escotilla se apaga y **los dos carriles** pasan
 * a regirse por el tag a la vez.
 */
export function elAgenteAtiende(tags: readonly string[]): boolean {
  if (tags.includes(TAG_FALLO)) return false; // ya tiene veredicto rojo y su tarea
  return botAtendiendo(tags) || env.auditorSinPortonTags();
}

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
    /**
     * Solo los análisis de CHAT cuentan como línea base (2026-08-10). Sin este filtro, la primera
     * llamada de voz analizada del contacto —que guarda `ia_cache_al_analizar: null`— se volvía
     * "el análisis más reciente" y reseteaba la línea base a 0: el chat se re-analizaba de más en
     * cada mensaje. La unidad de este debounce son mensajes de chat; la voz no participa.
     */
    .in("agente_id", AUDITORES_ACTIVOS as readonly string[])
    .order("analizado_el", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lineaBase = Number(ultimo?.ia_cache_al_analizar ?? 0);
  const delta = iaAhora - lineaBase;

  if (delta < umbral) {
    /**
     * ── El nivel 0, antes de rendirse ────────────────────────────────
     *
     * El debounce solo deja pasar a una conversación donde la IA mandó 4 mensajes y el contacto
     * se fue enojado: nunca se audita y el bot nunca se apaga. Estaba documentado como
     * consecuencia matemática de la regla, y es el caso que más duele.
     *
     * Las heurísticas corren sobre `closer_mensajes` —nuestra propia caché— así que **no cuestan
     * ni una llamada a GHL ni una al modelo**: es una consulta más a la base, en el mismo
     * endpoint que ya hizo dos. Por eso cerrar el agujero es gratis: en la conversación normal el
     * gasto queda idéntico al del debounce solo.
     *
     * ── Por qué `delta >= 1` y no `delta >= 0` ────────────────────────
     *
     * Una alarma **no se consume**: la frustración sigue en los 3 mensajes recientes del contacto
     * después de que el análisis corrió. Sin este piso, la conversación alarmada se re-analizaría
     * en CADA mensaje entrante hasta que la queja envejezca y salga de la ventana — una inferencia
     * por mensaje, justo en las conversaciones más largas. El debounce ya no la frena, porque la
     * alarma es precisamente lo que lo saltea.
     *
     * El piso sale de qué audita esto: **al agente**. Si el agente no dijo nada nuevo desde el
     * último veredicto, no hay nada nuevo que juzgar, y el veredicto anterior ya cubre lo que hay.
     * Con esto el peor caso de una conversación alarmada es un análisis por mensaje del agente en
     * vez de uno cada cinco — cinco veces el costo del debounce, pero solo mientras esté alarmada.
     *
     * No rompe el caso de aceptación: una conversación que nunca se analizó tiene `lineaBase = 0`,
     * así que `delta` es la cantidad de mensajes del agente, y el portón 5 ya exige que haya al
     * menos uno para que exista algo que auditar.
     */
    const alarmas = delta >= 1 ? await alarmasDelCache(ghlContactId) : [];
    if (alarmas.length === 0) {
      return {
        correr: false,
        motivo: `debounce: faltan ${umbral - delta} mensajes de la IA (${delta}/${umbral})`,
        iaAhora,
        lineaBase,
        delta,
        soloSembrar: false,
      };
    }
    return {
      correr: true,
      motivo: `alarma del nivel 0: ${alarmas.map((a) => a.senal).join(", ")} (delta ${delta}/${umbral})`,
      iaAhora,
      lineaBase,
      delta,
      soloSembrar: false,
      alarmas,
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
     * imposible de probar contra conversaciones reales mientras los workflows de GHL
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
            // Sin juicio no hay nivel. Ver el comentario de `Veredicto.nivel`.
            nivel: null,
            destacado: "",
            evidencia: "",
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

    /**
     * ── El portón del auditor apagado ─────────────────────────────────
     *
     * Justo ANTES de `evaluarConversacion`, que es la línea que gasta plata. Hoy solo puede
     * frenar a los agentes de voz (`AUDITOR_VOZ_HABILITADO = false`), y ellos no llegan acá
     * porque `TERRITORIOS` mapea a los de texto — pero el guard va igual, y no es defensivo por
     * costumbre: es el único punto por el que pasa toda llamada al modelo del carril rojo. El día
     * que exista el analizador de voz, "encender el flag" tiene que ser lo único que haga falta.
     *
     * Ver `AUDITORES_ACTIVOS` para el otro portón, que es el de "este auditor no existe todavía".
     * Son dos cosas distintas: no existe ≠ está apagado a propósito.
     */
    if (!auditorHabilitado(agenteId)) {
      return {
        analizado: false,
        motivo: `el auditor de ${agenteId} está bloqueado: no analiza ni gasta llamadas al modelo`,
        territorio,
        debounce,
      };
    }

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
      alarmas: decision.alarmas,
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

    /**
     * ── La única diferencia entre chat y voz está acá ─────────────────
     *
     * En chat el rojo apaga el bot y el contacto entra a Urgentes. En **voz no puede**: la llamada
     * ya terminó, no hay bot hablando que interrumpir ni conversación que pausar. Aplicar
     * `bot_pausado_fallo` por una llamada mala pausaría el agente de CHAT de ese contacto, que es
     * otro agente y puede estar trabajando bien — apagar al inocente por el error del otro.
     *
     * Lo que sí pasa en los dos casos: la nota `[IA] …` de arriba y la corrección de prompt del
     * hallazgo. Ese es el objetivo de fondo — que el agente no repita el error.
     */
    if (!elRojoApagaElBot(agenteId)) {
      return { ...base, fallo: true, tagAplicado: false };
    }

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
  const candidatos = contactos.filter((c) => elAgenteAtiende(c.tags));

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
