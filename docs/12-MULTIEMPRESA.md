# Multi-empresa, autenticación y roles

**Implementado entre el 2026-08-06 y el 2026-08-07.** Migraciones `018`–`027`.

> El número es **12** y no 11 porque el 11 ya era [VOZ-Y-LLAMADAS](11-VOZ-Y-LLAMADAS.md). La
> especificación pedía `11-MULTIEMPRESA.md` sin saberlo.

La plataforma pasó de una instalación de un solo cliente (ARIA) a servir a ARIA + hasta 4 empresas
cliente, cada una con sus credenciales, usuarios y datos.

## Las dos reglas que gobiernan todo

> 1. **Ningún dato de una empresa puede ser legible ni escribible por otra. Nunca.**
> 2. **No romper nada de lo que hoy funciona.**

Ante cualquier duda de diseño gana la opción que hace más difícil filtrar datos entre empresas,
aunque sea más lenta o más incómoda de escribir.

---

## La clave es `org_id`, no `empresa_id`

La especificación pedía `empresa_id` y una tabla nueva `closer_empresas`. **Las dos cosas se
cambiaron**, y por el mismo motivo: 12 de las 19 tablas ya tenían `org_id`, y `closer_org_config` ya
existía. Renombrar lo que ya funcionaba habría tocado 94 puntos de acceso para no ganar nada.

`closer_org_config` se **extendió** en la `018` con identidad, credenciales cifradas, los cuatro
prompts y las perillas del auditor. Antes tenía una fila; ahora tiene una por empresa.

---

## El aislamiento, en tres capas

### Capa 1 · `db()` toma la organización del contexto

`api/_lib/db.ts` es **el único archivo del proyecto autorizado a llamar a `createClient`**. Expone
`db(orgId)`, que devuelve un **Proxy** del cliente de Supabase:

- `select`, `update` y `delete` salen con `.eq("org_id", orgId)` **ya puesto**, encadenado ANTES de
  los filtros de quien llama — así que no se puede quitar.
- `insert` y `upsert` reciben `org_id` inyectado en cada fila, **pisando** el que venga.
- `rpc` pasa sin tocar: las funciones de Postgres reciben `p_org_id` explícito, y adivinar el nombre
  del argumento de cada una sería peor que pasarlo a mano.

Un Proxy y no un wrapper con métodos propios porque un wrapper **perdía los tipos**: los 94 puntos
de acceso que hacen `const { data, error } = await db().from(…)` habrían dejado de tipar.

`api/_lib/repo.ts` expone `db()` sin argumentos, que saca la organización de
`credencialesActivas()`. **Falla cerrado**: sin contexto activo lanza, no cae a la empresa principal.

> **Esto fue la deuda más grande de toda la migración.** Hasta el 2026-08-07 `repo.ts` decía
> `dbScopeado(ORG_ID)` con el UUID de ARIA literal, y el comentario lo anunciaba desde la fase 1
> como "el único lugar que hay que tocar". Con una empresa daba la respuesta correcta; con dos el
> resultado no era "no anda" sino algo peor — el tick de un usuario de la empresa B hablaba con la
> subcuenta de GHL de B y escribía en las filas de ARIA. Una auditoría encontró **54 puntos de fuga
> derivados de esa línea**.

`ORG_ID` pasó a llamarse **`ORG_PRINCIPAL`**. El nombre viejo era la mitad del problema: leído en un
`.eq("org_id", ORG_ID)` parecía "el org_id que corresponda".

### Capa 2 · Los tests que lo hacen cumplir

`api/_lib/aislamiento.test.ts` recorre `api/**` y falla si:

| Regla | Por qué |
|---|---|
| Alguien crea un cliente de Supabase fuera de `db.ts` | Ese endpoint queda fuera del aislamiento |
| Una tabla `closer_*` se consulta sin el helper | Igual |
| `dbSinScope()` se usa fuera de `ESCOTILLA_AUTORIZADA` | Cada excepción se justifica **por escrito** |
| Un handler llama a `exigir` y no a `activar(ctx.credenciales)` | Correría con las credenciales GLOBALES sin fallar |
| Un handler no activa ninguna empresa | Su primer `db()` va a lanzar |
| La lista de la escotilla tiene entradas muertas | Una lista de excepciones que solo crece deja de ser una lista de excepciones |

