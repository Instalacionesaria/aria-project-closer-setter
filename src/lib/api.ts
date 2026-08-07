/**
 * Cliente HTTP de las funciones de `api/closer/*`: las lecturas de GHL y, desde que existen
 * Notas y Conexiones, también lo que se guarda del lado de SOFIA.
 *
 * Rutas relativas, mismo origen: el frontend y las funciones se despliegan juntos en Vercel,
 * así que no hay `VITE_API_URL` que configurar ni CORS que abrir. (Hasta el 2026-07-27 esto
 * apuntaba a un Express en una VPS vía túnel; ese backend quedó archivado en la rama
 * `respaldo/kevin-local` cuando el proyecto pasó a Vercel Functions.)
 *
 * El PIT de GHL nunca llega acá: vive solo del lado servidor, en `api/_lib`.
 *
 * Las escrituras que TOCAN GHL no están en este archivo. El Avanzar se persiste por
 * `src/lib/seguimientos/cliente.ts` → `POST /api/closer/avanzar`, que es el único camino que
 * aplica tags y custom fields juntos y con idempotencia. Un `POST /tags` suelto acá
 * duplicaría la escritura y dispararía workflows de más.
 *
 * Sí viven acá las escrituras que NO llegan a GHL —una nota del tab Notas, las credenciales de
 * Ajustes—: no aplican tags, no mueven stages y no disparan ningún workflow, así que la razón
 * de arriba no las alcanza y un tercer cliente solo sería un archivo más donde buscar.
 *
 * ── Por qué este helper y no el de `seguimientos/cliente.ts` ──
 *
 * Son dos clientes del mismo backend con manejo de error OPUESTO, y es a propósito. El de
 * seguimientos devuelve `null` ante cualquier fallo para que la app siga con la semilla (el
 * "modo demo" de `npm run dev`). Acá se LANZA: lo que sirve este archivo son datos que no
 * tienen semilla equivalente —las notas de un contacto, su historial, el estado de las
 * credenciales—, y tragarse el error los dejaría indistinguibles de una lista legítimamente
 * vacía. Un 500 al leer notas se vería como "este contacto no tiene notas", y un 500 al leer
 * conexiones como "no hay credenciales configuradas", con alguien volviendo a pegar el PIT.
 * En una escritura es todavía más grave: un `crearNota` que resuelve `null` es exactamente el
 * éxito falso que la regla §4 prohíbe. Quien llama decide si muestra el error o no.
 */

import type { IndicadoresContacto } from "./indicadores";
import type { VentanaWhatsapp } from "./whatsapp";

/** Error uniforme para todas las llamadas: el status y el detalle del cuerpo, sin ruido. */
/**
 * Se dispara cuando el backend contesta 401. Lo escucha el store de sesión para volver a la
 * pantalla de login sin que cada `catch` del proyecto tenga que saber de autenticación.
 *
 * Un evento y no una importación directa a propósito: si `api.ts` importara el store, y el
 * store importa `api.ts`, sería un ciclo.
 */
export const EVENTO_SIN_SESION = "cc:sin-sesion";

async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  // `credentials: "same-origin"` explícito: la cookie de sesión es httpOnly y el default del
  // navegador ya la manda para el mismo origen, pero dejarlo escrito evita que un cambio de
  // configuración futuro rompa la autenticación de forma silenciosa.
  const res = await fetch(ruta, { credentials: "same-origin", ...init });

  if (res.status === 401) {
    // La sesión venció o nunca hubo. No es un error que la vista tenga que mostrar: es un
    // cambio de estado de la aplicación entera.
    window.dispatchEvent(new CustomEvent(EVENTO_SIN_SESION));
    throw new Error("Tu sesión venció. Volvé a entrar.");
  }

  if (!res.ok) {
    const cuerpo = await res.text().catch(() => "");
    throw new Error(`El servidor respondió ${res.status}. ${detalleDelError(cuerpo)}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Los endpoints de `api/closer/*` fallan con `{ ok: false, codigo, error }`, y ese `error` ya
 * está escrito para un humano ("La nota no puede estar vacía."). Volcar el JSON crudo en el
 * mensaje obligaría a la vista a leer llaves para mostrar algo. Si el cuerpo no es ese JSON
 * —el index.html que devuelve Vite en `npm run dev`, una página de error de Vercel— se cae al
 * recorte de siempre.
 */
function detalleDelError(cuerpo: string): string {
  try {
    const json: unknown = JSON.parse(cuerpo);
    if (json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string") {
      return (json as { error: string }).error;
    }
  } catch {
    /* No era JSON; se usa el cuerpo tal cual. */
  }
  return cuerpo.slice(0, 200);
}

/**
 * `RequestInit` de un POST con cuerpo JSON.
 *
 * El `Content-Type` no es decorativo: sin él, Vercel entrega `req.body` como string crudo y el
 * handler cae en su rescate de `JSON.parse` manual. Ese rescate existe para el `curl` de a
 * mano, no para que el cliente oficial dependa de él.
 */
const conJson = (cuerpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(cuerpo),
});

/**
 * `?ghlContactId=` es el nombre canónico. `notas` e `historial` aceptan además `contactId` como
 * alias por compatibilidad, pero se manda siempre el canónico: si el cliente usara el alias,
 * el alias pasaría a ser el nombre de facto y el canónico quedaría muerto. De `perfil` se
 * asume lo mismo por ser el tercer endpoint del mismo grupo.
 * `/api/closer/conversacion` es la excepción histórica y sigue con `contactId`.
 */
const porContacto = (ruta: string, ghlContactId: string) => `${ruta}?ghlContactId=${encodeURIComponent(ghlContactId)}`;

/** Una cita normalizada tal como la devuelve `GET /api/closer/agenda`. */
export interface AgendaAppointment {
  id: string;
  name: string;
  title: string;
  date: string; // "2026-07-27" (YYYY-MM-DD, día de la organización)
  time: string; // "11:00" (24h)
  startTime: string; // ISO con offset
  endTime: string | null;
  status: string; // confirmed | showed | noshow | cancelled | ...
  meetUrl: string | null;
  contactId: string | null;
}

export interface AgendaHoyResponse {
  date: string;
  calendarId: string | null;
  /** `stub` = sin credenciales de GHL configuradas; la lista viene vacía a propósito. */
  ghlModo?: "real" | "stub";
  count: number;
  appointments: AgendaAppointment[];
  /** Presente solo cuando falta configuración (ej. sin calendario por defecto). */
  aviso?: string;
}

export interface AgendaRangeResponse extends AgendaHoyResponse {
  /** Último día del rango, `YYYY-MM-DD`. */
  hasta: string;
  days: number;
}

/** Citas de HOY del calendario de la subcuenta. */
export function fetchAgendaHoy(opts?: {
  includeCancelled?: boolean;
  calendarId?: string;
}): Promise<AgendaHoyResponse> {
  const params = new URLSearchParams();
  if (opts?.includeCancelled) params.set("includeCancelled", "true");
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  const qs = params.toString();
  return pedir<AgendaHoyResponse>(`/api/closer/agenda${qs ? `?${qs}` : ""}`);
}

/** Citas de hoy hasta hoy+days — alimenta el tab Agenda y "Próximos Días". */
export function fetchAgendaRange(
  days = 6,
  opts?: { calendarId?: string; includeCancelled?: boolean; refrescar?: boolean },
): Promise<AgendaRangeResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  if (opts?.includeCancelled) params.set("includeCancelled", "true");
  /** El botón "Refrescar" de la Agenda: 1 llamada a GHL por acción explícita (doc §8.5). */
  if (opts?.refrescar) params.set("refrescar", "1");
  return pedir<AgendaRangeResponse>(`/api/closer/agenda?${params.toString()}`);
}

