# 09 — La escotilla y los estados de la sesión

Dos defectos que **abre** el endurecimiento del documento anterior. Los dos son de la peor clase: uno
impide que el sistema arranque, y el otro abre una puerta sin que nadie lo note.

| Defecto                                                                                                                                 | Síntoma                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Las políticas que filtran por organización **rompen el login**, que busca al usuario antes de saber de qué organización es              | Nadie puede entrar. Y la salida rápida es aflojar la política |
| Agregar estados de sesión (segundo factor pendiente) **contradice** la regla del portero que deja pasar las operaciones sin capacidades | Una sesión que no probó quién es alcanza endpoints reales     |

Este documento es autosuficiente: no depende de los otros de la carpeta. Trae el SQL completo y las
pruebas. Donde corrige algo dicho antes, lo dice.

---

## 1 · El login contra las políticas de la base

### Cómo se rompe

El endurecimiento pide activar seguridad a nivel de fila en todas las tablas, forzarla incluso para el
propietario, y filtrar por una variable de sesión que se pone al abrir el contexto de organización:

```sql
create policy aislamiento on pedidos for all to app_inquilino
  using (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));
```

Y el diseño del aislamiento reconoce que **hay operaciones que legítimamente cruzan organizaciones**, y
les da un acceso sin filtro autorizado archivo por archivo:

- **el login**, que busca un usuario por email **antes** de saber de qué organización es;
- **las tareas programadas**, que recorren todas las organizaciones;
- **el enrutador de eventos entrantes**, que tiene que averiguar a qué organización pertenece un evento;
- **el alta de organización**, que por definición todavía no tiene contexto.

**Las dos cosas juntas no funcionan.** Cuando el login busca al usuario, no hay variable de sesión
puesta; la política evalúa `org_id = null`, que es nulo, que no es verdadero, y la consulta devuelve
**cero filas**. El sistema falla cerrado, que es exactamente lo que se pidió — y el resultado es que
**nadie puede iniciar sesión**.

Y hay una segunda forma de fallar, peor de diagnosticar: si esa conexión **ya se usó** para otra
petición, el parámetro personalizado no vuelve a nulo al terminar la transacción — **queda en cadena
vacía**. Ahí `''::uuid` **lanza un error de sintaxis**. El mismo login falla de dos maneras distintas
según cuántas veces se usó la conexión, que es la clase de defecto que se pasa media tarde buscando.

El "acceso sin filtro" del código no arregla nada: el filtro que corta no está en la capa de la
aplicación, está en la base, y no le importa por qué conexión llegó la consulta si es la misma.

> **La trampa está en cómo se descubre.** Se descubre durante la implementación, porque el login no
> anda, con alguien apurado. Y la salida más rápida es agregarle un escape a la política:
>
> ```sql
> using (org_id = current_setting('app.org_id', true)::uuid
>        or current_setting('app.modo_global', true) = 'on')   -- ← NO
> ```
>
> Eso lo puede encender **cualquier línea de la aplicación**. No es una barrera, es un comentario. Y
> desactiva la protección entera de un solo golpe, para todas las tablas, en la línea que uno escribe
> para "hacer andar el login".

### La solución: dos dominios, dos roles de base

El error de fondo es pensar la escotilla como **un nivel de privilegio** ("acceso total, sin filtro").
Pensada así, cada vez que hace falta se agranda, y termina siendo un rol que lo puede todo usado por
media aplicación.

Pensada como **un dominio de datos**, se acota sola:

| Dominio       | Qué tablas                                                                                                                                                                                  | Qué rol de base |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Identidad** | `organizaciones`, `usuarios`, `sesiones`, `roles`, `permisos`, `roles_permisos`, `usuarios_roles`, `auditoria_accesos`, `usuarios_segundo_factor`, `organizaciones_credenciales` — **diez** | `app_identidad` |
| **Inquilino** | Todas las tablas de negocio, más lectura filtrada de `usuarios`, `roles` y `organizaciones`                                                                                                 | `app_inquilino` |

Y la propiedad que hace que esto valga la pena:

> **`app_identidad` consulta sin filtro de organización, pero NO PUEDE LEER UNA SOLA FILA DE NEGOCIO.**
> **`app_inquilino` puede leer datos de negocio, pero SIEMPRE filtrados.**
>
> Ninguno de los dos, comprometido, da lo que da el otro. La escotilla deja de ser "acceso total" y pasa
> a ser "acceso a las diez tablas de identidad, declarado en una migración que alguien revisó".

**Y son diez tablas, no cuatro.** Es el detalle que hace que este arreglo se aplique a medias: se
resuelve el login —`usuarios` y `organizaciones`— y se descubre después que `sesiones` no tiene columna de
organización, que `permisos` es un catálogo global, que `roles` puede ser global o de una organización,
que la auditoría tiene la organización nulificable **a propósito** porque un intento con un email
inexistente no pertenece a ninguna, y que el segundo factor y las credenciales cifradas son dos tablas
más que nadie contó. Si se aplica la política genérica en masa sobre esas diez, el sistema no arranca — o
peor, arranca a medias.

### Por qué la frontera se construye con permisos y no con políticas

Hay dos formas de que `app_identidad` no pueda leer las tablas de negocio, y **no son equivalentes**:

| Mecanismo                               | Lectura               | Alta              | Modificación y borrado              |
| --------------------------------------- | --------------------- | ----------------- | ----------------------------------- |
| **No otorgarle permiso** sobre la tabla | **Error explícito**   | **Error**         | **Error**                           |
| Otorgarle permiso y no darle política   | Cero filas, sin error | Error de política | **Cero filas afectadas, SIN ERROR** |

La primera fila falla **fuerte y a la vista**, siempre. La segunda falla **en silencio en tres de los
cuatro casos**, y el más peligroso es el último:

> **Una modificación sin política aplicable no falla: informa que modificó cero filas.** Es literalmente
> un éxito reportado que no ocurrió — la firma exacta del defecto que todo este diseño existe para
> evitar. El código sigue, responde 200, y el dato no se guardó.

