/**
 * `GET /api/closer/pipeline` — el Pipeline completo del closer, desde la CACHÉ. Cero GHL.
 *
 * Hasta el 2026-07-31 este endpoint paginaba `POST /contacts/search` contra GHL en cada
 * request — y el frontend lo pedía cada 30 segundos. Ahora lee `closer_contactos`, que
 * mantienen el webhook, la reconciliación de mensajes y el cron de citas. El modelo de
 * negocio no cambió: **el Pipeline son TODOS los contactos del territorio, clasificados en
 * una de siete etapas** — lo que cambió es quién es la fuente de verdad de la etapa.
 *
 * ## La etapa: Supabase manda (doc §1 — INVIERTE la arquitectura anterior)
 *
 * `stage_key` lo escribe Avanzar (`proyectarAvance`) y NADIE más: el refresco de contacto
 * (`sincronizarContacto`) no toca ese campo a propósito. Para un contacto que todavía no
 * recibió ningún Avanzar, `stage_key` es null y la etapa se deriva de los tags UNA vez en
 * la lectura (`etapaDesdeTags` — la misma función de siempre). En cuanto hay un Avanzar,
 * la caché gana y GHL no vuelve a pisar la etapa.
 *
 * ## Congelados (§7)
 *
 * Los contactos sin `zona_closer` viajan con `congelado: true` — siguen visibles y
 * movibles (solo internamente), nunca desaparecen. La vista decide cómo atenuarlos.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { contarPorEtapa, desenlaceDesdeTags, ETAPAS_ORDEN, etapaDesdeTags } from "../../src/lib/ghl/etapas.js";
import { ghl } from "../_lib/ghl/index.js";
import { db } from "../_lib/repo.js";

interface FilaContacto {
  ghl_contact_id: string;
  nombre: string | null;
  fuente: string | null;
  tags: string[] | null;
  stage_key: string | null;
  congelado: boolean;
  monto: number | null;
  nivel_interes_seguimiento: string | null;
  motivo_descalificacion: string | null;
  forma_pago_venta: string | null;
  razon_noshow: string | null;
  origen_nurture: string | null;
  cita_el: string | null;
  cita_meet_url: string | null;
  ultimo_entrante_el: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Usá GET." });
  }

  try {
    const { data, error } = await db()
      .from("closer_contactos")
      .select(
        "ghl_contact_id, nombre, fuente, tags, stage_key, congelado, monto, " +
          "nivel_interes_seguimiento, motivo_descalificacion, forma_pago_venta, razon_noshow, origen_nurture, " +
          "cita_el, cita_meet_url, ultimo_entrante_el",
      );
    if (error) throw new Error(`closer_contactos: ${error.message}`);

    // El select multilínea rompe la inferencia de supabase-js (devuelve su tipo de error
    // genérico), así que el shape se declara a mano — las columnas están una línea arriba.
    const filas = (data ?? []) as unknown as FilaContacto[];

    const contactos = filas
      .map((f) => {
        const tags = (f.tags ?? []).map((t) => t.trim().toLowerCase());
        const desenlace = desenlaceDesdeTags(tags);
        /**
         * Supabase manda: si Avanzar ya escribió `stage_key`, esa es la etapa. El fallback
         * de tags cubre SOLO al contacto que nunca recibió un Avanzar (recién dado de alta
         * por su cita) — la "derivación una única vez" del plan aprobado.
         */
        const etapa = (f.stage_key as ReturnType<typeof etapaDesdeTags> | null) ?? etapaDesdeTags(tags);

        return {
          ghlContactId: f.ghl_contact_id,
          nombre: f.nombre,
          fuente: f.fuente ?? "DIRECTO",
          etapa,
          tagDesenlace: desenlace?.tag ?? null,
          tags: f.tags ?? [],
          congelado: f.congelado,
          /** Solo la etapa Ganado tiene dinero cobrado; el resto viaja null (§27.A). */
          monto: etapa === "ganado" ? f.monto : null,
          subcategorias: {
            seguimiento: f.nivel_interes_seguimiento,
            descalificado: f.motivo_descalificacion,
            ganado: f.forma_pago_venta,
            no_show: f.razon_noshow,
            nurture: f.origen_nurture,
          },
          citaEl: f.cita_el,
          citaMeetUrl: f.cita_meet_url,
          ultimoEntranteEl: f.ultimo_entrante_el,
        };
      })
      // Orden estable por etapa y nombre: dos requests iguales devuelven lo mismo. El front
      // agrupa, filtra y ordena como quiera.
      .sort((a, b) => {
        const porEtapa = ETAPAS_ORDEN.indexOf(a.etapa) - ETAPAS_ORDEN.indexOf(b.etapa);
        if (porEtapa !== 0) return porEtapa;
        return (a.nombre ?? "").localeCompare(b.nombre ?? "", "es");
      });

    const activos = contactos.filter((c) => !c.congelado);
    const enJuego = activos.filter((c) => !["ganado", "no_show", "nurture", "descalificado"].includes(c.etapa));

    return res.status(200).json({
      ok: true,
      ghlModo: ghl().modo,
      total: contactos.length,
      /** Siempre las 7 claves (§38.D). Los congelados cuentan: siguen en su columna. */
      porEtapa: contarPorEtapa(contactos.map((c) => c.etapa)),
      contactos,
      /** Stats del doc §8.3, derivadas por query — nunca contadores sueltos. */
      stats: { baseTotal: activos.length, enJuegoActivo: enJuego.length, congelados: contactos.length - activos.length },
      fueraDeZonaCloser: 0,
      /**
       * La caché ES la lista completa del territorio: la mantienen webhook + cron, no una
       * paginación que pueda cortarse. `completo: true` deja de ser una promesa condicional.
       */
      cobertura: { completo: true, truncado: false, totalEnGhl: null, paginasLeidas: 0, fuente: "cache" },
      ...(contactos.length === 0
        ? {
            aviso:
              "La caché de contactos está vacía. Se llena con el webhook de citas de Francisco o el cron de :25/:55 — " +
              "si es un entorno recién configurado, POST /api/closer/citas-respaldo la puebla.",
          }
        : {}),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
