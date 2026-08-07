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
import { INDICADORES_VACIOS } from "../../src/lib/indicadores.js";
import { fechaHoraOrg } from "../_lib/citas.js";
import { env } from "../_lib/env.js";
import { cargarIndicadores } from "../_lib/indicadores.js";
import { db, ORG_ID } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

interface FilaContacto {
  ghl_contact_id: string;
  nombre: string | null;
  telefono: string | null;
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
  llamadas_ia_intentos: number | null;
  llamadas_ia_contestadas: number | null;
  ultimo_entrante_el: string | null;
}

/**
 * Tope defensivo. No es una paginación: es la diferencia entre una pantalla lenta y una
 * pantalla que miente. Cuando se alcanza, `cobertura.truncado` lo dice — truncar en silencio
 * haría que "faltan contactos" pareciera un bug de datos en vez de un límite.
 */
const TOPE_CONTACTOS = 2000;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Usá GET." });
  }

  try {
    const { data, error } = await db()
      .from("closer_contactos")
      .select(
        "ghl_contact_id, nombre, telefono, fuente, tags, stage_key, congelado, monto, " +
          "nivel_interes_seguimiento, motivo_descalificacion, forma_pago_venta, razon_noshow, origen_nurture, " +
          "llamadas_ia_intentos, llamadas_ia_contestadas, ultimo_entrante_el",
      )
      .eq("org_id", ORG_ID)
      .limit(TOPE_CONTACTOS);
    if (error) throw new Error(`closer_contactos: ${error.message}`);

    // El select multilínea rompe la inferencia de supabase-js (devuelve su tipo de error
    // genérico), así que el shape se declara a mano — las columnas están una línea arriba.
    const filas = (data ?? []) as unknown as FilaContacto[];

    /**
     * La etapa de cada contacto, resuelta ANTES de los indicadores porque 💰 depende de ella.
     * Supabase manda: si Avanzar ya escribió `stage_key`, esa es la etapa. Si no, se deriva
     * de los tags UNA vez — `etapaDesdeTags` cae en `agendado` (la etapa de ENTRADA) cuando
     * el contacto tiene `zona_closer` y todavía ningún desenlace.
     */
    const etapaDe = new Map(
      filas.map((f) => {
        const tags = (f.tags ?? []).map((t) => t.trim().toLowerCase());
        return [f.ghl_contact_id, (f.stage_key as ReturnType<typeof etapaDesdeTags> | null) ?? etapaDesdeTags(tags)];
      }),
    );

    // UNA query para los 6 indicadores de TODOS los contactos. Nunca una por contacto: este
    // endpoint corre en cada montaje del Pipeline y tras cada Avanzar.
    const indicadores = await cargarIndicadores(
      filas.map((f) => ({
        ghl_contact_id: f.ghl_contact_id,
        tags: f.tags,
        fuente: f.fuente,
        llamadas_ia_intentos: f.llamadas_ia_intentos,
        llamadas_ia_contestadas: f.llamadas_ia_contestadas,
        etapa: etapaDe.get(f.ghl_contact_id) ?? "agendado",
        monto: f.monto,
      })),
    );

    const contactos = filas
      .map((f) => {
        const tags = (f.tags ?? []).map((t) => t.trim().toLowerCase());
        const desenlace = desenlaceDesdeTags(tags);
        const etapa = etapaDe.get(f.ghl_contact_id) ?? "agendado";
        const ind = indicadores.get(f.ghl_contact_id) ?? INDICADORES_VACIOS;

        /**
         * La cita del contacto: la próxima si tiene, y si no la última que venció.
         *
         * Sale de `closer_citas` (vía la vista de indicadores) y NO de `closer_contactos.cita_el`,
         * que está muerta: solo la escribe el webhook `cita.agendada` y en producción quedó NULL
         * en los 7 contactos. Un dato con dos orígenes posibles siempre termina con uno viejo.
         *
         * `vencida` replica la regla de Mi Día: una cita pasada sin Avanzar baja con el aviso,
         * jamás desaparece (§50.10).
         */
        const citaEl = ind.proximaCitaEl ?? ind.ultimaCitaVencidaEl;
        const cita = citaEl
          ? { el: citaEl, ...fechaHoraOrg(citaEl), meetUrl: ind.proximaMeetUrl, vencida: !ind.proximaCitaEl }
          : null;

        return {
          ghlContactId: f.ghl_contact_id,
          nombre: f.nombre,
          telefono: f.telefono,
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
          cita,
          indicadores: ind,
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

    // `env.ghlModo()` y no `ghl().modo`: son idénticos, pero importar el adapter arrastraría
    // el cliente HTTP completo de GHL (414 líneas, sin tree-shaking posible) al bundle de
    // esta función, que no llama a GHL ni una vez.
    const truncado = filas.length >= TOPE_CONTACTOS;

    return res.status(200).json({
      ok: true,
      ghlModo: env.ghlModo(),
      total: contactos.length,
      /** Siempre las 7 claves (§38.D). Los congelados cuentan: siguen en su columna. */
      porEtapa: contarPorEtapa(contactos.map((c) => c.etapa)),
      contactos,
      /** Stats del doc §8.3, derivadas por query — nunca contadores sueltos. */
      stats: { baseTotal: activos.length, enJuegoActivo: enJuego.length, congelados: contactos.length - activos.length },
      /**
       * La caché ES la lista completa del territorio: la mantienen webhook + cron, no una
       * paginación que pueda cortarse. Solo deja de ser completa si se alcanza el tope
       * defensivo, y en ese caso lo dice en vez de recortar en silencio.
       */
      cobertura: { completo: !truncado, truncado, totalEnGhl: null, paginasLeidas: 0, fuente: "cache" },
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