Solo el alta lanza. Por eso **"la escritura falló" no sirve como criterio de aislamiento en una prueba**:
hay que verificar el efecto, no la ausencia de error.

**Y las pruebas hay que correrlas con el rol real de la aplicación**, nunca con el propietario ni con un
rol privilegiado: con ésos, casi nada de esto se manifiesta y todo se ve perfecto.

**Por eso la frontera entre dominios se construye con `grant`, y las políticas quedan para el filtro
dentro del dominio del inquilino.** Un archivo de login que por error consulte una tabla de negocio no
devuelve una lista vacía: rompe.

---

## 2 · El SQL completo

### Primero: tres esquemas, porque con dos roles no alcanza

Es tentador crear los dos roles y dejar todas las tablas en el esquema de siempre. **No funciona**, y
falla justo en la dirección que este documento quiere evitar.

El motivo son los permisos por omisión. Toda migración necesita que las tablas nuevas queden accesibles
para la aplicación, y las dos formas de conseguirlo son globales por esquema:

```sql
alter default privileges in schema <X> grant … to app_inquilino;
grant select, insert, update, delete on all tables in schema <X> to app_inquilino;
```

Si `<X>` es el esquema donde también viven `sesiones`, `roles` y la auditoría, esas dos líneas le dan al
rol del inquilino **modificación y borrado sobre las tablas de identidad**: el hash de las contraseñas
queda a su alcance y la auditoría "inmutable para nadie" se vuelve borrable. Y `revoke all … from public`
**no lo compensa**: eso revoca del pseudo-rol público, no del rol al que se acaba de otorgar.

Con los datos separados por esquema, el problema no existe:

```sql
create schema identidad;   -- quién sos: 10 tablas. Permisos SIEMPRE tabla por tabla.
create schema negocio;     -- los datos de los inquilinos. Toda tabla lleva org_id.
create schema comun;       -- catálogos de referencia compartidos, de solo lectura.
```

| Esquema     | Qué vive ahí                                                     | Cómo se otorgan los permisos                        |
| ----------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `identidad` | Identidad, sesiones, roles, credenciales, auditoría              | **Tabla por tabla, a mano.** Nunca una regla global |
| `negocio`   | Todo lo del inquilino. Cada tabla con su columna de organización | Regla por omisión + una línea por tabla             |
| `comun`     | Catálogos de referencia (países, monedas, tipos): sin dueño      | Solo lectura para los dos roles                     |

El esquema `comun` resuelve un caso que si no queda huérfano: **las tablas compartidas entre inquilinos.**
No tienen columna de organización, así que no admiten la política de aislamiento, y su única política
posible es "todos pueden leer" — que en cualquier otro esquema sería una alarma. Separadas, la regla es
clara: en `comun` **nadie escribe** salvo una migración, y por eso leer todo es correcto.

### Los tres roles

```sql
-- 1 · El propietario de las tablas. Corre las migraciones y NADA más.
--     No lo usa la aplicación en ningún momento.
create role migrador login password '<secreto 1>' noinherit;

-- 2 · El dominio del inquilino. Datos de negocio, siempre filtrados.
create role app_inquilino login password '<secreto 2>' noinherit nobypassrls;

-- 3 · El dominio de identidad. Consulta sin filtro de organización,
--     y no llega a ninguna tabla de negocio.
create role app_identidad login password '<secreto 3>' noinherit nobypassrls;

-- Acceso a los esquemas. `usage` no da acceso a las tablas: solo permite nombrarlas.
grant usage on schema negocio, comun to app_inquilino;
grant usage on schema identidad     to app_identidad;
grant usage on schema comun         to app_identidad;
-- El inquilino necesita nombrar CUATRO tablas de identidad —organizaciones,
-- usuarios, roles y la auditoría— y solo esas cuatro. `usage` sobre el esquema no
-- da acceso a ninguna tabla: solo permite nombrarlas.
grant usage on schema identidad     to app_inquilino;

-- La RUTA DE BÚSQUEDA por rol. Con esto, el código de la aplicación escribe
-- `pedidos` y no `negocio.pedidos`, y cada rol resuelve al esquema que le
-- corresponde. Sin esto, o se califica cada nombre en cada consulta, o la mitad
-- de las consultas no resuelve y la otra mitad resuelve a la tabla equivocada.
alter role app_inquilino set search_path = negocio, identidad, comun;
alter role app_identidad set search_path = identidad, comun;
alter role migrador      set search_path = identidad, negocio, comun;

-- La regla por omisión, SOLO sobre negocio, y nombrando el rol que crea las tablas.
alter default privileges for role migrador in schema negocio
  grant select, insert, update, delete on tables to app_inquilino;
alter default privileges for role migrador in schema negocio
  grant usage, select on sequences to app_inquilino;

-- Y sobre `identidad`, NINGUNA regla por omisión. A propósito: cada tabla de ese
-- esquema se otorga a mano, y una tabla nueva ahí nace sin acceso para nadie
-- hasta que alguien escriba el grant. Es el comportamiento que se quiere.
```

`nobypassrls` es el valor por omisión; se escribe igual, para que quede dicho en la migración que alguien
va a revisar. Ninguno de los tres es superusuario.

> **La condición sin la cual todo esto se cae, y no es obvia: ningún rol puede ser miembro de otro.**
>
> Una política dirigida a un rol se aplica a **todo rol que herede sus privilegios**, no solo al rol
> nombrado. Si alguien alguna vez ejecuta `grant app_identidad to app_inquilino` —para "simplificar", o
> para que una tarea puntual funcione— el rol del inquilino **hereda las políticas de identidad**, que son
> `using (true)`. Y como las políticas permisivas se combinan con **o**, el inquilino pasa a ver **todas
> las filas de todas las organizaciones**. En silencio, sin cambiar una sola política.
>
> Es una línea de SQL que revierte el diseño entero. Verificalo, y dejá la verificación en la suite:
>
> ```sql
> select pg_has_role('app_inquilino', 'app_identidad', 'USAGE') as hereda_identidad,
>        pg_has_role('app_identidad', 'app_inquilino', 'USAGE') as hereda_inquilino,
>        pg_has_role('app_inquilino', 'migrador',      'USAGE') as hereda_migrador;
> -- Las tres tienen que dar false.
> ```

