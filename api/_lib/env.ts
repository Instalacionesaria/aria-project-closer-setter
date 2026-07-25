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

export const env = {
  supabaseUrl: () => requerida("SUPABASE_URL"),
  supabaseServiceKey: () => requerida("SUPABASE_SERVICE_ROLE_KEY"),

  ghlApiKey: () => requerida("GHL_API_KEY"),
  ghlLocationId: () => requerida("GHL_LOCATION_ID"),

  /**
   * `real` activa las llamadas a GHL. Cualquier otro valor (o ausencia) deja el stub, que
   * registra la intención en el outbox sin llamar a nadie.
   *
   * El default es stub a propósito: si alguien despliega sin configurar nada, el sistema
   * anota lo que habría hecho en vez de fallar o, peor, de escribir en la cuenta real por
   * accidente.
   */
  ghlModo: (): "real" | "stub" => (process.env.GHL_MODO === "real" ? "real" : "stub"),

  /** Presencia de credenciales, sin exponerlas — para el endpoint de diagnóstico. */
  tieneCredencialesGhl: () => Boolean(process.env.GHL_API_KEY && process.env.GHL_LOCATION_ID),
  tieneCredencialesSupabase: () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
};