export interface UrgenteReal {
  contactId: string;
  name: string;
  source: string;
  /** El motivo real que dejó el analizador. El prefijo "Falla detectada por IA:" lo pone la vista. */
  fallo: string;
  /**
   * Tags crudos de GHL. Con ellos el store deriva la ETAPA real vía `etapaDesdeTags()`, en
   * vez de inventar una: la urgencia es un marcador sobre el contacto, no una etapa.
   */
  tags: string[];
}

/* `fetchUrgentes` (closer) y `fetchRespondieron` se eliminaron el 2026-07-31: sus datos
   llegan ahora en `fetchMiDiaCompleto` (una respuesta, cero GHL). El del SETTER sobrevive
   porque esa sección quedó fuera del alcance de la tarea de conexiones (decisión 4). */

/**
 * Urgentes del SETTER: `bot_pausado_fallo` + `zona_setter`.
 *
 * Son dos colas y no una con parámetro porque los tags de territorio son excluyentes:
 * cada rol pide la suya y no hay forma de que un contacto aparezca en las dos (§11).
 */
export function fetchUrgentesSetter(): Promise<{ count: number; urgentes: UrgenteReal[] }> {
  return pedir(`/api/setter/urgentes`);
}

/* ================================================================== */
/* Auditoría de Agentes                                                */
/* ================================================================== */

export type AgentId = "lead-flow-ai" | "appointment-flow-ai" | "lead-flow-voz" | "appointment-flow-voz";
export type AlertCategoria = "comportamiento" | "base_conocimiento" | "informacion_adicional";
export type AlertSeveridad = "rojo" | "amarillo";
export type CasoEstado = "activo" | "resuelto_por_humano" | "parcheado";

/**
 * Métricas medidas de un agente de TEXTO.
 *
 * Todo campo puede venir `null`: significa "todavía no lo medí". Desde que se quitaron las
 * semillas eso YA NO se traduce en "conservá el valor sembrado" —no hay ninguno— sino en
 * "no renderices ese elemento" (§4.10). Un `null` y un cero no son el mismo hecho.
 */
export interface AgenteTextoMetricas {
  id: "lead-flow-ai" | "appointment-flow-ai";
  metric: string | null;
  delta: { text: string; up: boolean } | null;
  subtext: string | null;
  sentiment: { positivos: number; neutrales: number; molestos: number } | null;
  ops: { label: string; value: string | null }[];
  /** `tasa: null` mientras no se pueda reconstruir hacia atrás — la vista no dibuja esa línea. */
  history: { week: string; tasa: number | null; sentimientoPositivo: number }[];
  /** Cuántos análisis sostienen estos números. 0 = todavía no se midió nada. */
  analisis: number;
}

export interface AgentesTextoResponse {
  ventanaDias: number;
  /** Qué agentes tienen auditor cableado hoy. Los demás muestran su estado explícito. */
  agentesConAuditor: AgentId[];
  agentes: AgenteTextoMetricas[];
}

/** Lo que midieron las analizadoras de agentes de texto. Los de voz no tienen fuente todavía. */
export function fetchAgentesTexto(): Promise<AgentesTextoResponse> {
  return pedir(`/api/agentes/texto`);
}

/**
 * El PATRÓN: lo que comparten todos los casos con el mismo `errorCode`.
 *
 * Los textos salen del hallazgo MÁS RECIENTE del patrón y viajan UNA vez — repetirlos en
 * cada caso es la duplicación que tenía la semilla, y elegir "el primero que tenga algo"
 * (lo que hacía `groupAlerts`) con datos reales significa "uno cualquiera".
 */
export interface PatronAlerta {
  agenteId: AgentId;
  errorCode: string;
  titulo: string;
  categoria: AlertCategoria;
  severidad: AlertSeveridad;
  diagnostico: string | null;
  /**
   * DISCRIMINANTE ESTRUCTURAL: presente = el auditor tenía el prompt del agente y citó texto
   * literal; ausente = no lo tenía y la corrección es una instrucción para agregar. Nunca un
   * booleano `esNuevo`.
   */
  fragmentoPrompt: string | null;
  promptSeccion: string | null;
  correccionTipo: "reemplazo" | "agregado" | null;
  correccion: string | null;
  promptRef: { archivo: string; seccion: string | null } | null;
  /** El prompt cambió desde que se detectó esto: el fragmento citado puede ya no existir. */
  promptDesactualizado: boolean;
  /** ISO del hallazgo del que salieron los textos de arriba. */
  textoDe: string;
  ajustadoEl: string | null;
  /** ISO del primer hallazgo POSTERIOR al ajuste. Derivado por query, no un flag que mantener. */
  reincidenteDesde: string | null;
}

/** Un CASO: una conversación concreta que cayó en el patrón. Sin los textos pesados. */
export interface CasoAlerta {
  id: string;
  agenteId: AgentId;
  errorCode: string;
  /** LA clave del join hacia el closer. Reemplaza al cruce por nombre, que estaba roto. */
  ghlContactId: string;
  /** `null` cuando la caché no lo tiene — la fila no inventa "Sin nombre" (§4.10). */
  nombre: string | null;
  /** ISO. La vista compone "hace 2 horas"; el servidor no compone texto de tiempo. */
  analizadoEl: string;
  estado: CasoEstado;
  evidencia?: { tipo: "chat"; mensajeUsuario: string; mensajeIa: string };
  /** Armada en el servidor: el `locationId` de GHL no viaja al browser. */
  ghlUrl: string | null;
}

export interface AlertasResponse {
  ventanaDias: number;
  agentesConAuditor: AgentId[];
  /** Análisis (fallen o no) por agente. 0 = el auditor no corrió sobre nadie. */
  analisisPorAgente: Partial<Record<AgentId, number>>;
  patrones: PatronAlerta[];
  casos: CasoAlerta[];
}

export function fetchAlertasAgentes(dias = 30): Promise<AlertasResponse> {
  return pedir(`/api/agentes/alertas?dias=${dias}`);
}

/**
 * El closer tomó la conversación a mano: los hallazgos activos de ese contacto pasan a
 * `resuelto_por_humano`.
 *
 * Por `ghlContactId`, nunca por nombre — el cruce por nombre estaba roto desde que el closer
 * indexa por id, y encima solo vivía en memoria.
 *
 * No quita el tag `bot_pausado_fallo` en GHL (el puerto no tiene `quitarTags`), así que el
 * contacto sigue apareciendo en Urgentes hasta que alguien lo saque allá.
 */
export function resolverAlertasDeContacto(ghlContactId: string): Promise<{ resueltos: number }> {
  return pedir(`/api/agentes/alertas`, conJson({ ghlContactId }));
}

