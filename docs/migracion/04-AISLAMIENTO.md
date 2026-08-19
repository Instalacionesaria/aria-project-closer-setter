# 04 — Aislamiento entre organizaciones

La pieza más importante de la serie. Si esto se implementa mal, un cliente ve los datos de otro y
**nada falla**.

Este documento es autosuficiente: no depende de los otros de la carpeta.

---

## 1 · El problema, dicho con precisión

Una sola base de datos, una sola instalación, varias organizaciones cliente. Cada tabla de negocio lleva
una columna `org_id`, y **cada consulta tiene que filtrar por ella**.

El modo de fallar es lo que define el diseño. Si el filtro lo pone quien escribe la consulta:

- alcanza **una** omisión, en **una** consulta, para que un cliente vea las filas de otro;
- eso **no lanza una excepción**, no rompe una prueba y no aparece en ningún registro;
- la consulta anda, devuelve filas, y el número está mal.

Es el peor tipo de defecto que puede tener un sistema multiempresa: silencioso, y con consecuencias
legales.

**Por eso la regla no es "acordate de filtrar". La regla es que no se pueda escribir una consulta sin
filtro.**

---

## 2 · La solución: una capa que inyecta el filtro

En vez de que cada consulta ponga el filtro, hay **un** objeto de acceso a datos que lo pone solo.

```
✗  base.tabla("pedidos").seleccionar("*").donde("org_id", orgActual)
✓  datos().tabla("pedidos").seleccionar("*")
       └─ y el filtro ya está, porque lo puso datos()
```

| Operación                           | Qué le hace la capa                        |
| ----------------------------------- | ------------------------------------------ |
| Lecturas (`select`)                 | Agrega la condición `org_id = <la activa>` |
| Modificaciones (`update`, `delete`) | Idem                                       |
| Escrituras (`insert`, `upsert`)     | Inyecta `org_id` en cada fila              |
| Procedimientos almacenados          | **No los toca.** Ver § 5                   |

**Si no hay organización activa en el contexto, la capa lanza una excepción.** No devuelve todo, no
devuelve vacío: rompe. Un error visible es infinitamente preferible a una consulta que devuelve las filas
de otro cliente.

### Cómo implementarla según tu stack

**Con un objeto interpuesto (proxy dinámico).** Si tu lenguaje lo permite (JavaScript, Python, Ruby, PHP),
envolvé el cliente de base de datos e interceptá solo los métodos de consulta. La ventaja decisiva:
**conserva la firma y los tipos del cliente real**, así que el código existente no cambia ni una línea.

```
funcion datos():
    orgId = contextoActual().orgId          # lanza si no hay
    devolver interponer(clienteCrudo, {
        seleccionar: (...args) => clienteCrudo.seleccionar(...args).donde("org_id", orgId),
        actualizar:  (...args) => clienteCrudo.actualizar(...args).donde("org_id", orgId),
        eliminar:    (...args) => clienteCrudo.eliminar(...args).donde("org_id", orgId),
        insertar:    (filas)   => clienteCrudo.insertar(conOrgId(filas, orgId)),
    })
```

**Con un repositorio.** Si el lenguaje es estático y no hay interposición dinámica, una clase por
agregado cuyo constructor recibe la organización. Más verboso, misma garantía: **no hay constructor sin
organización**.

**Con la base de datos.** Seguridad a nivel de fila con una variable de sesión (`set local app.org_id`) y
políticas que filtran por ella. Es la más fuerte —protege incluso de consultas escritas a mano— y la más
difícil de depurar. Si vas por acá, la variable de sesión tiene que setearse en **el mismo lugar** donde
hoy abrirías el contexto, y hay que verificar que el pool de conexiones no reutilice una conexión con la
variable de otra organización.

**Un envoltorio con métodos propios es la peor opción**: obliga a reimplementar toda la superficie del
constructor de consultas, mantenerla al día con la librería, y —lo decisivo— **pierde los tipos**. Cada
punto de acceso deja de tener autocompletado y verificación, y eso se paga todos los días.

### La inyección pisa lo que venga

Si alguien compone una fila con un `org_id` distinto al de su sesión —por un bug, o porque el
identificador llegó en el cuerpo de la petición— **la escritura va igual a la organización que
corresponde**.

