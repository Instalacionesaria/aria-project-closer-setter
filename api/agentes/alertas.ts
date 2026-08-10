/**
 * `GET /api/agentes/alertas?dias=30` — lo que reemplaza a `SEED_ALERTS`.
 *
 * ## Dos listas, no una
 *
 * Se devuelven **patrones** y **casos** por separado. El diagnóstico, el fragmento del
 * prompt y la corrección propuesta son del PATRÓN, no del caso: mandarlos repetidos en cada
 * una de las quince filas de un grupo es exactamente la duplicación que tenía la semilla.
 *
 * El servidor decide **qué texto gana** (el del hallazgo más reciente de ese `error_code`) y
 * lo manda una sola vez. El cliente decide **cómo se agrupa y se cuenta**. Un solo lugar
 * para cada decisión — y el agrupamiento se queda en el cliente para que `casesCount` sea
 * `cases.length` por construcción, que es lo que evita que vuelva el desfase de §32.D
 * ("×15 casos" con 2 ejemplos).
 *
 * Cero llamadas a GHL: sale todo de Supabase.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  AGENTES_CON_AUDITOR,
  AUDITORES_ACTIVOS,
  type AgenteTextoId,
  type AgenteAuditableId,
} from "../_lib/analizador.js";
import { cargarPromptAgente } from "../_lib/promptAgente.js";
import { env } from "../_lib/env.js";
import { db } from "../_lib/repo.js";
import { activar } from "../_lib/credenciales.js";
import { exigir } from "../_lib/auth.js";
import { ghl } from "../_lib/ghl/index.js";
import { TAGS_BOT } from "../../src/lib/ghl/contrato.js";

const DIAS_POR_DEFECTO = 30;

interface FilaHallazgo {
  id: string;
  agente_id: AgenteTextoId;
  ghl_contact_id: string;
  error_code: string;
  titulo: string;
  categoria: string;
  severidad: string;
  diagnostico: string | null;
  fragmento_prompt: string | null;
  prompt_seccion: string | null;
  correccion_tipo: string | null;
  correccion: string | null;
  prompt_hash: string | null;
  evidencia_usuario: string | null;
  evidencia_ia: string | null;
  estado: string;
  detectado_el: string;
}

/**
 * El enlace al contacto en GHL. Se arma ACÁ porque `ghlLocationId` es una credencial de
 * servidor: el browser no la tiene ni debe tenerla. Sin location, no hay link — y la vista
 * no renderiza un botón que no lleva a ningún lado (§4.10).
 */
function urlDeGhl(ghlContactId: string): string | null {
  if (!env.tieneCredencialesGhl()) return null;
  return `https://app.gohighlevel.com/v2/location/${env.ghlLocationId()}/contacts/detail/${ghlContactId}`;
}

/**
 * `POST /api/agentes/alertas` — el closer tomó la conversación a mano.
 *
 * Marca los hallazgos ACTIVOS de ese contacto como `resuelto_por_humano`. No es lo mismo que
 * parchear el patrón: el caso puntual está atendido, pero la falla del agente sigue ahí y el
 * técnico todavía tiene que corregir el prompt — por eso son dos estados y no uno.
 *
 * Se identifica por `ghlContactId`. El cruce por nombre que había antes estaba roto desde
 * que el closer indexa por id, y encima solo vivía en memoria: refrescar lo revertía.
 *
 * ── Ahora sí quita el tag (2026-08-07) ───────────────────────────────
 *
 * Hasta hoy esto marcaba el hallazgo y **no tocaba GHL**, así que el contacto volvía a Urgentes
 * en el próximo tick con la alerta ya resuelta: el closer lo atendía, lo resolvía, y lo veía
 * reaparecer. La nota que había acá decía que el puerto no tenía `quitarTags` — era falso,
 * `removerTags` existe desde hace tiempo (`ghl/port.ts`) y ya tiene un llamador que funciona en
 * `seguimientos.ts`. Lo que faltaba era llamarlo desde acá.
 *
 * Lo autoriza la especificación §10 con todas las letras: *"Sin él, resolver una intervención no
 * saca `bot_pausado_fallo` y el contacto vuelve a Urgentes en el siguiente tick. Con 5 empresas
 * eso se multiplica por 5 y ensucia el pipeline de todos."*
 *
 * ── Lo que sigue sin hacer, y es a propósito ─────────────────────────
 *
 * **No escribe `bot_reactivar`.** El contrato §9 lo define como una ORDEN de reactivar, no como
 * un estado, y quitar la pausa no es lo mismo que pedirle al bot que vuelva a atender a alguien
 * cuya conversación se pausó por un fallo grave. Que el bot retome es una decisión de producto
 * de Fabio, no una consecuencia técnica de resolver la alerta.
 *
 * Consecuencia concreta: después de esto el contacto sale de Urgentes y **queda sin bot**, en
 * manos del humano que lo tomó. Que es exactamente lo que "resolver por humano" significa.
 */