export interface AjusteAplicado {
  id: string;
  agenteId: AgentId;
  errorCode: string;
  titulo: string;
  categoria: string;
  /** Cuántos casos cerró ESTE ajuste. Hecho de la escritura, no un recuento vivo. */
  casosCerrados: number;
  diagnostico: string | null;
  fragmentoPrompt: string | null;
  correccion: string | null;
  promptHash: string | null;
  /** Lo firma el SERVIDOR. El cliente nunca lo manda. */
  autor: string;
  /** ISO real de la base. Nunca el literal "Hoy". */
  aplicadoEl: string;
}

export function fetchAjustesAgentes(agenteId?: AgentId): Promise<{ count: number; ajustes: AjusteAplicado[] }> {
  return pedir(`/api/agentes/ajustes${agenteId ? `?agenteId=${agenteId}` : ""}`);
}

/**
 * "Marcar grupo resuelto". Lanza si el servidor lo rechaza — que lance es el punto: la vista
 * no puede pintar la fila en el historial hasta que esto resuelva, o mostraría como guardado
 * algo que no se guardó.
 *
 * Se mandan los casos que el técnico tenía EN PANTALLA, no "todos los de este errorCode":
 * entre abrir el drawer y apretar el botón pudo entrar uno nuevo, y cerrarlo sin haberlo
 * visto es justo lo que el botón promete no hacer.
 */
export function registrarAjusteAgente(body: {
  agenteId: AgentId;
  errorCode: string;
  casosIds: string[];
}): Promise<{ ajuste: AjusteAplicado; casosCerrados: number }> {
  return pedir(`/api/agentes/ajustes`, conJson(body));
}

/** Un mensaje real de la conversación de GHL, normalizado para el Chat. */
export interface ConversationMessage {
  id: string;
  text: string;
  outgoing: boolean; // true = saliente (nosotros), false = entrante (el contacto)
  type: string; // TYPE_SMS, TYPE_WHATSAPP, ...
  date: string;
  time: string; // "10:05 AM"
  /**
   * Estado de entrega según GHL: `delivered` | `read` | `failed` | `pending` | `null`.
   *
   * Es el estado REAL, no el de la respuesta del envío: un mensaje puede figurar como
   * mandado y estar `failed` minutos después, cuando Meta lo rechaza (§55).
   */
  estado?: string | null;
  /** Por qué falló, en las palabras de GHL. Se muestra tal cual bajo la burbuja. */
  errorEnvio?: string | null;
}

export interface ConversationResponse {
  conversationId: string | null;
  count: number;
  /** Si se puede mandar texto libre ahora mismo, y por qué no cuando no se puede. */
  ventana?: VentanaWhatsapp;
  messages: ConversationMessage[];
}

/**
 * La conversación del contacto, desde la CACHÉ (`/api/closer/chat`, cero GHL).
 * Hasta el 2026-07-31 apuntaba a `/api/closer/conversacion`, que costaba 2 llamadas a GHL
 * por request con la ficha abierta cada 10s. El shape de la respuesta es idéntico.
 */
export function fetchConversation(contactId: string): Promise<ConversationResponse> {
  return pedir<ConversationResponse>(`/api/closer/chat?contactId=${encodeURIComponent(contactId)}`);
}

/**
 * Envío real: el closer escribe y sale por WhatsApp vía GHL (1 llamada por mensaje).
 *
 * **Lanza con la ventana de 24 h cerrada** (409 `ventana_24h_cerrada`), antes de gastar la
 * llamada a GHL. El mensaje del error ya viene redactado para mostrarse tal cual.
 */
