/**
 * `GET /api/agentes/auditor-estado` — por qué el auditor no está analizando nada.
 *
 * ## Por qué existe
 *
 * El auditor está en CERO a propósito: su portón 2 exige `bot_activado` o `bot_reactivar`,
 * y verificado contra la cuenta el 2026-08-04 **ningún contacto tiene ninguno de los dos**.
 * Los workflows que los aplicarían (🟦 08.1 / 08.2) están en borrador. Fabio decidió esperar
 * a Fabio en vez de adivinar el estado del bot.
 *
 * Un cero silencioso es indistinguible de una caída. Este endpoint convierte ese cero en un
 * reclamo concreto: no "el auditor no funciona", sino *"0 de 8 contactos tienen
 * `bot_activado`; lo aplica el workflow 08.1, que está en borrador"*.
 *
 * ## Cero llamadas a GHL, cero escrituras
 *
 * Los portones 1 a 3 son funciones puras de `tags`, y los tags ya están cacheados en
 * `closer_contactos`. El embudo se **recalcula** en cada request en vez de registrarse en el
 * camino caliente — agregarle una escritura a cada webhook para producir un dato que se
 * puede derivar habría sido pagar dos veces por lo mismo.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  botAtendiendo,
  botDesdeTags,
  TAGS,
  TAGS_BOT,
  tieneFalloDeAuditor,
} from "../../src/lib/ghl/contrato.js";
import { AUTORES, type AutorMensaje } from "../../src/lib/ghl/autoria.js";
import { AUDITORES_ACTIVOS, territorioDe } from "../_lib/analizador.js";
import { estadoDeLosPrompts } from "../_lib/promptAgente.js";
import { env } from "../_lib/env.js";
import { db } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";

const DIAS_MENSAJES = 7;

interface FilaContacto {
  ghl_contact_id: string;
  nombre: string | null;
  tags: string[] | null;
  congelado: boolean | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["tecnico"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "Solo GET." });
  }

  try {
    const { data: filas, error } = await db()
      .from("closer_contactos")
      .select("ghl_contact_id, nombre, tags, congelado")
      .limit(2000);
    if (error) throw new Error(`closer_contactos: ${error.message}`);
    const contactos = (filas ?? []) as FilaContacto[];

    /* ── El embudo: dónde se cae cada contacto, portón por portón ────────── */
    const embudo = {
      sinTerritorio: 0,
      territorioSetter: 0,
      botNoAtendiendo: 0,
      yaMarcadoFallo: 0,
      debouncePendiente: 0,
      listosParaAnalizar: 0,
    };

    // Mensajes del agente por contacto, y la línea base del último análisis. Dos queries
    // para todo el lote: el debounce por contacto sería N+1 sobre el camino de diagnóstico.
    const { data: msgs } = await db()
      .from("closer_mensajes")
      .select("ghl_contact_id")
      .eq("autor", "agente_ia")
      .limit(20000);
    const iaPorContacto = new Map<string, number>();
    for (const m of (msgs ?? []) as { ghl_contact_id: string }[]) {
      iaPorContacto.set(
        m.ghl_contact_id,
        (iaPorContacto.get(m.ghl_contact_id) ?? 0) + 1,
      );
    }

    const { data: analisis } = await db()
      .from("closer_analisis_agente")
      .select(
        "ghl_contact_id, ia_cache_al_analizar, analizado_el, fallo, auditable",
      )
      .order("analizado_el", { ascending: false })
      .limit(5000);
    const lineaBase = new Map<string, number>();
    for (const a of (analisis ?? []) as {
      ghl_contact_id: string;
      ia_cache_al_analizar: number | null;
    }[]) {
      if (!lineaBase.has(a.ghl_contact_id))
        lineaBase.set(a.ghl_contact_id, Number(a.ia_cache_al_analizar ?? 0));
    }

    const umbral = env.auditorUmbralIa();
    for (const c of contactos) {
      const tags = c.tags ?? [];
      const territorio = territorioDe(tags);

      if (!territorio) {
        embudo.sinTerritorio++;
        continue;
      }
      // El auditor de chat del setter todavía no existe: sus contactos no se cuentan como
      // bloqueados por el bot, se cuentan como "no hay quién los audite".
      if (
        territorio === "setter" ||
        !AUDITORES_ACTIVOS.includes("appointment-flow-ai")
      ) {
        embudo.territorioSetter++;
        continue;
      }
      // Con el interruptor de prueba puesto (2026-08-06) el portón 2 no corta, así que el
      // embudo tampoco debe contarlo: si el diagnóstico siguiera restando acá, diría que el
      // auditor está bloqueado justo mientras está analizando. Un diagnóstico que se
      // contradice con la realidad es peor que no tenerlo.
      if (!botAtendiendo(tags, territorio) && !env.auditorSinPortonTags()) {
        embudo.botNoAtendiendo++;
        continue;
      }
      if (tieneFalloDeAuditor(tags)) {
        embudo.yaMarcadoFallo++;
        continue;
      }
      const delta =
        (iaPorContacto.get(c.ghl_contact_id) ?? 0) -
        (lineaBase.get(c.ghl_contact_id) ?? 0);
      if (delta < umbral) embudo.debouncePendiente++;
      else embudo.listosParaAnalizar++;
    }

    /* ── Los tags de bot, contados sobre la caché ────────────────────────── */
    const cuentaTag = (tag: string) =>
      contactos.filter((c) =>
        (c.tags ?? []).map((t) => t.trim().toLowerCase()).includes(tag),
      ).length;

    /**
     * Los diez, uno por uno y por su nombre real.
     *
     * Es el panel al que Fabio va a mirar el día que publique los workflows para saber si el
     * auditor se destrabó. Si contara solo `bot_activado` —el legado— seguiría diciendo "0
     * contactos con bot" mientras GHL manda `bot_activado_appflow` a cientos: un diagnóstico que
     * afirma un bloqueo inexistente es peor que no tener panel.
     */
    const tagsDeBot = {
      [TAGS_BOT.botActivadoAppflow.valor]: cuentaTag(
        TAGS_BOT.botActivadoAppflow.valor,
      ),
      [TAGS_BOT.botActivadoLeadflow.valor]: cuentaTag(
        TAGS_BOT.botActivadoLeadflow.valor,
      ),
      [TAGS_BOT.botDesactivadoAppflow.valor]: cuentaTag(
        TAGS_BOT.botDesactivadoAppflow.valor,
      ),
      [TAGS_BOT.botDesactivadoLeadflow.valor]: cuentaTag(
        TAGS_BOT.botDesactivadoLeadflow.valor,
      ),
      [TAGS_BOT.botActivado.valor]: cuentaTag(TAGS_BOT.botActivado.valor),
      [TAGS_BOT.botReactivar.valor]: cuentaTag(TAGS_BOT.botReactivar.valor),
      [TAGS_BOT.botPausadoFallo.valor]: cuentaTag(
        TAGS_BOT.botPausadoFallo.valor,
      ),
      [TAGS_BOT.botDesactivadoPostcall.valor]: cuentaTag(
        TAGS_BOT.botDesactivadoPostcall.valor,
      ),
      [TAGS_BOT.botApagadoManual.valor]: cuentaTag(
        TAGS_BOT.botApagadoManual.valor,
      ),
      [TAGS_BOT.derivadoLt.valor]: cuentaTag(TAGS_BOT.derivadoLt.valor),
    };

    /* ── Salientes por autoría: la alarma temprana ───────────────────────── */
    const desde = new Date(
      Date.now() - DIAS_MENSAJES * 86_400_000,
    ).toISOString();
    const { data: salientes } = await db()
      .from("closer_mensajes")
      .select("autor")
      .eq("direccion", "outbound")
      .gte("timestamp_ghl", desde)
      .limit(20000);

    const porAutor: Record<string, number> = { sinClasificar: 0 };
    for (const a of AUTORES) porAutor[a] = 0;
    for (const m of (salientes ?? []) as { autor: AutorMensaje | null }[]) {
      if (!m.autor) porAutor.sinClasificar++;
      else porAutor[m.autor] = (porAutor[m.autor] ?? 0) + 1;
    }

    /* ── Análisis recientes ──────────────────────────────────────────────── */
    const recientes = (
      (analisis ?? []) as { analizado_el: string; fallo: boolean }[]
    ).filter(
      (a) =>
        Date.parse(a.analizado_el) >= Date.now() - DIAS_MENSAJES * 86_400_000,
    );
    const { count: hallazgosActivos } = await db()
      .from("closer_hallazgo_agente")
      .select("id", { count: "exact", head: true })
      .eq("estado", "activo");

    /* ── Qué falta, en castellano llano ──────────────────────────────────── */
    const loQueFalta: string[] = [];
    /**
     * Cuántos contactos tienen ALGÚN tag que habilite al auditor. Se suman los dos nuevos, el
     * legado y la orden de reactivar: mientras convivan, contar uno solo daría un número que no
     * explica por qué el embudo avanza (o por qué no).
     */
    const conBot =
      tagsDeBot[TAGS_BOT.botActivadoAppflow.valor] +
      tagsDeBot[TAGS_BOT.botActivadoLeadflow.valor] +
      tagsDeBot[TAGS_BOT.botActivado.valor] +
      tagsDeBot[TAGS_BOT.botReactivar.valor];
    const delTerritorio = contactos.filter((c) =>
      (c.tags ?? []).includes(TAGS.zonaCloser.valor),
    ).length;

    if (env.auditorSinPortonTags()) {
      loQueFalta.push(
        "⚠️ MODO PRUEBA (2026-08-06): el portón de los tags 'bot_activado_appflow'/'bot_activado_leadflow' " +
          "está SALTEADO, así que el auditor " +
          "analiza cualquier contacto del territorio que junte 5 mensajes del agente, y puede escribir tags " +
          "en GHL. Se apaga con AUDITOR_SIN_PORTON_TAGS=0. Cuando Fabio publique los workflows " +
          "🟦 08.1 / 08.2, esto se saca y vuelve a regir el portón por tags.",
      );
    } else if (conBot === 0) {
      loQueFalta.push(
        `Ningún contacto tiene 'bot_activado' ni 'bot_reactivar' (0 de ${delTerritorio} en zona_closer). ` +
          "Son los workflows 🟦 08.1 / 08.2 los que aplican y quitan ese tag, y hoy están en BORRADOR. " +
          "Hasta que se publiquen, el auditor no tiene a quién auditar.",
      );
    }
    if (porAutor.desconocido > 0 && porAutor.agente_ia === 0) {
      loQueFalta.push(
        `Hay ${porAutor.desconocido} mensajes salientes que no se pudieron atribuir y CERO identificados ` +
          "como del agente. Puede que el bot de esta subcuenta firme distinto: si Fabio confirma cuál " +
          "es su 'source' o su userId, se ajusta con AUDITOR_FUENTES_IA / AUDITOR_USER_IDS_IA sin desplegar.",
      );
    }
    if (porAutor.sinClasificar > 0) {
      loQueFalta.push(
        `${porAutor.sinClasificar} mensajes se ingirieron antes de la migración 014 y no tienen autoría. ` +
          "El número baja solo a medida que la reconciliación los reemplaza; si queda clavado, la " +
          "reconciliación no está corriendo.",
      );
    }
    const marcadosSinAnalisis = contactos.filter(
      (c) =>
        tieneFalloDeAuditor(c.tags ?? []) && !lineaBase.has(c.ghl_contact_id),
    );
    if (marcadosSinAnalisis.length > 0) {
      loQueFalta.push(
        `${marcadosSinAnalisis.length} contacto(s) tienen 'bot_pausado_fallo' sin ningún análisis detrás: ` +
          "ese tag no lo puso este auditor. ¿Qué workflow o qué persona lo aplica? Mientras tanto aparecen " +
          "en la cola roja con el texto genérico.",
      );
    }
    if (!estadoDeLosPrompts()["appointment-flow-ai"].presente) {
      loQueFalta.push(
        "Falta el prompt del Appointment Flow AI. Se pega en Ajustes › Credenciales › Prompts de los " +
          "agentes y queda guardado en la configuración de la empresa — no requiere deploy. Sin él el " +
          "auditor funciona igual, pero sus correcciones son instrucciones genéricas en vez de " +
          "reemplazos citados.",
      );
    }

    const bloqueante =
      conBot === 0 && !env.auditorSinPortonTags()
        ? "Ningún contacto tiene el agente de IA activado, así que no hay conversaciones que auditar."
        : embudo.listosParaAnalizar === 0 && embudo.debouncePendiente > 0
          ? `Hay ${embudo.debouncePendiente} conversación(es) esperando a que la IA mande ${umbral} mensajes.`
          : null;

    return res.status(200).json({
      ok: true,
      generadoEl: new Date().toISOString(),
      ghlModo: env.ghlModo(),
      corriendo: recientes.length > 0,
      /** Prueba del 2026-08-06: el portón del tag está salteado. Ver `loQueFalta`. */
      modoPrueba: env.auditorSinPortonTags(),
      bloqueante,
      umbralDebounce: umbral,
      contactosEnCache: contactos.length,
      embudo,
      tagsDeBot,
      salientes: { dias: DIAS_MENSAJES, porAutor },
      analisis: {
        ultimos7d: recientes.length,
        conIntervencion: recientes.filter((a) => a.fallo).length,
        ultimoEl: (analisis ?? [])[0]?.analizado_el ?? null,
        hallazgosActivos: hallazgosActivos ?? 0,
      },
      promptAgente: estadoDeLosPrompts(),
      loQueFalta,
      /** Para el detalle fino cuando algo no cuadra: el estado de bot derivado por contacto. */
      contactos: contactos.map((c) => ({
        ghlContactId: c.ghl_contact_id,
        nombre: c.nombre,
        territorio: territorioDe(c.tags ?? []),
        bot: botDesdeTags(c.tags ?? []),
        atendiendo: botAtendiendo(c.tags ?? []),
        marcadoFallo: tieneFalloDeAuditor(c.tags ?? []),
        mensajesIa: iaPorContacto.get(c.ghl_contact_id) ?? 0,
        lineaBase: lineaBase.get(c.ghl_contact_id) ?? null,
      })),
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
