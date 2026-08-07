-- 020 — El "hoy", la zona horaria y el candado del auditor pasan a ser POR ORGANIZACIÓN.
--
-- Es el riesgo más grande de toda la migración, y no está en la especificación.
--
-- ── El bug que esto arregla ───────────────────────────────────────────
--
-- `closer_hoy_org()` y `closer_dia_org()` resolvían la zona horaria así:
--
--     select zona_horaria from public.closer_org_config limit 1
--
-- Sin `where` **y sin `order by`**. Con una sola organización daba siempre lo mismo. Con
-- cinco, Postgres puede devolver cualquiera de las filas — y una distinta entre dos consultas
-- del mismo request.
--
-- Esas dos funciones son el ORIGEN DE "HOY" de todo el sistema: qué contactos entran en las
-- colas de Mi Día, qué seguimiento venció, qué cita es de mañana, qué tarea se completó hoy.
-- Con empresas fuera de Perú, el día civil de una decidiría el de las otras cuatro.
--
-- ── Por qué SOBRECARGAS y no reemplazos ───────────────────────────────
--
-- Las versiones sin `p_org_id` se DEJAN VIVAS. Si se borraran acá, entre el momento de correr
-- esta migración y el de desplegar el código que pasa la organización, `closer_registrar_
-- seguimiento` y las dos vistas romperían con "function does not exist" — o sea, Avanzar y
-- Mi Día caídos. PostgreSQL resuelve sobrecargas por aridad y tipo, así que las cuatro
-- conviven sin ambigüedad.
--
-- **Se borran en la migración de CONTRACT**, cuando ya nadie las llame.

begin;

/* ─────────────── El "hoy" y el día civil, por organización ─────────────── */

create or replace function public.closer_hoy_org(p_org_id uuid)
returns date
language sql
stable
as $$
  select (now() at time zone coalesce(
    (select zona_horaria from public.closer_org_config where org_id = p_org_id),
    'America/Lima'
  ))::date
$$;

comment on function public.closer_hoy_org(uuid) is
  'El día civil de HOY en la zona de esa organización. Reemplaza a closer_hoy_org(), que '
  'resolvía la zona con `limit 1` sin filtro y con 5 empresas devolvía cualquiera.';

create or replace function public.closer_dia_org(p_org_id uuid, p_momento timestamptz)
returns date
language sql
stable
as $$
  select (p_momento at time zone coalesce(
    (select zona_horaria from public.closer_org_config where org_id = p_org_id),
    'America/Lima'
  ))::date
$$;

/* ─────────────────── El candado del auditor, por organización ─────────────────── */
--
-- Escribe `closer_contactos.auditor_claim_el`. Hoy filtra solo por `ghl_contact_id`, que es
-- único entre subcuentas, así que el candado ya era por empresa DE HECHO. Se le agrega
-- `org_id` igual, por dos motivos: deja de depender de una premisa sobre los ids de GHL que
-- nadie comprobó, y hace que el candado falle cerrado —no encuentra la fila, no gana el
-- claim— si alguna vez alguien pide el contacto de otra empresa.
--
-- Sigue sin liberarse al terminar (D11): si el análisis explota, reintentar en caliente
-- duplica llamadas justo cuando el servicio externo está fallando.

create or replace function public.closer_auditor_claim(
  p_org_id           uuid,
  p_contact_id       text,
  p_ventana_segundos integer default 120
)
returns boolean
language sql
security definer
set search_path to 'public'
as $$
  with intento as (
    update public.closer_contactos
       set auditor_claim_el = now()
     where org_id = p_org_id
       and ghl_contact_id = p_contact_id
       and (auditor_claim_el is null
            or auditor_claim_el < now() - make_interval(secs => p_ventana_segundos))
    returning 1
  )
  select exists (select 1 from intento);
$$;

/* ───────── Registrar seguimiento: le pasa la organización al "hoy" ───────── */
--
-- Misma firma y mismo cuerpo que la versión anterior, con dos cambios de una línea:
--   1. `closer_hoy_org()` → `closer_hoy_org(p_org_id)`. La función YA recibía `p_org_id`
--      (lo inserta en las tres tablas que toca); solo no se lo pasaba al "hoy".
--   2. El lookup del seguimiento abierto ahora filtra por `org_id`. Antes buscaba solo por
--      contacto: correcto mientras los ids de GHL sean únicos, innecesario de suponer ahora.
--
-- OJO con `p_org_id uuid default '00000000-…-0001'`: ese default sobrevive a propósito en
-- esta fase —lo necesita el código viejo, que no lo manda— y **se quita en el CONTRACT**.
-- Mientras exista, un llamador que se olvide de la organización escribe en ARIA en silencio.