export function enviarMensaje(contactId: string, message: string): Promise<{ ok: boolean; enviado: boolean; messageId?: string }> {
  return pedir(`/api/closer/mensajes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId, message }),
  });
}

/** "Marcar como resuelto" del Buzón General: mueve la marca y el contacto sale de la cola. */
export function resolverBuzon(contactId: string): Promise<{ ok: boolean; resueltoEl: string }> {
  return pedir(`/api/closer/buzon-resolver`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contactId }),
  });
}

/**
 * Dispara UN ciclo de ingesta a mano. Fire-and-forget.
 *
 * **Ya no cuelga de ningún reloj** (§56): de eso se encarga `tickCloser`. Queda para forzar
 * una ingesta desde la consola o un script sin esperar al tick. Si volvés a ponerlo en un
 * `registrarReloj`, van a ser dos requests por ciclo otra vez.
 */
export function pingReconciliar(): void {
  fetch(`/api/closer/reconciliar`, { method: "POST" }).catch(() => {
    /* backend caído: el próximo tick reintenta */
  });
}

/**
 * El TICK: ingesta + las cinco colas de Mi Día, en un solo request (§56).
 *
 * Reemplaza al par `pingReconciliar()` + `fetchMiDiaCompleto()` que corría cada 10s. La
 * respuesta es la de Mi Día más un campo `reconciliacion` que el store ignora — está para
 * el curl y el diagnóstico.
 *
 * Lanza si la mitad de Mi Día falla. La de ingesta nunca tumba el request: viaja como campo.
 */
export function tickCloser(): Promise<MiDiaResponse & { reconciliacion?: unknown }> {
  return pedir<MiDiaResponse & { reconciliacion?: unknown }>(`/api/closer/tick`, { method: "POST" });
}

/* ================================================================== */
/* Inicio — métricas del mes por query (closer_avances + closer_citas) */
/* ================================================================== */

export interface InicioResponse {
  ok: boolean;
  /** Nombre del mes en curso ("julio") — visible en el dashboard (doc §8.1). */
  mes: string;
  ghlModo: string;
  cashCollected: number;
  ventas: number;
  /** Señas/promesas de "Acordó comprar" — sobre la mesa, no cobrado. */
  sobreLaMesa: number;
  acuerdos: number;
  llamadas: { ocurridas: number; agendadas: number; pasadas: number };
  /** null cuando no hay citas pasadas que medir — la vista pinta "—", no un 0 inventado. */
  showRate: number | null;
}

export function fetchInicio(): Promise<InicioResponse> {
  return pedir<InicioResponse>(`/api/closer/inicio`);
}

/* ================================================================== */
/* Mi Día completo — todas las colas en una respuesta                  */
/* ================================================================== */

export interface MiDiaContacto {
  ghlContactId: string;
  nombre: string | null;
  telefono: string | null;
  fuente: string;
  tags: string[];
  etapa: string;
  congelado: boolean;
  /** Los 6 íconos, los MISMOS que manda el Pipeline — para que las vitrinas no divergan. */
  indicadores?: IndicadoresContacto;
}

export interface MiDiaResponse {
  ok: boolean;
  hoy: string;
  ghlModo: string;
  citasHoy: {
    id: string;
    ghlContactId: string;
    nombre: string | null;
    fechaHora: string;
    estado: string | null;
    meetUrl: string | null;
    vencida: boolean;
    /**
     * Los íconos del widget "Agenda de Hoy". Antes venían hardcodeados en cero desde la
     * vista, apagándolos justo en la pantalla que el closer mira antes de una llamada.
     */
    indicadores?: IndicadoresContacto;
  }[];
  urgentes: (MiDiaContacto & { fallo: string })[];
  buzon: (MiDiaContacto & { ultimoEntranteEl: string | null; snippet: string | null })[];
  completadasHoy: (MiDiaContacto & { motivo: string; cuando: string })[];
  /** La cola de seguimientos de siempre — el shape lo consume `filaAContacto()`. */
  seguimientosHoy: unknown[];
  resumen: { citas: number; urgentes: number; buzon: number; seguimientos: number; completadas: number };
}

/**
 * Las cinco colas, sin la mitad de ingesta.
 *
 * **Ya no cuelga de ningún reloj** (§56): el tick trae lo mismo y además ingiere. El
 * endpoint sigue vivo y es de primera clase —`traerMiDia` de `seguimientos/cliente.ts` lo
 * usa al montar y es la única fuente de `seguimientosHoy`—, pero pedirlo cada 10s sería
 * volver a los dos requests por ciclo.
 */
export function fetchMiDiaCompleto(): Promise<MiDiaResponse> {
  return pedir<MiDiaResponse>(`/api/closer/mi-dia`);
}

/* ================================================================== */
/* Pipeline                                                            */
/* ================================================================== */

/** Un contacto del Pipeline tal como lo devuelve `GET /api/closer/pipeline`. */
export interface PipelineContacto {
  ghlContactId: string;
  /**
   * `null` cuando GHL no tiene nombre para ese contacto. El endpoint lo manda así a propósito
   * (§4.10: sin dato real no se inventa un "Sin nombre"), y la fila decide qué pintar en el
   * hueco. Tiparlo como `string` a secas sería afirmar algo que la respuesta no garantiza: el
   * patrón de las vistas es `c.name.toUpperCase()`, así que el primer contacto sin nombre
   * reventaría en runtime.
   */
  nombre: string | null;
  /** Teléfono real de GHL, o `null` si la cuenta no lo tiene. */
  telefono?: string | null;
  /**
   * En cuál de las 7 etapas cayó el contacto según lo que se le dio en Avanzar. Va como
   * `string` y no como unión cerrada a propósito: el clasificador vive en el servidor, y si
   * acá se declarara la unión y mañana el backend agregara o renombrara una etapa, TS
   * afirmaría una forma que la respuesta ya no cumple —el peor error posible, porque no se ve
   * hasta que la vista pinta mal—. Las esperadas hoy son las de `STAGE_ORDER` en
   * `closerStore.tsx`: `agendado` (la etapa de ENTRADA: tiene `zona_closer` y todavía no
   * recibió ningún Avanzar), `seguimiento`, `cierre`, `ganado`, `no_show`, `nurture` y
   * `descalificado`. Quien consuma esto compara contra esos literales y decide qué hacer con
   * un valor que no reconoce, en vez de asumir que no puede pasar.
   */
  etapa: string;
  /** Tags crudos de GHL. El Pipeline son TODOS los contactos con `zona_closer`. */
  tags: string[];
  /** Chip de fuente. Ausente = el contacto no la trae; la fila NO inventa un "DIRECTO" (§4.10). */
  fuente?: string;
  /**
   * El tag exacto que decidió la etapa, o `null` si el contacto está en la de entrada
   * (`agendado`: tiene `zona_closer` y todavía no recibió ningún Avanzar). Con tags
   * acumulados —lo normal: alguien en seguimiento durante semanas al que después se marca
   * "no le interesa" queda con los dos— responde "¿por qué está en esta columna?" sin tener
   * que abrir GHL.
   */
  tagDesenlace: string | null;
  /** Solo con dinero real detrás (etapa Ganado, lo escribió Avanzar). Ausente/null = sin dato. */
  monto?: number | null;
  /** Subcategoría cacheada por etapa (forma de pago, situación, razón...) — para la píldora rica. */
  subcategorias?: Record<string, string | null>;
  /** Perdió `zona_closer` (§7): visible y movible, pero inerte hacia GHL. */
  congelado?: boolean;
  /**
   * Los 6 indicadores de la fila de íconos, calculados por el servidor (§8).
   *
   * Opcional a propósito: un backend viejo desplegado contra un front nuevo no debe romper
   * el tipo. Cuando falta, la vista cae a las derivaciones históricas de la semilla.
   */
  indicadores?: IndicadoresContacto;
  /**
   * La cita del contacto: la próxima si tiene una vigente, y si no la última que venció
   * (`vencida: true`). `fecha`/`hora` vienen resueltas en la zona de la organización — el
   * browser no puede decidir eso sin equivocarse para un closer fuera de Lima.
   *
   * Es un DATO de la fila, nunca el criterio para que el contacto exista en una columna:
   * la etapa manda dónde aparece. Que la cita decidiera eso es lo que dejaba a dos contactos
   * agendados sin fila en ninguna parte (corregido 2026-08-04).
   */
  cita?: {
    el: string;
    fecha: string;
    hora: string;
    meetUrl: string | null;
    vencida: boolean;
  } | null;
}

/** Los conteos que el backend deriva por query — nunca contadores sueltos (§51.1). */
export interface PipelineStats {
  /** Contactos EN zona (no congelados). */
  baseTotal: number;
  /** De esos, los que siguen en juego: agendado, seguimiento o cierre. */
  enJuegoActivo: number;
  /** Los que perdieron `zona_closer`. Siguen visibles en su columna, atenuados. */
  congelados: number;
}

/**
 * Hasta dónde llegó el barrido de GHL.
 *
 * Existe porque `zona_closer` NUNCA se quita —el swap desde `zona_setter` es de una sola
 * vía—, así que el territorio solo crece: con cientos de leads por mes, pasarse del tope no
 * es un caso borde sino el estado normal a los dos meses. Un Pipeline que muestra 100 de 400
 * y reparte conteos por columna que parecen totales miente justo en la vista que se usa para
 * decidir a quién perseguir.
 */
export interface PipelineCobertura {
  /** `true` = esto es TODO el territorio. */
  completo: boolean;
  /**
   * `true` = la lista viene recortada, y entonces `porEtapa` son conteos de lo leído, NO del
   * negocio. Hay que decirlo en pantalla: un Pipeline cortado en silencio se lee como "esos
   * son todos mis contactos".
   */
  truncado: boolean;
  /** Lo que GHL informa como total del filtro. `null` si no lo devolvió. */
  totalEnGhl: number | null;
  paginasLeidas: number;
  /** Opcional: desde que el Pipeline lee de la caché, el endpoint no manda este campo. */
  tope?: { porPagina: number; paginas: number };
  /** De dónde salió la lista. Hoy siempre `"cache"`. */
  fuente?: string;
  /** Por qué cortó el barrido, cuando `truncado`. */
  motivo?: string;
}

export interface PipelineResponse {
  ok: boolean;
  ghlModo: string;
  /** Contactos DEVUELTOS en esta respuesta (no necesariamente los del negocio — ver `cobertura`). */
  total: number;
  /** Siempre las 7 claves, incluidas las que dan 0. La regla de "contador en cero no se pinta" la aplica la vista. */
  porEtapa: Record<string, number>;
  contactos: PipelineContacto[];
  /** Activos vs. congelados, del servidor. La vista los muestra en vez de recontar por su cuenta. */
  stats?: PipelineStats;
  cobertura: PipelineCobertura;
  /** Frase del servidor para un humano (ej. falta configuración). Ausente = no hay nada que avisar. */
  aviso?: string;
}

/** Pipeline completo del closer: todos los contactos con `zona_closer`, ya clasificados. */
export function fetchPipeline(): Promise<PipelineResponse> {
  return pedir<PipelineResponse>(`/api/closer/pipeline`);
}

/** Lo que devuelve el botón "Sincronizar CRM". */
export interface SincronizarCrmResponse {
  ok: boolean;
  /** `false` = el candado de 60 s no dejó correr. No es un error: `motivo` lo explica. */
  corrio: boolean;
  modo: string;
  motivo?: string;
  citas?: { eventos: number; contactosNuevos: number };
  contactos?: {
    encontrados: number;
    sincronizados: number;
    congelados: number;
    descongelados: number;
    truncado: boolean;
    tope: number;
    errores: string[];
  };
  /** Lo que costó, para que el presupuesto de §51.4 sea verificable y no declarativo. */
  llamadasGhl?: number;
}

/**
 * Sincroniza de verdad: citas de los próximos 15 días + cada contacto del territorio contra
 * GHL. Sin secreto — el freno es el candado en Postgres, igual que `/api/closer/reconciliar`
 * (el `WEBHOOK_SECRET` es server-only y el browser no debe tenerlo).
 */
export function sincronizarCrm(): Promise<SincronizarCrmResponse> {
  return pedir<SincronizarCrmResponse>(`/api/closer/sincronizar`, { method: "POST" });
}

/* El fetcher del cockpit de GHL (`fetchCockpit`, Opportunity Value leído de vuelta) se
   eliminó el 2026-07-31 — decisión de la tarea de conexiones: el dinero del dashboard sale
   de `/api/closer/inicio` (queries sobre closer_avances) y el Opportunity Value solo se
   ESCRIBE al registrar la venta. */

/* ================================================================== */
/* Notas del contacto (tab Notas)                                      */
/* ================================================================== */

/**
 * Una nota real de `closer_notas`. Se llama `NotaReal` para no pisar el `NotaItem` de la
 * semilla en `closerStore.tsx`: son formas distintas y conviven en la misma ficha.
 *
 * Los campos viajan CRUDOS. `creadoEl` es ISO y `autor` un nombre suelto — componer
 * "8 jul · Venta · Jorge Q." es de la vista, no del servidor.
 */
export interface NotaReal {
  id: string;
  ghlContactId: string;
  texto: string;
  /** Píldora del Avanzar que originó la nota, o `null` si fue una nota suelta (§3). */
  contexto: string | null;
  autor: string;
  /** Hoy siempre `null`: sin sesión se sabe el nombre, no QUIÉN escribió. */
  autorUsuarioId: string | null;
  /** ISO con `Z`. */
  creadoEl: string;
}

export interface NotasResponse {
  ok: boolean;
  ghlContactId: string;
  /** Viaja aunque sea 0; ocultar el contador en cero es de la vista (§4.1). */
  count: number;
  /** La más reciente primero — el orden en que las lee el tab Notas. */
  notas: NotaReal[];
}

export interface CrearNotaBody {
  ghlContactId: string;
  texto: string;
  /** Nombre visible. Sin él, el servidor la firma con el closer por defecto. */
  autor?: string;
  /** Píldora del Avanzar, cuando la nota nace de uno. */
  contexto?: string;
}

export interface CrearNotaResponse {
  ok: boolean;
  /**
   * La fila YA escrita, con el `id` y el `creadoEl` REALES de la base. La vista la agrega a la
   * lista sin repetir el GET, y sin inventar una fecha del browser que después no coincidiría
   * con la que devuelve el servidor al recargar.
   */
  nota: NotaReal;
}

/** Las notas de un contacto, la más reciente primero. */
export function fetchNotas(ghlContactId: string): Promise<NotasResponse> {
  return pedir<NotasResponse>(porContacto(`/api/closer/notas`, ghlContactId));
}

/**
 * Agrega una nota. Responde 201 con la fila escrita.
 *
 * Lanza si el servidor la rechaza (texto vacío, contacto faltante). Que lance es el punto:
 * quien llama NO puede pintar la nota en la lista hasta que esto resuelva, o estaría mostrando
 * como guardado algo que no se guardó.
 */
export function crearNota(body: CrearNotaBody): Promise<CrearNotaResponse> {
  return pedir<CrearNotaResponse>(`/api/closer/notas`, conJson(body));
}

/**
 * Borra una nota por su id REAL (el uuid de `closer_notas`, no el id numérico de la vista).
 * Lanza si el servidor la rechaza (id inexistente → 404) — quien llama decide si restaurar
 * la nota en pantalla.
 */
export function eliminarNota(id: string): Promise<{ ok: boolean; id: string }> {
  return pedir(`/api/closer/notas?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

/**
 * Borra un lead de LA PLATAFORMA (fila de `closer_contactos` + todo su rastro en Supabase).
 * GHL no se toca — el contacto sigue intacto allá, y puede volver a darse de alta si agenda
 * una cita nueva (el webhook/cron lo re-crea por upsert, §51.3).
 */
export function eliminarContacto(ghlContactId: string): Promise<{ ok: boolean; existia: boolean }> {
  return pedir(porContacto(`/api/closer/contactos`, ghlContactId), { method: "DELETE" });
}

/* ================================================================== */
/* Historial del contacto (tab Historial)                              */
/* ================================================================== */

/**
 * Un evento del timeline. Solo lectura: la tabla es append-only y la escriben los casos de uso
 * (registrar un seguimiento, un webhook de GHL), nunca una persona — por eso no hay `POST`.
 *
 * `texto` viene resuelto del servidor a propósito ("Toque 2 de 3 enviado"): recomponerlo en el
 * front duplicaría la lógica del caso de uso que lo generó. Lo que NO viene armado es la fecha
 * ni el autor: agrupar por día, decir "hace 2h" o elegir el ícono según `tipo` es de la vista.
 */
export interface EventoHistorial {
  id: number;
  ghlContactId: string;
  /** Seguimiento que originó el evento, o `null` si no vino de uno. */
  seguimientoId: string | null;
  tipo: string;
  texto: string;
  autor: string;
  /** `sistema` obliga a que `autor` sea `"Sistema"` — es un CHECK en la base, no una convención. */
  autorTipo: "sistema" | "usuario" | "contacto";
  autorUsuarioId: string | null;
  /** Datos del evento. `unknown` y no `any`: quien lo lea tiene que estrechar el tipo. */
  payload: Record<string, unknown>;
  /** Cuándo PASÓ (ISO). Es el que ordena el timeline. */
  ocurrioEl: string;
  /** Cuándo se registró (ISO). Difiere de `ocurrioEl` cuando un webhook llega tarde. */
  creadoEl: string;
}

export interface HistorialResponse {
  ok: boolean;
  ghlContactId: string;
  count: number;
  /** Lo más reciente primero. */
  eventos: EventoHistorial[];
}

/** El historial de un contacto. No hay escritura: el timeline es inmutable (§7). */
export function fetchHistorial(ghlContactId: string): Promise<HistorialResponse> {
  return pedir<HistorialResponse>(porContacto(`/api/closer/historial`, ghlContactId));
}

/* ================================================================== */
/* Plantillas de WhatsApp (fuera de la ventana de 24 h)                */
/* ================================================================== */

export interface PlantillaWhatsapp {
  id: string;
  nombre: string;
  descripcion: string | null;
  idioma: string | null;
  /** El texto aprobado por Meta, con sus `{{1}}`. Es para MOSTRAR, no se manda. */
  cuerpo: string;
}

export interface PlantillasResponse {
  ok: boolean;
  count: number;
  plantillas: PlantillaWhatsapp[];
}

export interface EnviarPlantillaResponse {
  ok: boolean;
  /** `true` solo si el mensaje ya salió. El camino por workflow devuelve `encolado`. */
  enviado?: boolean;
  encolado?: boolean;
  metodo?: "template_id" | "workflow";
  plantilla?: string;
  messageId?: string;
  aviso?: string;
  codigo?: string;
  error?: string;
}

/**
 * Las plantillas aprobadas que se pueden mandar. Se cargan a mano en `closer_plantillas`
 * porque la API de GHL **no las lista** (medido el 2026-08-06 — ver `api/closer/plantillas.ts`).
 */
export function fetchPlantillas(): Promise<PlantillasResponse> {
  return pedir<PlantillasResponse>(`/api/closer/plantillas`);
}

/** Manda una plantilla. El cuerpo lo resuelve el servidor a partir del `id`. */
export function enviarPlantilla(contactId: string, plantillaId: string): Promise<EnviarPlantillaResponse> {
  return pedir<EnviarPlantillaResponse>(`/api/closer/plantillas`, conJson({ contactId, plantillaId }));
}

/* ================================================================== */
/* Llamadas del contacto (tab Llamada)                                 */
/* ================================================================== */

/**
 * Estructuralmente idéntico a `CallRecord` de `closerStore.tsx`, y redeclarado igual que
 * `PerfilGrupo` — pero acá no es solo convención: `closerStore` importa de este archivo, así
 * que importar de vuelta sería un ciclo. Al ser idénticos, la lista se le pasa al tab tal
 * cual, sin mapear nada.
 */
export interface LlamadaApi {
  id: string;
  origin: "sales_call" | "app_flow_voz" | "lead_flow_voz" | "voz_ia";
  fecha: string;
  duracion: string;
  contestada: boolean;
  resultado?: string;
  resumenIA?: string;
  sentimiento?: "positivo" | "neutral" | "negativo";
  audioUrl?: string;
}

export interface LlamadasResponse {
  ok: boolean;
  ghlContactId: string;
  count: number;
  /** Más reciente primero — `callsIASummary` toma la primera como "último resultado". */
  llamadas: LlamadaApi[];
}

/**
 * Las llamadas de los agentes de voz. Solo lectura: las registra el agente que las hizo.
 *
 * La fuente es el webhook de Assistable (2026-08-06); antes de eso el tab Llamada existía
 * pero nunca recibía una fila.
 */
export function fetchLlamadas(ghlContactId: string): Promise<LlamadasResponse> {
  return pedir<LlamadasResponse>(porContacto(`/api/closer/llamadas`, ghlContactId));
}

/* ================================================================== */
/* Perfil del contacto (tab Perfil)                                    */
/* ================================================================== */

/**
 * Los grupos del tab Perfil. Mismos literales que `PerfilGroup`/`PerfilFormulario` en
 * `closerStore.tsx` — deliberadamente redeclarados y no importados: este archivo es el
 * contrato con el servidor y no depende de los tipos de vista. Al ser idénticos, un
 * `PerfilCampo[]` se le pasa tal cual a `PerfilTab` sin mapear nada.
 */
export type PerfilGrupo = "detalles" | "origen" | "calificacion" | "interacciones";

/**
 * De qué formulario salió el campo. Solo aplica dentro de `calificacion`: las preguntas de
 * etapa/objetivo/obstáculo existen DUPLICADAS en GHL a propósito (una por form) y el Perfil las
 * muestra en bloques separados — no unificar (contrato §4).
 */
export type PerfilFormularioOrigen = "vsl" | "meta";

export interface PerfilCampo {
  label: string;
  value: string;
  group: PerfilGrupo;
  formulario?: PerfilFormularioOrigen;
  /** Micro-label de procedencia ("vía agente IA"). No decide el grupo, solo informa. */
  procedencia?: string;
}

export interface PerfilResponse {
  ok: boolean;
  ghlContactId: string;
  /**
   * Solo los campos CON valor: un custom field vacío de GHL no llega, porque sin dato el
   * elemento no se renderiza (§4.10). Array vacío = el contacto no tiene nada cargado, y el
   * tab muestra su estado vacío.
   */
  campos: PerfilCampo[];
  count?: number;
  aviso?: string;
}

/**
 * El perfil real de un contacto, ya agrupado por significado.
 *
 * OJO: `api/closer/perfil.ts` todavía no existe (lo está escribiendo otro agente) y el
 * contrato que llegó acá solo fijaba la URL. `campos` es el nombre asumido para la lista; si
 * el endpoint termina llamándola distinto, este tipo es lo único que hay que corregir.
 */
export function fetchPerfil(ghlContactId: string): Promise<PerfilResponse> {
  return pedir<PerfilResponse>(porContacto(`/api/closer/perfil`, ghlContactId));
}

/* ================================================================== */
/* Conexiones (Ajustes > credenciales)                                 */
/* ================================================================== */

export type ConexionCampo = "anthropicApiKey" | "ghlPit" | "ghlLocationId" | "ghlCalendarId" | "claudeModel";

/**
 * De dónde sale hoy la credencial.
 *
 * `entorno` NO es lo mismo que `ninguno`: la app funciona perfectamente contra las variables de
 * Vercel, solo que cambiarlas exige un deploy. Mostrar "no configurada" en ese caso es el único
 * malentendido que este campo existe para evitar.
 */
export type OrigenCredencial = "base" | "entorno" | "ninguno";

/**
 * Estado de una credencial SECRETA.
 *
 * **No tiene `valor`, y esa ausencia es el punto.** El endpoint nunca devuelve el valor entero
 * de un secreto —la consulta selecciona solo las columnas `*_ultimos4`, así que el completo ni
 * siquiera entra al proceso del servidor— y el tipo replica esa garantía acá: `credenciales
 * .ghlPit.valor` no compila, con lo cual ningún componente puede pedirlo por accidente ni
 * "por si acaso". No es una precaución genérica: la app renderiza conversaciones de GHL en el
 * mismo origen, así que todo lo que llega al browser hay que darlo por leíble, y un PIT
 * filtrado es la subcuenta entera del cliente.
 *
 * (En el JSON el campo llega igual, con `null`. Se omite del tipo a propósito: leerlo no
 * aportaría nada y declararlo invitaría a intentarlo.)
 */
export interface EstadoSecreto {
  configurada: boolean;
  /** Últimos 4 caracteres. `null` si no está configurada, o si sale del entorno. */
  ultimos4: string | null;
  origen: OrigenCredencial;
}

/**
 * Estado del único campo que NO es un secreto: el id del modelo (`claude-opus-5`). Es un
 * identificador público y la UI necesita mostrar cuál está puesto, así que este sí trae `valor`
 * entero — y por lo mismo el servidor rechaza que le peguen una key ahí.
 */
export interface EstadoModelo {
  configurada: boolean;
  valor: string | null;
  origen: OrigenCredencial;
}

/**
 * Campo por campo y no `Record<ConexionCampo, ...>`: es lo que permite que los cuatro secretos
 * y el modelo tengan tipos distintos, que es toda la razón de la separación de arriba.
 */
export interface Credenciales {
  anthropicApiKey: EstadoSecreto;
  ghlPit: EstadoSecreto;
  ghlLocationId: EstadoSecreto;
  ghlCalendarId: EstadoSecreto;
  claudeModel: EstadoModelo;
}

export interface ConexionesResponse {
  ok: boolean;
  /** ISO de la última escritura, o `null` si nunca se guardó nada en la base. */
  actualizadoEl: string | null;
  credenciales: Credenciales;
}

export interface GuardarConexionesResponse extends ConexionesResponse {
  /** Qué campos se escribieron REALMENTE, releídos de la base después del guardado. */
  guardados: ConexionCampo[];
}

export interface BorrarConexionResponse extends ConexionesResponse {
  campo: ConexionCampo;
  /** `false` = no había nada guardado que borrar. Ver `motivo` antes de decir "listo". */
  borrado: boolean;
  /** Explicación cuando `borrado` es `false` (ej. la credencial vive en el entorno). */
  motivo?: string;
}

/**
 * Los campos a guardar. Los ausentes NO se tocan: el servidor arma el `on conflict do update`
 * solo con lo que viaja.
 *
 * Un `""` NO borra — el servidor lo rechaza con 400 a propósito, para que guardar la pantalla
 * de Ajustes con un input vacío no deje la app sin PIT. Borrar es `borrarConexion()`.
 */
export type GuardarConexionesBody = Partial<Record<ConexionCampo, string>>;

/** Estado de cada credencial. De los secretos, como mucho los últimos 4. */
export function fetchConexiones(): Promise<ConexionesResponse> {
  return pedir<ConexionesResponse>(`/api/closer/conexiones`);
}

/** Guarda los campos que vengan. Devuelve el estado releído de la base, no lo que se creyó guardar. */
export function guardarConexiones(body: GuardarConexionesBody): Promise<GuardarConexionesResponse> {
  return pedir<GuardarConexionesResponse>(`/api/closer/conexiones`, conJson(body));
}

/**
 * Borra una credencial puntual.
 *
 * Va por querystring y no por cuerpo: el handler acepta las dos formas, pero que un DELETE con
 * body llegue parseado depende del parser de la plataforma, y eso no se controla desde acá. El
 * nombre del campo es un literal de la unión, no un dato del usuario — igual se escapa.
 */
export function borrarConexion(campo: ConexionCampo): Promise<BorrarConexionResponse> {
  return pedir<BorrarConexionResponse>(`/api/closer/conexiones?campo=${encodeURIComponent(campo)}`, {
    method: "DELETE",
  });
}

/* ================================================================== */
/* Autenticación (ESPEC-MULTIEMPRESA §3 y §4)                          */
/* ================================================================== */

export type Rol = "super_admin" | "admin" | "closer" | "setter" | "tecnico" | "media_buyer";

export type Tema = "claro" | "oscuro";

export interface UsuarioSesion {
  id: string;
  nombre: string;
  email: string | null;
  roles: Rol[];
  esSuperAdmin: boolean;
  debeCambiarPassword: boolean;
  /** `null` = nunca eligió. No es lo mismo que haber elegido claro. */
  tema: Tema | null;
}

export interface EmpresaSesion {
  id: string;
  nombre: string | null;
  slug: string | null;
  esPrincipal: boolean;
}

export interface SesionResponse {
  ok: boolean;
  autenticado: boolean;
  usuario?: UsuarioSesion;
  empresa?: EmpresaSesion | null;
  /** El super admin está mirando una empresa que no es la suya: la UI muestra un banner (§7.1). */
  mirandoOtraEmpresa?: boolean;
}

/**
 * Quién soy. **No usa `pedir`**: éste es el único endpoint que tiene que poder contestar
 * "no hay sesión" sin que eso dispare el evento de sesión vencida — si lo hiciera, la propia
 * comprobación de arranque entraría en un bucle con el store que la escucha.
 */
export async function fetchSesion(): Promise<SesionResponse> {
  const res = await fetch("/api/auth/sesion", { credentials: "same-origin" });
  if (!res.ok) return { ok: false, autenticado: false };
  return (await res.json()) as SesionResponse;
}

export interface LoginResponse {
  ok: boolean;
  usuario?: { id: string; nombre: string; email: string; roles: Rol[]; orgId: string; debeCambiarPassword: boolean };
  codigo?: string;
  error?: string;
}

/**
 * Entrar. Devuelve el cuerpo aunque falle, en vez de lanzar: el 401 acá es **la respuesta
 * esperada** de una contraseña incorrecta, no un error de la aplicación, y la pantalla
 * necesita el mensaje para mostrarlo.
 */
export async function login(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return (await res.json().catch(() => ({ ok: false, error: "El servidor no respondió." }))) as LoginResponse;
}

export async function logout(): Promise<void> {
  await fetch("/api/auth/sesion", { method: "DELETE", credentials: "same-origin" }).catch(() => {});
}

export interface CambioPasswordResponse {
  ok: boolean;
  codigo?: string;
  error?: string;
}

/**
 * Guarda la preferencia de tema del usuario de la sesión.
 *
 * Devuelve el cuerpo en vez de lanzar: si falla, el tema ya se aplicó localmente y lo único
 * que se pierde es que sobreviva a la próxima sesión. No es motivo para tirarle un error
 * encima a alguien que apretó un botón de luz.
 */
export async function guardarTema(tema: Tema): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/api/auth/sesion?accion=tema", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tema }),
  });
  return (await res.json().catch(() => ({ ok: false, error: "El servidor no respondió." }))) as {
    ok: boolean;
    error?: string;
  };
}

