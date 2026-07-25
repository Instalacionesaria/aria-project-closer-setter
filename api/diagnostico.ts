/**
 * `GET /api/diagnostico` — ¿está todo conectado de verdad?
 *
 * Existe para responder en producción la pregunta que un deploy exitoso NO responde: que
 * la página cargue no prueba que haya base de datos ni que GHL conteste. Este endpoint
 * verifica cada eslabón por separado y dice cuál falla.
 *
 * Comprueba, además de la conectividad, que los literales que el código va a usar EXISTAN
 * en la cuenta de GHL. Un tag mal escrito no da error: simplemente no dispara ningún
 * workflow, y nadie se entera hasta que alguien nota que los seguimientos no salen.
 *
 * No devuelve ninguna credencial, solo si está presente o no.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { env } from "./_lib/env.js";
import { ghl } from "./_lib/ghl/index.js";
import { hoyOrg, verificarEsquema } from "./_lib/repo.js";
import { CAMPOS, SITUACIONES, TAGS, literalesPendientes } from "../src/lib/ghl/contrato.js";

/** Los literales que este módulo necesita que existan en la cuenta. */
const TAGS_REQUERIDOS = [
  TAGS.seguimiento.valor,
  TAGS.seguimientoRecupero.valor,
  TAGS.seguimientoManual.valor,
  TAGS.zonaCloser.valor,
] as const;

const CAMPOS_REQUERIDOS = [CAMPOS.nivelInteresSeguimiento.valor] as const;

/** GHL a veces devuelve la key con y a veces sin el prefijo `contact.`. */
const mismaClave = (a: string, b: string) =>
  a.replace(/^contact\./, "").toLowerCase() === b.replace(/^contact\./, "").toLowerCase();

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const reporte: Record<string, unknown> = {
    generadoEl: new Date().toISOString(),
    entorno: {
      supabase: env.tieneCredencialesSupabase() ? "configurado" : "FALTA",
      ghlCredenciales: env.tieneCredencialesGhl() ? "configurado" : "FALTA",
      ghlModo: env.ghlModo(),
      adapterActivo: ghl().modo,
    },
  };

  /* ── Supabase ── */
  try {
    const tablas = await verificarEsquema();
    const faltan = tablas.filter((t) => !t.ok);
    reporte.supabase = {
      ok: faltan.length === 0,
      hoyOrg: await hoyOrg(),
      tablas,
      ...(faltan.length ? { problema: `${faltan.length} tabla(s) inaccesible(s)` } : {}),
    };
  } catch (e) {
    reporte.supabase = { ok: false, error: (e as Error).message };
  }

  /* ── GHL ── */
  try {
    const conexion = await ghl().verificarConexion();

    if (!conexion.ok) {
      reporte.ghl = {
        ok: false,
        error: conexion.error,
        ...("status" in conexion ? { status: conexion.status } : {}),
        pista:
          ghl().modo === "stub"
            ? "El adapter está en stub. Para llamar a GHL hacen falta GHL_MODO=real, GHL_API_KEY y GHL_LOCATION_ID."
            : "Revisar que el Private Integration Token sea válido y tenga los scopes de contacts y locations.",
      };
    } else {
      const tagsFaltantes = TAGS_REQUERIDOS.filter(
        (t) => !conexion.tags.some((existente) => existente.toLowerCase() === t.toLowerCase()),
      );
      const camposFaltantes = CAMPOS_REQUERIDOS.filter(
        (c) => !conexion.customFields.some((existente) => mismaClave(existente, c)),
      );

      reporte.ghl = {
        ok: tagsFaltantes.length === 0 && camposFaltantes.length === 0,
        // Solo los últimos 4: alcanza para confirmar que es la subcuenta correcta, y este
        // endpoint no tiene autenticación — cualquiera con la URL lo puede leer.
        locationId: `…${conexion.locationId.slice(-4)}`,
        tagsEnLaCuenta: conexion.tags.length,
        camposEnLaCuenta: conexion.customFields.length,
        tagsRequeridos: TAGS_REQUERIDOS.map((t) => ({
          tag: t,
          existe: !tagsFaltantes.includes(t as (typeof TAGS_REQUERIDOS)[number]),
        })),
        camposRequeridos: CAMPOS_REQUERIDOS.map((c) => ({
          campo: c,
          existe: !camposFaltantes.includes(c as (typeof CAMPOS_REQUERIDOS)[number]),
        })),
        ...(tagsFaltantes.length ? { tagsFaltantes } : {}),
        ...(camposFaltantes.length ? { camposFaltantes } : {}),
      };
    }
  } catch (e) {
    reporte.ghl = { ok: false, error: (e as Error).message };
  }

  /* ── Literales sin confirmar ── */
  // `assertEnviable()` los bloquea en modo real, así que si queda alguno pendiente y ya
  // existe en la cuenta, hay que marcarlo como confirmado en `contrato.ts`.
  reporte.literalesPendientes = literalesPendientes().map((l) => ({ valor: l.valor, fuente: l.fuente }));
  reporte.situaciones = SITUACIONES.map((s) => ({ slug: s.slug, label: s.label, confianza: s.confianza }));

  const todoOk =
    (reporte.supabase as { ok?: boolean })?.ok === true && (reporte.ghl as { ok?: boolean })?.ok === true;

  res.status(todoOk ? 200 : 503).json({ ok: todoOk, ...reporte });
}
