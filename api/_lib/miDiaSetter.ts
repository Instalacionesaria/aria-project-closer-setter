/**
 * Las seis colas de Mi Día del **setter**, derivadas por query.
 *
 * ── Qué reemplaza ─────────────────────────────────────────────────────
 *
 * Hasta hoy las colas salían de **banderas booleanas escritas en objetos semilla**
 * (`c.urgente`, `c.estancada`, `c.oportunidadLt`…, en `setterStore.tsx`). No había una fecha ni
 * un contador detrás de ninguna: el `"se apagó hace 11h"` era un string. Un contacto entraba a
 * una cola porque alguien había escrito `urgente: true` en el array, y salía cuando `advance()`
 * borraba la bandera.
 *
 * Acá se derivan de datos, igual que las cinco del closer: **cero flags**, cero llamadas a GHL,
 * una query base más las puntuales. El módulo es dueño de sus columnas por el mismo motivo que
 * `miDia.ts`: el cast mata la inferencia, así que un `select` con menos columnas degradaría en
 * silencio.
 *
 * ── Por qué es un módulo aparte y no un parámetro de `miDia.ts` ───────
 *
 * Porque las colas no son las mismas ni significan lo mismo. El closer tiene cinco —urgentes,
 * buzón, citas de hoy, seguimientos, completadas— y el setter seis, de las cuales *citas de hoy*
 * no existe (no tiene agenda: por definición trabaja antes de que la haya) y *estancadas* y
 * *oportunidades LT* no tienen contraparte. Compartir el esqueleto con un `if` por rol habría
 * dejado dos lógicas trenzadas para ahorrar una query base.
 */

import {
  estadoBotDesdeTags,
  TAGS,
  TAGS_BOT,
  tieneFalloDeAuditor,
} from "../../src/lib/ghl/contrato.js";
import {
  derivarFila,
  type Seguimiento,
} from "../../src/lib/seguimientos/dominio.js";
import { clasificarCaso } from "./miDia.js";
import { offsetOrg } from "./citas.js";
import { db, hoyOrg } from "./repo.js";
import { hoyISO } from "../../src/lib/fechas.js";

/** Las columnas que estas colas necesitan. El módulo es su dueño — ver la cabecera. */
const COLUMNAS =
  "ghl_contact_id, nombre, telefono, fuente, tags, stage_key, congelado, " +
  "buzon_resuelto_el, ultimo_entrante_el, ultimo_entrante_texto, atribucion_setter_id";

interface FilaContacto {
  ghl_contact_id: string;
  nombre: string | null;
  telefono: string | null;
  fuente: string | null;
  tags: string[] | null;
  stage_key: string | null;
  congelado: boolean;
  buzon_resuelto_el: string | null;
  ultimo_entrante_el: string | null;
  ultimo_entrante_texto: string | null;
  atribucion_setter_id: string | null;
}

const normalizar = (tags: string[] | null) =>
  (tags ?? []).map((t) => t.trim().toLowerCase());

/** Pertenece al territorio del setter. Es el portón de entrada al módulo, como `zona_closer`. */
const esDelSetter = (c: FilaContacto) =>
  normalizar(c.tags).includes(TAGS.zonaSetter.valor);

function resumen(c: FilaContacto) {
  return {
    contactId: c.ghl_contact_id,
    name: c.nombre ?? c.ghl_contact_id,
    phone: c.telefono,
    fuente: c.fuente,
    stage: c.stage_key,
    congelado: c.congelado,
  };
}

