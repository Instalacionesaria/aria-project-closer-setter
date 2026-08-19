# RECONSTRUIR · 02 — Roles y permisos

Quién puede hacer qué, dónde se decide, y por qué el frontend no cuenta.

Archivos de referencia: `api/_lib/auth.ts` (el portero), `src/App.tsx` (el menú),
`src/lib/authStore.tsx` (`tieneRol`), `api/_lib/aislamiento.test.ts` (el test que lo hace cumplir).

---

## 1 · Los seis roles

Se guardan en `closer_usuarios.roles`, un **array de texto**. Un usuario puede tener varios: quien
cierra y también configura es `["closer", "admin"]`, y ve las dos cosas.

| Rol           | Para qué existe                                                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `super_admin` | Dueño de la plataforma. Ve **todas** las empresas y puede cambiar de una a otra dentro de su sesión. Solo existe en la empresa principal |
| `admin`       | Administra **su** empresa: usuarios, credenciales, comisiones, configuración, estadísticas                                               |
| `closer`      | Opera post-agenda: Mi Día, Pipeline, Avanzar, chat, la ficha del contacto                                                                |
| `setter`      | Opera pre-agenda. Su espejo                                                                                                              |
| `tecnico`     | Auditoría de agentes IA: salud, hallazgos, prompts. Y **lee** la ficha del contacto                                                      |
| `media_buyer` | Adquisición: métricas de pauta                                                                                                           |

La base impone dos límites:

```sql
-- Solo estos seis valores. Un rol inventado no entra.
check (roles <@ array['super_admin','admin','closer','setter','tecnico','media_buyer'])

-- Tope de 4 roles por usuario.
check (coalesce(array_length(roles, 1), 0) <= 4)
```

El tope de 4 no es una regla de negocio profunda: es un freno contra el usuario que acumula todo
"por comodidad" y termina siendo una cuenta con la que se puede hacer cualquier cosa. Si alguien
necesita los seis, lo que necesita es `super_admin`.

Y una tercera, por trigger:

```sql
-- El rol super_admin solo existe en la empresa principal.
create trigger closer_usuarios_super_admin_acotado …
```

Sin eso, un admin de una empresa cliente podría crear un `super_admin` dentro de su propia empresa
y con él ver a todas las demás. Es una **escalada de privilegios entre inquilinos**, y por eso la
frena Postgres y no un `if`.

---

## 2 · El portero del backend

Una sola función, y todo endpoint empieza llamándola:

```ts
const ctx = await exigir(req, res, ["closer", "setter"]);
if (!ctx) return;
```

**La firma obliga a escribir el `if (!ctx) return`.** `exigir` ya respondió el error cuando devuelve
`null`, así que olvidarse del guard no abre el endpoint: rompe la compilación en cuanto se usa `ctx`.
Es deliberado — un portero que devolviera un booleano se podría ignorar en silencio.

### El orden de las validaciones importa

| #   | Chequeo                                 | Falla con                         |
| --- | --------------------------------------- | --------------------------------- |
| 1   | ¿Hay sesión válida?                     | `401` `sin_sesion`                |
| 2   | ¿Debe cambiar la contraseña?            | `403` `password_temporal`         |
| 3   | ¿La empresa está activa?                | `403` `empresa_inactiva`          |
| 3b  | ¿Se pudieron resolver sus credenciales? | `503` `credenciales_irresolubles` |
| 4   | ¿`roles === "cualquiera"`?              | pasa                              |
| 5   | ¿Es `super_admin`?                      | pasa                              |
| 6   | ¿Tiene alguno de los roles pedidos?     | `403` `sin_permiso`               |

Cuatro cosas que ese orden decide, y que conviene copiar:

**El guard de contraseña temporal va segundo, antes de los roles.** Un usuario con contraseña
temporal no puede hacer nada salvo cambiarla. Si el chequeo fuera al final, un endpoint que no pide
roles lo dejaría operar con una contraseña que le dictaron por teléfono.

