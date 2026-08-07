/**
 * La capa 1 del aislamiento multi-empresa (ESPEC-MULTIEMPRESA §2.4).
 *
 * **Este es el único archivo del proyecto que puede importar `createClient`.** Un test lo
 * hace cumplir (`api/_lib/aislamiento.test.ts`); sin ese test la regla se erosiona en la
 * primera semana, que es exactamente lo que dice la especificación.
 *
 * ── Qué hace ──────────────────────────────────────────────────────────
 *
 * `db(orgId)` devuelve un cliente de Supabase **atado a una organización**:
 *
 *   - `select`, `update` y `delete` salen con `.eq("org_id", orgId)` ya puesto.
 *   - `insert` y `upsert` reciben `org_id` inyectado en cada fila.
 *
 * Un `select` que se olvide del filtro deja de ser posible: no hay forma de escribir la
 * consulta sin él, porque el filtro no lo pone quien consulta.
 *
 * ── Por qué un Proxy y no un wrapper con métodos propios ──────────────
 *
 * Un wrapper obligaría a reimplementar (y a mantener al día) la superficie entera del
 * `PostgrestQueryBuilder`, y sobre todo **perdería los tipos**: los 94 puntos de acceso que
 * hoy hacen `const { data, error } = await db().from(…).select(…)` dejarían de tipar. El
 * Proxy conserva la firma real del cliente y solo intercepta cinco métodos, así que ni un
 * solo call site tuvo que cambiar para quedar scopeado.
 *
 * ── Lo que NO hace ────────────────────────────────────────────────────
 *
 * `rpc` pasa sin tocar. Las funciones de Postgres reciben la organización como parámetro
 * explícito (`p_org_id`) desde la 020: inyectarla acá encima sería adivinar el nombre del
 * argumento de cada una.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/**
 * Tablas que NO llevan clave de inquilino y por lo tanto no se scopean.
 *
 * `closer_evento_tipos` son 17 filas de vocabulario del sistema (`seguimiento_creado`,
 * `mensaje_entrante`…), compartido entre todas las empresas. Filtrarlo por organización
 * devolvería cero filas siempre.
 *
 * Esta lista es deliberadamente corta y cada entrada necesita justificarse: una tabla acá
 * adentro es una tabla sin aislamiento.
 */
const TABLAS_COMPARTIDAS = new Set<string>(["closer_evento_tipos"]);

/** El cliente crudo. Singleton: en una función serverless dura lo que la instancia caliente. */
let crudo: SupabaseClient | null = null;

function clienteCrudo(): SupabaseClient {
  if (!crudo) {
    crudo = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return crudo;
}

/**
 * Inyecta `org_id` en una fila o en un array de filas.
 *
 * **Pisa el valor que venga**, y es a propósito: si un handler compone una fila con un
 * `org_id` distinto al de su sesión —por un bug, o porque el id vino del cuerpo del
 * request— la escritura tiene que ir igual a la organización que corresponde. Ante la duda
 * gana la opción que hace más difícil escribir en los datos de otra empresa (§0).
 *
 * **La única excepción es un `org_id: null` explícito**, que se respeta. Lo necesita
 * `closer_webhook_inbox` (§6.3): un webhook cuyo `locationId` no corresponde a ninguna
 * empresa se guarda con la organización en null y no se procesa. Ahí el null *significa*
 * algo, así que taparlo sería perder el único dato que tenemos sobre ese evento.
 */
function conOrg<T>(filas: T, orgId: string): T {
  const unaFila = (f: unknown) => {
    if (!f || typeof f !== "object") return f;
    const fila = f as Record<string, unknown>;
    if ("org_id" in fila && fila.org_id === null) return fila;
    return { ...fila, org_id: orgId };
  };
  return (Array.isArray(filas) ? filas.map(unaFila) : unaFila(filas)) as T;
}

/** Los cinco métodos que se interceptan. El resto del builder pasa intacto. */
const CON_FILTRO = new Set(["select", "update", "delete"]);
const CON_INYECCION = new Set(["insert", "upsert"]);

function envolverTabla(builder: unknown, tabla: string, orgId: string): unknown {
  if (TABLAS_COMPARTIDAS.has(tabla)) return builder;

  return new Proxy(builder as object, {
    get(objetivo, prop, receptor) {
      const valor = Reflect.get(objetivo, prop, receptor);
      if (typeof valor !== "function" || typeof prop !== "string") return valor;

      if (CON_FILTRO.has(prop)) {
        // `select(...)`, `update(...)` y `delete(...)` devuelven un filter builder; se le
        // encadena el `.eq` antes de devolvérselo a quien llamó, así su propia cadena de
        // filtros se agrega DESPUÉS y no puede quitar este.
        return (...args: unknown[]) =>
          (valor as (...a: unknown[]) => { eq: (c: string, v: string) => unknown }).apply(objetivo, args).eq("org_id", orgId);
      }

      if (CON_INYECCION.has(prop)) {
        return (filas: unknown, ...resto: unknown[]) =>
          (valor as (...a: unknown[]) => unknown).apply(objetivo, [conOrg(filas, orgId), ...resto]);
      }

      return valor.bind(objetivo);
    },
  });
}

/**
 * El cliente atado a una organización. **Todo acceso a datos pasa por acá.**
 *
 * Hoy el `orgId` siempre es el de ARIA porque todavía no hay sesiones (fase 2 de la
 * especificación). Cuando las haya, el único cambio es de dónde sale el argumento — el
 * scoping ya está puesto en los 94 puntos de acceso.
 */
export function db(orgId: string): SupabaseClient {
  if (!orgId) throw new Error("db(orgId): falta la organización. Ninguna consulta puede correr sin scope.");

  return new Proxy(clienteCrudo(), {
    get(objetivo, prop, receptor) {
      if (prop === "from") {
        return (tabla: string) => envolverTabla(objetivo.from(tabla), tabla, orgId);
      }
      const valor = Reflect.get(objetivo, prop, receptor);
      return typeof valor === "function" ? valor.bind(objetivo) : valor;
    },
  }) as SupabaseClient;
}

/**
 * Escotilla para lo que de verdad no puede scoparse: las migraciones y el diagnóstico que
 * inspeccionan el esquema, y la resolución de la empresa a partir del `locationId` de un
 * webhook —que por definición ocurre ANTES de saber de qué organización se trata—.
 *
 * Cada uso tiene que llevar un comentario diciendo por qué. Si aparece en un handler de
 * negocio, es un bug de aislamiento.
 */
export function dbSinScope(): SupabaseClient {
  return clienteCrudo();
}
