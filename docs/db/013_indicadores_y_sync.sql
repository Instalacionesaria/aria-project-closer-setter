-- 013 — Los 6 indicadores del contacto + el candado del sync manual (2026-08-04)
--
-- Pedido de Fabio: los 6 íconos de la fila (📹 reuniones con el closer · 📅 tiene cita ·
-- 📞 llamadas del agente de voz · 🤖 bot · ⏱ seguimiento automático · 💰 venta) tienen que
-- ser INFORMACIÓN DEL CONTACTO: acompañarlo a donde se mueva en el pipeline y verse igual
-- en cualquier vitrina. Hoy se derivan de arrays que solo existen en la semilla, así que
-- para un contacto real de GHL cinco de los seis están permanentemente apagados.
--
-- Esta migración pone la mitad de datos. La otra mitad (una sola query por lote, el
-- resolvedor del front y el componente único de íconos) vive en el código.
--
-- ── Lo que se descubrió auditando la base antes de escribir esto ──
--
--   · `closer_contactos.bot_estado` está NULL en los 7 contactos, aunque `sincronizarContacto`
--     dice escribirla. `cita_el`/`cita_meet_url` también: solo las llena el webhook
--     `cita.agendada`, que para estos nunca disparó. Tres columnas denormalizadas muertas.
--   · `closer_citas` en cambio está viva y fresca (la mantienen el cron de :25/:55 y el
--     refresco on-demand de la Agenda).
--   · GHL NUNCA actualiza el estado de una cita: las 4 que ya pasaron siguen en 'confirmed'.
--     No hay 'showed' ni 'noshow' en toda la tabla.
--
-- De ahí la regla: **lo que se deriva en la lectura no se queda viejo; lo que se
-- denormaliza, sí.** 📹/📅/⏱ salen de una vista sobre las tablas vivas; 🤖 se deriva de los
-- tags en cada lectura; solo 📞 se denormaliza, porque su origen está en GHL (custom fields)
-- y traerlo en vivo costaría una llamada por contacto.

begin;

/* ================================================================== */
/* (a) Contadores del agente de voz — el ícono 📞                      */
/* ================================================================== */

-- GHL los mantiene como custom fields agregados del contacto (`_llamadas_ia_intentos`,
-- `_llamadas_ia_contestadas`, `ultima_llamada_ia__resultado`). Ya se leen al abrir el tab
-- Perfil; acá se cachean para poder pintarlos en una LISTA sin una llamada por fila.
--
-- Nullable a propósito, sin `default 0`: NULL = "nunca se sincronizó desde GHL", 0 = "GHL
-- dice que no hubo llamadas". La UI pinta lo mismo en los dos casos (atenuado, sin número),
-- pero poder distinguirlos es exactamente lo que faltó para darse cuenta de que `bot_estado`
-- llevaba semanas muerta.
alter table public.closer_contactos
  add column if not exists llamadas_ia_intentos integer;
alter table public.closer_contactos
  add column if not exists llamadas_ia_contestadas integer;
alter table public.closer_contactos
  add column if not exists ultima_llamada_ia_resultado text;

-- Las tres denormalizaciones que quedan obsoletas. No se dropean: un DROP vuelve a
-- disparar el problema de schema cache de §51.5 sin ninguna ganancia, y el webhook de
-- cita.agendada sigue escribiendo cita_el sin hacer daño. Lo que cambia es que NADIE
-- las lee más.
comment on column public.closer_contactos.bot_estado is
  'OBSOLETA desde 013. El estado del bot se DERIVA de los tags en cada lectura '
  '(botDesdeTags en src/lib/ghl/contrato.ts). Nadie la escribe ni la lee.';
comment on column public.closer_contactos.cita_el is
  'OBSOLETA desde 013. La cita sale de closer_citas vía closer_indicadores_contacto. '
  'El webhook cita.agendada la sigue escribiendo, pero ninguna lectura la usa.';
comment on column public.closer_contactos.cita_meet_url is
  'OBSOLETA desde 013 — ver cita_el.';
comment on column public.closer_contactos.cita_estado is
  'OBSOLETA desde 013 — ver cita_el.';

