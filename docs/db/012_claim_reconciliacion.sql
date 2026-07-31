-- 012 — El candado de la reconciliación como función SQL (2026-07-31)
--
-- Por qué existe: el claim vía UPDATE de PostgREST (`.update().or(...)`) falla en
-- producción con 42703 "column does not exist" pese a que la columna existe y el SELECT
-- de la misma columna funciona — un problema del camino de filtros de PostgREST tras el
-- ALTER de 011 (réplica con schema cache viejo), no de la base. Una RPC lo esquiva por
-- completo: el SQL vive en Postgres, PostgREST solo despacha la llamada. Y de paso el
-- claim queda en UNA sentencia atómica del lado del servidor.

begin;

create or replace function public.closer_reconciliar_claim(
  p_org_id uuid,
  p_ventana_segundos integer default 10
)
returns table (gano boolean, marca_agua timestamptz)
language sql
security definer
set search_path = public
as $$
  with intento as (
    update public.closer_org_config
       set ultima_reconciliacion = now()
     where org_id = p_org_id
       and (ultima_reconciliacion is null
            or ultima_reconciliacion < now() - make_interval(secs => p_ventana_segundos))
    returning reconciliacion_marca_agua
  )
  select true as gano, reconciliacion_marca_agua from intento
  union all
  select false, null where not exists (select 1 from intento);
$$;

revoke all on function public.closer_reconciliar_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.closer_reconciliar_claim(uuid, integer) to service_role;

-- Avanzar la marca de agua también por RPC, por la misma razón.
create or replace function public.closer_reconciliar_marca(
  p_org_id uuid,
  p_marca timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.closer_org_config
     set reconciliacion_marca_agua = greatest(coalesce(reconciliacion_marca_agua, 'epoch'::timestamptz), p_marca)
   where org_id = p_org_id;
$$;

revoke all on function public.closer_reconciliar_marca(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.closer_reconciliar_marca(uuid, timestamptz) to service_role;

commit;

notify pgrst, 'reload schema';
