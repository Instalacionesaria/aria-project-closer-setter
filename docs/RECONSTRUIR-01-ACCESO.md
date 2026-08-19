# RECONSTRUIR · 01 — Acceso: contraseñas, sesiones y bloqueo

Todo lo que pasa entre "alguien escribe su email" y "el backend sabe quién es".

Archivos de referencia: `api/auth/login.ts`, `api/auth/sesion.ts`, `api/_lib/sesion.ts`,
`api/_lib/password.ts`.

---

## 0 · Por qué autenticación propia y no la del proveedor de base de datos

La base corre en un proveedor que trae su propio sistema de autenticación. No se usa, y el motivo
manda sobre todo lo demás de esta serie:

**usarlo exigiría poner la clave anónima del proveedor en el bundle del navegador.** Y esa clave es
lo único que separa "el frontend habla con nuestra API" de "el frontend habla con la base". Con ella
publicada, el aislamiento del documento 03 no vale nada: cualquiera con la consola abierta consulta
las tablas directamente.

La arquitectura es que **el frontend solo habla con nuestra API**. Meter la clave del proveedor para
ahorrarse un login sería regalar el aislamiento entero a cambio de una semana de trabajo.

El costo de la decisión es lo que ocupa el resto de este documento: hay que escribir el hash de
contraseñas, las sesiones, el bloqueo por intentos y el manejo de cookies. Son ~400 líneas, y todas
usan la biblioteca estándar.

---

## 1 · Contraseñas

**scrypt**, de la biblioteca estándar del runtime, sin dependencias externas. Cada dependencia en la
ruta de autenticación es superficie de ataque y una versión más que hay que vigilar.

| Parámetro                  | Valor                                | Por qué                                                                      |
| -------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `N` (costo CPU/memoria)    | `16384`                              | `128 · N · r` = **16 MB** por hash, debajo del `maxmem` por defecto de 32 MB |
| `r` (tamaño de bloque)     | `8`                                  | El estándar recomendado                                                      |
| `p` (paralelismo)          | `1`                                  |                                                                              |
| Largo de clave             | `64` bytes                           |                                                                              |
| Largo de salt              | `16` bytes, aleatorio por contraseña |                                                                              |
| Largo mínimo de contraseña | `8` caracteres                       |                                                                              |

**El formato guardado lleva sus propios parámetros adentro:**

```
scrypt$16384$8$1$<salt en base64>$<hash en base64>
```

Eso es lo que permite **subir el costo sin invalidar las contraseñas viejas**: cada hash se verifica
con los parámetros con los que nació, y los nuevos usan los actuales. Guardar solo el hash y tener
`N` como constante del código significa que el día que quieras endurecerlo tenés que resetearle la
contraseña a todo el mundo.

Tres detalles que no son opcionales:

- **La comparación es en tiempo constante** (`timingSafeEqual`), nunca `===`. Una comparación que
  corta en el primer byte distinto filtra información por el tiempo que tarda.
- **La contraseña se normaliza a NFKC** antes de hashear. Sin eso, la misma contraseña tipeada en
  otro teclado o sistema operativo puede llegar con otra composición Unicode y no coincidir.
- **Un hash con formato inválido devuelve `false`**, no una excepción. Un registro corrupto no puede
  convertirse en un 500 que revele que ese usuario existe.

> **Si reconstruís con otro algoritmo**: argon2id es la recomendación actual y es mejor opción si tu
> lenguaje la trae. Buscá un costo equivalente a ~16 MB de memoria y ~100 ms por hash en tu
> hardware. Lo que **no** cambia es el resto: parámetros embebidos en el string, comparación en
> tiempo constante, normalización Unicode.

---

## 2 · Sesiones

**Token opaco en cookie, con la sesión en una tabla.** No JWT.

| Aspecto       | Cómo                                                    |
| ------------- | ------------------------------------------------------- |
| Generación    | 32 bytes aleatorios, `base64url`                        |
| Qué se guarda | **Solo el SHA-256 del token**, nunca el token           |
| Duración      | 7 días                                                  |
| Renovación    | Si al usarla le quedan menos de 6 días, se extiende a 7 |
| Cierre        | Se borra la fila                                        |

