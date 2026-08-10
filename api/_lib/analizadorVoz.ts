/**
 * El auditor de VOZ: toma una llamada archivada en `closer_llamadas` y la somete a la rúbrica.
 *
 * ── Qué reusa del motor de chat, y qué no ─────────────────────────────
 *
 * Reusa TODO lo delicado de `analizador.ts`: la llamada al modelo con su caché y su esquema
 * (`evaluarConversacion`, vía el parámetro `encuadre`), la normalización de hallazgos, la
 * derivación del nivel, la persistencia (`guardarAnalisis`/`guardarHallazgos`), los patrones
 * conocidos y la resolución del prompt por empresa (`cargarPromptAgente`, ampliado a los 4).
 * Duplicar cualquiera de esas piezas habría sido la regla 3 rota en el archivo más caro de romper.
 *
 * Lo que NO reusa, con motivo:
 *
 *   · El **debounce** (`decidirAnalisis`): su unidad son mensajes de chat acumulándose. Una
 *     llamada ya es una conversación completa con principio y fin — el disparo es 1:1 con el
 *     webhook y el dedupe es por `call_id`.
 *   · El **candado** `closer_auditor_claim`: es por contacto, y usar el mismo haría que una
 *     llamada y un mensaje de chat simultáneos del mismo contacto se descartaran mutuamente.
 *     El candado natural de la voz es la consulta de dedupe por `(agente_id, conversation_id)`.
 *   · El **nivel 0** (heurísticas léxicas): existen para decidir si vale la pena gastar cuando
 *     el debounce diría que no. Acá el filtro gratis equivalente es `contestada === false`.
 *
 * ── El rojo de voz NO apaga ningún bot (decisión de Fabio, 2026-08-10) ──
 *
 * La llamada ya terminó: no hay agente que interrumpir, y `bot_pausado_fallo` pausaría al agente
 * de CHAT del contacto — otro agente, que puede estar trabajando bien. `elRojoApagaElBot` ya
 * codifica esto y `analizarYMarcar` nunca llega acá. El rojo de voz deja la nota `[IA]` en el
 * contacto y alimenta Auditoría de Agentes (tarjeta, banner, patrones con corrección de prompt).
 *
 * ── El prompt del agente: si está, se cita; si no, se audita igual ────
 *
 * Es el mismo mecanismo del chat: `cargarPromptAgente` devuelve `AUSENTE` sin lanzar, la rúbrica
 * tiene la rama "si NO recibiste el prompt", y la única diferencia es que la corrección sale como
 * instrucción autónoma (`agregado`) en vez de cita con reemplazo.
 */

import type { CallOrigin } from "../../src/lib/closerStore.js";
import type { FilaLlamada } from "../../src/lib/assistable.js";
import { auditorHabilitado, type AgenteVozId } from "../../src/lib/auditores.js";
import {
  CRITERIOS_CLOSER,
  CRITERIOS_SETTER,
  evaluarConversacion,
  guardarAnalisis,
  guardarHallazgos,
  patronesConocidos,
  PREFIJO_NOTA,
  rubricaDe,
  type MedioRubrica,
  type Territorio,
} from "./analizador.js";
import { cargarPromptAgente } from "./promptAgente.js";
import { db } from "./repo.js";
import { ghl } from "./ghl/index.js";

/**
 * Qué agente de voz habló, según el `origen` que `parsearLlamada` derivó del `assistant_id`.
 *
 * `voz_ia` (asistente no mapeado) y `sales_call` (reunión humana) NO se auditan: no se sabe qué
 * agente fue, o no fue un agente. Auditar "al más parecido" imputaría fallos al equivocado — el
 * mismo motivo por el que `origenDeAsistente` no asume `app_flow_voz` para un id desconocido.
 */
export const TERRITORIOS_VOZ: Partial<Record<CallOrigin, { agenteId: AgenteVozId; territorio: Territorio; contexto: string }>> = {
  app_flow_voz: {
    agenteId: "appointment-flow-voz",
    territorio: "closer",
    contexto:
      "El agente auditado es Appointment Flow VOZ: llama por teléfono en la etapa POST-AGENDA. El contacto ya " +
      "tiene una cita agendada, y el trabajo del agente en la llamada es confirmarla y acompañarla hasta la " +
      "llamada de venta.",
  },
  lead_flow_voz: {
    agenteId: "lead-flow-voz",
    territorio: "setter",
    contexto:
      "El agente auditado es Lead Flow VOZ: llama por teléfono en la etapa PRE-AGENDA. El contacto es un lead " +
      "que todavía no agendó, y el trabajo del agente en la llamada es calificarlo y conseguir que agende.",
  },
};

/**
 * El medio "llamada telefónica" para el molde de la rúbrica. Los criterios son LOS MISMOS del
 * territorio (los de la `034`): el trabajo que se juzga no cambia por el canal — cambia cómo se
 * lee la evidencia.
 */
