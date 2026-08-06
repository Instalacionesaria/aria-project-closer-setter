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
const SUPABASE_URL_SOFIA = "https://pajhjpzydkkpmjdofqqp.supabase.co";

export const env = {
  supabaseUrl: () => process.env.SUPABASE_URL ?? SUPABASE_URL_SOFIA,
  supabaseServiceKey: () => requerida("SUPABASE_SERVICE_ROLE_KEY"),

  /**
   * Private Integration Token de GHL.
   *
   * Se acepta `GHL_PIT` (el nombre con el que ya está configurado en Vercel) y
   * `GHL_API_KEY` como alias. Un solo nombre habría obligado a renombrar la variable
   * existente, que es justo el tipo de cambio que rompe un deploy sin dejar rastro.
   */
  ghlApiKey: () => process.env.GHL_PIT ?? requerida("GHL_API_KEY"),
  ghlLocationId: () => requerida("GHL_LOCATION_ID"),

  /** Calendario "Aria | Llamada de Descubrimiento". Sin uso todavía — es para los links del menú "+" (§10). */
  ghlCalendarioPorDefecto: () => process.env.GHL_DEFAULT_CALENDAR_ID,

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

  /** Presencia de credenciales, sin exponerlas — para el endpoint de diagnóstico. */
  tieneCredencialesGhl: () => Boolean((process.env.GHL_PIT ?? process.env.GHL_API_KEY) && process.env.GHL_LOCATION_ID),
  tieneCredencialesSupabase: () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),

  /* ── Auditor de IA ────────────────────────────────────────────────────── */

  /**
   * Cómo reconocer al chatbot de GHL entre los mensajes salientes.
   *
   * Son válvulas para no tener que desplegar si Francisco confirma que el bot de esta
   * subcuenta firma distinto. Sin ellas rige el default de `autoria.ts` (`source:"app"` sin
   * `userId`), que es lo medido contra la cuenta el 2026-08-04.
   */
  auditorFuentesIa: (): string[] =>
    (process.env.AUDITOR_FUENTES_IA ?? "app")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  auditorUserIdsIa: (): string[] =>
    (process.env.AUDITOR_USER_IDS_IA ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),

  /** Cuántos mensajes de la IA hacen falta para disparar un análisis (regla de Fabio: 5). */
  auditorUmbralIa: (): number => Number(process.env.AUDITOR_UMBRAL_IA ?? 5),

  /** Ventana del candado por contacto, en segundos. Techo duro de un análisis por contacto. */
  auditorClaimSegundos: (): number => Number(process.env.AUDITOR_CLAIM_S ?? 120),

  /**
   * Conversación sin actividad reciente = no se analiza al activar el debounce, solo se
   * siembra la línea base. Evita que un backfill dispare cientos de inferencias de una.
   */
  auditorDiasArranque: (): number => Number(process.env.AUDITOR_DIAS_ARRANQUE ?? 14),

  /** Esfuerzo de razonamiento del auditor. Se deja configurable para poder barrerlo sin deploy. */
  auditorEsfuerzo: (): string => process.env.AUDITOR_EFFORT ?? "medium",

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
