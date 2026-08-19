# RECONSTRUIR · 03 — Multiempresa: el aislamiento

La pieza más importante de esta serie. Si algo de acá se reconstruye mal, un cliente ve los datos de
otro y **nada falla**.

Archivos de referencia: `api/_lib/db.ts` (el Proxy), `api/_lib/repo.ts`,
`api/_lib/credenciales.ts`, `api/_lib/cifrado.ts`, `api/_lib/aislamiento.test.ts`.

---

## 1 · El problema, dicho con precisión

Una sola base de datos, una sola aplicación, varias empresas cliente. Cada tabla de negocio lleva
una columna `org_id`, y **cada consulta tiene que filtrar por ella**.

El modo de fallar es lo que define el diseño: si el filtro lo pone quien escribe la consulta,
alcanza **una** omisión, en **un** endpoint, para que un cliente vea las filas de otro. Y eso no
lanza una excepción, no rompe un test y no aparece en ningún log: la consulta anda, devuelve filas,
y el número está mal.

Por eso la regla no es "acordate de filtrar". La regla es **que no se pueda escribir una consulta
sin filtro**.

---

## 2 · El Proxy: `db()`

`db()` devuelve un cliente de base de datos **atado a una organización**. Intercepta cinco métodos:

| Método                       | Qué le hace                             |
| ---------------------------- | --------------------------------------- |
| `select`, `update`, `delete` | Les agrega `.eq("org_id", <la activa>)` |
| `insert`, `upsert`           | Les inyecta `org_id` en cada fila       |
| `rpc`                        | **Pasa sin tocar** (ver abajo)          |

```ts
// Lo que escribe quien consulta:
await db().from("closer_contactos").select("*");

// Lo que sale de verdad:
select * from closer_contactos where org_id = '<la activa>';
```

**Si no hay empresa activa en el contexto, lanza una excepción.** No devuelve todo, no devuelve
vacío: rompe. Un error visible es infinitamente preferible a una consulta que devuelve las filas de
otro cliente.

### Por qué un Proxy y no un wrapper

Un wrapper con métodos propios obligaría a reimplementar la superficie entera del constructor de
consultas, mantenerla al día con la librería, y —lo decisivo— **perdería los tipos**. Los 94 puntos
de acceso que hacen `const { data, error } = await db().from(…).select(…)` dejarían de tipar.

El Proxy conserva la firma real del cliente y solo intercepta cinco métodos, así que **ni un solo
call site tuvo que cambiar** para quedar aislado. Eso es lo que hizo posible aplicarlo sobre un
sistema ya escrito.

### La inyección pisa lo que venga

Si un handler compone una fila con un `org_id` distinto al de su sesión —por un bug, o porque el id
llegó en el cuerpo del request— **la escritura va igual a la empresa que corresponde**. Ante la duda
gana la opción que hace más difícil escribir en los datos de otro.

La única excepción es un `org_id: null` **explícito**, que se respeta: lo necesita la bandeja de
webhooks, donde un evento que no se pudo atribuir a ninguna empresa se guarda igual para poder
investigarlo después.

### Lo que el Proxy NO cubre

**`rpc` pasa sin tocar.** Las funciones de Postgres reciben la organización como parámetro explícito
(`p_org_id`), porque inyectarla desde el Proxy sería adivinar el nombre del argumento de cada una.

Es la grieta consciente del diseño: **toda función de base de datos tiene que recibir y usar
`p_org_id`**, y eso lo sostiene la revisión de código, no el mecanismo. Si reconstruís esto, ésta es
la línea que conviene vigilar.

### Tablas compartidas

Hay una lista —hoy con **una** entrada— de tablas sin `org_id`, que no se scopean: el vocabulario del
sistema (los 17 tipos de evento, iguales para todas las empresas). Filtrarlas por organización
devolvería cero filas siempre.

La lista es deliberadamente corta y cada entrada tiene que justificarse: **una tabla ahí adentro es
una tabla sin aislamiento**.

### Una sola puerta al cliente crudo