/** Cambia la contraseña. Cierra todas las demás sesiones y renueva la propia. */
export async function cambiarPassword(actual: string, nueva: string): Promise<CambioPasswordResponse> {
  const res = await fetch("/api/auth/sesion", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ actual, nueva }),
  });
  return (await res.json().catch(() => ({ ok: false, error: "El servidor no respondió." }))) as CambioPasswordResponse;
}

/* ================================================================== */
/* Administración (ESPEC-MULTIEMPRESA §7)                              */
/* ================================================================== */

/**
 * Los tres endpoints de `/api/admin/*` **no usan `pedir`**, y no es una omisión.
 *
 * `pedir` lanza en cualquier respuesta que no sea 2xx, y acá los 4xx son la parte interesante:
 * "ya existe una empresa con ese identificador", "ese usuario tiene historial, desactivalo".
 * Son mensajes escritos para que el admin los lea y decida, no fallas de la aplicación. Con
 * `pedir` llegarían como un `Error` con el texto adentro y cada pantalla tendría que
 * desarmarlo.
 *
 * El 401 sigue disparando el evento de sesión vencida: eso sí es un cambio de estado global.
 */
async function pedirAdmin<T extends { ok: boolean }>(ruta: string, init?: RequestInit): Promise<T> {
  const res = await fetch(ruta, { credentials: "same-origin", ...init });

  if (res.status === 401) {
    window.dispatchEvent(new CustomEvent(EVENTO_SIN_SESION));
    return { ok: false, error: "Tu sesión venció. Volvé a entrar." } as unknown as T;
  }

  const cuerpo = (await res.json().catch(() => null)) as T | null;
  // Sin cuerpo JSON no se puede decir qué pasó: se dice eso, y no un "ok" inventado.
  if (!cuerpo) return { ok: false, error: `El servidor respondió ${res.status} sin explicación.` } as unknown as T;
  return cuerpo;
}

