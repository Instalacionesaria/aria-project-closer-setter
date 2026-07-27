-- ============================================================================
-- Migración 006 · Proyección de contactos, notas y catálogo de eventos
--
-- ── Por qué aparece una tabla de contactos si GHL es la fuente de verdad ──
--
-- Hasta ahora el módulo solo mostraba contactos que YA tenían un seguimiento, así que
-- alcanzaba con pedirle cada uno a GHL en el momento. Para las secciones nuevas —Agenda de
-- Hoy, Buzón general, Respondieron— hace falta LISTAR y FILTRAR contactos, y eso no se
-- puede hacer preguntándole a GHL en cada carga de pantalla: `CLAUDE.md` §2 lo prohíbe
-- ("nunca consulta servicios externos en vivo") y además chocaría con su límite de
-- peticiones.
--
-- Esta tabla es un CACHÉ, no una segunda fuente de verdad. Reglas:
--   · Todo lo que hay acá viene de GHL y GHL siempre gana.
--   · Es truncatable: borrarla entera y re-sincronizar no pierde nada propio.
--   · Lo que NO viene de GHL (fijar, completado del día, fecha del seguimiento manual)
--     vive en sus tablas aparte, para que re-sincronizar el caché no lo borre.
--
-- ── Qué decide en qué sección aparece cada contacto ──
--
-- `CONTRATO-GHL.md` §0: el tool decide dónde se muestra el contacto leyendo las señales que
-- transporta el motor. Esta tabla guarda esas señales:
--   Agenda de Hoy     → `cita_el` cae hoy
--   Respondieron      → `ultimo_entrante_el` > `ultimo_saliente_el`  (le debe respuesta)
--   Buzón general     → igual, pero sin ninguna tarea formal activa
--   Urgentes          → tag `bot_pausado_fallo`  (fuera de alcance por ahora)
--   Seguimientos      → lo decide `closer_seguimientos`, no esta tabla
-- ============================================================================

create table if not exists closer_contactos (
  ghl_contact_id text primary key,
  org_id         uuid not null,

  -- ── Identidad (de GHL) ──
  nombre   text not null,
  telefono text,
  email    text,

  -- ── Señales crudas (de GHL) ──
  tags          text[] not null default '{}',
  -- Chip de fuente ya normalizado: "META ADS" / "VSL OPT-IN" / "📷 IG PROFILE" / "DIRECTO".
  fuente        text not null default 'DIRECTO',
  -- StageKey del front, traducido del stage literal de GHL al leer.
  stage_key     text,
  stage_ghl     text,
  -- Letra de fit A/B/C/D. NULL = el motor todavía no calificó → la UI pinta "—" (§4.10).
  grade         char(1) check (grade is null or grade in ('A','B','C','D')),
  bot_estado    text,

  -- Subcategorías de Avanzar. Se acumulan sin borrarse (regla de acumulación, contrato §4):
  -- la píldora muestra solo la del stage actual, el resto queda para Gerencia.
  nivel_interes_seguimiento text,
  motivo_descalificacion    text,
  forma_pago_venta          text,
  razon_noshow              text,
  origen_nurture            text,

  -- ── Conversación ──
  -- Entrante > saliente = le debe respuesta. Es lo que puebla Respondieron / Buzón.
  ultimo_entrante_el  timestamptz,
  ultimo_saliente_el  timestamptz,
  ultimo_entrante_texto text,

  -- ── Cita ──
  cita_el       timestamptz,
  cita_meet_url text,
  cita_estado   text,

  -- ── Dinero ──
  monto numeric(12,2),

  sincronizado_el timestamptz not null default now(),
  creado_el       timestamptz not null default now()
);

-- El portón de entrada: solo contactos con `zona_closer` pertenecen a este módulo.
create index if not exists closer_contactos_zona_idx
  on closer_contactos using gin (tags);

create index if not exists closer_contactos_cita_idx
  on closer_contactos (org_id, cita_el) where cita_el is not null;

-- Para "le debe respuesta" sin escanear la tabla entera.
create index if not exists closer_contactos_sin_responder_idx
  on closer_contactos (org_id, ultimo_entrante_el)
  where ultimo_entrante_el is not null;

comment on table closer_contactos is
  'Caché de GHL. Truncatable y reconstruible: nada propio del tool vive acá.';

-- ── Notas del contacto ─────────────────────────────────────────────────────
-- Tabla propia y no un evento del historial: las notas son del closer (sus apuntes sobre
-- el lead), tienen su propio ciclo de vida y se listan aparte. El historial es un registro
-- de qué pasó; las notas son qué anotó una persona.

