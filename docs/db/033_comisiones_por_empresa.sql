-- 033 · El porcentaje de comisión sale del localStorage (2026-08-08)
--
-- Vivía en `settingsStore` bajo la clave `comando-central:ajustes`, o sea **por navegador**. Dos
-- admins de la misma empresa podían ver porcentajes distintos del mismo closer, y ninguno de los
-- dos estaba equivocado: cada uno leía su propio blob. Ese número multiplica plata cobrada.
--
-- ── Indexada por `usuario_id`, no por nombre ───────────────────────────────
--
-- El mapa de hoy es `Record<string, number>` con el **nombre** de la persona como clave
-- (`comisiones["Jorge Q."]`). Eso tiene una consecuencia que nadie notaría hasta el día de pago:
-- **renombrar a un usuario le borra su comisión en silencio** — la fila del panel se arma desde
-- `closer_usuarios`, así que aparece con el nombre nuevo y el porcentaje vacío, y nada falla.
--
-- Con la FK, renombrar es renombrar.
--
-- ── Tabla y no una columna jsonb en `closer_org_config` ────────────────────
--
-- Un `comisiones jsonb` habría sido menos migración y una lectura menos. Se descartó por dos
-- motivos: `closer_org_config` no tiene hoy ni una columna jsonb —son todas escalares— y, sobre
-- todo, Estadísticas necesita **cruzar** el porcentaje con las ventas por persona. Con jsonb eso
-- se resuelve en Node trayendo el blob entero; con una tabla es un join.
--
-- ── Los tres tramos ────────────────────────────────────────────────────────
--
--   closer            · % sobre el cash collected del closer
--   setter_lt         · % directa: low-ticket que vende el setter él mismo
--   setter_diferida   · % sobre el high-ticket que cierra el closer sobre un lead que el setter
--                       originó o rescató (ver `atribucion_setter_id`, migración 032)
--
-- Una persona puede tener los tres a la vez: los roles no son excluyentes en este producto y un
-- mismo usuario puede ser closer y setter.
--
-- **No hay default.** Una comisión sin cargar es `null`, no `0`: un 0% afirma que esa persona no
-- cobra comisión, y eso es un hecho distinto de "todavía no lo configuraron". El panel muestra el
-- campo vacío con su placeholder, nunca un cero inventado.

create table if not exists public.closer_comisiones (
  org_id      uuid not null references public.closer_org_config (org_id) on delete restrict,
  usuario_id  uuid not null references public.closer_usuarios (id) on delete cascade,
  tipo        text not null check (tipo in ('closer', 'setter_lt', 'setter_diferida')),
  /**
   * `numeric(5,2)`: hasta 999,99 con dos decimales. El CHECK acota a un porcentaje real —
   * un 150% de comisión no es un caso de negocio, es un tipeo, y conviene que reviente al
   * escribirlo y no al calcular el pago.
   */
  pct         numeric(5,2) not null check (pct >= 0 and pct <= 100),
  actualizado_el   timestamptz not null default now(),
  actualizado_por  uuid references public.closer_usuarios (id) on delete set null,

  -- Un solo porcentaje por persona y tipo dentro de una empresa. Es también la clave del upsert.
  primary key (org_id, usuario_id, tipo)
);

/**
 * `on delete cascade` sobre el usuario, a diferencia del `restrict` de la empresa: la comisión no
 * es un registro histórico —el histórico son los avances, que son inmutables— sino la
 * configuración vigente de alguien. Si esa persona ya no está, su configuración tampoco.
 */

comment on table public.closer_comisiones is
  'El % de comisión por persona y tramo, por empresa. Reemplaza el mapa en localStorage (033).';

-- La lectura real es "dame todas las comisiones de esta empresa": la PK ya la cubre por prefijo.

alter table public.closer_comisiones enable row level security;
revoke all on public.closer_comisiones from anon, authenticated;

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
