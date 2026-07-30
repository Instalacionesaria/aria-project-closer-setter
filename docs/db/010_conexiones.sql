-- ============================================================================
-- Migración 010 · Credenciales configurables por organización
--
-- ── Qué resuelve ──
--
-- Hoy las credenciales viven en variables de entorno de Vercel: cambiar la API key de
-- Anthropic o el PIT de GHL exige entrar al dashboard de Vercel y volver a desplegar. El
-- pedido es poder cambiarlas desde Ajustes, y que más adelante cada cliente ponga las
-- suyas.
--
-- ── Por qué NO en localStorage (la razón de que esta tabla exista) ──
--
-- La app renderiza conversaciones de GHL —texto escrito por terceros— en el mismo origen
-- que el resto de la aplicación. Cualquier script que se cuele por ahí lee `localStorage`
-- entero, sin importar qué clave use cada dato. Y lo que se filtraría no es poca cosa:
--
--   * Un Private Integration Token de GHL da acceso a TODA la subcuenta del cliente:
--     contactos, conversaciones, oportunidades. No es una llave de "este módulo".
--   * Una API key de Anthropic filtrada la factura el dueño de la cuenta, y el gasto no
--     tiene techo hasta que alguien la revoca.
--
-- Por eso la credencial entra por el backend, se guarda acá y NUNCA vuelve al browser. El
-- endpoint `api/closer/conexiones.ts` devuelve como mucho los últimos 4 caracteres, y esta
-- tabla está diseñada para que eso sea barato de cumplir (ver "columnas espejo" abajo).
--
-- ── Cómo se identifica la organización sin autenticación ──
--
-- Hoy no hay login, y el usuario pidió explícitamente no implementarlo todavía. La org es
-- una constante del servidor: `ORG_ID` en `api/_lib/repo.ts`, la misma fila que siembra
-- `002_bootstrap.sql`. Con un solo usuario, una única fila es suficiente y honesto.
--
-- Lo que hace falta que esto NO haya que rehacerlo cuando haya varios clientes:
--
--   1. La tabla ya es por organización — `org_id` es la clave primaria, así que N orgs son
--      N filas y no hay ningún "singleton" horneado en el esquema. No cambia nada acá.
--   2. Lo único que cambia es DE DÓNDE sale `org_id`: hoy de una constante del servidor,
--      mañana de la sesión del usuario. Es una línea en el endpoint.
--   3. **El `org_id` no puede venir NUNCA del request.** Sin auth, aceptarlo del cuerpo
--      convertiría este endpoint en "leé y escribí las credenciales de la org que quieras".
--      Está escrito acá porque es la clase de atajo que se toma al agregar el segundo
--      cliente, cuando ya nadie se acuerda de por qué la constante estaba del lado servidor.
--
-- ── El límite real: acá las credenciales quedan en texto plano ──
--
-- Sin adornos, porque decidir con esto claro es lo único que sirve:
--
--   * Lo que SÍ cierra el RLS: la llave `anon` viaja en el bundle del browser, o sea que es
--     pública por diseño. Con RLS activo y sin políticas, esa llave no lee ni escribe nada
--     de esta tabla. Ese es el ataque realista —alguien mirando el bundle— y queda cerrado.
--   * Lo que NO cierra: cualquiera con la `service_role`, con acceso al dashboard de
--     Supabase, o con un `pg_dump` de la base, ve las credenciales enteras. El cifrado en
--     reposo del disco de Supabase no cambia esto: para quien entra por la base, el dato
--     está en claro.
--
-- ¿Es aceptable para este alcance? Sí, y por una razón concreta: hoy las mismas
-- credenciales están en las variables de entorno de Vercel, que también son legibles en
-- claro por cualquiera con acceso al dashboard del proyecto. La superficie de confianza no
-- empeora — es la misma persona (Francisco) y los mismos dos paneles. Lo que cambia es la
-- comodidad de rotarlas.
--
-- ¿Cuándo deja de ser aceptable? Cuando haya varios clientes. Ahí un solo volcado de la
-- base deja de ser "mis credenciales" y pasa a ser "las credenciales de todos mis
-- clientes", y eso ya no es un problema operativo sino uno legal.
--
-- Qué haría falta para cifrarlas, con lo que cada opción compra de verdad:
--
--   * **Supabase Vault** (`vault.create_secret()` / la vista `vault.decrypted_secrets`).
--     Guarda el secreto cifrado y la llave de cifrado vive FUERA de la base, en la
--     infraestructura de Supabase. Lo que compra: un `pg_dump`, un `select *` por error, un
--     backup extraviado o una tabla leída por un tercero ya no revelan el valor. Lo que NO
--     compra: quien puede ejecutar SQL con `service_role` en el proyecto vivo igual puede
--     leer `decrypted_secrets`. Acá se guardaría el `id` del secreto en vez del texto.
--   * **Cifrado en la capa de aplicación** (una llave simétrica en variable de entorno de
--     Vercel; el backend cifra antes de escribir y descifra al usar). Lo que compra: hacen
--     falta DOS sistemas comprometidos —la base Y el entorno de Vercel— en vez de uno. Lo
--     que cuesta: rotar esa llave obliga a re-cifrar todas las filas, y perderla vuelve
--     ilegibles todas las credenciales guardadas.
--
-- Ninguna de las dos se implementa acá: las dos agregan una operación de rotación de llaves
-- que hoy nadie va a mantener, y ninguna de las dos protege del escenario que efectivamente
-- estamos evitando (el browser). Queda documentado para decidirlo cuando entre el segundo
-- cliente, que es el momento en que el cálculo cambia.
-- ============================================================================

