/**
 * El cuerpo de Mi Día: TODAS las colas del día, desde la caché.
 *
 * Vive acá y no en el endpoint porque tiene DOS puntos de entrada:
 *
 *   · `POST /api/closer/tick` — el reloj de 10 s, junto con la reconciliación (§56).
 *   · `GET  /api/closer/mi-dia` — la hidratación al montar, que es la ÚNICA fuente de
 *     `seguimientosHoy` (`src/lib/seguimientos/cliente.ts` → `traerMiDia`). Ese endpoint
 *     NO es una reliquia: sigue siendo de primera clase.
 *
 * Cero llamadas a GHL (doc §8.2/§9): los datos los mantienen el webhook, la reconciliación
 * y el cron de citas. Esto es queries a Supabase y nada más — por eso puede correr cada
 * 10 s sin tocar el presupuesto.
 *
 * Secciones:
 *   - `citasHoy`          → `closer_citas` con fecha de hoy (Lima).
 *   - `urgentes`          → contactos con `bot_pausado_fallo` en los tags cacheados; el
 *                           motivo sale de `closer_analisis_agente` (lo escribe el auditor).
 *   - `buzon`             → zona_closer + bot APAGADO (§2, default apagado) + último
 *                           entrante posterior a la última resolución. DERIVADO, sin flag.
 *   - `seguimientosHoy`   → la vista `closer_seguimientos_de_hoy`, con el nombre de la caché.
 *   - `completadasHoy`    → avances de hoy + resoluciones de buzón de hoy, por query.
 *
 * Un contacto en Urgentes NO aparece en Buzón: dos colas para la misma persona hacen que
 * atender una no cierre la otra — gana la más específica.
 *
 * ## El módulo es DUEÑO de su `select`
 *
 * `FilaContacto` se castea con `as unknown as` porque el select multilínea rompe la
 * inferencia de supabase-js. Eso significa que si alguien lee las filas por afuera y le
 * pasa menos columnas, TypeScript no dice **nada** y el endpoint degrada en silencio: sin
 * `ultimo_entrante_el` el Buzón queda vacío, sin `congelado` los congelados entran a las
 * dos colas. Por eso el string del select vive acá y la lectura no se recibe por parámetro.
 */

import { estadoBotDesdeTags, perteneceAlCloser, TAGS_BOT } from "../../src/lib/ghl/contrato.js";
import { etapaDesdeTags, type StageKey } from "../../src/lib/ghl/etapas.js";
import { hoyISO } from "../../src/lib/fechas.js";
import { derivarFila, type Seguimiento } from "../../src/lib/seguimientos/dominio.js";
import { INDICADORES_VACIOS, type IndicadoresContacto } from "../../src/lib/indicadores.js";
import { offsetOrg } from "./citas.js";
import { env } from "./env.js";
import { cargarIndicadores } from "./indicadores.js";
import { db, hoyOrg, ORG_ID } from "./repo.js";

export type CasoSeguimiento = "manual_de_hoy" | "manual_vencido" | "serie_agotada" | "automatico_en_curso";

export function clasificarCaso(modo: string, estado: string, diasVencido: number): CasoSeguimiento {
  if (estado === "agotado") return "serie_agotada";
  if (modo === "automatico") return "automatico_en_curso";
  return diasVencido > 0 ? "manual_vencido" : "manual_de_hoy";
}

interface FilaContacto {
  ghl_contact_id: string;
  nombre: string | null;
  telefono: string | null;
  fuente: string | null;
  tags: string[] | null;
  stage_key: string | null;
  congelado: boolean;
  monto: number | null;
  llamadas_ia_intentos: number | null;
  llamadas_ia_contestadas: number | null;
  buzon_resuelto_el: string | null;
  ultimo_entrante_el: string | null;
  ultimo_entrante_texto: string | null;
}

/** Las columnas que Mi Día necesita. Ver la nota de cabecera: el módulo es su dueño. */
const COLUMNAS_CONTACTO =
  "ghl_contact_id, nombre, telefono, fuente, tags, stage_key, congelado, monto, " +
  "llamadas_ia_intentos, llamadas_ia_contestadas, " +
  "buzon_resuelto_el, ultimo_entrante_el, ultimo_entrante_texto";

/** Supabase manda; sin stage_key se deriva de los tags (cae en `agendado`, la entrada). */
const etapaDe = (c: FilaContacto): StageKey =>
  ((c.stage_key as StageKey | null) ?? etapaDesdeTags((c.tags ?? []).map((t) => t.trim().toLowerCase()))) as StageKey;

/**
 * El resumen que viaja en TODAS las colas. Lleva los `indicadores` para que los 6 íconos se
 * vean iguales acá que en el Pipeline y en la ficha — el pedido de Fabio de que la
 * información acompañe al contacto a donde se muestre.
 */
