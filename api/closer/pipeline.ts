/**
 * `GET /api/closer/pipeline` — el Pipeline completo del closer, con datos reales de GHL.
 *
 * El modelo de negocio (Fabio, 2026-07-30) lo define en una línea: **el Pipeline son TODOS
 * los contactos con el tag `zona_closer`, clasificados en una de siete etapas** según lo
 * último que se les registró en Avanzar. No es una cola de trabajo como Mi Día: acá está
 * todo el territorio, incluidos los ganados, los descalificados y los que están en nurture.
 *
 * Dos cosas hace este endpoint y ninguna más:
 *
 *   1. **Traer el territorio entero.** No la primera página: TODO. Ver la sección de
 *      paginación más abajo — es la decisión de diseño que sostiene la frase "todos".
 *   2. **Clasificar.** La etapa la deduce `etapaDesdeTags()` (`src/lib/ghl/etapas.ts`), que
 *      es la misma función que importa el front. En GHL no hay campo "etapa" que leer: el
 *      stage lo mueve un workflow disparado por el tag, y la búsqueda de contactos devuelve
 *      tags. La deducción vive en un solo lugar para que servidor y browser no discrepen.
 *
 * Lo que NO hace: armar píldoras, ordenar columnas, decidir qué se renderiza. `CONTRATO-GHL`
 * §0 deja la presentación del lado del tool; acá viajan datos crudos más la etapa.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { perteneceAlCloser, TAGS } from "../../src/lib/ghl/contrato.js";
import { contarPorEtapa, desenlaceDesdeTags, ETAPAS_ORDEN, ETAPA_DE_ENTRADA } from "../../src/lib/ghl/etapas.js";
import { env } from "../_lib/env.js";
import { ghl } from "../_lib/ghl/index.js";

const BASE = "https://services.leadconnectorhq.com";
/** Misma versión del contrato de la API v2 que usan `real.ts` y `lectura.ts`. */
const VERSION = "2021-07-28";

/** Tope duro de `pageLimit` en `POST /contacts/search`. Pedir más no trae más. */
const POR_PAGINA = 100;

/**
 * Techo de páginas = 2.000 contactos. No es el límite esperado sino el freno de emergencia:
 * si el cursor de GHL cambiara de forma y el bucle dejara de avanzar, esto lo corta y la
 * respuesta lo dice (`cobertura.truncado`), en vez de colgar la función hasta el timeout.
 */
const TOPE_PAGINAS = 20;

/* ================================================================== */
/* Búsqueda paginada                                                   */
/* ================================================================== */

/**
 * ── Por qué se implementó la paginación y no un `truncado: true` a secas ──
 *
 * `contactosConTag()` (`api/_lib/ghl/lectura.ts`) pide una sola página de 50 y no pagina.
 * Para el Buzón o la cola roja alcanza: son puñados de contactos por definición. Para el
 * Pipeline no, y no por un caso borde:
 *
 *   · `zona_closer` NO SE QUITA NUNCA — el swap desde `zona_setter` es de una sola vía
 *     (`contrato.ts`, `TAGS.zonaCloser`). El territorio solo crece.
 *   · El negocio maneja cientos de leads por mes (CLAUDE.md §46).
 *
 * O sea: pasar el tope no es una eventualidad, es el estado normal a los dos meses de uso.
 * Un Pipeline que muestra 100 de 400 contactos y los reparte en columnas con conteos que
 * parecen totales no está "un poco incompleto": está mintiendo sobre el negocio, y encima
 * en la vista que se usa para decidir a quién perseguir.
 *
 * ── Cómo pagina la API v2 ──
 *
 * `POST /contacts/search` devuelve `total` (el conteo real del filtro) y, en cada contacto,
 * un cursor `searchAfter`. Se manda el `searchAfter` del último contacto de la página para
 * pedir la siguiente; `page` queda como plan B por si la respuesta no trajera cursor.
 *
 * ── Honestidad cuando la paginación no alcanza ──
 *
 * No se asume que el cursor funcione. El bucle corta si una página no aporta ningún id
 * nuevo (que es lo que pasaría si GHL ignorara el cursor y devolviera siempre lo mismo), si
 * se llega al techo de páginas, o si una página falla después de que otras salieron bien.
 * En los tres casos se devuelve lo que se pudo leer con `cobertura.completo: false` y el
 * motivo escrito — la lista parcial se rotula como parcial, nunca como el total.
 */