> **Cuatro formas de que los permisos por omisión no se apliquen**, todas con el mismo síntoma: _permiso
> denegado_ en la primera consulta a la primera tabla nueva, ya desplegada.
>
> - **La regla es por rol efectivo al crear el objeto, y no se hereda.** Si el rol que migra es miembro de
>   otro y la regla está escrita para ese otro, las tablas nuevas no reciben nada. Por eso el
>   `for role migrador` de arriba no es decorativo.
> - **La regla es por esquema.** Si una migración crea un esquema nuevo, no hay regla que aplique.
> - **Cambiar el dueño después de crear la tabla no reaplica nada.** El patrón "creo como superusuario y
>   después cambio el dueño" es el caso típico: las reglas se consultan **al crear**.
> - La regla se escribió desde una sesión cuyo rol efectivo no era el que migra.
>
> Por eso **toda migración termina con los permisos explícitos e idempotentes**, acotados al esquema de
> negocio:
>
> ```sql
> grant select, insert, update, delete on all tables    in schema negocio to app_inquilino;
> grant usage, select                  on all sequences in schema negocio to app_inquilino;
> ```
>
> Nunca `in schema identidad`, y nunca sobre el esquema donde viven las dos cosas juntas.

### Los catálogos comunes: una regla y se olvida

Prometer "solo lectura para los dos roles" no alcanza: con la seguridad activada y sin política, esas
tablas quedan ilegibles y el síntoma es una lista vacía sin error. Una regla por omisión propia y listo:

```sql
alter default privileges for role migrador in schema comun
  grant select on tables to app_inquilino, app_identidad;

-- Y por tabla, o al final de la migración para todas:
grant select on all tables in schema comun to app_inquilino, app_identidad;
```

**Estas tablas NO llevan seguridad a nivel de fila**, y es deliberado: no tienen dueño, nadie escribe
salvo una migración, y leer todo es correcto. Es la única excepción de la carpeta, y por eso viven en su
propio esquema — para que la prueba de catálogo pueda exceptuarlas **por esquema** en vez de por una lista
de nombres que alguien tiene que mantener.

### Las diez tablas de identidad, una por una

Ninguna es difícil. Todas hay que escribirlas a mano — y son **diez**, no cuatro. Es el detalle que hace
que este arreglo se aplique a medias: se resuelve el login —`usuarios` y `organizaciones`— y se descubre
después que `sesiones` no tiene columna de organización, que `permisos` es un catálogo global, que `roles`
puede ser global o de una organización, que la auditoría tiene la organización nulificable **a
propósito**, y que el segundo factor y las credenciales cifradas son dos tablas más que nadie contó.

