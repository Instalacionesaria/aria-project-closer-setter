/**
 * `GET /api/closer/llamadas?ghlContactId=…` — el tab Llamada de la ficha.
 *
 * La pestaña existe desde julio y hasta hoy nunca recibió una fila: renderizaba
 * `CallRecord[]` y el array siempre llegaba vacío porque no había de dónde sacarlo. La fuente
 * apareció el 2026-08-06 con el webhook de Assistable (016).
 *
 * ── Solo lectura ──
 *
 * No hay POST por el mismo motivo que en `historial.ts`: una llamada la registra el agente que
 * la hizo, no una persona escribiendo en un formulario. Un endpoint para agregar llamadas a
 * mano permitiría un historial de llamadas que no corresponde a ninguna llamada.
 *
 * ── Las sales calls todavía no viven acá ──
 *
 * `CallOrigin` tiene cuatro valores y este endpoint solo puede devolver tres: las
 * `sales_call` son las reuniones del closer, que nadie graba ni transcribe hoy. Cuando exista
 * esa fuente se suma acá y la vista no cambia — por eso la respuesta es una lista de
 * `CallRecord` y no "las llamadas de Assistable".
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { db } from "../_lib/repo.js";
import { aCallRecord, type FilaLlamada } from "../../src/lib/assistable.js";
import { exigir } from "../_lib/auth.js";

/**
 * Un contacto acumula intentos sin que nadie haga nada —el agente reintenta solo— así que el
 * techo es generoso. Es por contacto, no global: nunca es una consulta grande.
 */
const MAXIMO = 200;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // §3.2 · el portero. Sin esto el endpoint es un agujero por empresa.
  const ctx = await exigir(req, res, ["closer", "setter", "tecnico"]);
  if (!ctx) return;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      ok: false,
      codigo: "solo_lectura",
      error: "Solo GET: las llamadas las registra el agente que las hizo, no el usuario.",
    });
  }

  const ghlContactId = unParametro(req.query.ghlContactId) ?? unParametro(req.query.contactId);
  if (!ghlContactId?.trim()) {
    return res.status(400).json({ ok: false, codigo: "contacto_faltante", error: "Falta ghlContactId." });
  }

  const { data, error } = await db()
    .from("closer_llamadas")
    .select("*")
    .eq("ghl_contact_id", ghlContactId.trim())
    .order("recibido_el", { ascending: false })
    .limit(MAXIMO);

  if (error) {
    // Se dice que falló. Un `[]` acá significaría "no tiene llamadas", que es otro hecho
    // (regla 2): la ficha pintaría el estado vacío sobre un contacto que sí tiene.
    return res.status(500).json({ ok: false, error: error.message });
  }

  const filas = (data ?? []) as unknown as FilaLlamada[];

  /**
   * Se ordena en memoria y no en SQL porque el criterio real es `inicio_el` y esa columna es
   * **nullable**: una llamada rechazada antes de conectar no tiene inicio. El índice y el
   * ORDER BY van por `recibido_el`, que siempre existe, y acá se prefiere `inicio_el` cuando
   * está. La lista es de un solo contacto, así que ordenar en JS no cuesta nada.
   *
   * Importa que quede bien: `callsIASummary` toma el primero de la lista como "último
   * resultado", y el tab Perfil lo muestra como tal.
   */
  const ordenadas = filas
    .slice()
    .sort((a, b) => cuando(b).localeCompare(cuando(a)))
    .map(aCallRecord);

  return res.status(200).json({
    ok: true,
    ghlContactId: ghlContactId.trim(),
    // El cero viaja igual; ocultarlo es decisión de la vista (§4.1).
    count: ordenadas.length,
    llamadas: ordenadas,
  });
}

function cuando(f: FilaLlamada): string {
  return f.inicio_el ?? (f as unknown as { recibido_el?: string }).recibido_el ?? "";
}

/** Un querystring repetido (`?a=1&a=2`) llega como array; se toma el primero. */
function unParametro(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}