**El endpoint de cambio de contraseña pasa `"cualquiera"`**, y por eso no se bloquea a sí mismo. Es
la única salida del estado 2.

**La empresa se resuelve ANTES de devolver el contexto**, no dentro de cada endpoint. Una empresa
desactivada no opera, y averiguarlo acá evita que cada endpoint tenga que acordarse. Además deja el
contexto con las credenciales ya cargadas — lo que el documento 03 necesita.

**Si las credenciales no se pueden descifrar se responde `503`, no `500`.** No es un bug del código:
es una configuración que hay que arreglar (la clave maestra cambió, o la credencial se cargó con
otra). Dejar pasar el request produciría llamadas al CRM con un token vacío y un `401` imposible de
diagnosticar.

### El bypass de super_admin

`if (ctx.esSuperAdmin) return ctx;` — pasa todos los chequeos de rol, en el paso 5.

Está **después** de los pasos 1-3: un super admin con la sesión vencida, o con contraseña temporal, o
mirando una empresa desactivada, sigue siendo rechazado. El bypass es solo de **roles**, no de
autenticación ni de estado.

Conviene tenerlo presente al leer el mapa de abajo: cada línea dice "estos roles **o** super_admin".

---

## 3 · El mapa completo: rol → endpoint

Extraído del código, no de la memoria. Es lo que hay que replicar.

### Operación

| Endpoint                                                                                               | Roles              |
| ------------------------------------------------------------------------------------------------------ | ------------------ |
| `closer/mi-dia`, `pipeline`, `inicio`, `agenda`, `avanzar`, `mensajes`, `plantillas`, `buzon-resolver` | `closer`           |
| `setter/mi-dia`, `pipeline`, `inicio`, `avanzar`, `urgentes`                                           | `setter`           |
| `closer/tick`                                                                                          | `closer`, `setter` |

### La ficha del contacto — los cinco tabs

| Endpoint                                                  | Roles                         |
| --------------------------------------------------------- | ----------------------------- |
| `closer/chat`, `notas`, `historial`, `perfil`, `llamadas` | `closer`, `setter`, `tecnico` |

**Los cinco piden exactamente los mismos roles, y eso es una invariante con test.** La ficha se abre
desde tres lugares —Closer, Setter y Auditoría de Agentes— y si un tab pidiera un rol distinto de sus
hermanos, ese tab se vería vacío para alguien que ve los otros cuatro. Peor: **un `403` acá no se ve
como error, se ve como dato vacío**, porque el cliente lo convierte en "este contacto no tiene nada".

Ese bug existió: `tecnico` estaba solo en `llamadas`, así que quien auditaba abría la ficha de una
persona real y veía un tab con datos y cuatro en blanco.

### Auditoría de agentes IA

| Endpoint                                                            | Roles                             |
| ------------------------------------------------------------------- | --------------------------------- |
| `agentes/texto`, `alertas`, `analisis`, `ajustes`, `auditor-estado` | `tecnico`                         |
| `agentes/prompts`                                                   | `tecnico`, `admin`, `super_admin` |

### Administración

| Endpoint                                                    | Roles         |
| ----------------------------------------------------------- | ------------- |
| `admin/usuarios`, `configuracion`, `comisiones`, `webhooks` | `admin`       |
| `closer/contactos`, `sincronizar`, `reconciliar`            | `admin`       |
| `diagnostico`, `estadisticas`                               | `admin`       |
| `admin/empresas`, `admin/alta`                              | `super_admin` |
| `auth/sesion` (PATCH: cambiar de empresa)                   | `super_admin` |

### Adquisición

| Endpoint      | Roles                  |
| ------------- | ---------------------- |
| `acquisition` | `media_buyer`, `admin` |

### Sesión

| Endpoint                          | Roles                         |
| --------------------------------- | ----------------------------- |
| `auth/login`                      | — (público, con freno por IP) |
| `auth/sesion` (GET, DELETE, POST) | `"cualquiera"`                |

