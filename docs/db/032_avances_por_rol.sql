-- 032 · El Avanzar del setter entra a `closer_avances` (2026-08-08)
--
-- Hasta hoy ninguna acción de un setter llegaba a la base: su Avanzar era una mutación de
-- `useState` en el browser. O sea que el módulo entero estaba **fuera del aislamiento entre
-- empresas** — no porque tuviera un agujero, sino porque nunca tocaba una tabla con `org_id`.
--
-- ── Por qué la misma tabla y no `closer_avances_setter` ────────────────────
--
-- Porque Estadísticas tiene que seguir siendo UNA query. El revenue del negocio es la suma de las
-- ventas high-ticket del closer y las low-ticket del setter; con dos tablas, cada métrica pasa a
-- ser un UNION o se duplica, y dos implementaciones del mismo hecho divergen en silencio. Es la
-- regla 3 de CLAUDE.md, y acá se paga cara: el número que diverge es plata.
--
-- El costo de la decisión es un CHECK más complejo. Se acepta porque el CHECK **no depende de que
-- nadie se acuerde**: hace inescribible un par (rol, salida) inválido, igual que la `031` hizo
-- imposible un `nivel='rojo'` con `fallo=false`. Un Avanzar de setter con `salida='no_show'` no
-- entra ni a mano.
--
-- ── Por qué `default 'closer'` y no un UPDATE de backfill ──────────────────
--
-- `closer_avances` tiene el trigger `closer_avances_inmutable`, que aborta **todo** UPDATE con un
-- `raise exception` incondicional. Un `update closer_avances set rol='closer'` no rellenaría nada:
-- reventaría la transacción entera, y con un mensaje que ni siquiera habla de esta columna.
--
-- La salida es la que ya documentó la `019` para el mismo problema: `add column ... not null
-- default '<constante>'` es DDL, no dispara triggers de fila, y en PG 11+ un default constante ni
-- siquiera reescribe la tabla. Las filas viejas quedan en `'closer'`, que es exactamente lo que
-- son: hasta hoy no existía otra cosa.
--
-- ── `atribucion_setter_id`, el latch que faltaba persistir ─────────────────
--
-- `atribucionSetter` existe hace tiempo en el store del browser y se enciende con la primera
-- intervención manual del setter — pero se escribe en seis lugares y **no se lee en ninguno**, así
-- que muere al refrescar. Y el espejo del lado del closer nunca se asignó, que es la razón exacta
-- por la que `api/estadisticas.ts` manda los cuatro indicadores de automatización en `sinDato`.
--
-- Persistirlo acá —en el contacto, no en el avance— es lo que permite la pregunta que hoy no se
-- puede hacer: *"de las ventas high-ticket de este mes, ¿cuáles venían de un lead que un setter
-- trabajó a mano?"*. Es el dato que destraba las comisiones diferidas del cockpit.
--
-- Nullable y sin backfill, mismo criterio que `closer_avances.autor_usuario_id` en la `025`: los
-- contactos que ya existen no tienen setter conocido, y adivinarle uno sería inventar la
-- atribución de una venta.

/* ── 1. El discriminador de rol ─────────────────────────────────────────── */

alter table public.closer_avances
  add column if not exists rol text not null default 'closer';

alter table public.closer_avances
  drop constraint if exists closer_avances_salida_check;

alter table public.closer_avances
  drop constraint if exists closer_avances_rol_salida_check;

/**
 * Las dos listas son distintas a propósito y no se solapan salvo en `seguimiento` y `nurture`,
 * que los dos roles tienen porque son la misma acción del negocio.
 */
alter table public.closer_avances
  add constraint closer_avances_rol_salida_check check (
    (rol = 'closer' and salida in
      ('venta', 'acordo', 'seguimiento', 'no_show', 'no_interesa', 'nurture'))
    or
    (rol = 'setter' and salida in
      ('agendo', 'venta_lt', 'seguimiento', 'no_califica', 'nurture'))
  );

comment on column public.closer_avances.rol is
  'Quién registró el avance: closer | setter. Gobierna qué salidas son válidas (CHECK compuesto).';

-- El cockpit del setter y Estadísticas filtran por (org, rol) sobre una ventana de fechas.
create index if not exists closer_avances_rol_idx
  on public.closer_avances (org_id, rol, created_at desc);

/* ── 2. La atribución setter → contacto ─────────────────────────────────── */

alter table public.closer_contactos
  add column if not exists atribucion_setter_id uuid;

alter table public.closer_contactos
  drop constraint if exists closer_contactos_atribucion_setter_fk;

/**
 * `on delete set null` y no `restrict`: si un setter se borra, sus contactos siguen existiendo y
 * el trabajo hecho no se pierde — lo que se pierde es a quién atribuirlo, que es la verdad.
 * `restrict` impediría dar de baja a alguien que alguna vez trabajó un lead.
 */
alter table public.closer_contactos
  add constraint closer_contactos_atribucion_setter_fk
  foreign key (atribucion_setter_id) references public.closer_usuarios (id) on delete set null;

comment on column public.closer_contactos.atribucion_setter_id is
  'El setter que trabajó este lead a mano. null = ninguno lo tocó, o es anterior a la 032.';

-- Para "las ventas HT de este mes con atribución": se filtra por empresa y se agrupa por setter.
create index if not exists closer_contactos_atribucion_idx
  on public.closer_contactos (org_id, atribucion_setter_id)
  where atribucion_setter_id is not null;

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
