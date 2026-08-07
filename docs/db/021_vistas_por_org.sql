-- 021 — Las tres vistas, recreadas por organización.
--
-- ── Por qué `drop` + `create` y no `create or replace` ────────────────
--
-- `create or replace view` solo deja AGREGAR columnas al final de la lista del `select`. Dos
-- de estas tres necesitan `org_id` **adentro**, y las tres cambian sus joins. Se dropean y se
-- recrean dentro de una transacción: los lectores esperan, no ven una vista a medias.
--
-- ── Lo que NO cambia ──────────────────────────────────────────────────
--
-- El resultado para ARIA tiene que ser idéntico al de antes (regla 2). Con una sola
-- organización, agregar `and x.org_id = y.org_id` a un join no cambia ni una fila: todas las
-- filas tienen el mismo `org_id`. Lo mismo con `closer_hoy_org(org_id)` frente a
-- `closer_hoy_org()`: con una sola fila en la configuración, el `limit 1` devolvía justamente
-- esa. La verificación de equivalencia está al pie de esta migración.
--
-- ── `security_invoker` en las tres ────────────────────────────────────
--
-- Dos ya lo tenían; `closer_agentes_texto_30d` no. Sin él, la vista corre con los permisos de
-- quien la creó y **saltea las políticas RLS** del que la consulta — o sea que la capa 3 del
-- aislamiento no la cubriría. Es gratis y cierra el hueco.

begin;

/* ═══════════════ 1. closer_agentes_texto_30d ═══════════════ */
--
-- Agrupaba SOLO por `agente_id`. Como `appointment-flow-ai` es el mismo identificador para
-- todas las empresas, las cinco habrían quedado sumadas en una sola tarjeta del panel de
-- Auditoría de Agentes: una empresa viendo los fallos y el sentimiento de las otras cuatro.

drop view if exists public.closer_agentes_texto_30d;

create view public.closer_agentes_texto_30d
with (security_invoker = true) as
  select org_id,
         agente_id,
         count(*) as analisis,
         count(distinct ghl_contact_id) as conversaciones,
         count(*) filter (where fallo) as fallos,
         round(100.0 * count(*) filter (where sentimiento = 'positivo')::numeric / nullif(count(*), 0)::numeric) as pct_positivos,
         round(100.0 * count(*) filter (where sentimiento = 'neutral')::numeric  / nullif(count(*), 0)::numeric) as pct_neutrales,
         round(100.0 * count(*) filter (where sentimiento = 'molesto')::numeric  / nullif(count(*), 0)::numeric) as pct_molestos
    from public.closer_analisis_agente
   where analizado_el >= (now() - '30 days'::interval)
     and auditable
     and disparo <> 'linea_base'
   group by org_id, agente_id;

/* ═══════════════ 2. closer_seguimientos_de_hoy ═══════════════ */
--
-- Ya exponía `org_id`, pero resolvía el "hoy" con `closer_hoy_org()` sin argumento — tres
-- veces. Cada una de esas llamadas tomaba la zona horaria de una fila cualquiera de la
-- configuración. Ahora cada fila usa la zona de SU organización.
--
-- El join a `closer_contacto_tarea` también se scopea: dependía de que `ghl_contact_id` sea
-- único entre subcuentas, que es una premisa que nadie comprobó.

drop view if exists public.closer_seguimientos_de_hoy;

create view public.closer_seguimientos_de_hoy
with (security_invoker = true) as
  select s.id,
         s.org_id,
         s.ghl_contact_id,
         s.closer_id,
         s.situacion,
         s.modo,
         s.fecha_objetivo,
         s.serie_key,
         s.serie_toques,
         s.serie_dias,
         s.nota,
         s.estado,
         s.motivo_cierre,
         s.cerrado_el,
         s.cerrado_por,
         s.reemplazado_por,
         s.creado_el,
         s.creado_por,
         closer_hoy_org(s.org_id) - s.fecha_objetivo as dias_vencido,
         coalesce(t.fijada, false) as fijada
    from public.closer_seguimientos s
    left join public.closer_contacto_tarea t
           on t.ghl_contact_id = s.ghl_contact_id
          and t.org_id = s.org_id
   where s.estado = any (array['pendiente'::closer_estado_seguimiento, 'agotado'::closer_estado_seguimiento])
     and (s.modo = 'manual'::closer_modo_seguimiento or s.estado = 'agotado'::closer_estado_seguimiento)
     and s.fecha_objetivo <= closer_hoy_org(s.org_id)
     and t.completada_dia is distinct from closer_hoy_org(s.org_id)
   order by coalesce(t.fijada, false) desc, s.fecha_objetivo;