```sql
-- ─────────────────────────────────────────────────────────────────
-- 1 · organizaciones · el inquilino ve y edita SU fila; identidad
--     las ve todas (login, alta, soporte)
-- ─────────────────────────────────────────────────────────────────
alter table identidad.organizaciones enable row level security;
alter table identidad.organizaciones force  row level security;
revoke all on identidad.organizaciones from public;

grant select                            on identidad.organizaciones to app_inquilino;
grant update (nombre, zona_horaria)     on identidad.organizaciones to app_inquilino;
grant select, insert, update            on identidad.organizaciones to app_identidad;

create policy org_propia_lee on identidad.organizaciones for select to app_inquilino
  using (id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

-- Escritura acotada a la propia fila: la configuración la edita el cliente,
-- pero `activa` y `es_principal` NO están entre las columnas otorgadas.
create policy org_propia_edita on identidad.organizaciones for update to app_inquilino
  using      (id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid))
  with check (id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

create policy org_identidad on identidad.organizaciones for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- 2 · usuarios · el inquilino ve los de su organización, POR COLUMNA;
--     identidad los busca por email sin contexto
-- ─────────────────────────────────────────────────────────────────
alter table identidad.usuarios enable row level security;
alter table identidad.usuarios force  row level security;
revoke all on identidad.usuarios from public;

-- Permiso POR COLUMNA: el dominio del inquilino necesita nombre y correo para
-- mostrar autores y listas. NO necesita el hash de la contraseña ni las marcas
-- de bloqueo. Si una consulta de negocio tuviera una inyección, el hash no está
-- a su alcance. Las políticas filtran FILAS; los permisos filtran COLUMNAS. Son
-- dos ejes distintos y hacen falta los dos.
grant select (id, org_id, nombre, email, activo) on identidad.usuarios to app_inquilino;
grant select, insert, update on identidad.usuarios to app_identidad;

create policy usuarios_del_inquilino on identidad.usuarios for select to app_inquilino
  using (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

create policy usuarios_identidad on identidad.usuarios for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- 3 · sesiones · NO tiene columna de organización, y no la necesita:
--     se busca por hash de token antes de saber quién es nadie.
--     El rol del inquilino NO TIENE ACCESO. Ni select.
-- ─────────────────────────────────────────────────────────────────
alter table identidad.sesiones enable row level security;
alter table identidad.sesiones force  row level security;
revoke all on identidad.sesiones from public;

grant select, insert, update, delete on identidad.sesiones to app_identidad;

create policy sesiones_identidad on identidad.sesiones for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- 4 · permisos · catálogo global de capacidades. Solo identidad;
--     la escritura es una migración.
-- ─────────────────────────────────────────────────────────────────
alter table identidad.permisos enable row level security;
alter table identidad.permisos force  row level security;
revoke all on identidad.permisos from public;

grant select on identidad.permisos to app_identidad;

create policy permisos_lectura on identidad.permisos for select to app_identidad
  using (true);

-- ─────────────────────────────────────────────────────────────────
-- 5 · roles · pueden ser globales (organización nula) o privados de
--     una organización. Los DOS casos, escritos:
-- ─────────────────────────────────────────────────────────────────
alter table identidad.roles enable row level security;
alter table identidad.roles force  row level security;
revoke all on identidad.roles from public;

grant select                            on identidad.roles to app_inquilino;
grant select, insert, update, delete    on identidad.roles to app_identidad;

-- El inquilino ve las plantillas globales y SUS roles privados. Nada más.
-- Alcanza para mostrar el nombre del rol de una persona en una lista.
create policy roles_visibles on identidad.roles for select to app_inquilino
  using (org_id is null
         or org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

create policy roles_identidad on identidad.roles for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- 6 y 7 · roles_permisos y usuarios_roles · solo identidad.
--     Ver la nota de abajo sobre por qué NO llevan una política
--     que haga join para averiguar de quién es la fila.
-- ─────────────────────────────────────────────────────────────────
alter table identidad.roles_permisos enable row level security;
alter table identidad.roles_permisos force  row level security;
revoke all on identidad.roles_permisos from public;
grant select, insert, delete on identidad.roles_permisos to app_identidad;
create policy roles_permisos_identidad on identidad.roles_permisos
  for all to app_identidad using (true) with check (true);

alter table identidad.usuarios_roles enable row level security;
alter table identidad.usuarios_roles force  row level security;
revoke all on identidad.usuarios_roles from public;
grant select, insert, delete on identidad.usuarios_roles to app_identidad;
create policy usuarios_roles_identidad on identidad.usuarios_roles
  for all to app_identidad using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- 8 · auditoría · la organización es NULIFICABLE A PROPÓSITO: un
--     intento con un email inexistente no pertenece a ninguna.
--     Los dos roles escriben. El inquilino lee SOLO lo suyo.
-- ─────────────────────────────────────────────────────────────────
alter table identidad.auditoria_accesos enable row level security;
alter table identidad.auditoria_accesos force  row level security;
revoke all on identidad.auditoria_accesos from public;

grant insert, select on identidad.auditoria_accesos to app_inquilino;
grant insert, select on identidad.auditoria_accesos to app_identidad;
-- Y nunca update ni delete, para NADIE. La inmutabilidad va en el permiso
-- además del disparador: dos capas, como todo lo demás.

create policy auditoria_escribe_inquilino on identidad.auditoria_accesos
  for insert to app_inquilino
  with check (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

-- La lectura acotada es necesaria: hay una capacidad para que un administrador
-- de cliente vea la auditoría de SU organización, y un endpoint que le muestra
-- los accesos de soporte a su organización. Sin esta política, esa lectura
-- tendría que correr por identidad — sin filtro y con el código como única
-- barrera. Las filas de organización nula quedan solo para identidad, que es
-- exactamente lo que se quiere.
-- Para que esto sirva de verdad: la fila del acceso de soporte se guarda con la
-- organización VISITADA, y la de origen va en el detalle. Al revés, el
-- administrador de ese cliente no puede ver los accesos a sus propios datos.
create policy auditoria_lee_inquilino on identidad.auditoria_accesos
  for select to app_inquilino
  using (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

create policy auditoria_identidad on identidad.auditoria_accesos
  for all to app_identidad using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- 9 · segundo factor · el secreto de cada persona, cifrado.
--     Se consulta durante el login, antes de haber probado nada.
--     Solo identidad.
-- ─────────────────────────────────────────────────────────────────
alter table identidad.usuarios_segundo_factor enable row level security;
alter table identidad.usuarios_segundo_factor force  row level security;
revoke all on identidad.usuarios_segundo_factor from public;

grant select, insert, update, delete on identidad.usuarios_segundo_factor to app_identidad;

create policy segundo_factor_identidad on identidad.usuarios_segundo_factor
  for all to app_identidad using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- 10 · credenciales por organización · secretos cifrados de cada
--      cliente. Solo identidad, y es una decisión:
-- ─────────────────────────────────────────────────────────────────
alter table identidad.organizaciones_credenciales enable row level security;
alter table identidad.organizaciones_credenciales force  row level security;
revoke all on identidad.organizaciones_credenciales from public;

grant select, insert, update, delete on identidad.organizaciones_credenciales to app_identidad;

create policy credenciales_identidad on identidad.organizaciones_credenciales
  for all to app_identidad using (true) with check (true);
```

**Por qué las credenciales van en identidad y no en negocio**, aunque tengan columna de organización: así
**el dominio del inquilino no puede leerlas en absoluto**. Una inyección en una consulta de negocio no
alcanza los secretos de ningún cliente. El precio es que la función única que resuelve credenciales corre
en el dominio de identidad, lo cual es una razón más para que sea **una sola función** y esté en la lista
de archivos autorizados.

Y el contrapeso honesto: **el rol de identidad puede leer las credenciales cifradas de todos los
clientes.** Cifradas — la clave maestra vive en el entorno de la aplicación, no en la base, así que el
acceso a la base por sí solo no da texto claro. Pero es una razón más para que ese rol tenga la superficie
más chica posible.

**Y la vista de permisos efectivos**, si la usás: va en `identidad`, se declara para ejecutarse con los
permisos de quien la invoca, y **solo el rol de identidad puede usarla** — porque quien la invoca necesita
permiso sobre las tres tablas que la vista lee, y el inquilino no lo tiene sobre dos de ellas. Está bien
así: los permisos efectivos se resuelven en el portero, que corre por identidad.

```sql
grant select on identidad.usuarios_permisos to app_identidad;
```

> **Regla para lo que venga después:** toda tabla nueva **sin** columna de organización —tokens de
> recuperación de contraseña, invitaciones, claves de API— es del dominio de identidad, y se agrega a esta
> lista **a mano**, con su `grant` y su política. No hay regla por omisión que la cubra, y eso es
> deliberado: sin `grant`, la tabla nace inaccesible y el fallo aparece en la primera prueba, no en
> producción.

**Por qué `roles_permisos` y `usuarios_roles` no llevan una política que haga join.** Ninguna de las dos
tiene columna de organización, así que la política "correcta" sería un `exists` contra `roles` o contra
`usuarios`. Eso trae dos problemas: las políticas de **esa** tabla se aplican también dentro de la
subconsulta, y si una política entra en ciclo PostgreSQL falla con **recursión infinita detectada en la
política**, que es un error de ejecución en producción, no de migración.

