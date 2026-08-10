/**
 * Assistable → `CallRecord`: las llamadas de los agentes de voz.
 *
 * Isomorfo a propósito. El webhook (`api/webhooks/llamada.ts`) lo usa para escribir la fila y
 * la lectura (`api/closer/llamadas.ts`) para armar lo que muestra la ficha. Una sola
 * derivación por regla (regla 3): si "contestada" se calculara en los dos lados, un día
 * dirían cosas distintas y nadie sabría cuál de las dos vitrinas miente.
 *
 * El esquema salió de los tres payloads reales del 2026-08-06 (ver `docs/db/016_llamadas.sql`).
 * Assistable corre sobre Retell, así que los vocabularios de `disconnection_reason` y
 * `user_sentiment` son los de Retell.
 */

import type { CallOrigin, CallRecord, Sentimiento } from "./closerStore";
// Con extensión `.js` aunque sea un `.ts` y aunque el resto de `src/` no la use: este módulo
// lo importan funciones de `api/`, donde un import sin extensión revienta en runtime con
// `FUNCTION_INVOCATION_FAILED` sin decir cuál módulo. Vite lo resuelve igual.
import { formateador, ZONA_HORARIA_ORG } from "./fechas.js";

/* ────────────────────────── El payload, como llega ────────────────────────── */

/**
 * Todo opcional menos nada: es un cuerpo de webhook, no un contrato que podamos exigir. Si
 * Assistable deja de mandar un campo, el parseo tiene que degradar a `null` en esa columna —
 * nunca tirar una excepción que haga perder la llamada entera.
 */
export interface PayloadLlamada {
  call_id?: unknown;
  contact_id?: unknown;
  location_id?: unknown;
  assistant_id?: unknown;
  direction?: unknown;
  from?: unknown;
  to?: unknown;
  start_timestamp?: unknown;
  end_timestamp?: unknown;
  call_time_seconds?: unknown;
  disconnection_reason?: unknown;
  call_completion_reason?: unknown;
  call_summary?: unknown;
  full_transcript?: unknown;
  transcript_object?: unknown;
  user_sentiment?: unknown;
  recording_url?: unknown;
  extractions?: unknown;
  called_tools?: unknown;
  [k: string]: unknown;
}

/** La fila de `closer_llamadas`, en los nombres de la base. */
export interface FilaLlamada {
  call_id: string;
  ghl_contact_id: string;
  location_id: string | null;
  assistant_id: string | null;
  origen: CallOrigin;
  direccion: string | null;
  numero_desde: string | null;
  numero_hacia: string | null;
  inicio_el: string | null;
  fin_el: string | null;
  duracion_segundos: number;
  contestada: boolean;
  motivo_desconexion: string | null;
  motivo_cierre: string | null;
  resumen: string | null;
  transcripcion: string | null;
  turnos: unknown[] | null;
  sentimiento: string | null;
  grabacion_url: string | null;
  extracciones: unknown;
  herramientas: unknown;
}

/* ─────────────────────────── Qué agente habló ─────────────────────────── */

/**
 * `assistant_id` → de qué embudo es la llamada.
 *
 * `cmrtd28sb0083l2048msdf9hk` es Appointment Flow y no es una suposición: su saludo, en los
 * tres payloads, dice *"Estoy aquí para confirmar tu reunión con nuestro equipo"*. Confirmar
 * una reunión ya agendada es post-agenda, o sea territorio del closer.
 *
 * Se puede ampliar sin deploy con `ASISTENTES_VOZ_EXTRA` (JSON `{"id":"lead_flow_voz"}`).
 */
export const ASISTENTES_VOZ: Record<string, CallOrigin> = {
  cmrtd28sb0083l2048msdf9hk: "app_flow_voz",
};

/**
 * Un asistente que no está en el mapa cae en `voz_ia`, no en `app_flow_voz`.
 *
 * La tentación es asumir el único que conocemos, y sería un dato falso barato de producir:
 * el día que Lead Flow empiece a llamar, sus llamadas aparecerían etiquetadas como del closer
 * en la ficha de un contacto del setter. Lo que sí es seguro —y lo único que los contadores
 * necesitan— es que NO es una sales call, así que 📞 sigue contando bien igual.
 */
export function origenDeAsistente(assistantId: string | null, extra?: Record<string, CallOrigin>): CallOrigin {
  if (!assistantId) return "voz_ia";
  return extra?.[assistantId] ?? ASISTENTES_VOZ[assistantId] ?? "voz_ia";
}

/* ────────────────────── ¿Atendió alguien de verdad? ────────────────────── */