/* ================================================================== */
/* (b) El día civil de la organización, para cualquier timestamptz     */
/* ================================================================== */

-- Hermana de closer_hoy_org() (001), que solo sabe de "hoy". La necesita el cruce
-- cita↔no-show de la vista de abajo: comparar dos instantes en UTC daría el día equivocado
-- para cualquier cita de la tarde en Lima.
create or replace function public.closer_dia_org(p_momento timestamptz) returns date
  language sql stable as $$
    select (p_momento at time zone coalesce(
      (select zona_horaria from public.closer_org_config limit 1),
      'America/Lima'
    ))::date
  $$;

comment on function public.closer_dia_org(timestamptz) is
  'El día civil de la organización para un instante dado. Mismo criterio que closer_hoy_org().';

/* ================================================================== */
/* (c) La vista de indicadores — 📹 · 📅 · ⏱                           */
/* ================================================================== */

-- Una fila por contacto. Su cardinalidad es la de closer_contactos, la misma que el select
-- que pipeline.ts ya hacía — así que agregarla cuesta una query, no una por contacto.
-- Prohibido consultarla por contacto: esto corre cada 10 segundos.
create or replace view public.closer_indicadores_contacto
  with (security_invoker = true) as
with reuniones as (
  -- 📹 "Cuántas calls tuvo con el closer".
  --
  -- No hay ninguna fuente real de llamadas en el sistema: GHL no expone las del closer, no
  -- hay evento de webhook, no hay tabla. Y su estado de cita es inútil — las 4 citas que ya
  -- pasaron siguen en 'confirmed' porque nadie las marca.
  --
  -- Regla acordada con Fabio (2026-08-04): **la cita pasó y el closer no dijo que lo
  -- plantaron ⇒ la reunión ocurrió.** El vínculo cita↔avance es (contacto, día civil): no
  -- hay FK entre las dos tablas y un avance no apunta a una cita concreta.
  --
  -- Límite conocido, dejado a propósito: si el No-show se registra al día siguiente, la
  -- reunión se cuenta igual. Es el MISMO hueco que ya tiene el show-rate de
  -- api/closer/inicio.ts; que los dos mientan igual es preferible a arreglar uno solo y que
  -- el cockpit y el ícono del mismo contacto se contradigan.
  select
    c.ghl_contact_id,
    count(*)::int as reuniones
  from public.closer_citas c
  where c.estado_ghl is distinct from 'cancelled'   -- `is distinct from`, no `<>`: con `<>`
                                                    -- una cita de estado NULL desaparecería
                                                    -- del conteo sin error (el .neq() de
                                                    -- PostgREST tiene hoy ese bug latente).
    and c.fecha_hora < now()
    and not exists (
      select 1
      from public.closer_avances a
      where a.ghl_contact_id = c.ghl_contact_id
        and a.salida = 'no_show'
        and public.closer_dia_org(a.created_at) = public.closer_dia_org(c.fecha_hora)
    )
  group by c.ghl_contact_id
),
proximas as (
  -- 📅 "Está agendado actualmente": alguna cita futura vigente.
  -- `now()` es estable dentro de la sentencia, así que una misma cita no puede caer a la vez
  -- en `reuniones` y en `proximas`.
  select distinct on (c.ghl_contact_id)
    c.ghl_contact_id,
    c.fecha_hora as proxima_cita_el,
    c.meet_url   as proxima_meet_url
  from public.closer_citas c
  where c.estado_ghl is distinct from 'cancelled'
    and c.fecha_hora >= now()
  order by c.ghl_contact_id, c.fecha_hora asc
),
vencidas as (
  -- La última cita que ya pasó. No enciende ningún ícono: alimenta la celda "Cita vencida ·"
  -- del Pipeline, que existe porque una cita pasada sin Avanzar nunca desaparece (§50.10).
  select distinct on (c.ghl_contact_id)
    c.ghl_contact_id,
    c.fecha_hora as ultima_cita_vencida_el
  from public.closer_citas c
  where c.estado_ghl is distinct from 'cancelled'
    and c.fecha_hora < now()
  order by c.ghl_contact_id, c.fecha_hora desc
),
series as (
  -- ⏱ Serie de seguimiento AUTOMÁTICO en curso.
  -- Ojo: la vista closer_seguimientos_de_hoy EXCLUYE este caso a propósito (§50.2), así que
  -- hasta ahora no había forma de saberlo desde ningún endpoint. Este es su único origen.
  select s.ghl_contact_id, count(*)::int as series
  from public.closer_seguimientos s
  where s.modo = 'automatico' and s.estado = 'pendiente'
  group by s.ghl_contact_id
)
select
  k.ghl_contact_id,
  coalesce(r.reuniones, 0)          as reuniones,
  (p.proxima_cita_el is not null)   as cita_futura,
  p.proxima_cita_el,
  p.proxima_meet_url,
  v.ultima_cita_vencida_el,
  coalesce(s.series, 0) > 0         as seguimiento_auto