La salida es la de arriba: **el rol del inquilino no accede a esas tablas en absoluto.** No las necesita —
los permisos efectivos se resuelven una sola vez, en el portero, con la conexión de identidad, antes de
abrir el contexto del inquilino.

> **Y una consecuencia que hay que decir en vez de dejarla implícita:** la pantalla que **administra**
> roles y permisos de un cliente es una operación del dominio de identidad, no del inquilino. Corre por la
> conexión sin filtro, así que **tiene que filtrar por organización en el código**, va en la lista de
> archivos autorizados, y necesita su propia prueba. Es la única parte de este diseño donde el aislamiento
> depende del código y no de la base — y por eso está escrito acá, en vez de descubrirse.

### Lo que ninguna política cubre

Tres caminos por donde los datos salen **sin pasar por ninguna política**. Los tres son reales.

**1 · Las verificaciones de unicidad y de clave foránea no pasan por las políticas.** Se hacen sobre la
tabla entera. Consecuencia: un mensaje de "ya existe una fila con ese valor" **confirma la existencia de
un registro de otra organización**, aunque quien pregunta no pueda verlo. Dos medidas:

- **la organización va dentro de las claves únicas**, no al lado: `unique (org_id, codigo)` y no
  `unique (codigo)`. Así "ya existe" significa "ya existe **acá**";
- **los mensajes de restricción no se devuelven al cliente.** Cada uno se traduce a un código propio.
  (Los mensajes de los **disparadores**, escritos a propósito para que los lea una persona, sí.)

**2 · Una vista se ejecuta con los permisos de su dueño, no de quien la consulta.** Una vista sobre tablas
de inquilino, creada por el rol que migra, **evade las políticas del inquilino** y devuelve todo. Si tu
motor lo soporta, toda vista sobre datos de inquilino se declara para ejecutarse **con los permisos de
quien la invoca**; si no lo soporta, no se usan vistas sobre esas tablas.

**3 · Las particiones se marcan de a una.** Activar la seguridad en la tabla madre **no** la activa en las
particiones, y una consulta dirigida a una partición puede no filtrar. Si usás tablas particionadas:
activar y crear política **en cada partición**, y comprobarlo consultando una partición directamente.

Y una que no es un camino de salida sino de diagnóstico: **una política que consulta otra tabla protegida
puede entrar en recursión.** No hace falta que dos se referencien: alcanza con que una se refiera a sí
misma, y la detección es conservadora —aborta ante cualquier reentrada—. El error aparece **en ejecución,
en producción**, no al aplicar la migración. Y meter una función privilegiada para romper el ciclo suele
**empeorarlo**: una función con permisos de su dueño **no desactiva las políticas**, y si el ciclo pasa por
su cuerpo, en vez de un error claro de recursión se obtiene un agotamiento de pila o un tiempo de espera.
La salida barata es la de este documento: que el rol del inquilino **no tenga acceso** a esas tablas, o que
la organización esté **en la propia fila** y la política no necesite consultar nada.

### Las tablas de negocio: una línea por tabla

Lo peor que puede pasar con las tablas de negocio es que alguien cree una nueva y **se olvide la
política**: con la seguridad activada y sin política, el rol del inquilino ve **cero filas al leer y cero
filas afectadas al modificar, sin un solo error**. Una pantalla vacía que parece un negocio vacío.

La defensa es hacer que lo correcto sea una línea:

```sql
create or replace function aplicar_aislamiento(p_tabla regclass) returns void as $$
begin
  execute format('alter table %s enable row level security', p_tabla);
  execute format('alter table %s force  row level security', p_tabla);
  execute format('revoke all on %s from public', p_tabla);
  execute format('grant select, insert, update, delete on %s to app_inquilino', p_tabla);
  execute format($politica$
    create policy aislamiento on %s for all to app_inquilino
      using      (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid))
      with check (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid))
  $politica$, p_tabla);
end $$ language plpgsql;
```

Y cada tabla nueva termina con:

```sql
select aplicar_aislamiento('negocio.pedidos');
```

Dos detalles del SQL de arriba que son deliberados:

**`nullif(btrim(…), '')` antes del casteo.** La función devuelve nulo cuando la variable **nunca** se puso
— pero después del primer uso de esa conexión, el valor de reposo del parámetro **no vuelve a nulo: queda
en cadena vacía**, y `''::uuid` **lanza un error de sintaxis**. Sin el `nullif`, la política falla cerrado
la primera vez y **revienta** las siguientes. El `btrim` cubre el espacio en blanco; cualquier otro texto
que no sea un identificador válido **también lanza**, así que el valor que se pone tiene que validarse
antes.

**La subconsulta escalar alrededor.** Sin ella la función se evalúa una vez por fila; envuelta,
**normalmente** se resuelve una sola vez por consulta. Es comportamiento del planificador y no un
contrato: **medilo con un plan de ejecución** antes y después, porque tiene una contrapartida real — el
valor pasa a ser desconocido en tiempo de plan y se pierde la estimación por estadísticas de la columna,
lo que en una tabla grande puede terminar en un recorrido completo.

---

## 3 · Las tareas programadas no necesitan escotilla

Este punto ahorra la mitad del trabajo, y es fácil no verlo.

Una tarea que recorre todas las organizaciones **parece** necesitar acceso sin filtro a las tablas de
negocio. No lo necesita. Necesita **la lista de organizaciones**, que es una tabla de identidad, y
después trabajar **de una en una**:

```
funcion tareaProgramada():
    # Dominio de identidad: la lista. Una consulta, sin datos de negocio.
    organizaciones = conIdentidad(() => "select id from organizaciones where activa")

    para cada org en organizaciones:
        # Dominio del inquilino: una transacción por organización,
        # con el filtro de la base puesto. Igual que una petición normal.
        intentar:
            conOrganizacion(org.id, () => procesar(org))
        capturar error:
            registrar(org.id, error)      # y seguir con la siguiente
```

