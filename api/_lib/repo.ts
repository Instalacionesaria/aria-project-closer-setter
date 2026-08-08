/**
 * Acceso a las tablas `closer_*` de SOFIA.
 *
 * Usa la `service_role`, que salta el RLS. Es correcto porque estas tablas no tienen
 * políticas: el único camino de entrada es este archivo, desde funciones de servidor.
 * El browser nunca las toca.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { credencialesActivas } from "./credenciales.js";
import { db as dbScopeado } from "./db.js";

/**
 * El cliente, **ya atado a la organización** (ESPEC-MULTIEMPRESA §2.4, capa 1).
 *
 * Este `db()` sin argumentos existe para que los 94 puntos de acceso del proyecto no tuvieran
 * que cambiar: por dentro delega en `db(orgId)` de `./db.js`, que inyecta `.eq("org_id", …)`
 * en todo select/update/delete y agrega `org_id` en todo insert/upsert. O sea que **el scoping
 * está activo en todas las consultas** sin haber editado ninguna.
 *
 * El `createClient` se mudó a `./db.ts`, que es ahora el único archivo autorizado a crearlo
 * (lo verifica `aislamiento.test.ts`).
 *
 * ── La organización sale del contexto (2026-08-07) ────────────────────
 *
 * Hasta hoy esto decía `dbScopeado(ORG_ID)` con la constante de ARIA, y era la deuda que este
 * mismo comentario anunciaba desde la fase 1. Mientras hubo una sola empresa daba la respuesta
 * correcta; con dos, el resultado no era "no anda" sino algo peor — el tick de un usuario de la
 * empresa B hablaba con la subcuenta de GHL de B y escribía en las filas de ARIA.
 *
 * Ahora sale de `credencialesActivas()`, que es lo que dejan `activar()` y `conCredenciales()`.
 * **Hoy el valor es idéntico** (con una sola empresa, la activa es ARIA), así que el cambio no
 * mueve nada en producción — lo que mueve es lo que pasa el día que exista la segunda.
 *
 * ── Falla CERRADO ─────────────────────────────────────────────────────
 *
 * Sin contexto activo esto **lanza**, no cae a la empresa principal. Un `?? ORG_ID` habría sido
 * más cómodo y es exactamente el modo de fallar que este proyecto ya se comió una vez con el
 * cron: silencioso, plausible, y descubierto por un cliente. Una consulta sin organización no
 * tiene respuesta correcta — tiene una respuesta peligrosa.
 *
 * El mensaje nombra el arreglo porque el síntoma no lo sugiere: quien lo vea va a estar mirando
 * un endpoint que "dejó de andar", no un problema de credenciales.
 */
export function db(): SupabaseClient {
  const cred = credencialesActivas();
  if (!cred) {
    throw new Error(
      "db() sin empresa activa: nadie llamó a activar(). En un endpoint con sesión va " +
        "activar(ctx.credenciales) después de exigir(); en un camino de máquina, " +
        "activar(await resolverCredenciales(orgId)) o conCredenciales(cred, fn).",
    );
  }
  return dbScopeado(cred.orgId);
}

/** La organización de la empresa activa. Misma regla que `db()`: sin contexto, lanza. */
export function orgActiva(): string {
  const cred = credencialesActivas();
  if (!cred) throw new Error("orgActiva() sin empresa activa: falta activar().");
  return cred.orgId;
}

/* ================================================================== */
/* Outbox                                                              */
/* ================================================================== */

export interface EntradaOutbox {
  ghlContactId: string;
  seguimientoId?: string;
  operacion: "aplicar_tag" | "remover_tag" | "escribir_campo" | "mover_stage";
  args: Record<string, unknown>;
  idempotencyKey: string;
  estado: "pendiente" | "enviado" | "error" | "omitido_stub";
  orgId?: string;
}

/**
 * La empresa **principal** — ARIA. Es la fila que siembran `002_bootstrap.sql` y la `018`.
 *
 * Ya NO significa "la organización": significa "la nuestra". Se dejó exportada porque hay tres
 * usos legítimos —el arranque, las migraciones y el fallback a variables de entorno, que §5.2
 * restringe a propósito solo a esta empresa— pero **no es el valor por defecto de nada**. Si
 * aparece en código nuevo que atiende a un usuario o a un webhook, está mal: la organización
 * sale de `orgActiva()`.
 *
 * Se llamaba `ORG_ID` hasta el 2026-08-07. El nombre viejo era la mitad del problema: leído en
 * un `.eq("org_id", ORG_ID)` parecía "el org_id que corresponda".
 */