**El token en claro no existe del lado del servidor.** Se genera, viaja en la cookie y se guarda
hasheado. Si alguien se lleva un dump de la base no puede hacerse pasar por nadie: tendría los
hashes, y de un SHA-256 de 32 bytes aleatorios no se vuelve.

**Y se hashea con SHA-256, no con scrypt.** No es una inconsistencia con las contraseñas: el token
ya son 32 bytes aleatorios, así que no hay diccionario que probar. El costo de scrypt no compraría
nada y se pagaría en **cada request**.

La renovación tiene un detalle que conviene copiar: **si el UPDATE falla, no se echa a nadie y no se
reemite la cookie.** La sesión sigue válida hasta su vencimiento original. Así cookie y base nunca
quedan diciendo fechas distintas — y un error transitorio de escritura no cierra la sesión de nadie.

**La expiración se compara en la consulta**, no en el lenguaje:

```sql
where token_hash = $1 and expira_el > now()
```

Filtrarla después haría que el reloj del proceso —o el de un contenedor mal sincronizado— decidiera
si una sesión vencida sigue valiendo. En serverless son procesos distintos con relojes que pueden
diferir; la base es el único reloj compartido.

**Y la resolución de la sesión falla CERRADO**: un error de red al consultarla se trata como "no hay
sesión". Es lo contrario de la regla general del proyecto —no confundir "no hay" con "no pude
averiguar"— y acá es deliberado: en autenticación, ante la duda no se entra.

### La cookie

```
cc_sesion=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=<fecha>
```

- **`HttpOnly`**: ningún script de la página puede leerla. Un XSS deja de ser un robo de sesión.
- **`Secure`**: no viaja por HTTP en claro.
- **`SameSite=Lax`**, y no `Strict`: corta el CSRF en las peticiones que importan, pero con `Strict`
  la cookie **no viaja** cuando alguien llega desde un enlace externo, y esa persona vería la
  pantalla de login teniendo sesión válida.
- Se borra con `Max-Age=0` **y el mismo juego de flags** — una cookie borrada con flags distintos
  puede quedar viva en algunos navegadores.

> **Por qué no JWT.** Un JWT no se puede revocar sin una lista negra, y una lista negra es
> exactamente la tabla que el JWT venía a evitar. Acá hacen falta tres cosas que la tabla da gratis:
> cerrar la sesión al instante (al cambiar la contraseña se cierran **todas** las del usuario), saber
> desde qué IP y con qué navegador se abrió, y que el super admin cambie de empresa **dentro** de su
> sesión sin reemitir nada. El costo es una consulta por request, con índice único sobre
> `token_hash`.

---

## 3 · Bloqueo por intentos

Dos defensas en capas distintas, porque protegen de ataques distintos.

**Por cuenta** — contra alguien que ataca a un usuario concreto:

|                     |                                                         |
| ------------------- | ------------------------------------------------------- |
| Intentos permitidos | 5                                                       |
| Bloqueo             | 15 minutos                                              |
| Dónde vive          | `closer_usuarios.intentos_fallidos` y `bloqueado_hasta` |
| Reset               | Un login exitoso pone el contador en cero               |

**Por IP** — contra alguien que prueba muchas cuentas desde un lugar:

|                   |                                                                    |
| ----------------- | ------------------------------------------------------------------ |
| Fallos permitidos | 20                                                                 |
| Ventana           | 15 minutos                                                         |
| Dónde vive        | Se **cuenta sobre la tabla de auditoría**; no hay una tabla aparte |
| Respuesta         | `429`                                                              |

Que el conteo por IP salga de la auditoría es deliberado: esos eventos ya se registran para poder
investigar, y una segunda tabla con la misma información sería un dato duplicado que puede divergir.

**Si la consulta del conteo por IP falla, NO se bloquea.** Un error de lectura no puede dejar afuera
a todo el mundo — el bloqueo por cuenta sigue en pie, que es la defensa principal. Es la única
decisión de esta serie donde el fallo se abre en vez de cerrarse, y está acotada a propósito.

---