**Las nueve comprobaciones miran el fuente SIN COMENTARIOS**, y eso no era así al principio: la
comprobación de `activar()` daba verde en `citas-respaldo.ts` **por un comentario** que mencionaba
`activar()` para explicar por qué ahí se usa `conCredenciales()`. Un test de aislamiento que pasa por
una palabra dentro de una explicación es peor que no tenerlo. Se verificó saboteando el código a
propósito para ver el test fallar.

### Capa 3 · RLS activa, sin políticas

Todas las tablas tienen `enable row level security` y **cero políticas**, más
`revoke all from anon, authenticated`. Es la postura correcta y es contraintuitiva: RLS activada sin
políticas es el **máximo** cierre — solo pasa `service_role`. Agregar una política permisiva
**abriría** la tabla.

---

## Autenticación

| Pieza | Cómo |
|---|---|
| Contraseñas | `scrypt` de `node:crypto` (`N=16384, r=8, p=1`), salt de 16 bytes, `timingSafeEqual`, NFKC |
| Sesión | Token de 32 bytes en cookie `httpOnly` + `Secure` + `SameSite=Lax`. En la base **solo el SHA-256** |
| Duración | 7 días, sliding |
| Bloqueo | 5 intentos fallidos → 15 minutos |
| Recuperación | **No hay correos ni tokens de reset.** Un admin genera una contraseña temporal que se muestra UNA vez |

**No se usa Supabase Auth**: exigiría la `anon key` en el bundle del browser, y la arquitectura la
evita a propósito.

El error de login es **siempre el mismo** exista el email o no. Cada intento va a
`closer_auditoria_accesos`.

### Los seis roles

`super_admin` · `admin` · `closer` · `setter` · `tecnico` · `media_buyer`. Hasta 4 por usuario,
validado en el backend. **`super_admin` solo existe en la empresa principal**, y lo garantiza un
trigger.

`exigir()` deja pasar a un `super_admin` por cualquier lista de roles: es el dueño de la plataforma.
El frontend espeja ese bypass en `tieneRol()` — la protección real es el 403.

---

## Credenciales por empresa

AES-256-GCM con `CIFRADO_MASTER_KEY`, IV por valor, formato `iv:authTag:ciphertext` en base64.
Descifrado **solo en memoria**, en el momento de usar la credencial. En la UI se muestran
enmascaradas (`••••1234`) y **no hay "ver"**.

Consecuencia buscada: una filtración del volcado de Supabase **no entrega ningún token**.

`resolverCredenciales(orgId)` resuelve todo con una caché de 60 s. El fallback a variables de entorno
está restringido **a la empresa principal** y se anota en `desdeEntorno[]`.

Lo que resuelve, por empresa: PIT y `location_id` de GHL, **el calendario**, el secreto del webhook,
la key de Anthropic con su modelo y esfuerzo, el token y la cuenta de Assistable, los de Meta, la
zona horaria y los cuatro prompts.

> **El calendario fue el último en mudarse** (migración `027`). Era `GHL_DEFAULT_CALENDAR_ID`, una
> variable global, y era el único agujero que bloqueaba dar de alta un cliente con agenda: el cron
> le habría pedido a cada empresa los eventos del calendario de ARIA usando el token de esa empresa
> — 404 de GHL, o peor, cero citas sin explicación. Un calendario pertenece a una subcuenta igual
> que el `location_id`.

> **El `??` que anulaba esa decisión.** `env.ghlApiKey()` decía
> `credencialesActivas()?.ghlPit ?? process.env.GHL_PIT`, y ese `??` convertía "esta empresa no
> puede operar" en "opera con el token de ARIA". Ahora, con empresa activa **manda su valor incluido
> el `null`**, y se lanza nombrando la empresa y la credencial que falta.