Con eso, **el enrutador de eventos entrantes** también se resuelve solo: averigua a qué organización
pertenece el evento con una consulta al dominio de identidad (o a una tabla de correspondencias con
identificadores externos, que es identidad y no negocio), y a partir de ahí abre el contexto y sigue el
camino normal.

Y **el alta de organización** es una escritura en `organizaciones`: dominio de identidad, sin
excepciones de ningún tipo.

Resultado: de las cuatro operaciones que "cruzan organizaciones", **ninguna necesita leer datos de
negocio sin filtro**.

### El único caso que sí queda

**Los informes que agregan varias organizaciones a la vez** — el panel que compara el rendimiento entre
cuentas, para el rol de plataforma. Ese sí quiere leer datos de negocio de todas.

Tres formas, en orden de preferencia:

1. **El bucle, agregando en la aplicación.** Una transacción por organización, sumar en memoria. Con
   decenas de organizaciones es perfectamente viable y **no abre ninguna puerta nueva**.
2. **Una tabla de resúmenes** que las tareas programadas escriben por organización, y que el informe lee
   con una política propia acotada al rol de plataforma. Los datos agregados no son datos personales, y
   la tabla es chica.
3. **Un tercer rol de solo lectura** sobre vistas materializadas específicas — nunca sobre las tablas
   base. Es la última opción, y si se toma, va con su propia lista de archivos autorizados y su prueba.

Lo que **no** hay que hacer es agrandar el rol de identidad para que además lea negocio. Ahí se pierde
la propiedad que hace que todo esto sirva.

---

## 4 · Las pruebas que sostienen esta sección

Seis. Sin ellas, todo lo anterior es una intención.

```
prueba "los roles de la aplicación no pueden saltear las políticas":
    para cada rol en [app_inquilino, app_identidad]:
        conectar como rol
        fila = "select (select rolbypassrls from pg_roles where rolname = current_user) as omite,
                       current_setting('is_superuser') as super"
        afirmar fila.omite == falso
        afirmar fila.super == "off"

prueba "la escotilla no llega al negocio":
    conectar como app_identidad
    afirmar que "select 1 from pedidos limit 1" LANZA permiso denegado
    #        ↑ lanza, no devuelve vacío. Es la diferencia que importa.
    afirmar que "select 1 from usuarios limit 1" funciona

prueba "el dominio del inquilino no llega a la identidad":
    conectar como app_inquilino
    afirmar que "select 1 from sesiones limit 1" LANZA permiso denegado
    afirmar que "select 1 from usuarios_roles limit 1" LANZA permiso denegado

prueba "sin organización en contexto, ninguna fila de negocio":
    conectar como app_inquilino          # sin poner la variable
    resultado = intentar "select count(*) from pedidos"
    # Cero filas si la variable nunca se puso en esta conexión; ERROR si se puso
    # y quedó en cadena vacía. Las dos son correctas. Exigir exactamente una de
    # las dos hace una prueba que pasa o falla según el estado del agrupador.
    afirmar resultado.lanzo o resultado.count == 0

prueba "sin transacción abierta, la política igual corta":
    conectar como app_inquilino
    poner la variable SIN abrir transacción      # tiene éxito y no hace nada
    afirmar que "select count(*) from pedidos" devuelve 0 o lanza

prueba "ninguna tabla quedó sin política":
    filas = "select c.relname,
                    c.relrowsecurity      as habilitada,
                    c.relforcerowsecurity as forzada,
                    exists (select 1 from pg_policy p where p.polrelid = c.oid) as con_politica
               from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
              where n.nspname in ('identidad', 'negocio')   -- NO 'comun': ver abajo
                and c.relkind in ('r', 'p')"      -- tablas Y tablas particionadas
    # Que la consulta no vuelva vacía: un filtro por un esquema equivocado hace que
    # esta prueba pase SIEMPRE, y una prueba que pasa en vacío es peor que ninguna.
    afirmar filas.largo > 0
    para cada f en filas:
        afirmar f.habilitada y f.forzada y f.con_politica    # nombrando la tabla que falla

    # Y los tres diagnósticos que esta consulta NO da:
    afirmar "select rolname from pg_roles where rolsuper or rolbypassrls" == solo los esperados
    afirmar ninguna política con 'public' entre sus roles, ni con expresión 'true',
            fuera del esquema de identidad y del de catálogos comunes
    # El más traicionero: una tabla puede tener seguridad, forzada y con política,
    # y aun así ser inaccesible porque la creó un rol distinto del nombrado en la
    # regla de permisos por omisión. Pasa esta prueba y rompe en producción.
    para cada tabla del esquema de negocio:
        afirmar has_table_privilege('app_inquilino', tabla, 'SELECT, INSERT, UPDATE, DELETE')
```

La última es la más valiosa de las seis: **es la única que agarra la tabla que alguien va a crear el
mes que viene.** Corre contra el catálogo, no contra el código, así que no se puede engañar con un
comentario ni se queda vieja.

**Con dos aclaraciones para que no genere confianza de más.** Primero: `relkind in ('r','p')` no es un
detalle — sin eso, índices, secuencias y vistas aparecen como "tablas sin seguridad" y son falsos
positivos que nadie puede corregir, y la costumbre de ignorar el resultado se instala. Segundo, y más
importante: **esta prueba verifica la configuración, no el aislamiento.** Que todas las tablas tengan
política no dice que las políticas sean correctas. Las cuatro pruebas anteriores, con dos organizaciones
sembradas y el rol real de la aplicación, son las que verifican el aislamiento.

Los tres estados que conviene distinguir al leer el resultado, porque significan cosas opuestas:

| Estado                                   | Qué significa                                                         |
| ---------------------------------------- | --------------------------------------------------------------------- |
| Seguridad **apagada** con políticas      | Las políticas están escritas y **se ignoran**. Es el peor de los tres |
| Seguridad **apagada** sin políticas      | Acceso total para quien tenga el permiso                              |
| Seguridad **encendida** sin política     | Nadie ve nada: **rompe la aplicación, no la abre**                    |
| Encendida y con política, **sin forzar** | El dueño de la tabla la evade                                         |

