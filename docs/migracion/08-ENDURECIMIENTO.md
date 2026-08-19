# 08 — Endurecimiento: los huecos de los documentos anteriores

Este documento existe porque una revisión de los documentos `00` a `07` encontró cosas que **no
estaban**, y otras que **estaban dichas de una forma que no se sostiene** al aterrizarlas en un stack
real.

No es una lista de mejoras opcionales. Cada punto de acá es una de dos cosas:

- **una defensa que la serie promete y que, tal como está escrita, puede no existir** — el caso más
  grave, porque deja creer que hay dos capas cuando hay una;
- **un riesgo que la serie no menciona** y que en un sistema multiempresa termina en el mismo lugar:
  datos de un cliente vistos por otro.

Este documento es autosuficiente: no depende de los otros de la carpeta. Repite lo que necesita
repetir. Donde corrige algo de un documento anterior, lo dice y da el reemplazo completo.

> **Lo que hay que leer antes de escribir la primera línea:** las secciones **1**, **2** y **3**. Las
> tres condicionan decisiones que después cuestan una reescritura. El resto se puede aplicar por
> etapas.

---

## 0 · Los huecos, en orden de lo que cuesta descubrirlos tarde

| #      | Hueco                                                                                                               | Qué se creía                                          | Qué pasa en realidad                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **1**  | La seguridad a nivel de fila **no se aplica** a la conexión de la aplicación                                        | "Hay una segunda capa que protege si el código falla" | Si la aplicación se conecta como propietaria de las tablas, **la segunda capa no existe** |
| **2**  | La capa que inyecta el filtro **exige un cliente encadenable**                                                      | "El filtro se inyecta solo"                           | Con SQL en cadenas de texto **no hay nada que interceptar**                               |
| **3**  | La caché del framework y de la red de distribución **no sabe de organizaciones**                                    | Nada — no está mencionado                             | Una respuesta del cliente A servida al cliente B, **sin pasar por la capa de datos**      |
| **4**  | Las variables expuestas al navegador                                                                                | Nada                                                  | Un secreto con el prefijo público del empaquetador queda **publicado y permanente**       |
| **5**  | La sesión no tiene vencimiento absoluto                                                                             | "Vence a los 7 días"                                  | Usada a diario, **nunca vence**                                                           |
| **6**  | Los roles no tienen dueño                                                                                           | "Los roles son datos"                                 | El rol que pide un cliente **lo ven todos**, y se puede asignar cruzado                   |
| **7**  | El email es único a nivel global                                                                                    | Dicho, pero sin la consecuencia                       | **Nadie puede tener cuenta en dos organizaciones**                                        |
| **8**  | El cambio de organización no tiene capacidad ni auditoría                                                           | "El rol de plataforma puede cambiar de organización"  | Sin capacidad exigida y **sin registro de quién miró los datos de quién**                 |
| **9**  | Las credenciales no contemplan tokens con vencimiento y refresco                                                    | "Se guardan cifradas"                                 | Un token OAuth vence, y dos refrescos simultáneos **se invalidan entre sí**               |
| **10** | El segundo factor figuraba como "no incluido"                                                                       | Opcional                                              | Para el rol que ve **todas** las organizaciones, no puede ser opcional                    |
| **11** | Falta el resto: recuperación, sesiones visibles, exportación, límites de tasa, registros, migraciones, zona horaria | Varios "no incluye"                                   | Con clientes externos, varios dejan de ser opcionales                                     |

Y tres correcciones menores que ya conviene aplicar en el esquema: la vista de permisos con
`select distinct` en vez de `group by` sin agregación (hacen lo mismo; el `group by` se lee como un
error), el `revoke` escrito con nombres de roles que **solo existen en algunos proveedores** —en un
PostgreSQL puro no hay `anon` ni `authenticated` y la migración aborta: se revoca de `public` y de los
roles que uses—, y la cláusula `to` en toda política.

> **Sobre los huecos 5 y el de la cookie:** si venís de leer el esquema y la autenticación de esta
> carpeta, los vas a encontrar **ya aplicados ahí** — la columna de vencimiento absoluto está en el
> `create table` y el prefijo de la cookie está en la tabla de atributos. Se listan acá porque es donde
> se explica **por qué** hacen falta, y porque si estás implementando esto sobre un sistema que ya
> existe, casi seguro te faltan los dos.

---

## 1 · La segunda capa puede ser inerte — el hueco más grave

### El problema

Un esquema multiempresa suele activar seguridad a nivel de fila en todas las tablas y presentarla como
_la capa que protege de que alguien saltee el código entero_. Es una promesa fuerte y es la razón por la
que uno se permite confiar en la capa de aplicación.

**Esa promesa es falsa si la aplicación se conecta con el rol equivocado.** Concretamente:

- si se conecta con el rol **propietario** de las tablas, las políticas **no se le aplican** (el
  propietario está exento por omisión);
- si se conecta con un rol que tiene el atributo de **omisión** de seguridad a nivel de fila, tampoco;
- si el proveedor ofrece una "clave de servicio" pensada para el backend, esa clave normalmente
  corresponde a un rol de la primera o la segunda categoría.

Resultado: `enable row level security` figura en la migración, la revisión de código lo ve, todos
suponen que hay dos capas — **y hay una**.

> Lo peor de este hueco no es la falta de protección. Es la **confianza mal puesta**: uno acepta un
> atajo en la capa de aplicación pensando "igual la base me cubre".

### La solución, en cuatro piezas

**Pieza 1 · Un rol de base dedicado, que no sea propietario y no tenga omisión.**

```sql
-- El propietario de las tablas es otro rol (el de las migraciones).
create role aplicacion login password '<secreto>' noinherit nobypassrls;

grant usage on schema negocio to aplicacion;
grant select, insert, update, delete on all tables in schema negocio to aplicacion;
-- Nombrando el rol que crea las tablas: la regla NO se hereda.
alter default privileges for role migrador in schema negocio
  grant select, insert, update, delete on tables to aplicacion;

-- Y nada más: sin create, sin drop, sin alter. Las migraciones corren con el otro rol.
```

> **Dos advertencias sobre este bloque, y las dos importan más de lo que parecen.**
>
> **El esquema tiene que separar los datos de inquilino de los de identidad.** Si las tablas de sesiones,
> roles y auditoría vivieran en el mismo esquema que las de negocio, las dos líneas globales de arriba
> —`on all tables` y la regla por omisión— le darían a este rol **modificación y borrado sobre la
> identidad**: el hash de las contraseñas a su alcance y la auditoría "inmutable" borrable. Y
> `revoke … from public` no lo compensa: eso revoca del pseudo-rol público, no del rol al que se acaba de
> otorgar.
>
> **Y un rol no alcanza: hacen falta dos.** Este cubre el dominio del inquilino. El login busca al usuario
> por email **antes** de saber su organización, y con estas políticas puestas esa consulta devuelve cero
> filas: **nadie puede entrar.** Hace falta un segundo rol para el dominio de identidad, con cero permisos
> sobre las tablas de negocio. Está resuelto, con el SQL de las diez tablas, en el documento `09`.