CREATE OR REPLACE FUNCTION public.closer_registrar_seguimiento(p_ghl_contact_id text, p_closer_id uuid, p_situacion closer_situacion_seguimiento, p_modo closer_modo_seguimiento, p_fecha_objetivo date, p_nota text DEFAULT NULL::text, p_serie_key text DEFAULT NULL::text, p_serie_toques smallint DEFAULT NULL::smallint, p_serie_dias smallint DEFAULT NULL::smallint, p_texto_evento text DEFAULT 'Seguimiento registrado'::text, p_autor_nombre text DEFAULT 'Usuario Activo'::text, p_org_id uuid DEFAULT '00000000-0000-0000-0000-000000000001'::uuid)
 RETURNS TABLE(seguimiento_id uuid, reemplazo_id uuid, hoy date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_anterior uuid;
  v_nuevo    uuid;
  v_hoy      date := closer_hoy_org(p_org_id);
begin
  -- 1. Liberar el índice parcial único. `cancelado` es un estado válido con su motivo;
  --    si algo falla más abajo, toda la transacción se revierte y el viejo sigue abierto.
  select id into v_anterior
    from closer_seguimientos
   where org_id = p_org_id
     and ghl_contact_id = p_ghl_contact_id
     and estado in ('pendiente','agotado')
   limit 1;

  if v_anterior is not null then
    update closer_seguimientos
       set estado = 'cancelado', motivo_cierre = 'reemplazado', cerrado_el = now(), cerrado_por = p_closer_id
     where id = v_anterior;
  end if;

  -- 2. El nuevo.
  insert into closer_seguimientos (
    org_id, ghl_contact_id, closer_id, situacion, modo, fecha_objetivo,
    serie_key, serie_toques, serie_dias, nota, creado_por
  ) values (
    p_org_id, p_ghl_contact_id, p_closer_id, p_situacion, p_modo, p_fecha_objetivo,
    p_serie_key, p_serie_toques, p_serie_dias, nullif(btrim(coalesce(p_nota,'')), ''), p_closer_id
  ) returning id into v_nuevo;

  -- 3. Recién ahora el viejo puede apuntar al nuevo: las dos columnas juntas, que es lo
  --    que exige el CHECK `reemplazo_coherente`.
  if v_anterior is not null then
    update closer_seguimientos
       set estado = 'reemplazado', reemplazado_por = v_nuevo
     where id = v_anterior;
  end if;

  -- 4. Historial. Autor real: esto lo registró una persona vía Avanzar, no el sistema.
  insert into closer_contacto_eventos (
    org_id, ghl_contact_id, seguimiento_id, tipo, texto, autor_tipo, autor_nombre, autor_usuario_id, payload
  ) values (
    p_org_id, p_ghl_contact_id, v_nuevo, 'seguimiento_creado', p_texto_evento,
    'usuario', p_autor_nombre, p_closer_id,
    jsonb_build_object('situacion', p_situacion, 'modo', p_modo, 'fecha_objetivo', p_fecha_objetivo)
  );

  -- 5. La tarea de HOY queda completada — el closer ya trabajó a este contacto hoy, así que
  --    va a "Completadas Hoy". El seguimiento nuevo reaparece en su fecha: la vista los
  --    distingue con `completada_dia is distinct from closer_hoy_org()`.
  insert into closer_contacto_tarea (ghl_contact_id, org_id, fijada, completada_dia, completada_el, completada_por)
  values (p_ghl_contact_id, p_org_id, false, v_hoy, now(), p_closer_id)
  on conflict (ghl_contact_id) do update
    set fijada = false,
        completada_dia = v_hoy,
        completada_el  = now(),
        completada_por = p_closer_id,
        actualizado_el = now();

  return query select v_nuevo, v_anterior, v_hoy;
end $function$;

commit;

notify pgrst, 'reload schema';
