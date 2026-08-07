/**
 * Las credenciales de cada empresa (ESPEC-MULTIEMPRESA §5.2).
 *
 * **Módulo único de resolución.** Nadie más decide de dónde sale un PIT: si mañana cambia una
 * regla de fallback, se cambia acá.
 *
 * ── El contexto por request, y por qué no una variable de módulo ──────
 *
 * Catorce sitios del proyecto leen `env.ghlApiKey()` de forma **síncrona**, dentro de
 * `headers()` de `real.ts` y compañía. Hacerlos `async` habría obligado a propagar `await`
 * por toda la capa de GHL y sus llamadores.
 *
 * La salida es la que el propio código ya había anticipado en `conexiones.ts:443`: resolver
 * las credenciales una vez por request y dejar que los getters lean de ahí. Con la advertencia
 * que ese mismo comentario dejaba escrita:
 *
 * > *"esa caché tiene que estar keyeada por org_id y no ser una variable suelta — si no, la
 * > instancia atiende a un cliente con las credenciales de otro"*.
 *
 * Por eso **`AsyncLocalStorage` y no una variable de módulo**. Vercel reutiliza instancias
 * calientes entre requests concurrentes: una variable suelta se pisaría entre dos empresas
 * atendidas a la vez, y el síntoma sería que una escribe en la subcuenta de la otra. El
 * almacén asíncrono da un contexto por cadena de ejecución, inmune a ese entrelazado.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { descifrar, hayClaveMaestra } from "./cifrado.js";
import { dbSinScope } from "./db.js";

export interface Credenciales {
  orgId: string;
  esPrincipal: boolean;
  activa: boolean;
  ghlPit: string | null;
  ghlLocationId: string | null;
  ghlWebhookSecret: string | null;
  anthropicKey: string | null;
  anthropicModelo: string;
  anthropicThinking: string;
  assistableToken: string | null;
  assistableCuentaId: string | null;
  metaAdAccountId: string | null;
  metaToken: string | null;
  zonaHoraria: string;
  /** Qué credenciales salieron de una variable de entorno global en vez de la empresa. */
  desdeEntorno: string[];
}

/**
 * Defaults globales del auditor (§5.3). El cambio de `claude-opus-5` a Sonnet se aplica acá:
 * es el único lugar donde vive el default, y cada empresa lo puede pisar con su propia
 * columna sin desplegar.
 */
const MODELO_POR_DEFECTO = "claude-sonnet-5";
const THINKING_POR_DEFECTO = "high";

/** Las columnas de `closer_org_config` que esta resolución necesita. */
interface FilaOrgConfig {
  org_id: string;
  es_principal: boolean | null;
  activa: boolean | null;
  zona_horaria: string | null;
  ghl_location_id: string | null;
  ghl_pit_cifrado: string | null;
  ghl_webhook_secret: string | null;
  anthropic_key_cifrada: string | null;
  anthropic_modelo: string | null;
  anthropic_thinking: string | null;
  assistable_token: string | null;
  assistable_cuenta_id: string | null;
  meta_ad_account_id: string | null;
  meta_token_cifrado: string | null;
}

const almacen = new AsyncLocalStorage<Credenciales>();

/**
 * Caché por instancia. Las credenciales cambian con muy poca frecuencia y leerlas en cada
 * request sería una consulta extra a Supabase por cada llamada a GHL.
 *
 * El TTL corto existe para que una **rotación** tenga efecto sin esperar a que la instancia
 * se enfríe: si alguien reemplaza un PIT filtrado desde el panel, no puede seguir usándose
 * durante media hora.
 */
const TTL_MS = 60_000;
const cache = new Map<string, { valor: Credenciales; vence: number }>();

/** Para los tests y para el panel de administración cuando guarda una credencial nueva. */
export function olvidarCredenciales(orgId?: string): void {
  if (orgId) cache.delete(orgId);
  else cache.clear();
}