**Pieza 2 · Forzar las políticas incluso para el propietario.** Es el cinturón además del tirante: si
un día alguien se conecta por error con el rol de las migraciones, las políticas siguen aplicando.

```sql
alter table pedidos enable row level security;
alter table pedidos force  row level security;   -- <-- esta línea es la que suele faltar
```

**Pieza 3 · Políticas que filtren por una variable de sesión.**

```sql
create policy aislamiento_pedidos on pedidos
  for all to aplicacion       -- <-- SIN esto, la política queda dirigida al pseudo-rol
  using      (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid))
  with check (org_id = (select nullif(btrim(current_setting('app.org_id', true)), '')::uuid));
```

**La cláusula `to` no es opcional.** Una política sin ella se aplica a **todos** los roles, incluido el
que después va a necesitar una excepción para el login. Dirigirla al rol desde el principio es lo que
permite tener dos dominios sin tocar esta política nunca más.

Tres detalles, y el primero es el que casi nadie escribe:

- **`nullif(btrim(…), '')` antes del casteo, no el casteo desnudo.** El segundo argumento en `true` hace
  que la función devuelva nulo cuando la variable **nunca** se puso — pero después del primer
  `set_config` de esa conexión, el valor de reposo del parámetro **no vuelve a nulo: queda en cadena
  vacía**. Y `''::uuid` **lanza un error de sintaxis**, no devuelve nulo. Sin el `nullif`, la política
  falla cerrado la primera vez y **revienta** las siguientes.
- **`with check` además de `using`**: sin él se puede leer filtrado pero **escribir** una fila con la
  organización de otro.
- **La subconsulta escalar alrededor.** Sin ella la función se evalúa una vez por fila; envuelta,
  normalmente se resuelve una sola vez por consulta. Es comportamiento del planificador, no un contrato:
  **medilo con un plan de ejecución** antes y después, porque tiene una contrapartida real — el valor
  pasa a ser desconocido en tiempo de plan y se pierde la estimación por estadísticas de la columna, lo
  que en una tabla grande puede terminar en un recorrido completo.

> **Falla cerrado de dos formas distintas, y conviene saberlo antes de escribir la prueba:** sin
> organización en contexto, la consulta devuelve **cero filas** si la variable nunca se puso en esa
> conexión, y **lanza** si se puso y se reseteó. Las dos son seguras. Una prueba que exija exactamente
> "cero filas" pasa o falla según cuántas veces se usó la conexión antes.

**Pieza 4 · La variable se pone con `set local`, dentro de una transacción.**

```
funcion conOrganizacion(orgId, trabajo):
    en transaccion:
        # is_local = true equivale a SET LOCAL: muere al terminar la transacción.
        ejecutar("select set_config('app.org_id', $1, true)", [orgId])
        devolver trabajo()
```

**Por qué `set_config` y no `set local app.org_id = $1`:** la sentencia `SET` **no acepta parámetros**.
Escrita a mano obliga a interpolar el valor en el texto de la consulta, que es exactamente lo que uno
no quiere hacer con un identificador que viene de una sesión. `set_config` es una función normal y
toma parámetros.

**Por qué dentro de una transacción, y no una vez por conexión:** porque la conexión se reutiliza. Si
la variable se pone con alcance de sesión, la siguiente petición —que puede ser de otra
organización— **hereda la variable de la anterior**. Con alcance de transacción la variable muere con
ella y ese escenario no existe.

> **Y el `begin` explícito no es opcional, por un motivo que muerde en silencio.** Fuera de una
> transacción, `set local` al menos **avisa** con una advertencia de que no hizo nada. La forma
> parametrizable —`set_config(…, true)`— **no avisa nada: tiene éxito y no hace nada.**
>
> El resultado es una operación que cree tener contexto y no lo tiene. Como no hay advertencia que lo
> delate, hacen falta dos cosas: una **verificación propia en el código** (después de poner la variable,
> leerla y confirmar que quedó) y una **prueba que corra la consulta sin abrir transacción** y exija que
> la política la rechace.

Consecuencia de diseño que hay que aceptar de frente: **toda operación que dependa del filtro de la
base corre dentro de una transacción.** No es un detalle de implementación, es una restricción.

> **Y una segunda consecuencia, que rompe el login si no se prevé.** Hay operaciones que legítimamente
> corren **sin** organización en contexto: la primera es el login, que busca un usuario por email antes de
> saber de qué organización es. Con estas políticas puestas, esa consulta evalúa `org_id = null`, devuelve
> **cero filas**, y **nadie puede entrar**.
>
> La salida rápida y equivocada es agregarle un escape a la política —`or current_setting('app.modo_global')
= 'on'`—, que cualquier línea de la aplicación puede encender: no es una barrera, es un comentario, y
> desactiva todo esto de un solo golpe.
>
> La salida correcta es **un segundo rol de base** para el dominio de identidad (organizaciones, usuarios,
> sesiones, roles, permisos, auditoría), con **cero permisos** sobre las tablas de negocio. Está resuelto,
> con el SQL completo de las ocho tablas, en el documento `09`.

### El agrupador de conexiones, que es parte de esto

En ejecución sin servidor cada instancia abre conexiones propias y la base se queda sin cupo enseguida.
Hace falta un agrupador. Y su modo de operación **interactúa directamente con lo anterior**:

| Modo del agrupador   | Compatible con `set local` en transacción | Compatible con `set` de sesión                                 |
| -------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| **Modo transacción** | **Sí** — es la combinación correcta       | **No**, y es peligroso: la variable se filtra entre inquilinos |
| Modo sesión          | Sí                                        | Sí, pero consume una conexión por cliente y no escala          |

**Recomendación: agrupador en modo transacción + `set local`.** Y verificar si tu agrupador exige
desactivar las sentencias preparadas en ese modo — algunos sí.

### Cómo comprobar que la segunda capa existe de verdad

Tres pruebas. Sin ellas esta sección es una intención.