async function resolverPorHumano(req: VercelRequest, res: VercelResponse) {
  const cuerpo =
    (typeof req.body === "string" ? safeJson(req.body) : req.body) ?? {};
  const { ghlContactId } = cuerpo as Record<string, unknown>;
  if (typeof ghlContactId !== "string" || !ghlContactId) {
    return res.status(400).json({ ok: false, error: "Falta ghlContactId." });
  }

  const { data, error } = await db()
    .from("closer_hallazgo_agente")
    .update({
      estado: "resuelto_por_humano",
      resuelto_el: new Date().toISOString(),
    })
    .eq("ghl_contact_id", ghlContactId)
    .eq("estado", "activo")
    .select("id");
  if (error) throw new Error(`closer_hallazgo_agente: ${error.message}`);

  const resueltos = data?.length ?? 0;

  /**
   * El tag se quita DESPUÉS de persistir, y el orden importa: si GHL falla, el hallazgo ya
   * quedó resuelto en nuestra base y lo único que pasa es que el contacto reaparece en Urgentes
   * —el estado de antes—. Al revés, un tag quitado con la base sin actualizar dejaría al
   * contacto fuera de la cola con su alerta todavía activa, o sea invisible.
   *
   * La idempotencia va por contacto y por día: reintentar la misma resolución no debe anotar dos
   * efectos en el outbox, y resolver otra alerta del mismo contacto la semana siguiente sí.
   *
   * `removerTags` **no lanza**: devuelve una unión discriminada por `ok`. El `try` es solo por
   * si explota algo antes de la llamada, y el fallo esperado se lee del resultado.
   */
  let tagQuitado: { ok: boolean; aplicado?: boolean; error?: string };
  try {
    const dia = new Date().toISOString().slice(0, 10);
    const r = await ghl().removerTags({
      ghlContactId,
      tags: [TAGS_BOT.botPausadoFallo.valor],
      idempotencyKey: `resolver-humano:${ghlContactId}:${dia}`,
    });
    /**
     * `ok: true` con `aplicado: false` es un caso legítimo y distinto del error: en modo stub la
     * intención queda anotada en el outbox y nada llega a GHL. Se reportan separados para que la
     * UI no diga "listo" cuando lo único que pasó fue que se guardó la intención.
     */
    tagQuitado = r.ok
      ? { ok: true, aplicado: r.aplicado }
      : { ok: false, error: r.error };
    if (!r.ok) {
      console.error(
        `[alertas] no se pudo quitar ${TAGS_BOT.botPausadoFallo.valor} de ${ghlContactId}: ${r.error}`,
      );
    }
  } catch (e) {
    /**
     * No se propaga: la resolución YA ocurrió y devolver 500 le diría al closer que no se
     * resolvió nada. Se reporta en la respuesta para que la UI pueda decir la verdad completa
     * —"resuelto, pero el tag no se pudo quitar"— en vez de elegir entre dos medias verdades.
     */
    console.error(
      `[alertas] excepción al quitar el tag de ${ghlContactId}: ${(e as Error).message}`,
    );
    tagQuitado = { ok: false, error: (e as Error).message };
  }

  return res.status(200).json({ ok: true, resueltos, tagQuitado });
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["tecnico"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  if (req.method === "POST") {
    try {
      return await resolverPorHumano(req, res);
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  }
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "Solo GET o POST." });
  }

  try {
    const dias = Math.min(
      Math.max(Number(req.query.dias) || DIAS_POR_DEFECTO, 1),
      365,
    );
    const desde = new Date(Date.now() - dias * 86_400_000).toISOString();

    const { data, error } = await db()
      .from("closer_hallazgo_agente")
      .select(
        "id, agente_id, ghl_contact_id, error_code, titulo, categoria, severidad, diagnostico, " +
          "fragmento_prompt, prompt_seccion, correccion_tipo, correccion, prompt_hash, " +
          "evidencia_usuario, evidencia_ia, estado, detectado_el",
      )
      .gte("detectado_el", desde)
      .order("detectado_el", { ascending: false })
      .limit(2000);
    if (error) throw new Error(`closer_hallazgo_agente: ${error.message}`);
    // El select multilínea rompe la inferencia de supabase-js — shape declarado a mano,
    // igual que en `mi-dia.ts`.
    const hallazgos = (data ?? []) as unknown as FilaHallazgo[];

    /* ── Nombres de los contactos, en una query ──────────────────────────── */
    const ids = [...new Set(hallazgos.map((h) => h.ghl_contact_id))];
    const nombres = new Map<string, string>();
    if (ids.length > 0) {
      const { data: filas } = await db()
        .from("closer_contactos")
        .select("ghl_contact_id, nombre")
        .in("ghl_contact_id", ids);
      for (const f of (filas ?? []) as {
        ghl_contact_id: string;
        nombre: string | null;
      }[]) {
        if (f.nombre) nombres.set(f.ghl_contact_id, f.nombre);
      }
    }

    /* ── Ajustes previos, para saber si un patrón reincidió ──────────────── */
    const { data: ajustesData } = await db()
      .from("closer_ajustes_agente")
      .select("agente_id, error_code, aplicado_el")
      .order("aplicado_el", { ascending: false })
      .limit(1000);
    const ultimoAjuste = new Map<string, string>();
    for (const a of (ajustesData ?? []) as {
      agente_id: string;
      error_code: string;
      aplicado_el: string;
    }[]) {
      const clave = `${a.agente_id}::${a.error_code}`;
      if (!ultimoAjuste.has(clave)) ultimoAjuste.set(clave, a.aplicado_el);
    }

    /* ── Un patrón por (agente, error_code), con el texto del más reciente ── */
    const patrones = new Map<string, ReturnType<typeof aPatron>>();
    function aPatron(h: FilaHallazgo) {
      const clave = `${h.agente_id}::${h.error_code}`;
      const ajustadoEl = ultimoAjuste.get(clave) ?? null;
      const vigente = cargarPromptAgente(h.agente_id);
      return {
        agenteId: h.agente_id,
        errorCode: h.error_code,
        titulo: h.titulo,
        categoria: h.categoria,
        severidad: h.severidad,
        diagnostico: h.diagnostico,
        /**
         * DISCRIMINANTE ESTRUCTURAL (regla 1 del patrón del closer): presente = el auditor
         * tenía el prompt del agente y citó texto literal; ausente = no lo tenía y la
         * corrección es una instrucción para agregar. Nunca un booleano `esNuevo`.
         */
        fragmentoPrompt: h.fragmento_prompt,
        promptSeccion: h.prompt_seccion,
        correccionTipo: h.correccion_tipo,
        correccion: h.correccion,
        promptRef: h.fragmento_prompt
          ? { archivo: vigente.ruta, seccion: h.prompt_seccion }
          : null,
        /**
         * El prompt cambió desde que se detectó esto: el fragmento citado puede ya no
         * existir, y pegar la corrección sería reemplazar algo que no está.
         */
        promptDesactualizado: Boolean(
          h.fragmento_prompt &&
          vigente.presente &&
          h.prompt_hash &&
          h.prompt_hash !== vigente.hash,
        ),
        textoDe: h.detectado_el,
        ajustadoEl,
        reincidenteDesde: null as string | null,
      };
    }

    // Las filas vienen ordenadas de más reciente a más vieja, así que la PRIMERA de cada
    // patrón es la que aporta los textos. Antes esto era `group.find(a => a.diagnostico)` en
    // el cliente — "el primero que tenga algo", que con datos reales es "uno cualquiera".
    for (const h of hallazgos) {
      const clave = `${h.agente_id}::${h.error_code}`;
      if (!patrones.has(clave)) patrones.set(clave, aPatron(h));
    }

    // Reincidencia: el primer hallazgo POSTERIOR al ajuste. Es una query, no un estado que
    // alguien tenga que acordarse de escribir — un flag se desincroniza, esto no.
    for (const [clave, patron] of patrones) {
      if (!patron.ajustadoEl) continue;
      const posteriores = hallazgos
        .filter(
          (h) =>
            `${h.agente_id}::${h.error_code}` === clave &&
            h.detectado_el > patron.ajustadoEl!,
        )
        .map((h) => h.detectado_el)
        .sort();
      patron.reincidenteDesde = posteriores[0] ?? null;
    }

    const casos = hallazgos.map((h) => ({
      id: h.id,
      agenteId: h.agente_id,
      errorCode: h.error_code,
      /** LA clave del join hacia el closer. Reemplaza al cruce por nombre, que estaba roto. */
      ghlContactId: h.ghl_contact_id,
      // `null` y no "Sin nombre": la vista decide cómo mostrar la ausencia (§4.10).
      nombre: nombres.get(h.ghl_contact_id) ?? null,
      // ISO. La vista compone "hace 2 horas"; el servidor no compone texto de tiempo.
      analizadoEl: h.detectado_el,
      estado: h.estado,
      evidencia:
        h.evidencia_usuario || h.evidencia_ia
          ? {
              tipo: "chat" as const,
              mensajeUsuario: h.evidencia_usuario ?? "",
              mensajeIa: h.evidencia_ia ?? "",
            }
          : undefined,
      ghlUrl: urlDeGhl(h.ghl_contact_id),
    }));

    /* ── Cuántos análisis sostienen esto, por agente ─────────────────────── */
    const { data: analisis } = await db()
      .from("closer_analisis_agente")
      .select("agente_id")
      .eq("auditable", true)
      .neq("disparo", "linea_base")
      .gte("analizado_el", desde)
      .limit(5000);
    const analisisPorAgente: Record<string, number> = {};
    for (const a of (analisis ?? []) as { agente_id: string }[]) {
      analisisPorAgente[a.agente_id] =
        (analisisPorAgente[a.agente_id] ?? 0) + 1;
    }

    return res.status(200).json({
      ok: true,
      ventanaDias: dias,
      // De la misma constante que usa el analizador, para que los dos endpoints no puedan
      // decir cosas distintas sobre qué agentes tienen auditor.
      agentesConAuditor: AGENTES_CON_AUDITOR,
      analisisPorAgente,
      patrones: [...patrones.values()],
      casos,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}
