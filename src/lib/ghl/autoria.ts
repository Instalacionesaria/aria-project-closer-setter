/**
 * Quién escribió cada mensaje.
 *
 * ## Por qué existe (el bug del 2026-08-04)
 *
 * Hasta hoy el código trataba `direction === "outbound"` como sinónimo de "lo escribió la
 * IA". Medido contra la cuenta real, es falso: por el mismo canal salen al menos cuatro
 * cosas distintas, y se distinguen por `source` + `userId`.
 *
 * | Firma                              | Quién es                               |
 * |------------------------------------|----------------------------------------|
 * | `source:"app"`, SIN `userId`       | el chatbot de GHL (Conversation AI)    |
 * | `source:"app"`, CON `userId`       | un humano tipeando en la UI de GHL     |
 * | `source:"workflow"`, con `userId`  | una plantilla automatizada             |
 * | `source:"api"`, con y sin `userId` | integraciones — ambiguo                |
 *
 * Confundirlas tiene dos consecuencias caras, las dos verificadas:
 *
 * 1. **El auditor juzga al agente por cosas que no escribió.** La rúbrica dice "la IA
 *    prometió algo incorrecto"; si la promesa la hizo una plantilla de workflow, la
 *    corrección hay que aplicarla al workflow, no al prompt del agente.
 * 2. **El debounce no puede contar.** La regla de Fabio es "esperá a que la IA mande 5
 *    mensajes"; sin saber cuáles son de la IA no hay nada que contar.
 *
 * ## Hacia dónde se yerra, y por qué
 *
 * El caso ambiguo (`source:"api"` sin `userId`) se clasifica como `desconocido`, no como
 * `agente_ia`. Las dos formas de equivocarse NO cuestan lo mismo:
 *
 * - Llamar `agente_ia` a lo que no lo es → el auditor puede pausarle el bot a una persona
 *   real y mandarla a la cola roja por algo que escribió un humano. Es exactamente el bug
 *   de §53.1 con otro disfraz.
 * - Llamar `desconocido` a lo que sí era el bot → el contador del debounce avanza más
 *   lento y el análisis llega tarde. Falso negativo, barato y recuperable.
 *
 * Por eso `desconocido` no cuenta para el debounce ni satisface el portón 4 del auditor.
 * Pero **sí se reporta** en `/api/agentes/auditor-estado`: si mañana resulta que el bot de
 * esta cuenta sale por `source:"api"`, el diagnóstico lo va a gritar en vez de callarse, y
 * la válvula de abajo lo arregla sin desplegar.
 *
 * Este módulo es isomorfo (sin React ni Node): lo importan `api/_lib/analizador.ts`,
 * `api/_lib/ingesta.ts` y el endpoint de diagnóstico.
 */

export type AutorMensaje =
  /** `inbound` — la persona a la que se atiende. */
  | "contacto"
  /** El chatbot de GHL. Es el único al que se le puede imputar una falla del agente. */
  | "agente_ia"
  /** Un humano del equipo: la UI de GHL o el compositor de esta herramienta. */
  | "asesor"
  /** Plantilla disparada por un flujo automatizado (recordatorios, confirmaciones). */
  | "workflow"
  /** `TYPE_ACTIVITY_*` — evento de la plataforma, no es conversación. */
  | "sistema"
  /** Saliente que no se puede atribuir con confianza. Ver la nota de arriba. */
  | "desconocido";

/** Lo mínimo que hace falta para atribuir un mensaje. Lo cumplen tanto `MensajeGhl` como el payload del webhook. */
export interface SenalesMensaje {
  direccion?: string | null;
  /** `app` | `workflow` | `api` | `campaign` | … Ausente en muchos payloads del webhook estándar. */
  source?: string | null;
  userId?: string | null;
  messageType?: string | null;
  /** `true` si esta fila la escribió nuestro propio compositor. No se adivina: se sabe. */
  enviadoPorElTool?: boolean;
}

