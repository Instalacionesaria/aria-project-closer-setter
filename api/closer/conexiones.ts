/**
 * `/api/closer/conexiones` — las credenciales que hoy son variables de entorno, editables
 * desde Ajustes.
 *
 *   GET    → estado de cada credencial: si está configurada y de dónde sale. De los
 *            secretos, como mucho los últimos 4 caracteres.
 *   POST   → guarda los campos que vengan. Un campo ausente NO borra el guardado.
 *   DELETE → borra una credencial puntual.
 *
 * ── La regla que manda sobre todo lo demás ──
 *
 * **El valor completo de una credencial nunca sale de acá.** No es una precaución genérica:
 * la app renderiza conversaciones de GHL —texto de terceros— en el mismo origen, así que
 * cualquier cosa que llegue al browser hay que darla por leíble. Un PIT filtrado es la
 * subcuenta entera del cliente; una key de Anthropic filtrada la paga el dueño.
 *
 * Eso no se cumple "acordándose de recortar el string". Se cumple porque la consulta que
 * sirve el estado selecciona SOLO las columnas `*_ultimos4` (columnas generadas, migración
 * 010): el valor completo no entra al proceso, con lo cual no puede escaparse por un log,
 * por un error serializado ni por un `select *` que alguien agregue el mes que viene.
 *
 * La única excepción es `claudeModel`, que se devuelve entero — un identificador público
 * (`claude-opus-5`) no es un secreto, y la UI necesita mostrar cuál está puesto. Por eso
 * mismo se valida que no se haya pegado una credencial ahí por error.
 *
 * ── Qué NO tiene este endpoint, dicho de frente ──
 *
 * No tiene autenticación, porque todavía no hay: hay un solo usuario y se decidió no
 * implementarla en este tramo. Consecuencia real, sin suavizar: cualquiera que descubra la
 * URL puede leer el estado (mismo alcance que `/api/diagnostico`, que ya publica los
 * últimos 4 del locationId) y, sobre todo, **puede escribir**. Sobreescribir el PIT o la
 * key deja la app fuera de servicio hasta que alguien la vuelva a cargar.
 *
 * Mientras tanto queda el mismo freno opcional que ya usan `analizar.ts` y el webhook: si
 * existe `WEBHOOK_SECRET`, POST y DELETE exigen el header `x-webhook-secret`. Está apagado
 * por defecto a propósito —encendido, la pantalla de Ajustes deja de poder escribir, porque
 * mandar ese secreto desde el browser sería publicarlo en el bundle, que es exactamente lo
 * que este archivo existe para evitar—. Sirve para dejar el endpoint cerrado y cargar las
 * credenciales por `curl` hasta que exista login de verdad.
 *
 * ── Lo que este endpoint todavía NO hace ──
 *
 * Guarda las credenciales, pero **nadie las lee todavía**: el backend sigue tomando todo de
 * `process.env`. Guardar una key acá hoy no cambia el comportamiento de la app. Está fuera
 * del alcance de este trabajo a propósito; el detalle exacto de qué habría que tocar y
 * dónde está al pie de este archivo.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db, orgActiva } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

/* ================================================================== */
/* Catálogo de campos                                                  */
/* ================================================================== */

type CampoKey = "anthropicApiKey" | "ghlPit" | "ghlLocationId" | "ghlCalendarId" | "claudeModel";

interface Definicion {
  columna: string;
  /**
   * Columna espejo con los últimos 4. `null` = el campo no es un secreto y se devuelve
   * entero (hoy solo `claudeModel`).
   */
  columnaUltimos4: string | null;
  /**
   * Variables de entorno equivalentes, en orden de precedencia. Se usan solo para responder
   * "de dónde sale hoy esta credencial" — nunca se devuelve su valor si es un secreto.
   */
  envs: readonly string[];
  /** Devuelve el mensaje de error, o `null` si el valor está bien. */
  valida: (v: string) => string | null;
}

/** Ids de GHL: alfanuméricos con guiones, ~24 caracteres. Nunca traen espacios. */
const FORMA_ID_GHL = /^[A-Za-z0-9_-]{10,64}$/;
/** Identificador de modelo: minúsculas, dígitos, puntos y guiones (`claude-opus-5`). */
const FORMA_MODELO = /^[a-z0-9][a-z0-9._-]{2,63}$/;

