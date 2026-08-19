# 01 — Esquema de datos

El SQL completo del sistema de acceso multiempresa. PostgreSQL, listo para copiar y adaptar.

Este documento es autosuficiente: no depende de los otros de la carpeta.

---

## 1 · Convenciones

- **Nombres en singular para la entidad, plural para la tabla**: `organizaciones`, `usuarios`.
- **Claves primarias `uuid`**, generadas por la base. Un entero autoincremental filtra información
  (cuántos clientes tenés, en qué orden se dieron de alta) en cualquier URL o respuesta.
- **`timestamptz` siempre**, nunca `timestamp` sin zona. Un servidor en otra región y una fecha sin
  zona producen errores de un día que aparecen recién en producción.
- **La columna del inquilino se llama igual en todas las tablas**: `org_id`. La capa de aislamiento la
  inyecta por nombre; si en una tabla se llama distinto, esa tabla queda sin aislar.
- Si tu aplicación va a convivir con otras en la misma base, poné un prefijo a todo (`app_usuarios`).

```sql
create extension if not exists pgcrypto;  -- para gen_random_uuid()
```

---

## 2 · Organizaciones

El inquilino. Todo lo demás cuelga de acá.

```sql
create table organizaciones (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  -- Identificador legible para URLs y para hablar de la empresa sin el uuid.
  slug            text not null unique,
  -- Una organización desactivada no opera: sus usuarios no entran y sus tareas
  -- programadas no corren. No se borra, para no perder su historia.
  activa          boolean not null default true,
  -- La organización que administra la plataforma. Hay UNA (ver el índice de abajo).
  es_principal    boolean not null default false,
  zona_horaria    text not null default 'UTC',
  creada_el       timestamptz not null default now(),
  actualizada_el  timestamptz not null default now()
);

-- Exactamente una organización principal. El índice parcial es más simple que un
-- disparador: dos filas con `true` no pueden existir, y el error viene de la base.
create unique index organizaciones_una_principal
  on organizaciones (es_principal) where es_principal;

create index organizaciones_activas on organizaciones (activa) where activa;
```

> **La zona horaria por organización no es un lujo.** Si el producto tiene la noción de "hoy" —una
> cola de trabajo diaria, un reporte del día— ese día lo tiene que calcular la base con la zona de la
> organización, nunca el lenguaje con la zona del servidor. Un servidor en UTC y una empresa en UTC−5
> cambian de día cinco horas antes.

### Por qué existe la organización principal

Alguien tiene que dar de alta a los clientes. Ese alguien vive en una organización, y esa organización
es la de la plataforma. Marcarla explícitamente permite:

- acotar a ella el rol que ve todas las organizaciones, con el disparador de la § 6,
- protegerla de borrado y desactivación (ver § 6),
- y darle un tratamiento distinto en las credenciales de servicios externos, si hace falta.

---

## 3 · Usuarios

```sql
create table usuarios (
  id                     uuid primary key default gen_random_uuid(),
  org_id                 uuid not null references organizaciones(id),
  nombre                 text not null,

  -- Credenciales. Ver el CHECK de abajo: van juntas o no van.
  email                  text,
  password_hash          text,

  activo                 boolean not null default true,
  -- El administrador fundador. Hay UNO y es inmutable en lo que importa (§ 6).
  es_admin_principal     boolean not null default false,
  -- Nace en true con una contraseña temporal; el portero lo encierra hasta que la cambie.
  debe_cambiar_password  boolean not null default false,

  -- Bloqueo por intentos fallidos.
  intentos_fallidos      integer not null default 0,
  bloqueado_hasta        timestamptz,

  ultimo_acceso_el       timestamptz,
  creado_por             uuid references usuarios(id),
  creado_el              timestamptz not null default now(),

  -- Una cuenta tiene email y contraseña, o ninguno de los dos.
  constraint usuarios_credenciales_completas check (
    (email is null and password_hash is null) or
    (email is not null and password_hash is not null)
  )
);

-- Email único SIN importar mayúsculas, y solo cuando existe.
create unique index usuarios_email_unico
  on usuarios (lower(email)) where email is not null;

create unique index usuarios_un_admin_principal
  on usuarios (es_admin_principal) where es_admin_principal;

create index usuarios_por_org on usuarios (org_id);
```

