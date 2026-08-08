/**
 * De qué empresa es este webhook (ESPEC-MULTIEMPRESA §6.3).
 *
 * Los webhooks son el único camino de entrada que **no elige** su empresa: la trae el evento.
 * Hasta el 2026-08-07 los dos handlers activaban `ORG_PRINCIPAL` con un comentario que decía
 * "provisorio", así que todo lo que llegara de la subcuenta de un cliente se procesaba con el
 * token de ARIA, contra los contactos de ARIA, y quedaba archivado en el historial de ARIA.
 *
 * ── La atribución va por `locationId`, no por la URL ──────────────────
 *
 * Cada empresa es una subcuenta de GHL y su `locationId` viaja en el payload. `closer_org_config`
 * tiene índice único sobre `ghl_location_id`, así que la búsqueda es exacta y no ambigua.
 *
 * Se descartó darle a cada empresa su propia URL (`/api/webhooks/ghl/<slug>`): en Vercel cada
 * ruta es una función más, y sobre todo el dato ya viene en el cuerpo — derivarlo de la URL
 * habría creado una segunda fuente de verdad que puede contradecir a la primera.
 *
 * ── Un evento sin empresa NO se atribuye por descarte ─────────────────
 *
 * Es la decisión D15 y es la parte que importa. Si el `locationId` no corresponde a ninguna
 * empresa —una subcuenta que nadie dio de alta, un workflow mal copiado, un payload raro— el
 * evento se guarda crudo con `org_id = null` y **no se procesa**. La tentación es mandarlo a la
 * empresa principal "por ahora": eso es exactamente la fuga que todo este trabajo evita, y
 * además es indetectable, porque los datos de un cliente entrando a ARIA se ven idénticos a los
 * de ARIA. El índice parcial sobre `org_id is null` de la `019` existe para poder auditarlos.
 */

import { resolverCredenciales, type Credenciales } from "./credenciales.js";
import { dbSinScope } from "./db.js";

/** Lo que puede pasar con un webhook antes de procesarlo. */
export type Atribucion =
  /**
   * `locationId` es nullable incluso acá, y no es un descuido: por el camino de
   * `atribuirPorToken` la empresa la identifica el token de la URL, así que un payload sin
   * `location_id` se atribuye igual. Antes ese caso quedaba huérfano aunque el token dijera
   * perfectamente de quién era.
   */
  | { estado: "ok"; credenciales: Credenciales; locationId: string | null }
  /** Llegó, se guardó crudo, y no se procesa. No es un error del que llama. */
  | { estado: "sin_empresa"; locationId: string | null; motivo: string }
  /** La empresa existe pero está desactivada: se guarda crudo y se corta. */
  | { estado: "empresa_inactiva"; credenciales: Credenciales; locationId: string | null }
  | { estado: "secreto_invalido" }
  | { estado: "sin_secreto_configurado" };

/**
 * Saca el id de la subcuenta de un payload.
 *
 * ── Las tres formas salieron de los payloads reales ───────────────────
 *
 * No están adivinadas: se contaron las 84 filas de `closer_webhook_inbox` de producción antes
 * de escribir esto (2026-08-07).
 *
 *   - **GHL manda `location.id` anidado** en 80 de 81 eventos. Ninguno trae `locationId` ni
 *     `location_id` arriba, que era lo que yo habría escrito por analogía con `contactId`.
 *   - **Assistable manda `location_id`** arriba, en los 3.
 *   - El único evento sin ninguna de las tres es una prueba por curl (`contact_id` en ceros),
 *     no un evento de GHL.
 *
 * Las tres formas se aceptan igual: son tres integraciones distintas y el día que GHL cambie de
 * payload —ya pasó con `contactId`— no quiero que se corte la ingesta entera.
 *
 * **No hay fallback a `contact.id`.** Lo escribí en la primera versión y era un error: ese es el
 * id de la persona, no el de la subcuenta. Buscar una empresa por él no encuentra nada hoy, pero
 * es la clase de coincidencia que un día encuentra la empresa equivocada.
 */