Y una del lado del código, que sigue haciendo falta:

```
prueba "solo los archivos autorizados usan la conexión de identidad":
    ARCHIVOS_AUTORIZADOS = { "auth/*", "admin/organizaciones", "admin/usuarios", "tareas/lista" }
    para cada archivo del proyecto:
        si menciona conIdentidad(:
            afirmar que el archivo está en ARCHIVOS_AUTORIZADOS
```

---

## 5 · El segundo defecto: los estados de la sesión

### La contradicción

El portero del servidor tiene un orden deliberado, y en el medio esta regla:

```
si contexto.debeCambiarPassword y capacidadesRequeridas != "ninguna":
    responder 403 { codigo: "password_temporal" }   # ← la regla REEMPLAZADA
```

Es decir: **una operación que no pide capacidades es alcanzable con una contraseña temporal sin
cambiar.** Con dos estados eso estaba bien pensado, porque las operaciones "sin capacidad" eran
inofensivas: saber quién soy, cerrar sesión, cambiar la contraseña. Y una de ellas era justamente **la
única salida** del estado.

Cuando se agrega el segundo factor aparecen dos estados más —_pendiente de verificar_ y _debe
configurarlo_— y la regla deja de ser segura: **una sesión que todavía no probó quién es alcanza
cualquier operación que no pida capacidades.** Y no es una hipótesis sobre las operaciones de hoy: es
una hipótesis sobre **las que se van a escribir**, porque una operación nueva sin capacidades nace
abierta a los cuatro estados sin que nadie lo decida.

### La solución: lista blanca por endpoint

Se invierte el criterio. Cada estado restringido habilita **exactamente las rutas que se nombran**:

```
ESTADOS = {
    "pendiente_2fo":       [ "POST /auth/2fo/verificar",
                             "GET /auth/sesion", "DELETE /auth/sesion" ],

    "debe_cambiar_password": [ "POST /auth/sesion",          # cambiar la contraseña
                               "GET /auth/sesion", "DELETE /auth/sesion" ],

    "debe_configurar_2fo": [ "POST /auth/2fo/configurar", "POST /auth/2fo/confirmar",
                             "GET /auth/sesion", "DELETE /auth/sesion" ],

    "activa":              TODAS,
}
```

Y en el portero, **antes** de cualquier otra verificación que no sea la de la sesión:

```
si contexto.estado != "activa":
    si peticion.ruta no está en ESTADOS[contexto.estado]:
        responder 403 { codigo: contexto.estado }
        devolver nulo
```

Tres propiedades, y la primera es la que importa:

- **una operación nueva nace cerrada.** Es el cambio de fondo: antes, no decidir dejaba la puerta
  abierta; ahora, no decidir la deja cerrada.
- **`GET /auth/sesion` está en los cuatro.** Sin eso el frontend no puede saber en qué estado está y no
  sabe qué pantalla mostrar. Es el error más fácil de cometer armando estas listas.
- **`DELETE /auth/sesion` está en los cuatro.** De todo estado se tiene que poder salir. Un estado sin
  salida es una cuenta bloqueada que necesita a un administrador.

### El orden entre estados, que no es el obvio

Un usuario nuevo con contraseña temporal **y** un rol que exige segundo factor está en dos estados a la
vez. Hay que elegir cuál gana, y la respuesta cambia según el estado:

| Situación                                               | Qué gana                       | Por qué                                                                                                                                                                                                              |
| ------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Segundo factor **ya configurado**, sin verificar        | **El segundo factor**, siempre | Todavía no se probó la identidad. Nada más puede pasar antes, ni cambiar la contraseña                                                                                                                               |
| Segundo factor **por configurar** + contraseña temporal | **La contraseña temporal**     | Contraintuitivo y es lo correcto: la contraseña temporal **la conoce quien creó la cuenta**. Si dejáramos configurar el segundo factor primero, esa persona podría inscribir **su** dispositivo en la cuenta de otro |

La segunda fila es la que casi siempre se pone al revés, con el argumento razonable de que "el segundo
factor prueba quién es y va primero". Prueba quién es cuando **ya está configurado**; mientras se
configura, lo único que hay es la contraseña — y si es la temporal, hay dos personas que la conocen.

### La sesión pendiente es una sesión a medias

Una sesión en _pendiente de verificar_ es una fila de sesión que existe **sin haber probado la identidad
completa**. Necesita su propio régimen:

| Regla                                     | Por qué                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Vence en **5 minutos**, absoluto          | Si hereda los siete días de una sesión normal, es una sesión a medio autenticar viva una semana |
| **No se renueva**                         | La renovación deslizante la volvería eterna                                                     |
| El código falla N veces → **se destruye** | Si no, es un código de seis dígitos con intentos infinitos                                      |
| No aparece en "mis sesiones activas"      | Todavía no es una sesión de nadie                                                               |

### El código de la respuesta importa

Los cuatro estados devuelven `403`, igual que la falta de permiso. **Son cosas distintas y el cliente
tiene que poder distinguirlas**, porque el `403` por permiso se muestra a menudo como "no hay datos" —
que es el peor defecto de interfaz de esta familia, porque nadie reporta un error de algo que
"simplemente no tiene datos".

Cada estado restringido devuelve **su propio código** (`pendiente_2fo`, `debe_cambiar_password`,
`debe_configurar_2fo`) — el estado habilitado no devuelve ninguno porque no rechaza nada. El frontend
rutea a la pantalla que corresponde, y `sin_permiso` queda reservado para lo que de verdad es falta de
permiso.

**Y el mismo juego de nombres en las tres superficies**: el código del rechazo, el valor de la columna en
la base, y el campo que devuelve la consulta de sesión. Tres vocabularios para el mismo estado —un
booleano en un lado, `requiere_segundo_factor` en otro, `pendiente_2fo` en el tercero— es la forma más
segura de que el frontend maneje dos y se olvide del tercero.