/**
 * Motivos que significan que del otro lado no había una persona. Son de Retell.
 *
 * `duracion > 0` no alcanza y esta lista existe por eso: la primera llamada de prueba duró
 * **1.86 segundos, tiene grabación**, y es un buzón de voz. Contarla como atendida inflaría
 * el contador 📞, que alimenta decisiones reales del closer.
 */
export const MOTIVOS_SIN_CONTACTO = new Set([
  "voicemail_reached",
  "machine_detected",
  "dial_no_answer",
  "dial_busy",
  "dial_failed",
  "user_declined",
  "registered_call_timeout",
  "concurrency_limit_reached",
]);

/** Assistable rellena `call_summary` con esto cuando no hubo nada que resumir. */
const RESUMEN_VACIO = "no conversation data available";

/**
 * Contestada = hubo conversación. Se exigen las tres cosas, y cada una tapa un agujero de
 * las otras dos:
 *
 *   1. El motivo no es de los que dicen "no atendió nadie" — veto directo.
 *   2. La llamada duró algo.
 *   3. Quedó **rastro** de la charla: turnos, transcripción o resumen.
 *
 * La tercera es la que salva del motivo desconocido. Si mañana Retell agrega un
 * `dial_rejected_by_carrier` que no está en la lista, sin ella una llamada que nadie atendió
 * pasaría como atendida. Y como el agente habla apenas conecta, una llamada real siempre deja
 * rastro — incluso si el contacto no llega a decir una palabra.
 */
export function contestoAlguien(p: PayloadLlamada): boolean {
  const motivo = texto(p.disconnection_reason);
  if (motivo && MOTIVOS_SIN_CONTACTO.has(motivo)) return false;
  if (numero(p.call_time_seconds) <= 0) return false;

  const turnos = Array.isArray(p.transcript_object) ? p.transcript_object.length : 0;
  return turnos > 0 || Boolean(texto(p.full_transcript)) || Boolean(resumenUtil(p.call_summary));
}

/* ──────────────────────────── El parseo ──────────────────────────── */

/**
 * Devuelve `null` cuando la llamada no se puede archivar: sin `call_id` no hay clave de
 * idempotencia y sin `contact_id` no hay ficha donde mostrarla. El webhook igual responde 200
 * y conserva el cuerpo crudo en la bandeja — se pierde la fila, nunca el dato.
 */
export function parsearLlamada(p: PayloadLlamada, extra?: Record<string, CallOrigin>): FilaLlamada | null {
  const callId = texto(p.call_id);
  const contactId = texto(p.contact_id);
  if (!callId || !contactId) return null;

  const assistantId = texto(p.assistant_id);
  const turnos = Array.isArray(p.transcript_object) ? p.transcript_object : null;

  return {
    call_id: callId,
    ghl_contact_id: contactId,
    location_id: texto(p.location_id) || null,
    assistant_id: assistantId || null,
    origen: origenDeAsistente(assistantId || null, extra),
    direccion: texto(p.direction) || null,
    numero_desde: texto(p.from) || null,
    numero_hacia: texto(p.to) || null,
    inicio_el: desdeEpoch(p.start_timestamp),
    fin_el: desdeEpoch(p.end_timestamp),
    duracion_segundos: numero(p.call_time_seconds),
    contestada: contestoAlguien(p),
    motivo_desconexion: texto(p.disconnection_reason) || null,
    motivo_cierre: texto(p.call_completion_reason) || null,
    // El placeholder de Assistable no se guarda: "No conversation data available" en la
    // pantalla de un closer se lee como un error nuestro, no como "no habló nadie".
    resumen: resumenUtil(p.call_summary),
    transcripcion: texto(p.full_transcript) || null,
    turnos: turnos && turnos.length > 0 ? turnos : null,
    sentimiento: texto(p.user_sentiment) || null,
    grabacion_url: texto(p.recording_url) || null,
    extracciones: vacio(p.extractions) ? null : p.extractions,
    herramientas: vacio(p.called_tools) ? null : p.called_tools,
  };
}

/* ──────────────────────── Fila → lo que ve la ficha ──────────────────────── */

const MOTIVO_EN_CASTELLANO: Record<string, string> = {
  voicemail_reached: "Buzón de voz",
  machine_detected: "Contestó una máquina",
  dial_no_answer: "No respondió",
  dial_busy: "Ocupado",
  dial_failed: "No se pudo marcar",
  user_declined: "Rechazó la llamada",
  registered_call_timeout: "Expiró sin conectar",
  concurrency_limit_reached: "Sin líneas disponibles",
  user_hangup: "Cortó el contacto",
  agent_hangup: "Cerró el agente",
  call_transfer: "Transferida a un humano",
  inactivity: "Silencio prolongado",
  max_duration_reached: "Llegó al límite de duración",
  scam_detected: "Marcada como spam",
};

