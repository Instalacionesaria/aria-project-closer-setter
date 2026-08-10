-- 035 · Los defaults de `closer_registrar_seguimiento` (2026-08-08)
--
-- La función tenía doce parámetros y siete valores por defecto. Dos de esos siete convertían un
-- olvido del llamador en un dato falso:
--
--   · `p_org_id DEFAULT '00000000-…-0001'` — quien se olvidara del parámetro **escribía en ARIA
--     en silencio**. Con una sola empresa era inofensivo; con cinco es una fuga entre clientes que
--     no falla, no avisa y no deja rastro de haber ocurrido. Es exactamente el agujero que `db()`
--     cierra en el resto del sistema, abierto acá por una función que precede al multi-empresa.
--   · `p_autor_nombre DEFAULT 'Usuario Activo'` — un nombre que no es de nadie, firmando el
--     historial de un contacto real.
--
-- ── Por qué se van los siete y no solo los dos ────────────────────────────
--
-- Postgres no admite un parámetro sin default después de uno que lo tenga. `p_org_id` y
-- `p_autor_nombre` son los dos últimos, así que quitarles el default obliga a quitárselo también a
-- los cinco anteriores. No es un daño colateral: el único llamador
-- (`api/_lib/seguimientos.ts:538-549`) ya pasa los doce explícitamente —verificado antes de
-- aplicar esto— así que ningún default se estaba usando. Eran valores esperando un llamador
-- distraído.
--
-- Un llamador que ahora olvide un parámetro **falla ruidoso** con "function does not exist", que es
-- lo que hay que ver. Misma decisión que tomó la `028` con el modelo del auditor: fallar cerrado en
-- vez de adivinar.
--
-- ── El cuerpo no se transcribió a mano ────────────────────────────────────
--
-- Se generó con `pg_get_functiondef()` sobre la función viva y se le quitaron los DEFAULT de la
-- firma, sin tocar una línea del cuerpo. Copiar 60 líneas de plpgsql a mano para cambiar la primera
-- es la forma más fácil de introducir un cambio que nadie pidió.
--
-- ── Por qué DROP y no CREATE OR REPLACE ───────────────────────────────────
--
-- Postgres lo rechaza: `42P13 cannot remove parameter defaults from existing function`. Quitar un
-- default exige dropear. Va todo en un solo batch, que el endpoint corre en una transacción: la
-- función nunca deja de existir para un llamador concurrente.
--
-- **Y por eso hay un `grant` al final.** Un DROP se lleva el ACL con la función, y el ACL de ésta
-- no era el default: era `{postgres=X, service_role=X}`, o sea con `public`, `anon` y
-- `authenticated` explícitamente revocados por la `010`. Recrearla sin reponer eso la dejaría
-- ejecutable por PUBLIC — y la `anon key` viaja en el bundle del browser. Sería cambiar un agujero
-- de aislamiento por uno peor, en la misma migración que vino a cerrar el primero.

drop function if exists public.closer_registrar_seguimiento(
  text, uuid, closer_situacion_seguimiento, closer_modo_seguimiento, date,
  text, text, smallint, smallint, text, text, uuid);

CREATE FUNCTION public.closer_registrar_seguimiento(p_ghl_contact_id text, p_closer_id uuid, p_situacion closer_situacion_seguimiento, p_modo closer_modo_seguimiento, p_fecha_objetivo date, p_nota text, p_serie_key text, p_serie_toques smallint, p_serie_dias smallint, p_texto_evento text, p_autor_nombre text, p_org_id uuid)
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

-- El ACL que el DROP se llevó. Con los tipos explícitos: la firma es lo único que la identifica.
revoke all on function public.closer_registrar_seguimiento(
  text, uuid, closer_situacion_seguimiento, closer_modo_seguimiento, date,
  text, text, smallint, smallint, text, text, uuid) from public, anon, authenticated;
grant execute on function public.closer_registrar_seguimiento(
  text, uuid, closer_situacion_seguimiento, closer_modo_seguimiento, date,
  text, text, smallint, smallint, text, text, uuid) to service_role;

notify pgrst, 'reload schema';
