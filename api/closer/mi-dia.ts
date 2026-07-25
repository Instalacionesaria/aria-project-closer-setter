/**
 * `GET /api/closer/mi-dia` — la cola de "Seguimientos de hoy".
 *
 * La regla de qué entra vive en la vista `closer_seguimientos_de_hoy`, en SQL: solo
 * seguimientos manuales vencidos o de hoy, más series agotadas. Una serie automática en
 * curso NO genera fila — "el sistema persigue por ti" (§16.1.B), y si el sistema trabaja no
 * hay tarea humana (§40.E).
 *
 * El nombre y los tags del contacto salen de GHL, que es la fuente de verdad; la fecha
 * objetivo sale de SOFIA, que es lo único que GHL no guarda. El microtexto y el tinte los
 * deriva el propio front (`derivarFila`), porque `CONTRATO-GHL.md` §0 dice que la
 * presentación es del tool.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { derivarFila, type Seguimiento } from "../../src/lib/seguimientos/dominio.js";
import { ghl } from "../_lib/ghl/index.js";
import { db, hoyOrg } from "../_lib/repo.js";

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

        return {
          ghlContactId: f.ghl_contact_id,
          nombre: contacto?.nombre ?? null,
          telefono: contacto?.telefono ?? null,
          tags: contacto?.tags ?? [],
          fijada: f.fijada,
          diasVencido: f.dias_vencido,
          seguimiento: seg,
          fila: derivarFila(seg),
        };
      }),
    );

    return res.status(200).json({
      ok: true,
      hoy,
      zonaHoraria: "America/Lima",
      ghlModo: ghl().modo,
      seguimientosHoy: cola,
      // Regla §4.1: un contador en cero no se renderiza. Se manda el número igual y la
      // decisión de mostrarlo la toma la vista, que es donde vive esa regla.
      total: cola.length,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