/* ── §7.1 · Empresas ── */

export interface EmpresaAdmin {
  id: string;
  nombre: string;
  slug: string;
  esPrincipal: boolean;
  activa: boolean;
  zonaHoraria: string | null;
  /** Solo los últimos 4 caracteres, y `null` si la empresa todavía no tiene subcuenta. */
  ghlLocationId: string | null;
  creadoEl: string;
  usuarios: number;
  /** `null` = nadie entró nunca. No es lo mismo que una fecha vieja. */
  ultimoAcceso: string | null;
}

export interface EmpresasResponse {
  ok: boolean;
  count?: number;
  empresas?: EmpresaAdmin[];
  error?: string;
}

export interface RespuestaAdmin {
  ok: boolean;
  codigo?: string;
  error?: string;
}

export function fetchEmpresas(): Promise<EmpresasResponse> {
  return pedirAdmin<EmpresasResponse>("/api/admin/empresas");
}

export function crearEmpresa(body: { nombre: string; slug: string; zonaHoraria: string }): Promise<RespuestaAdmin> {
  return pedirAdmin<RespuestaAdmin>("/api/admin/empresas", conJson(body));
}

export function editarEmpresa(
  body: { orgId: string; nombre?: string; activa?: boolean; zonaHoraria?: string },
): Promise<RespuestaAdmin> {
  return pedirAdmin<RespuestaAdmin>("/api/admin/empresas", { ...conJson(body), method: "PATCH" });
}

