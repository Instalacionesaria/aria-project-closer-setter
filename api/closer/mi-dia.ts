/**
 * `GET /api/closer/mi-dia` — la cola de "Seguimientos de hoy".
 *
 * ## Qué dice el modelo de negocio y qué devuelve la vista
 *
 * El modelo (Fabio, 2026-07-30) es tajante para esta sección: **Mi Día → Seguimientos muestra
 * SOLO los seguimientos MANUALES programados para ESE día.** El contraste es con el Pipeline,
 * que muestra TODOS los que están en seguimiento (automáticos y manuales).
 *
 * La vista `closer_seguimientos_de_hoy` devuelve hoy tres poblaciones distintas:
 *   1. manuales con `fecha_objetivo = hoy` — lo único que el modelo pide;
 *   2. manuales VENCIDOS de días anteriores (el predicado es `fecha_objetivo <= hoy`);
 *   3. series automáticas AGOTADAS (`estado = 'agotado'`), que CLAUDE.md §16.1.D define como
 *      una tarea real ("Seguimiento agotado — revisar").
 *
 * La vista no se toca desde acá (vive en `docs/db/`, es de otro frente) y **tampoco se filtra
 * en este endpoint**: descartar filas en el servidor las haría desaparecer sin que nadie pueda
 * verlas — y un seguimiento manual vencido que no aparece no vuelve nunca, porque no hay cron
 * que lo reviva. Lo que sí se hace es CLASIFICAR: cada fila viaja con su `caso`, y la vista
 * decide si los muestra juntos, separados, o filtra los que no quiere. La decisión de producto
 * se toma en un solo lugar visible en vez de quedar escondida en un `where`.
 *
 * ## De dónde sale cada dato
 *
 * El nombre y los tags del contacto salen de GHL, que es la fuente de verdad; la fecha
 * objetivo sale de SOFIA, que es lo único que GHL no guarda. `hoy` lo calcula Postgres
 * (`closer_hoy_org()`), nunca Node ni el browser.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { derivarFila, type Seguimiento } from "../../src/lib/seguimientos/dominio.js";
import { ghl } from "../_lib/ghl/index.js";
import { db, hoyOrg } from "../_lib/repo.js";

/**
 * De qué caso es cada fila. Es un dato CRUDO — el texto, el color y el orden los pone la vista.
 *
 *   - `manual_de_hoy`      → lo único que el modelo de negocio pide en esta sección.
 *   - `manual_vencido`     → su día ya pasó y nadie lo atendió. Sigue viniendo porque, si no
 *                            aparece, se pierde para siempre.
 *   - `serie_agotada`      → la serie automática terminó sin respuesta (§16.1.D). Es una tarea,
 *                            pero NO es "un seguimiento de hoy": merece su propio tratamiento.
 *   - `automatico_en_curso`→ no debería llegar nunca: la vista excluye las series en curso
 *                            ("el sistema persigue por ti", §16.1.B / §40.E). Existe para que,
 *                            si un cambio en el SQL las dejara pasar, se vean como lo que son
 *                            en vez de contarse como manuales de hoy.
 */
export type CasoSeguimiento = "manual_de_hoy" | "manual_vencido" | "serie_agotada" | "automatico_en_curso";

export function clasificarCaso(modo: string, estado: string, diasVencido: number): CasoSeguimiento {
  // El estado manda sobre el modo: 'agotado' es el único camino por el que un automático
  // genera tarea humana, y es lo que lo distingue de un manual que venció.
  if (estado === "agotado") return "serie_agotada";
  if (modo === "automatico") return "automatico_en_curso";
  return diasVencido > 0 ? "manual_vencido" : "manual_de_hoy";
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const { data, error } = await db()
      .from("closer_seguimientos_de_hoy")
      .select("*")
      .order("fijada", { ascending: false })
      .order("fecha_objetivo", { ascending: true });

    if (error) throw new Error(error.message);

    const hoy = await hoyOrg();
    const filas = data ?? [];

    /**
     * Un contacto por request a GHL. Con la cola de un closer son pocos; si algún día son
     * decenas, esto pasa a un solo `POST /contacts/search` por lote. No se optimiza antes
     * de que duela.
     *
     * Si GHL no responde por un contacto, la fila igual se devuelve con el nombre en null:
     * el seguimiento existe y el closer tiene que verlo, aunque falte el adorno.
     */
    const cola = await Promise.all(
      filas.map(async (f) => {
        const contacto = await ghl().obtenerContacto(f.ghl_contact_id).catch(() => null);

        const seg: Seguimiento = {
          id: f.id,
          ghlContactId: f.ghl_contact_id,
          closerId: f.closer_id,
          situacion: f.situacion,
          modo: f.modo,
          fechaObjetivo: f.fecha_objetivo,
          estado: f.estado,
          nota: f.nota ?? undefined,
          serie: f.serie_key ? { key: f.serie_key, toques: f.serie_toques, dias: f.serie_dias } : undefined,
          creadoEl: f.creado_el,
          creadoPor: f.creado_por,
        };

        // La vista lo calcula con `closer_hoy_org()`, el mismo "hoy" que devuelve la respuesta.
        const diasVencido = Number(f.dias_vencido) || 0;

        return {
          ghlContactId: f.ghl_contact_id,
          nombre: contacto?.nombre ?? null,
          telefono: contacto?.telefono ?? null,
          tags: contacto?.tags ?? [],
          fijada: f.fijada,
          diasVencido,
          /** Qué clase de tarea es. Ver `CasoSeguimiento`: el modelo solo pide `manual_de_hoy`. */
          caso: clasificarCaso(f.modo, f.estado, diasVencido),
          seguimiento: seg,
          // COMPAT: microtexto y tinte ya resueltos. `CONTRATO-GHL.md` §0 dice que la
          // presentación es del tool, así que esto debería derivarlo el front llamando a
          // `derivarFila()` (es isomorfo, ya vive en `src/lib/`). Se mantiene porque hoy
          // `filaAContacto()` lo consume tal cual.
          fila: derivarFila(seg),
        };
      }),
    );

    /**
     * Cuántas filas hay de cada caso. Le permite a la vista pintar un contador por grupo sin
     * recorrer la lista, y hace visible de un vistazo cuánto de la cola NO es "manual de hoy".
     * Regla §4.1: un contador en cero no se renderiza — el número viaja igual y esa decisión
     * la toma la vista, que es donde vive la regla.
     */
    const resumen: Record<CasoSeguimiento, number> = {
      manual_de_hoy: 0,
      manual_vencido: 0,
      serie_agotada: 0,
      automatico_en_curso: 0,
    };
    for (const fila of cola) resumen[fila.caso]++;

    return res.status(200).json({
      ok: true,
      hoy,
      // Es el default de `closer_org_config.zona_horaria` y de `closer_hoy_org()`. Si algún día
      // se configura otra por organización, esto tiene que leerse de esa tabla.
      zonaHoraria: "America/Lima",
      ghlModo: ghl().modo,
      seguimientosHoy: cola,
      resumen,
      total: cola.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
