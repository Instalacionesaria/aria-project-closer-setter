-- 011 — Conexiones y fin del polling masivo (2026-07-31)
--
-- Soporte de datos para la arquitectura de CONTEXTO-CLOSER-Conexiones-Polling.md:
-- los mensajes de WhatsApp y las citas se INGIEREN (webhook + reconciliación) y se
-- cachean acá; el frontend deja de pedirle nada a GHL. Supabase pasa a ser la fuente
-- de verdad del stage del pipeline y del dinero (closer_avances).
--
-- Mismas reglas que 001-010: todo en `public` con prefijo closer_ (SOFIA es compartida),
-- RLS activado y CERO políticas — solo service_role entra, y solo desde api/.

begin;

/* ================================================================== */
/* closer_mensajes — caché de conversaciones WhatsApp                  */
/* ================================================================== */

-- El id es el messageId de GHL: la deduplicación webhook-vs-reconciliación ES esta
-- primary key. Los dos caminos hacen upsert del mismo id y el segundo no duplica.
-- Cuando el payload del workflow no trae messageId, el webhook fabrica uno determinístico
-- ('wh:' || conversation_id || ':' || timestamp || ':' || hash del body) — mismo criterio.
create table if not exists public.closer_mensajes (
  id               text primary key,
  ghl_contact_id   text not null,
  conversation_id  text,
  direccion        text not null check (direccion in ('inbound', 'outbound')),
  body             text not null default '',
  -- Momento del mensaje según GHL (no cuándo lo ingerimos): es lo que ordena el chat.
  timestamp_ghl    timestamptz not null,
  created_at       timestamptz not null default now()
);

-- El chat de la ficha pide "mensajes de este contacto, más nuevos primero".
create index if not exists closer_mensajes_contacto_idx
  on public.closer_mensajes (ghl_contact_id, timestamp_ghl desc);

alter table public.closer_mensajes enable row level security;

/* ================================================================== */
/* closer_citas — caché del calendar                                   */
/* ================================================================== */

create table if not exists public.closer_citas (
  ghl_appointment_id      text primary key,
  ghl_contact_id          text not null,
  fecha_hora              timestamptz not null,
  -- Estado tal cual lo reporta GHL (confirmed/cancelled/showed/noshow/...): se guarda
  -- crudo y la vista decide qué significa. Normalizarlo acá sería inventar un enum
  -- sobre valores que GHL puede ampliar sin avisar.
  estado_ghl              text,
  titulo                  text,
  meet_url                text,
  -- Marca del job de citas: una cita pasada sin Avanzar baja con "vencido hace X",
  -- jamás desaparece. Este flag existe para procesos futuros, no borra nada.
  vencida_procesada       boolean not null default false,
  -- Cuándo se refrescó el CONTACTO por esta cita (el "30 min antes" de §5.3) — evita
  -- refrescarlo dos veces si el cron corre a :25 y a :55 con la misma cita en ventana.
  refrescado_contacto_el  timestamptz,
  actualizado_el          timestamptz not null default now()
);

-- "Citas de hoy" y "Agenda por día" filtran por rango de fecha_hora.
create index if not exists closer_citas_fecha_idx
  on public.closer_citas (fecha_hora);

create index if not exists closer_citas_contacto_idx
  on public.closer_citas (ghl_contact_id);

alter table public.closer_citas enable row level security;

/* ================================================================== */
/* closer_avances — timeline inmutable de CADA uso de Avanzar          */
/* ================================================================== */

-- Fuente de verdad del dinero: cash collected y ventas del mes se CALCULAN por query
-- sobre esta tabla (nunca contadores sueltos). El Opportunity Value se manda a GHL al
-- registrar la venta pero jamás se lee de vuelta.
create table if not exists public.closer_avances (
  id                bigint generated always as identity primary key,
  ghl_contact_id    text not null,
  salida            text not null check (salida in
                      ('venta', 'acordo', 'seguimiento', 'no_show', 'no_interesa', 'nurture')),
  -- monto, tipo_pago, situacion, fecha_seguimiento, nota... — lo que el formulario de esa
  -- salida haya pedido. jsonb porque cada salida tiene campos distintos y el dashboard
  -- solo agrega sobre claves conocidas (detalle->>'monto').
  detalle           jsonb not null default '{}'::jsonb,
  tags_enviados     text[] not null default '{}',
  created_at        timestamptz not null default now()
);

create index if not exists closer_avances_mes_idx
  on public.closer_avances (created_at desc);

create index if not exists closer_avances_contacto_idx
  on public.closer_avances (ghl_contact_id, created_at desc);

-- Append-only: la historia de decisiones no se reescribe. Igual que
-- closer_contacto_eventos desde 004, el DELETE queda permitido (acción administrativa
-- legítima: datos de prueba, pedidos de supresión) — solo el UPDATE está bloqueado.
drop trigger if exists closer_avances_inmutable on public.closer_avances;
create trigger closer_avances_inmutable
  before update on public.closer_avances
  for each row execute function public.closer_evitar_mutacion();

alter table public.closer_avances enable row level security;

/* ================================================================== */
/* closer_contactos — columnas nuevas                                  */
/* ================================================================== */

-- congelado: perdió zona_closer. Sigue visible y movible por el pipeline, pero no se
-- gasta NI UNA llamada de GHL en él (no refrescar, no mensajes, no tags).
alter table public.closer_contactos
  add column if not exists congelado boolean not null default false;

-- buzon_resuelto_el: "Marcar como resuelto" del Buzón General. El Buzón se DERIVA:
-- bot apagado + último entrante posterior a esta marca. No hay flag de membresía.
alter table public.closer_contactos
  add column if not exists buzon_resuelto_el timestamptz;

-- last_message_ghl_at: el lastMessageDate que reportó /conversations/search la última
-- vez. Es el comparador barato de la reconciliación — si no cambió, no se piden mensajes.
alter table public.closer_contactos
  add column if not exists last_message_ghl_at timestamptz;

/* ================================================================== */
/* closer_org_config — el candado de la reconciliación                 */
/* ================================================================== */

-- El "reloj de 10s" no existe como proceso en Vercel: lo dispara el frontend y ESTA
-- columna garantiza que corra a lo sumo una vez cada 10s aunque haya N pestañas.
-- El claim es un UPDATE atómico:
--   update closer_org_config set ultima_reconciliacion = now()
--    where org_id = $1 and (ultima_reconciliacion is null
--          or ultima_reconciliacion < now() - interval '10 seconds')
--   returning org_id;
-- Cero filas devueltas = otro ya corrió hace <10s → responder sin llamar a GHL.
alter table public.closer_org_config
  add column if not exists ultima_reconciliacion timestamptz;

-- Marca de agua de la reconciliación: lastMessageDate más nuevo ya procesado. El barrido
-- lee /conversations/search ordenado desc y camina SOLO hasta cruzar esta marca — así el
-- costo por ciclo depende de los mensajes nuevos, no de las 15.000 conversaciones de la
-- cuenta (verificado 2026-07-31: el parámetro tags= del search se ignora, no filtra).
alter table public.closer_org_config
  add column if not exists reconciliacion_marca_agua timestamptz;

commit;
