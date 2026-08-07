/**
 * El adapter real de Meta — Graph API v21.0, endpoint `/insights`.
 *
 * ── Lo que este archivo NO sabe ───────────────────────────────────────
 *
 * Nadie de este equipo vio todavía una respuesta de la Graph API de la cuenta de ARIA: las
 * credenciales existen en `closer_org_config` desde la fase 3 y **nunca se usaron**. Así que el
 * mapeo de abajo está escrito desde la documentación de Meta, no desde datos observados, y eso
 * cambia cómo hay que leerlo:
 *
 *   · Cada campo se lee con `numero()`, que devuelve `null` ante cualquier cosa que no sea un
 *     número — Meta manda strings para las cifras, omite campos que no aplican, y devuelve
 *     `actions` como un array de objetos con su propio vocabulario.
 *   · Quien llama guarda el payload crudo en `closer_meta_crudo` ANTES de mapear (D15). Si una
 *     métrica falta o viene con otro nombre, el dato está y se remapea sin haber perdido nada.
 *   · Ninguna cifra se recalcula: CTR, CPC, CPM y CPL se guardan tal como los manda Meta. Si Meta
 *     y nosotros redondeáramos distinto, dos vitrinas del mismo hecho empezarían a divergir.
 *
 * La primera sincronización real es una verificación, no un trámite: hay que abrir
 * `closer_meta_crudo` y comparar contra lo que quedó en `closer_meta_metricas`.
 */

import { credencialesActivas } from "../credenciales.js";
import type { MetaPort, MetricaMeta, NivelMeta, ResultadoMeta } from "./port.js";

const GRAPH = "https://graph.facebook.com/v21.0";

/** El `level` que espera Meta para cada nivel nuestro. */
const NIVEL_META: Record<NivelMeta, string> = {
  cuenta: "account",
  campana: "campaign",
  adset: "adset",
  anuncio: "ad",
};

/** De dónde sale el id del objeto según el nivel. */
const CAMPO_ID: Record<NivelMeta, string> = {
  cuenta: "account_id",
  campana: "campaign_id",
  adset: "adset_id",
  anuncio: "ad_id",
};

const CAMPO_NOMBRE: Record<NivelMeta, string> = {
  cuenta: "account_name",
  campana: "campaign_name",
  adset: "adset_name",
  anuncio: "ad_name",
};

/** De quién cuelga cada nivel. `null` en cuenta. */
const CAMPO_PADRE: Record<NivelMeta, string | null> = {
  cuenta: null,
  campana: "account_id",
  adset: "campaign_id",
  anuncio: "adset_id",
};

/**
 * Un número, o `null`.
 *
 * Meta manda las cifras como **strings** (`"1234.56"`), omite los campos que no aplican, y a veces
 * devuelve cadena vacía. Las tres cosas tienen que resolver a `null` y no a 0: `null` = no vino,
 * `0` = vino en cero, y confundirlos convierte "no medido" en "medido en cero" (§4.1).
 */
function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Una métrica de `actions` / `cost_per_action_type`, que Meta devuelve como array de objetos.
 *
 * Los leads de un formulario nativo pueden venir como `lead` o como
 * `onsite_conversion.lead_grouped` según cómo esté configurada la campaña — se aceptan los dos y
 * gana el primero que aparezca.
 */
function deAcciones(lista: unknown, tipos: string[]): number | null {
  if (!Array.isArray(lista)) return null;
  for (const tipo of tipos) {
    const encontrado = lista.find((a) => (a as Record<string, unknown>)?.action_type === tipo);
    if (encontrado) return numero((encontrado as Record<string, unknown>).value);
  }
  return null;
}

/** Una acción de video, que viven en `video_p<N>_watched_actions`. */
function deVideo(lista: unknown): number | null {
  if (!Array.isArray(lista) || lista.length === 0) return null;
  return numero((lista[0] as Record<string, unknown>)?.value);
}

/** Los campos que se le piden a Meta. Explícitos: `fields` vacío devuelve un default que cambia. */
const CAMPOS = [
  "date_start",
  "spend",
  "impressions",
  "clicks",
  "reach",
  "ctr",
  "cpc",
  "cpm",
  "actions",
  "cost_per_action_type",
  "video_play_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p100_watched_actions",
];

