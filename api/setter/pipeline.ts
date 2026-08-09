/**
 * `GET/PATCH /api/setter/pipeline` — las siete etapas, con datos reales.
 *
 * ── Qué reemplaza ─────────────────────────────────────────────────────
 *
 * El pipeline del setter renderizaba **2 columnas de 7**, filtrando el array de semillas en
 * memoria. Los contactos de las otras cinco etapas no se mostraban en ninguna parte: no había un
 * "otros", ni un contador — desaparecían. Y un Avanzar → No califica hacía que el contacto se
 * esfumara del tablero.
 *
 * ── Mover una tarjeta ─────────────────────────────────────────────────
 *
 * `PATCH` escribe `closer_contactos.stage_key` —la fuente de verdad— y manda el tag a GHL para
 * que sus workflows puedan reaccionar. Las dos cosas, en ese orden: si GHL falla, la etapa ya
 * quedó registrada; al revés se perdería.
 *
 * **Un contacto congelado no se mueve.** Perdió su territorio, así que hacia GHL es un cuerpo
 * inerte: escribirle un tag sería mandar una orden sobre alguien que ya no está en el embudo.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { exigir } from "../_lib/auth.js";
import { activar } from "../_lib/credenciales.js";
import { db } from "../_lib/repo.js";
import { env } from "../_lib/env.js";
import { ghl } from "../_lib/ghl/index.js";
import { TAGS } from "../../src/lib/ghl/contrato.js";
import {
  esEtapaSetter,
  etapaSetterDesdeTags,
  etapaSetterPorClave,
  ETAPAS_SETTER,
  tagsDeOtrasEtapas,
  type EtapaSetter,
} from "../../src/lib/ghl/etapasSetter.js";

const COLUMNAS = "ghl_contact_id, nombre, telefono, fuente, tags, stage_key, congelado, monto, atribucion_setter_id";

interface Fila {
  ghl_contact_id: string;
  nombre: string | null;
  telefono: string | null;
  fuente: string | null;
  tags: string[] | null;
  stage_key: string | null;
  congelado: boolean;
  monto: number | null;
  atribucion_setter_id: string | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["setter"]);
  if (!ctx) return;
  // Desde acá, env.ghlApiKey() y env.ghlLocationId() son las de ESTA empresa (§5.2).
  activar(ctx.credenciales);

  try {
    if (req.method === "GET") return await listar(res);
    if (req.method === "PATCH") return await mover(req, res);
    res.setHeader("Allow", "GET, PATCH");
    return res.status(405).json({ ok: false, error: "Usá GET o PATCH." });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

async function listar(res: VercelResponse) {
  const { data, error } = await db().from("closer_contactos").select(COLUMNAS).limit(2000);
  if (error) throw new Error(`closer_contactos: ${error.message}`);

  const delSetter = ((data ?? []) as unknown as Fila[]).filter((c) =>
    (c.tags ?? []).map((t) => t.trim().toLowerCase()).includes(TAGS.zonaSetter.valor),
  );

  /**
   * Las SIETE columnas siempre, incluso las vacías. Una etapa que desaparece del tablero cuando
   * no tiene contactos es peor que una vacía: no se puede arrastrar una tarjeta hacia algo que no
   * se ve, y el embudo deja de leerse como un embudo.
   */
  const columnas = ETAPAS_SETTER.map((e) => ({
    key: e.key,
    label: e.label,
    terminal: e.terminal,
    // Que el tag todavía no exista en GHL es un hecho de la columna, y la vista lo puede decir.
    tagPendiente: e.tag?.confianza === "pendiente",
    contactos: delSetter
      .filter((c) => etapaDe(c) === e.key)
      .map((c) => ({
        contactId: c.ghl_contact_id,
        name: c.nombre ?? c.ghl_contact_id,
        phone: c.telefono,
        fuente: c.fuente,
        monto: c.monto,
        /** Congelado: se muestra y no se acciona. Ver la cabecera. */
        congelado: c.congelado,
        atribuido: Boolean(c.atribucion_setter_id),
      })),
  }));

  return res.status(200).json({
    ok: true,
    ghlModo: ghl().modo,
    zonaHoraria: env.zonaHoraria(),
    // Cero llamadas a GHL: todo sale de la caché.
    llamadasGhl: 0,
    total: delSetter.length,
    columnas,
  });
}

/** Supabase manda; sin `stage_key` se deriva de los tags. Mismo criterio que el closer. */
function etapaDe(c: Fila): EtapaSetter {
  const guardada = c.stage_key;
  if (guardada && esEtapaSetter(guardada)) return guardada;
  return etapaSetterDesdeTags(c.tags ?? []);
}

