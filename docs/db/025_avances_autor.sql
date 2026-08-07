-- 025 · Quién registró cada Avanzar (2026-08-07)
--
-- `closer_avances` es la fuente de verdad del dinero —cash collected, ventas del mes, "sobre la
-- mesa"— y **no tiene columna de autor**. Sus columnas son id, ghl_contact_id, salida, detalle,
-- tags_enviados y created_at: se sabe QUÉ pasó y CUÁNDO, nunca QUIÉN.
--
-- Con un solo closer eso no se notaba: todo era de Jorge. Con cinco empresas y varios closers por
-- empresa, la sección Equipo del panel de Estadísticas no tiene con qué calcularse — y su versión
-- inventada es justamente lo que hay que reemplazar.
--
-- ── Por qué el autor y no solo el closer ────────────────────────────────────
--
-- `autor_usuario_id` y no `closer_id`: quien registra un Avanzar puede ser un closer, un setter
-- (las 5 salidas de pre-agenda) o un admin corrigiendo. Una columna llamada `closer_id` habría
-- forzado a mentir en dos de los tres casos, y el día que el setter escriba de verdad
-- (`api/setter/` hoy solo tiene `urgentes.ts`) la mentira ya estaría en los datos históricos.
--
-- ── Nullable, y no va a dejar de serlo ──────────────────────────────────────
--
-- Las filas anteriores a esta migración **no tienen autor y no se puede inventar**. Ponerles el
-- id de Jorge sería fabricar un hecho: probable no es medido (regla §4.2 — un valor medido y uno
-- no medido no son el mismo hecho). El panel las cuenta en los totales y las excluye del desglose
-- por persona, diciéndolo.
--
-- Por el mismo motivo no lleva `not null` con default: un default acá le pondría autor a filas
-- viejas en silencio, que es el problema que la columna existe para no tener.
--
-- ── `on delete set null` y no `restrict` ────────────────────────────────────
--
-- Distinto del criterio de la 022, donde las FK son `restrict`. Acá el dato que importa es la
-- venta, no quién la cargó: si algún día se borra un usuario, perder la atribución es aceptable y
-- perder el registro del dinero no lo es. Es la misma decisión que ya tomó
-- `closer_auditoria_accesos.usuario_id`.

alter table public.closer_avances
  add column if not exists autor_usuario_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'closer_avances_autor_fk'
  ) then
    alter table public.closer_avances
      add constraint closer_avances_autor_fk
      foreign key (autor_usuario_id) references public.closer_usuarios(id) on delete set null;
  end if;
end $$;

-- El desglose por persona filtra por empresa y agrupa por autor en un rango de fechas. Sin este
-- índice, cada carga del panel es un seq scan sobre el timeline entero.
create index if not exists closer_avances_autor_idx
  on public.closer_avances (org_id, autor_usuario_id, created_at desc);

comment on column public.closer_avances.autor_usuario_id is
  'Quién registró este Avanzar. NULL en las filas anteriores al 2026-08-07, cuando no había '
  'sesión: no se rellenó a propósito — probable no es medido. El panel las cuenta en los totales '
  'y las excluye del desglose por persona.';

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
