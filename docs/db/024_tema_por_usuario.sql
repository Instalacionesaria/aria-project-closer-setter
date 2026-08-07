-- 024 · La preferencia de tema, por usuario (2026-08-07)
--
-- Hasta ahora el modo oscuro era `useState(false)` en App.tsx: se perdía en cada recarga y no
-- era de nadie. Fabio pidió que cada usuario tenga la suya.
--
-- ── Por qué en la base y no solo en localStorage ─────────────────────────────
--
-- localStorage es por navegador, no por persona. Dos cosas lo rompen: el equipo entra desde más
-- de una máquina, y una misma máquina la usan dos personas distintas — con la preferencia en
-- localStorage, el tema de quien entró último se le aplicaría al siguiente. En la fila del
-- usuario viaja con la cuenta.
--
-- (El front igual guarda una copia en localStorage, pero solo para pintar el tema correcto en el
-- primer frame, antes de que la sesión resuelva. La fuente de verdad es esta columna.)
--
-- ── Por qué nullable y no `default 'claro'` ──────────────────────────────────
--
-- `null` significa "nunca eligió" y es distinto de "eligió claro". Hoy los dos se ven igual,
-- pero el día que se agregue "seguir al sistema" como default, un `default 'claro'` escrito en
-- 30 filas sería indistinguible de 30 personas que eligieron claro a mano. Es la regla §4.2: un
-- valor medido y uno no medido no son el mismo hecho.

alter table public.closer_usuarios
  add column if not exists tema text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'closer_usuarios_tema_valido'
  ) then
    alter table public.closer_usuarios
      add constraint closer_usuarios_tema_valido
      check (tema is null or tema in ('claro', 'oscuro'));
  end if;
end $$;

comment on column public.closer_usuarios.tema is
  'Preferencia de tema del usuario: claro | oscuro. null = nunca eligió (se usa claro). '
  'La escribe POST /api/auth/sesion?accion=tema y la lee el GET de ese mismo endpoint.';

-- Sin esto el primer UPDATE falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