```
prueba "el rol de la aplicación no puede saltear las políticas":
    conectar como el rol de la aplicación
    fila = consultar("select current_user,
                             (select rolbypassrls from pg_roles where rolname = current_user) as omite,
                             current_setting('is_superuser') as super")
    afirmar fila.omite == falso
    afirmar fila.super == "off"

prueba "sin organización en contexto, no se ve nada":
    conectar como el rol de la aplicación   # sin poner la variable
    resultado = intentar consultar("select count(*) from pedidos")
    # Las dos son correctas: cero filas si la variable nunca se puso en esta
    # conexión, error si se puso y se reseteó a cadena vacía. Lo que NO puede
    # pasar es que devuelva filas.
    afirmar resultado.lanzo o resultado.count == 0

prueba "con la organización A, ninguna fila de la B":
    # El sembrado NO lo puede hacer el rol propietario: `force row level security`
    # existe justamente para que no quede exento, y para el propietario no hay
    # política aplicable, así que el alta se rechaza. Se siembra por el mismo
    # mecanismo que usa la aplicación:
    conOrganizacion(A, () => insertar pedido)
    conOrganizacion(B, () => insertar pedido)
    conOrganizacion(A):
        filas = consultar("select org_id from pedidos")
    afirmar filas.todas(f => f.org_id == A)
    afirmar filas.largo == 1
```

La primera es la que importa. **Si esa prueba no existe, no se puede afirmar que haya dos capas** — y
entonces conviene escribir en la documentación del proyecto que la única defensa real es la capa de
aplicación, y tratarla con ese rigor. Es peor creer que hay dos y tener una que saber que hay una.

---

## 2 · La decisión que decide el aislamiento: cliente encadenable o SQL crudo

### El problema

El mecanismo central de un diseño así —una capa que envuelve el cliente de base de datos y **agrega
sola** el filtro por organización— tiene un requisito que casi nunca se dice: **el cliente tiene que
ser encadenable e interceptable.**

Si la decisión es escribir SQL en cadenas de texto, no hay nada que interceptar. El filtro pasa a
depender de que la persona que escribe cada consulta se acuerde de agregarlo. Y esa es exactamente la
disciplina que el diseño existía para no necesitar.

Es la decisión más fácil de tomar sin darse cuenta —se toma eligiendo una biblioteca en la primera
hora— y la más cara de revertir.

### La solución

| Forma de hablar con la base                                    | Permite inyectar el filtro        | Qué hacer                                                    |
| -------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------ |
| Constructor de consultas encadenable                           | **Sí**                            | Es la opción recomendada. La capa envuelve el constructor    |
| Cliente de un proveedor con API encadenable, desde el servidor | **Sí, si sostiene transacciones** | Ver la advertencia de abajo: varios de éstos hablan por HTTP |
| Cartografiador objeto-relacional con criterios encadenables    | Parcial                           | Funciona si expone un punto de intercepción global           |
| Controlador crudo con SQL en cadenas o plantillas              | **No**                            | Ver abajo: hay que cambiar de mecanismo, no seguir igual     |

**Si se termina en SQL crudo** —y es una decisión legítima— el aislamiento se reconstruye con tres
piezas distintas, y las tres son obligatorias:

1. **La seguridad a nivel de fila de la § 1 deja de ser "la segunda capa" y pasa a ser la única.** Se
   trata con ese rigor: rol dedicado, `force`, políticas con `with check`, `set local` en transacción,
   y las tres pruebas.
2. **Un repositorio por entidad**, que recibe la organización en su construcción y la agrega a cada
   consulta. Nada de negocio escribe SQL: lo escriben los repositorios.
3. **Una prueba que lea el código fuente** y verifique que **ningún archivo fuera de la carpeta de
   repositorios importa el controlador de base de datos.** Es lo único que evita que aparezca una
   consulta suelta en un endpoint un viernes.

> El criterio para decidir, dicho sin vueltas: perder la capacidad de inyectar el filtro para ahorrar
> una dependencia es un mal negocio en un sistema donde el costo de un error es "el cliente A vio los
> datos del cliente B".

> **Y una segunda pregunta que hay que hacerle al controlador, antes de elegirlo: ¿sostiene una
> transacción interactiva?**
>
> Todo el § 1 depende de abrir una transacción, poner una variable y trabajar dentro. Varios
> controladores pensados para ejecución sin servidor hablan por HTTP y **solo aceptan consultas sueltas o
> lotes cerrados**: con ésos, el filtro de la base **no se puede implementar**, por más encadenable que
> sea su interfaz. Es una pregunta de cinco minutos que hay que hacerse en la primera hora, porque
> descubrirlo con el código escrito obliga a cambiar de controlador.

### Y una consecuencia si el lenguaje no tiene tipos

La preferencia habitual por un objeto interpuesto sobre un envoltorio explícito se argumenta con que
"conserva los tipos". **En un lenguaje sin tipos estáticos ese argumento no existe**, y el peso se
traslada entero a las pruebas que leen el código fuente: pasan de recomendables a ser el único
mecanismo de control real.

Por eso, en un proyecto sin tipos: **el corredor de pruebas y la integración continua son la etapa
cero**, antes del esquema. Si las pruebas arquitectónicas no tienen dónde correr, no existen.

---

## 3 · La caché entre inquilinos — el riesgo que no pasa por la capa de datos

### El problema

Los frameworks de renderizado en servidor traen varias cachés que **no saben nada de
organizaciones**: caché de ruta completa, caché de datos, memorización de funciones, y la caché de la
red de distribución del hosting cuando la respuesta lleva una cabecera pública.

Una respuesta con datos del cliente A, almacenada por cualquiera de esas cachés y servida al cliente
B, es **exactamente la falla que todo el diseño intenta evitar** — y llega por un camino donde la capa
de datos, el portero de permisos y las políticas de la base **no participan**. Todo funcionó bien: la
consulta se filtró, el permiso se verificó, y la respuesta se entregó a otro.

Es el hueco más grave del entorno porque **ninguna de las defensas anteriores lo mira**.

### La solución: cinco reglas y una prueba

1. **Toda ruta autenticada se declara dinámica, explícitamente.** Leer la cookie normalmente ya la
   vuelve dinámica, pero declararlo hace que no dependa de un detalle de implementación del framework
   ni de una refactorización que mueva la lectura de la cookie a otro lado.
2. **Ninguna respuesta autenticada lleva cabecera de caché pública.** Por omisión: `no-store`. Una
   respuesta con datos de un inquilino y `Cache-Control: public` es la fuga en una línea.
3. **Toda memorización o caché de datos incluye la organización efectiva en la clave.** Sin
   excepciones, y "efectiva" significa la que está mirando el usuario, no la de su perfil — importa
   cuando existe el rol de plataforma que cambia de organización.