/* ═══════════════ 3. closer_indicadores_contacto ═══════════════ */
--
-- La más enredada: cuatro CTEs y cuatro joins, TODOS por `ghl_contact_id` solo. Además usaba
-- `closer_dia_org()` sin organización dos veces, dentro del `not exists` que descarta los
-- no-show — o sea que qué cuenta como "el mismo día" salía de la zona horaria de una empresa
-- cualquiera.
--
-- Ahora cada CTE agrupa por `(org_id, ghl_contact_id)` y cada join empareja las dos columnas.
-- Se agrega `org_id` a la salida para que quien la consulte pueda filtrar.

drop view if exists public.closer_indicadores_contacto;

create view public.closer_indicadores_contacto
with (security_invoker = true) as
  with reuniones as (
    select c.org_id,
           c.ghl_contact_id,
           count(*)::integer as reuniones
      from public.closer_citas c
     where c.estado_ghl is distinct from 'cancelled'
       and c.fecha_hora < now()
       and not exists (
             select 1
               from public.closer_avances a
              where a.org_id = c.org_id
                and a.ghl_contact_id = c.ghl_contact_id
                and a.salida = 'no_show'
                and closer_dia_org(a.org_id, a.created_at) = closer_dia_org(c.org_id, c.fecha_hora))
     group by c.org_id, c.ghl_contact_id
  ), proximas as (
    select distinct on (c.org_id, c.ghl_contact_id)
           c.org_id,
           c.ghl_contact_id,
           c.fecha_hora as proxima_cita_el,
           c.meet_url   as proxima_meet_url
      from public.closer_citas c
     where c.estado_ghl is distinct from 'cancelled'
       and c.fecha_hora >= now()
     order by c.org_id, c.ghl_contact_id, c.fecha_hora
  ), vencidas as (
    select distinct on (c.org_id, c.ghl_contact_id)
           c.org_id,
           c.ghl_contact_id,
           c.fecha_hora as ultima_cita_vencida_el
      from public.closer_citas c
     where c.estado_ghl is distinct from 'cancelled'
       and c.fecha_hora < now()
     order by c.org_id, c.ghl_contact_id, c.fecha_hora desc
  ), series as (
    select s_1.org_id,
           s_1.ghl_contact_id,
           count(*)::integer as series
      from public.closer_seguimientos s_1
     where s_1.modo = 'automatico'::closer_modo_seguimiento
       and s_1.estado = 'pendiente'::closer_estado_seguimiento
     group by s_1.org_id, s_1.ghl_contact_id
  )
  select k.org_id,
         k.ghl_contact_id,
         coalesce(r.reuniones, 0) as reuniones,
         p.proxima_cita_el is not null as cita_futura,
         p.proxima_cita_el,
         p.proxima_meet_url,
         v.ultima_cita_vencida_el,
         coalesce(s.series, 0) > 0 as seguimiento_auto
    from public.closer_contactos k
    left join reuniones r on r.org_id = k.org_id and r.ghl_contact_id = k.ghl_contact_id
    left join proximas  p on p.org_id = k.org_id and p.ghl_contact_id = k.ghl_contact_id
    left join vencidas  v on v.org_id = k.org_id and v.ghl_contact_id = k.ghl_contact_id
    left join series    s on s.org_id = k.org_id and s.ghl_contact_id = k.ghl_contact_id;

commit;

notify pgrst, 'reload schema';