const resumenContacto = (c: FilaContacto, indicadores: Map<string, IndicadoresContacto>) => ({
  ghlContactId: c.ghl_contact_id,
  nombre: c.nombre,
  telefono: c.telefono,
  fuente: c.fuente ?? "DIRECTO",
  tags: c.tags ?? [],
  etapa: etapaDe(c),
  congelado: c.congelado,
  indicadores: indicadores.get(c.ghl_contact_id) ?? INDICADORES_VACIOS,
});

/**
 * Compone las cinco colas. Devuelve el cuerpo SIN el `ok`, que lo pone cada punto de
 * entrada — así el shape de `GET /api/closer/mi-dia` no cambia ni un byte.
 *
 * Lanza si alguna query falla; el caller decide el status.
 */
export async function ejecutarMiDia() {
  const hoy = (await hoyOrg()) ?? hoyISO();
  const inicioDia = `${hoy}T00:00:00${offsetOrg(hoy)}`;
  const finDia = `${hoy}T23:59:59${offsetOrg(hoy)}`;

  /* ── Contactos cacheados (una query alimenta tres secciones) ─────────── */
  const { data: contactosData, error: errContactos } = await db()
    .from("closer_contactos")
    .select(COLUMNAS_CONTACTO)
    .eq("org_id", ORG_ID)
    .limit(2000);
  if (errContactos) throw new Error(`closer_contactos: ${errContactos.message}`);
  const contactos = (contactosData ?? []) as unknown as FilaContacto[];
  const porId = new Map(contactos.map((c) => [c.ghl_contact_id, c]));

  // UNA query para los 6 indicadores de todos. Alimenta las cinco colas de abajo.
  const indicadores = await cargarIndicadores(
    contactos.map((c) => ({
      ghl_contact_id: c.ghl_contact_id,
      tags: c.tags,
      fuente: c.fuente,
      llamadas_ia_intentos: c.llamadas_ia_intentos,
      llamadas_ia_contestadas: c.llamadas_ia_contestadas,
      etapa: etapaDe(c),
      monto: c.monto,
    })),
  );

  /* ── Urgentes: bot_pausado_fallo en tags cacheados ───────────────────── */
  const urgentesFilas = contactos.filter(
    (c) => !c.congelado && (c.tags ?? []).map((t) => t.trim().toLowerCase()).includes(TAGS_BOT.botPausadoFallo.valor),
  );

  // El motivo del fallo lo escribió el analizador en SOFIA — leerlo de acá reemplaza el
  // GET /contacts/{id}/notes por contacto que hacía el endpoint viejo cada 10s.
  const motivos = new Map<string, string>();
  if (urgentesFilas.length > 0) {
    const { data: analisis } = await db()
      .from("closer_analisis_agente")
      .select("ghl_contact_id, motivo, analizado_el")
      .eq("fallo", true)
      .in("ghl_contact_id", urgentesFilas.map((c) => c.ghl_contact_id))
      .order("analizado_el", { ascending: false });
    for (const a of analisis ?? []) {
      if (a.motivo && !motivos.has(a.ghl_contact_id)) motivos.set(a.ghl_contact_id, a.motivo);
    }
  }

  const urgentes = urgentesFilas.map((c) => ({
    ...resumenContacto(c, indicadores),
    fallo: motivos.get(c.ghl_contact_id) ?? "requiere intervención — revisar conversación",
  }));
  const enUrgentes = new Set(urgentes.map((u) => u.ghlContactId));

  /* ── Buzón general: el ruteo del doc §4.3, como query ────────────────── */
  const buzon = contactos
    .filter((c) => {
      if (c.congelado || enUrgentes.has(c.ghl_contact_id)) return false;
      const tags = (c.tags ?? []).map((t) => t.trim().toLowerCase());
      if (!perteneceAlCloser(tags, true)) return false;
      if (estadoBotDesdeTags(tags) !== "apagado") return false;
      if (!c.ultimo_entrante_el) return false;
      const resuelto = c.buzon_resuelto_el ? new Date(c.buzon_resuelto_el).getTime() : 0;
      return new Date(c.ultimo_entrante_el).getTime() > resuelto;
    })
    .map((c) => ({
      ...resumenContacto(c, indicadores),
      ultimoEntranteEl: c.ultimo_entrante_el,
      snippet: (c.ultimo_entrante_texto ?? "").slice(0, 80) || null,
    }))
    .sort((a, b) => (b.ultimoEntranteEl ?? "").localeCompare(a.ultimoEntranteEl ?? ""));

  /* ── Citas de hoy ────────────────────────────────────────────────────── */
  const { data: citasData, error: errCitas } = await db()
    .from("closer_citas")
    .select("ghl_appointment_id, ghl_contact_id, fecha_hora, estado_ghl, titulo, meet_url")
    .gte("fecha_hora", inicioDia)
    .lte("fecha_hora", finDia)
    .neq("estado_ghl", "cancelled")
    .order("fecha_hora", { ascending: true });
  if (errCitas) throw new Error(`closer_citas: ${errCitas.message}`);

  const citasHoy = (citasData ?? []).map((c) => {
    const contacto = porId.get(c.ghl_contact_id);
    return {
      id: c.ghl_appointment_id,
      ghlContactId: c.ghl_contact_id,
      nombre: contacto?.nombre ?? ((c.titulo ?? "").replace(/^.*?-\s*/, "").trim() || null),
      fechaHora: c.fecha_hora,
      estado: c.estado_ghl,
      meetUrl: c.meet_url,
      /** Pasó la hora y nadie la movió con Avanzar: baja con "vencido hace X", jamás desaparece. */
      vencida: new Date(c.fecha_hora).getTime() < Date.now(),
      /**
       * Los 6 íconos también acá. El widget "Agenda de Hoy" los tenía HARDCODEADOS en cero
       * (`llamadas: []`, `botEstado: undefined`) — apagaba los íconos de contactos que sí
       * tenían el dato, en la única vitrina donde el closer mira antes de una llamada.
       */
      indicadores: indicadores.get(c.ghl_contact_id) ?? INDICADORES_VACIOS,
    };
  });

  /* ── Seguimientos de hoy (la vista de siempre, nombres desde la caché) ─ */
  const { data: segData, error: errSeg } = await db()
    .from("closer_seguimientos_de_hoy")
    .select("*")
    .order("fijada", { ascending: false })
    .order("fecha_objetivo", { ascending: true });
  if (errSeg) throw new Error(`closer_seguimientos_de_hoy: ${errSeg.message}`);

  const seguimientosHoy = (segData ?? []).map((f) => {
    const contacto = porId.get(f.ghl_contact_id);
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
    const diasVencido = Number(f.dias_vencido) || 0;

    return {
      ghlContactId: f.ghl_contact_id,
      nombre: contacto?.nombre ?? null,
      telefono: contacto?.telefono ?? null,
      tags: contacto?.tags ?? [],
      fijada: f.fijada,
      diasVencido,
      caso: clasificarCaso(f.modo, f.estado, diasVencido),
      seguimiento: seg,
      fila: derivarFila(seg),
      indicadores: indicadores.get(f.ghl_contact_id) ?? INDICADORES_VACIOS,
    };
  });

  /* ── Completadas hoy: por query, nunca por flag ──────────────────────── */
  const { data: avancesHoy, error: errAvances } = await db()
    .from("closer_avances")
    .select("ghl_contact_id, salida, detalle, created_at")
    .gte("created_at", inicioDia)
    .lte("created_at", finDia)
    .order("created_at", { ascending: false });
  if (errAvances) throw new Error(`closer_avances: ${errAvances.message}`);

  const resueltosBuzonHoy = contactos.filter(
    (c) => c.buzon_resuelto_el && c.buzon_resuelto_el >= inicioDia && c.buzon_resuelto_el <= finDia,
  );

  const completadasHoy = [
    ...(avancesHoy ?? []).map((a) => ({
      ...(porId.get(a.ghl_contact_id)
        ? resumenContacto(porId.get(a.ghl_contact_id)!, indicadores)
        : {
            // Un avance de un contacto que ya no está en la caché (lo borraron del
            // pipeline): la fila sigue apareciendo en Completadas Hoy, sin inventarle datos.
            ghlContactId: a.ghl_contact_id,
            nombre: null,
            telefono: null,
            fuente: "DIRECTO",
            tags: [],
            etapa: "agendado" as StageKey,
            congelado: false,
            indicadores: INDICADORES_VACIOS,
          }),
      motivo: `avanzar:${a.salida}`,
      cuando: a.created_at,
    })),
    ...resueltosBuzonHoy.map((c) => ({
      ...resumenContacto(c, indicadores),
      motivo: "buzon_resuelto",
      cuando: c.buzon_resuelto_el as string,
    })),
  ].sort((a, b) => (b.cuando ?? "").localeCompare(a.cuando ?? ""));

  // El orden de las claves importa: `res.json()` serializa por orden de inserción, y el
  // shape de `GET /api/closer/mi-dia` no puede cambiar ni un byte.
  return {
    hoy,
    zonaHoraria: "America/Lima",
    ghlModo: env.ghlModo(),
    citasHoy,
    urgentes,
    buzon,
    seguimientosHoy,
    completadasHoy,
    resumen: {
      citas: citasHoy.length,
      urgentes: urgentes.length,
      buzon: buzon.length,
      seguimientos: seguimientosHoy.filter((s) => s.caso !== "automatico_en_curso").length,
      completadas: completadasHoy.length,
    },
    total: seguimientosHoy.length,
  };
}