### Las dos restricciones que más conviene copiar

**Email y contraseña van juntas o no van.** Existe porque en un sistema así suele haber usuarios **sin**
acceso: personas que se importaron de otro sistema y solo sirven para atribuir trabajo. Un usuario con
email y sin contraseña sería una cuenta que no puede entrar y nadie sabría por qué; con contraseña y
sin email, una que no se puede identificar.

**El índice de email es `lower(email)` y es parcial.**

- `lower(...)` porque nadie escribe su email igual dos veces, y dos cuentas que difieren solo en
  mayúsculas son un problema de soporte garantizado.
- `where email is not null` es lo que permite convivir con los usuarios sin acceso: sin el `where`,
  todos ellos colisionarían entre sí en el valor nulo.

> **Trampa concreta**: si el índice es sobre `lower(email)`, la consulta del login **tiene que usar la
> misma expresión** (`where lower(email) = lower($1)`). Buscar por la columna cruda funciona solo
> mientras todos los caminos guarden en minúsculas; el día que una carga manual meta una mayúscula,
> esa persona no puede entrar y el mensaje dice "credenciales inválidas".

---

## 4 · Roles y permisos

El modelo extensible. Los roles son **datos**, no un tipo enumerado del código.

```sql
-- El catálogo de capacidades. Una fila por cosa que se puede hacer.
create table permisos (
  clave        text primary key,          -- 'usuarios.crear', 'reportes.ver'
  descripcion  text not null
);

create table roles (
  id           uuid primary key default gen_random_uuid(),
  clave        text not null unique,      -- 'administrador', 'operador'
  nombre       text not null,             -- para mostrar
  descripcion  text,
  -- Un rol de sistema no se puede borrar ni renombrar desde la interfaz.
  es_sistema   boolean not null default false,
  -- Solo puede existir en la organización principal (rol de plataforma).
  solo_principal boolean not null default false,
  creado_el    timestamptz not null default now()
);

create table roles_permisos (
  rol_id       uuid not null references roles(id) on delete cascade,
  permiso      text not null references permisos(clave) on delete cascade,
  primary key (rol_id, permiso)
);

create table usuarios_roles (
  usuario_id   uuid not null references usuarios(id) on delete cascade,
  rol_id       uuid not null references roles(id),
  asignado_el  timestamptz not null default now(),
  asignado_por uuid references usuarios(id),
  primary key (usuario_id, rol_id)
);

create index usuarios_roles_por_usuario on usuarios_roles (usuario_id);
```

### Los permisos efectivos de un usuario, en una consulta

```sql
create or replace view usuarios_permisos as
  -- `distinct` y no `group by` sin agregación: hacen lo mismo (deduplicar), pero
  -- el `group by` sin función de agregado se lee como un error en una revisión.
  select distinct ur.usuario_id, rp.permiso
    from usuarios_roles ur
    join roles_permisos rp on rp.rol_id = ur.rol_id;
```

La unión de los permisos de todos sus roles. **Solo suma, nunca resta**: no hay permisos negativos.

> **Por qué no hay negaciones.** Un modelo con "permitir" y "denegar" necesita reglas de precedencia, y
> esas reglas se vuelven imposibles de razonar en cuanto un usuario tiene tres roles. Si hace falta que
> alguien tenga _casi_ un rol, la respuesta es un rol nuevo con los permisos que corresponden — que con
> este modelo cuesta una fila.

### Si preferís empezar simple

Un arreglo de texto en el usuario, con una restricción de valores:

```sql
alter table usuarios add column roles text[] not null default '{}';
alter table usuarios add constraint usuarios_roles_validos
  check (roles <@ array['superadministrador','administrador','operador','auditor']);
alter table usuarios add constraint usuarios_tope_roles
  check (coalesce(array_length(roles, 1), 0) <= 4);
```