/** Un motivo que no está en la tabla viaja **crudo**: mejor un término en inglés que un texto inventado que oculte un caso nuevo. */
export function motivoEnCastellano(motivo: string | null): string | null {
  if (!motivo) return null;
  return MOTIVO_EN_CASTELLANO[motivo] ?? motivo;
}

/** `mm:ss`. Los segundos vienen con decimales (`1.86`) y se redondean hacia abajo. */
export function duracionLlamada(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Un turno de la transcripción, ya normalizado y seguro para mostrar.
 *
 * ── Por qué NO se manda `turnos` tal cual al browser ──────────────────
 *
 * `closer_llamadas.turnos` es el `transcript_object` de Retell **sin redactar**:
 * `redactarSecretos()` se aplica solo al cuerpo crudo del inbox, no a esta columna. Cada turno
 * trae un `metadata` con ids internos, latencias y —en un turno de herramienta— los argumentos de
 * la tool. Copiar el objeto al browser mandaría eso y todo lo que Retell agregue mañana, a un
 * endpoint que ven `closer`, `setter` y `tecnico`.
 *
 * Así que se mapea campo por campo: dos strings salen, nada más.
 */
export interface TurnoLlamada {
  /**
   * `otro` es deliberado y no un cajón de sastre: un rol que no conocemos **no se etiqueta como el
   * contacto**. Decir "esto lo dijo el contacto" sobre un turno que no sabemos de quién es sería
   * una afirmación falsa sobre una persona real — la regla 1 aplicada a una etiqueta.
   */
  rol: "agente" | "contacto" | "otro";
  texto: string;
}

/**
 * Los turnos legibles de una llamada. Único lugar donde se interpreta la forma de Retell.
 *
 * La forma `{role, content}` está verificada contra la primera llamada contestada real
 * (2026-08-10): Retell manda además `metadata` por turno, que acá se descarta. Un turno que no
 * matchea se descarta entero en vez de mostrarse a medias.
 */
export function turnosDeLlamada(turnos: unknown): TurnoLlamada[] {
  if (!Array.isArray(turnos)) return [];
  const salida: TurnoLlamada[] = [];
  for (const t of turnos) {
    if (typeof t !== "object" || t === null) continue;
    const crudo = t as { role?: unknown; content?: unknown };
    if (typeof crudo.role !== "string" || typeof crudo.content !== "string") continue;
    const texto = crudo.content.trim();
    if (!texto) continue;
    const rol = crudo.role === "agent" ? "agente" : crudo.role === "user" ? "contacto" : "otro";
    salida.push({ rol, texto });
  }
  return salida;
}

const SENTIMIENTO_ASSISTABLE: Record<string, Sentimiento> = {
  positive: "positivo",
  neutral: "neutral",
  negative: "negativo",
};

/**
 * ── La zona entra por parámetro, no por constante (2026-08-08) ────────
 *
 * Este archivo vive en `src/` pero **solo corre en el servidor**: sus dos consumidores son
 * `api/closer/llamadas.ts` y `api/webhooks/llamada.ts`. Así que la fecha de una llamada tiene que
 * salir en la zona de la empresa, igual que el resto del backend.
 *
 * Lo que no puede hacer es importar `api/_lib/env.js`: sería una dependencia de `src/` hacia `api/`,
 * y este módulo lo consume además un test de `src/`. La zona viaja como argumento, con el default
 * para el único llamador que no tiene empresa activa —el test— y `env.zonaHoraria()` desde los dos
 * endpoints. El default es explícito y no un descuido.
 */
const OPCIONES_FECHA = {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
} as const;

/**
 * `06 ago 19:44`.
 *
 * Con `formatToParts` y `padStart` a mano porque `es-PE` **ignora `2-digit`**: pedirle el
 * string armado devuelve `6/8, 19:44`, y las partes tampoco vienen rellenadas. Ya rompió el
 * sello de tiempo del auditor una vez.
 *
 * Lleva la hora, no solo el día: un agente de voz reintenta varias veces la misma jornada, y
 * tres filas que dicen "06 ago" son indistinguibles entre sí.
 */
export function fechaDeLlamada(iso: string | null, zona: string = ZONA_HORARIA_ORG): string {
  if (!iso) return "Sin fecha";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Sin fecha";
  const p = Object.fromEntries(
    formateador("es-PE", { timeZone: zona, ...OPCIONES_FECHA }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  const dd = (v: string | undefined) => String(v ?? "").padStart(2, "0");
  const mes = String(p.month ?? "").replace(".", "");
  return `${dd(p.day)} ${mes} ${dd(p.hour)}:${dd(p.minute)}`;
}

/**
 * `resultado` sigue el formato que fija el tipo: `"{Contestó/No contestó} · {texto}"`.
 * Sin motivo conocido queda solo la primera mitad — no se rellena con "Sin motivo", que
 * sería afirmar que preguntamos y no había.
 */
export function resultadoDeLlamada(contestada: boolean, motivo: string | null): string {
  const cabeza = contestada ? "Contestó" : "No contestó";
  const cola = motivoEnCastellano(motivo);
  return cola ? `${cabeza} · ${cola}` : cabeza;
}

/**
 * La proyección que consume el tab Llamada.
 *
 * `resumenIA`, `sentimiento` y `audioUrl` **solo** viajan si la llamada fue contestada, y no
 * es una decisión estética: el tipo lo dice (*"presente únicamente si contestada"*) y la
 * tarjeta ni siquiera los renderiza en la otra rama. El buzón de voz del 2026-08-06 tiene
 * grabación y sentimiento `neutral`; mandarlos sería ofrecer "escuchar el audio" de una
 * llamada que nadie atendió y un veredicto emocional sobre un silencio.
 */
export function aCallRecord(f: FilaLlamada, zona: string = ZONA_HORARIA_ORG): CallRecord {
  return {
    id: f.call_id,
    origin: f.origen,
    fecha: fechaDeLlamada(f.inicio_el, zona),
    duracion: duracionLlamada(f.duracion_segundos),
    contestada: f.contestada,
    resultado: resultadoDeLlamada(f.contestada, f.motivo_desconexion),
    ...(f.contestada && f.resumen ? { resumenIA: f.resumen } : {}),
    /**
     * Solo si contestada, igual que el resumen: una no contestada no tiene conversación. Y
     * `undefined` en vez de `[]` cuando no hay turnos — la tarjeta no renderiza el bloque en vez
     * de mostrar una transcripción vacía (regla 1).
     */
    ...(f.contestada && turnosDeLlamada(f.turnos).length > 0
      ? { transcripcion: turnosDeLlamada(f.turnos) }
      : {}),
    ...(f.contestada && f.sentimiento && SENTIMIENTO_ASSISTABLE[f.sentimiento]
      ? { sentimiento: SENTIMIENTO_ASSISTABLE[f.sentimiento] }
      : {}),
    ...(f.contestada && f.grabacion_url ? { audioUrl: f.grabacion_url } : {}),
  };
}

/* ──────────────────────── Redacción de secretos ──────────────────────── */

/**
 * Claves cuyo VALOR nunca debe quedar guardado. Se comparan en minúsculas y por inclusión.
 *
 * Assistable manda `variables` con 160 claves, y adentro va `custom_values` — los valores
 * personalizados de la subcuenta de GHL, que en esta cuenta incluyen **el access token de
 * Facebook entero**. Nadie lo pidió: viaja porque el agente los recibe todos.
 *
 * Guardarlo sería copiar una credencial viva a una segunda base, con su propio backup y su
 * propio riesgo de fuga, para no usarla jamás. Se recorta antes del INSERT.
 */
const CLAVES_SECRETAS = ["token", "secret", "password", "api_key", "apikey", "access_key", "private_key"];

const REDACTADO = "[redactado por Comando Central]";

/**
 * Recorre el payload y reemplaza el valor de toda clave que parezca una credencial.
 *
 * Recursivo y sobre una copia: el objeto original lo sigue usando el parseo. Solo toca
 * strings — un `false` o un número bajo una clave `*_token` no es una credencial y borrarlo
 * escondería información sin ganar nada.
 */
export function redactarSecretos<T>(valor: T): T {
  if (Array.isArray(valor)) return valor.map((v) => redactarSecretos(v)) as unknown as T;
  if (!valor || typeof valor !== "object") return valor;

  const salida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(valor as Record<string, unknown>)) {
    const sospechosa = CLAVES_SECRETAS.some((s) => k.toLowerCase().includes(s));
    salida[k] = sospechosa && typeof v === "string" && v.length > 0 ? REDACTADO : redactarSecretos(v);
  }
  return salida as T;
}

/* ──────────────────────────── Ayudantes ──────────────────────────── */

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
}

function numero(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Los timestamps de Assistable son epoch en **milisegundos** (`1785977112064`). */
function desdeEpoch(v: unknown): string | null {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function resumenUtil(v: unknown): string | null {
  const s = texto(v);
  if (!s || s.toLowerCase() === RESUMEN_VACIO) return null;
  return s;
}

function vacio(v: unknown): boolean {
  if (v == null) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as object).length === 0;
  return false;
}
