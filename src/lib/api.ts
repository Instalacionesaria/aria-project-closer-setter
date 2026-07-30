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

/** Error uniforme para todas las llamadas: el status y el detalle del cuerpo, sin ruido. */
async function pedir<T>(ruta: string, init?: RequestInit): Promise<T> {
  const res = await fetch(ruta, init);
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
  opts?: { calendarId?: string; includeCancelled?: boolean },
): Promise<AgendaRangeResponse> {
  const params = new URLSearchParams({ days: String(days) });
  if (opts?.calendarId) params.set("calendarId", opts.calendarId);
  if (opts?.includeCancelled) params.set("includeCancelled", "true");
  return pedir<AgendaRangeResponse>(`/api/closer/agenda?${params.toString()}`);
}

export interface UrgenteReal {
  contactId: string;
  name: string;
  source: string;
  /** El motivo real que dejó el analizador. El prefijo "Falla detectada por IA:" lo pone la vista. */
  fallo: string;
}

/** Contactos con `bot_pausado_fallo` + `zona_closer` → Intervenciones Urgentes del closer. */
export function fetchUrgentes(): Promise<{ count: number; urgentes: UrgenteReal[] }> {
  return pedir(`/api/closer/urgentes`);
}

/**
 * Lo mismo para el SETTER: `bot_pausado_fallo` + `zona_setter`.
 *
 * Son dos endpoints y no uno con parámetro porque los tags de territorio son excluyentes:
 * cada rol pide su cola y no hay forma de que un contacto aparezca en las dos (§11).
 */
export function fetchUrgentesSetter(): Promise<{ count: number; urgentes: UrgenteReal[] }> {
  return pedir(`/api/setter/urgentes`);
}

export interface RespondidoReal {
  contactId: string;
  name: string;
  source: string;
  /** Tag de desenlace: venta_ganada | adelanto_ganado | noshow | seguimiento | nurture_appflow | descalificado. */
  outcome: string;
  snippet: string;
  when: string; // "hace 2h"
}

/** Buzón General del closer: territorio closer + desenlace + último mensaje entrante sin responder. */
export function fetchRespondieron(): Promise<{ count: number; contactos: RespondidoReal[] }> {
  return pedir(`/api/closer/respondieron`);
}

/**
 * Métricas medidas de un agente de TEXTO, para la pestaña Auditoría de Agentes.
 *
 * Todo campo puede venir `null`: significa "todavía no lo medí", y la vista conserva el
 * valor que sembró Francisco en vez de pintar un cero que no midió nadie.
 */
export interface AgenteTextoMetricas {
  id: "lead-flow-ai" | "appointment-flow-ai";
  metric: string | null;
  delta: { text: string; up: boolean } | null;
  subtext: string | null;
  sentiment: { positivos: number; neutrales: number; molestos: number } | null;
  ops: { label: string; value: string | null }[];
  history: { week: string; tasa: number; sentimientoPositivo: number }[];
  /** Cuántos análisis sostienen estos números. 0 = todavía no se midió nada. */
  analisis: number;
}

/** Lo que midieron las dos analizadoras de agentes de texto. Los de voz no salen de acá. */
export function fetchAgentesTexto(): Promise<{ ventanaDias: number; agentes: AgenteTextoMetricas[] }> {
  return pedir(`/api/agentes/texto`);
}

/** Un mensaje real de la conversación de GHL, normalizado para el Chat. */
export interface ConversationMessage {
  id: string;
  text: string;
  outgoing: boolean; // true = saliente (nosotros), false = entrante (el contacto)
  type: string; // TYPE_SMS, TYPE_WHATSAPP, ...
  date: string;
  time: string; // "10:05 AM"
}

export interface ConversationResponse {
  conversationId: string | null;
  count: number;
  messages: ConversationMessage[];
}

/** La conversación real de un contacto, por su `contactId` de GHL. */
export function fetchConversation(contactId: string): Promise<ConversationResponse> {
  return pedir<ConversationResponse>(`/api/closer/conversacion?contactId=${encodeURIComponent(contactId)}`);
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
  tope: { porPagina: number; paginas: number };
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
  /** Devueltos por la búsqueda sin tener `zona_closer` de verdad. Debería ser 0. */
  fueraDeZonaCloser: number;
  cobertura: PipelineCobertura;
  /** Frase del servidor para un humano (ej. falta configuración). Ausente = no hay nada que avisar. */
  aviso?: string;
}

/** Pipeline completo del closer: todos los contactos con `zona_closer`, ya clasificados. */
export function fetchPipeline(): Promise<PipelineResponse> {
  return pedir<PipelineResponse>(`/api/closer/pipeline`);
}

/* ================================================================== */
/* Notas del contacto (tab Notas)                                      */
/* ================================================================== */

/**
 * Una nota real de `closer_notas`. Se llama `NotaReal` para no pisar el `NotaItem` de la
 * semilla en `closerStore.tsx`: son formas distintas y conviven en la misma ficha.
 *
 * Los campos viajan CRUDOS. `creadoEl` es ISO y `autor` un nombre suelto — componer
 * "8 jul · Venta · Diego M." es de la vista, no del servidor.
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