4. **Las cachés con tiempo de vida no se usan para datos de inquilinos.** Solo para datos globales
   (catálogo de capacidades, listas de referencia). Si hace falta cachear datos de un inquilino, va en
   una caché con la organización en la clave y una invalidación explícita, no en una con vencimiento
   por tiempo.
5. **Las funciones que el framework expone automáticamente como endpoints** —el patrón de "acciones de
   servidor", donde una función marcada de cierta forma queda invocable por HTTP desde afuera— **son
   endpoints públicos.** Cada una llama al portero de permisos igual que una ruta. Y esto tiene una
   consecuencia para la prueba: **una prueba que recorra los archivos de rutas no las ve.**

```
prueba "ninguna ruta autenticada se cachea":
    para cada archivo bajo la carpeta de rutas del API:
        si menciona alguna primitiva de caché o revalidación:
            afirmar que el archivo está en la LISTA_AUTORIZADA
    # La lista autorizada es corta, explícita, y cada entrada tiene un comentario
    # que dice por qué esa ruta puede cachearse (típicamente: no lee datos de inquilinos).

prueba "el portero cubre también las funciones expuestas automáticamente":
    para cada archivo del proyecto que contenga la marca de función de servidor:
        afirmar que el archivo llama al portero
```

---

## 4 · Los secretos que terminan publicados

### El problema

Los empaquetadores modernos exponen al navegador las variables de entorno que llevan cierto prefijo
(`PUBLIC_`, `NEXT_PUBLIC_`, `VITE_`, según la herramienta). El mecanismo es útil y la trampa es obvia
una vez dicha: **una variable con ese prefijo que contenga la clave maestra de cifrado, la contraseña
del rol de base o el token de un cliente es una filtración total, permanente y publicada.**

Permanente porque queda en un paquete que la gente ya descargó, y en la caché de la red de
distribución.

Y hay una variante más silenciosa: los proveedores que ofrecen una **clave pública para el navegador**
más políticas de base que la acotan. Ese modelo empuja a poner la clave en el paquete. En un sistema
multiempresa es un intercambio malo: la clave viaja a todos los clientes, y todo el aislamiento queda
apoyado en que las políticas estén perfectas para siempre.

### La solución

1. **Ningún secreto lleva el prefijo público. Nunca.** El frontend no necesita ninguna credencial: le
   habla a tu backend con la cookie de sesión.
2. **Si tu proveedor de base ofrece una clave para el navegador, no se publica y no se usa.** Y si eso
   parece difícil de sostener con varias personas en el equipo, elegí un proveedor donde **esa clave no
   exista**: la mejor protección es que la puerta peligrosa no esté.
3. **La prueba más barata del proyecto**, y la que conviene escribir primero:

```
prueba "el paquete del navegador no contiene secretos":
    construir el proyecto
    contenido = leer todos los archivos del directorio de salida
    para cada NOMBRE en la lista de variables secretas:
        afirmar que contenido no menciona NOMBRE
        afirmar que contenido no contiene el VALOR de esa variable
```

Buscar los **valores** y no solo los nombres es lo que la hace útil: agarra el caso de alguien que
copió el secreto a un archivo de configuración del frontend "por un rato".

---

## 5 · Sesiones: cuatro endurecimientos

### 5.1 · El vencimiento absoluto

Un esquema de sesión deslizante —vence en 7 días, se renueva al usarse— tiene una consecuencia que hay
que ver: **una sesión que se usa todos los días nunca vence.** Un token robado de un navegador vive
para siempre mientras el ladrón lo siga usando.

**La solución es una columna y una condición:**

```sql
-- Si estás creando el esquema desde cero, esta columna va DENTRO del `create table`
-- de sesiones y este `alter` no hace falta. Va con `if not exists` porque el error
-- más tonto de esta sección es aplicarlo sobre un esquema que ya la trae y abortar
-- la migración entera por una columna duplicada.
alter table sesiones
  add column if not exists expira_absoluto timestamptz not null
    default now() + interval '30 days';
```

```sql
select … from sesiones
 where token_hash = $1
   and expira_el       > now()     -- el deslizante, que se renueva
   and expira_absoluto > now()     -- el techo duro, que no
```

La renovación deslizante **nunca** toca `expira_absoluto`. A los 30 días hay que volver a autenticarse,
y punto.

### 5.2 · El prefijo `__Host-` en la cookie

`HttpOnly; Secure; SameSite=Lax; Path=/` son cuatro disciplinas que alguien puede aflojar en un
refactor. El prefijo las convierte en una garantía del navegador:

```
__Host-sesion=<token>; Path=/; HttpOnly; Secure; SameSite=Lax
```

Con ese prefijo, el navegador **rechaza** la cookie si no lleva `Secure`, si no tiene `Path=/`, o si
declara `Domain`. Y de paso impide que un subdominio comprometido escriba nuestra cookie.

Costo: seis caracteres en el nombre.

### 5.3 · La verificación de origen

`SameSite=Lax` cubre el caso común de petición desde otro sitio, pero es una defensa del navegador y
depende de su versión y su configuración. La verificación de origen es independiente y cuesta tres
líneas en el portero:

```
funcion verificarOrigen(peticion):
    si peticion.metodo en ["GET", "HEAD", "OPTIONS"]: devolver ok
    origen = peticion.cabecera("Origin")
    si no origen o dominioDe(origen) != DOMINIO_ESPERADO:
        responder 403 "Origen no permitido"; devolver cortar
```

Va en el portero, junto a la verificación de sesión, para que ninguna operación que modifica pueda
saltearla.

### 5.4 · La dirección de origen del bloqueo por intentos es falsificable

Un bloqueo por intentos fallidos por dirección de origen depende de identificar bien esa dirección. La
cabecera `X-Forwarded-For` es **una lista, y el cliente controla el principio.** Tomar el primer valor
tiene dos consecuencias, y la segunda es peor que la primera:

- un atacante manda una dirección distinta en cada intento y **evade el freno por completo**;
- un atacante manda la dirección de **otra persona** y la deja bloqueada a voluntad.

**La solución:** tomar el valor que tu plataforma garantiza —la mayoría de los hostings agregan una
cabecera propia con la dirección real, o documentan cuántos proxies confiables hay para contar desde
el final de la lista— y no el primer elemento de la cadena.

Y probarlo:

```
prueba "una cabecera falsificada no evade el freno por origen":
    # Ojo con el umbral: si el freno por CUENTA salta antes que el por ORIGEN,
    # la prueba pasa por el motivo equivocado y no verifica nada de lo que dice.
    # Se usan cuentas DISTINTAS para que solo pueda saltar el freno por origen.
    para i en 1..(TOPE_POR_ORIGEN + 1):
        intentarLogin(email: "inexistente" + i + "@ejemplo.com", password: "mal",
                      cabeceras: { "X-Forwarded-For": "1.2.3." + i })
    afirmar que el último responde el código del freno por origen
```