### Los crons no usan roles

`voz-respaldo`, `territorio-respaldo`, `meta-respaldo`, `auditor-amarillo`, `closer/citas-respaldo`
y `mensajes-respaldo` **no** llaman a `exigir`. Se autentican con un secreto compartido:

```
Authorization: Bearer <CRON_SECRET>
```

Y **fallan cerrado**: si la variable no está configurada, responden `503` y no corren. Un cron sin
secreto es un endpoint abierto que recorre todas las empresas — mejor caído y visible que abierto y
silencioso.

---

## 4 · El frontend no decide permisos

El menú se arma filtrando por rol:

```ts
const visibleNav = NAV.filter((n) => tieneRol(...n.roles));
```

Y `tieneRol` tiene el mismo bypass de super admin que el backend, para que las dos mitades digan lo
mismo.

**Eso es comodidad, no seguridad.** Cualquiera puede pedirle a la API lo que quiera con `curl` y su
cookie; el menú solo evita que la gente vea puertas que no puede abrir. La única frontera está en
`exigir`, y el mapa de la sección 3 es la lista completa de cerraduras.

Vale decirlo al reconstruir porque la tentación es fuerte: si el menú ya oculta Adquisición, parece
que el endpoint no necesita validar. Necesita.

### El test que lo hace cumplir

Hay un test que **lee el código fuente de cada archivo bajo `api/`** y verifica que:

- llame a `exigir(...)` o sea un cron con su secreto,
- active las credenciales de su empresa (documento 03),
- y no use la escotilla sin scope sin estar en una lista autorizada a mano.

Es lint arquitectónico escrito como test. Existe porque catorce endpoints ya estaban escritos sin
activar credenciales, y ninguno fallaba: simplemente leían los datos de la empresa equivocada. **Un
endpoint nuevo que se olvide del portero rompe la suite**, que es la única forma de que no se olvide.

Si reconstruís esto en otro lenguaje, replicá el test antes que el resto: es lo que sostiene todo lo
demás cuando el equipo crece.

---

## 5 · El super admin que mira otra empresa

Es el caso que más fácil se rompe, así que va explícito.

Un `super_admin` puede elegir sobre qué empresa trabaja. Eso vive **en la sesión**, no en un
parámetro del request:

```
closer_sesiones.empresa_activa  →  uuid de la empresa elegida (nullable)
```

Y el contexto expone dos cosas distintas:

| Campo         | Qué es                               |
| ------------- | ------------------------------------ |
| `orgPropia`   | La empresa del usuario (su `org_id`) |
| `orgEfectiva` | Sobre la que está trabajando ahora   |

```ts
const orgEfectiva =
  esSuperAdmin && sesion.empresaActiva ? sesion.empresaActiva : orgPropia;
```

**Todo lo demás usa `orgEfectiva`.** Es lo que hace que el Proxy del documento 03 inyecte el `org_id`
correcto sin que ningún endpoint se entere del asunto.

**Y la autorización la decide el ROL, no el dato guardado.** El contexto solo respeta
`empresa_activa` si el usuario es `super_admin`. Si alguien escribiera esa columna por otra vía —un
script, un bug, una migración— un usuario común seguiría trabajando en su propia empresa: el valor
está ahí y el código no lo mira. Es la diferencia entre "el dato dice que puede" y "el rol dice que
puede".

Que viva en la sesión y no en el request es la otra mitad: si fuera un parámetro
(`?empresa=…`), cualquiera podría probar el uuid de otra empresa y habría que validar en cada
endpoint que le corresponde. En la sesión, la elección ya pasó por el `PATCH` que exige
`super_admin`, y el resto del sistema puede confiar en ella.

**La interfaz muestra un banner permanente** cuando `orgEfectiva ≠ orgPropia`. No es decoración: sin
eso, un super admin puede mirar la pantalla, sacar una conclusión sobre "los números" y estar viendo
los de otro cliente.