## 4 · El flujo del login, paso a paso

```
POST /api/auth/login   { email, password }
```

1. **Método y cuerpo.** `405` si no es POST; `400` si falta email o contraseña.
2. **Freno por IP.** Si esa IP acumula 20 fallos en 15 minutos → `429`. Se corta acá, **antes de
   tocar la tabla de usuarios**.
3. **Se busca el usuario** por email (índice único sobre `lower(email)`: no importa cómo lo escriba).
4. **¿Bloqueado?** Si `bloqueado_hasta` es futuro → `429` con los minutos que faltan.
5. **Se verifica la contraseña** contra el hash guardado, en tiempo constante.
6. **Si falla** → se suma el fallo, se audita, y se responde `401` con **el mismo mensaje siempre**:
   _"Credenciales inválidas."_
7. **Si entra** → contador a cero, se sella `ultimo_acceso_el`, se crea la sesión, se pone la
   cookie, se audita, y se responde `200`:

```json
{
  "ok": true,
  "usuario": {
    "id": "…",
    "nombre": "…",
    "email": "…",
    "roles": ["closer"],
    "orgId": "…",
    "debeCambiarPassword": false
  }
}
```

### El mensaje de error es siempre el mismo, y es a propósito

`401` con _"Credenciales inválidas."_ para las tres situaciones: el email no existe, la cuenta está
inactiva, o la contraseña está mal. Distinguirlas le confirma a un atacante qué emails son reales —
un enumerador de cuentas gratis.

**El motivo real sí se guarda**, en la auditoría (`email_inexistente` / `cuenta_inactiva` /
`password`), para poder investigar. La distinción existe; lo que no existe es contársela a quien
pregunta.

**La excepción deliberada: cuando la cuenta está bloqueada, se dice.** Rompe el mensaje único a
propósito — quien llegó hasta ahí ya sabe que la cuenta existe, porque la bloqueó él. Ocultarlo solo
confunde al dueño legítimo, que necesita saber que tiene que esperar quince minutos.

**La contraseña nunca se registra, ni la fallida.** Un log de contraseñas fallidas es un diccionario
de contraseñas reales de tus usuarios, con sus emails al lado.

### Y el mensaje igual no alcanza: hay que gastar el mismo tiempo

Responder _"no existe"_ al instante y _"contraseña mal"_ 100 ms después **dice exactamente lo que el
mensaje único venía a esconder**. Con un cronómetro, cualquiera enumera cuentas igual.

Por eso, cuando el email no existe, el login **igual deriva scrypt contra un hash señuelo**:

```ts
const SENUELO =
  "scrypt$16384$8$1$<salt fijo>$<hash de una contraseña que nadie conoce>";
```

Mismos parámetros que uno real, así que cuesta lo mismo. Su contraseña es un `randomBytes` que se
tiró: no hay forma de que coincida con nada.

Un detalle de implementación que es **load-bearing** y conviene no "limpiar": la comparación de
longitudes va **después** de derivar, no antes. Si se cortara antes por longitud distinta, el camino
del señuelo terminaría más rápido que el de un hash real y el canal de tiempo volvería a abrirse por
la puerta de al lado.

---

## 5 · El resto de la superficie de sesión

Un solo endpoint, `/api/auth/sesion`, ruteado por método:

| Método              | Qué hace                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- |
| `GET`               | Quién soy: usuario, roles, empresa que estoy mirando, si debo cambiar la contraseña |
| `DELETE`            | Cerrar sesión (borra la fila y la cookie)                                           |
| `POST`              | Cambiar la contraseña                                                               |
| `POST ?accion=tema` | Guardar la preferencia de tema                                                      |
| `PATCH`             | El super admin cambia de empresa activa                                             |

**`GET` sin sesión válida devuelve `200` con `autenticado: false`**, no `401`. Es la pregunta "¿hay
alguien?", y no tener sesión es una respuesta legítima. Reservar el `401` para _"tenías sesión y se
venció"_ es lo que le permite al frontend distinguir "mostrá el login" de "se te venció, avisá".

