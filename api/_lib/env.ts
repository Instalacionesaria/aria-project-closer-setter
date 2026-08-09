/**
 * Variables de entorno del servidor, leídas en un solo lugar y validadas al usarlas.
 *
 * Ninguna lleva prefijo `VITE_`: eso las expondría en el bundle del browser. La
 * `service_role` de Supabase y el token de GHL son credenciales de servidor y solo viven
 * en las funciones de `api/`.
 */

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) {
    throw new Error(
      `Falta la variable de entorno ${nombre}. En local va en .env.local; ` +
        `en Vercel, en Project Settings → Environment Variables.`,
    );
  }
  return v;
}

/**
 * SOFIA es el proyecto permanente del ecosistema ARIA, y su URL no es un secreto — viaja en
 * el bundle de cualquier app que use Supabase desde el browser. Va como constante para no
 * pedir una variable de entorno más: cuantas menos haya, menos hay que configurar bien.
 *
 * La `service_role`, en cambio, NO puede vivir acá: da permiso total sobre la base, este
 * repo está en GitHub, y git no olvida — borrarla después no la saca del historial.
 */
import { credencialesActivas } from "./credenciales.js";

const SUPABASE_URL_SOFIA = "https://pajhjpzydkkpmjdofqqp.supabase.co";

/**
 * Una credencial de la empresa activa, o `null` si no hay empresa activa.
 *
 * ── Por qué esto no es un `??` más ────────────────────────────────────
 *
 * La versión anterior encadenaba `credencialesActivas()?.ghlPit ?? process.env.GHL_PIT`, y ese
 * `??` anulaba en silencio la decisión de §5.2: `resolverCredenciales` devuelve `ghlPit: null`
 * a propósito para una empresa cliente sin token, **para que no pueda operar**. Con el `??`,
 * "no puede operar" se convertía en "opera con el token de ARIA" — una empresa a medio
 * configurar escribiendo en la subcuenta de otra.
 *
 * Ahora, **si hay empresa activa, su valor manda, incluido el null**: se lanza con el nombre de
 * la empresa y el de la credencial que falta. El fallback al entorno queda solo para cuando no
 * hay contexto (tests, arranque), no para tapar una configuración incompleta.
 */
function deLaEmpresa(campo: "ghlPit" | "ghlLocationId", queEs: string): string | null {
  const cred = credencialesActivas();
  if (!cred) return null;
  const valor = cred[campo];
  if (!valor) {
    throw new Error(
      `La empresa "${cred.nombre}" no tiene cargado ${queEs} de GHL. ` +
        `Se carga en Ajustes > Credenciales. No se usan las credenciales de otra empresa.`,
    );
  }
  return valor;
}

