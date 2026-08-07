/**
 * `/api/closer/notas` — el tab Notas de la ficha del contacto.
 *
 *   GET    ?ghlContactId=...            → las notas del contacto, la más reciente primero.
 *   POST   { ghlContactId, texto, ... } → agrega una nota.
 *   DELETE ?id=...                      → borra UNA nota por su id (pedido de Fabio, 2026-08-03).
 *
 * ── Por qué las notas no son eventos del historial ──
 *
 * Son dos cosas distintas y por eso son dos tablas y dos endpoints. El historial registra QUÉ
 * PASÓ (lo escriben los casos de uso, es append-only, autor `Sistema` cuando nadie intervino);
 * las notas son QUÉ ANOTÓ UNA PERSONA sobre el lead. La migración 006 lo dice explícito al
 * crear `closer_notas`, y la ficha las muestra en pestañas separadas (§7).
 *
 * Consecuencia deliberada: crear una nota **no** escribe un evento en el historial. El tipo
 * `nota_agregada` existe en el catálogo para cuando Avanzar quiera dejar la marca de que ese
 * registro vino con nota — pero duplicar cada nota suelta como fila del timeline solo llenaría
 * el historial de ruido y mostraría el mismo texto dos veces en la misma ficha.
 *
 * ── Las notas viajan crudas ──
 *
 * `{ texto, autor, creadoEl }` en ISO, nunca "8 jul · Jorge Q. · ...". La presentación es del
 * tool (`CONTRATO-GHL.md` §0): el servidor no puede saber si la ficha va a mostrar la fecha
 * relativa, completa, o ninguna.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { acotarLimite, crearNota, eliminarNota, leerNotas } from "../_lib/repo.js";
import { exigir } from "../_lib/auth.js";

/** Cuántas notas devuelve una lectura sin `?limite=`. Un contacto rara vez pasa de unas pocas. */
const NOTAS_POR_DEFECTO = 100;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer", "setter"]);
  if (!ctx) return;

  if (req.method === "GET") return listar(req, res);
  if (req.method === "POST") return crear(req, res);
  if (req.method === "DELETE") return eliminar(req, res);

  res.setHeader("Allow", "GET, POST, DELETE");
  return res.status(405).json({ ok: false, error: "Solo GET, POST y DELETE." });
}

/* ── GET ─────────────────────────────────────────────────────────────── */

async function listar(req: VercelRequest, res: VercelResponse) {
  const ghlContactId = contactoDeLaQuery(req);
  if (!ghlContactId) return malo(res, "Falta ghlContactId.", "contacto_faltante");

  try {
    const notas = await leerNotas(ghlContactId, acotarLimite(unParametro(req.query.limite), NOTAS_POR_DEFECTO));

    return res.status(200).json({
      ok: true,
      ghlContactId,
      // Se manda el número igual aunque sea cero: la regla §4.1 —un contador en cero no se
      // renderiza— es de la vista, no del servidor.
      count: notas.length,
      notas,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/* ── POST ────────────────────────────────────────────────────────────── */

async function crear(req: VercelRequest, res: VercelResponse) {
  const cuerpo = typeof req.body === "string" ? safeJson(req.body) : req.body;
  if (!cuerpo || typeof cuerpo !== "object") return malo(res, "Cuerpo JSON inválido.", "cuerpo_invalido");

  const { ghlContactId, texto, autor, contexto } = cuerpo as Record<string, unknown>;

  if (typeof ghlContactId !== "string" || !ghlContactId.trim()) {
    return malo(res, "Falta ghlContactId.", "contacto_faltante");
  }

  /**
   * Una nota sin texto no es una nota. La base ya lo impide (`check (btrim(texto) <> '')`),
   * pero dejarlo llegar hasta ahí devolvería un error de Postgres en crudo en vez de decir qué
   * falta. Se valida sobre el texto recortado, igual que el CHECK.
   */
  if (typeof texto !== "string" || !texto.trim()) {
    return malo(res, "La nota no puede estar vacía.", "texto_vacio");
  }

  // Estrictos con los opcionales: un `autor: 123` que se ignorara en silencio guardaría la
  // nota firmada por el closer por defecto y nadie se enteraría hasta leerla en la ficha.
  if (autor !== undefined && typeof autor !== "string") return malo(res, "El autor debe ser texto.", "autor_invalido");
  if (contexto !== undefined && typeof contexto !== "string") {
    return malo(res, "El contexto debe ser texto.", "contexto_invalido");
  }

  try {
    const nota = await crearNota({
      ghlContactId: ghlContactId.trim(),
      texto,
      autor,
      contexto,
    });

    // 201 con la fila ya escrita: el front la agrega a la lista sin volver a pedir el GET, y
    // con el `id` y el `creadoEl` REALES de la base, no con los que inventaría el browser.
    return res.status(201).json({ ok: true, nota });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/* ── DELETE ──────────────────────────────────────────────────────────── */

async function eliminar(req: VercelRequest, res: VercelResponse) {
  const id = unParametro(req.query.id)?.trim();
  if (!id) return malo(res, "Falta id.", "id_faltante");

  try {
    const borrada = await eliminarNota(id);
    // 404 honesto: si el id no existe (ya borrada en otra pestaña, o un id inventado), quien
    // llama tiene que enterarse — un 200 dejaría al front creyendo que borró algo real.
    if (!borrada) return res.status(404).json({ ok: false, codigo: "nota_inexistente", error: "No existe una nota con ese id." });
    return res.status(200).json({ ok: true, id });
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e as Error).message });
  }
}

/* ── Utilidades ──────────────────────────────────────────────────────── */

/**
 * `?ghlContactId=` es el nombre canónico. Se acepta `contactId` porque es el que ya usa
 * `/api/closer/conversacion`, y hacer que el mismo dato se llame distinto según el endpoint es
 * una trampa gratuita para quien cablea el front.
 */
function contactoDeLaQuery(req: VercelRequest): string | undefined {
  const v = unParametro(req.query.ghlContactId) ?? unParametro(req.query.contactId);
  return v?.trim() || undefined;
}

/** Un querystring repetido (`?limite=1&limite=2`) llega como array; se toma el primero. */
function unParametro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

const malo = (res: VercelResponse, error: string, codigo: string) => res.status(400).json({ ok: false, codigo, error });

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
