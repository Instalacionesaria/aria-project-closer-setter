-- 023 — Autenticación: cuentas, sesiones y auditoría de accesos (ESPEC-MULTIEMPRESA §3 y §4).
--
-- ── `closer_usuarios` se EXTIENDE, no se recrea ───────────────────────
--
-- La especificación §2.1 la proponía como tabla nueva. Ya existe desde la 001, con una fila
-- (Jorge Q.) y **7 claves foráneas apuntándole** desde `closer_seguimientos` (×3),
-- `closer_contacto_tarea`, `closer_contacto_eventos`, `closer_conexiones` y `closer_notas`.
-- Recrearla obligaría a reapuntar las siete y a migrar la fila; extenderla no cuesta nada.
--
-- ── Una fila de usuario no es lo mismo que una cuenta ─────────────────
--
-- `email` y `password_hash` nacen NULLABLE, contra lo que decía la spec. El motivo: la fila
-- que ya existe es un registro de **atribución** —a quién se le imputa un seguimiento, quién
-- firmó una nota— y no una cuenta con la que alguien entra. Ponerlos `not null` obligaría a
-- inventarle un email a Jorge, que es justo el tipo de dato falso que este proyecto evita.
--
-- Un CHECK garantiza lo que sí importa: **email y contraseña van juntos o no van**. No puede
-- existir una cuenta a medias con la que se pueda intentar entrar.

begin;

/* ═══════════════ closer_usuarios: las columnas de cuenta ═══════════════ */

alter table public.closer_usuarios
  add column if not exists email                 text,
  add column if not exists password_hash         text,
  add column if not exists roles                 text[] not null default '{}',
  add column if not exists es_admin_principal    boolean not null default false,
  add column if not exists debe_cambiar_password boolean not null default false,
  add column if not exists intentos_fallidos     integer not null default 0,
  add column if not exists bloqueado_hasta       timestamptz,
  add column if not exists ultimo_acceso_el      timestamptz,
  add column if not exists creado_por            uuid references public.closer_usuarios(id);

-- Único GLOBAL y no por empresa (§2.1): un email identifica a una persona, y la misma persona
-- no puede tener cuenta en dos empresas sin que el login sea ambiguo.
create unique index if not exists closer_usuarios_email_unico
  on public.closer_usuarios (lower(email)) where email is not null;

alter table public.closer_usuarios drop constraint if exists closer_usuarios_cuenta_completa;
alter table public.closer_usuarios add constraint closer_usuarios_cuenta_completa
  check ((email is null and password_hash is null) or (email is not null and password_hash is not null));

-- Hasta 4 roles simultáneos (§3.1). El backend lo valida además en el endpoint, pero acá es
-- donde no se puede esquivar.
alter table public.closer_usuarios drop constraint if exists closer_usuarios_tope_roles;
alter table public.closer_usuarios add constraint closer_usuarios_tope_roles
  check (coalesce(array_length(roles, 1), 0) <= 4);

alter table public.closer_usuarios drop constraint if exists closer_usuarios_roles_validos;
alter table public.closer_usuarios add constraint closer_usuarios_roles_validos
  check (roles <@ array['super_admin', 'admin', 'closer', 'setter', 'tecnico', 'media_buyer']::text[]);

create unique index if not exists closer_usuarios_un_admin_principal
  on public.closer_usuarios (es_admin_principal) where es_admin_principal;

create index if not exists idx_usuarios_org on public.closer_usuarios (org_id);

/* ── `rol` (texto) → `roles[]` ── */
--
-- Se migra el valor y la columna vieja **se deja quieta**, marcada como muerta. Mismo criterio
-- que D5 con `bot_estado`/`cita_el`/`cita_meet_url`: un DROP vuelve a disparar el problema del
-- schema cache de PostgREST sin ninguna ganancia, y acá además el `rol` viejo es el único
-- registro de cómo estaba configurado el usuario antes de la migración.

update public.closer_usuarios
   set roles = array[rol]
 where rol is not null
   and coalesce(array_length(roles, 1), 0) = 0
   and rol = any (array['super_admin', 'admin', 'closer', 'setter', 'tecnico', 'media_buyer']);

-- Y deja de ser obligatoria. Una columna muerta que sigue siendo `not null` no es inofensiva:
-- obliga a cada INSERT nuevo a inventarle un valor a un campo que nadie lee. Lo descubrió el
-- alta del super admin, que reventó con 23502 sobre `rol`.
alter table public.closer_usuarios alter column rol drop not null;

comment on column public.closer_usuarios.rol is
  'MUERTA desde la 023 — su valor se migró a `roles[]`. No se dropea (D5: el DROP redispara '
  'el schema cache de PostgREST) pero sí deja de ser obligatoria. Nadie la lee.';