Ante la duda gana la opción que hace más difícil escribir en los datos de otro. La excepción es un nulo
**explícito**, si tu dominio necesita filas sin dueño (por ejemplo, una bandeja de eventos entrantes que
todavía no se pudieron atribuir).

---

## 3 · El contexto: de dónde sale "la organización activa"

La capa necesita saber cuál es la organización **sin recibirla por parámetro en cada llamada** — si la
recibiera, volveríamos a "acordate de pasarla".

### Opción A · Almacenamiento local asíncrono

Node (`AsyncLocalStorage`), Python (`contextvars`), Java (`ScopedValue`): un contexto que viaja con la
cadena de ejecución, invisible para el código que lo usa.

**Hacen falta dos primitivas distintas, y confundirlas causa bugs raros:**

| Primitiva              | Comportamiento                       | Cuándo                                            |
| ---------------------- | ------------------------------------ | ------------------------------------------------- |
| "Entrar" (`enterWith`) | Abre el contexto y **no lo cierra**  | Una petición HTTP: una petición, una organización |
| "Envolver" (`run`)     | Abre, ejecuta la función, **cierra** | Un bucle sobre varias organizaciones              |

> **La trampa que cuesta descubrir**: "entrar" **no propaga hacia afuera de una función asíncrona**. Si
> lo llamás dentro de una función y esperás que quien la llamó quede en ese contexto, no pasa.
>
> Dos consecuencias reales, medidas:
>
> 1. **En un bucle de organizaciones**, el contexto de la primera puede seguir vivo cuando empieza la
>    segunda. Para recorrer organizaciones hay que usar "envolver".
> 2. **En los ganchos de preparación y limpieza de las pruebas**, llamarlo en el gancho no deja el
>    contexto puesto para las pruebas. En el sistema del que salen estas notas eso hizo que la limpieza
>    nunca corriera y quedaran filas de prueba en producción.

### Opción B · Contexto explícito

Un objeto que se pasa como primer parámetro por toda la cadena (`context.Context` de Go es el ejemplo
canónico). Más ruidoso, imposible de olvidar sin que el compilador lo note.

Si vas por acá, **la capa de datos lo recibe como primer argumento** y la prueba del § 7 verifica que
ninguna consulta se construya sin él.

### Lo que NO funciona

**Una variable global o un singleton por proceso.** En un servidor concurrente, dos peticiones de
organizaciones distintas se pisan el contexto. El bug es intermitente, depende de la carga, y es
prácticamente imposible de reproducir en desarrollo.

Es tentador porque en pruebas locales —una petición a la vez— funciona perfecto.

---

## 4 · La escotilla, y cómo mantenerla honesta

Hay operaciones que legítimamente cruzan organizaciones:

- **El login**, que busca un usuario por email antes de saber de qué organización es.
- **Las tareas programadas**, que recorren todas las organizaciones activas.
- **El enrutador de eventos entrantes**, que tiene que averiguar a qué organización pertenece un evento.
- **El alta de una organización**, que por definición todavía no tiene contexto.

Para eso hace falta un acceso sin filtro: `datosSinFiltro()`.

> **Y hace falta menos de lo que parece.** Tres de esas cuatro **no** necesitan leer datos de negocio sin
> filtro:
>
> - **las tareas programadas** necesitan la _lista_ de organizaciones, y después trabajar de una en una,
>   abriendo el contexto en cada vuelta como una petición normal;
> - **el enrutador de eventos** necesita averiguar a qué organización pertenece el evento —una consulta a
>   una tabla de identidad— y a partir de ahí sigue el camino normal;
> - **el alta de organización** escribe en la tabla de organizaciones, que tampoco es de negocio.
>
> Queda solo el **login**, que busca un usuario por email. Acotar la escotilla a eso cambia su tamaño por
> completo.