### El contexto: `activar` vs `conCredenciales`

Las dos abren el contexto de `AsyncLocalStorage` y **no son intercambiables**:

- **`activar(cred)`** usa `enterWith` y deja el contexto abierto para el resto del handler. Es lo de
  un endpoint con sesión.
- **`conCredenciales(cred, fn)`** usa `run` y lo abre y **cierra** alrededor de una función. Es lo
  que necesita un bucle por empresa para que dos iteraciones no se pisen.

> **Medido, no supuesto:** `enterWith()` llamado dentro de una función `async` **no** propaga el
> contexto al que la esperaba. Por eso `exigir()` resuelve las credenciales y el handler las activa
> con una llamada síncrona.

---

## Los caminos de máquina

Los que corren sin sesión de usuario, y los que más caro salieron.

### Webhooks: la empresa la trae el evento

La empresa se resuelve por el **`locationId` del payload** contra `closer_org_config`
(índice único). El secreto se valida **por empresa** — `ghl_webhook_secret` / `assistable_token`,
con el global como fallback.

Consecuencia de diseño: **el cuerpo se parsea ANTES de autenticar**, porque el secreto es por
empresa y de qué empresa se trata lo dice el payload.

> **Las tres formas del `locationId` salieron de los datos, no de la intuición.** Se contaron las 84
> filas de `closer_webhook_inbox` de producción antes de escribir el lector: **GHL manda
> `location.id` ANIDADO en 80 de 81 eventos** y ninguno lo trae arriba; Assistable manda
> `location_id` arriba. Si me hubiera guiado por analogía con `contactId`, la ingesta entera se
> habría vuelto huérfana en el primer deploy.

**D15 · Un evento que no se puede atribuir NO se atribuye por descarte.** Se guarda crudo con
`org_id = null` y no se procesa, con **200** para que GHL no reintente. Mandarlo a la empresa
principal "por ahora" era la tentación, y es una fuga indetectable: los datos de un cliente entrando
a ARIA se ven idénticos a los de ARIA. El índice parcial sobre `org_id is null` de la `019` existe
para auditarlos.

### Crons: una pasada por empresa

Dos crons, los dos con la misma estructura:

| Cron | Cuándo | Qué hace |
|---|---|---|
| `/api/closer/citas-respaldo` | :25 y :55 | Reconcilia la agenda y refresca contactos con cita próxima |
| `/api/meta-respaldo` | 06:20 UTC | Sincroniza las métricas de pauta |

Los dos: fallan **cerrado** sin `CRON_SECRET`, recorren `organizacionesActivas()`, llevan un `try`
**por iteración** —una empresa con el token vencido no corta a las demás— y devuelven **207** si
alguna falló. No es un éxito y tampoco un fracaso si las otras corrieron.

El corte por credenciales le pregunta **a la empresa**, no al entorno: una empresa recién creada se
saltea diciéndolo, en vez de heredar el token de ARIA.

`maxDuration` de `citas-respaldo` subió de 60 s a **300 s**: los 60 estaban dimensionados para una
pasada y el bucle es secuencial.

---

## El auditor, por empresa

| Qué | De dónde sale |
|---|---|
| API key de Anthropic | De la empresa. Sin ella **no audita** y lo dice con su nombre |
| Modelo y esfuerzo | De la empresa, con default global (`claude-sonnet-5` / `high`) |
| El prompt del agente auditado | De `closer_org_config`, **no de un archivo** |
| El candado | `closer_auditor_claim(p_org_id, …)` |
| La caché del prompt | Indexada por **empresa + agente** |

> **`new Anthropic()` sin argumentos** lee `process.env.ANTHROPIC_API_KEY`, así que todas las
> auditorías se le facturaban a ARIA — las de sus clientes también. No es una fuga de datos: es una
> fuga de plata, y del tipo que no se nota hasta la factura.