create table if not exists closer_conexiones (
  -- Una fila por organización. La PK es `org_id` y no un uuid propio a propósito: convierte
  -- "una sola configuración por org" en una invariante de la base en vez de algo que el
  -- endpoint tiene que acordarse de respetar.
  --
  -- La FK es una desviación consciente del resto del módulo (`closer_seguimientos.org_id` y
  -- `closer_usuarios.org_id` son `uuid not null` sueltos): un `org_id` mal tipeado allá
  -- crea una fila huérfana molesta, pero acá crearía un juego de credenciales que nadie lee
  -- y que el usuario cree haber guardado — que es exactamente el fallo que este endpoint no
  -- se puede permitir.
  --
  -- `restrict` y no `cascade`: borrar la org de alguien que tiene credenciales guardadas es
  -- una decisión que se toma a mano, no un efecto colateral.
  org_id uuid primary key references closer_org_config(org_id) on delete restrict,

  -- ── Las credenciales ──
  -- Todas nullable: la configuración es parcial por naturaleza. Se puede tener la key de
  -- Anthropic cargada y el PIT todavía en el entorno, y el backend tiene que poder
  -- distinguir "no configurada" de "configurada en vacío" — por eso null y nunca ''.
  anthropic_api_key text,
  ghl_pit           text,
  ghl_location_id   text,
  ghl_calendar_id   text,

  -- El modelo NO es una credencial: es un identificador público (`claude-opus-5`). Vive acá
  -- porque se configura en la misma pantalla y tiene el mismo ciclo de vida, pero es el
  -- único campo de esta tabla que el endpoint devuelve ENTERO.
  claude_model text,

  -- ── Columnas espejo de solo los últimos 4 caracteres ──
  --
  -- Esto es lo que hace que "jamás devolver el valor completo" sea una garantía y no una
  -- promesa. El endpoint que sirve el estado a la UI selecciona ÚNICAMENTE estas columnas:
  -- el valor entero no entra a la consulta, con lo cual no puede filtrarse por un `select
  -- *` distraído, por un log de la respuesta ni por un error que serialice el objeto.
  --
  -- Son `stored`, así que Postgres las mantiene solo: no hay forma de escribir una
  -- credencial y que el espejo quede desincronizado.
  --
  -- `right(null, 4)` es null, así que "está configurada" es exactamente "el espejo no es
  -- null" — sin necesidad de leer el valor real para responder esa pregunta.
  anthropic_api_key_ultimos4 text generated always as (right(anthropic_api_key, 4)) stored,
  ghl_pit_ultimos4           text generated always as (right(ghl_pit, 4))           stored,
  ghl_location_id_ultimos4   text generated always as (right(ghl_location_id, 4))   stored,
  ghl_calendar_id_ultimos4   text generated always as (right(ghl_calendar_id, 4))   stored,

  actualizado_el timestamptz not null default now(),

  -- Quién rotó la credencial. Hoy siempre null: no hay autenticación, así que no hay a quién
  -- atribuirlo y inventar un usuario sería peor que dejarlo vacío (§4.10 — sin dato, nada).
  -- Existe desde ahora porque cuando haya login esto es auditoría, y la auditoría que se
  -- agrega después no cubre lo que ya pasó.
  actualizado_por uuid references closer_usuarios(id),

  -- Largo mínimo, no formato. Que una key de Anthropic empiece con `sk-ant-` lo valida el
  -- endpoint, donde un rechazo se explica con un mensaje; acá sería un CHECK que el día que
  -- Anthropic cambie el prefijo rompe el guardado con un error incomprensible y exige una
  -- migración para destrabarlo. Lo que sí conviene garantizar en la base es que el valor
  -- tenga largo suficiente para que `right(x, 4)` no termine devolviendo la credencial
  -- entera: con 12 caracteres, el espejo muestra como mucho un tercio.
  constraint largo_minimo check (
    (anthropic_api_key is null or length(anthropic_api_key) >= 12) and
    (ghl_pit           is null or length(ghl_pit)           >= 12) and
    (ghl_location_id   is null or length(ghl_location_id)   >= 8)  and
    (ghl_calendar_id   is null or length(ghl_calendar_id)   >= 8)  and
    (claude_model      is null or length(claude_model)      >= 3)
  ),

  -- `claude_model` se devuelve entero, y los ids se devuelven parcialmente. Pegar una
  -- credencial en el campo equivocado es un error de un segundo con consecuencias de meses,
  -- así que se bloquea de este lado también: es un check NEGATIVO (rechaza prefijos de
  -- secreto conocidos) y por eso no corre el riesgo del párrafo de arriba — si Anthropic
  -- cambia su prefijo, esto simplemente deja de atrapar un caso, no rompe nada.
  constraint credencial_en_campo_equivocado check (
    coalesce(claude_model,    '') !~* '^(sk-|pit-)' and
    coalesce(ghl_location_id, '') !~* '^(sk-|pit-)' and
    coalesce(ghl_calendar_id, '') !~* '^(sk-|pit-)'
  )
);