> **Advertencia importante si además pusiste el filtro en la base.** Si las tablas tienen políticas que
> filtran por una variable de sesión, `datosSinFiltro()` **no alcanza**: el corte no está en la capa de la
> aplicación, está en la base, y no le importa por qué función de tu código llegó la consulta. El login
> devolvería cero filas y **nadie podría entrar**.
>
> La solución no es aflojar la política —un escape que cualquier línea de la aplicación pueda encender no
> es una barrera— sino **un segundo rol de base**, con permisos solo sobre las tablas de identidad y
> **ninguno** sobre las de negocio. Así el acceso sin filtro deja de ser "puede todo" y pasa a ser "puede
> las tablas de identidad, declarado en una migración que alguien revisó".

**Y tiene que estar autorizado archivo por archivo, en una lista que verifica una prueba:**

```
ARCHIVOS_AUTORIZADOS = { "auth/login", "auth/sesion", "tareas/*", "admin/organizaciones" }

prueba "nadie usa el acceso sin filtro sin autorización":
    para cada archivo en operaciones/:
        si "datosSinFiltro(" en leer(archivo):
            afirmar que archivo en ARCHIVOS_AUTORIZADOS
```

Un archivo nuevo que la use **rompe la suite** hasta que alguien lo agregue a la lista a mano.

El punto no es prohibirla —hace falta— sino que **agregarla sea un acto deliberado que aparece en un
cambio que alguien revisa**, en vez de una decisión que se toma sola a las dos de la mañana con un
"solo esta vez".

---

## 5 · Las dos grietas conscientes

Todo diseño de aislamiento tiene lugares que el mecanismo no cubre. Conviene saber cuáles son en vez de
descubrirlos.

### Los procedimientos almacenados

Si tu lógica usa funciones de base de datos, **la capa no puede inyectarles el filtro**: no sabe cómo se
llama el parámetro de cada una.

La regla, entonces, es de disciplina y revisión: **toda función recibe la organización como parámetro
explícito y filtra por ella**.

> **Y hay una trampa específica de PostgreSQL**: resuelve las sobrecargas por cantidad de argumentos.
> Si existe `f(p_org_id uuid)` y quedó una `f()` heredada, **un llamador que se olvide el argumento no
> falla**: ejecuta la vieja, que ignora la organización.
>
> Borrar la versión sin parámetro es parte del trabajo, no una limpieza opcional. Y `create or replace`
> **no** puede quitar valores por defecto de los parámetros: hay que borrar y recrear — y el borrado
> **se lleva los permisos**, así que hay que reponerlos en la misma migración.

### Las tablas compartidas

Algunas tablas no tienen dueño: catálogos de vocabulario del sistema, tipos de evento, listas de países.
Filtrarlas por organización devolvería cero filas siempre.

Mantené una **lista corta y explícita** de esas tablas, dentro de la capa de datos. Cada entrada tiene
que justificarse por escrito: **una tabla en esa lista es una tabla sin aislamiento**.

---

## 6 · La segunda capa: la base de datos

Si tu proveedor expone una API pública con una clave que viaja al navegador, **hay que asumir que esa
clave es pública**.

```sql
alter table pedidos enable row level security;
revoke all on pedidos from public, anon, authenticated;
-- Solo el rol del servidor, cuya clave vive únicamente en el backend, conserva acceso.
```

**Las dos capas hacen falta y protegen de cosas distintas:**

| Capa                         | De qué protege                         |
| ---------------------------- | -------------------------------------- |
| La inyección del filtro      | De los errores del propio código       |
| La seguridad a nivel de fila | De que alguien saltee el código entero |

Convertilo en un paso obligatorio de cada migración: **toda tabla nueva nace con la seguridad activada y
los permisos revocados**. Es más fácil como hábito que como auditoría posterior.

---

## 7 · La prueba arquitectónica

Es lo más valioso de este documento. Sin ella, todo lo anterior se erosiona — no por mala fe, sino
porque alguien va a necesitar una excepción y nadie la va a ver.