Un solo archivo del proyecto puede crear el cliente de base de datos sin scope. Lo hace cumplir un
test que recorre el código. Sin ese test la regla se erosiona en la primera semana — no por mala fe,
sino porque a alguien le va a hacer falta "solo esta vez".

---

## 3 · `dbSinScope()`: la escotilla

Hay operaciones que legítimamente cruzan empresas:

- El **login**, que busca un usuario por email antes de saber de qué empresa es.
- Los **crons**, que recorren todas las empresas activas.
- El **enrutador de webhooks**, que tiene que averiguar a qué empresa pertenece un evento.

Para eso existe `dbSinScope()`. Y está **autorizada archivo por archivo en una lista dentro del
test**:

```ts
// api/_lib/aislamiento.test.ts
const AUTORIZADOS = new Set(["auth/login.ts", "auth/sesion.ts", …]);
```

Un archivo nuevo que la use **rompe la suite** hasta que alguien lo agregue a la lista a mano. El
punto no es prohibirla: es que agregarla sea un acto deliberado que aparece en un diff que alguien
mira, en vez de una decisión que se toma sola a las 2 de la mañana.

---

## 4 · El contexto: de dónde sale "la empresa activa"

El Proxy necesita saber cuál es la empresa activa sin recibirla por parámetro en cada llamada —si la
recibiera, volveríamos a "acordate de pasarla".

La solución es **almacenamiento local asíncrono** (`AsyncLocalStorage` en Node): un contexto que
viaja con la cadena de ejecución del request, invisible para el código que lo usa.

Hay dos formas de entrar, y **la diferencia importa**:

| Función                     | Mecanismo                                     | Cuándo                                    |
| --------------------------- | --------------------------------------------- | ----------------------------------------- |
| `activar(cred)`             | `enterWith` — abre el contexto y no lo cierra | Un endpoint HTTP: un request, una empresa |
| `conCredenciales(cred, fn)` | `run` — abre, ejecuta, **cierra**             | Un bucle sobre varias empresas            |

### La trampa que costó descubrir

**`activar()` no propaga hacia afuera de una función `async`.** Si lo llamás dentro de una función y
esperás que el llamador quede en ese contexto, no pasa. Eso rompe dos cosas concretas:

1. **Un bucle de empresas.** `activar(A)` … `activar(B)` puede dejar el contexto de A vivo en
   trabajo pendiente de A que todavía no terminó. Para recorrer empresas hay que usar
   `conCredenciales`, que abre y cierra.
2. **Los hooks de test** (`beforeAll` / `afterAll`). Llamarlo en el hook no deja el contexto puesto
   para los tests. En este proyecto eso hizo que la limpieza de un `afterAll` nunca corriera y
   quedaran filas de prueba en producción.

> **Si tu lenguaje no tiene esto**: la alternativa es pasar un objeto de contexto explícito por toda
> la cadena de llamadas (Go lo hace con `context.Context`, y funciona bien). Lo que **no** funciona
> es una variable global o un singleton por proceso: en un servidor concurrente, dos requests de
> empresas distintas se pisan el contexto y el bug es intermitente e imposible de reproducir. Si vas
> por el objeto explícito, el Proxy pasa a recibirlo como primer argumento y el test tiene que
> verificar que ninguna consulta se construya sin él.

---

## 5 · Credenciales por empresa

Cada empresa tiene sus propias credenciales de los servicios externos: token del CRM, clave del
proveedor de IA, token del proveedor de voz, secreto del webhook, id de la cuenta de anuncios.

Viven en `closer_org_config`, y las sensibles **cifradas**:

```
ghl_pit_cifrado          token del CRM
anthropic_key_cifrada    clave del proveedor de IA
meta_token_cifrado       token de la plataforma de anuncios
ghl_webhook_secret       secreto del webhook
assistable_token         token del proveedor de voz
meta_ad_account_id       id de la cuenta de anuncios (no es secreto)
```

### El cifrado

**AES-256-GCM**, de la biblioteca estándar. GCM y no CBC porque es un cifrado **autenticado**: si
alguien modifica el blob, el descifrado falla en vez de devolver basura que parece un token.