Es menos código y alcanza para arrancar. **El costo aparece cuando llega el primer rol nuevo**: hay que
migrar la restricción y buscar cada comparación de rol en el código.

Para que cambiar de un modelo al otro no toque los endpoints, escribí el portero de forma que reciba
**capacidades** y resuelva internamente cómo obtenerlas del usuario. Con el arreglo de texto, la
resolución es un mapa constante `rol → capacidades`; con las tablas, una consulta. Los endpoints piden
`["usuarios.crear"]` en los dos casos y no se enteran del cambio.

El tope de roles no es una regla de negocio profunda: es un freno contra la cuenta que acumula todo
"por comodidad" y termina pudiendo hacer cualquier cosa.

---

## 5 · Sesiones

```sql
create table sesiones (
  id              uuid primary key default gen_random_uuid(),
  usuario_id      uuid not null references usuarios(id) on delete cascade,
  -- El HASH del token, nunca el token. Ver el documento 02.
  token_hash      text not null unique,
  -- Solo para el rol de plataforma: sobre qué organización está trabajando.
  org_activa      uuid references organizaciones(id) on delete set null,
  -- Vencimiento deslizante: se extiende al usar la sesión.
  expira_el       timestamptz not null,
  -- Techo DURO: la sesión muere a los 30 días de creada aunque se use todos los días.
  -- Sin esto, una sesión usada a diario nunca vence, y un token robado vive para siempre
  -- mientras el ladrón lo siga usando.
  expira_absoluto timestamptz not null default now() + interval '30 days',
  ip              text,
  user_agent      text,
  creada_el       timestamptz not null default now()
);

create index sesiones_por_expiracion on sesiones (expira_el);
create index sesiones_por_usuario    on sesiones (usuario_id);
```

**`on delete cascade` desde el usuario**: borrar un usuario cierra sus sesiones, sin código.

**`on delete set null` en `org_activa`**: si se borra la organización que alguien estaba mirando, la
sesión sobrevive y vuelve a la propia. La alternativa —cascada— cerraría la sesión del administrador
justo cuando acaba de borrar algo, que es el peor momento.

**El índice por expiración** es para el trabajo de limpieza. Aunque no lo escribas hoy, el índice cuesta
nada y evita tener que agregarlo con la tabla ya grande.

---

## 6 · Las invariantes: disparadores

Esto es lo que **no** puede vivir en el backend. Un condicional se saltea con un script, una consola de
administración, un endpoint nuevo o una sentencia a mano. Un disparador no.

### El administrador principal es inmutable en lo que importa

```sql
create or replace function proteger_admin_principal() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if old.es_admin_principal then
      raise exception 'El administrador principal no se puede eliminar (usuario %).', old.id;
    end if;
    return old;
  end if;

  if old.es_admin_principal then
    -- Su CONTRASEÑA sí se puede cambiar: lo inmutable es quién es y qué puede hacer.
    -- Si no se pudiera rotar, una filtración sería permanente.
    if not new.es_admin_principal then
      raise exception 'El administrador principal no se puede degradar (usuario %).', old.id;
    end if;
    if not new.activo then
      raise exception 'El administrador principal no se puede desactivar (usuario %).', old.id;
    end if;
    if lower(coalesce(new.email,'')) is distinct from lower(coalesce(old.email,'')) then
      raise exception 'El email del administrador principal es inmutable (usuario %).', old.id;
    end if;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger usuarios_admin_protegido
  before update or delete on usuarios
  for each row execute function proteger_admin_principal();
```

### La organización principal no se puede apagar