Y hay una razón mecánica además de la semántica: **esta llamada es la única del frontend que no
pasa por el cliente HTTP común**. Si pasara, el `401` dispararía el evento de "sesión perdida" que
escucha el store de sesión, y la comprobación de arranque entraría en bucle con quien la escucha.

**El `DELETE` borra la cookie siempre**, incluso si no había sesión válida. Si el navegador tiene
una cookie vencida o de una sesión ya borrada, ésta es la única forma de que deje de mandarla.

**Cambiar la contraseña exige la contraseña ACTUAL**, aunque haya sesión válida. Sin eso, una sesión
robada permite cambiar la contraseña y quedarse con la cuenta para siempre.

**Al cambiarla se cierran todas las sesiones del usuario** y se abre una nueva para el navegador que
la cambió. Si alguien te robó la sesión, cambiar la contraseña lo echa — que es lo que
cualquiera espera, y con JWT no pasaría.

---

## 6 · Las tablas

```sql
closer_usuarios
  id                      uuid    primary key
  org_id                  uuid    not null          -- su empresa
  nombre                  text    not null
  email                   text                      -- único por lower(email), parcial
  password_hash           text                      -- el string scrypt$… completo
  roles                   text[]  not null          -- CHECK de valores y tope de 4
  activo                  boolean not null
  es_admin_principal      boolean not null          -- índice único parcial: hay UNO
  debe_cambiar_password   boolean not null
  intentos_fallidos       integer not null
  bloqueado_hasta         timestamptz
  ultimo_acceso_el        timestamptz
  creado_por              uuid    references closer_usuarios(id)
  ghl_user_id             text    unique            -- para cruzar con el CRM
  tema                    text                      -- CHECK: claro | oscuro
```

```sql
closer_sesiones
  id              uuid        primary key
  usuario_id      uuid        not null references closer_usuarios(id) on delete cascade
  token_hash      text        not null unique       -- SHA-256 del token
  empresa_activa  uuid        references closer_org_config(org_id) on delete set null
  expira_el       timestamptz not null
  ip              text
  user_agent      text
  creada_el       timestamptz not null

-- índices: (expira_el) para la limpieza futura, (usuario_id) para cerrar todas las de uno
```

```sql
closer_auditoria_accesos
  id          bigserial   primary key
  usuario_id  uuid                    -- nullable: un login con email inexistente no tiene usuario
  org_id      uuid
  accion      text not null           -- login | login_fallido | …
  detalle     jsonb                   -- el motivo real del fallo. NUNCA la contraseña
  ip          text
  creado_el   timestamptz not null default now()

-- índices: (creado_el desc), (org_id, creado_el desc)
```

### Dos restricciones que conviene copiar tal cual

```sql
-- Una cuenta tiene email y contraseña, o ninguno de los dos. No existe media cuenta.
check ((email is null and password_hash is null) or (email is not null and password_hash is not null))

-- El email es único sin importar mayúsculas, y solo cuando existe.
create unique index on closer_usuarios (lower(email)) where email is not null;
```

La primera existe porque el sistema tiene usuarios **sin** login: personas que vienen del CRM y solo
sirven para atribuir trabajo. Un usuario con email y sin contraseña sería una cuenta que no puede
entrar y nadie sabría por qué; con contraseña y sin email, una que no se puede identificar.

El índice **parcial** (`where email is not null`) es lo que deja convivir a los dos tipos: sin el
`where`, todos los usuarios sin email colisionarían entre sí en `null`.

---

## 7 · Lo que este sistema NO tiene

Dicho de frente, porque al reconstruir conviene saber qué falta y no descubrirlo por accidente:

- **No hay 2FA.**
- **No hay recuperación de contraseña por email.** La resetea un admin y entrega una temporal con
  `debe_cambiar_password` en `true`.
- **No hay refresh tokens.** La sesión se extiende sola al usarse.
- **No hay límite de sesiones simultáneas** por usuario.
- **No hay rotación del token** en cada request, solo extensión de la expiración.
- **No hay limpieza automática de sesiones vencidas.** El índice sobre `expira_el` está puesto para
  cuando haga falta un job; hoy las filas vencidas quedan y no molestan porque la consulta las
  descarta.