### Las pruebas

```
prueba "ninguna ruta está en dos listas, fuera del conjunto común":
    # OJO: consultar y cerrar la sesión están A PROPÓSITO en las cuatro listas, y
    # el estado "activa" contiene todas. Escrita como "las listas no se cruzan",
    # esta prueba es imposible de pasar y contradice a la de abajo. Lo que se
    # quiere verificar es que no haya rutas ESPECÍFICAS de un estado repetidas.
    para cada par de estados restringidos:
        afirmar que (listaA - COMUN) y (listaB - COMUN) no se cruzan

prueba "de todo estado se puede salir y se puede preguntar quién soy":
    para cada estado != "activa":
        afirmar "DELETE /auth/sesion" en ESTADOS[estado]
        afirmar "GET /auth/sesion"    en ESTADOS[estado]

prueba "un endpoint nuevo nace cerrado":
    # Acotada a las rutas que PASAN por el portero: el login, la comprobación de
    # salud y el arranque no lo llaman y responderían otra cosa. Reusa la misma
    # lista de rutas públicas que ya usa la prueba del portero.
    para cada ruta del proyecto que llame al portero y no esté en ninguna lista:
        simular petición con sesión en cada estado restringido
        afirmar respuesta 403 con el código de ese estado

prueba "la sesión pendiente no llega a nada real":
    sesion = crearSesion(estado: "pendiente_2fo")
    # Acotada a las rutas que PASAN por el portero, igual que la de arriba: el
    # login y la comprobación de salud no lo llaman y responden otra cosa.
    para cada ruta que llame al portero y esté fuera de RUTAS_PERMITIDAS["pendiente_2fo"]:
        afirmar que responde 403 con el código pendiente_2fo
```

La tercera es la que convierte la regla en una garantía: **recorre las rutas del proyecto**, así que una
operación nueva que alguien agregue sin pensar en los estados rompe la suite.

---

## 6 · Lo que esto cuesta, dicho de frente

Dos conexiones y una transacción por petición no son gratis. El camino completo de una petición
autenticada queda así:

```
1 · Conexión de IDENTIDAD  · una consulta: sesión + usuario + organización + permisos
2 · Conexión de INQUILINO  · abrir transacción, poner la variable, trabajar, cerrar
```

Tres cosas que lo hacen aceptable:

**El paso 1 es UNA consulta, no cuatro.** Sesión, usuario, organización y permisos efectivos salen de un
solo `select` con sus uniones. Si se escribe como cuatro consultas, se paga cuatro veces en cada
petición del sistema.

**La base va en la misma región que las funciones.** Con la base en otra región, cada viaje de ida y
vuelta se nota, y acá hay varios por petición. Es una decisión de infraestructura que se toma una vez y
después es carísima de cambiar.

**Dos agrupadores de conexiones, los dos en modo transacción.** Nunca en modo sentencia: ahí la
variable con alcance de transacción se rompe **incluso dentro de una transacción abierta**.

Y hay un requisito que conviene verificar **antes** de elegir el controlador de base: todo esto depende
de poner una variable con alcance de transacción, así que **el controlador tiene que soportar
transacciones interactivas**. Algunos controladores pensados para ejecución sin servidor, que hablan por
HTTP, solo aceptan consultas sueltas o lotes cerrados: con ésos, este diseño no se puede implementar.
Descubrirlo con el código escrito obliga a cambiar de controlador.

Tres detalles del agrupador que conviene mirar en la documentación de la versión que vas a usar, en vez
de suponer:

- **qué se filtra entre clientes.** Los agrupadores suelen rastrear por cliente unos pocos parámetros
  conocidos; los **personalizados** —los que usa este diseño— y el cambio de rol no están en esa lista.
  Son justo los que importan, y es la razón por la que el alcance tiene que ser de transacción.
- **prohibí el alcance de sesión en el código**, con una búsqueda en la integración continua. Un solo
  lugar que lo use deja la variable viva en esa conexión del servidor **para siempre**.
- **las sentencias preparadas ya no son un problema en todos los agrupadores.** Varios las soportan en
  modo transacción desde hace algunas versiones; desactivarlas por costumbre cuesta rendimiento sin
  necesidad. Y algunos intermediarios no filtran sino que **fijan** la conexión al detectar un cambio de
  parámetro, con lo que se pierde el multiplexado sin que nada falle: hay que medirlo, no suponerlo.

---

## 7 · Lista de verificación

1. Tres roles: el que migra, el del inquilino, el de identidad. Ninguno superusuario, ninguno con
   omisión de seguridad a nivel de fila.
2. `alter default privileges` escrito **con el rol que crea las tablas**.
3. **Tres esquemas**: identidad, negocio y catálogos comunes. La regla de permisos por omisión existe
   **solo** para el de negocio.
4. Las **diez** tablas de identidad, cada una con su permiso y su política escritos a mano. Ninguna con la
   genérica. Y toda tabla nueva sin columna de organización se agrega a esa lista a mano.
5. El rol de identidad **sin ningún permiso** sobre tablas de negocio. Falla fuerte, no vacío.
6. El rol del inquilino **sin ningún permiso** sobre `sesiones`, `permisos`, `roles_permisos` ni
   `usuarios_roles`.
7. Una función que aplique el aislamiento a una tabla nueva, y una línea por tabla.
8. `nullif(…, '')` antes de castear la variable, y la subconsulta escalar alrededor.
9. Las tareas programadas y el enrutador de eventos **por bucle de organizaciones**, no por escotilla.
10. La prueba de catálogo que exige seguridad activada, forzada y con política en **toda** tabla.
11. Estados de sesión por **lista blanca de rutas**, con `GET` y `DELETE /auth/sesion` en las cuatro.
12. El orden entre estados: verificar el segundo factor antes que todo; **configurarlo después** de
    cambiar la contraseña temporal.
13. La sesión pendiente: 5 minutos, sin renovación, destruida al fallar el código.
14. Un código de respuesta distinto por estado, separado de `sin_permiso`.