```sql
create or replace function proteger_org_principal() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    if old.es_principal then
      raise exception 'La organización principal no se puede eliminar (org %).', old.id;
    end if;
    return old;
  end if;
  if old.es_principal and not new.es_principal then
    raise exception 'La organización principal no se puede desmarcar (org %).', old.id;
  end if;
  -- Desactivarla equivale a apagar la plataforma entera.
  if old.es_principal and not new.activa then
    raise exception 'La organización principal no se puede desactivar (org %).', old.id;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger organizaciones_protegida
  before update or delete on organizaciones
  for each row execute function proteger_org_principal();
```

### Un rol de plataforma solo existe en la organización principal

Es la barrera contra la **escalada entre inquilinos**: sin ella, el administrador de una empresa
cliente podría otorgarse un rol de plataforma dentro de su propia empresa y con él ver a todas las
demás.

```sql
create or replace function rol_de_plataforma_acotado() returns trigger as $$
declare
  v_org uuid;
  v_solo_principal boolean;
begin
  select org_id into v_org from usuarios where id = new.usuario_id;
  select solo_principal into v_solo_principal from roles where id = new.rol_id;

  if v_solo_principal and not exists (
       select 1 from organizaciones o where o.id = v_org and o.es_principal
     ) then
    raise exception 'Ese rol solo existe en la organización principal (org %).', v_org;
  end if;
  return new;
end;
$$ language plpgsql;

create trigger usuarios_roles_plataforma_acotado
  before insert or update on usuarios_roles
  for each row execute function rol_de_plataforma_acotado();
```

### Tablas de registro: solo insertar

Si alguna tabla es la fuente de un número que alguien va a mirar (dinero, cantidades, auditoría), hacela
**inmutable**. Corregir un error se hace con una fila nueva, como en un libro contable.

```sql
create or replace function evitar_mutacion() returns trigger as $$
begin
  raise exception 'La tabla % es de solo inserción (intento de %).', tg_table_name, tg_op;
end;
$$ language plpgsql;

create trigger auditoria_solo_insercion
  before update or delete on auditoria_accesos
  for each row execute function evitar_mutacion();
```

---

## 7 · Auditoría

```sql
create table auditoria_accesos (
  id           bigserial primary key,
  -- Nullable a propósito: un intento con un email inexistente no tiene usuario,
  -- y ése es justo el evento que hay que poder investigar.
  usuario_id   uuid,
  org_id       uuid,
  accion       text not null,     -- 'login' | 'login_fallido' | 'usuario_creado' | …
  -- El motivo real y el contexto. NUNCA una contraseña, ni la fallida.
  detalle      jsonb,
  ip           text,
  creado_el    timestamptz not null default now()
);

create index auditoria_por_fecha on auditoria_accesos (creado_el desc);
create index auditoria_por_org   on auditoria_accesos (org_id, creado_el desc);
-- Si el freno por IP se cuenta sobre esta tabla, necesita SU PROPIO índice:
create index auditoria_por_ip_accion on auditoria_accesos (ip, accion, creado_el desc);
```

> **El tercer índice es la trampa.** Es habitual contar los intentos fallidos por IP sobre esta tabla
> para no crear otra. Funciona bien y evita una dependencia — pero si los índices son solo por fecha y
> por organización, esa consulta hace un recorrido completo **en cada intento de login**. Con la tabla
> chica no se nota; con cien mil filas, sí.

**La contraseña nunca se registra, ni la fallida.** Un registro de contraseñas fallidas es un
diccionario de contraseñas reales de tus usuarios, con sus emails al lado.

---

## 8 · La columna del inquilino en las tablas de negocio

Cada tabla de datos de la aplicación lleva:

```sql
org_id uuid not null references organizaciones(id)
```

Y un índice que la incluya **primero** en las consultas frecuentes:

```sql
create index pedidos_por_org_fecha on pedidos (org_id, creado_el desc);
```

**El orden importa**: con `(creado_el, org_id)` la base recorre todas las organizaciones antes de
filtrar. Con `(org_id, creado_el)` va directo.

### Las claves foráneas dentro del inquilino

Hay un error sutil que conviene evitar desde el principio. Si `pedidos.usuario_id` referencia
`usuarios(id)` a secas, **nada impide** que un pedido de la organización A apunte a un usuario de la B.
La base lo acepta: el id existe.