/** Baja lógica (`activa = false`). El borrado real no existe a propósito — ver §7.1. */
export function desactivarEmpresa(orgId: string): Promise<RespuestaAdmin> {
  return pedirAdmin<RespuestaAdmin>(`/api/admin/empresas?orgId=${encodeURIComponent(orgId)}`, { method: "DELETE" });
}

/* ── §7.2 · Usuarios ── */

export interface UsuarioAdmin {
  id: string;
  orgId: string;
  nombre: string;
  email: string | null;
  roles: Rol[];
  activo: boolean;
  esAdminPrincipal: boolean;
  debeCambiarPassword: boolean;
  bloqueado: boolean;
  ultimoAcceso: string | null;
  creadoEl: string;
}

export interface UsuariosResponse {
  ok: boolean;
  count?: number;
  usuarios?: UsuarioAdmin[];
  /** Qué roles puede otorgar QUIEN PREGUNTA. El selector se arma con esto, no con una lista fija. */
  rolesQuePuedeOtorgar?: Rol[];
  error?: string;
}

/** La contraseña temporal viaja una sola vez, en la respuesta. Después solo existe su hash. */
export interface AltaUsuarioResponse extends RespuestaAdmin {
  usuario?: { id: string; email: string; nombre: string; roles: Rol[] };
  passwordTemporal?: string;
  aviso?: string;
}