Cinco minutos de prueba deciden si el freno existe o es decorativo.

### 5.5 · Las sesiones visibles y revocables por el usuario

La tabla de sesiones ya guarda dirección de origen, navegador y fecha. Falta la pantalla, y es poco
trabajo:

```
GET    /auth/sesiones            -> lista las del usuario: dispositivo, origen, última vez, actual sí/no
DELETE /auth/sesiones/{id}       -> cierra una
DELETE /auth/sesiones            -> cierra todas menos la actual
```

**El token no se devuelve nunca**, ni un fragmento. La lista usa el identificador de la fila.

**Y la lista solo muestra las sesiones habilitadas.** Una sesión que espera el código del segundo factor
todavía no es una sesión de nadie: aparecer ahí solo confunde, y peor, se podría cerrar la sesión desde
la que se está intentando entrar.

Es lo primero que mira alguien evaluando si un proveedor se toma la seguridad en serio, y resuelve por
sí sola el caso "me parece que alguien entró a mi cuenta".

---

## 6 · Los roles necesitan dueño

### El problema

Un catálogo de roles con clave única **global** y sin columna de organización significa que **todos los
clientes comparten los mismos roles**. Si el cliente A pide un rol "supervisor de obra", ese rol
aparece en la pantalla de administración del cliente B.

Y hay un segundo problema, más grave que el cosmético: **nada impide asignar un rol de la organización
A a un usuario de la B.** La clave foránea se satisface, el identificador existe.

### La solución

```sql
-- nulo = plantilla global, definida por la plataforma.
-- con valor = rol privado de esa organización.
alter table roles add column org_id uuid references organizaciones(id) on delete cascade;

drop index if exists roles_clave_unica;
create unique index roles_clave_unica
  on roles (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), clave);
```

El `coalesce` con un identificador nulo constante es lo que hace que la unicidad funcione también para
las plantillas globales: sin él, un índice sobre `(org_id, clave)` permitiría dos plantillas globales
con la misma clave, porque en un índice único los nulos no se comparan entre sí.

Tres condiciones para que eso sea correcto, y la primera es la que suele faltar:

- **`clave` tiene que ser `not null`.** La regla de que los nulos no se comparan aplica a **todas** las
  columnas del índice: con `clave` nula, la fila queda exenta igual y el centinela no sirve de nada.
- **Hay que impedir que el centinela exista como dato**, o la colisión es real:

  ```sql
  alter table organizaciones add constraint org_no_nula
    check (id <> '00000000-0000-0000-0000-000000000000'::uuid);
  ```

- **Un índice único sobre una expresión no puede declararse como restricción de tabla**, solo como
  índice. Consecuencia práctica: no es referenciable por una clave foránea, y todo `on conflict` tiene
  que repetir la expresión literal.

Si tu motor lo admite, `nulls not distinct` en el índice es más limpio que el centinela. Y si querés
evitar las dos cosas, dos índices parciales —uno con la organización, otro para las plantillas
globales— funcionan en cualquier versión.

Y el disparador que cierra la asignación cruzada:

```sql
create or replace function roles_no_cruzan_organizaciones() returns trigger as $$
declare
  rol_org     uuid;
  usuario_org uuid;
begin
  select org_id into rol_org     from roles    where id = new.rol_id;
  select org_id into usuario_org from usuarios where id = new.usuario_id;

  -- Un rol global (org_id nulo) se puede asignar a cualquiera.
  -- Un rol privado, solo a usuarios de su propia organización.
  if rol_org is not null and rol_org is distinct from usuario_org then
    raise exception 'Ese rol pertenece a otra organización';
  end if;
  return new;
end $$ language plpgsql;

create trigger usuarios_roles_no_cruzan
  before insert or update on usuarios_roles
  for each row execute function roles_no_cruzan_organizaciones();
```

### Y una recomendación de secuencia

**Creá la columna vacía desde la primera migración, aunque al principio definas todos los roles vos.**
Agregarla sin datos cuesta cero; agregarla cuando ya hay asignaciones repartidas entre clientes cuesta
una migración de datos que hay que pensar caso por caso.

La decisión de **exponer o no** la creación de roles a los administradores de cada cliente se puede
tomar después. La columna, no.

---

## 7 · El email único a nivel global: decidilo a propósito

### El problema

Un índice único sobre `lower(email)` **sin la organización** es coherente con "un usuario pertenece a
una organización", y tiene una consecuencia que casi nunca está escrita: **una misma persona no puede
tener cuenta en dos organizaciones**, ni con roles distintos.

Y cuando pasa —el dueño de una empresa cliente que también es socio de otra— el alta falla con un
`email_duplicado` que no explica nada, en la organización B, sobre una fila que el administrador de B
**no puede ver**.

### Las dos opciones, con lo que cuesta cada una

| Opción                                          | A favor                                                               | En contra                                                                                                                       |
| ----------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Único global** (`lower(email)`)               | El login es **una sola pantalla**: email y contraseña, sin ambigüedad | Nadie puede estar en dos organizaciones                                                                                         |
| Único por organización `(org_id, lower(email))` | Una persona puede tener cuenta en varias                              | El login se vuelve ambiguo: hace falta un selector de organización o un subdominio por cliente — y el subdominio trae el § 11.6 |

### La recomendación

**Mantener la unicidad global**, y **escribir el mensaje de error para que explique la situación real**:

> _"Ese correo ya tiene una cuenta en el sistema. Si la persona trabaja en otra organización,
> contactanos: hay que resolverlo desde la administración."_

Sin filtrar **en qué** organización existe la cuenta: eso sería enumerar clientes. El mensaje admite
que el sistema sabe algo que quien lo lee no puede ver, en vez de fingir un error genérico.

Y documentarlo como limitación conocida en el documento de tu proyecto. Una limitación escrita es una
decisión; la misma limitación sin escribir es un defecto esperando un ticket.

---

## 8 · El cambio de organización: capacidad, verificación y auditoría

### El problema

Cuando existe un rol de plataforma que puede mirar la organización de un cliente, la operación que
cambia "la organización activa" de la sesión es una de las más sensibles del sistema, y es fácil que
quede sin clasificar: sin capacidad exigida, sin verificar el destino y **sin dejar rastro**.

Dos cosas distintas fallan acá:

- **Seguridad:** si la operación no exige nada, cualquier usuario con sesión puede escribir su
  organización activa. Puede que no sea explotable porque otra capa ignore ese valor para quien no
  tiene el rol de plataforma — pero entonces toda la defensa depende de un solo lugar.