export interface OpcionesAutoria {
  /** `source` que, SIN `userId`, cuentan como el bot. Default: solo `app`. */
  fuentesIa?: readonly string[];
  /** `userId` que en realidad SON el bot (cuentas de servicio), si Fabio confirma alguno. */
  userIdsIa?: readonly string[];
}

const FUENTES_IA_POR_DEFECTO = ["app"] as const;

/** Envíos masivos automatizados. Su `userId` es el de quien ARMÓ el flujo, no el autor del texto. */
const FUENTES_AUTOMATIZADAS = ["workflow", "campaign", "bulk_actions"] as const;

const limpio = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();

/**
 * El autor real de un mensaje. La primera regla que matchea gana.
 *
 * El orden no es casual: va de lo que se sabe con certeza (es un evento del sistema, es
 * entrante, lo mandamos nosotros) a lo que se infiere (la firma del bot), y termina
 * admitiendo que no se sabe en vez de suponer.
 */
export function autorDeMensaje(m: SenalesMensaje, opts: OpcionesAutoria = {}): AutorMensaje {
  const tipo = (m.messageType ?? "").toUpperCase();
  if (tipo.startsWith("TYPE_ACTIVITY")) return "sistema";

  if (limpio(m.direccion) === "inbound") return "contacto";

  if (m.enviadoPorElTool) return "asesor";

  const fuente = limpio(m.source);
  const usuario = (m.userId ?? "").trim();

  // Una cuenta de servicio declarada gana sobre todo lo demás: si Fabio confirma que el
  // bot escribe con un userId, ese userId ES el bot aunque tenga la firma de un humano.
  if (usuario && (opts.userIdsIa ?? []).includes(usuario)) return "agente_ia";

  if (FUENTES_AUTOMATIZADAS.includes(fuente as (typeof FUENTES_AUTOMATIZADAS)[number])) return "workflow";

  if (usuario) return "asesor";

  const fuentesIa = opts.fuentesIa ?? FUENTES_IA_POR_DEFECTO;
  if (fuente && fuentesIa.includes(fuente)) return "agente_ia";

  return "desconocido";
}

/** Solo al agente se le imputan las fallas de la rúbrica. Ver la regla de atribución del prompt. */
export const esDelAgenteIa = (autor: AutorMensaje): boolean => autor === "agente_ia";

/**
 * Cómo se nombra cada autor en el transcript que lee el modelo.
 *
 * Se ETIQUETA en vez de filtrar, y eso es deliberado. Filtrar a los que no son el agente
 * parece más limpio y produce cinco errores concretos:
 *
 * 1. **Causalidad.** La bronca del contacto suele responder a una plantilla de workflow. Sin
 *    ver la plantilla, el auditor le atribuye el enojo al último mensaje del agente.
 * 2. **"Dejó de responder" deja de ser un falso positivo.** Un `ASESOR HUMANO` posterior no
 *    es abandono: es un traspaso. Filtrado, el transcript miente y dice que nadie contestó.
 * 3. **Atribución de la corrección.** Si la promesa incorrecta la hizo una plantilla, el
 *    arreglo va al workflow. Con la evidencia filtrada el auditor no puede ni notarlo.
 * 4. **Conteo de turnos.** "Insiste y no entiende" se juzga contando turnos; sacar mensajes
 *    cambia la cuenta.
 * 5. **Trazabilidad.** La evidencia que se guarda tiene que poder recortarse del mismo
 *    transcript que vio el modelo, o no coincide con el chat real de la ficha.
 */
export const ETIQUETA_AUTOR: Record<AutorMensaje, string> = {
  contacto: "CONTACTO",
  agente_ia: "AGENTE IA",
  asesor: "ASESOR HUMANO",
  workflow: "AUTOMATIZACIÓN",
  sistema: "SISTEMA",
  desconocido: "ORIGEN NO IDENTIFICADO",
};

/** Los seis valores, para recorrerlos sin repetir la lista (diagnóstico, tests, migración). */
export const AUTORES: readonly AutorMensaje[] = [
  "contacto",
  "agente_ia",
  "asesor",
  "workflow",
  "sistema",
  "desconocido",
];