export const ORG_PRINCIPAL = "00000000-0000-0000-0000-000000000001";

/**
 * Registra la intención de un efecto en GHL.
 *
 * Un choque de `idempotency_key` NO es un error: significa que este efecto ya se anotó,
 * que es justamente lo que la clave existe para garantizar. Se traga y se sigue.
 */
export async function registrarEnOutbox(e: EntradaOutbox): Promise<void> {
  const { error } = await db()
    .from("closer_ghl_outbox")
    .insert({
      org_id: e.orgId ?? orgActiva(),
      ghl_contact_id: e.ghlContactId,
      seguimiento_id: e.seguimientoId ?? null,
      operacion: e.operacion,
      args: e.args,
      idempotency_key: e.idempotencyKey,
      estado: e.estado,
    });

  if (error && error.code !== "23505") throw new Error(`outbox: ${error.message}`);
}

/* ================================================================== */
/* Notas del contacto                                                  */
/* ================================================================== */

/**
 * Una nota, tal como sale de la base y tal como viaja al front.
 *
 * Campos CRUDOS: la fecha va en ISO y el autor es un nombre suelto. Componer "8 jul · Venta ·
 * Jorge Q." es trabajo de la vista (`CONTRATO-GHL.md` §0 — la presentación es del tool), y si
 * el servidor mandara ese string ya armado la ficha no podría mostrarlo de otra forma en la
 * lista y en el detalle.
 */
export interface Nota {
  id: string;
  ghlContactId: string;
  texto: string;
  /** Píldora del Avanzar que originó la nota, o `null` si fue una nota suelta (§3). */
  contexto: string | null;
  autor: string;
  /**
   * Todavía siempre `null`: no hay sesión, así que no se sabe QUIÉN escribió más allá del
   * nombre. Viaja igual para que el día que exista auth el contrato no cambie.
   */
  autorUsuarioId: string | null;
  creadoEl: string;
}

export interface CrearNotaInput {
  ghlContactId: string;
  texto: string;
  /** Nombre visible. Sin él se firma como `Sistema` — ver `AUTOR_SISTEMA`. */
  autor?: string;
  contexto?: string;
  orgId?: string;
}

/**
 * Con quién se firma una nota que llega **sin autor**.
 *
 * Era `"Jorge Q."`, de cuando no había sesión y el closer era uno solo. Ya la hay: el endpoint de
 * notas pasa `ctx.nombre`, así que llegar sin autor significa que no hubo sesión — un cron, un
 * webhook. Firmar eso con el nombre de una persona es atribuirle a alguien algo que no hizo, y
 * contradice la regla 5 de CLAUDE.md: los eventos automáticos se registran con autor `Sistema`.
 */
export const AUTOR_SISTEMA = "Sistema";

/** Fila cruda de `closer_notas`. Vive acá para que el mapeo snake→camel esté en un solo lado. */
interface FilaNota {
  id: string;
  ghl_contact_id: string;
  texto: string;
  contexto: string | null;
  autor_nombre: string;
  autor_usuario_id: string | null;
  creado_el: string;
}

const COLUMNAS_NOTA = "id, ghl_contact_id, texto, contexto, autor_nombre, autor_usuario_id, creado_el";

const aNota = (f: FilaNota): Nota => ({
  id: f.id,
  ghlContactId: f.ghl_contact_id,
  texto: f.texto,
  contexto: f.contexto,
  autor: f.autor_nombre,
  autorUsuarioId: f.autor_usuario_id,
  creadoEl: iso(f.creado_el),
});

/**
 * Las notas de un contacto, la más reciente primero — el orden en que las lee el tab Notas.
 *
 * Sirve exactamente al índice `closer_notas_contacto_idx (ghl_contact_id, creado_el desc)`.
 */
export async function leerNotas(ghlContactId: string, limite = 100): Promise<Nota[]> {
  const { data, error } = await db()
    .from("closer_notas")
    .select(COLUMNAS_NOTA)
    .eq("ghl_contact_id", ghlContactId)
    .order("creado_el", { ascending: false })
    .limit(limite);

  if (error) throw new Error(`leer notas: ${error.message}`);
  return ((data ?? []) as FilaNota[]).map(aNota);
}

