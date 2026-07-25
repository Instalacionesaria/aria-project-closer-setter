-- ============================================================================
-- Migración 003 · `closer_registrar_seguimiento()`
--
-- Registrar un seguimiento son cuatro escrituras: cerrar el anterior, crear el nuevo,
-- escribir el historial y marcar la tarea del día como completada. Hacerlas desde Node con
-- supabase-js son cuatro round trips SIN transacción, y el modo de fallo es feo: si la
-- creación falla después de haber cerrado el anterior, el contacto se queda sin ningún
-- seguimiento y nadie se entera.
--
-- Además hay un problema de orden que no se puede esquivar desde afuera:
--
--   - El índice parcial único impide tener dos seguimientos abiertos, así que hay que
--     cerrar el viejo ANTES de insertar el nuevo.
--   - Pero el CHECK `reemplazo_coherente` exige que `estado='reemplazado'` venga junto con
--     `reemplazado_por`, y ese id no existe hasta que el nuevo esté insertado.
--
-- Se resuelve en tres pasos dentro de UNA transacción: cerrar como `cancelado` para
-- liberar el índice, insertar, y recién entonces marcar el viejo como `reemplazado`
-- apuntando al nuevo — las dos columnas en el mismo UPDATE, que es lo que el CHECK pide.
-- ============================================================================

create or replace function closer_registrar_seguimiento(
  p_ghl_contact_id text,
  p_closer_id      uuid,
  p_situacion      closer_situacion_seguimiento,
  p_modo           closer_modo_seguimiento,
  p_fecha_objetivo date,
  p_nota           text        default null,
  p_serie_key      text        default null,
  p_serie_toques   smallint    default null,
  p_serie_dias     smallint    default null,
  p_texto_evento   text        default 'Seguimiento registrado',
  p_autor_nombre   text        default 'Usuario Activo',
  p_org_id         uuid        default '00000000-0000-0000-0000-000000000001'
) returns table (seguimiento_id uuid, reemplazo_id uuid, hoy date)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_anterior uuid;
  v_nuevo    uuid;
  v_hoy      date := closer_hoy_org();
begin
  -- 1. Liberar el índice parcial único. `cancelado` es un estado válido con su motivo;
  --    si algo falla más abajo, toda la transacción se revierte y el viejo sigue abierto.
  select id into v_anterior
    from closer_seguimientos
   where ghl_contact_id = p_ghl_contact_id
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
end $$;

comment on function closer_registrar_seguimiento is
  'Registra un seguimiento de forma atómica: cierra el anterior, crea el nuevo, escribe historial y completa la tarea del día.';

-- `security definer` con `search_path` fijo: la función corre con los permisos de su dueño,
-- así que puede escribir en tablas con RLS sin políticas. El `set search_path = public`
-- evita que un search_path manipulado la redirija a otras tablas.
revoke all on function closer_registrar_seguimiento from public, anon, authenticated;
grant execute on function closer_registrar_seguimiento to service_role;
