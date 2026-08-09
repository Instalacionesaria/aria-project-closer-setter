/**
 * `GET /api/estadisticas?periodo=este_mes` — el panel de Estadísticas, con datos REALES.
 *
 * ── Qué reemplaza ─────────────────────────────────────────────────────
 *
 * `src/lib/gerenciaStore.tsx` tenía tres constantes escritas a mano (`ESTE_MES`, `MES_PASADO`,
 * `ULTIMOS_3_MESES`) con los 61 números del panel. Peor que inventados: su encabezado afirmaba
 * que la sección Equipo era *"100% EN VIVO"* y que la contraprueba de automatización era
 * *"genuina"*, y las dos cosas eran falsas — `SETTER_COCKPIT_BASE` era igual de hardcodeado y
 * el **espejo del lado del closer** de `atribucionSetter` (`ClosurerContact.atribucionSetter`) se
 * declara y no se asigna nunca — el del setter SÍ se asigna, en seis lugares de `setterStore`—, así
 * que el porcentaje de automatización salía siempre 100%. Un número inventado con etiqueta de real es el peor caso
 * de D3, porque nadie lo va a verificar.
 *
 * ── Qué devuelve y qué NO ─────────────────────────────────────────────
 *
 * **Solo lo que se puede medir.** De los 61 números del panel, 28 salen de lo que ya hay en la
 * base y son los que este endpoint calcula. El resto se reparte así:
 *
 *   · **11** necesitaban un autor en `closer_avances` (migración `025`). Los del desglose por
 *     persona ya se calculan; las filas anteriores a esa migración no tienen autor y **no se
 *     rellenaron** — se cuentan en los totales y se excluyen del desglose, diciéndolo en
 *     `sinAtribuir`.
 *   · **6** dependen del gasto en pauta, que hoy no existe como dato medido (fase 7 · Meta).
 *   · **17** no tienen dato de origen en ninguna parte: la clasificación caliente/tibio/probable
 *     LT, el corte high-ticket vs low-ticket, las cuatro métricas del setter y las de
 *     automatización. Para esos, la respuesta trae la clave `null` y **la vista no los
 *     renderiza** (§4.1 y D3). No hay ceros de relleno.
 *
 * La lista completa, con el motivo de cada uno, está en `docs/10-ESTADO.md`.
 *
 * ── Una sola derivación por regla ─────────────────────────────────────
 *
 * El show rate tenía TRES definiciones con denominadores distintos: una en `gerenciaStore`, una
 * en `setterStore` y una en `api/closer/inicio.ts`. Acá vale la de `inicio.ts`, que es la que ya
 * corría sobre datos reales: **citas pasadas cuya salida de Avanzar no fue `no_show`**, sobre
 * citas pasadas. Si esta definición cambia, cambia en un solo lugar.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { hoyISO, ZONA_HORARIA_ORG } from "../src/lib/fechas.js";
import { offsetOrg } from "./_lib/citas.js";
import { db, hoyOrg } from "./_lib/repo.js";
import { activar } from "./_lib/credenciales.js";
import { exigir } from "./_lib/auth.js";

/** Los mismos períodos que ofrece el selector de la vista. */
type Periodo = "este_mes" | "mes_pasado" | "ultimos_3_meses";

/** Fecha civil (YYYY-MM-DD) de un timestamp, en la zona de la empresa. */
function diaOrg(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA_ORG }).format(new Date(iso));
}

/**
 * El rango del período, en la zona de la empresa.
 *
 * Se calcula sobre el "hoy" que devuelve Postgres (`closer_hoy_org(p_org_id)`) y no sobre el
 * reloj de Node: son dos husos distintos y el borde del mes es exactamente donde se separan.
 */
function rango(periodo: Periodo, hoy: string): { desde: string; hasta: string; etiqueta: string } {
  const [anio, mes] = hoy.slice(0, 7).split("-").map(Number);

  const primerDia = (a: number, m: number) => `${a}-${String(m).padStart(2, "0")}-01`;
  const conOffset = (fecha: string, fin = false) =>
    `${fecha}T${fin ? "23:59:59" : "00:00:00"}${offsetOrg(fecha)}`;

  if (periodo === "mes_pasado") {
    const m = mes === 1 ? 12 : mes - 1;
    const a = mes === 1 ? anio - 1 : anio;
    // El día 0 del mes siguiente ES el último del mes buscado, sin tabla de días por mes.
    const ultimo = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    return { desde: conOffset(primerDia(a, m)), hasta: conOffset(ultimo, true), etiqueta: "Mes pasado" };
  }

  if (periodo === "ultimos_3_meses") {
    const m = mes <= 2 ? mes + 10 : mes - 2;
    const a = mes <= 2 ? anio - 1 : anio;
    return { desde: conOffset(primerDia(a, m)), hasta: conOffset(hoy, true), etiqueta: "Últimos 3 meses" };
  }

  return { desde: conOffset(primerDia(anio, mes)), hasta: conOffset(hoy, true), etiqueta: "Este mes" };
}

