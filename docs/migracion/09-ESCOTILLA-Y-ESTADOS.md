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
create policy aislamiento on pedidos
  using (org_id = current_setting('app.org_id', true)::uuid);
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

| Dominio       | Qué tablas                                                                                                             | Qué rol de base |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Identidad** | `organizaciones`, `usuarios`, `sesiones`, `roles`, `permisos`, `roles_permisos`, `usuarios_roles`, `auditoria_accesos` | `app_identidad` |
| **Inquilino** | Todas las tablas de negocio, más lectura filtrada de `usuarios` y `organizaciones`                                     | `app_inquilino` |

Y la propiedad que hace que esto valga la pena:

> **`app_identidad` consulta sin filtro de organización, pero NO PUEDE LEER UNA SOLA FILA DE NEGOCIO.**
> **`app_inquilino` puede leer datos de negocio, pero SIEMPRE filtrados.**
>
> Ninguno de los dos, comprometido, da lo que da el otro. La escotilla deja de ser "acceso total" y pasa
> a ser "acceso a las ocho tablas de identidad, declarado en una migración que alguien revisó".

**Y son ocho tablas, no cuatro.** Es el detalle que hace que este arreglo se aplique a medias: se
resuelve el login —`usuarios` y `organizaciones`— y se descubre después que `sesiones` no tiene columna
de organización, que `permisos` es un catálogo global, que `roles` puede ser global o de una
organización, y que la auditoría tiene la organización nulificable **a propósito**, porque un intento de
acceso con un email inexistente no pertenece a ninguna. Si se aplica la política genérica en masa sobre
esas ocho, el sistema no arranca — o peor, arranca a medias.

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

grant usage on schema public to app_inquilino, app_identidad;
```

`nobypassrls` es el valor por omisión; se escribe igual, para que quede dicho en la migración que
alguien va a revisar. Ninguno de los tres es superusuario.

> **La condición sin la cual todo esto se cae, y no es obvia: ningún rol puede ser miembro de otro.**
>
> Una política dirigida a un rol se aplica a **todo rol que herede sus privilegios**, no solo al rol
> nombrado. Si alguien alguna vez ejecuta `grant app_identidad to app_inquilino` —para "simplificar", o
> para que una tarea puntual funcione— el rol del inquilino **hereda las políticas de identidad**, que
> son `using (true)`. Y como las políticas permisivas se combinan con **o**, el inquilino pasa a ver
> **todas las filas de todas las organizaciones**. En silencio, sin cambiar una sola política.
>
> Es una línea de SQL que revierte el diseño entero. Verificalo, y dejá la verificación en la suite:
>
> ```sql
> select pg_has_role('app_inquilino', 'app_identidad', 'USAGE') as hereda_identidad,
>        pg_has_role('app_identidad', 'app_inquilino', 'USAGE') as hereda_inquilino,
>        pg_has_role('app_inquilino', 'migrador',      'USAGE') as hereda_migrador;
> -- Las tres tienen que dar false.
> ```

> **Trampa de permisos que aparece recién en producción.** Los permisos automáticos para objetos nuevos
> se resuelven por el **rol efectivo en el momento de crear el objeto**, y **no se heredan**: si el rol
> que migra es miembro de otro y la regla está escrita para ese otro, las tablas nuevas **no reciben
> nada**. Hay que nombrar el rol que de verdad ejecuta:
>
> ```sql
> alter default privileges for role migrador in schema public
>   grant select, insert, update, delete on tables to app_inquilino;
> ```
>
> Tres formas más de que esto falle, todas con el mismo síntoma —_permiso denegado_ en la primera
> consulta a la primera tabla nueva, ya desplegada—:
>
> - la regla es **por esquema**: si la migración crea un esquema nuevo, no hay regla que aplique;
> - **cambiar el dueño después de crear la tabla no reaplica nada.** El patrón "creo como superusuario y
>   después cambio el dueño" es el caso típico: las reglas se consultan **al crear**, no al cambiar;
> - la regla se escribió desde una sesión cuyo rol efectivo no era el que migra.
>
> Por eso, además de la regla, **toda migración termina con los permisos explícitos e idempotentes** —
> `grant … on all tables in schema …` y lo mismo para las secuencias. La regla ahorra olvidos; los
> `grant` finales son el cinturón.

### Las tablas de identidad, una por una

Ninguna es difícil. Todas hay que escribirlas a mano.

```sql
-- ─────────────────────────────────────────────────────────────────
-- organizaciones · el inquilino ve SU fila; identidad las ve todas
-- ─────────────────────────────────────────────────────────────────
alter table organizaciones enable row level security;
alter table organizaciones force  row level security;
revoke all on organizaciones from public;

