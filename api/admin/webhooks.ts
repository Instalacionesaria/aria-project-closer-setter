/**
 * `GET/POST /api/admin/webhooks` — las URLs de entrada de una empresa (ESPEC-AUDITOR §3.2).
 *
 * ── Se MUESTRAN, no se piden ──────────────────────────────────────────
 *
 * Ninguno de estos valores es un campo de texto que el cliente complete. **Nosotros generamos y
 * el cliente copia.** Antes la UI le pedía el secreto del webhook de GHL como si fuera una
 * credencial suya, y eso tiene dos problemas: uno, el cliente no tiene de dónde sacarlo; dos, y
 * peor, un campo que se puede dejar vacío se deja vacío — y sin secreto cualquiera que descubra
 * la URL puede inyectar eventos y generar gasto de API.
 *
 * Lo que cambia es **de qué lado nace el secreto**, no si existe. Si no hay ninguno que funcione,
 * el primer GET lo genera y lo guarda. No hay estado "sin secreto".
 *
 * ── El GET muestra el secreto EFECTIVO, no la columna ─────────────────
 *
 * Y esa distinción evita romper producción. Hoy ARIA tiene las dos columnas en `null` y anda con
 * los globales (`WEBHOOK_SECRET` y `LLAMADAS_TOKEN`), que son los que Francisco ya pegó en el
 * workflow de GHL y en Assistable. `atribuirWebhook` los resuelve así:
 *
 *     const esperado = credenciales[campo] ?? secretoGlobal;
 *
 * O sea que generar uno propio **cambia el secreto que el endpoint espera**. Si esta pantalla lo
 * generara sola al abrirse, abrir Ajustes cortaría la ingesta de GHL y las llamadas de Assistable
 * en el acto, sin que nadie hubiera pedido nada. Un GET no puede tener esa consecuencia.
 *
 * Así que se muestra el que funciona hoy —propio si existe, global si no— y **solo se genera
 * cuando no hay ninguno**. Pasar de global a propio es una decisión explícita: el botón Rotar,
 * que pregunta y avisa que hay que volver a pegarlo del otro lado.
 *
 * ── Por qué el de llamadas va embebido en la URL ──────────────────────
 *
 * Assistable solo ofrece un campo de URL: no deja configurar headers. Así que la URL que se copia
 * ya lleva el token adentro, y por eso acá se devuelve armada — un solo botón de copiar, una sola
 * cosa que pegar. Que la URL sea la credencial es lo que obliga a la defensa cruzada de
 * `atribuirPorToken`: si el payload nombra otra empresa, no se procesa.
 *
 * ── Rotar ─────────────────────────────────────────────────────────────
 *
 * Rotar **invalida el valor anterior en el acto**: no hay período de gracia, y es a propósito. Un
 * secreto rotado que sigue funcionando media hora no es un secreto rotado. La UI avisa, en el
 * mismo lugar, que hay que volver a pegarlo en GHL o en Assistable — y queda registrado en
 * `closer_auditoria_accesos` como `rotar_credencial`.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomBytes } from "node:crypto";
import { auditar, exigir, type Contexto } from "../_lib/auth.js";
import { activar, olvidarCredenciales } from "../_lib/credenciales.js";
import { db } from "../_lib/repo.js";

/**
 * 32 bytes en base64url: 43 caracteres sin `+`, `/` ni `=`.
 *
 * Base64url y no hex porque el de llamadas viaja **en un query string**, y un `+` ahí se decodifica
 * como espacio. Es el tipo de bug que aparece en el 3% de los tokens generados y se diagnostica
 * como "a veces el webhook da 401".
 */
function generarSecreto(): string {
  return randomBytes(32).toString("base64url");
}

/** Las dos entradas, con la columna donde vive el secreto de cada una. */
const WEBHOOKS = [
  {
    clave: "ghl",
    columna: "ghl_webhook_secret",
    titulo: "Webhook de GoHighLevel",
    ruta: "/api/webhooks/ghl",
    /** GHL sí permite headers: el secreto va aparte, no en la URL. */
    enLaUrl: false,
    /** El global del que se cae cuando la empresa no tiene el suyo. Ver `atribuirWebhook`. */
    envGlobal: "WEBHOOK_SECRET",
    donde: "En el workflow de GHL, acción Webhook: el header `x-webhook-secret`.",
  },
  {
    clave: "llamadas",
    columna: "assistable_token",
    titulo: "Webhook de llamadas (Assistable)",
    ruta: "/api/webhooks/llamada",
    /** Assistable no permite headers. La URL ES la credencial. */
    enLaUrl: true,
    envGlobal: "LLAMADAS_TOKEN",
    donde: "En Assistable, el campo de URL del webhook. Pegar la URL completa, con el token.",
  },
] as const;

/**
 * El origen público de esta instancia.
 *
 * `VERCEL_PROJECT_PRODUCTION_URL` la pone Vercel sola y apunta siempre al dominio de producción,
 * incluso desde un preview — que es lo correcto acá: la URL que el cliente pega en GHL tiene que
 * ser la de producción, no la del preview desde el que un admin abrió el panel.
 */