export const MEDIO_VOZ: MedioRubrica = {
  descripcion: "llamadas telefónicas de venta (vas a leer la transcripción de una llamada ya terminada)",
  comoLeer: `Es la transcripción automática (ASR) de una llamada de voz que YA TERMINÓ. Cada línea dice quién habló:

  AGENTE IA .............. el agente de voz que estás auditando.
  CONTACTO ............... la persona que atendió la llamada.

REGLA DE ATRIBUCIÓN, INNEGOCIABLE: solo podés imputarle al agente lo que dice una línea
"AGENTE IA".

Y tres realidades del habla transcrita que NO son fallos del agente:
  · Muletillas, repeticiones cortas, autocorrecciones y confirmaciones ("ajá", "¿me escuchás?")
    son normales en una conversación hablada.
  · La transcripción automática comete errores: palabras mal transcritas, nombres deformados,
    tildes perdidas. No reportes como falla algo que se explica mejor como error del ASR.
  · Un corte abrupto puede ser la línea telefónica. Solo es hallazgo si la conducta del agente
    lo causó (por ejemplo, ignoró tres veces lo mismo y el contacto cortó).`,
  consecuenciaIntervencion: `La llamada ya terminó, así que no interrumpe nada: genera una alerta para que un humano
     retome a esta persona cuanto antes. Se reserva para daño real (información falsa tomada
     por buena, contacto enojado sin manejar, pedido explícito de hablar con una persona).`,
  noAuditable: `  · No hay ninguna línea "AGENTE IA" (transcripción vacía o solo habló el contacto).
  · Hay menos de dos intercambios reales (menos de 2 del contacto o menos de 2 del agente):
    un "aló" y un corte no alcanzan para juzgar a nadie.`,
};

/** Una rúbrica por territorio, compuesta una sola vez — mismo patrón que `RUBRICAS` del chat. */
export const RUBRICAS_VOZ: Record<Territorio, string> = {
  closer: rubricaDe(CRITERIOS_CLOSER, MEDIO_VOZ),
  setter: rubricaDe(CRITERIOS_SETTER, MEDIO_VOZ),
};

export interface ResultadoVoz {
  analizado: boolean;
  motivo?: string;
  agenteId?: AgenteVozId;
  nivel?: string | null;
  fallo?: boolean;
  hallazgos?: number;
}

/** Un turno de la transcripción, ya validado. `turnos` llega como `unknown[]` de Retell. */
export interface Turno {
  role: string;
  content: string;
}

/**
 * Valida la forma de los turnos SIN confiar en ella: `transcript_object` es `unknown[]` y la
 * única forma conocida (`{role, content}`) viene de un fixture sintético — nadie vio todavía una
 * llamada real contestada. Un turno que no matchea se descarta; si no sobrevive ninguno, se cae
 * al `full_transcript` crudo.
 */
export function turnosValidos(turnos: unknown[] | null): Turno[] {
  if (!turnos) return [];
  return turnos.filter(
    (t): t is Turno =>
      typeof t === "object" &&
      t !== null &&
      typeof (t as Turno).role === "string" &&
      typeof (t as Turno).content === "string" &&
      (t as Turno).content.trim() !== "",
  );
}

/**
 * El transcript que lee el modelo. Sin sellos de tiempo por línea: Retell no manda timestamps por
 * turno en lo que conocemos del payload, y inventarlos sería darle al modelo un dato falso — la
 * duración total viaja en los hechos medidos, que es lo que sí sabemos.
 */
export function armarTranscriptVoz(fila: FilaLlamada): string {
  const turnos = turnosValidos(fila.turnos);
  if (turnos.length > 0) {
    return turnos
      .map((t) => `${t.role === "agent" ? "AGENTE IA" : "CONTACTO"}: ${t.content.trim()}`)
      .join("\n");
  }
  /**
   * Fallback al texto plano de Assistable. No tiene roles por línea, y se dice: la rúbrica exige
   * líneas "AGENTE IA" para imputar, así que sobre un transcript sin roles el modelo tiene que
   * devolver `auditable: false` — que es el resultado honesto, no un defecto.
   */
  const crudo = (fila.transcripcion ?? "").trim();
  return crudo
    ? `(transcripción sin roles por línea — si no podés atribuir cada frase, devolvé auditable=false)\n\n${crudo}`
    : "";
}

/** Los hechos que el modelo no debe estimar: se miden acá y viajan como datos. */
export function hechosDeLlamada(fila: FilaLlamada, turnos: Turno[]): string {
  const delAgente = turnos.filter((t) => t.role === "agent").length;
  const delContacto = turnos.length - delAgente;
  const lineas = [
    "Hechos medidos por el sistema (no los recalcules):",
    `- Duración de la llamada: ${fila.duracion_segundos} segundos.`,
    `- Turnos transcritos: ${turnos.length} (${delAgente} del agente, ${delContacto} del contacto).`,
    fila.motivo_desconexion ? `- Cómo terminó (según la telefonía): ${fila.motivo_desconexion}.` : null,
    fila.motivo_cierre ? `- Motivo de cierre reportado por la plataforma: ${fila.motivo_cierre}.` : null,
    fila.sentimiento ? `- Sentimiento estimado por la plataforma de voz: ${fila.sentimiento} (es un dato de terceros, el tuyo manda).` : null,
  ];
  return lineas.filter(Boolean).join("\n");
}