|           |                                                     |
| --------- | --------------------------------------------------- |
| Algoritmo | `aes-256-gcm`                                       |
| Clave     | 32 bytes, de una variable de entorno (base64 o hex) |
| IV        | **12 bytes aleatorios por valor**                   |
| Formato   | `<iv>:<tag>:<cifrado>`, en partes separadas por `:` |

**El IV aleatorio por valor no es una precaución, es un requisito.** Reusar un IV con la misma clave
en GCM **rompe el cifrado por completo** — no lo debilita: permite recuperar el texto en claro. Es el
error más fácil de cometer y el más caro.

**Si la clave maestra no coincide, el descifrado lanza** con un mensaje que dice qué hacer ("hay que
volver a cargarla desde el panel"). No devuelve `null` ni un string vacío: un token vacío produce un
`401` del servicio externo, tres capas más abajo, imposible de diagnosticar.

> Esto no es teórico: pasa cada vez que alguien corre el proyecto en otra máquina con otra clave. El
> mensaje explícito es lo que convierte media hora de depuración en diez segundos.

### `resolverCredenciales(orgId)` y el fallback de la principal

**Nunca se leen las columnas crudas.** Se llama a `resolverCredenciales`, que:

1. lee la fila de la empresa,
2. descifra lo que hay que descifrar,
3. y **para la empresa principal, cae a las variables de entorno** cuando la columna está vacía.

Ese fallback existe por historia: la empresa principal operaba con variables globales desde antes de
que el sistema fuera multiempresa. Su token sigue ahí.

**Y por eso leer las columnas crudas es un error concreto**: un panel que revise "¿está cargado el
token?" mirando la columna reportaría _"falta el token"_ sobre la única empresa que demostrablemente
funciona. La función devuelve además un campo `desdeEntorno` que distingue **"cargado por esta
empresa"** de **"apoyado en una variable global"** — las dos funcionan y no son lo mismo.

**Una empresa cliente NO hereda nada.** Si no tiene su token, no opera y se dice. El fallback es
exclusivo de la principal, y hubo un bug real donde una empresa nueva heredaba el token de la
principal: escribía en el CRM de otro.

---

## 6 · La defensa de la base: RLS

Todas las tablas tienen **row level security activada** y los permisos revocados a los roles
anónimo y autenticado:

```sql
alter table closer_contactos enable row level security;
revoke all on closer_contactos from anon, authenticated;
```

El motivo es concreto: en este stack la **clave anónima viaja en el bundle del navegador**. Cualquiera
puede leerla del código de la página. Si las tablas fueran accesibles con esa clave, el aislamiento
del Proxy no valdría nada — se lo saltea cualquiera con la consola del navegador abierta.

Solo el rol de servicio (la clave que vive **solo** en el servidor) tiene acceso, y ese rol es el que
usa el Proxy.

**Es la segunda capa, y las dos hacen falta.** El Proxy protege de los errores del propio código; RLS
protege de que alguien saltee el código entero.

---

## 7 · Checklist para reconstruirlo

En este orden:

1. **Toda tabla de negocio lleva `org_id not null`.** Sin excepciones que no estén en una lista corta
   y justificada.
2. **RLS activada y permisos revocados** a cualquier rol que pueda llegar desde el cliente.
3. **Un solo lugar crea el cliente de base de datos.** Con un test que lo verifique.
4. **El scope se inyecta, no se pide.** Proxy, decorador, interceptor: lo que tenga tu stack. La
   prueba de que está bien es que **no se pueda escribir la consulta sin el filtro**.
5. **Sin empresa activa, lanza.** Nunca "todas", nunca "vacío".
6. **La escotalla existe pero está autorizada por archivo**, con un test que lo haga cumplir.
7. **Contexto por request**, no global ni singleton por proceso.
8. **Credenciales cifradas con AEAD**, IV aleatorio por valor, y un error explícito cuando la clave
   no coincide.
9. **Una función que resuelva credenciales**, con su fallback documentado. Nadie lee las columnas
   crudas.
10. **El test arquitectónico** que recorre los endpoints verificando 3, 4 y 6. Escribilo temprano: es
    lo único que sostiene el resto cuando el equipo crece.