create table if not exists closer_notas (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null,
  ghl_contact_id text not null,

  texto text not null check (btrim(texto) <> ''),
  -- Píldora del Avanzar que originó la nota, o NULL si fue una nota suelta (§3).
  contexto text,

  autor_nombre     text not null,
  autor_usuario_id uuid references closer_usuarios(id),

  creado_el timestamptz not null default now()
);

create index if not exists closer_notas_contacto_idx
  on closer_notas (ghl_contact_id, creado_el desc);

-- ── Catálogo de eventos ────────────────────────────────────────────────────
-- `closer_contacto_eventos.tipo` era texto libre. Un catálogo lo vuelve enumerable sin la
-- rigidez de un enum de Postgres (que crece con cada feature y exige ALTER TYPE).

create table if not exists closer_evento_tipos (
  tipo        text primary key,
  descripcion text not null
);

insert into closer_evento_tipos (tipo, descripcion) values
  ('seguimiento_creado',      'El closer pactó un seguimiento vía Avanzar'),
  ('seguimiento_cancelado',   'El seguimiento se cerró sin resultado'),
  ('avanzar_registrado',      'El closer registró un resultado en Avanzar'),
  ('nota_agregada',           'Se agregó una nota al contacto'),
  ('mensaje_entrante',        'El contacto escribió'),
  ('mensaje_saliente',        'Se le envió un mensaje'),
  ('cita_agendada',           'Se agendó una cita con el closer'),
  ('cita_cancelada',          'Se canceló la cita'),
  ('serie_toque_enviado',     'GHL confirmó el envío de un toque de la serie'),
  ('serie_agotada',           'La serie terminó sin respuesta del contacto'),
  ('contacto_respondio',      'El contacto respondió — la serie muere'),
  ('entro_zona_closer',       'El contacto cruzó a territorio del closer'),
  ('tarea_completada',        'Se completó la tarea del día'),
  ('tarea_reabierta',         'El contacto volvió a escribir tras completarse la tarea'),
  ('tag_aplicado',            'Se aplicó un tag en GHL'),
  ('tag_removido',            'Se removió un tag en GHL'),
  ('efecto_ghl_omitido',      'Efecto no ejecutado: adaptador en modo stub')
on conflict (tipo) do nothing;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table closer_contactos     enable row level security;
alter table closer_notas         enable row level security;
alter table closer_evento_tipos  enable row level security;

-- ── La cola de Mi Día, completa ────────────────────────────────────────────
-- Una sola vista con la sección calculada, para que el front no reimplemente los criterios
-- y no puedan discrepar (§4.4). El orden de los `when` importa: es la prioridad entre
-- secciones cuando un contacto califica para varias.

create or replace view closer_mi_dia
  with (security_invoker = true) as
  select
    c.*,
    coalesce(t.fijada, false) as fijada,
    t.completada_dia,
    s.id             as seguimiento_id,
    s.modo           as seguimiento_modo,
    s.situacion      as seguimiento_situacion,
    s.fecha_objetivo as seguimiento_fecha,
    s.estado         as seguimiento_estado,
    s.nota           as seguimiento_nota,
    (closer_hoy_org() - s.fecha_objetivo) as dias_vencido,

    case
      -- Ya se atendió hoy: va a Completadas, sin importar qué más califique.
      when t.completada_dia = closer_hoy_org() then 'completadas'

      -- Urgentes primero: un bot caído bloquea todo lo demás. Fuera de alcance por ahora,
      -- pero la sección se calcula igual para que el día que se implemente ya esté.
      when 'bot_pausado_fallo' = any(c.tags) then 'urgentes'

      -- Cita hoy.
      when c.cita_el is not null
       and (c.cita_el at time zone 'America/Lima')::date = closer_hoy_org() then 'agenda'

      -- Seguimiento manual vencido o de hoy, o serie agotada. La serie EN CURSO no cuenta.
      when s.id is not null
       and s.estado in ('pendiente','agotado')
       and (s.modo = 'manual' or s.estado = 'agotado')
       and s.fecha_objetivo <= closer_hoy_org() then 'seguimientos'

      -- Le debe respuesta: escribió y nadie contestó después.
      when c.ultimo_entrante_el is not null
       and (c.ultimo_saliente_el is null or c.ultimo_entrante_el > c.ultimo_saliente_el)
        then 'respondieron'

      else null   -- vive solo en el Pipeline
    end as seccion

  from closer_contactos c
  left join closer_contacto_tarea t on t.ghl_contact_id = c.ghl_contact_id
  left join closer_seguimientos   s on s.ghl_contact_id = c.ghl_contact_id
                                   and s.estado in ('pendiente','agotado')
  -- El portón de entrada al módulo (verificado contra el contrato §3 y §9).
  where 'zona_closer' = any(c.tags);

comment on view closer_mi_dia is
  'Todas las secciones de Closer AI → Mi Día, con la sección ya resuelta en SQL para que el front no reimplemente los criterios.';
