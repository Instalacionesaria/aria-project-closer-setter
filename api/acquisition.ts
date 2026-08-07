/**
 * `GET /api/acquisition?nivel=campana&dias=30` — el dashboard de lectura de pauta (ESPEC §9.3).
 *
 * Fase 7, mínimo viable: **leer y mostrar**. Nada de atribución, alertas ni recomendaciones — esas
 * cuatro están detrás del velo de "en desarrollo" (§8), sin un solo número.
 *
 * ── Los totales se suman; las tasas NO ────────────────────────────────
 *
 * Gasto, impresiones, clics y leads se agregan sumando, que es lo correcto. CTR, CPC, CPM y CPL
 * **no**: promediar promedios da un número que no es el promedio de nada. Se recalculan del total
 * — CPC = gasto/clics sobre todo el período — y con `null` cuando el denominador es cero, porque un
 * CPC de 0 afirma que los clics fueron gratis.
 *
 * `media_buyer` además de `admin`: es el rol para el que §3.1 reserva esta pantalla.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "./_lib/repo.js";
import { activar } from "./_lib/credenciales.js";
import { exigir } from "./_lib/auth.js";
import { tieneCredencialesMeta } from "./_lib/meta/index.js";

type Nivel = "cuenta" | "campana" | "adset" | "anuncio";

/** Suma que trata `null` como ausente: si NINGUNA fila trajo el campo, el total es `null`. */
function suma(filas: Record<string, unknown>[], campo: string): number | null {
  let acum: number | null = null;
  for (const f of filas) {
    const v = f[campo];
    if (v === null || v === undefined) continue;
    const n = Number(v);
    if (!Number.isFinite(n)) continue;
    acum = (acum ?? 0) + n;
  }
  return acum;
}

/** Una división que no miente: `null` si el denominador es cero o falta. */
function ratio(numerador: number | null, denominador: number | null, factor = 1): number | null {
  if (numerador === null || denominador === null || denominador === 0) return null;
  return Math.round((numerador / denominador) * factor * 10_000) / 10_000;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await exigir(req, res, ["media_buyer", "admin"]);
  if (!ctx) return;
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const pedido = String(req.query.nivel ?? "campana");
    const nivel: Nivel = ["cuenta", "campana", "adset", "anuncio"].includes(pedido) ? (pedido as Nivel) : "campana";
    const dias = Math.min(Math.max(Number(req.query.dias) || 30, 1), 365);
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

    const { data, error } = await db()
      .from("closer_meta_metricas")
      .select("objeto_id, nombre, fecha, gasto, impresiones, clics, alcance, leads, video_reproducciones, video_25, video_50, video_75, video_100")
      .eq("nivel", nivel)
      .gte("fecha", desde)
      .order("fecha", { ascending: true });
    if (error) throw new Error(`closer_meta_metricas: ${error.message}`);

    const filas = (data ?? []) as unknown as Record<string, unknown>[];

    /* ── Por objeto, con las tasas recalculadas del total ─────────────────── */
    const porObjeto = new Map<string, Record<string, unknown>[]>();
    for (const f of filas) {
      const id = String(f.objeto_id);
      porObjeto.set(id, [...(porObjeto.get(id) ?? []), f]);
    }

    const objetos = [...porObjeto.entries()].map(([id, suyas]) => {
      const gasto = suma(suyas, "gasto");
      const impresiones = suma(suyas, "impresiones");
      const clics = suma(suyas, "clics");
      const leads = suma(suyas, "leads");
      return {
        objetoId: id,
        nombre: (suyas[suyas.length - 1].nombre as string | null) ?? null,
        dias: suyas.length,
        gasto,
        impresiones,
        clics,
        alcance: suma(suyas, "alcance"),
        leads,
        // Recalculadas, nunca promediadas.
        ctr: ratio(clics, impresiones, 100),
        cpc: ratio(gasto, clics),
        cpm: ratio(gasto, impresiones, 1000),
        cpl: ratio(gasto, leads),
        video: {
          reproducciones: suma(suyas, "video_reproducciones"),
          retencion25: suma(suyas, "video_25"),
          retencion50: suma(suyas, "video_50"),
          retencion75: suma(suyas, "video_75"),
          retencion100: suma(suyas, "video_100"),
        },
      };
    });

    const gastoTotal = suma(filas, "gasto");
    const impresionesTotal = suma(filas, "impresiones");
    const clicsTotal = suma(filas, "clics");
    const leadsTotal = suma(filas, "leads");

    return res.status(200).json({
      ok: true,
      nivel,
      dias,
      desde,
      /**
       * Sin credenciales de Meta la respuesta es válida y vacía, no un error: es el estado normal
       * de un cliente que todavía no conectó su cuenta. La vista lo dice con palabras en vez de
       * mostrar un panel de ceros.
       */
      conectado: tieneCredencialesMeta(),
      /** `true` cuando hay credenciales pero todavía no corrió el cron. Son dos vacíos distintos. */
      sinSincronizarAun: tieneCredencialesMeta() && filas.length === 0,
      totales: {
        gasto: gastoTotal,
        impresiones: impresionesTotal,
        clics: clicsTotal,
        alcance: suma(filas, "alcance"),
        leads: leadsTotal,
        ctr: ratio(clicsTotal, impresionesTotal, 100),
        cpc: ratio(gastoTotal, clicsTotal),
        cpm: ratio(gastoTotal, impresionesTotal, 1000),
        cpl: ratio(gastoTotal, leadsTotal),
      },
      objetos: objetos.sort((a, b) => (b.gasto ?? 0) - (a.gasto ?? 0)),
      /** La serie diaria del gasto, para el gráfico. Un punto por día con dato. */
      serie: [...new Set(filas.map((f) => String(f.fecha)))].sort().map((fecha) => ({
        fecha,
        gasto: suma(filas.filter((f) => String(f.fecha) === fecha), "gasto"),
        leads: suma(filas.filter((f) => String(f.fecha) === fecha), "leads"),
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