Para cerrarlo, la referencia tiene que ser al **par**:

```sql
-- En la tabla referenciada, una clave única compuesta:
alter table usuarios add constraint usuarios_org_id_unico unique (org_id, id);

-- Y en la que referencia, la foránea compuesta:
alter table pedidos
  add constraint pedidos_usuario_de_la_misma_org
  foreign key (org_id, usuario_id) references usuarios (org_id, id);
```

> Esto pasó de verdad en un sistema construido con este diseño: una función firmaba registros con el
> identificador de una persona de **otra** organización, y nunca falló nada, porque la clave foránea
> apuntaba solo al `id`. Con la foránea compuesta, ese error no compila en la base.

---

## 9 · Seguridad a nivel de fila

Si tu proveedor de base de datos expone una API pública con una clave que viaja al navegador —muchos lo
hacen— **hay que asumir que esa clave es pública**. Cualquiera la lee del código de la página.

```sql
alter table usuarios enable row level security;
revoke all on usuarios from public;
-- Y de todo rol que pueda llegar desde el navegador. Los nombres dependen del
-- proveedor: algunos crean roles como `anon` y `authenticated`; en un Postgres
-- puro no existen y hay que revocar del rol que uses para el acceso público.
-- Repetir para TODAS las tablas.
```

> **Esto NO alcanza por sí solo, y es el malentendido más caro de este esquema.** Si la aplicación se
> conecta con el rol **propietario** de las tablas, o con un rol que tenga el atributo de omisión, las
> políticas de seguridad a nivel de fila **no se le aplican**: la protección existe en el esquema y no
> protege de nada. Hace falta un rol dedicado y políticas que filtren por una variable de sesión. Está
> resuelto en el documento `08`, que es de lectura obligatoria antes de confiar en esta sección.

Es la **segunda capa**, y las dos hacen falta: la capa de la aplicación que inyecta el filtro por
organización protege de los errores del propio código; esto protege de que alguien saltee el código
entero.

Convertilo en un paso obligatorio de cada migración: **toda tabla nueva nace con la seguridad activada y
los permisos revocados**. Es más fácil como hábito que como auditoría.

---

## 10 · Datos iniciales

El catálogo mínimo para arrancar. Los nombres son de ejemplo: poné los de tu dominio.

```sql
insert into permisos (clave, descripcion) values
  ('organizaciones.crear',    'Dar de alta organizaciones'),
  ('organizaciones.editar',   'Editar cualquier organización'),
  ('usuarios.ver',            'Ver los usuarios de su organización'),
  ('usuarios.crear',          'Crear usuarios en su organización'),
  ('usuarios.editar',         'Editar usuarios de su organización'),
  ('usuarios.desactivar',     'Desactivar usuarios de su organización'),
  ('roles.asignar',           'Asignar y quitar roles'),
  ('credenciales.ver',        'Ver el estado de las credenciales (enmascaradas)'),
  ('credenciales.editar',     'Cargar y rotar credenciales'),
  ('configuracion.editar',    'Editar la configuración de su organización'),
  ('auditoria.ver',           'Ver el registro de accesos');

insert into roles (clave, nombre, es_sistema, solo_principal) values
  ('superadministrador', 'Superadministrador', true, true),
  ('administrador',      'Administrador',      true, false);

-- El superadministrador recibe todo.
insert into roles_permisos (rol_id, permiso)
  select r.id, p.clave from roles r, permisos p where r.clave = 'superadministrador';

-- El administrador, todo lo de su organización.
insert into roles_permisos (rol_id, permiso)
  select r.id, p.clave from roles r, permisos p
   where r.clave = 'administrador'
     and p.clave not like 'organizaciones.%';
```

Los roles de operación (los que usa la gente para trabajar) **no** van acá: dependen del producto y se
crean cuando exista el producto. Eso es exactamente lo que este modelo permite hacer sin tocar código.