/**
 * Descifra tolerando lo que todavía no está cifrado.
 *
 * Durante la transición una columna puede tener el valor en claro —cargado a mano antes de
 * que existiera la clave maestra—. Si no parece un blob nuestro (`iv:tag:datos`) se devuelve
 * tal cual, en vez de lanzar y dejar a la empresa sin operar.
 *
 * Si **sí** parece un blob y falla, se lanza: eso es una clave maestra equivocada, y taparlo
 * produciría llamadas a GHL con un token vacío y un 401 imposible de diagnosticar.
 */
function abrir(valor: string | null): string | null {
  if (!valor) return null;
  const pareceBlob = valor.split(":").length === 3 && hayClaveMaestra();
  return pareceBlob ? descifrar(valor) : valor;
}

/**
 * Resuelve las credenciales de una empresa aplicando la tabla de §5.2.
 *
 * ── El fallback a variables de entorno, y su fecha de vencimiento ─────
 *
 * La especificación dice que el PIT de GHL **no tiene fallback**: si falta, la empresa no
 * opera. Aplicarlo literalmente hoy dejaría a ARIA sin operar, porque su PIT vive en
 * `GHL_PIT` y todavía no se cargó en la base.
 *
 * Así que el fallback existe **solo para la empresa principal**, y es explícito: las variables
 * de entorno globales SON las credenciales de ARIA durante la transición. Una empresa cliente
 * que no tenga la suya no opera, que es exactamente lo que la spec pide — y lo que evita que
 * la empresa B termine escribiendo en la subcuenta de GHL de ARIA.
 *
 * `desdeEntorno` deja registro de qué se resolvió así, para que el diagnóstico lo muestre y
 * esto no se vuelva permanente por olvido.
 */
export async function resolverCredenciales(orgId: string): Promise<Credenciales> {
  const enCache = cache.get(orgId);
  if (enCache && enCache.vence > Date.now()) return enCache.valor;

  // Sin scope: esta consulta resuelve la configuración DE una organización, así que el filtro
  // por organización es su propio argumento. Es el caso que la escotilla existe para cubrir.
  const { data, error } = await dbSinScope()
    .from("closer_org_config")
    .select(
      "org_id, es_principal, activa, zona_horaria, ghl_location_id, ghl_pit_cifrado, ghl_webhook_secret, " +
        "anthropic_key_cifrada, anthropic_modelo, anthropic_thinking, assistable_token, assistable_cuenta_id, " +
        "meta_ad_account_id, meta_token_cifrado",
    )
    .eq("org_id", orgId)
    .maybeSingle();

  if (error) throw new Error(`No se pudieron leer las credenciales de la organización: ${error.message}`);
  if (!data) throw new Error(`La organización ${orgId} no existe en closer_org_config.`);

  /**
   * El `select` va armado por concatenación para que quepa legible, y eso le impide a
   * supabase-js inferir la forma de la fila. Se declara acá, que además deja el contrato de
   * columnas en un solo lugar visible.
   */
  const fila = data as unknown as FilaOrgConfig;
  const esPrincipal = Boolean(fila.es_principal);
  const desdeEntorno: string[] = [];

  /** Toma la de la empresa; si no hay y es la principal, cae a la global y lo anota. */
  const conFallbackPrincipal = (
    deLaEmpresa: string | null,
    variable: string | undefined,
    nombre: string,
  ): string | null => {
    if (deLaEmpresa) return deLaEmpresa;
    if (esPrincipal && variable) {
      desdeEntorno.push(nombre);
      return variable;
    }
    return null;
  };

  const valor: Credenciales = {
    orgId: fila.org_id as string,
    esPrincipal,
    activa: Boolean(fila.activa),
    zonaHoraria: (fila.zona_horaria as string) || "America/Lima",

    ghlPit: conFallbackPrincipal(
      abrir(fila.ghl_pit_cifrado as string | null),
      process.env.GHL_PIT ?? process.env.GHL_API_KEY,
      "GHL_PIT",
    ),
    ghlLocationId: conFallbackPrincipal(
      (fila.ghl_location_id as string | null) ?? null,
      process.env.GHL_LOCATION_ID,
      "GHL_LOCATION_ID",
    ),
    ghlWebhookSecret: conFallbackPrincipal(
      (fila.ghl_webhook_secret as string | null) ?? null,
      process.env.WEBHOOK_SECRET,
      "WEBHOOK_SECRET",
    ),

    /**
     * Anthropic es la ÚNICA con fallback global para todas las empresas (§5.2), y es
     * transitorio: *"cuando todas las empresas tengan la suya, se elimina el fallback y se
     * pasa a error explícito"*. Se distingue de las demás porque una key de Anthropic no da
     * acceso a datos de nadie — solo gasta créditos nuestros.
     */
    anthropicKey: abrir(fila.anthropic_key_cifrada as string | null) ?? (() => {
      if (process.env.ANTHROPIC_API_KEY) desdeEntorno.push("ANTHROPIC_API_KEY");
      return process.env.ANTHROPIC_API_KEY ?? null;
    })(),
    anthropicModelo: (fila.anthropic_modelo as string | null) || process.env.CLAUDE_MODEL || MODELO_POR_DEFECTO,
    anthropicThinking: (fila.anthropic_thinking as string | null) || process.env.AUDITOR_EFFORT || THINKING_POR_DEFECTO,

    // Sin fallback, ni siquiera para la principal: nunca existieron como variables globales,
    // así que un fallback acá sería inventar una fuente.
    assistableToken: (fila.assistable_token as string | null) ?? null,
    assistableCuentaId: (fila.assistable_cuenta_id as string | null) ?? null,
    metaAdAccountId: (fila.meta_ad_account_id as string | null) ?? null,
    metaToken: abrir(fila.meta_token_cifrado as string | null),

    desdeEntorno,
  };

  cache.set(orgId, { valor, vence: Date.now() + TTL_MS });
  return valor;
}