```
prueba "el aislamiento no se puede saltear":

    # 1 · Un solo lugar crea el cliente sin filtro
    archivosQueCrean = buscar("crearCliente(") en todo el código
    afirmar que archivosQueCrean == ["datos/capa"]

    # 2 · Toda operación abre el contexto de organización
    para cada archivo en operaciones/:
        si archivo en RUTAS_PUBLICAS: continuar
        afirmar que leer(archivo) contiene "activarContexto(" o "conOrganizacion("

    # 3 · La escotilla, solo donde está autorizada
    para cada archivo en operaciones/:
        si "datosSinFiltro(" en leer(archivo):
            afirmar que archivo en ARCHIVOS_AUTORIZADOS

    # 4 · Toda tabla de negocio tiene la columna del inquilino
    para cada migración en migraciones/:
        para cada "create table" en migración:
            afirmar que declara "org_id" o está en TABLAS_COMPARTIDAS
```

Quitá los comentarios antes de buscar en el código fuente, o un comentario que mencione la escotilla
hace fallar la prueba.

**Escribila antes de la segunda operación, no después de la decimocuarta.** En el sistema del que salen
estas notas, catorce operaciones ya estaban escritas sin abrir el contexto, y ninguna fallaba: leían los
datos de la organización equivocada.

---

## 8 · El rol de plataforma que mira otra organización

Es el caso que más fácil se rompe.

Si existe un rol que puede trabajar sobre cualquier organización, esa elección vive **en la sesión**, no
en un parámetro de la petición:

```
sesiones.org_activa  →  identificador de la organización elegida (puede ser nulo)
```

Y el contexto expone **dos** valores distintos:

| Valor         | Qué es                                             |
| ------------- | -------------------------------------------------- |
| `orgPropia`   | La organización a la que pertenece el usuario      |
| `orgEfectiva` | La organización sobre la que está trabajando ahora |

```
orgEfectiva = (esRolDePlataforma y sesion.orgActiva) ? sesion.orgActiva : orgPropia
```

**Todo lo demás usa `orgEfectiva`**, y así la capa de datos inyecta el filtro correcto sin que ninguna
operación se entere del asunto.

### Tres cosas que hay que hacer bien

**Que viva en la sesión y no en la petición.** Si fuera un parámetro (`?org=…`), cualquiera podría probar
el identificador de otra organización y habría que validar en **cada** operación que le corresponde. En
la sesión, la elección ya pasó por el único endpoint que exige el rol de plataforma.

**Que la autorización la decida el rol, no el dato guardado.** El contexto respeta `org_activa`
**solo** si el usuario tiene el rol de plataforma. Si alguien escribiera esa columna por otra vía —un
script, un bug, una migración— un usuario común seguiría trabajando en su propia organización: el valor
está ahí y el código no lo mira.

**Que la interfaz lo muestre siempre.** Un cartel permanente mientras `orgEfectiva ≠ orgPropia`. Sin
eso, alguien mira la pantalla, saca una conclusión sobre "los números", y está viendo los de otro
cliente.

> **Limitación conocida de este diseño**: con dos pestañas abiertas en organizaciones distintas, la
> última elección manda para las dos, porque es una sola columna. Y **no falla**: la primera pestaña
> simplemente empieza a mostrar datos de la otra organización.
>
> El cartel permanente lo hace visible, que es la mitigación mínima. Si el caso te importa de verdad, la
> elección tiene que viajar por pestaña —un identificador de contexto en la petición, validado contra los
> permisos de la sesión— y eso es bastante más trabajo.

---

## 9 · Lista de verificación

1. Toda tabla de negocio lleva `org_id`, no nulo, con clave foránea.
2. Las claves foráneas **dentro** del inquilino referencian el par `(org_id, id)`, no solo el `id`. Sin
   eso, una fila de la organización A puede apuntar a un registro de la B y la base lo acepta.
3. Los índices llevan `org_id` **primero**.
4. Seguridad a nivel de fila activada y permisos revocados en toda tabla.
5. **Un solo lugar** crea el cliente sin filtro.
6. El filtro se inyecta; no se pide.
7. Sin organización activa, **lanza**. Nunca "todas", nunca "vacío".
8. La escotilla existe, autorizada por archivo, con una prueba que lo verifica.
9. Contexto por petición: local asíncrono o explícito. **Nunca** global.
10. Los procedimientos almacenados reciben la organización como parámetro, y las versiones sin parámetro
    se borran.
11. La lista de tablas compartidas es corta y cada entrada está justificada.
12. La prueba arquitectónica existe y corre en cada integración.
