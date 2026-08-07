/**
 * El léxico del nivel 0 — español **latinoamericano**.
 *
 * ── Cómo leer este archivo ────────────────────────────────────────────
 *
 * Cada término está normalizado como lo va a comparar `heuristicas.ts`: **minúsculas, sin
 * acentos y sin puntuación**. Escribir `"está"` acá no matchearía nunca, porque el texto entrante
 * llega como `esta`. Es la trampa más fácil de este archivo y la razón de que haya un test que
 * la verifica.
 *
 * La comparación es por **expresión rodeada de espacios**, no por substring: `caro` no matchea
 * dentro de `carozo`. Eso también significa que una expresión de varias palabras (`no me sirve`)
 * matchea exactamente esa secuencia, no sus partes sueltas.
 *
 * ── Qué NO va acá ─────────────────────────────────────────────────────
 *
 * Nada que dependa del contexto para significar enojo. `"no"`, `"pero"`, `"todavía"` aparecen en
 * cualquier conversación normal y convertirían la alarma en ruido constante. La regla al agregar
 * un término: **si podés imaginarlo en una conversación que va bien, no va.**
 *
 * Y nada que sea un juicio sobre el agente. Esto mide lo que dijo el **contacto**; que el agente
 * lo haya hecho bien o mal lo decide el modelo, con cita textual.
 *
 * ── Cómo se mantiene ──────────────────────────────────────────────────
 *
 * La lista viva y comentada, con su historial y las variantes regionales pendientes, está en
 * `docs/13-LEXICO-AUDITOR.md`. **Ese documento y este archivo tienen que decir lo mismo** — un
 * test lo hace cumplir, para que no se conviertan en dos listas.
 */

/**
 * El contacto está molesto, impaciente o desconfía.
 *
 * Agrupado por familia para que agregar un término sea evidente dónde va.
 */
export const LEXICO_FRUSTRACION: readonly string[] = [
  // ── Enojo directo ──
  "estafa",
  "estafadores",
  "es una estafa",
  "me estan estafando",
  "no me jodan",
  "que falta de respeto",
  // Sin la diéresis: el normalizador la saca del texto entrante, así que `vergüenza` en esta
  // lista sería una entrada muerta. Lo cazó el test de normalización.
  "una verguenza",
  "pesimo",
  "pesima atencion",
  "horrible",
  "malisimo",

  // ── Impaciencia y demora ──
  "sigo esperando",
  "hace rato",
  "cuanto mas tengo que esperar",
  "nadie me responde",
  "no me responden",
  "ya pregunte",
  "ya te pregunte",
  "otra vez lo mismo",
  "te repito",
  "ya lo dije",

  // ── No entiende o no le sirve ──
  "no entiendes",
  "no me entiendes",
  "no entendes",
  "no me entendes",
  "no es lo que pregunte",
  "no es lo que pedi",
  "no me sirve",
  "no me estas ayudando",
  "no me ayudas",

  // ── Quiere salir del bot ──
  "quiero hablar con una persona",
  "hablar con un humano",
  "con un asesor",
  "con alguien real",
  "eres un bot",
  "sos un bot",
  "es un robot",
  "esto es un bot",

  // ── Abandono ──
  "olvidalo",
  "dejalo asi",
  "no me interesa mas",
  "ya no me interesa",
  "no gracias",
  "me arrepenti",
  "cancelen",
  "quiero cancelar",
] as const;

/**
 * El contacto quiere comprar o pagar.
 *
 * Es la señal que más urge de las cinco: alguien con la tarjeta en la mano encontrándose con un
 * bot que no entiende es el peor momento posible para no estar mirando.
 *
 * Ojo con el sesgo al agregar: `precio` **no** está y es deliberado — preguntar el precio es la
 * conversación normal de este negocio, no una intención de pago. Lo que va acá es la intención
 * de **cerrar**.
 */
export const LEXICO_INTENCION_COMPRA: readonly string[] = [
  // ── Quiere pagar ahora ──
  "quiero pagar",
  "como pago",
  "donde pago",
  "puedo pagar",
  "ya quiero pagar",
  "pasame el link de pago",
  "el link de pago",
  "link para pagar",
  "datos para transferir",
  "a que cuenta transfiero",
  "numero de cuenta",
  "ya transferi",
  "ya pague",
  "hice la transferencia",
  "mande el comprobante",

  // ── Quiere comprar ──
  "quiero comprarlo",
  "lo quiero comprar",
  "quiero contratar",
  "quiero empezar",
  "como me inscribo",
  "donde me inscribo",
  "como me anoto",
  "dame el link",

  // ── Medios de pago ──
  "acepta tarjeta",
  "aceptan tarjeta",
  "puedo pagar en cuotas",
  "hay financiamiento",
  "cuotas sin interes",
  "por mercadopago",
  "por yape",
  "por plin",
  "por transferencia",
] as const;