from public.closer_contactos k
left join reuniones r on r.ghl_contact_id = k.ghl_contact_id
left join proximas  p on p.ghl_contact_id = k.ghl_contact_id
left join vencidas  v on v.ghl_contact_id = k.ghl_contact_id
left join series    s on s.ghl_contact_id = k.ghl_contact_id;

comment on view public.closer_indicadores_contacto is
  'Los indicadores 📹/📅/⏱ de cada contacto, derivados de las tablas vivas (closer_citas, '
  'closer_avances, closer_seguimientos). 📞 sale de las columnas llamadas_ia_* del contacto '
  'y 🤖 de sus tags — esos dos no están acá porque no requieren agregación.';

revoke all on public.closer_indicadores_contacto from anon, authenticated;
grant select on public.closer_indicadores_contacto to service_role;

/* ================================================================== */
/* (d) El candado de "Sincronizar CRM"                                 */
/* ================================================================== */

-- El botón pasa a refrescar TODOS los contactos del territorio contra GHL (1 llamada por
-- contacto activo). Sin freno, cinco pestañas con un dedo apoyado en el botón se comen la
-- cuota. El candado convierte una acción de usuario en algo acotado, igual que el de la
-- reconciliación — y por la misma razón de §51.5, nace como RPC y no como UPDATE filtrado.
alter table public.closer_org_config
  add column if not exists ultima_sincronizacion_territorio timestamptz;

create or replace function public.closer_sincronizar_claim(
  p_org_id uuid,
  p_ventana_segundos integer default 60
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with intento as (
    update public.closer_org_config
       set ultima_sincronizacion_territorio = now()
     where org_id = p_org_id
       and (ultima_sincronizacion_territorio is null
            or ultima_sincronizacion_territorio < now() - make_interval(secs => p_ventana_segundos))
    returning 1
  )
  select exists (select 1 from intento);
$$;

revoke all on function public.closer_sincronizar_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.closer_sincronizar_claim(uuid, integer) to service_role;

/* ================================================================== */
/* (e) Índices                                                         */
/* ================================================================== */

-- Los dos que la vista necesita y no existían. Los de closer_citas
-- (contacto + fecha) ya están desde 011.
create index if not exists closer_avances_noshow_idx
  on public.closer_avances (ghl_contact_id, created_at)
  where salida = 'no_show';

create index if not exists closer_seguimientos_auto_idx
  on public.closer_seguimientos (ghl_contact_id)
  where modo = 'automatico' and estado = 'pendiente';

-- Los tres SELECT grandes (mi-dia, reconciliar, pipeline) traían la tabla entera sin WHERE,
-- así que ningún índice podía ayudarlos. Al agregarles `.eq("org_id", …)` —verificado: las
-- 4 tablas tienen org_id poblado, 0 nulls— estos pasan a sostenerlos.
create index if not exists closer_contactos_org_idx
  on public.closer_contactos (org_id);

create index if not exists closer_contactos_org_stage_idx
  on public.closer_contactos (org_id, stage_key);

commit;

-- Obligatorio tras cualquier ALTER/CREATE: PostgREST puede quedar sirviendo un schema cache
-- viejo y responder 42703 "column does not exist" sobre una columna que existe (§51.5, pasó
-- con 011). Si aun así falla, la salida conocida es mover la operación a una RPC.
notify pgrst, 'reload schema';
