-- ============================================================================
-- Comando Central — esquema `closer` en Supabase SOFIA
-- Migración 001 · Seguimientos del closer
--
-- NO EJECUTADA TODAVÍA. Falta la conexión a SOFIA (ver el plan, "Lo que necesito
-- de ti"). Se aplica con `supabase db push` o pegándola en el SQL editor.
--
-- ── Por qué existe esta base, si el contrato dice que el tool no guarda datos ──
--
-- `CONTRATO-GHL.md` §0: "El tool NO es una base de datos. No almacena datos propios."
-- Lo respetamos casi entero. GHL sigue siendo la fuente de verdad del NEGOCIO: la
-- situación del seguimiento es el custom field `nivel_de_inters_seguimiento`, el modo
-- es un tag (`seguimiento_recupero` / `seguimiento_manual`), y el stage lo mueve un
-- workflow. Nada de eso se duplica acá.
--
-- Lo que sí vive acá es el estado OPERATIVO del tool, que GHL no puede sostener:
--
--   1. La fecha objetivo del seguimiento manual. GHL solo necesita saber que el
--      contacto está en manual para no dispararle la serie automática; el día en que
--      reaparece en la cola es lógica de cola de trabajo. No tiene campo ni workflow
--      en el contrato, y crear uno sería pedirle a GHL que guarde algo que solo el
--      tool consume.
--   2. Fijar y completado del día — estado de la cola, no del contacto.
--   3. Outbox e inbox, para que un fallo de red no pierda una intención.
--
-- Desviación consciente, decidida el 2026-07-25. Documentada en CLAUDE.md.
-- ============================================================================

create schema if not exists closer;
set search_path = closer, public;

-- ── Zona horaria ────────────────────────────────────────────────────────────
-- Todo cálculo de "hoy", "mañana" y "vencido" pasa por acá. Nunca `current_date`
-- ni `now()::date` sueltos: Supabase corre la sesión en UTC, así que a las 20:00 de
-- Lima darían el día siguiente. Es el mismo bug que tenía `isoInDays` en el front,
-- pero del otro lado del cable.

create table if not exists org_config (
  org_id       uuid primary key,
  zona_horaria text not null default 'America/Lima',

  -- Canales donde NO se ofrece seguimiento automático. Arranca con Instagram, que no
  -- tiene bot ni workflow (§11). Vaciar este array re-habilita el grupo automático en
  -- la UI SIN deploy — que es exactamente el requisito.
  canales_sin_seguimiento_automatico text[] not null default array['instagram'],

  actualizado_el timestamptz not null default now()
);

create or replace function closer.hoy_org() returns date
  language sql stable as $$
    select (now() at time zone coalesce(
      (select zona_horaria from closer.org_config limit 1),
      'America/Lima'
    ))::date
  $$;

comment on function closer.hoy_org() is
  'El día civil de la organización. Único origen de "hoy" en todo el esquema.';

-- ── Tipos ───────────────────────────────────────────────────────────────────

do $$ begin
  create type situacion_seguimiento as enum
    ('proximo_a_pagar','muy_interesado','dudando','enfriandose','otro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type modo_seguimiento as enum ('automatico','manual');
exception when duplicate_object then null; end $$;

-- OJO con 'agotado': NO es terminal. Es "la serie terminó sin respuesta, mirálo vos"
-- (§16.1.D) — una tarea viva. Los estados realmente cerrados son los otros tres.
do $$ begin
  create type estado_seguimiento as enum
    ('pendiente','agotado','completado','cancelado','reemplazado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type motivo_cierre as enum
    ('avanzar','respondio','reemplazado','completado_por_humano','cancelado_manual');
exception when duplicate_object then null; end $$;

do $$ begin
  create type autor_tipo as enum ('sistema','usuario','contacto');
exception when duplicate_object then null; end $$;

-- ── Usuarios ────────────────────────────────────────────────────────────────
-- Reemplaza el `CURRENT_CLOSER_NAME = "Diego M."` hardcodeado en closerStore.tsx.

create table if not exists usuarios (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  ghl_user_id text unique,
  nombre      text not null,
  rol         text not null check (rol in ('closer','setter','tecnico','admin')),
  activo      boolean not null default true,
  creado_el   timestamptz not null default now()
);

-- ── Seguimientos ────────────────────────────────────────────────────────────

create table if not exists seguimientos (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,

  -- Identidad real del contacto. NO el nombre: hoy el front usa "RODRIGO SILVA" como
  -- clave primaria de todo, y la semilla ya tiene cinco apellidos GOMEZ. Dos homónimos
  -- se pisarían en silencio y renombrar en GHL perdería el estado.
  ghl_contact_id text not null,
  closer_id      uuid not null references usuarios(id),

  -- Espejo del custom field de GHL, para poder consultar la cola sin salir a la API en
  -- cada request (§2 prohíbe consultar servicios externos al renderizar). GHL manda: si
  -- los dos difieren, se re-sincroniza desde GHL.
  situacion situacion_seguimiento not null,
  modo      modo_seguimiento      not null,

  -- El día en que un HUMANO lo mira. NO es la fecha del próximo toque.
  --   manual     → la fecha pactada.
  --   automatico → fin proyectado de la serie + gracia. Doble función: mantiene una
  --                sola regla de cola para ambos modos, y es el fail-safe si los
  --                webhooks de GHL nunca llegan — el contacto aflora igual en vez de
  --                caerse del sistema en silencio.
  fecha_objetivo date not null,

  -- Snapshot de la serie al crearla: cambiar el catálogo el mes que viene no debe
  -- reescribir lo que se prometió hoy.
  serie_key    text,
  serie_toques smallint,
  serie_dias   smallint,

  nota text,

  estado        estado_seguimiento not null default 'pendiente',
  motivo_cierre motivo_cierre,
  cerrado_el    timestamptz,
  cerrado_por   uuid references usuarios(id),
  reemplazado_por uuid references seguimientos(id),

  creado_el  timestamptz not null default now(),
  creado_por uuid not null references usuarios(id),

  constraint serie_solo_en_automatico check (
    (modo = 'manual'     and serie_key is null and serie_toques is null and serie_dias is null) or
    (modo = 'automatico' and serie_key is not null and serie_toques > 0 and serie_dias > 0)
  ),

  constraint cierre_coherente check (
    (estado in ('pendiente','agotado')                  and cerrado_el is null and motivo_cierre is null) or
    (estado in ('completado','cancelado','reemplazado') and cerrado_el is not null and motivo_cierre is not null)
  ),

  constraint reemplazo_coherente check (
    (estado = 'reemplazado') = (reemplazado_por is not null)
  )
);

-- "Un solo seguimiento abierto por contacto", como invariante de la base y no como
-- lógica de aplicación. Convierte el doble submit y las dos pestañas abiertas en una
-- violación de constraint reintentable, en vez de dos filas y dos tags en GHL.
-- 'agotado' cuenta como abierto: sigue siendo una tarea viva.
create unique index if not exists seguimiento_abierto_unico
  on seguimientos (ghl_contact_id)
  where estado in ('pendiente','agotado');

-- La query de "Seguimientos de hoy", servida por un solo índice.
create index if not exists seguimientos_cola_idx
  on seguimientos (closer_id, fecha_objetivo)
  where estado in ('pendiente','agotado');

create index if not exists seguimientos_contacto_idx
  on seguimientos (ghl_contact_id, creado_el desc);

comment on column seguimientos.fecha_objetivo is
  'Día (zona de la org) en que la tarea aparece en "Seguimientos de hoy". NO es la fecha del próximo toque.';

-- ── Estado de la cola de trabajo ────────────────────────────────────────────
-- Separado de los seguimientos porque es del CONTACTO, no del seguimiento: un contacto
-- puede tener a la vez un mensaje sin responder y un seguimiento que vence hoy, y
-- atender uno no completa el otro.

create table if not exists contacto_tarea (
  ghl_contact_id text primary key,
  org_id         uuid not null,
  fijada         boolean not null default false,

  -- Día materializado a propósito: `(ts at time zone '...')::date` es STABLE, no
  -- IMMUTABLE, así que no se puede indexar ni usar en una columna generada.
  completada_dia date,
  completada_el  timestamptz,
  completada_por uuid references usuarios(id),

  actualizado_el timestamptz not null default now()
);

create index if not exists contacto_tarea_completadas_idx
  on contacto_tarea (org_id, completada_dia) where completada_dia is not null;

-- ── Timeline inmutable ──────────────────────────────────────────────────────
-- Alcance CONTACTO, con `seguimiento_id` nullable: el tab Historial es por contacto y
-- sobrevive a cualquier seguimiento puntual. Scoparlo al seguimiento obligaría a
-- fusionar dos timelines con dos ordenamientos en cuanto llegue la próxima feature.

create table if not exists contacto_eventos (
  id             bigint generated always as identity primary key,
  org_id         uuid not null,
  ghl_contact_id text not null,
  seguimiento_id uuid references seguimientos(id) on delete set null,

  tipo text not null,

  -- Texto YA resuelto. El front no compone strings de historial a partir de un payload.
  texto text not null,

  autor_tipo       autor_tipo not null,
  autor_nombre     text not null,
  autor_usuario_id uuid references usuarios(id),

  payload jsonb not null default '{}'::jsonb,

  -- Idempotencia de webhooks: GHL reintenta, y el mismo evento no puede entrar dos veces.
  fuente_externa_id text,

  ocurrio_el timestamptz not null default now(),
  creado_el  timestamptz not null default now(),

  constraint autor_usuario_consistente check (
    (autor_tipo = 'usuario') = (autor_usuario_id is not null)
  ),

  -- §2 como constraint, no como buena intención: los eventos automáticos se registran
  -- con autor `Sistema` y jamás pasan por Avanzar.
  constraint sistema_se_llama_sistema check (
    autor_tipo <> 'sistema' or autor_nombre = 'Sistema'
  )
);

create unique index if not exists contacto_eventos_externo_unico
  on contacto_eventos (fuente_externa_id) where fuente_externa_id is not null;

create index if not exists contacto_eventos_timeline_idx
  on contacto_eventos (ghl_contact_id, ocurrio_el desc, id desc);

-- Un toque reenviado por un reintento de GHL no puede contarse dos veces.
create unique index if not exists serie_toque_unico
  on contacto_eventos (seguimiento_id, ((payload->>'toque_n')::int))
  where tipo = 'serie_toque_enviado';

create or replace function closer.evitar_mutacion() returns trigger
  language plpgsql as $$
begin
  raise exception 'contacto_eventos es append-only: el historial es un timeline inmutable (CLAUDE.md §2)';
end $$;

drop trigger if exists contacto_eventos_append_only on contacto_eventos;
create trigger contacto_eventos_append_only
  before update or delete on contacto_eventos
  for each row execute function closer.evitar_mutacion();

-- ── Outbox de GHL ───────────────────────────────────────────────────────────
-- El adapter arranca en modo stub porque falta confirmar `seguimiento_manual`. Un stub
-- que solo loguea PIERDE la intención: el día que lleguen los literales no habría forma
-- de replicar los seguimientos creados mientras tanto. Cada efecto es una fila durable;
-- `omitido_stub` es la cola de replay.

create table if not exists ghl_outbox (
  id             bigint generated always as identity primary key,
  org_id         uuid not null,
  ghl_contact_id text not null,
  seguimiento_id uuid references seguimientos(id) on delete set null,

  operacion text not null check (operacion in
    ('aplicar_tag','remover_tag','escribir_campo','mover_stage')),
  args jsonb not null,

  estado text not null default 'pendiente'
    check (estado in ('pendiente','enviado','error','omitido_stub')),
  intentos     smallint not null default 0,
  ultimo_error text,

  idempotency_key text not null unique,

  creado_el    timestamptz not null default now(),
  procesado_el timestamptz
);

create index if not exists ghl_outbox_pendientes_idx
  on ghl_outbox (creado_el) where estado in ('pendiente','error','omitido_stub');

-- ── Inbox de webhooks ───────────────────────────────────────────────────────
-- El cuerpo crudo antes de interpretarlo. El mapeo va a estar mal las primeras veces;
-- esto es lo que permite corregirlo retroactivamente en vez de perder los eventos.

create table if not exists webhook_inbox (
  id           bigint generated always as identity primary key,
  proveedor    text not null default 'ghl',
  external_id  text,
  payload      jsonb not null,
  recibido_el  timestamptz not null default now(),
  procesado_el timestamptz,
  error        text
);

create unique index if not exists webhook_inbox_externo_unico
  on webhook_inbox (proveedor, external_id) where external_id is not null;

-- ── La cola de "Seguimientos de hoy" ────────────────────────────────────────

create or replace view seguimientos_de_hoy as
  select
    s.*,
    (closer.hoy_org() - s.fecha_objetivo) as dias_vencido,
    coalesce(t.fijada, false)             as fijada
  from closer.seguimientos s
  left join closer.contacto_tarea t on t.ghl_contact_id = s.ghl_contact_id
  where s.estado in ('pendiente','agotado')

    -- La regla de producto del 2026-07-25: una serie automática EN CURSO no genera fila.
    -- "El sistema persigue por ti" (§16.1.B) y "si la IA trabaja, no hay tarea humana"
    -- (§40.E). Solo aflora cuando se agota. Si el contacto responde antes, vuelve por
    -- Buzón general o Intervención urgente, que son otras colas.
    and (s.modo = 'manual' or s.estado = 'agotado')

    and s.fecha_objetivo <= closer.hoy_org()

    -- Pactar un seguimiento SÍ completa la tarea de hoy (el closer hizo su trabajo, va a
    -- Completadas Hoy) Y crea una tarea futura. No están en conflicto; el predicado solo
    -- tiene que decirlo. Sin este `is distinct from`, el contacto aparecería en las dos
    -- secciones el mismo día.
    and t.completada_dia is distinct from closer.hoy_org()

  order by fijada desc, s.fecha_objetivo asc;

comment on view seguimientos_de_hoy is
  'Cola de Closer AI → Mi Día → "Seguimientos de hoy". Solo manuales vencidos/de hoy y series agotadas.';