function origen(req: VercelRequest): string {
  const deVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (deVercel) return `https://${deVercel}`;
  // Local: se arma con lo que mandó el browser. No hay dominio de producción que consultar.
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:3000";
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  return `${proto}://${host}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Las URLs de entrada son configuración de la empresa: mismo rol que las credenciales.
  const ctx = await exigir(req, res, ["admin"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  if (req.method === "GET") return leer(req, res, ctx);
  if (req.method === "POST") return rotar(req, res, ctx);
  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ ok: false, error: "Usá GET o POST." });
}

/**
 * Lee los secretos **efectivos**, generando solo los que no existen en ningún lado.
 *
 * El GET puede escribir, y es deliberado: es lo que hace que no exista el estado "sin secreto". La
 * alternativa —un botón "generar"— deja el hueco abierto hasta que alguien se acuerda de
 * apretarlo, y el hueco es exactamente lo que hay que cerrar.
 *
 * Lo que NO hace es pisar una configuración que anda. Ver el encabezado del archivo.
 */
async function leer(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const orgId = ctx.orgEfectiva;

  /**
   * `db()` y no `dbSinScope()`: este endpoint solo opera sobre la empresa **activa**, y el Proxy
   * ya inyecta su `org_id`. A diferencia de `/api/admin/configuracion`, acá no hay `?orgId=`: un
   * super admin que quiera ver los webhooks de otra empresa cambia de empresa activa, que es el
   * camino que además queda auditado.
   */
  const { data, error } = await db()
    .from("closer_org_config")
    .select(WEBHOOKS.map((w) => w.columna).join(", "))
    .maybeSingle();

  if (error) return res.status(503).json({ ok: false, error: `No se pudo leer: ${error.message}` });
  if (!data) return res.status(404).json({ ok: false, error: "Esa empresa no existe." });

  const fila = data as unknown as Record<string, string | null>;

  /** El que realmente valida hoy: el propio, o el global si la empresa no tiene el suyo. */
  const efectivo: Record<string, string> = {};
  /** De dónde sale, para poder decírselo a quien mira. */
  const esPropio: Record<string, boolean> = {};
  const generados: Record<string, string> = {};

  for (const w of WEBHOOKS) {
    const propio = fila[w.columna];
    if (propio) {
      efectivo[w.clave] = propio;
      esPropio[w.clave] = true;
      continue;
    }
    const global = process.env[w.envGlobal];
    if (global) {
      // Anda con el global. NO se toca: generar acá le rompería la integración al cliente.
      efectivo[w.clave] = global;
      esPropio[w.clave] = false;
      continue;
    }
    // No hay ninguno: éste sí es el hueco que hay que cerrar.
    const nuevo = generarSecreto();
    generados[w.columna] = nuevo;
    efectivo[w.clave] = nuevo;
    esPropio[w.clave] = true;
  }

  if (Object.keys(generados).length > 0) {
    const { error: errGuardar } = await db().from("closer_org_config").update(generados);

    if (errGuardar) {
      /**
       * No se devuelve el secreto que no se pudo guardar: mostrarlo haría que alguien lo pegara
       * en GHL y después recibiera 401 para siempre, que es peor que un error visible acá.
       */
      return res.status(503).json({ ok: false, error: `No se pudo generar el secreto: ${errGuardar.message}` });
    }
    olvidarCredenciales(orgId);
    await auditar("rotar_credencial", {
      usuarioId: ctx.usuarioId,
      orgId,
      detalle: { generados: Object.keys(generados), motivo: "no existía ni propio ni global" },
    });
  }

  const base = origen(req);
  return res.status(200).json({
    ok: true,
    webhooks: WEBHOOKS.map((w) => {
      const secreto = efectivo[w.clave];
      return {
        clave: w.clave,
        titulo: w.titulo,
        donde: w.donde,
        /**
         * `false` = esta empresa está usando el secreto global, compartido con las demás. Se dice,
         * porque es una diferencia real: rotarlo le crea uno propio y obliga a volver a pegarlo.
         */
        propio: esPropio[w.clave],
        // El de llamadas ya viene armado con el token: una sola cosa que copiar.
        url: w.enLaUrl ? `${base}${w.ruta}?token=${encodeURIComponent(secreto)}` : `${base}${w.ruta}`,
        /**
         * El secreto viaja ENTERO, al revés que las credenciales de `/api/admin/configuracion`.
         * No es una contradicción: aquéllas son del cliente y nosotros no tenemos por qué poder
         * leerlas; éste lo generamos nosotros para dárselo, y un secreto que no se puede copiar
         * no sirve para nada.
         */
        secreto: w.enLaUrl ? null : secreto,
        secretoEnLaUrl: w.enLaUrl,
      };
    }),
  });
}

async function rotar(req: VercelRequest, res: VercelResponse, ctx: Contexto) {
  const cuerpo = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) as
    | { clave?: string }
    | undefined;

  const w = WEBHOOKS.find((x) => x.clave === cuerpo?.clave);
  if (!w) {
    return res.status(400).json({ ok: false, error: `No conozco el webhook "${cuerpo?.clave ?? ""}".` });
  }

  const orgId = ctx.orgEfectiva;
  const nuevo = generarSecreto();

  const { error } = await db().from("closer_org_config").update({ [w.columna]: nuevo });

  if (error) return res.status(503).json({ ok: false, error: `No se pudo rotar: ${error.message}` });

  /**
   * El caché de credenciales vive en el proceso. Sin olvidarlo, esta instancia seguiría validando
   * contra el secreto viejo — o sea, el nuevo daría 401 justo después de rotarlo.
   */
  olvidarCredenciales(orgId);

  await auditar("rotar_credencial", {
    usuarioId: ctx.usuarioId,
    orgId,
    detalle: { webhook: w.clave, columna: w.columna, motivo: "rotación manual" },
  });

  return res.status(200).json({
    ok: true,
    /**
     * Se dice explícitamente que el anterior ya no sirve. La UI lo repite al lado del botón: sin
     * ese aviso, rotar y no volver a pegarlo en GHL corta la ingesta en silencio.
     */
    aviso: `El secreto anterior dejó de funcionar. Hay que pegar el nuevo en ${w.enLaUrl ? "Assistable" : "GHL"}.`,
  });
}