export function locationIdDe(cuerpo: Record<string, unknown> | null): string | null {
  if (!cuerpo) return null;
  const anidado = (cuerpo.location as Record<string, unknown> | undefined)?.id;
  const crudo = cuerpo.locationId ?? cuerpo.location_id ?? anidado;
  const valor = String(crudo ?? "").trim();
  return valor || null;
}

/**
 * Resuelve la empresa de un webhook y valida su secreto.
 *
 * ── El secreto se valida DESPUÉS de saber la empresa ──────────────────
 *
 * Suena al revés, y es a propósito: el secreto es **por empresa** (`ghl_webhook_secret`), así
 * que no se puede comparar contra nada hasta saber contra cuál. El costo es una consulta
 * indexada antes de autenticar, que es aceptable; el beneficio es que el workflow de una
 * empresa deja de poder inyectar eventos a nombre de otra, que con un secreto único compartido
 * entre las cinco era trivial.
 *
 * Una empresa sin secreto propio cae al global (`WEBHOOK_SECRET`), que es como está configurada
 * ARIA hoy. Lo que NO existe es el caso "sin ninguno": ahí se rechaza.
 */
export async function atribuirWebhook(
  cuerpo: Record<string, unknown> | null,
  secretoRecibido: string | undefined,
  secretoGlobal: string | undefined,
  /**
   * Contra qué credencial de la empresa se compara. Son dos proveedores con dos secretos
   * distintos guardados en dos columnas distintas: `ghl_webhook_secret` y `assistable_token`.
   * Se pasa el nombre del campo en vez de tener dos funciones casi iguales — lo único que
   * cambia entre GHL y Assistable es esta línea.
   */
  campoSecreto: "ghlWebhookSecret" | "assistableToken" = "ghlWebhookSecret",
): Promise<Atribucion> {
  const locationId = locationIdDe(cuerpo);

  if (!locationId) {
    return { estado: "sin_empresa", locationId: null, motivo: "el payload no trae locationId" };
  }

  // Sin scope: esto es literalmente averiguar de qué organización se trata. Es el caso que la
  // escotilla documenta en `db.ts`.
  const { data, error } = await dbSinScope()
    .from("closer_org_config")
    .select("org_id, nombre")
    .eq("ghl_location_id", locationId)
    .maybeSingle();

  if (error) {
    // No se pudo averiguar ≠ no corresponde a nadie. Se distingue para que el llamador pueda
    // devolver un 5xx y GHL reintente, en vez de descartar un evento bueno.
    throw new Error(`No se pudo resolver la empresa del webhook: ${error.message}`);
  }
  if (!data) {
    return {
      estado: "sin_empresa",
      locationId,
      motivo: `ninguna empresa tiene el locationId ${locationId}`,
    };
  }

  const credenciales = await resolverCredenciales(data.org_id as string);

  const esperado = credenciales[campoSecreto] ?? secretoGlobal;
  if (!esperado) return { estado: "sin_secreto_configurado" };
  if (secretoRecibido !== esperado) return { estado: "secreto_invalido" };

  /**
   * Una empresa desactivada no procesa nada, pero su evento SÍ se guarda crudo: cuando se
   * reactive, el historial de lo que pasó mientras tanto es lo único que hay. Descartarlo
   * sería perder datos por un estado administrativo.
   */
  if (!credenciales.activa) return { estado: "empresa_inactiva", credenciales, locationId };

  return { estado: "ok", credenciales, locationId };
}