> **El prompt: la mitad estaba hecha.** El camino de ESCRITURA estaba terminado desde la fase 4 —el
> cliente pegaba su prompt, veía su hash y sus líneas confirmados en pantalla— y el de LECTURA
> seguía en `readFileSync` sobre `docs/prompts/<agente>.md`. **Esos dos archivos nunca existieron.**
> El auditor corrió todo ese tiempo sin prompt de referencia mientras la pantalla decía que estaba
> cargado. Un éxito reportado sin efecto, que es lo que §4.2 prohíbe.

`cargarPromptAgente()` **sigue siendo síncrona**: el prompt viaja dentro de `Credenciales` en vez de
consultarse al usarlo, porque `api/agentes/alertas.ts` la llama dentro de un `map` síncrono.

El hash **se recalcula del texto** en cada lectura y no se lee de la columna `*_hash`: esa dice qué
hash tenía el texto al guardarse, y el que vale para comparar contra
`closer_hallazgo_agente.prompt_hash` es el del texto que el auditor está usando ahora.

---

## El panel de administración

Cinco pestañas de **Ajustes** (no un módulo aparte del sidebar):

| Pestaña | Rol | Qué |
|---|---|---|
| Mi cuenta | `admin` | Calendario, link personal, sonido de venta |
| Operación | `admin` | Catálogo de enlaces, comisiones, parámetros del panel |
| Usuarios | `admin` | Alta, roles, contraseñas temporales |
| Credenciales | `admin` | Credenciales enmascaradas, prompts, modelo del auditor |
| Empresas | `super_admin` | Alta, edición, baja lógica |

Un `admin` de una empresa cliente **no sabe que existen otras**: no ve la pestaña Empresas, no puede
otorgar `admin` ni `super_admin`, y si pide un usuario de otra empresa recibe **404** — no 403,
porque confirmar que el id existe ya sería filtrar.

`org_id` de un usuario **no es editable**. Moverlo de empresa con un PATCH sería la vía más
silenciosa de darle acceso a otra.

### El selector de empresa del super admin

Vive en `closer_sesiones.empresa_activa`, **no en un parámetro del request**: si viajara por request
el aislamiento se caería editando un id en la URL. Queda en auditoría, y un **banner permanente**
dice de qué empresa son los datos que se están viendo.

Al cambiar **se recarga la página**: los cuatro providers tienen en memoria los contactos, la agenda
y las alertas de la empresa anterior.

---

## Qué se rompió por el camino

Lo que costó tiempo, para que no cueste dos veces.

| Inconveniente | Cómo se resolvió |
|---|---|
| **`BEFORE UPDATE` triggers** abortaban el backfill que pedía la spec | Se usó `add column not null default '<ARIA>'`: sin UPDATE, sin disparar triggers, sin reescribir la tabla (PG 11+) |
| **`enterWith()` dentro de `async`** no propaga el contexto al que espera | Se midió con un test dedicado. `exigir()` resuelve y el handler activa **síncronamente** |
| **`cacheCampos` de GHL** estaba indexado sin la subcuenta | La clave lleva el `locationId`, y se lee DENTRO de la función y no al cargar el módulo |
| **`rol` era `NOT NULL`** y bloqueaba el insert del super admin | `alter column rol drop not null`. La columna **no se dropeó** (D5): el contract va después |
| **Un test se desplegó como endpoint** | Vercel convierte en función serverless todo `.ts` bajo `api/` y su único filtro es `/_`. Verificado leyendo la fuente de su CLI. Los tests de `api/` van con guion bajo |
| **El test de aislamiento pasaba por un comentario** | Las nueve comprobaciones miran el fuente sin comentarios. Verificado saboteando el código |
| **Un comentario mío describía mal el bug que arreglaba** | Corregido. La lista vieja **sí** incluía `admin`, y por eso rebotaba |
| **`git checkout` sobre trabajo sin commitear** | Se perdió el bucle del cron y hubo que rehacerlo. No usar `git checkout` para revertir un sabotaje de prueba |
| **Vercel activó su Security Checkpoint** por el volumen de `curl` | Los navegadores lo pasan solo. Verificar con el navegador, no con `curl` |
| **Un segundo almacén de credenciales sin consumidores** | `closer_conexiones` guarda `ghl_calendar_id` y **nadie la lee**: `env.ts` no la consulta. Es el mismo modo de fallar que los prompts. El calendario se puso en `closer_org_config`, no ahí |