interface ContactoCrudo {
  id: string;
  nombre: string | null;
  fuente: string;
  tags: string[];
}

interface Barrido {
  contactos: ContactoCrudo[];
  /** Lo que GHL dice que hay para este filtro. `null` si no lo informó. */
  totalEnGhl: number | null;
  paginasLeidas: number;
  /** Por qué se dejó de leer antes de terminar. Ausente = se leyó todo (§4.10). */
  corte?: string;
}

async function buscarPagina(cuerpo: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${BASE}/contacts/search`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.ghlApiKey()}`,
      Version: VERSION,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cuerpo),
  });

  if (!r.ok) {
    const detalle = await r.text();
    throw new Error(`GHL ${r.status} en POST /contacts/search: ${detalle.slice(0, 300)}`);
  }
  return r.json();
}

/**
 * Mismo mapeo que hace `contactosConTag()` en `lectura.ts`, con UNA diferencia deliberada:
 * cuando GHL no tiene nombre, acá viaja `null` y no el literal `"Sin nombre"`. La regla
 * §4.10 es explícita: sin dato real, el campo no se inventa — el front pinta un placeholder
 * como si fuera verdad. Quién decide qué mostrar en ese hueco es la vista.
 *
 * La derivación de la fuente está duplicada de `lectura.ts` a propósito: ahí es una función
 * privada y ese archivo lo está ampliando otro frente en paralelo. Cuando se estabilice, hay
 * que exportarla desde allá, importarla acá y borrar esta copia.
 */
function mapearContacto(c: any): ContactoCrudo | null {
  if (!c?.id) return null;

  const nombre = (c.contactName || [c.firstName, c.lastName].filter(Boolean).join(" ")).trim();
  const tags: string[] = Array.isArray(c.tags) ? c.tags : [];

  return { id: c.id, nombre: nombre || null, fuente: derivarFuente(tags), tags };
}

/** El chip de fuente sale de los tags — ninguna fila queda sin origen (§8: fallback DIRECTO). */
function derivarFuente(tags: string[]): string {
  const bajos = tags.map((t) => t.toLowerCase());
  if (bajos.includes("lead_meta_ads")) return "META ADS";
  if (bajos.some((t) => t.includes("vsl"))) return "VSL OPT-IN";
  if (bajos.some((t) => t.includes("instagram") || t === "ig")) return "📷 IG PROFILE";
  return "DIRECTO";
}