/**
 * Validación de forma, deliberadamente mínima: solo rechaza lo que CLARAMENTE no es la
 * credencial pedida. No intenta adivinar si la key es válida —eso lo dice el proveedor la
 * primera vez que se la usa— sino atajar el error de verdad frecuente: pegar el valor en el
 * campo equivocado, o pegar media línea con un salto de línea de más.
 */
const CAMPOS: Record<CampoKey, Definicion> = {
  anthropicApiKey: {
    columna: "anthropic_api_key",
    columnaUltimos4: "anthropic_api_key_ultimos4",
    envs: ["ANTHROPIC_API_KEY"],
    valida: (v) =>
      !v.startsWith("sk-ant-")
        ? 'Una API key de Anthropic empieza con "sk-ant-". Revisá que no hayas pegado el PIT de GHL o el id de la organización.'
        : v.length < 20
          ? "La key quedó demasiado corta; parece cortada. Copiala entera desde console.anthropic.com."
          : null,
  },

  ghlPit: {
    columna: "ghl_pit",
    columnaUltimos4: "ghl_pit_ultimos4",
    // `env.ts` acepta las dos: `GHL_PIT` es la que ya está puesta en Vercel y `GHL_API_KEY`
    // quedó como alias para no tener que renombrarla.
    envs: ["GHL_PIT", "GHL_API_KEY"],
    valida: (v) =>
      !v.startsWith("pit-")
        ? 'Un Private Integration Token de GHL empieza con "pit-". Las API keys viejas (JWT, empiezan con "eyJ") no sirven acá: el adapter usa la API v2, que solo acepta PIT.'
        : v.length < 20
          ? "El token quedó demasiado corto; parece cortado. Copialo entero desde Settings → Private Integrations."
          : null,
  },

  ghlLocationId: {
    columna: "ghl_location_id",
    columnaUltimos4: "ghl_location_id_ultimos4",
    envs: ["GHL_LOCATION_ID"],
    valida: (v) =>
      !FORMA_ID_GHL.test(v)
        ? "El location id de GHL es un identificador alfanumérico de ~24 caracteres, sin espacios ni barras. Si copiaste una URL entera, quedate solo con el id."
        : null,
  },

  ghlCalendarId: {
    columna: "ghl_calendar_id",
    columnaUltimos4: "ghl_calendar_id_ultimos4",
    envs: ["GHL_DEFAULT_CALENDAR_ID"],
    valida: (v) =>
      !FORMA_ID_GHL.test(v)
        ? "El id de calendario de GHL es un identificador alfanumérico de ~24 caracteres, sin espacios ni barras. Si copiaste el link de agendamiento, quedate solo con el id."
        : null,
  },

  claudeModel: {
    columna: "claude_model",
    // Sin espejo: no es un secreto y se devuelve entero.
    columnaUltimos4: null,
    envs: ["CLAUDE_MODEL"],
    valida: (v) =>
      /^(sk-|pit-)/i.test(v)
        ? "Eso es una credencial, no un modelo. Este campo se devuelve completo a la pantalla de Ajustes, así que pegar una key acá la expondría — se rechaza a propósito."
        : !FORMA_MODELO.test(v)
          ? 'El modelo es un identificador como "claude-opus-5": minúsculas, dígitos, puntos y guiones.'
          : null,
  },
};

const CLAVES = Object.keys(CAMPOS) as CampoKey[];

/**
 * Las únicas columnas que se leen para responder. El valor completo de un secreto no está
 * en esta lista, y esa ausencia es la garantía — no un recorte posterior que se puede
 * olvidar.
 */
const COLUMNAS_ESTADO = [
  "anthropic_api_key_ultimos4",
  "ghl_pit_ultimos4",
  "ghl_location_id_ultimos4",
  "ghl_calendar_id_ultimos4",
  "claude_model",
  "actualizado_el",
].join(", ");

type Fila = Record<string, string | null>;

/* ================================================================== */
/* Estado que ve el front                                              */
/* ================================================================== */

