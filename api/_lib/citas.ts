/**
 * Citas: sincronización GHL → `closer_citas`, compartida por el cron de respaldo y el
 * refresco on-demand de la Agenda.
 *
 * El webhook de cita (workflow B de Francisco) da la inmediatez; esto da la garantía y,
 * de paso, el ALTA de contactos nuevos: `zona_closer` se aplica después de agendar
 * (decisión de Fabio, 2026-07-31), así que todo contacto nuevo del territorio aparece
 * primero como una cita — y `sincronizarCitas` lo da de alta si el webhook no llegó.
 */

import { hoyISO, sumarDias, ZONA_HORARIA_ORG } from "../../src/lib/fechas.js";
import { env } from "./env.js";
import { eventosDeCalendario, type EventoCalendario } from "./ghl/lectura.js";
import { asegurarContacto } from "./ingesta.js";
import { db } from "./repo.js";
import { sincronizarContacto } from "./contactos.js";

/**
 * Un instante ISO partido en fecha y hora **de la organización**.
 *
 * Vive acá y no en cada endpoint porque el browser no puede decidir esto: un closer
 * conectado fuera de Lima vería la hora de su propia zona sobre una cita que está agendada
 * en la de la agencia. El backend manda las dos piezas ya resueltas y la vista solo pinta.
 */
export function fechaHoraOrg(iso: string): { fecha: string; hora: string } {
  const d = new Date(iso);
  return {
    fecha: new Intl.DateTimeFormat("en-CA", { timeZone: ZONA_HORARIA_ORG }).format(d),
    hora: new Intl.DateTimeFormat("es-PE", {
      timeZone: ZONA_HORARIA_ORG,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d),
  };
}

/** Offset (`-05:00`) de la zona de la organización para una fecha dada. */
export function offsetOrg(iso: string): string {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_HORARIA_ORG,
    timeZoneName: "longOffset",
  }).formatToParts(new Date(`${iso}T12:00:00Z`));
  const nombre = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  return nombre.replace("GMT", "") || "-05:00";
}

/** Rango epoch-ms de `desdeIso` 00:00 a `hastaIso` 23:59, en la zona de la organización. */
export function rangoDelDia(desdeIso: string, hastaIso: string): { desdeMs: number; hastaMs: number } {
  return {
    desdeMs: new Date(`${desdeIso}T00:00:00${offsetOrg(desdeIso)}`).getTime(),
    hastaMs: new Date(`${hastaIso}T23:59:59${offsetOrg(hastaIso)}`).getTime(),
  };
}

export interface ResultadoSyncCitas {
  eventos: number;
  contactosNuevos: number;
  llamadasGhl: number;
}

/**
 * Trae las citas del rango desde GHL (1 llamada) y las upsertea en `closer_citas`.
 * Los contactos desconocidos se dan de alta (1 llamada extra por cada uno — solo la
 * primera vez que se lo ve; después ya está en la caché).
 */
export async function sincronizarCitas(desdeIso: string, hastaIso: string): Promise<ResultadoSyncCitas> {
  const calendarId = env.ghlCalendarioPorDefecto();
  if (!calendarId || !env.tieneCredencialesGhl()) return { eventos: 0, contactosNuevos: 0, llamadasGhl: 0 };

  const { desdeMs, hastaMs } = rangoDelDia(desdeIso, hastaIso);
  const eventos = await eventosDeCalendario({ calendarId, desdeMs, hastaMs });
  let llamadasGhl = 1;
  let contactosNuevos = 0;

  for (const e of eventos) {
    if (!e.id || !e.startTime) continue;

    if (e.contactId) {
      const { data } = await db()
        .from("closer_contactos")
        .select("ghl_contact_id")
        .eq("ghl_contact_id", e.contactId)
        .maybeSingle();
      if (!data) {
        // El alta por cita: la vía principal de descubrimiento de contactos nuevos.
        const creado = await asegurarContacto(e.contactId);
        llamadasGhl++;
        if (creado) contactosNuevos++;
      }
    }

    const { error } = await db()
      .from("closer_citas")
      .upsert(
        {
          ghl_appointment_id: e.id,
          ghl_contact_id: e.contactId ?? "",
          fecha_hora: e.startTime,
          estado_ghl: e.appointmentStatus ?? null,
          titulo: e.title ?? null,
          meet_url: e.address ?? null,
          actualizado_el: new Date().toISOString(),
        },
        { onConflict: "ghl_appointment_id" },
      );
    if (error) throw new Error(`closer_citas: ${error.message}`);
  }

  return { eventos: eventos.length, contactosNuevos, llamadasGhl };
}

/**
 * El "30 minutos antes" de §5.3: refresca tags y custom fields de los contactos con cita
 * en la próxima ventana (ahí llega si vio el video precall y lo que recabó el chatbot).
 *
 * Corre dentro del cron de :25/:55, que por diseño cae ~5 min antes de cada bloque de
 * citas (en punto / y media) — la aproximación serverless del "30 min antes" exacto.
 * `refrescado_contacto_el` evita refrescar dos veces la misma cita si las dos corridas de
 * la hora la ven en ventana.
 */
export async function refrescarContactosProximos(ventanaMinutos = 40): Promise<number> {
  const ahora = new Date();
  const hasta = new Date(ahora.getTime() + ventanaMinutos * 60_000);

  const { data: citas, error } = await db()
    .from("closer_citas")
    .select("ghl_appointment_id, ghl_contact_id, refrescado_contacto_el")
    .gte("fecha_hora", ahora.toISOString())
    .lte("fecha_hora", hasta.toISOString())
    .neq("estado_ghl", "cancelled");
  if (error) throw new Error(`closer_citas: ${error.message}`);

  let refrescados = 0;
  for (const c of citas ?? []) {
    if (!c.ghl_contact_id) continue;
    if (c.refrescado_contacto_el) continue; // ya se refrescó por esta cita

    const ok = await sincronizarContacto(c.ghl_contact_id).catch(() => false);
    await db()
      .from("closer_citas")
      .update({ refrescado_contacto_el: new Date().toISOString() })
      .eq("ghl_appointment_id", c.ghl_appointment_id);
    if (ok) refrescados++;
  }
  return refrescados;
}

/** Rango por defecto del respaldo: hoy y mañana (la ventana que Mi Día y la Agenda miran primero). */
export function rangoRespaldo(): { desde: string; hasta: string } {
  const hoy = hoyISO();
  return { desde: hoy, hasta: sumarDias(hoy, 1) };
}
