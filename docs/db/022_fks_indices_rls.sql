-- 022 — Integridad referencial, índices por organización y cierre de RLS.
--
-- Cierra la fase EXPAND. Después de esta migración el esquema es multi-empresa completo:
-- 18 de 19 tablas con `org_id` (el catálogo `closer_evento_tipos` queda afuera a propósito),
-- las tres vistas scopeadas, y las funciones de fecha y candado recibiendo la organización.
--
-- ── Sobre las políticas RLS: por qué NO se crean ──────────────────────
--
-- La especificación (§2.4, capa 3) pide "habilitar RLS con políticas por empresa". Las 19
-- tablas **ya tienen RLS habilitada**, y acá está lo que conviene entender antes de agregar
-- políticas:
--
--   Con RLS activa y CERO políticas, PostgreSQL niega todo a los roles que no son dueños de
--   la tabla. `anon` y `authenticated` ya no ven ni una fila. Es el estado MÁS cerrado
--   posible.
--
-- Escribir una política permisiva lo **abriría**. Y una política por organización necesita
-- saber cuál es la organización del que consulta: con Supabase Auth eso vendría en el JWT,
-- pero la spec §4.2 descarta Supabase Auth a propósito (exigiría la `anon key` en el bundle).
-- No hay de dónde sacar ese dato hoy, así que la política sería `using (false)` disfrazada.
--
-- **El aislamiento real lo sostienen las capas 1 y 2** (el helper `db(orgId)` y el test que
-- lo hace cumplir), como la propia spec reconoce: `service_role` ignora RLS de todos modos.
-- Lo que sí falta y sí sirve es el `revoke`, abajo.

begin;

/* ═══════════════ Llaves foráneas ═══════════════ */
--
-- `on delete restrict`: borrar una organización con datos tiene que fallar, no arrastrarlos.
-- La baja de una empresa es lógica (`activa = false`, §7.1); el borrado real es una decisión
-- explícita y separada, y estas FKs obligan a vaciar antes.

do $$
declare
  t text;
begin
  foreach t in array array[
    'closer_mensajes', 'closer_citas', 'closer_avances', 'closer_llamadas', 'closer_plantillas'
  ] loop
    if not exists (
      select 1 from pg_constraint
       where conrelid = ('public.' || t)::regclass
         and conname  = t || '_org_fk'
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (org_id)
           references public.closer_org_config(org_id) on delete restrict',
        t, t || '_org_fk');
    end if;
  end loop;
end;
$$;

-- La bandeja va aparte: su `org_id` es nullable (§6.3), así que la FK tiene que tolerar el
-- null. En SQL una FK con valor nulo no se valida, así que esto funciona tal cual: un webhook
-- huérfano entra, y uno con organización tiene que apuntar a una que exista.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.closer_webhook_inbox'::regclass
       and conname  = 'closer_webhook_inbox_org_fk'
  ) then
    alter table public.closer_webhook_inbox
      add constraint closer_webhook_inbox_org_fk foreign key (org_id)
        references public.closer_org_config(org_id) on delete restrict;
  end if;
end;
$$;

/* ═══════════════ Índices ═══════════════ */
--
-- Casi toda consulta va a filtrar por organización. Los índices van sobre `(org_id, <la
-- columna por la que ya se filtraba>)` y no sobre `org_id` solo: un índice de una sola
-- columna con un único valor distinto —que es la situación hoy, y va a seguir siéndolo
-- mientras haya 5 empresas y no 5.000— no lo usa el planner.

create index if not exists idx_mensajes_org_contacto
  on public.closer_mensajes (org_id, ghl_contact_id, timestamp_ghl desc);

create index if not exists idx_citas_org_fecha
  on public.closer_citas (org_id, fecha_hora);

create index if not exists idx_avances_org_contacto
  on public.closer_avances (org_id, ghl_contact_id);

create index if not exists idx_llamadas_org_contacto
  on public.closer_llamadas (org_id, ghl_contact_id, recibido_el desc);

/* ═══════════════ El `revoke` que faltaba ═══════════════ */
--
-- La convención del repo (CLAUDE.md · Seguridad) es que toda tabla lleva RLS **y** el revoke.
-- La 008 existe solo porque la 007 se olvidó del segundo. La auditoría del 2026-08-06 encontró
-- que 13 tablas seguían sin él.
--
-- Con RLS activa el revoke es redundante en la práctica, pero es defensa en profundidad
-- barata: si alguien agrega una política permisiva sin pensarlo, el grant sigue sin estar.
-- La `anon key` viaja en el bundle del browser, así que el costo de equivocarse acá es alto.

do $$
declare
  t text;
begin
  foreach t in array array[
    'closer_org_config', 'closer_usuarios', 'closer_contactos', 'closer_contacto_eventos',
    'closer_contacto_tarea', 'closer_seguimientos', 'closer_notas', 'closer_avances',
    'closer_citas', 'closer_mensajes', 'closer_llamadas', 'closer_plantillas',
    'closer_webhook_inbox', 'closer_ghl_outbox', 'closer_conexiones', 'closer_evento_tipos',
    'closer_analisis_agente', 'closer_hallazgo_agente', 'closer_ajustes_agente'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end;
$$;

-- Las vistas heredan el `security_invoker` de la 021, pero el grant es propio.
revoke all on public.closer_agentes_texto_30d    from anon, authenticated;
revoke all on public.closer_indicadores_contacto from anon, authenticated;
revoke all on public.closer_seguimientos_de_hoy  from anon, authenticated;

commit;

notify pgrst, 'reload schema';