interface EstadoCampo {
  configurada: boolean;
  /** Últimos 4 caracteres. `null` si no está configurada, o si sale del entorno. */
  ultimos4: string | null;
  /** Valor completo. Solo para campos que no son secretos — hoy únicamente `claudeModel`. */
  valor: string | null;
  /**
   * `base`    → guardada acá, editable desde Ajustes.
   * `entorno` → todavía en las variables de Vercel. La app funciona, pero cambiarla exige
   *             un deploy: es lo que distingue "no configurada" de "configurada en otro lado".
   * `ninguno` → no está en ninguna parte.
   */
  origen: "base" | "entorno" | "ninguno";
}

function armarEstado(fila: Fila | null): Record<CampoKey, EstadoCampo> {
  const salida = {} as Record<CampoKey, EstadoCampo>;

  for (const clave of CLAVES) {
    const def = CAMPOS[clave];
    const esSecreto = def.columnaUltimos4 !== null;
    const enBase = fila?.[def.columnaUltimos4 ?? def.columna] ?? null;

    if (enBase !== null) {
      salida[clave] = {
        configurada: true,
        ultimos4: esSecreto ? enBase : null,
        valor: esSecreto ? null : enBase,
        origen: "base",
      };
      continue;
    }

    /**
     * Del entorno se reporta la PRESENCIA, no los últimos 4. Este endpoint no tiene
     * autenticación, así que cada dato que devuelve es un dato publicado: leer las
     * variables de entorno para recortarlas ampliaría la superficie sin necesidad. Con
     * saber que están alcanza para que la UI no diga "no configurada" mientras la app
     * funciona perfectamente contra ellas — que es el único malentendido que hay que evitar.
     */
    const delEntorno = def.envs.map((n) => process.env[n]?.trim()).find(Boolean);

    salida[clave] = delEntorno
      ? { configurada: true, ultimos4: null, valor: esSecreto ? null : delEntorno, origen: "entorno" }
      : { configurada: false, ultimos4: null, valor: null, origen: "ninguno" };
  }

  return salida;
}

async function leerFila(): Promise<Fila | null> {
  const { data, error } = await db()
    .from("closer_conexiones")
    .select(COLUMNAS_ESTADO)
    .maybeSingle();

  if (error) throw new Error(`conexiones: ${error.message}`);
  return (data as Fila | null) ?? null;
}

const respuesta = (res: VercelResponse, fila: Fila | null, extra: Record<string, unknown> = {}) =>
  res.status(200).json({
    ok: true,
    actualizadoEl: fila?.actualizado_el ?? null,
    credenciales: armarEstado(fila),
    ...extra,
  });