comment on table closer_conexiones is
  'Credenciales por organización (Anthropic + GHL). Solo service_role. El valor completo NUNCA vuelve al browser: la UI lee las columnas *_ultimos4.';

comment on column closer_conexiones.org_id is
  'Clave primaria: una configuración por organización. Sale de una constante del servidor mientras no haya auth — nunca del request.';

comment on column closer_conexiones.anthropic_api_key_ultimos4 is
  'Últimos 4 caracteres, mantenidos por Postgres. Es lo único que el endpoint de estado consulta: el valor completo no entra a esa query.';

comment on column closer_conexiones.claude_model is
  'Identificador público del modelo (ej. claude-opus-5). No es un secreto: es el único campo que el endpoint devuelve entero.';

comment on column closer_conexiones.actualizado_por is
  'Null mientras no haya autenticación. Existe desde el principio porque la auditoría agregada después no cubre lo ya ocurrido.';

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Activado y SIN políticas, igual que las once tablas del módulo (001) y por la misma
-- razón, que acá pesa más que en ninguna otra: `public` está expuesto por PostgREST, así que
-- una tabla sin RLS es legible Y escribible con la llave `anon` — la que viaja dentro del
-- bundle que se descarga el browser. No es una llave que se pueda "cuidar": está publicada.
-- Sin políticas, solo pasa `service_role`, o sea las funciones de `api/`.
alter table closer_conexiones enable row level security;

-- Segunda línea, además del RLS: Supabase concede por default privileges los permisos de
-- tabla a `anon` y `authenticated` sobre todo lo nuevo en `public`. El RLS ya devolvería
-- cero filas, pero acá el dato es de una categoría en la que no se deja nada apoyado en una
-- sola defensa. Mismo criterio que la migración 008.
revoke all on closer_conexiones from anon, authenticated;
grant all on closer_conexiones to service_role;