function mapear(fila: Record<string, unknown>, nivel: NivelMeta): MetricaMeta {
  const padre = CAMPO_PADRE[nivel];
  return {
    nivel,
    objetoId: String(fila[CAMPO_ID[nivel]] ?? ""),
    nombre: (fila[CAMPO_NOMBRE[nivel]] as string | undefined) ?? null,
    padreId: padre ? ((fila[padre] as string | undefined) ?? null) : null,
    // `date_start` viene por el `time_increment=1`: una fila por día.
    fecha: String(fila.date_start ?? "").slice(0, 10),

    gasto: numero(fila.spend),
    impresiones: numero(fila.impressions),
    clics: numero(fila.clicks),
    alcance: numero(fila.reach),
    ctr: numero(fila.ctr),
    cpc: numero(fila.cpc),
    cpm: numero(fila.cpm),
    leads: deAcciones(fila.actions, ["lead", "onsite_conversion.lead_grouped"]),
    cpl: deAcciones(fila.cost_per_action_type, ["lead", "onsite_conversion.lead_grouped"]),

    videoReproducciones: deVideo(fila.video_play_actions),
    video25: deVideo(fila.video_p25_watched_actions),
    video50: deVideo(fila.video_p50_watched_actions),
    video75: deVideo(fila.video_p75_watched_actions),
    video100: deVideo(fila.video_p100_watched_actions),
  };
}

export const metaReal: MetaPort = {
  modo: "real",

  async insights({ nivel, desde, hasta }): Promise<ResultadoMeta> {
    const cred = credencialesActivas();
    if (!cred) {
      return { ok: false, metricas: [], crudo: null, real: true, error: "sin empresa activa" };
    }
    if (!cred.metaToken || !cred.metaAdAccountId) {
      return {
        ok: false,
        metricas: [],
        crudo: null,
        real: true,
        error: `La empresa "${cred.nombre}" no tiene cargadas las credenciales de Meta.`,
      };
    }

    /**
     * El id de la cuenta va con el prefijo `act_`. Se agrega acá y no se le pide al usuario que lo
     * escriba: Meta lo muestra en su UI de las dos formas y la mitad de las veces se pega sin él.
     */
    const cuenta = cred.metaAdAccountId.startsWith("act_") ? cred.metaAdAccountId : `act_${cred.metaAdAccountId}`;

    const params = new URLSearchParams({
      level: NIVEL_META[nivel],
      fields: CAMPOS.join(","),
      // Una fila POR DÍA. Sin esto Meta devuelve el acumulado del rango, que es exactamente lo que
      // §9 prohíbe guardar.
      time_increment: "1",
      time_range: JSON.stringify({ since: desde, until: hasta }),
      limit: "500",
      access_token: cred.metaToken,
    });

    try {
      const res = await fetch(`${GRAPH}/${cuenta}/insights?${params.toString()}`);
      const cuerpo = (await res.json()) as Record<string, unknown>;

      if (!res.ok) {
        /**
         * El error de Meta viene en `error.message` y suele ser útil ("token expirado", "no tenés
         * permiso sobre esta cuenta"). Se propaga tal cual: reescribirlo a "no se pudo sincronizar"
         * le quitaría a quien lo lea la única pista que tiene.
         */
        const detalle = (cuerpo.error as Record<string, unknown> | undefined)?.message ?? `HTTP ${res.status}`;
        return { ok: false, metricas: [], crudo: cuerpo, real: true, error: String(detalle) };
      }

      const filas = Array.isArray(cuerpo.data) ? (cuerpo.data as Record<string, unknown>[]) : [];
      /**
       * Se descartan las filas sin id o sin fecha: son las dos partes de la clave única, y una fila
       * sin clave no se puede guardar sin arriesgar a pisar otra. El crudo la conserva igual.
       */
      const metricas = filas.map((f) => mapear(f, nivel)).filter((m) => m.objetoId && m.fecha);

      return { ok: true, metricas, crudo: cuerpo, real: true };
    } catch (e) {
      return { ok: false, metricas: [], crudo: null, real: true, error: (e as Error).message };
    }
  },
};