async function mover(req: VercelRequest, res: VercelResponse) {
  const cuerpo = (typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body) as Record<string, unknown>;
  const ghlContactId = String(cuerpo?.ghlContactId ?? "").trim();
  const destino = String(cuerpo?.etapa ?? "").trim();

  if (!ghlContactId) {
    return res.status(400).json({ ok: false, codigo: "contacto_faltante", error: "Falta ghlContactId." });
  }
  const def = etapaSetterPorClave(destino);
  if (!def) {
    return res.status(400).json({
      ok: false,
      codigo: "etapa_invalida",
      error: `"${destino}" no es una etapa del setter.`,
      opciones: ETAPAS_SETTER.map((e) => e.key),
    });
  }

  const { data: fila, error: errLeer } = await db()
    .from("closer_contactos")
    .select("congelado, tags")
    .eq("ghl_contact_id", ghlContactId)
    .maybeSingle();
  if (errLeer) throw new Error(`closer_contactos: ${errLeer.message}`);
  if (!fila) return res.status(404).json({ ok: false, codigo: "contacto_desconocido", error: "Ese contacto no está en la caché." });

  if ((fila as { congelado: boolean }).congelado) {
    return res.status(409).json({
      ok: false,
      codigo: "contacto_congelado",
      error: "El contacto perdió su territorio en GHL: se muestra pero no se puede mover.",
    });
  }

  /* ── 1. Supabase primero: es la fuente de verdad del stage ── */
  const { error: errEtapa } = await db()
    .from("closer_contactos")
    .update({ stage_key: def.key })
    .eq("ghl_contact_id", ghlContactId);
  if (errEtapa) throw new Error(`stage_key: ${errEtapa.message}`);

  /* ── 2. GHL después, y solo si el literal está confirmado ── */
  /**
   * ── Por qué no se usa `assertEnviable` acá ────────────────────────
   *
   * Porque **lanza**, y lanzar sería lo peor que puede pasar en este punto: la etapa ya se
   * escribió en Supabase, así que un throw dejaría la respuesta en 500 sobre un movimiento que en
   * realidad SÍ ocurrió. El usuario vería un error y la tarjeta movida.
   *
   * Tres de las siete etapas tienen tag `pendiente` —todavía no existen en la subcuenta— y eso no es una
   * falla: es el estado esperado hasta que existan. Se reporta como un efecto explícito, con
   * `aplicado: false`, para que nadie confunda "no se mandó porque no existe" con "se mandó".
   */
  const efectos: { operacion: string; detalle: string; ok: boolean; aplicado: boolean; error?: string }[] = [];
  const modoReal = env.ghlModo() === "real";
  const idempotencyKey = `pipeline:${ghlContactId}:${def.key}`;

  if (!def.tag) {
    efectos.push({
      operacion: "sin_tag_propio",
      detalle: `La etapa "${def.label}" no tiene tag propio a propósito: la resuelve el swap de territorio del WF 04.1.`,
      ok: true,
      aplicado: false,
    });
  } else if (modoReal && def.tag.confianza === "pendiente") {
    efectos.push({
      operacion: "tag_pendiente",
      detalle: `"${def.tag.valor}" todavía no existe en la subcuenta. La etapa se guardó en el tool; el tag sale cuando exista en GHL.`,
      ok: true,
      aplicado: false,
    });
  } else {
    const cliente = ghl();
    // Las etapas son excluyentes: se quitan las otras para que el contacto no quede en dos.
    const aQuitar = tagsDeOtrasEtapas(def.key)
      .filter((t) => !(modoReal && t.confianza === "pendiente"))
      .map((t) => t.valor);

    if (aQuitar.length > 0) {
      const r = await cliente.removerTags({ ghlContactId, tags: aQuitar, idempotencyKey: `${idempotencyKey}:quitar` });
      efectos.push({
        operacion: "quitar_tags",
        detalle: aQuitar.join(", "),
        ok: r.ok,
        aplicado: r.ok ? r.aplicado : false,
        ...(r.ok ? {} : { error: r.error }),
      });
    }

    const r = await cliente.aplicarTags({ ghlContactId, tags: [def.tag.valor], idempotencyKey: `${idempotencyKey}:aplicar` });
    efectos.push({
      operacion: "aplicar_tags",
      detalle: def.tag.valor,
      ok: r.ok,
      aplicado: r.ok ? r.aplicado : false,
      ...(r.ok ? {} : { error: r.error }),
    });
  }

  return res.status(200).json({
    ok: true,
    etapa: def.key,
    ghl: {
      // Se reporta lo que REALMENTE pasó, nunca un `ok` que tape un tag que no salió.
      todoAplicado: efectos.length > 0 && efectos.every((e) => e.ok && e.aplicado),
      efectos,
    },
  });
}