async function barrerZonaCloser(): Promise<Barrido> {
  const contactos: ContactoCrudo[] = [];
  const vistos = new Set<string>();
  let totalEnGhl: number | null = null;
  let searchAfter: unknown[] | undefined;
  let paginasLeidas = 0;

  while (paginasLeidas < TOPE_PAGINAS) {
    const cuerpo: Record<string, unknown> = {
      locationId: env.ghlLocationId(),
      pageLimit: POR_PAGINA,
      filters: [{ field: "tags", operator: "contains", value: TAGS.zonaCloser.valor }],
    };
    // Con cursor se pide "lo que sigue"; sin él, se cae a la paginación por número de página.
    if (searchAfter) cuerpo.searchAfter = searchAfter;
    else if (paginasLeidas > 0) cuerpo.page = paginasLeidas + 1;

    let datos: any;
    try {
      datos = await buscarPagina(cuerpo);
    } catch (e) {
      // La primera página que falla es un error de verdad: sin nada que devolver, que lo
      // maneje el handler como 500. Si ya hay contactos leídos, se prefiere entregarlos
      // rotulados como parciales antes que perder el barrido entero por una página.
      if (paginasLeidas === 0) throw e;
      return { contactos, totalEnGhl, paginasLeidas, corte: `Falló la página ${paginasLeidas + 1}: ${(e as Error).message}` };
    }

    paginasLeidas += 1;

    const crudos: any[] = Array.isArray(datos?.contacts) ? datos.contacts : [];
    if (typeof datos?.total === "number") totalEnGhl = datos.total;

    let nuevos = 0;
    for (const c of crudos) {
      const contacto = mapearContacto(c);
      if (!contacto || vistos.has(contacto.id)) continue;
      vistos.add(contacto.id);
      contactos.push(contacto);
      nuevos += 1;
    }

    // Última página: vino incompleta, no hay más que pedir.
    if (crudos.length < POR_PAGINA) return { contactos, totalEnGhl, paginasLeidas };

    // Ya tenemos todo lo que GHL dice que hay.
    if (totalEnGhl !== null && contactos.length >= totalEnGhl) {
      return { contactos, totalEnGhl, paginasLeidas };
    }

    /**
     * Página llena que no aportó un solo id nuevo = el cursor no avanzó (GHL lo ignoró o
     * cambió de forma). Seguir sería un bucle infinito devolviendo siempre lo mismo.
     */
    if (nuevos === 0) {
      return {
        contactos,
        totalEnGhl,
        paginasLeidas,
        corte:
          "La página repitió contactos ya leídos: el cursor de paginación de GHL no avanzó. " +
          "La lista está cortada donde dejó de avanzar.",
      };
    }

    const ultimo = crudos[crudos.length - 1];
    searchAfter = Array.isArray(ultimo?.searchAfter) ? ultimo.searchAfter : undefined;
  }

  return {
    contactos,
    totalEnGhl,
    paginasLeidas,
    corte:
      `Se alcanzó el techo de ${TOPE_PAGINAS} páginas (${TOPE_PAGINAS * POR_PAGINA} contactos). ` +
      "Es un freno de emergencia, no el tamaño esperado del territorio: si se llega acá de " +
      "forma habitual, el Pipeline necesita paginar del lado del front.",
  };
}