/**
 * Crea una nota y devuelve la fila ya escrita — no un `ok: true` a ciegas.
 *
 * El `texto` se guarda recortado para que coincida con el `check (btrim(texto) <> '')` de la
 * tabla: si se guardara con espacios al borde, la validación de Node y la de la base estarían
 * mirando strings distintos.
 *
 * NO se verifica que el contacto exista en `closer_contactos`: esa tabla es un caché de GHL,
 * truncatable y hoy con 0 filas en producción (los webhooks nunca se crearon — ver la
 * migración 009). Exigirla rechazaría notas legítimas sobre contactos reales. Por eso tampoco
 * hay FK en el esquema: la identidad del contacto la manda GHL, no nuestra proyección.
 */
export async function crearNota(input: CrearNotaInput): Promise<Nota> {
  const { data, error } = await db()
    .from("closer_notas")
    .insert({
      org_id: input.orgId ?? orgActiva(),
      ghl_contact_id: input.ghlContactId,
      texto: input.texto.trim(),
      contexto: input.contexto?.trim() || null,
      autor_nombre: input.autor?.trim() || AUTOR_SISTEMA,
      // Sin sesión no hay a quién apuntar, y poner el closer por defecto acá sería firmar en
      // nombre de alguien que quizá no la escribió.
      autor_usuario_id: null,
    })
    .select(COLUMNAS_NOTA)
    .single();

  if (error) throw new Error(`crear nota: ${error.message}`);
  return aNota(data as FilaNota);
}

/**
 * Borra una nota por id. Devuelve `true` si la fila existía (y se borró), `false` si no —
 * el endpoint convierte ese `false` en 404 en vez de responder un 200 mentiroso sobre algo
 * que nunca estuvo.
 */
export async function eliminarNota(id: string): Promise<boolean> {
  const { data, error } = await db().from("closer_notas").delete().eq("id", id).select("id");

  if (error) throw new Error(`eliminar nota: ${error.message}`);
  return (data ?? []).length > 0;
}

/* ================================================================== */
/* Historial del contacto                                              */
/* ================================================================== */

/**
 * Un evento del timeline. Solo lectura: `closer_contacto_eventos` es append-only y lo escriben
 * los casos de uso (registrar un seguimiento, un webhook de GHL), nunca una persona a mano.
 *
 * `texto` viene ya resuelto de la base a propósito —así lo define la migración 001— porque el
 * front no puede recomponer "Toque 2 de 3 enviado" desde un payload sin duplicar la lógica del
 * caso de uso que lo generó. Lo que NO viaja armado es la fecha ni el autor.
 */
export interface EventoHistorial {
  id: number;
  ghlContactId: string;
  seguimientoId: string | null;
  tipo: string;
  texto: string;
  autor: string;
  autorTipo: "sistema" | "usuario" | "contacto";
  autorUsuarioId: string | null;
  payload: Record<string, unknown>;
  /** Cuándo PASÓ. Es el que ordena el timeline. */
  ocurrioEl: string;
  /** Cuándo se registró. Difiere de `ocurrioEl` cuando un webhook llega tarde. */
  creadoEl: string;
}

interface FilaEvento {
  id: number;
  ghl_contact_id: string;
  seguimiento_id: string | null;
  tipo: string;
  texto: string;
  autor_tipo: string;
  autor_nombre: string;
  autor_usuario_id: string | null;
  payload: Record<string, unknown> | null;
  ocurrio_el: string;
  creado_el: string;
}

const COLUMNAS_EVENTO =
  "id, ghl_contact_id, seguimiento_id, tipo, texto, autor_tipo, autor_nombre, autor_usuario_id, payload, ocurrio_el, creado_el";

/**
 * El historial de un contacto, lo más reciente primero.
 *
 * El desempate por `id desc` no es decorativo: dos eventos del mismo caso de uso pueden caer en
 * el mismo `ocurrio_el` (el default es `now()`, que dentro de una transacción es constante), y
 * sin él el orden entre ellos sería el que quiera Postgres, distinto en cada request. Es
 * además el orden exacto del índice `closer_eventos_timeline_idx`.
 */