/**
 * Deja las credenciales disponibles para el resto del request. **Síncrona, y tiene que serlo.**
 *
 * ── La semántica de AsyncLocalStorage que decide este diseño ───────────
 *
 * `enterWith` fija el contexto de la cadena de ejecución ACTUAL. Medido en Node 24:
 *
 *   · Llamado DENTRO de una función `async` que el handler espera → **no llega al handler**.
 *     El contexto muere con la continuación de esa función. Dos handlers en paralelo leen
 *     `undefined`.
 *   · Llamado en el scope del propio handler → funciona, y **no se pisa entre requests
 *     concurrentes** de la misma instancia.
 *
 * Por eso `exigir()` resuelve las credenciales (asíncrono, una consulta) y el handler las
 * activa con esta llamada síncrona. Es una línea más por endpoint, y a cambio el contexto es
 * correcto bajo la concurrencia de Fluid Compute — que es donde una variable de módulo haría
 * que una empresa escriba en la subcuenta de GHL de otra.
 *
 * `api/_lib/aislamiento.test.ts` falla si un endpoint llama a `exigir` y se olvida de esto.
 */
export function activar(cred: Credenciales): void {
  almacen.enterWith(cred);
}

/** Las de la organización activa, o `null` fuera de un request con contexto (crons, tests). */
export function credencialesActivas(): Credenciales | null {
  return almacen.getStore() ?? null;
}

/**
 * Para los caminos de máquina —el cron, los webhooks— que resuelven la empresa por su cuenta
 * y no pasan por `exigir()`.
 */
export function conCredenciales<T>(cred: Credenciales, fn: () => Promise<T>): Promise<T> {
  return almacen.run(cred, fn);
}

/** Todas las empresas activas. Lo usa el cron de §6.2 para recorrerlas. */
export async function organizacionesActivas(): Promise<string[]> {
  const { data, error } = await dbSinScope()
    .from("closer_org_config")
    .select("org_id")
    .eq("activa", true)
    .order("es_principal", { ascending: false });

  if (error) throw new Error(`No se pudieron listar las organizaciones: ${error.message}`);
  return ((data ?? []) as { org_id: string }[]).map((o) => o.org_id);
}