/* ================================================================== */
/* Handler                                                             */
/* ================================================================== */

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  /**
   * Sin credenciales no hay error: hay Pipeline vacío y un aviso. Un 500 acá pintaría la
   * vista de rojo en un clone recién bajado, cuando la única verdad es que este entorno no
   * está conectado a GHL. Mismo criterio que `lectura.ts` (devuelve vacío en modo stub) y
   * que el resto de los endpoints del módulo.
   */
  if (!env.tieneCredencialesGhl()) {
    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      total: 0,
      porEtapa: contarPorEtapa([]),
      contactos: [],
      fueraDeZonaCloser: 0,
      cobertura: {
        completo: false,
        truncado: false,
        totalEnGhl: null,
        paginasLeidas: 0,
        tope: { porPagina: POR_PAGINA, paginas: TOPE_PAGINAS },
        motivo: "Sin credenciales de GHL en este entorno: no se consultó nada. La lista está vacía porque no se leyó, no porque no haya contactos.",
      },
      aviso: "GHL no está configurado (falta GHL_PIT o GHL_LOCATION_ID). El Pipeline no tiene datos reales que mostrar.",
    });
  }

  try {
    const barrido = await barrerZonaCloser();

    /**
     * La búsqueda ya filtra por `zona_closer`, así que esto no debería sacar a nadie. Se
     * verifica igual —y se reporta cuántos cayeron— porque el filtro `contains` de GHL es
     * de ellos, no nuestro: si algún día matcheara por prefijo, un tag como
     * `zona_closer_2027` metería contactos ajenos en el Pipeline sin que nadie lo note.
     * `exigirZonaCloser: true` es explícito: el default de la función es `false` (la semilla
     * del demo no tiene tags), pero acá los contactos vienen de GHL y sí los tienen.
     */
    const delCloser = barrido.contactos.filter((c) =>
      // Los tags se normalizan antes de preguntar: `perteneceAlCloser` compara exacto, y una
      // sola mayúscula del lado de GHL vaciaría el Pipeline entero en silencio. El criterio
      // sigue viviendo en la función; acá solo se le da el dato limpio, igual que hace
      // `etapaDesdeTags` al clasificar.
      perteneceAlCloser(c.tags.map((t) => t.trim().toLowerCase()), true),
    );

    const contactos = delCloser
      .map((c) => {
        const desenlace = desenlaceDesdeTags(c.tags);
        return {
          ghlContactId: c.id,
          nombre: c.nombre,
          fuente: c.fuente,
          // Sin desenlace, la etapa de ENTRADA — la constante y no el literal, para que la
          // regla viva en un solo lugar (`etapas.ts`) y no repetida en cada consumidor.
          etapa: desenlace?.etapa ?? ETAPA_DE_ENTRADA,
          /**
           * El tag que decidió la etapa, o `null` si no tiene ninguno (y entonces está en la
           * etapa de entrada). Viaja para poder responder "¿por qué está en esta columna?"
           * sin abrir GHL — con tags acumulados, esa pregunta aparece sola.
           */
          tagDesenlace: desenlace?.tag ?? null,
          tags: c.tags,
        };
      })
      /**
       * Orden estable por etapa (el mismo recorrido del Pipeline) y después por nombre. No es
       * presentación: es que dos requests iguales devuelvan lo mismo. El front agrupa,
       * filtra y ordena como quiera.
       */
      .sort((a, b) => {
        const porEtapa = ETAPAS_ORDEN.indexOf(a.etapa) - ETAPAS_ORDEN.indexOf(b.etapa);
        if (porEtapa !== 0) return porEtapa;
        return (a.nombre ?? "").localeCompare(b.nombre ?? "", "es");
      });

    const truncado = Boolean(barrido.corte) || (barrido.totalEnGhl !== null && barrido.contactos.length < barrido.totalEnGhl);

    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      /**
       * Plano y no agrupado, con los conteos aparte. Tres razones:
       *  · El Pipeline tiene que renderizar las SIETE columnas aunque estén vacías (§38.D),
       *    y `porEtapa` ya trae las siete claves — agrupar el array no agregaría nada.
       *  · La vista filtra por etapa, por grade y por destacados; sobre un array plano eso es
       *    un `.filter`, sobre un objeto agrupado hay que rearmarlo.
       *  · Agregar una etapa octava no cambia la forma de la respuesta.
       */
      total: contactos.length,
      porEtapa: contarPorEtapa(contactos.map((c) => c.etapa)),
      contactos,
      /** Cuántos devolvió la búsqueda sin tener `zona_closer` de verdad. Debería ser 0. */
      fueraDeZonaCloser: barrido.contactos.length - delCloser.length,
      /**
       * Honestidad sobre el alcance de la lista. `completo: true` significa "esto es TODO el
       * territorio"; con `false`, el front tiene que avisar que la vista está recortada —
       * los conteos por etapa son de lo leído, no del negocio.
       */
      cobertura: {
        completo: !truncado,
        truncado,
        totalEnGhl: barrido.totalEnGhl,
        paginasLeidas: barrido.paginasLeidas,
        tope: { porPagina: POR_PAGINA, paginas: TOPE_PAGINAS },
        ...(barrido.corte ? { motivo: barrido.corte } : {}),
        ...(!barrido.corte && truncado
          ? {
              motivo:
                `GHL informa ${barrido.totalEnGhl} contactos con ${TAGS.zonaCloser.valor} y se leyeron ` +
                `${barrido.contactos.length}. La lista está incompleta.`,
            }
          : {}),
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