### Bugs que la migración destapó y no había creado

| Bug | Estado |
|---|---|
| Un `admin` no podía editar a **ningún** usuario con rol `admin`, ni a sí mismo | Arreglado: `validarRoles` compara el **cambio**, no la lista |
| Resolver una intervención no quitaba `bot_pausado_fallo` | Arreglado. `removerTags` existía y nadie lo llamaba |
| El texto de los agentes de voz decía que GHL no expone la transcripción | **Falso** desde la `016`. Corregido |
| `media_buyer` se podía asignar y no tenía ninguna entrada de sidebar | Arreglado con Adquisición |
| `gerenciaStore` afirmaba que Equipo era "100% EN VIVO" | **Falso**. `atribucionSetter` nunca se asigna. Store borrado |
| El show rate tenía **tres** definiciones con denominadores distintos | Una sola, la de `inicio.ts` |

---

## Lo que queda

### Deuda con fecha

- **El contract de las funciones SQL.** `closer_hoy_org()`, `closer_dia_org(p_momento)` y
  `closer_auditor_claim(p_contact_id, p_ventana)` siguen vivas en sus versiones sin empresa. Se
  dejan a propósito hasta verificar el deploy: dropearlas ahora convertiría cualquier llamador que
  se haya escapado en un error inmediato en producción. **Dropear después de una semana estable.**
- **`closer_usuarios.rol`** (singular) sigue existiendo, nullable, sin usarse. Mismo criterio.
- **`ZONA_HORARIA_ORG`** está hardcodeada en `src/lib/fechas.ts`. `env.zonaHoraria()` ya la resuelve
  por empresa; falta que los consumidores la usen.
- **`AUDITOR_USER_IDS_IA`** y las otras cinco perillas del auditor son globales. Deberían ser por
  empresa.

### Lo que el sistema no puede medir

Está en [10-ESTADO](10-ESTADO.md) § *Lo que no existe*, y el endpoint de Estadísticas lo devuelve en
`sinDato` para que la vista lo diga en pantalla. Lo grande: el gasto en pauta antes de que corra el
cron de Meta, la clasificación caliente/tibio, el corte high-ticket/low-ticket, las métricas del
setter (nada de `api/setter/` escribe todavía) y el historial anterior a este sistema.

### Operativo

- **Rotar el token de Facebook.** Estuvo en reposo en `closer_webhook_inbox`. Ya está redactado, el
  token sigue vivo.
- **Rotar `Fabio@123`.** Es super admin sobre las cinco empresas y circuló en texto plano.
- **`Quiroz Prueba` sigue con `bot_pausado_fallo`** de la prueba del auditor.

---

## Dónde está cada cosa

| Archivo | Qué |
|---|---|
| `api/_lib/db.ts` | El Proxy. **Único autorizado a `createClient`** |
| `api/_lib/repo.ts` | `db()` y `orgActiva()` desde el contexto |
| `api/_lib/credenciales.ts` | Resolución por empresa, `activar`, `conCredenciales` |
| `api/_lib/cifrado.ts` | AES-256-GCM |
| `api/_lib/auth.ts` | `exigir`, `contextoDe`, `auditar` |
| `api/_lib/sesion.ts` | Crear, renovar y cerrar sesiones |
| `api/_lib/ruteoWebhook.ts` | `locationId` → empresa, y el huérfano de D15 |
| `api/_lib/meta/` | Puerto, adapter real/stub y colector de pauta |
| `api/_lib/aislamiento.test.ts` | La capa 2 |
| `src/lib/authStore.tsx` | La sesión en el browser |
| `src/lib/enDesarrollo.tsx` | El helper y el velo de §8 |
| `docs/db/018`–`027` | Las migraciones, cada una con su porqué en el encabezado |