/* ================================================================== */
/* Handler                                                             */
/* ================================================================== */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["admin"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  try {
    if (req.method === "GET") return respuesta(res, await leerFila());

    if (req.method === "POST" || req.method === "DELETE") {
      // Freno opcional, mismo patrón que `analizar.ts` y el webhook: sin la variable
      // configurada no cambia nada. Ver la nota del encabezado sobre qué implica encenderlo.
      const secreto = process.env.WEBHOOK_SECRET;
      if (secreto && req.headers["x-webhook-secret"] !== secreto) {
        return res.status(401).json({ ok: false, codigo: "secreto_invalido", error: "Secreto inválido." });
      }

      return req.method === "POST" ? await guardar(req, res) : await borrar(req, res);
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ ok: false, error: "Solo GET, POST y DELETE." });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/* ── POST ─────────────────────────────────────────────────────────── */

async function guardar(req: VercelRequest, res: VercelResponse) {
  const cuerpo = leerCuerpo(req);
  if (!cuerpo) return malo(res, "Cuerpo JSON inválido.", "cuerpo_invalido");

  /**
   * Una clave mal escrita se rechaza en vez de ignorarse. Aceptarla en silencio haría que
   * el endpoint devuelva 200 por algo que no guardó, que es la única forma de fallar que no
   * se puede permitir acá: el usuario cerraría Ajustes convencido de haber rotado una key.
   */
  const desconocidas = Object.keys(cuerpo).filter((k) => !CLAVES.includes(k as CampoKey));
  if (desconocidas.length) {
    return malo(
      res,
      `Campo(s) que no existen: ${desconocidas.join(", ")}. Los válidos son: ${CLAVES.join(", ")}.`,
      "campo_desconocido",
    );
  }

  const aGuardar: Record<string, string> = {};
  const guardados: CampoKey[] = [];

  for (const clave of CLAVES) {
    if (!(clave in cuerpo)) continue;
    const bruto = cuerpo[clave];

    // Null y "" NO borran. Borrar es una operación aparte y explícita: si un input vacío de
    // un formulario pudiera borrar una credencial, alcanzaría con guardar la pantalla de
    // Ajustes sin tocar ese campo para dejar la app sin PIT.
    if (bruto === null || bruto === "") {
      return malo(
        res,
        `"${clave}" vino vacío, y un POST nunca borra. Para quitar una credencial: DELETE con { "campo": "${clave}" }.`,
        "vacio_no_borra",
      );
    }
    if (typeof bruto !== "string") return malo(res, `"${clave}" tiene que ser un string.`, "tipo_invalido");

    // Copiar y pegar arrastra espacios y saltos de línea; con ellos el token viaja mal y GHL
    // responde un 401 que no se parece en nada a la causa.
    const v = bruto.trim();
    if (!v) {
      return malo(
        res,
        `"${clave}" vino solo con espacios, y un POST nunca borra. Para quitarla: DELETE con { "campo": "${clave}" }.`,
        "vacio_no_borra",
      );
    }
    if (v.length > 500) return malo(res, `"${clave}" supera los 500 caracteres; eso no es una credencial.`, "demasiado_largo");

    const problema = CAMPOS[clave].valida(v);
    if (problema) return malo(res, problema, "formato_invalido");

    aGuardar[CAMPOS[clave].columna] = v;
    guardados.push(clave);
  }

  if (!guardados.length) {
    return malo(res, `No vino ningún campo para guardar. Los válidos son: ${CLAVES.join(", ")}.`, "sin_campos");
  }

  /**
   * `upsert` y no leer-modificar-escribir: es una sola sentencia atómica, y PostgREST arma
   * el `on conflict do update set` SOLO con las columnas que van en el payload. Eso es
   * exactamente la regla "un campo ausente no borra el guardado", garantizada por la
   * sentencia en vez de por una lectura previa que además abriría una carrera entre dos
   * pestañas guardando campos distintos.
   */
  const { error } = await db()
    .from("closer_conexiones")
    .upsert({ ...aGuardar, actualizado_el: new Date().toISOString() }, { onConflict: "org_id" });

  if (error) {
    // FK contra `closer_org_config`: la org no existe. Pasa en una base a la que le falta el
    // bootstrap, y el mensaje crudo de Postgres no lo dice de forma útil.
    if (error.code === "23503") {
      return res.status(409).json({
        ok: false,
        codigo: "org_inexistente",
        error: `La organización ${orgActiva()} no existe en closer_org_config.`,
      });
    }
    throw new Error(`conexiones: ${error.message}`);
  }

  // Se relee en vez de devolver lo que se creyó guardar: el estado que ve el usuario sale de
  // la base, así que no puede mostrar como aplicado algo que no llegó (§4 — nunca reportar
  // éxito de algo que no se aplicó).
  return respuesta(res, await leerFila(), { guardados });
}

/* ── DELETE ───────────────────────────────────────────────────────── */

async function borrar(req: VercelRequest, res: VercelResponse) {
  const cuerpo = leerCuerpo(req) ?? {};
  // Se acepta también por query: `fetch` manda cuerpo en un DELETE sin problema, pero un
  // `curl -X DELETE` de una línea es más cómodo así, y este endpoint se va a operar a mano.
  // `req.query` da `string | string[]` — repetir el parámetro no puede terminar en un crash.
  const enQuery = req.query.campo;
  const campo = (typeof cuerpo.campo === "string" ? cuerpo.campo : Array.isArray(enQuery) ? enQuery[0] : enQuery)?.trim();

  if (!campo) return malo(res, `Falta "campo". Los válidos son: ${CLAVES.join(", ")}.`, "campo_faltante");
  if (!CLAVES.includes(campo as CampoKey)) {
    return malo(res, `"${campo}" no es un campo válido. Los válidos son: ${CLAVES.join(", ")}.`, "campo_desconocido");
  }

  const def = CAMPOS[campo as CampoKey];
  const antes = await leerFila();
  const estaba = (antes?.[def.columnaUltimos4 ?? def.columna] ?? null) !== null;

  // Decir "borrada" de algo que no estaba guardado es reportar un efecto que no ocurrió.
  // Además importa el matiz: si la credencial venía del entorno, borrar acá no la apaga.
  if (!estaba) {
    return respuesta(res, antes, {
      campo,
      borrado: false,
      motivo:
        "Esa credencial no estaba guardada en la base, así que no había nada que borrar. Si la app la sigue usando, viene de las variables de entorno de Vercel y se quita desde ahí.",
    });
  }

  const { error } = await db()
    .from("closer_conexiones")
    .update({ [def.columna]: null, actualizado_el: new Date().toISOString() });

  if (error) throw new Error(`conexiones: ${error.message}`);

  return respuesta(res, await leerFila(), { campo, borrado: true });
}

/* ── Utilidades ───────────────────────────────────────────────────── */

function leerCuerpo(req: VercelRequest): Record<string, unknown> | null {
  const crudo = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (crudo === undefined || crudo === null) return {};
  if (typeof crudo !== "object" || Array.isArray(crudo)) return null;
  return crudo as Record<string, unknown>;
}

function safeJson(s: string): unknown {
  try {
    return s.trim() ? JSON.parse(s) : {};
  } catch {
    return null;
  }
}

const malo = (res: VercelResponse, error: string, codigo: string) => res.status(400).json({ ok: false, codigo, error });

/* ==================================================================
 * PENDIENTE — que el backend prefiera estas credenciales al entorno
 * ==================================================================
 *
 * Nada de esto se implementa acá (queda fuera del alcance de este trabajo), pero conviene
 * que esté escrito donde se va a leer. Hoy la tabla se llena y nadie la consulta.
 *
 * El orden correcto es: base primero, entorno como respaldo. Al revés, guardar una key en
 * Ajustes no tendría efecto mientras la variable de Vercel siguiera puesta, que es
 * justamente el caso normal.
 *
 * Puntos exactos a cambiar:
 *
 *   1. `api/_lib/analizador.ts:177` y `:277` — `if (!process.env.ANTHROPIC_API_KEY) return null`.
 *   2. `api/_lib/analizador.ts:179` — `new Anthropic()` toma la key del entorno de forma
 *      implícita; pasaría a ser `new Anthropic({ apiKey })`.
 *   3. `api/_lib/analizador.ts:181` y `:244` — `process.env.CLAUDE_MODEL || "claude-opus-5"`.
 *   4. `api/_lib/env.ts:41,42,45` — `ghlApiKey()`, `ghlLocationId()`, `ghlCalendarioPorDefecto()`.
 *   5. `api/_lib/env.ts:56-63` — **el que se pasa por alto**: `ghlModo()` y
 *      `tieneCredencialesGhl()` deciden entre adapter real y stub mirando SOLO el entorno
 *      (`api/_lib/ghl/index.ts:15`). Sin tocarlos, guardar el PIT en Ajustes dejaría el
 *      adapter en stub: la app respondería 200 a todo y no escribiría una sola cosa en GHL.
 *
 * La complicación real, que conviene resolver antes de empezar: todo el acceso de arriba es
 * SÍNCRONO (`env.ghlApiKey()` se llama dentro de `headers()` en `real.ts`, por request y sin
 * await), y leer de Supabase es asíncrono. Volver async esa superficie contagia media
 * `api/`. La forma barata es cargar las credenciales UNA vez al principio del request —
 * `await cargarCredenciales(orgId)` en cada handler— y dejar que `env.*` lea de una caché
 * en memoria del módulo, con el entorno como respaldo cuando la caché no tiene el valor.
 * Ojo con el alcance de esa caché en funciones serverless: la instancia caliente se reusa
 * entre requests, así que cuando haya varias organizaciones tiene que estar indexada por
 * `org_id` y no ser una variable suelta — si no, la instancia atiende a un cliente con las
 * credenciales del anterior.
 */