/**
 * Resuelve la empresa **por el token de la URL**, y después verifica que el payload no la
 * contradiga. Es el camino de Assistable, y es al revés que el de GHL a propósito.
 *
 * ── Por qué acá manda el token y allá manda el payload ────────────────
 *
 * Assistable solo ofrece un campo de URL: no deja configurar headers. Así que la URL que se le
 * entrega al cliente ya lleva su token adentro, y **ese token es lo que dice de quién es este
 * evento**. Con `atribuirWebhook` la empresa salía del `location_id` del payload, y eso tenía dos
 * agujeros: un payload sin `location_id` quedaba huérfano aunque el token dijera perfectamente de
 * quién era, y el token pasaba a ser una contraseña más y no un identificador.
 *
 * ── La defensa cruzada (ESPEC-AUDITOR §3.2) ───────────────────────────
 *
 * Si el payload trae `location_id` y **no** coincide con el `ghl_location_id` de la empresa del
 * token, no se procesa: se guarda crudo con `org_id = null`. Es o una configuración cruzada —el
 * cliente pegó la URL de otra empresa— o un token reutilizado, y las dos merecen ruido en vez de
 * silencio. Procesarlo escribiría llamadas de una empresa en la cuenta de otra.
 *
 * Un payload **sin** `location_id` sí se procesa: el token ya identificó la empresa y no hay nada
 * que contradiga. Es lo que arregla el primero de los dos agujeros.
 */
export async function atribuirPorToken(
  cuerpo: Record<string, unknown> | null,
  tokenRecibido: string | undefined,
  tokenGlobal: string | undefined,
): Promise<Atribucion> {
  const locationId = locationIdDe(cuerpo);

  if (!tokenRecibido) return { estado: "secreto_invalido" };

  // Sin scope: esto es averiguar de qué organización se trata. Es la escotilla que `db.ts`
  // documenta, igual que en `atribuirWebhook`.
  const { data, error } = await dbSinScope()
    .from("closer_org_config")
    .select("org_id")
    .eq("assistable_token", tokenRecibido)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo resolver la empresa del webhook de llamadas: ${error.message}`);
  }

  /**
   * Sin empresa con ese token queda el global (`LLAMADAS_TOKEN`), que es como está configurada
   * ARIA hoy: su fila todavía no tiene `assistable_token` propio. Cuando lo tenga, este camino
   * deja de usarse solo.
   */
  if (!data) {
    if (!tokenGlobal) return { estado: "sin_secreto_configurado" };
    if (tokenRecibido !== tokenGlobal) return { estado: "secreto_invalido" };
    // El token global no identifica a NADIE en particular, así que la empresa vuelve a salir del
    // payload. Es el comportamiento viejo, y se conserva solo para este caso de transición.
    return atribuirWebhook(cuerpo, tokenRecibido, tokenGlobal, "assistableToken");
  }

  const credenciales = await resolverCredenciales(data.org_id as string);

  if (locationId && credenciales.ghlLocationId && locationId !== credenciales.ghlLocationId) {
    return {
      estado: "sin_empresa",
      locationId,
      motivo:
        `el token es de "${credenciales.nombre}" (location ${credenciales.ghlLocationId}) pero el payload ` +
        `dice ${locationId}: configuración cruzada o token reutilizado`,
    };
  }

  if (!credenciales.activa) return { estado: "empresa_inactiva", credenciales, locationId };

  return { estado: "ok", credenciales, locationId };
}

/**
 * Guarda el evento crudo sin atribuirlo a nadie (D15).
 *
 * `org_id: null` explícito: `conOrg()` en `db.ts` respeta ese null y solo ese — es la única
 * excepción a que el Proxy pise la organización, y existe para esta línea.
 *
 * Nunca lanza. Es el último recurso de un evento que ya no se va a procesar: si además
 * fallara el guardado, lo correcto es que el handler igual devuelva 200 y no que GHL
 * reintente para siempre un evento que nunca va a poder atribuir.
 */
export async function guardarHuerfano(
  proveedor: "ghl" | "assistable",
  externalId: string,
  payload: unknown,
): Promise<void> {
  const { error } = await dbSinScope()
    .from("closer_webhook_inbox")
    .insert({ proveedor, external_id: externalId, payload, org_id: null });

  // 23505 = ya lo recibimos. No es un error.
  if (error && error.code !== "23505") {
    console.error(`[webhook huérfano] no se pudo guardar ${proveedor}:${externalId}: ${error.message}`);
  }
}