- **Privacidad:** cuando alguien del equipo entra a mirar la organización de un cliente, está mirando
  **datos de personas reales**. Un cartel en la interfaz protege al operador de confundirse. **No
  protege al cliente.**

### La solución

```
PATCH /auth/sesion   { org_activa }     requiere: organizaciones.listar

1. Verificar la capacidad — explícitamente, no por omisión.
2. Verificar que la organización destino EXISTE y está ACTIVA.
3. Escribir la organización activa en la sesión.
4. AUDITAR: quién, cuándo, desde qué organización, a qué organización, desde qué origen.
5. Limitar la tasa de esta operación como cualquier otra sensible.
```

El punto 4 es el que hay que agregar y el que no suele estar. Con eso:

- se puede responder **"¿quién de ustedes vio nuestros datos y cuándo?"** con una consulta, que es el
  tipo de pregunta que llega por contrato o por una revisión de tratamiento de datos;
- se detecta el uso indebido de una cuenta de plataforma, que de otro modo es invisible;
- y sirve para vos: es el registro que explica por qué alguien vio algo raro un martes.

**El registro de acceso de soporte conviene poder mostrárselo al cliente.** Un endpoint que le lista a
un administrador los accesos de la plataforma a **su** organización convierte el mayor riesgo del
sistema en un argumento de confianza.

---

## 9 · Credenciales con vencimiento y refresco

### El problema

Un modelo de credenciales por organización con columnas de texto cifrado sirve para claves
permanentes. Pero los tokens de la mayoría de las plataformas externas —anuncios, mensajería,
agendas, pagos— **son OAuth: vencen, y se renuevan con un token de refresco.**

Y hay un detalle que rompe implementaciones ingenuas: **varias plataformas invalidan el token de
refresco al usarlo.** Dos peticiones simultáneas que detectan el token vencido y refrescan a la vez
**se invalidan entre sí**, y la organización queda desconectada. Es un fallo intermitente, que aparece
con carga y no se reproduce localmente.

### La solución

**Las columnas que faltan:**

```sql
alter table organizaciones_credenciales
  add column crm_refresh_cifrado text,
  add column crm_expira_el       timestamptz,
  add column crm_estado          text not null default 'ausente'
    check (crm_estado in ('ausente', 'activa', 'vencida', 'revocada'));
```