export const env = {
  supabaseUrl: () => process.env.SUPABASE_URL ?? SUPABASE_URL_SOFIA,
  supabaseServiceKey: () => requerida("SUPABASE_SERVICE_ROLE_KEY"),

  /**
   * Private Integration Token de GHL — **de la empresa activa** (ESPEC §5.2).
   *
   * Si hay una organización activa en el contexto del request, gana la suya. Fuera de un
   * request con contexto —un cron, un test— cae a la variable global, que es la credencial
   * de ARIA durante la transición.
   *
   * El getter sigue siendo SÍNCRONO a propósito: lo llaman catorce sitios dentro de
   * `headers()` y compañía, y volverlos `async` habría propagado `await` por toda la capa de
   * GHL. La resolución asíncrona ocurre una vez por request en `activarOrganizacion()`.
   *
   * Se acepta `GHL_PIT` (el nombre con el que ya está configurado en Vercel) y `GHL_API_KEY`
   * como alias.
   */
  ghlApiKey: () => deLaEmpresa("ghlPit", "el Private Integration Token") ?? process.env.GHL_PIT ?? requerida("GHL_API_KEY"),
  ghlLocationId: () => deLaEmpresa("ghlLocationId", "el Location ID") ?? requerida("GHL_LOCATION_ID"),

  /** La zona horaria de la empresa activa. Ver `closer_hoy_org(p_org_id)` en la 020. */
  zonaHoraria: () => credencialesActivas()?.zonaHoraria ?? "America/Lima",

  /**
   * El calendario de la empresa activa, del que el cron lee las citas.
   *
   * ── Era global, y era el último bloqueante (2026-08-07) ─────────────
   *
   * Decía `process.env.GHL_DEFAULT_CALENDAR_ID` a secas. Con dos empresas eso significaba pedirle a
   * la empresa B los eventos del calendario de ARIA usando el token de B: 404 de GHL, o peor —cero
   * eventos sin decir por qué— y las citas del cliente nunca sincronizadas. Un calendario pertenece
   * a una subcuenta igual que el `location_id`.
   *
   * `undefined` cuando la empresa no lo cargó. Quien llama **tiene que distinguir eso de "no hay
   * citas"**: `sincronizarCitas` devuelve `sinCalendario: true` justamente para eso.
   */
  ghlCalendarioPorDefecto: () => credencialesActivas()?.ghlCalendarioId ?? process.env.GHL_DEFAULT_CALENDAR_ID,

  /**
   * El modo se DEDUCE de las credenciales en vez de configurarse: con token y location es
   * `real`, sin ellos es `stub`. Una variable aparte solo agregaba una forma más de
   * equivocarse — poner `GHL_MODO=real` sin token, o tener las credenciales y olvidarse de
   * encender el modo, que es peor porque todo "funciona" pero nada llega a GHL.
   *
   * `GHL_MODO=stub` sigue funcionando como freno manual: útil para desplegar y mirar el
   * diagnóstico antes de dejar que escriba en la cuenta real.
   */
  ghlModo: (): "real" | "stub" => {
    if (process.env.GHL_MODO === "stub") return "stub";
    return env.tieneCredencialesGhl() ? "real" : "stub";
  },

  /**
   * Presencia de credenciales. Es el interruptor de TODO: de acá sale `ghlModo()`, y con él la
   * elección entre el cliente real y el stub, y los cortes de la reconciliación, la sincro de
   * citas y las cinco lecturas de `ghl/lectura.ts`.
   *
   * Miraba solo las variables globales, y por eso una empresa SIN credenciales propias pasaba
   * el chequeo —las globales de ARIA están puestas— y seguía adelante hasta terminar usando la
   * subcuenta de ARIA. Ahora responde por la empresa ACTIVA; el entorno solo cuenta cuando no
   * hay ninguna, que es el caso de los tests y de un arranque sin contexto.
   */
  tieneCredencialesGhl: () => {
    const cred = credencialesActivas();
    if (cred) return Boolean(cred.ghlPit && cred.ghlLocationId);
    return Boolean((process.env.GHL_PIT ?? process.env.GHL_API_KEY) && process.env.GHL_LOCATION_ID);
  },
  tieneCredencialesSupabase: () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),

  /* ── Auditor de IA ────────────────────────────────────────────────────── */

  /**
   * Cómo reconocer al chatbot de GHL entre los mensajes salientes.
   *
   * Son válvulas para no tener que desplegar si Fabio confirma que el bot de esta
   * subcuenta firma distinto. Sin ellas rige el default de `autoria.ts` (`source:"app"` sin
   * `userId`), que es lo medido contra la cuenta el 2026-08-04.
   */
  auditorFuentesIa: (): string[] =>
    (process.env.AUDITOR_FUENTES_IA ?? "app")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  /**
   * ── Prueba en vivo, 2026-08-06 (decisión de Fabio) ──────────────────
   *
   * El default deja de estar vacío y trae el `userId` de **Jorge Quiroz**, porque el agente
   * de texto de esta subcuenta cambió de firma: el 2026-08-04 mandaba `source:"app"` **sin**
   * `userId` —que es como se midió la tabla de `autoria.ts`— y hoy manda firmado con la
   * cuenta de Jorge. Medido sobre la conversación de prueba de las 19:05–20:04: los 5
   * mensajes del agente llegan con `source:"app"` y `userId:"0peGoq7VvFqnDGA7gxtX"`, que
   * `GET /users/{id}` identifica como Jorge Quiroz (jorgesjnw2016@gmail.com, admin).
   *
   * Sin esto el auditor queda **ciego**: los clasifica como `asesor`, el debounce cuenta 0
   * mensajes de IA y el portón 5 corta con "la conversación no tiene ningún mensaje del
   * agente" — verificado contra producción antes de tocar nada.
   *
   * **El costo, dicho en voz alta:** Jorge es una persona real. Mientras esto esté puesto,
   * lo que él escriba A MANO también cuenta como del bot, y el auditor puede juzgarlo como
   * tal. Es exactamente el error que D16 llama caro, aceptado a propósito y por un rato:
   * Fabio lo pidió para ver al auditor trabajar durante las pruebas.
   *
   * ── El default hardcodeado se fue (2026-08-07) ───────────────────────
   *
   * Decía `?? "0peGoq7VvFqnDGA7gxtX"`, que es el userId de GHL de **Jorge Quiroz** — una
   * persona real de la subcuenta de ARIA. Con cinco empresas eso es doblemente falso: ese id
   * no existe en las otras subcuentas, y si por casualidad existiera sería de otra persona.
   * Peor: hacía que los mensajes de un humano se clasificaran como `agente_ia`, y de esa
   * clasificación cuelga qué conversación audita el auditor y a quién le atribuye cada frase.
   *
   * Ahora sin default. Vacío significa "no sé reconocer al bot por usuario", que es la verdad
   * mientras el agente mande bajo la cuenta de una persona. La clasificación cae entonces a
   * `auditorFuentesIa()`, que es por `source` y no por persona.
   *
   * Se configura con `AUDITOR_USER_IDS_IA` (lista separada por comas). Debería ser por
   * empresa, no global — anotado como deuda, no alcanza a bloquear el lanzamiento.
   */
  auditorUserIdsIa: (): string[] =>
    (process.env.AUDITOR_USER_IDS_IA ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),

  /**
   * El interruptor que saltea el portón 2 — el que exige el tag `bot_activado`.
   *
   * ── APAGADO por default desde el 2026-08-07 ───────────────────────────
   *
   * Estuvo **encendido** por default entre el 06 y el 07 de agosto: fue una prueba que Fabio
   * pidió para ver al auditor trabajar, sabiendo que podía escribir tags en GHL. Pidió
   * apagarlo y dejarlo como estaba, así que rige otra vez **D8**: la plataforma no adivina el
   * estado del bot, se espera el tag.
   *
   * El default se invirtió en el CÓDIGO y no se apagó con la variable en Vercel, y la
   * diferencia importa: un default peligroso que se desactiva con una variable de entorno se
   * vuelve a encender solo en cualquier entorno donde la variable no esté —un preview, un
   * clon local, un proyecto nuevo—. Un modo de prueba tiene que costar trabajo activarlo, no
   * desactivarlo.
   *
   * **Cómo se enciende** para otra prueba: `AUDITOR_SIN_PORTON_TAGS=1` en Vercel. Cualquier
   * otro valor, o su ausencia, deja el portón puesto.
   *
   * Consecuencia conocida y aceptada: mientras los workflows 🟦 08.1/08.2 de Fabio sigan
   * en borrador, **cero contactos pasan el portón** y el auditor no analiza nada. Es el estado
   * correcto — no auditar es mejor que auditar a quien nadie marcó.
   */
  auditorSinPortonTags: (): boolean => process.env.AUDITOR_SIN_PORTON_TAGS === "1",

  /** Cuántos mensajes de la IA hacen falta para disparar un análisis (regla de Fabio: 5). */
  auditorUmbralIa: (): number => Number(process.env.AUDITOR_UMBRAL_IA ?? 5),

  /** Ventana del candado por contacto, en segundos. Techo duro de un análisis por contacto. */
  auditorClaimSegundos: (): number => Number(process.env.AUDITOR_CLAIM_S ?? 120),

  /**
   * Conversación sin actividad reciente = no se analiza al activar el debounce, solo se
   * siembra la línea base. Evita que un backfill dispare cientos de inferencias de una.
   */
  auditorDiasArranque: (): number => Number(process.env.AUDITOR_DIAS_ARRANQUE ?? 14),

  /**
   * `auditorEsfuerzo` se BORRÓ el 2026-08-08. Leía `AUDITOR_EFFORT` y ya no la llamaba nadie
   * —el esfuerzo es `ESFUERZO_AUDITOR`, constante del código, desde la `028`—, pero dejarla es
   * exactamente el modo de fallar que la `028` documenta: un lector de variable de entorno que
   * sobrevive a su escritor es una perilla esperando que alguien la vuelva a enchufar.
   */

  /**
   * Agentes de voz nuevos sin esperar un deploy: `{"cmXXXX":"lead_flow_voz"}`.
   *
   * El mapa de código (`src/lib/assistable.ts`) tiene hoy un solo asistente porque es el único
   * que llamó. El día que Lead Flow empiece a marcar, sus llamadas van a caer en `voz_ia`
   * hasta que alguien lo agregue — esta variable es para que ese alguien no tenga que ser yo.
   *
   * Un JSON roto no tumba el webhook: se ignora y se sigue con el mapa de código, que es el
   * comportamiento correcto porque la alternativa es perder la llamada por una coma de más.
   */
  asistentesVozExtra: (): Record<string, string> => {
    const crudo = process.env.ASISTENTES_VOZ_EXTRA;
    if (!crudo) return {};
    try {
      const v = JSON.parse(crudo);
      return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
    } catch {
      console.error("[env] ASISTENTES_VOZ_EXTRA no es JSON válido: se ignora.");
      return {};
    }
  },
};