/* ═══════════════ Guards: en la base, no en el código (§2.2) ═══════════════ */

create or replace function public.closer_proteger_admin_principal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.es_admin_principal then
      raise exception 'El admin principal no se puede eliminar (usuario %).', old.id;
    end if;
    return old;
  end if;

  if old.es_admin_principal then
    -- Su contraseña SÍ se puede cambiar (§2.2.2). Lo inmutable es quién es y qué puede hacer.
    if not new.es_admin_principal then
      raise exception 'El admin principal no se puede degradar (usuario %).', old.id;
    end if;
    if not new.activo then
      raise exception 'El admin principal no se puede desactivar (usuario %).', old.id;
    end if;
    if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then
      raise exception 'El email del admin principal es inmutable (usuario %).', old.id;
    end if;
    if not ('super_admin' = any (new.roles)) then
      raise exception 'Al admin principal no se le puede quitar el rol super_admin (usuario %).', old.id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists closer_usuarios_admin_protegido on public.closer_usuarios;
create trigger closer_usuarios_admin_protegido
  before update or delete on public.closer_usuarios
  for each row execute function public.closer_proteger_admin_principal();

-- `super_admin` solo existe en la empresa principal (§3.1). Sin esto, un admin de una empresa
-- cliente que consiguiera escribir el rol vería los datos de todas.
create or replace function public.closer_super_admin_solo_principal()
returns trigger
language plpgsql
as $$
begin
  if 'super_admin' = any (new.roles)
     and not exists (select 1 from public.closer_org_config o
                      where o.org_id = new.org_id and o.es_principal) then
    raise exception 'El rol super_admin solo existe en la empresa principal (org %).', new.org_id;
  end if;
  return new;
end;
$$;

drop trigger if exists closer_usuarios_super_admin_acotado on public.closer_usuarios;
create trigger closer_usuarios_super_admin_acotado
  before insert or update on public.closer_usuarios
  for each row execute function public.closer_super_admin_solo_principal();

/* ═══════════════ Sesiones ═══════════════ */
--
-- En la base va **solo el SHA-256 del token** (§4.2). Una filtración de esta tabla no permite
-- suplantar a nadie: el token crudo solo existe en la cookie del navegador y en memoria
-- durante el request que lo valida.

create table if not exists public.closer_sesiones (
  id             uuid primary key default gen_random_uuid(),
  usuario_id     uuid not null references public.closer_usuarios(id) on delete cascade,
  token_hash     text not null unique,
  -- Para el selector de empresa del super admin (§7.1). Null = la empresa del usuario.
  empresa_activa uuid references public.closer_org_config(org_id) on delete set null,
  expira_el      timestamptz not null,
  ip             text,
  user_agent     text,
  creada_el      timestamptz not null default now()
);

create index if not exists idx_sesiones_usuario on public.closer_sesiones (usuario_id);
-- Para el barrido de expiradas sin escanear la tabla.
create index if not exists idx_sesiones_expira  on public.closer_sesiones (expira_el);

/* ═══════════════ Auditoría de accesos ═══════════════ */
--
-- `detalle` NUNCA lleva secretos, ni siquiera cifrados (§2.1). Tampoco contraseñas, ni
-- siquiera las fallidas: registrar el intento fallido junto con lo que se tipeó es la forma
-- más común de terminar con contraseñas reales en una tabla de logs.

create table if not exists public.closer_auditoria_accesos (
  id         bigserial primary key,
  usuario_id uuid references public.closer_usuarios(id) on delete set null,
  org_id     uuid references public.closer_org_config(org_id) on delete set null,
  accion     text not null,
  detalle    jsonb,
  ip         text,
  creado_el  timestamptz not null default now()
);

create index if not exists idx_auditoria_fecha on public.closer_auditoria_accesos (creado_el desc);
create index if not exists idx_auditoria_org   on public.closer_auditoria_accesos (org_id, creado_el desc);

comment on column public.closer_auditoria_accesos.detalle is
  'NUNCA secretos ni contraseñas, ni siquiera cifrados ni fallidos.';
comment on column public.closer_auditoria_accesos.usuario_id is
  'Nullable: un login fallido contra un email inexistente no tiene usuario, y se registra igual.';

/* ═══════════════ RLS y grants ═══════════════ */

alter table public.closer_sesiones           enable row level security;
alter table public.closer_auditoria_accesos  enable row level security;
revoke all on public.closer_sesiones          from anon, authenticated;
revoke all on public.closer_auditoria_accesos from anon, authenticated;
revoke all on sequence public.closer_auditoria_accesos_id_seq from anon, authenticated;

commit;

notify pgrst, 'reload schema';