export async function leerEventos(ghlContactId: string, limite = 200): Promise<EventoHistorial[]> {
  const { data, error } = await db()
    .from("closer_contacto_eventos")
    .select(COLUMNAS_EVENTO)
    .eq("ghl_contact_id", ghlContactId)
    .order("ocurrio_el", { ascending: false })
    .order("id", { ascending: false })
    .limit(limite);

  if (error) throw new Error(`leer eventos: ${error.message}`);

  return ((data ?? []) as FilaEvento[]).map((f) => ({
    id: f.id,
    ghlContactId: f.ghl_contact_id,
    seguimientoId: f.seguimiento_id,
    tipo: f.tipo,
    texto: f.texto,
    autor: f.autor_nombre,
    autorTipo: f.autor_tipo as EventoHistorial["autorTipo"],
    autorUsuarioId: f.autor_usuario_id,
    payload: f.payload ?? {},
    ocurrioEl: iso(f.ocurrio_el),
    creadoEl: iso(f.creado_el),
  }));
}

/* ================================================================== */
/* Utilidades compartidas por los endpoints                            */
/* ================================================================== */

/**
 * Normaliza a ISO con `Z`. Postgres devuelve `+00:00`, que `new Date()` entiende igual, pero
 * dos formatos para la misma fecha es la clase de diferencia que aparece recién cuando alguien
 * compara strings en el front. Si el valor no fuera una fecha, se devuelve tal cual en vez de
 * romper la lectura entera por una fila.
 */
function iso(valor: string): string {
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? valor : d.toISOString();
}

/**
 * Acota el `limite` que llega por querystring.
 *
 * Sin techo, un `?limite=999999` sobre el historial de un contacto viejo devuelve una respuesta
 * enorme que el browser va a pintar hasta la tercera fila. Un valor ausente, cero, negativo o
 * no numérico cae al default en vez de dar 400: es un parámetro opcional, y fallar por él
 * dejaría al usuario sin sus notas por un detalle que el servidor sabe resolver.
 */
export function acotarLimite(valor: unknown, porDefecto: number, maximo = 500): number {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return porDefecto;
  return Math.min(Math.floor(n), maximo);
}

/* ================================================================== */
/* Diagnóstico                                                         */
/* ================================================================== */

const TABLAS = [
  "closer_org_config",
  "closer_usuarios",
  "closer_seguimientos",
  "closer_contacto_tarea",
  "closer_contacto_eventos",
  "closer_ghl_outbox",
  "closer_webhook_inbox",
  // Las tres de la migración 006. Faltaban acá, así que el diagnóstico decía "esquema ok" sin
  // haber mirado nunca la tabla que sostiene el tab Notas.
  "closer_contactos",
  "closer_notas",
  "closer_evento_tipos",
] as const;

export interface EstadoTabla {
  tabla: string;
  ok: boolean;
  filas?: number;
  error?: string;
}

/** ¿Existen las tablas y se pueden leer con esta credencial? */
export async function verificarEsquema(): Promise<EstadoTabla[]> {
  return Promise.all(
    TABLAS.map(async (tabla): Promise<EstadoTabla> => {
      const { count, error } = await db().from(tabla).select("*", { count: "exact", head: true });
      return error ? { tabla, ok: false, error: error.message } : { tabla, ok: true, filas: count ?? 0 };
    }),
  );
}

/**
 * El "hoy" de la organización, calculado por Postgres — nunca por Node ni por el browser.
 *
 * ── El parámetro no es opcional por comodidad (2026-08-07) ────────────
 *
 * Hasta hoy esto llamaba a `closer_hoy_org()` **sin argumentos**, y Postgres resolvía por
 * aridad a la sobrecarga vieja de la `001`, cuyo cuerpo es `select zona_horaria from
 * closer_org_config limit 1` — sin `where` y sin `order by`. O sea: la zona horaria de *una
 * empresa cualquiera*, la que el planificador devolviera primero.
 *
 * Con una sola fila daba siempre bien. Con cinco, el "hoy" que decide qué seguimientos están
 * vencidos lo elegía el azar. La `020` creó la sobrecarga con `p_org_id` justamente para esto y
 * dejó viva la vieja "hasta desplegar el código que la pasa" — este es ese código.
 *
 * `rpc` es el único método que el Proxy de `db.ts` deja pasar sin tocar (no puede adivinar cómo
 * se llama el parámetro de cada función), así que acá la organización va a mano.
 */
export async function hoyOrg(): Promise<string | null> {
  const { data, error } = await db().rpc("closer_hoy_org", { p_org_id: orgActiva() });
  return error ? null : (data as string);
}