export function fetchUsuariosAdmin(): Promise<UsuariosResponse> {
  return pedirAdmin<UsuariosResponse>("/api/admin/usuarios");
}

export function crearUsuario(body: {
  nombre: string;
  email: string;
  roles: Rol[];
  orgId?: string;
}): Promise<AltaUsuarioResponse> {
  return pedirAdmin<AltaUsuarioResponse>("/api/admin/usuarios", conJson(body));
}

export function editarUsuario(body: {
  id: string;
  nombre?: string;
  activo?: boolean;
  roles?: Rol[];
}): Promise<RespuestaAdmin> {
  return pedirAdmin<RespuestaAdmin>("/api/admin/usuarios", { ...conJson(body), method: "PATCH" });
}

export function regenerarPassword(id: string): Promise<AltaUsuarioResponse> {
  return pedirAdmin<AltaUsuarioResponse>("/api/admin/usuarios?accion=regenerar-password", conJson({ id }));
}

export function eliminarUsuario(id: string): Promise<RespuestaAdmin> {
  return pedirAdmin<RespuestaAdmin>(`/api/admin/usuarios?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}

/* ── §7.3 · Configuración y credenciales ── */

export interface CredencialAdmin {
  clave: string;
  etiqueta: string;
  cifrado: boolean;
  /**
   * Tres valores con tres significados distintos: la máscara (`••••1234`), `null` si no hay
   * credencial cargada, y `"error"` si está cargada pero no se pudo descifrar. La UI los
   * distingue — confundir los dos últimos manda a arreglar el problema equivocado.
   */
  valor: string | null;
  cargada: boolean;
}

export interface PromptAdmin {
  clave: string;
  agente: string;
  texto: string;
  hash: string | null;
  lineas: number;
}

export interface ConfiguracionResponse {
  ok: boolean;
  empresa?: { id: string; nombre: string; slug: string; esPrincipal: boolean; activa: boolean; zonaHoraria: string };
  credenciales?: CredencialAdmin[];
  auditor?: { modelo: string | null; thinking: string | null; modeloPorDefecto: string; thinkingPorDefecto: string };
  prompts?: PromptAdmin[];
  /** Sin clave maestra en el servidor no se puede guardar nada cifrado. */
  puedeGuardarCifrado?: boolean;
  error?: string;
}

export function fetchConfiguracion(orgId?: string): Promise<ConfiguracionResponse> {
  const q = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
  return pedirAdmin<ConfiguracionResponse>(`/api/admin/configuracion${q}`);
}

/**
 * Guarda. Las claves que no se mandan —o que se mandan vacías— **no se tocan**: es lo que
 * permite editar una credencial sin reescribir las otras siete. Para borrar una hay que
 * nombrarla en `borrar`.
 */
export function guardarConfiguracion(body: Record<string, unknown>): Promise<RespuestaAdmin> {
  return pedirAdmin<RespuestaAdmin>("/api/admin/configuracion", conJson(body));
}

/* ── §7.1 · El selector de empresa del super admin ── */

/** `null` vuelve a la empresa propia. Queda registrado en auditoría. */
export function cambiarEmpresaActiva(orgId: string | null): Promise<RespuestaAdmin & { empresaActiva?: string }> {
  return pedirAdmin<RespuestaAdmin & { empresaActiva?: string }>("/api/auth/sesion", {
    ...conJson({ orgId }),
    method: "PATCH",
  });
}