**Cuatro estados, no dos.** La distinción entre `ausente` ("nunca se cargó") y `vencida` ("se cargó y
dejó de servir") y `revocada` ("el cliente cortó el acceso desde su panel") es exactamente la clase de
distinción que un buen diseño de datos exige en todas partes: **un valor significa una sola cosa**. Y
cada uno pide un texto distinto en la interfaz:

| Estado     | Qué dice la interfaz                                 |
| ---------- | ---------------------------------------------------- |
| `ausente`  | "Falta conectar esta integración"                    |
| `activa`   | Nada; funciona                                       |
| `vencida`  | "La conexión venció. Hay que volver a autorizarla"   |
| `revocada` | "El acceso fue revocado desde el panel del servicio" |

**Nunca mostrar cero.** Si una organización dejó de operar porque su token murió, la pantalla dice eso
— no muestra métricas en cero como si el negocio se hubiera detenido. Es la misma regla de siempre: un
cero medido y un cero por falta de datos no son el mismo hecho.

**El refresco, con candado:**

```
funcion tokenVigente(orgId, servicio):
    en transaccion:
        # Candado a nivel de base, por organización y servicio.
        # Dos peticiones simultáneas: la segunda espera, y cuando entra
        # encuentra el token ya renovado y no refresca de nuevo.
        bloquearFila("select … from organizaciones_credenciales
                       where org_id = $1 for update", orgId)

        cred = leerCredencial(orgId, servicio)
        si cred.expira_el y cred.expira_el > ahora() + MARGEN:
            devolver descifrar(cred.token_cifrado)     # sigue vigente

        resultado = pedirTokenNuevo(descifrar(cred.refresh_cifrado))
        si resultado.revocado:
            marcarEstado(orgId, servicio, "revocada")
            lanzar "El cliente revocó el acceso. Hay que volver a autorizar"

        guardar({
            token_cifrado:   cifrar(resultado.token),
            refresh_cifrado: cifrar(resultado.refresh ?? cred.refresh_plano),
            expira_el:       ahora() + resultado.duracion,
            estado:          "activa",
        })
        devolver resultado.token
```

Tres cosas de ese pseudocódigo que son deliberadas:

- **el candado es de la base, no del proceso.** Un candado en memoria no sirve: hay varias instancias.
- **el margen** (unos minutos) evita usar un token que vence mientras la petición viaja.
- **el token de refresco nuevo se guarda si vino**; algunas plataformas rotan también el de refresco, y
  perderlo desconecta al cliente sin aviso.

**Y la regla que ya valía y acá vale doble: nunca un valor por defecto que use la credencial de otra
organización.** Un `??` al final de una línea que dice "si esta organización no tiene token, usá el
global" convierte "no opera" en "opera en la cuenta de otro". Los respaldos son explícitos, nombrados
y acotados a la organización que corresponde.

---

## 10 · El segundo factor deja de ser opcional para el rol de plataforma

### El problema

Una cuenta con el rol de plataforma ve **todos** los datos de **todas** las organizaciones. Una
contraseña filtrada de una de esas cuentas no es una brecha de un cliente: **es una brecha de todos
los clientes a la vez.**

Listar el segundo factor como "no incluido" es razonable para un sistema de una sola empresa. Con
clientes externos, para el rol que ve a todos, no lo es.

### La solución

```sql
create table usuarios_segundo_factor (
  usuario_id     uuid primary key references usuarios(id) on delete cascade,
  secreto_cifrado text not null,          -- cifrado con la clave maestra, como cualquier secreto
  confirmado_el  timestamptz,             -- nulo = alta empezada y no terminada
  respaldos_hash text[] not null default '{}',   -- códigos de un solo uso, hasheados
  creado_el      timestamptz not null default now()
);
alter table usuarios_segundo_factor enable row level security;
alter table usuarios_segundo_factor force  row level security;
revoke all on usuarios_segundo_factor from public;
```

**Dónde encaja en el login**, entre verificar la contraseña y entregar la sesión utilizable:

```
… contraseña verificada …

# CUATRO ramas, en este orden. La segunda es la que se olvida, y sin ella el
# encierro por contraseña temporal deja de existir sin que nada falle.
si el usuario tiene segundo factor CONFIRMADO:
    estado = "pendiente_2fo"           # no probó quién es: gana sobre todo lo demás
sino si el usuario debe cambiar la contraseña:
    estado = "debe_cambiar_password"   # ANTES de configurar el segundo factor
sino si alguno de sus roles exige segundo factor:
    estado = "debe_configurar_2fo"
sino:
    estado = "activa"

sesion = crearSesion(usuario, estado)
responder 200 { estado }

# Y el portero solo deja pasar las rutas NOMBRADAS para ese estado — entre ellas
# consultar la sesión y cerrarla, que tienen que estar en los cuatro. Eso es lo
# que hace que el paso no se pueda saltear ni deje a nadie encerrado.
```

**La obligatoriedad se declara en el rol, no en el código:** una bandera `exige_segundo_factor` en la
tabla de roles, encendida para todo rol de plataforma. Así queda dentro del modelo extensible: un rol
nuevo y sensible se marca con una fila, sin tocar el login.

**Y las dos columnas que todo esto necesita**, que son fáciles de dar por sentadas y no existen hasta que
alguien las escribe:

```sql
-- Dónde vive el estado. POR SESIÓN, no por usuario: dos sesiones de la misma
-- persona, una verificada y otra no, son estados distintos y no se derivan de
-- la fila del usuario.
alter table sesiones add column if not exists estado text not null default 'activa'
  check (estado in ('activa', 'pendiente_2fo',
                    'debe_cambiar_password', 'debe_configurar_2fo'));

-- Dónde vive la obligatoriedad.
alter table roles add column if not exists exige_segundo_factor boolean not null default false;
```

Sin la primera columna, todo el mecanismo de estados **es inimplementable** — y falla en la dirección
peligrosa: si el estado no se persiste, el encierro por contraseña temporal desaparece y nada falla.

**Detalles que suelen faltar:**

- los **códigos de respaldo** se generan al configurarlo, se muestran una vez, se guardan hasheados y
  **se consumen** al usarse. Sin ellos, un teléfono perdido es una cuenta perdida;
- el bloqueo por intentos aplica **también** al código, y agotarlo **destruye la sesión pendiente**;
- una sesión que espera el código es una sesión **sin identidad probada**: vence en minutos, no se
  renueva, y no figura en la lista de sesiones activas del usuario;
- **el orden entre estados no es el obvio.** Si el segundo factor ya está configurado y falta verificarlo,
  gana siempre. Pero si falta **configurarlo** y además hay contraseña temporal sin cambiar, gana **la
  contraseña temporal**: la temporal la conoce quien creó la cuenta, y configurar el segundo factor
  primero le permitiría inscribir **su** dispositivo en la cuenta de otro;
- desactivar el segundo factor de otra persona es una acción con su propia capacidad y su propia
  auditoría, nunca un campo del formulario de edición;
- el secreto se guarda **cifrado**, no en claro. Es una credencial como cualquier otra.

---

## 11 · El resto: seis cosas que dejan de ser opcionales con clientes externos

### 11.1 · Recuperación de contraseña

Si la única forma de recuperar una contraseña es que la restablezca un administrador, con clientes
externos eso significa que **vos** atendés cada olvido de cada empleado de cada cliente. Es carga
operativa, y algo peor: **un canal donde alguien puede llamar haciéndose pasar por otro** y pedir un
restablecimiento. Ingeniería social, sin tecnología.

**Dos opciones, y la primera es gratis:**

1. **Que el administrador de cada cliente lo haga en su propia organización.** Ya es posible con la
   capacidad de editar usuarios: solo hay que asegurarse de que el rol de administrador de cliente la
   tenga, y que la operación esté acotada a su organización. **Resuelve el 90 %** y mueve el riesgo de
   ingeniería social a quien conoce a su propia gente.
2. **Recuperación por correo con token de un solo uso.** Si se implementa: token aleatorio largo, se
   guarda **hasheado**, vence en 30 minutos, se consume al usarse, **cierra todas las sesiones** del
   usuario, y la respuesta es **la misma** exista o no la cuenta — si no, es un enumerador de emails.

   Y la tabla que los guarda **no tiene columna de organización** —se consulta antes de saber quién es
   nadie—, así que pertenece al **dominio de identidad**: va con su permiso y su política escritos a mano,
   y sin acceso alguno para el rol del inquilino. Es la regla para toda tabla nueva de esa clase.

### 11.2 · Los registros son un lugar donde acaban las contraseñas

Una línea que registre el cuerpo de la petición en el endpoint de login escribe **contraseñas en
claro** en un panel al que accede todo el equipo y que se conserva. Es el error más fácil de cometer
depurando de noche y el más difícil de revertir: los registros ya se guardaron.

Lo mismo con la respuesta del alta de usuario, que lleva la contraseña temporal.

**Reglas:**

- el manejador de login, el de cambio de contraseña y el de alta de usuario **nunca** registran cuerpos
  de petición ni de respuesta. **Ni en desarrollo** — el registro de desarrollo es el que termina
  desplegado;
- ninguna instrumentación ni intermediario registra cuerpos completos en esas rutas;
- una prueba que verifique que ningún archivo de esas rutas llama a la función de registro con el
  cuerpo.

### 11.3 · Las respuestas de error no revelan estructura

Un error no capturado puede devolver el texto de la consulta, nombres de tablas o fragmentos del
esquema. **Toda respuesta de error del API devuelve un código estable y un mensaje genérico**; el
detalle va al registro del servidor.

La excepción deliberada: los mensajes de los disparadores de la base escritos para leerse ("El
administrador principal no se puede degradar") sí se devuelven tal cual — son parte de la interfaz, no
una filtración. La diferencia es que están escritos a propósito para un humano.

### 11.4 · Límite de tasa fuera del login

Es habitual poner el freno solo en el login. Faltan al menos:

| Operación                       | Por qué                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| Cambio de contraseña            | Adivinar la contraseña actual de una sesión robada                        |
| Alta de usuarios                | Crear cuentas en masa, agotar la base                                     |
| Restablecer contraseña          | Generar temporales en serie                                               |
| Cambio de organización          | Recorrer organizaciones para enumerarlas                                  |
| Verificación del segundo factor | Un código de seis dígitos sin freno es un código de seis dígitos regalado |

### 11.5 · Herramienta de migraciones, antes de la primera tabla

Buena parte de este diseño vive en **restricciones y disparadores**. Sin una herramienta de
migraciones versionadas, esas invariantes se aplican a mano y **divergen entre entornos**: el
disparador que protege al administrador fundador existe en producción y no en el entorno de pruebas, y
la prueba que debía fallar pasa.

Cualquier herramienta sirve. Elegirla **antes** de crear la primera tabla, no después.

### 11.6 · El subdominio por cliente filtra la lista de clientes

Si cada cliente vive en `cliente.tudominio.com`, cualquiera puede probar nombres y averiguar **quiénes
son tus clientes**. Lo mismo con un identificador de organización en rutas públicas.

Puede no importar. Pero es una decisión comercial, no técnica: hay clientes a los que no les gusta
aparecer en la lista de referencias de su proveedor sin haberlo autorizado.

**Recomendación:** rutas autenticadas **sin** el identificador de la organización en la dirección — la
organización sale de la sesión. Si querés subdominios, agregalos sabiendo esto.

---

## 12 · Dos cosas que hay que poder responder, y conviene escribir antes de necesitarlas

### 12.1 · Exportación y borrado por organización

Un cliente que se va va a pedir sus datos y su eliminación. Con la organización en todas las tablas es
una consulta por tabla — pero **hay que escribirlo antes de necesitarlo**, y hay una decisión que no es
técnica:

**¿qué pasa con la auditoría?** Es inmutable por diseño y contiene identificadores de usuarios. Las
opciones son conservarla (y decirlo en el contrato, porque es un registro legítimo de operación) o
anonimizar los identificadores conservando los eventos. Las dos son defendibles; **la que no es
defendible es no haberlo decidido** cuando llega el pedido.

### 12.2 · La zona horaria es de la organización, no del navegador

Si el sistema tiene cualquier agregación por día, la frontera del día tiene que calcularla el servidor
con **la zona de la organización**. Un frontend que calcula "hoy" con la zona del navegador hace que un
cliente en otra zona vea totales de un día que no coincide con el de sus propios informes.

No es un problema de acceso, pero se decide en el mismo momento que el esquema: **la organización tiene
zona horaria, y toda agregación temporal la usa.** Después es una corrección que toca cada consulta y
cada pantalla.

---

## 13 · Orden de aplicación

No todo esto va antes del primer endpoint. Lo que sí:

**Bloqueante, antes de escribir código:**

1. La decisión del **§ 2** (cliente encadenable o SQL crudo). Condiciona el mecanismo entero.
2. El **corredor de pruebas y la integración continua**, con la prueba del **§ 4** ya andando.
3. La **herramienta de migraciones** (§ 11.5).

**Bloqueante, antes del primer endpoint que lea datos de un inquilino:**

4. **Los dos** roles de base dedicados —el del inquilino y el de identidad, en esquemas separados—,
   `force row level security`, las políticas con su cláusula `to`, y `set local` en transacción, con las
   tres pruebas del § 1 y las de la escotilla.
5. El agrupador de conexiones en modo transacción.
6. Las reglas de caché del **§ 3**, con su prueba.

**En la etapa del esquema (cuesta cero ahora, una migración de datos después):**

7. `expira_absoluto` en sesiones (§ 5.1).
8. La columna de organización en roles, aunque quede vacía, y el disparador de asignación cruzada (§ 6).
9. Los cuatro estados y las columnas de refresco de credenciales (§ 9).
10. La bandera de "exige segundo factor" en los roles (§ 10).
11. La zona horaria de la organización (§ 12.2).

**En la etapa de autenticación:**

12. Prefijo `__Host-`, verificación de origen, dirección de origen tomada bien, y su prueba con
    cabecera falsificada (§ 5.2 a 5.4).
13. La regla de no registrar cuerpos, con su prueba (§ 11.2).

**Antes del primer cliente externo:**

14. Segundo factor obligatorio para el rol de plataforma (§ 10).
15. Auditoría del acceso de soporte, y poder mostrársela al cliente (§ 8).
16. Recuperación de contraseña delegada al administrador del cliente (§ 11.1).
17. Sesiones visibles y revocables (§ 5.5). _Es el único de esta lista que puede esperar sin
    consecuencias si hay que recortar: no protege nada que las otras no protejan, y se agrega después sin
    tocar nada._
18. El procedimiento de exportación y borrado escrito (§ 12.1).

---

## 14 · Lo que sigue sin cubrir

Para que se decida a propósito y no se descubra a mitad de camino. Ninguna de estas está resuelta acá
ni en los documentos anteriores:

- **Inicio de sesión con proveedores externos (SSO).** El diseño lo admite sin reescritura **si** la
  tabla de sesiones es la única fuente de verdad de "quién sos": el día que haga falta, se agrega un
  proveedor que emite una fila en esa tabla y nada más cambia. Si en cambio la sesión se acopla al
  formulario de contraseña, ese día es una reescritura. **Vale la pena diseñarlo así desde el
  principio**, aunque no se implemente.
- **Permisos por registro individual** ("este usuario ve _estos_ registros y no aquellos"). Conviene
  distinguir: "cada persona ve solo lo que le asignaron" **no** es un permiso, es un filtro de negocio
  y se resuelve en la consulta. El modelo por capacidad alcanza. Solo se rompe si hacen falta reglas de
  visibilidad por registro **configurables por el cliente**, y para eso existen motores de
  autorización dedicados.
- **Un esquema o una base por cliente.** Aislamiento más fuerte y demostrable, a cambio de multiplicar
  cada migración por la cantidad de clientes y de volver incómodo cualquier informe que cruce clientes.
  **El criterio no es la cantidad de clientes sino su perfil**: el enfoque compartido gana con **muchos
  clientes de valor bajo o medio**; la separación física gana con **pocos clientes de valor alto**, sobre
  todo si alguno va a preguntar por escrito cómo se separan sus datos. Y el punto de reevaluación es
  concreto: **el primer cliente que exija separación física por contrato.** Como toda tabla lleva la
  columna de organización, extraer un inquilino a su propia base más adelante es copiar las filas donde
  esa columna vale X: es trabajo, no una reescritura.
- **Gestión de secretos con un servicio dedicado.** Con la clave maestra en una variable de entorno, la
  respuesta honesta a "¿quién puede descifrar nuestras credenciales?" es "cualquiera con acceso al
  panel del hosting", y eso incluye a quien se sume al equipo mañana. El detonante para migrar a un
  servicio de claves es concreto: **la primera vez que un cliente haga esa pregunta por escrito.**
- **Límite de sesiones simultáneas** y **facturación por organización**.
- **Obligaciones legales de tratamiento de datos.** Si procesás datos personales de terceros por cuenta
  de tus clientes, casi seguro tenés obligaciones bajo la normativa de tu jurisdicción: acuerdos de
  tratamiento, notificación de incidentes, capacidad de responder pedidos de acceso y supresión, y a
  veces designar un responsable. Varias se traducen en columnas y en código, y este documento cubre
  las técnicas (auditoría inmutable, acceso de soporte registrado, exportación y borrado). **El resto
  necesita revisión profesional, no una decisión de ingeniería.**
