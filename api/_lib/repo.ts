/**
 * Acceso a las tablas `closer_*` de SOFIA.
 *
 * Usa la `service_role`, que salta el RLS. Es correcto porque estas tablas no tienen
 * políticas: el único camino de entrada es este archivo, desde funciones de servidor.
 * El browser nunca las toca.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let cliente: SupabaseClient | null = null;

export function db(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(env.supabaseUrl(), env.supabaseServiceKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cliente;
}

/* ================================================================== */
/* Outbox                                                              */
/* ================================================================== */

export interface EntradaOutbox {
  ghlContactId: string;
  seguimientoId?: string;
  operacion: "aplicar_tag" | "remover_tag" | "escribir_campo" | "mover_stage";
  args: Record<string, unknown>;
  idempotencyKey: string;
  estado: "pendiente" | "enviado" | "error" | "omitido_stub";
  orgId?: string;
}

/** Org única mientras no haya multi-tenant. Vive acá para tener un solo lugar que cambiar. */
export const ORG_ID = "00000000-0000-0000-0000-000000000001";

/**
 * Registra la intención de un efecto en GHL.
 *
 * Un choque de `idempotency_key` NO es un error: significa que este efecto ya se anotó,
 * que es justamente lo que la clave existe para garantizar. Se traga y se sigue.
 */
export async function registrarEnOutbox(e: EntradaOutbox): Promise<void> {
  const { error } = await db()
    .from("closer_ghl_outbox")
    .insert({
      org_id: e.orgId ?? ORG_ID,
      ghl_contact_id: e.ghlContactId,
      seguimiento_id: e.seguimientoId ?? null,
      operacion: e.operacion,
      args: e.args,
      idempotency_key: e.idempotencyKey,
      estado: e.estado,
    });

  if (error && error.code !== "23505") throw new Error(`outbox: ${error.message}`);
}

/* ================================================================== */
/* Diagnóstico                                                         */
/* ================================================================== */

const TABLAS = [
  "closer_org_config",
  "closer_usuarios",
  "closer_seguimientos",
  "closer_contacto_tarea",
  "closer_contacto_eventos",
  "closer_ghl_outbox",
  "closer_webhook_inbox",
] as const;

export interface EstadoTabla {
  tabla: string;
  ok: boolean;
  filas?: number;
  error?: string;
}

/** ¿Existen las tablas y se pueden leer con esta credencial? */
export async function verificarEsquema(): Promise<EstadoTabla[]> {
  return Promise.all(
    TABLAS.map(async (tabla): Promise<EstadoTabla> => {
      const { count, error } = await db().from(tabla).select("*", { count: "exact", head: true });
      return error ? { tabla, ok: false, error: error.message } : { tabla, ok: true, filas: count ?? 0 };
    }),
  );
}

/** El "hoy" de la organización, calculado por Postgres — nunca por Node ni por el browser. */
export async function hoyOrg(): Promise<string | null> {
  const { data, error } = await db().rpc("closer_hoy_org");
  return error ? null : (data as string);
}