export async function ejecutarMiDiaSetter() {
  const hoy = (await hoyOrg()) ?? hoyISO();
  // El borde del día en la zona de la empresa. Nunca aritmética de zona en Node: la sesión de
  // Supabase corre en UTC y a las 20:00 de Lima ya es el día siguiente allá.
  const inicioDia = `${hoy}T00:00:00${offsetOrg(hoy)}`;
  const finDia = `${hoy}T23:59:59${offsetOrg(hoy)}`;

  /* ── La query base: una sola, para tres de las seis colas ──────────── */
  const { data: filas } = await db()
    .from("closer_contactos")
    .select(COLUMNAS)
    .limit(2000);
  const todos = ((filas ?? []) as unknown as FilaContacto[]).filter(
    esDelSetter,
  );

  /* ── 1. Urgentes ───────────────────────────────────────────────────── */
  /**
   * **Vacía a propósito, y la tarjeta lo dice.** El auditor del setter no existe todavía (Fase
   * 2.4 del plan de lanzamiento), así que nadie aplica `bot_pausado_fallo` sobre un contacto de
   * pre-agenda. La derivación va escrita igual —es la misma del closer— para que el día que el
   * auditor exista la cola se llene sola, sin tocar esto.
   *
   * Lo que NO se hace es atenuar la sección ni mostrar un cero: vacía porque su auditor no
   * existe es un hecho distinto de vacía porque no hay urgencias hoy.
   */
  const urgentes = todos
    .filter((c) => !c.congelado && tieneFalloDeAuditor(c.tags ?? []))
    .map(resumen);

  /* ── 2. Conversaciones estancadas ──────────────────────────────────── */
  /**
   * El tag `estancado` lo aplica un workflow de barrido de GHL; acá solo se lee. Es la misma
   * relación que tiene el closer con él: nosotros no decidimos cuándo una conversación se
   * estancó — eso lo mide GHL contra su propia ventana de inactividad.
   */
  const estancadas = todos
    .filter(
      (c) => !c.congelado && normalizar(c.tags).includes(TAGS.estancado.valor),
    )
    .map(resumen);

  /* ── 3. Oportunidades low-ticket ───────────────────────────────────── */
  /**
   * `derivado_lt` es el tag que marca al lead que no califica para high-ticket pero sí puede
   * comprar algo chico. Acá **sí** significa lo que dice —derivado a LT— y por eso se usa para
   * esta cola, a diferencia de la salida `venta_lt` del Avanzar, donde significaría otra cosa
   * (ver `resultadosSetter.ts`).
   */
  const oportunidades = todos
    .filter(
      (c) =>
        !c.congelado && normalizar(c.tags).includes(TAGS_BOT.derivadoLt.valor),
    )
    .map(resumen);

  /* ── 4. Buzón general ──────────────────────────────────────────────── */
  /**
   * Mismo criterio que el buzón del closer, sin una sola bandera: escribió después de la última
   * vez que alguien lo resolvió, y el bot no lo está atendiendo. Si el bot está activo, no es
   * trabajo del humano todavía.
   *
   * Se excluye a los que ya están en Urgentes: gana la cola más específica.
   */
  const enUrgentes = new Set(urgentes.map((u) => u.contactId));
  const buzon = todos
    .filter((c) => {
      if (c.congelado || enUrgentes.has(c.ghl_contact_id)) return false;
      if (estadoBotDesdeTags(normalizar(c.tags)) !== "apagado") return false;
      if (!c.ultimo_entrante_el) return false;
      return !c.buzon_resuelto_el || c.ultimo_entrante_el > c.buzon_resuelto_el;
    })
    .sort((a, b) =>
      (b.ultimo_entrante_el ?? "").localeCompare(a.ultimo_entrante_el ?? ""),
    )
    .map((c) => ({
      ...resumen(c),
      ultimoEntranteEl: c.ultimo_entrante_el,
      texto: c.ultimo_entrante_texto,
    }));

  /* ── 5. Seguimientos de hoy ────────────────────────────────────────── */
  const porId = new Map(todos.map((c) => [c.ghl_contact_id, c]));
  const { data: segs } = await db()
    .from("closer_seguimientos_de_hoy")
    .select("*");

  const seguimientos = (segs ?? [])
    // La vista no sabe de territorios: se filtra contra los contactos del setter que ya tenemos.
    .filter((f) => porId.has(f.ghl_contact_id))
    .map((f) => {
      const c = porId.get(f.ghl_contact_id)!;
      // El mapeo snake→camel es el mismo que hace `miDia.ts`: el dominio compartido
      // (`derivarFila`, `clasificarCaso`) habla camelCase y la vista devuelve snake.
      const seg: Seguimiento = {
        id: f.id,
        ghlContactId: f.ghl_contact_id,
        closerId: f.closer_id,
        situacion: f.situacion,
        modo: f.modo,
        fechaObjetivo: f.fecha_objetivo,
        estado: f.estado,
        nota: f.nota ?? undefined,
        serie: f.serie_key
          ? { key: f.serie_key, toques: f.serie_toques, dias: f.serie_dias }
          : undefined,
        creadoEl: f.creado_el,
        creadoPor: f.creado_por,
      };
      return {
        ...resumen(c),
        seguimientoId: seg.id,
        situacion: seg.situacion,
        modo: seg.modo,
        fechaObjetivo: seg.fechaObjetivo,
        fijada: Boolean(f.fijada),
        caso: clasificarCaso(seg.modo, seg.estado, Number(f.dias_vencido ?? 0)),
        fila: derivarFila(seg),
      };
    })
    .sort(
      (a, b) =>
        Number(b.fijada) - Number(a.fijada) ||
        String(a.fechaObjetivo).localeCompare(String(b.fechaObjetivo)),
    );

  /* ── 6. Completadas hoy ────────────────────────────────────────────── */
  /**
   * **Por query, nunca por flag** — igual que el closer. `rol = 'setter'` es lo que separa su
   * trabajo del de un closer sobre el mismo contacto: sin ese filtro, un Avanzar del closer
   * aparecería como tarea completada del setter.
   */
  const { data: avances } = await db()
    .from("closer_avances")
    .select("ghl_contact_id, salida, detalle, created_at")
    .eq("rol", "setter")
    .gte("created_at", inicioDia)
    .lte("created_at", finDia);

  const completadas = (
    (avances ?? []) as {
      ghl_contact_id: string;
      salida: string;
      detalle: Record<string, unknown>;
      created_at: string;
    }[]
  )
    .map((a) => ({
      contactId: a.ghl_contact_id,
      // Un avance de un contacto que ya no está en la caché se muestra igual, sin inventarle datos.
      name: porId.get(a.ghl_contact_id)?.nombre ?? a.ghl_contact_id,
      motivo: `avanzar:${a.salida}`,
      pildora:
        typeof a.detalle?.pildora === "string" ? a.detalle.pildora : null,
      cuando: a.created_at,
    }))
    .sort((a, b) => b.cuando.localeCompare(a.cuando));

  return {
    hoy,
    urgentes,
    estancadas,
    oportunidades,
    buzon,
    seguimientos,
    completadas,
    resumen: {
      urgentes: urgentes.length,
      estancadas: estancadas.length,
      oportunidades: oportunidades.length,
      buzon: buzon.length,
      // Los automáticos en curso no son tarea de nadie hoy: están corriendo solos.
      seguimientos: seguimientos.filter((s) => s.caso !== "automatico_en_curso")
        .length,
      completadas: completadas.length,
    },
    /**
     * El total de tareas PENDIENTES, que es lo que va al badge del nav. No incluye completadas
     * —ya no son tarea— ni los seguimientos automáticos en curso, por el mismo motivo.
     */
    total:
      urgentes.length +
      estancadas.length +
      oportunidades.length +
      buzon.length +
      seguimientos.filter((s) => s.caso !== "automatico_en_curso").length,
  };
}