grant select                 on organizaciones to app_inquilino;
grant select, insert, update on organizaciones to app_identidad;

create policy org_propia on organizaciones for select to app_inquilino
  using (id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

create policy org_identidad on organizaciones for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- usuarios · el inquilino ve los de su organización (para mostrar
-- autores y listas); identidad los busca por email sin contexto
-- ─────────────────────────────────────────────────────────────────
alter table usuarios enable row level security;
alter table usuarios force  row level security;
revoke all on usuarios from public;

-- Permiso POR COLUMNA: el dominio del inquilino necesita nombre y correo para
-- mostrar autores y listas. NO necesita el hash de la contraseña, ni las marcas
-- de bloqueo. Si una consulta de negocio tuviera una inyección, el hash no está
-- al alcance.
grant select (id, org_id, nombre, email, activo) on usuarios to app_inquilino;
grant select, insert, update on usuarios to app_identidad;

create policy usuarios_del_inquilino on usuarios for select to app_inquilino
  using (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

-- Nota sobre el permiso por columna de arriba: las políticas filtran FILAS,
-- los permisos filtran COLUMNAS. Son dos ejes distintos y hacen falta los dos.
-- Una política perfecta sobre `usuarios` no impide leer el hash de las filas
-- que sí puede ver.

create policy usuarios_identidad on usuarios for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- sesiones · NO tiene columna de organización, y no la necesita:
-- se busca por hash de token antes de saber quién es nadie.
-- El rol del inquilino NO TIENE ACCESO. Ni select.
-- ─────────────────────────────────────────────────────────────────
alter table sesiones enable row level security;
alter table sesiones force  row level security;
revoke all on sesiones from public;

grant select, insert, update, delete on sesiones to app_identidad;

create policy sesiones_identidad on sesiones for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- permisos · catálogo global. Lectura solo para identidad;
-- la escritura es una migración.
-- ─────────────────────────────────────────────────────────────────
alter table permisos enable row level security;
alter table permisos force  row level security;
revoke all on permisos from public;

grant select on permisos to app_identidad;

create policy permisos_lectura on permisos for select to app_identidad
  using (true);

-- ─────────────────────────────────────────────────────────────────
-- roles · pueden ser globales (organización nula) o privados de una
-- organización. La política tiene que contemplar los dos casos.
-- ─────────────────────────────────────────────────────────────────
alter table roles enable row level security;
alter table roles force  row level security;
revoke all on roles from public;

grant select, insert, update, delete on roles to app_identidad;

create policy roles_identidad on roles for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- roles_permisos y usuarios_roles · solo identidad. Ver la nota de
-- abajo sobre por qué NO llevan una política que haga join.
-- ─────────────────────────────────────────────────────────────────
alter table roles_permisos enable row level security;
alter table roles_permisos force  row level security;
revoke all on roles_permisos from public;
grant select, insert, delete on roles_permisos to app_identidad;
create policy roles_permisos_identidad on roles_permisos for all to app_identidad
  using (true) with check (true);

alter table usuarios_roles enable row level security;
alter table usuarios_roles force  row level security;
revoke all on usuarios_roles from public;
grant select, insert, delete on usuarios_roles to app_identidad;
create policy usuarios_roles_identidad on usuarios_roles for all to app_identidad
  using (true) with check (true);

-- ─────────────────────────────────────────────────────────────────
-- auditoría · la organización es NULIFICABLE A PROPÓSITO: un intento
-- con un email inexistente no pertenece a ninguna. Una política
-- genérica ocultaría justo los eventos que hay que investigar.
-- Los dos roles escriben; solo identidad lee.
-- ─────────────────────────────────────────────────────────────────
alter table auditoria_accesos enable row level security;
alter table auditoria_accesos force  row level security;
revoke all on auditoria_accesos from public;

grant insert         on auditoria_accesos to app_inquilino;
grant insert, select on auditoria_accesos to app_identidad;
-- Y nunca update ni delete, para NADIE. La inmutabilidad va en el
-- permiso además del disparador: dos capas, como todo lo demás.

create policy auditoria_escribe_inquilino on auditoria_accesos for insert to app_inquilino
  with check (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));

create policy auditoria_identidad on auditoria_accesos for all to app_identidad
  using (true) with check (true);
```

**Por qué `roles_permisos` y `usuarios_roles` no llevan una política que haga join.** Ninguna de las dos
tiene columna de organización, así que la política "correcta" sería un `exists` contra `roles` o contra
`usuarios`. Eso trae dos problemas: las políticas de **esa** tabla se aplican también dentro de la
subconsulta, y si dos políticas se referencian mutuamente PostgreSQL falla con **recursión infinita
detectada en la política**, que es un error de ejecución en producción, no de migración.

La salida es la de arriba: **el rol del inquilino no accede a esas tablas en absoluto.** No las necesita
— los permisos se resuelven una sola vez, en el portero, con la conexión de identidad, antes de abrir el
contexto del inquilino. Y de paso desaparece la pregunta de si una organización puede enumerar los roles
de otra: no puede leer la tabla.

> Si en tu caso el dominio del inquilino sí necesitara resolver permisos, la regla es: **toda tabla del
> dominio del inquilino lleva su propia columna de organización, incluidas las tablas de unión.** Una
> política que tiene que hacer join para averiguar de quién es la fila es una política que puede
> recursar; una columna redundante con clave foránea compuesta, no.

### Lo que ninguna política cubre

Tres caminos por donde los datos salen **sin pasar por ninguna política**. No están en ningún documento
anterior y los tres son reales.

**1 · Las verificaciones de unicidad y de clave foránea no pasan por las políticas.** Se hacen sobre la
tabla entera. Consecuencia: un mensaje de "ya existe una fila con ese valor" **confirma la existencia de
un registro de otra organización**, aunque quien pregunta no pueda verlo. Dos medidas:

- **la organización va dentro de las claves únicas**, no al lado: `unique (org_id, codigo)` y no
  `unique (codigo)`. Así "ya existe" significa "ya existe **acá**";
- **los mensajes de restricción no se devuelven al cliente.** Cada uno se traduce a un código propio.
  (Los mensajes de los **disparadores**, escritos a propósito para que los lea una persona, sí.)

**2 · Una vista se ejecuta con los permisos de su dueño, no de quien la consulta.** Una vista sobre
tablas de inquilino, creada por el rol que migra, **evade las políticas del inquilino** y devuelve todo.
Si tu motor lo soporta, toda vista sobre datos de inquilino se declara para ejecutarse **con los
permisos de quien la invoca**; si no lo soporta, no se usan vistas sobre esas tablas.

**3 · Las particiones se marcan de a una.** Activar la seguridad en la tabla madre **no** la activa en
las particiones, y una consulta dirigida a una partición puede no filtrar. Si usás tablas particionadas:
activar y crear política **en cada partición**, y comprobarlo consultando una partición directamente.

Y una que no es un camino de salida sino de diagnóstico: **una política que consulta otra tabla
protegida puede entrar en recursión.** No hace falta que dos se referencien: alcanza con que una se
refiera a sí misma, y la detección es conservadora —aborta ante cualquier reentrada—. El error aparece
**en ejecución, en producción**, no al aplicar la migración. Y meter una función privilegiada para
romper el ciclo suele **empeorarlo**: una función con permisos de su dueño **no desactiva las
políticas**, y si el ciclo pasa por su cuerpo, en vez de un error claro de recursión se obtiene un
agotamiento de pila o un tiempo de espera. La salida barata es la de este documento: que el rol del
inquilino **no tenga acceso** a esas tablas, o que la organización esté **en la propia fila** y la
política no necesite consultar nada.

### Las tablas de negocio: una línea por tabla

Lo peor que puede pasar con las tablas de negocio es que alguien cree una nueva y **se olvide la
política**: con la seguridad activada y sin política, el rol del inquilino ve **cero filas, sin error**.
Una pantalla vacía que parece un negocio vacío.

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
select aplicar_aislamiento('pedidos');
```

Dos detalles del SQL de arriba que son deliberados:

**`nullif(..., '')` antes del casteo.** `current_setting(nombre, true)` devuelve nulo cuando la variable
no está puesta, y eso está bien. Pero si quedó puesta **en cadena vacía** —lo hace algún agrupador de
conexiones al reciclar, y lo hace un `set_config` con un valor vacío— el casteo a identificador **lanza
un error de sintaxis**, y el síntoma es una consulta que falla en producción y no en desarrollo.

**La subconsulta escalar alrededor de `current_setting`.** Sin ella, la función se evalúa **una vez por
fila**. Envuelta en `(select …)`, el planificador **normalmente** la resuelve una sola vez por consulta.
Es comportamiento del planificador y no un contrato, así que **medilo con un plan de ejecución** antes y
después: tiene una contrapartida real, porque el valor pasa a ser desconocido en tiempo de plan y se
pierde la estimación por estadísticas de la columna, lo que en una tabla grande puede terminar en un
recorrido completo. Con la tabla chica, ni se nota ninguna de las dos cosas.

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

Cinco. Sin ellas, todo lo anterior es una intención.

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
              where n.nspname = 'public'
                and c.relkind in ('r', 'p')"      -- tablas Y tablas particionadas
    para cada f en filas:
        afirmar f.habilitada y f.forzada y f.con_politica    # nombrando la tabla que falla

    # Y los dos diagnósticos que esta consulta NO da:
    afirmar "select rolname from pg_roles where rolsuper or rolbypassrls" == solo los esperados
    afirmar ninguna política con 'public' entre sus roles, ni con expresión 'true',
            fuera de las del dominio de identidad
```

La última es la más valiosa de las cinco: **es la única que agarra la tabla que alguien va a crear el
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
    responder 403 { codigo: "password_temporal" }
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

Cada estado devuelve **su propio código** (`pendiente_2fo`, `debe_cambiar_password`,
`debe_configurar_2fo`), el frontend rutea a la pantalla que corresponde, y el `sin_permiso` queda
reservado para lo que de verdad es falta de permiso.

### Las pruebas

```
prueba "ninguna ruta está en dos listas de estado":
    para cada par de estados: afirmar que sus listas no se cruzan

prueba "de todo estado se puede salir y se puede preguntar quién soy":
    para cada estado != "activa":
        afirmar "DELETE /auth/sesion" en ESTADOS[estado]
        afirmar "GET /auth/sesion"    en ESTADOS[estado]

prueba "un endpoint nuevo nace cerrado":
    para cada ruta del proyecto que no esté en ninguna lista:
        simular petición con sesión en cada estado restringido
        afirmar respuesta 403

prueba "la sesión pendiente no llega a nada real":
    sesion = crearSesion(estado: "pendiente_2fo")
    para cada ruta del proyecto fuera de ESTADOS["pendiente_2fo"]:
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
3. Las ocho tablas de identidad, cada una con su política escrita a mano. Ninguna con la genérica.
4. El rol de identidad **sin ningún permiso** sobre tablas de negocio. Falla fuerte, no vacío.
5. El rol del inquilino **sin ningún permiso** sobre `sesiones`, `permisos`, `roles`, `roles_permisos` ni
   `usuarios_roles`.
6. Una función que aplique el aislamiento a una tabla nueva, y una línea por tabla.
7. `nullif(…, '')` antes de castear la variable, y la subconsulta escalar alrededor.
8. Las tareas programadas y el enrutador de eventos **por bucle de organizaciones**, no por escotilla.
9. La prueba de catálogo que exige seguridad activada, forzada y con política en **toda** tabla.
10. Estados de sesión por **lista blanca de rutas**, con `GET` y `DELETE /auth/sesion` en las cuatro.
11. El orden entre estados: verificar el segundo factor antes que todo; **configurarlo después** de
    cambiar la contraseña temporal.
12. La sesión pendiente: 5 minutos, sin renovación, destruida al fallar el código.
13. Un código de respuesta distinto por estado, separado de `sin_permiso`.
