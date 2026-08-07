/**
 * El Meta Data Collector (ESPEC §9.1) — sincroniza los cuatro niveles de la empresa activa.
 *
 * ── Se guarda el crudo ANTES de mapear (D15) ──────────────────────────
 *
 * La misma regla que los webhooks: *"cuando no se sabe qué trae la API, se recibe, se guarda, y la
 * tabla se diseña mirando datos reales"*. Nadie vio todavía una respuesta de la Graph API de esta
 * cuenta, así que `closer_meta_crudo` no es redundancia — es lo único que permite arreglar un
 * mapeo equivocado sin haber perdido el mes.
 *
 * ── La ventana se solapa a propósito ──────────────────────────────────
 *
 * Se piden 7 días hacia atrás en cada corrida, no solo el día anterior. Meta **reajusta las cifras
 * recientes**: las conversiones tardan en atribuirse, así que el gasto y los leads de ayer cambian
 * durante varios días. Sincronizar solo el último día dejaría congelada la primera versión de cada
 * cifra, que es la menos correcta. La clave única de la `026` hace que repetir corrija.
 */

import { db, orgActiva } from "../repo.js";
import { meta, type NivelMeta } from "./index.js";

/** Los cuatro niveles de §9.2, del más agregado al más fino. */
const NIVELES: NivelMeta[] = ["cuenta", "campana", "adset", "anuncio"];

/**
 * Cuántos días hacia atrás se re-piden en cada corrida.
 *
 * Siete y no uno por el reajuste de Meta descrito arriba. Siete y no treinta porque cada nivel es
 * una llamada por corrida y la ventana multiplica el volumen de filas del `upsert` sin agregar
 * precisión: más allá de una semana las cifras de Meta ya no se mueven.
 */
const DIAS_VENTANA = 7;

export interface ResultadoColector {
  ok: boolean;
  modo: "real" | "stub";
  rango: { desde: string; hasta: string };
  /** Filas escritas por nivel. Un nivel en cero puede ser "sin actividad" o "falló" — mirá `errores`. */
  porNivel: Record<string, number>;
  errores: string[];
}

/** YYYY-MM-DD de hace N días, en UTC. Meta trabaja en la zona de la cuenta publicitaria, no en la nuestra. */
function haceDias(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Sincroniza los cuatro niveles de la empresa ACTIVA.
 *
 * Nunca lanza: devuelve el detalle. Es un camino de máquina que corre para varias empresas en un
 * bucle, y una que falla no puede cortar a las demás — el mismo criterio que el cron de citas.
 */
export async function sincronizarMeta(): Promise<ResultadoColector> {
  const cliente = meta();
  const desde = haceDias(DIAS_VENTANA);
  const hasta = haceDias(1); // ayer: el día en curso está incompleto y su cifra es engañosa.

  const porNivel: Record<string, number> = {};
  const errores: string[] = [];

  for (const nivel of NIVELES) {
    const r = await cliente.insights({ nivel, desde, hasta });

    /**
     * El crudo se guarda incluso cuando `ok` es false: una respuesta de error de Meta ES el dato
     * que hace falta para entender qué pasó. Solo se saltea si no hubo payload (una excepción de
     * red antes de recibir nada).
     */
    if (r.crudo !== null && r.crudo !== undefined) {
      const { error } = await db()
        .from("closer_meta_crudo")
        .insert({ nivel, fecha_desde: desde, fecha_hasta: hasta, payload: r.crudo });
      if (error) errores.push(`crudo ${nivel}: ${error.message}`);
    }

    if (!r.ok) {
      errores.push(`${nivel}: ${r.error ?? "falló sin detalle"}`);
      porNivel[nivel] = 0;
      continue;
    }

    if (r.metricas.length === 0) {
      porNivel[nivel] = 0;
      continue;
    }

    /**
     * `upsert` sobre la clave única `(org_id, nivel, objeto_id, fecha)`. El `org_id` lo inyecta el
     * Proxy de `db.ts`, pero acá va **explícito en `onConflict`** porque PostgREST necesita nombrar
     * las columnas del conflicto y no puede adivinarlas.
     */
    const filas = r.metricas.map((m) => ({
      org_id: orgActiva(),
      nivel: m.nivel,
      objeto_id: m.objetoId,
      nombre: m.nombre,
      padre_id: m.padreId,
      fecha: m.fecha,
      gasto: m.gasto,
      impresiones: m.impresiones,
      clics: m.clics,
      alcance: m.alcance,
      ctr: m.ctr,
      cpc: m.cpc,
      cpm: m.cpm,
      leads: m.leads,
      cpl: m.cpl,
      video_reproducciones: m.videoReproducciones,
      video_25: m.video25,
      video_50: m.video50,
      video_75: m.video75,
      video_100: m.video100,
      sincronizado_el: new Date().toISOString(),
    }));

    const { error } = await db()
      .from("closer_meta_metricas")
      .upsert(filas, { onConflict: "org_id,nivel,objeto_id,fecha" });

    if (error) {
      errores.push(`${nivel}: ${error.message}`);
      porNivel[nivel] = 0;
      continue;
    }
    porNivel[nivel] = filas.length;
  }

  return { ok: errores.length === 0, modo: cliente.modo, rango: { desde, hasta }, porNivel, errores };
}
