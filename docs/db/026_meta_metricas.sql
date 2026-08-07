-- 026 · Las métricas de pauta de Meta, por día (2026-08-07 · ESPEC §9)
--
-- Fase 7, mínimo viable: **leer y mostrar**. Nada de atribución, alertas ni recomendaciones —
-- esas cuatro quedan detrás del velo de "en desarrollo" (§8).
--
-- ── Por día y por nivel, nunca el acumulado ─────────────────────────────────
--
-- La spec lo pide con todas las letras y el motivo es que **el histórico es lo que después
-- permite medir cambios**. Un acumulado responde "cuánto gasté"; una serie por día responde "qué
-- pasó cuando subí el presupuesto el martes", que es la pregunta que un media buyer hace de
-- verdad. Guardar solo el acumulado es una decisión irreversible: el día que se quiera la serie,
-- los días que ya pasaron no vuelven.
--
-- ── La clave única es lo que hace la resincronización segura ────────────────
--
-- `(org_id, nivel, objeto_id, fecha)`. Meta reajusta las cifras de los últimos días —las
-- conversiones tardan en atribuirse— así que el colector va a volver a pedir la misma fecha
-- varias veces. Con esta clave, resincronizar es un `upsert` que corrige; sin ella, cada pasada
-- duplicaría el gasto del mes.
--
-- ── Por qué el crudo va en su propia tabla ──────────────────────────────────
--
-- Misma regla D15 que los webhooks: *se recibe, se guarda, y la tabla se diseña mirando datos
-- reales*. Nadie de este equipo vio todavía una respuesta de la Graph API de esta cuenta, así que
-- las columnas de abajo son una apuesta informada — y `closer_meta_crudo` es el seguro. El día que
-- una métrica falte o venga con otro nombre, el dato está y se remapea sin haber perdido nada.

/* ================================================================== */
/* closer_meta_metricas — una fila por objeto y por día                */
/* ================================================================== */

create table if not exists public.closer_meta_metricas (
  id           bigint generated always as identity primary key,
  org_id       uuid not null,

  -- `cuenta` | `campana` | `adset` | `anuncio`. Texto con CHECK y no enum: agregar un nivel no
  -- debería exigir un `alter type`, que en Postgres no se puede revertir dentro de una
  -- transacción.
  nivel        text not null check (nivel in ('cuenta', 'campana', 'adset', 'anuncio')),
  objeto_id    text not null,
  nombre       text,
  -- De quién cuelga. `null` en el nivel cuenta. Sin FK a sí misma a propósito: Meta puede
  -- devolver un anuncio cuyo ad set todavía no sincronizamos, y rechazar la fila por eso sería
  -- perder el dato que vinimos a buscar.
  padre_id     text,

  -- La fecha del NEGOCIO (el día de Meta), no la de la sincronización. Es la que se agrupa.
  fecha        date not null,

  /**
   * Las métricas. **Todas nullable**, y no es descuido: Meta omite el campo cuando no aplica
   * —un anuncio sin video no trae retención— y un 0 ahí afirmaría una medición que nadie hizo.
   * Es la regla §4.1 en el esquema: `null` = no vino; `0` = vino en cero.
   */
  gasto        numeric(14, 4),
  impresiones  bigint,
  clics        bigint,
  alcance      bigint,
  -- Derivadas por Meta. Se guardan tal cual en vez de recalcularlas: si Meta y nosotros
  -- redondeamos distinto, dos vitrinas del mismo hecho empiezan a divergir.
  ctr          numeric(10, 6),
  cpc          numeric(14, 6),
  cpm          numeric(14, 6),
  -- Leads del formulario de Meta. NO es el conteo de `closer_contactos`: uno mide lo que Meta
  -- registró y el otro lo que llegó a la plataforma, y compararlos es útil justamente porque
  -- pueden diferir.
  leads        bigint,
  cpl          numeric(14, 6),

  -- Video: reproducciones y retención. Los cuatro cortes que pide §9.
  video_reproducciones bigint,
  video_25     bigint,
  video_50     bigint,
  video_75     bigint,
  video_100    bigint,

  sincronizado_el timestamptz not null default now(),

  constraint closer_meta_metricas_unico unique (org_id, nivel, objeto_id, fecha)
);

-- El dashboard filtra por empresa, nivel y rango de fechas, en ese orden.
create index if not exists closer_meta_metricas_consulta_idx
  on public.closer_meta_metricas (org_id, nivel, fecha desc);

/* ================================================================== */
/* closer_meta_crudo — el payload, antes de mapear (D15)               */
/* ================================================================== */

create table if not exists public.closer_meta_crudo (
  id           bigint generated always as identity primary key,
  org_id       uuid not null,
  nivel        text not null,
  fecha_desde  date not null,
  fecha_hasta  date not null,
  payload      jsonb not null,
  recibido_el  timestamptz not null default now()
);

create index if not exists closer_meta_crudo_org_idx
  on public.closer_meta_crudo (org_id, recibido_el desc);

/* ================================================================== */
/* Aislamiento                                                         */
/* ================================================================== */

-- RLS activada y CERO políticas, igual que las otras 19 tablas: `public` está expuesto por
-- PostgREST, así que una tabla sin RLS es legible con la anon key —la que viaja en el bundle del
-- browser—. Sin políticas solo pasa `service_role`. Una política permisiva acá ABRIRÍA la tabla.
alter table public.closer_meta_metricas enable row level security;
alter table public.closer_meta_crudo    enable row level security;

revoke all on public.closer_meta_metricas from anon, authenticated;
revoke all on public.closer_meta_crudo    from anon, authenticated;

/* ================================================================== */
/* FK a la empresa                                                     */
/* ================================================================== */

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'closer_meta_metricas_org_fk') then
    alter table public.closer_meta_metricas
      add constraint closer_meta_metricas_org_fk
      foreign key (org_id) references public.closer_org_config(org_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'closer_meta_crudo_org_fk') then
    alter table public.closer_meta_crudo
      add constraint closer_meta_crudo_org_fk
      foreign key (org_id) references public.closer_org_config(org_id) on delete restrict;
  end if;
end $$;

comment on table public.closer_meta_metricas is
  'Métricas de pauta de Meta, una fila por objeto y por día (ESPEC §9). Nunca el acumulado: el '
  'histórico por día es lo que permite medir el efecto de un cambio. Las métricas son nullable '
  'porque Meta omite el campo cuando no aplica, y null (no vino) no es 0 (vino en cero).';

comment on table public.closer_meta_crudo is
  'El payload de la Graph API antes de mapear (D15). Nadie vio todavía una respuesta real de '
  'esta cuenta, así que las columnas de closer_meta_metricas son una apuesta informada y esta '
  'tabla es el seguro: si una métrica falta o cambia de nombre, se remapea sin perder el dato.';

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