/** El monto de un avance. Un valor ausente, cero o no numérico no suma. */
function montoDe(detalle: unknown): number {
  const n = Number((detalle as Record<string, unknown> | null)?.monto ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Porcentaje con su base. `null` si la base es cero: un 0% sin base afirma algo que nadie midió. */
function tasa(parte: number, base: number): { pct: number; de: number; sobre: number } | null {
  if (base <= 0) return null;
  return { pct: Math.round((parte / base) * 1000) / 10, de: parte, sobre: base };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  /**
   * `admin` y no un rol operativo: son las métricas del negocio entero, no las de una persona.
   * El super admin pasa igual por el bypass de `exigir`.
   */
  const ctx = await exigir(req, res, ["admin"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const pedido = String(req.query.periodo ?? "este_mes");
    const periodo: Periodo =
      pedido === "mes_pasado" || pedido === "ultimos_3_meses" ? pedido : "este_mes";

    const hoy = (await hoyOrg()) ?? hoyISO();
    const { desde, hasta, etiqueta } = rango(periodo, hoy);

    /* ── Avances ─────────────────────────────────────────────────────────── */
    const { data: avances, error: errAvances } = await db()
      .from("closer_avances")
      .select("ghl_contact_id, salida, detalle, autor_usuario_id, rol, created_at")
      .gte("created_at", desde)
      .lte("created_at", hasta);
    if (errAvances) throw new Error(`closer_avances: ${errAvances.message}`);

    const todos = avances ?? [];
    const ventas = todos.filter((a) => a.salida === "venta");
    /**
     * Las low-ticket del setter (migración `032`). Son revenue del negocio igual que las
     * high-ticket —plata cobrada es plata cobrada— pero se cuentan aparte: mezclarlas en
     * `ticketPromedio` lo hundiría, y un promedio que junta un programa de $4.000 con una
     * masterclass de $97 no describe ninguno de los dos.
     */
    const ventasLt = todos.filter((a) => a.rol === "setter" && a.salida === "venta_lt");
    const revenueLt = ventasLt.reduce((s, a) => s + montoDe(a.detalle), 0);

    /**
     * `acordo` NO entra en el revenue, y es la regla que más fácil se rompe al escribir esto: su
     * `monto` es una seña o una promesa, no un pago verificado (§ definición de Venta en
     * 01-PRODUCTO: *"pago verificado por un humano"*). Va aparte, como "sobre la mesa".
     */
    const revenue = ventas.reduce((s, a) => s + montoDe(a.detalle), 0);
    const sobreLaMesa = todos.filter((a) => a.salida === "acordo").reduce((s, a) => s + montoDe(a.detalle), 0);
    const ticketPromedio = ventas.length > 0 ? Math.round(revenue / ventas.length) : null;

    /* ── Citas ───────────────────────────────────────────────────────────── */
    const { data: citas, error: errCitas } = await db()
      .from("closer_citas")
      .select("ghl_contact_id, fecha_hora, estado_ghl")
      .gte("fecha_hora", desde)
      .lte("fecha_hora", hasta)
      .neq("estado_ghl", "cancelled");
    if (errCitas) throw new Error(`closer_citas: ${errCitas.message}`);

    const agendadas = citas ?? [];
    const pasadas = agendadas.filter((c) => new Date(c.fecha_hora).getTime() < Date.now());

    // La única definición de "ocurrió": el vínculo cita↔avance es por contacto y mismo día civil.
    // No hay FK entre las dos tablas y el mismo día es el nexo honesto disponible.
    const noShowPorDia = new Set(
      todos.filter((a) => a.salida === "no_show").map((a) => `${a.ghl_contact_id}:${diaOrg(a.created_at)}`),
    );
    const ocurridas = pasadas.filter((c) => !noShowPorDia.has(`${c.ghl_contact_id}:${diaOrg(c.fecha_hora)}`)).length;

    /* ── Gasto en pauta, de Meta ─────────────────────────────────────────── */
    /**
     * ── Dejó de ser un campo manual (2026-08-07) ──────────────────────
     *
     * Hasta hoy el gasto era un número que alguien escribía en Ajustes › Operación (semilla:
     * 3000), y los cuatro indicadores que dependen de él viajaban `null` con el motivo *"sin
     * integración con Meta (fase 7)"*. La fase 7 existe: `closer_meta_metricas` se llena sola con
     * el cron diario, por empresa.
     *
     * `nivel = 'cuenta'` y no la suma de campañas: las filas de campaña, conjunto y anuncio son
     * el mismo gasto desagregado, y sumarlas todas lo contaría hasta cuatro veces.
     *
     * Si no hay filas —una empresa sin Meta conectado— el gasto es `null`, **no cero**. Un ROAS
     * calculado sobre cero es división por cero; uno calculado sobre "no sé" es una mentira con
     * cara de número. Los cuatro siguen viajando `null` y la vista no los renderiza.
     */
    const { data: filasMeta, error: errMeta } = await db()
      .from("closer_meta_metricas")
      .select("gasto, leads")
      .eq("nivel", "cuenta")
      .gte("fecha", desde.slice(0, 10))
      .lte("fecha", hasta.slice(0, 10));
    if (errMeta) throw new Error(`closer_meta_metricas: ${errMeta.message}`);

    const diasConMeta = filasMeta ?? [];
    const gastoEnPauta =
      diasConMeta.length > 0 ? diasConMeta.reduce((s, f) => s + Number(f.gasto ?? 0), 0) : null;
    const leadsDeMeta = diasConMeta.reduce((s, f) => s + Number(f.leads ?? 0), 0);

    /** Solo si hay gasto Y una base > 0. `null` = no se puede afirmar, y eso no se redondea. */
    const porGasto = (base: number): number | null =>
      gastoEnPauta !== null && base > 0 ? Math.round((gastoEnPauta / base) * 100) / 100 : null;

    /* ── Contactos: el embudo y la fuente ────────────────────────────────── */
    const { data: contactos, error: errContactos } = await db()
      .from("closer_contactos")
      /**
       * `stage` NO existe: la columna es `stage_key`. Se pedía por analogía y el endpoint devolvía
       * 500 en producción — verificado contra el esquema real de SOFIA, no contra la intuición.
       * Y encima no se usaba para nada, así que se fue en vez de corregirse.
       */
      .select("ghl_contact_id, fuente, creado_el");
    if (errContactos) throw new Error(`closer_contactos: ${errContactos.message}`);

    const universo = contactos ?? [];
    const conMensajes = new Set(todos.map((a) => a.ghl_contact_id));

    /**
     * `closer_contactos.fuente` existe y `fuenteDesdeTags()` la produce, así que las fuentes SÍ
     * se pueden contar — a diferencia de la clasificación caliente/tibio/probable-LT, que no
     * existe en ninguna parte y por eso viaja `null`.
     *
     * Los valores **ya son las etiquetas** que se muestran (`"META ADS"`, `"DIRECTO"`,
     * `"📷 IG PROFILE"`, `"VSL OPT-IN"`), no slugs: `fuenteDesdeTags` devuelve el chip listo.
     * Así que viajan tal cual y la vista no los traduce.
     */
    const porFuente = universo.reduce<Record<string, number>>((acc, c) => {
      const f = (c.fuente as string | null) ?? "sin_clasificar";
      acc[f] = (acc[f] ?? 0) + 1;
      return acc;
    }, {});

    /* ── Equipo: el desglose por persona (migración 025) ─────────────────── */
    const { data: usuarios } = await db().from("closer_usuarios").select("id, nombre");
    const nombrePor = new Map((usuarios ?? []).map((u) => [u.id as string, u.nombre as string]));

    /**
     * ── El ranking se separa por ROL (migración `032`) ─────────────────
     *
     * Antes agrupaba por `autor_usuario_id` sin discriminar, así que cualquier autor caía en la
     * misma lista ordenada por revenue. Con el setter escribiendo en la misma tabla eso pasa de
     * inofensivo a engañoso: un setter con tres low-tickets de $97 aparecería en el ranking de
     * closers, último, como si hubiera tenido un mes malo vendiendo high-ticket.
     *
     * Son dos trabajos con dos escalas distintas. Un solo ranking no puede describir los dos.
     */
    const porPersona = new Map<string, { ventas: number; revenue: number }>();
    const porSetter = new Map<string, { ventas: number; revenue: number }>();
    let sinAtribuir = 0;
    for (const a of [...ventas, ...ventasLt]) {
      const autor = a.autor_usuario_id as string | null;
      if (!autor) {
        // Solo las HT sin autor cuentan como "sin atribuir": las LT nacieron con autor.
        if (a.salida === "venta") sinAtribuir++;
        continue;
      }
      const destino = a.rol === "setter" ? porSetter : porPersona;
      const acum = destino.get(autor) ?? { ventas: 0, revenue: 0 };
      acum.ventas++;
      acum.revenue += montoDe(a.detalle);
      destino.set(autor, acum);
    }

    return res.status(200).json({
      ok: true,
      periodo,
      etiqueta,
      rango: { desde, hasta },
      zonaHoraria: ZONA_HORARIA_ORG,

      embudo: {
        entraron: universo.length,
        conversaron: conMensajes.size,
        agendaron: agendadas.length,
        asistieron: ocurridas,
        compraron: ventas.length,
        tasas: {
          conversacion: tasa(conMensajes.size, universo.length),
          agenda: tasa(agendadas.length, conMensajes.size),
          show: tasa(ocurridas, pasadas.length),
          cierre: tasa(ventas.length, ocurridas),
        },
      },

      dinero: {
        revenue,
        ticketPromedio,
        sobreLaMesa,
        /**
         * El low-ticket del setter, **aparte del `revenue`** y no sumado adentro.
         *
         * Sumarlo haría que el número grande del panel dejara de ser comparable con el de los
         * meses anteriores sin que nadie lo notara: subiría por una fuente nueva y parecería
         * crecimiento del high-ticket. Separado, las dos preguntas se pueden hacer.
         */
        revenueLt,
        ventasLt: ventasLt.length,
        /**
         * Los cuatro dependen del gasto en pauta. `null` cuando la empresa no tiene Meta
         * conectado: un ROAS de 0 afirma que no hubo retorno, y `null` dice que no sabemos cuánto
         * se gastó. No son lo mismo y la vista los trata distinto.
         */
        gastoEnPauta,
        // Cuántas veces volvió lo invertido. Este va al revés que los otros tres: revenue/gasto.
        roas: gastoEnPauta !== null && gastoEnPauta > 0 ? Math.round((revenue / gastoEnPauta) * 100) / 100 : null,
        cac: porGasto(ventas.length),
        /**
         * El CPL usa los leads que **reporta Meta**, no los contactos de la base: son cosas
         * distintas —un lead de Meta puede no haber llegado nunca a GHL— y dividir el gasto de
         * Meta por los contactos de GHL mezcla dos universos.
         */
        cpl: porGasto(leadsDeMeta),
        cpa: porGasto(agendadas.length),
      },

      fuentes: porFuente,

      equipo: {
        personas: [...porPersona.entries()]
          .map(([id, v]) => ({ id, nombre: nombrePor.get(id) ?? "—", ...v }))
          .sort((a, b) => b.revenue - a.revenue),
        /**
         * Las ventas sin autor. Se cuentan en los totales de arriba y se excluyen del desglose:
         * son las filas anteriores a la migración `025`, cuando no había sesión. Rellenarlas con
         * el closer más probable habría sido fabricar un hecho.
         */
        sinAtribuir,
        /**
         * Los setters, en su propia lista. Vacía mientras ninguno haya vendido un low-ticket este
         * período — que es distinto de "no hay setters", y por eso la vista la muestra vacía en
         * vez de esconder la sección.
         */
        setters: [...porSetter.entries()]
          .map(([id, v]) => ({ id, nombre: nombrePor.get(id) ?? "—", ...v }))
          .sort((a, b) => b.revenue - a.revenue),
      },

      /**
       * Lo que NO se puede medir, enumerado. La vista lo usa para no renderizar esos bloques, y
       * está acá y no en el frontend para que la razón viaje con el dato: una lista de "esto no
       * existe" en el cliente se desactualiza sola cuando el backend empieza a poder calcularlo.
       */
      sinDato: {
        distribucionLeads: "La clasificación caliente/tibio/probable-LT no existe en la base.",
        automatizacion:
          "El espejo del lado del closer (`ClosurerContact.atribucionSetter`) nunca se asigna, así que " +
          "no hay señal de intervención manual del setter que contrastar contra las ventas del closer.",
        cortesHighLowTicket: "Ninguna marca sobre una venta distingue high-ticket de low-ticket.",
        /**
         * `metricasSetter` salió de esta lista el 2026-08-08: `api/setter/` ya escribe. Lo que
         * sigue sin poder medirse de su trabajo es más chico y más preciso.
         */
        showRateSetter:
          "El show-rate del setter necesita saber si el contacto asistió, y GHL nunca marca " +
          "`showed`. Es el mismo hueco que tiene el Appointment Flow.",
        agendasAutomaticasVsManuales:
          "`closer_citas` no guarda quién creó la cita, así que no se puede separar lo que agendó " +
          "el bot de lo que agendó un setter. Sus agendas manuales SÍ se cuentan, desde " +
          "`closer_avances` con salida `agendo`.",
        metricasVideo: "`contact._video_precall` llega de GHL pero no se persiste.",
        // `gastoEnPauta` ya NO está acá: se mide desde `closer_meta_metricas` (2026-08-07). Si una
        // empresa no tiene Meta conectado, los cuatro indicadores viajan `null` por su cuenta.
      },
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