/**
 * Analiza una llamada archivada. **Nunca lanza** — devuelve `{analizado:false, motivo}` como
 * `analizarYMarcar`, porque corre dentro del webhook y un análisis fallido no puede costarle el
 * 200 a un evento que ya se guardó.
 */
export async function analizarLlamada(fila: FilaLlamada): Promise<ResultadoVoz> {
  try {
    /* ── Portones, gratis primero ─────────────────────────────────────── */
    if (!fila.contestada) {
      return { analizado: false, motivo: "llamada no contestada: no hubo conversación que auditar" };
    }

    const territorio = TERRITORIOS_VOZ[fila.origen];
    if (!territorio) {
      return {
        analizado: false,
        motivo: `origen "${fila.origen}" sin agente de voz identificado: auditar al más parecido imputaría fallos al equivocado`,
      };
    }
    const { agenteId } = territorio;

    if (!auditorHabilitado(agenteId)) {
      return { analizado: false, motivo: `el auditor de ${agenteId} está bloqueado (AUDITOR_VOZ_HABILITADO)` };
    }

    const transcript = armarTranscriptVoz(fila);
    if (!transcript) {
      return { analizado: false, motivo: "contestada pero sin transcripción: no hay qué leer" };
    }

    /**
     * Dedupe por llamada: el webhook reintenta (y el inbox lo deja pasar a propósito, porque el
     * reintento puede traer la transcripción que faltaba). `conversation_id` guarda el `call_id`
     * — una llamada ES una conversación completa — y el par con `agente_id` es el candado.
     */
    const { data: previo } = await db()
      .from("closer_analisis_agente")
      .select("id")
      .eq("agente_id", agenteId)
      .eq("conversation_id", fila.call_id)
      .limit(1)
      .maybeSingle();
    if (previo) {
      return { analizado: false, agenteId, motivo: "esta llamada ya tiene análisis (reintento del webhook)" };
    }

    /* ── La evaluación: el mismo motor del chat, con el encuadre de voz ── */
    const prompt = cargarPromptAgente(agenteId);
    const patrones = await patronesConocidos(agenteId);
    const turnos = turnosValidos(fila.turnos);

    const resultado = await evaluarConversacion({
      transcript,
      hechos: hechosDeLlamada(fila, turnos),
      territorio: territorio.territorio,
      prompt,
      patrones,
      encuadre: { contexto: territorio.contexto, rubrica: RUBRICAS_VOZ[territorio.territorio] },
    });

    if (!resultado.ok) {
      return { analizado: false, agenteId, motivo: resultado.motivo };
    }
    const veredicto = resultado.veredicto;

    /* ── Persistencia: mismas tablas que el chat ─────────────────────── */
    const analisisId = await guardarAnalisis({
      agenteId,
      ghlContactId: fila.ghl_contact_id,
      conversationId: fila.call_id,
      veredicto,
      // 0 y no un conteo real: la línea base del debounce es de chat y esta fila no participa
      // (el filtro por agente en decidirAnalisis la excluye de todos modos).
      iaEnCache: 0,
      promptHash: prompt.hash,
      disparo: "llamada",
      alarmas: undefined,
    });

    if (analisisId && veredicto.hallazgos.length > 0) {
      // `evidencia_el`: el momento de la llamada si vino, no el del análisis.
      const cuando = fila.inicio_el ?? new Date().toISOString();
      await guardarHallazgos(analisisId, agenteId, fila.ghl_contact_id, veredicto.hallazgos, prompt.hash, cuando);
    }

    /**
     * El rojo de voz: nota `[IA]` en el contacto y nada más. Sin tag (la llamada ya terminó y
     * `bot_pausado_fallo` pausaría al agente de chat) y por lo tanto sin cola Urgentes — el
     * destino operativo es Auditoría de Agentes, decisión de Fabio del 2026-08-10.
     */
    if (veredicto.requiereIntervencion && veredicto.motivoIntervencion) {
      await ghl().escribirNota({
        ghlContactId: fila.ghl_contact_id,
        cuerpo: `${PREFIJO_NOTA} [llamada] ${veredicto.motivoIntervencion}`,
        idempotencyKey: `analisis-voz:${fila.call_id}:nota`,
      });
    }

    return {
      analizado: true,
      agenteId,
      nivel: veredicto.nivel,
      fallo: veredicto.requiereIntervencion,
      hallazgos: veredicto.hallazgos.length,
    };
  } catch (e) {
    return { analizado: false, motivo: (e as Error).message };
  }
}
