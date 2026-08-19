# 02 — Autenticación: contraseñas, sesiones y bloqueo

Todo lo que pasa entre "alguien escribe su email" y "el servidor sabe quién es".

Este documento es autosuficiente: no depende de los otros de la carpeta.

---

## 0 · Por qué autenticación propia y no la del proveedor

Casi todos los proveedores de base de datos traen su propio sistema de autenticación. Antes de usarlo,
verificá una cosa: **¿exige publicar una clave del proveedor en el navegador?**

Si la respuesta es sí, esa clave es lo único que separa "el frontend habla con mi API" de "el frontend
habla con la base de datos". Publicándola, todo el aislamiento entre organizaciones deja de valer:
cualquiera con la consola del navegador abierta consulta las tablas directamente.

En un sistema multiempresa eso es un intercambio malo: se ahorra una semana de trabajo y se regala la
propiedad que sostiene el producto entero.

**El costo de hacerlo propio son unas 400 líneas** —hash de contraseñas, sesiones, bloqueo, cookies— y
todas usan la biblioteca estándar del lenguaje. No hace falta ninguna dependencia nueva, y eso importa:
cada dependencia en la ruta de autenticación es superficie que hay que auditar y una versión que hay
que vigilar.

---

## 1 · Contraseñas

### El algoritmo

Un hash **lento a propósito**. Cualquiera de estos tres:

| Algoritmo  | Cuándo elegirlo                                                                         |
| ---------- | --------------------------------------------------------------------------------------- |
| `argon2id` | La recomendación actual. Si tu lenguaje lo trae en la biblioteca estándar, éste         |
| `scrypt`   | Si `argon2id` exigiría una dependencia externa. Está en la estándar de muchos lenguajes |
| `bcrypt`   | Aceptable, pero trunca a 72 bytes y no tiene costo de memoria                           |

**Nunca un hash rápido.** Un SHA-256 de una contraseña se prueba a mil millones por segundo en una
placa de video. Un hash lento hace que probar un diccionario cueste meses en vez de minutos.

Parámetros de referencia para `scrypt`, calibrados para ~100 ms por hash:

```
N = 16384        (costo CPU/memoria)
r = 8            (tamaño de bloque)
p = 1            (paralelismo)
largoClave = 64  bytes
largoSalt = 16   bytes, aleatorio POR CONTRASEÑA
```

`128 · N · r` = **16 MB de memoria por hash**. Verificá el límite de memoria por defecto de la función
en tu lenguaje: si es 32 MB, estos parámetros entran; si subís `N` a 32768, no.

**Calibrá contra tu hardware, no contra estos números.** El objetivo es ~100 ms en el servidor de
producción: bastante para que un diccionario no sea viable, poco para que el login no se sienta lento.

### El formato guardado

**Los parámetros van dentro del string**, junto al salt y al hash:

```
scrypt$16384$8$1$<salt en base64>$<hash en base64>
```

Es lo que permite **subir el costo sin invalidar las contraseñas viejas**: cada hash se verifica con los
parámetros con los que nació, y los nuevos usan los actuales.

Guardar solo el hash y tener el costo como constante del código significa que el día que quieras
endurecerlo tenés que resetearle la contraseña a todo el mundo. Con este formato, el endurecimiento es
progresivo: cada usuario migra solo la próxima vez que entra.

### Tres detalles que no son opcionales

**Comparación en tiempo constante.** Nunca el operador de igualdad del lenguaje: una comparación que
corta en el primer byte distinto filtra información por el tiempo que tarda. Usá la función de
comparación segura de tu biblioteca criptográfica.

**Normalización Unicode antes de hashear** (forma NFKC). Sin eso, la misma contraseña tipeada en otro
teclado o sistema operativo llega con otra composición de caracteres y no coincide. El usuario jura que
la escribió bien, y tiene razón.

**Un hash con formato inválido devuelve "no coincide", no una excepción.** Un registro corrupto no puede
convertirse en un error 500, porque ese error revela que ese usuario existe.

### Pseudocódigo

```
funcion hashear(textoPlano):
    salt = bytesAleatorios(16)
    clave = scrypt(normalizarNFKC(textoPlano), salt, 64, {N:16384, r:8, p:1})
    devolver "scrypt$16384$8$1$" + base64(salt) + "$" + base64(clave)

funcion verificar(textoPlano, guardado):
    partes = separar(guardado, "$")
    si partes.largo != 6 o partes[0] != "scrypt": devolver falso
    N, r, p = enteros(partes[1..3])
    salt = desdeBase64(partes[4]);  esperado = desdeBase64(partes[5])
    si salt.largo == 0 o esperado.largo == 0: devolver falso

    calculado = scrypt(normalizarNFKC(textoPlano), salt, esperado.largo, {N, r, p})
    # La comparación de largos va DESPUÉS de derivar: ver § 4, el hash señuelo.
    si calculado.largo != esperado.largo: devolver falso
    devolver comparacionSegura(calculado, esperado)
```

---

## 2 · Sesiones

**Token opaco en una cookie, con la sesión en una tabla.** No tokens autocontenidos.

| Aspecto       | Recomendación                                                             |
| ------------- | ------------------------------------------------------------------------- |
| Generación    | 32 bytes aleatorios criptográficos, codificados en base64 seguro para URL |
| Qué se guarda | **Solo el SHA-256 del token**, nunca el token                             |
| Duración      | 7 días                                                                    |
| Renovación    | Si al usarla queda menos de 1 día, se extiende a 7                        |
| Cierre        | Se borra la fila                                                          |

### El token en claro no existe del lado del servidor

Se genera, viaja en la cookie y se guarda hasheado. Si alguien se lleva una copia de la base de datos
**no puede hacerse pasar por nadie**: tiene los hashes, y de un SHA-256 de 32 bytes aleatorios no se
vuelve.

**Y se hashea con SHA-256, no con el algoritmo lento de las contraseñas.** No es una inconsistencia: el
token ya son 32 bytes aleatorios, así que no hay diccionario que probar. El costo del algoritmo lento no
compraría nada y se pagaría en **cada petición**.

### La expiración se compara en la consulta

```sql
select … from sesiones where token_hash = $1 and expira_el > now()
```

Filtrarla después, en el lenguaje, haría que el reloj del proceso decidiera si una sesión vencida sigue
valiendo. Con varios procesos —o con contenedores cuyos relojes derivan— eso es un problema
intermitente. En la consulta decide el reloj de la base, que es uno solo.

### La renovación deslizante, y qué hacer si falla

Renovar en cada petición sería una escritura por petición contra la tabla más consultada del sistema,
para mover una fecha que casi siempre ya está lejos. Por eso solo se escribe cuando **de verdad** queda
poco.

**Si esa escritura falla, no se echa a nadie y no se reemite la cookie.** La sesión sigue válida hasta su
vencimiento original. Dos razones: no hay motivo para cerrar una sesión por un error transitorio, y así
la cookie y la base nunca quedan diciendo fechas distintas.

### La cookie

```
sesion=<token>; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=<fecha>
```

| Atributo       | Por qué                                                                       |
| -------------- | ----------------------------------------------------------------------------- |
| `HttpOnly`     | Ningún script de la página puede leerla. Un XSS deja de ser un robo de sesión |
| `Secure`       | No viaja por conexión sin cifrar                                              |
| `SameSite=Lax` | Corta el CSRF en las peticiones que vienen de otro sitio                      |
| `Path=/`       | Que viaje a toda la aplicación                                                |

**`Lax` y no `Strict`.** Con `Strict` la cookie **no viaja** cuando alguien llega desde un enlace externo
—un correo, un mensaje— y esa persona ve la pantalla de login teniendo sesión válida. `Lax` corta el
CSRF en las peticiones que importan y deja pasar la navegación normal.

**Al borrarla, usá el mismo juego de atributos** más `Max-Age=0`. Una cookie borrada con atributos
distintos puede quedar viva en algunos navegadores.

> ### Por qué no tokens autocontenidos (JWT y similares)
>
> Un token que lleva los datos firmados adentro **no se puede revocar** sin una lista negra — y una
> lista negra es exactamente la tabla que el token venía a evitar.
>
> Tres cosas que la tabla da gratis y que en un sistema multiempresa hacen falta:
>
> 1. **Cerrar una sesión al instante.** Al cambiar la contraseña se cierran todas las del usuario. Con
>    un token autocontenido, las viejas siguen válidas hasta vencer.
> 2. **Saber desde dónde se abrió.** IP y navegador quedan en la fila. Sirve para investigar y para
>    mostrarle al usuario sus sesiones activas.
> 3. **Cambiar de organización dentro de la sesión** sin reemitir nada (el rol de plataforma).
>
> El costo es **una consulta por petición**, con índice único sobre el hash del token. Es barata, y en
> la práctica se paga sola: el token autocontenido también obliga a consultar la base para saber si el
> usuario sigue activo.

---

## 3 · Bloqueo por intentos

Dos frenos, en capas distintas, porque protegen de ataques distintos.

**Por cuenta** — contra quien ataca a un usuario concreto:

|                     |                                                        |
| ------------------- | ------------------------------------------------------ |
| Intentos permitidos | 5                                                      |
| Bloqueo             | 15 minutos                                             |
| Dónde vive          | Dos columnas del usuario: contador y `bloqueado_hasta` |
| Reset               | Un acceso exitoso pone el contador en cero             |

**Por IP** — contra quien prueba muchas cuentas desde un lugar:

|                   |                                                         |
| ----------------- | ------------------------------------------------------- |
| Fallos permitidos | 20                                                      |
| Ventana           | 15 minutos                                              |
| Dónde vive        | Se cuenta sobre la tabla de auditoría, sin tabla aparte |
| Respuesta         | `429`                                                   |

Contar sobre la auditoría evita una tabla y una dependencia (un almacén de claves externo): esos eventos
ya se registran para poder investigar. **Pero necesita su propio índice** por `(ip, accion, fecha)`, o
cada intento de login hace un recorrido completo de la tabla.

### Dos decisiones que hay que tomar a propósito

**Si la consulta del freno por IP falla, NO se bloquea.** Un error de lectura no puede dejar afuera a
todo el mundo; el bloqueo por cuenta sigue en pie, que es la defensa principal. Es la única parte del
sistema donde el fallo se abre en vez de cerrarse.

**Al bloquear, ¿el contador se reinicia?** Si sí, cuando el bloqueo vence el atacante tiene otros 5
intentos limpios. Si no, hay que decidir cuándo se limpia o el bloqueo se vuelve permanente. La opción
por defecto de esta serie es reiniciarlo; **si querés bloqueos crecientes**, guardá también la cantidad
de bloqueos y calculá la espera con ella.

---

## 4 · El flujo del login, paso a paso

```
POST /auth/login   { email, password }
```

1. **Método y cuerpo.** `405` si no es el método esperado; `400` si falta email o contraseña.
2. **Freno por IP.** Si esa IP acumula 20 fallos en la ventana → `429`. Se corta acá, **antes de tocar la
   tabla de usuarios**.
3. **Se busca el usuario** con la misma expresión que el índice: `where lower(email) = lower($1)`.
4. **¿Bloqueado?** Si `bloqueado_hasta` es futuro → `429` diciendo cuántos minutos faltan.
5. **Se verifica la contraseña** contra el hash guardado, en tiempo constante.
6. **Si falla** → se suma el fallo, se audita, y se responde `401` con **el mismo mensaje siempre**.
7. **Si entra** → contador a cero, se sella la fecha de último acceso, se crea la sesión, se pone la
   cookie, se audita, y se responde `200` con los datos mínimos del usuario y sus permisos.

### El mensaje de error es siempre el mismo

`401` con _"Credenciales inválidas."_ para las tres situaciones: el email no existe, la cuenta está
inactiva, o la contraseña está mal. Distinguirlas le confirma a un atacante qué emails son reales — un
enumerador de cuentas gratis.

**El motivo real sí se guarda en la auditoría** (`email_inexistente`, `cuenta_inactiva`, `password`),
para poder investigar. La distinción existe; lo que no existe es contársela a quien pregunta.

**La excepción deliberada: cuando la cuenta está bloqueada, se dice.** Rompe el mensaje único a
propósito — quien llegó hasta ahí ya sabe que la cuenta existe, porque la bloqueó él. Ocultarlo solo
confunde al dueño legítimo, que necesita saber que tiene que esperar.

### El mensaje único no alcanza: hay que gastar el mismo tiempo

Responder _"no existe"_ al instante y _"contraseña mal"_ 100 ms después **dice exactamente lo que el
mensaje venía a esconder**. Con un cronómetro se enumeran cuentas igual.

Por eso, cuando el email no existe, **hay que derivar el hash igual, contra un señuelo**:

```
SENUELO = "scrypt$16384$8$1$<salt fijo>$<hash de una contraseña que nadie conoce>"

usuario = buscarPorEmail(email)
hashAComparar = usuario?.password_hash ?? SENUELO
coincide = verificar(password, hashAComparar)
si (no usuario) o (no usuario.activo) o (no coincide):
    # los tres caminos tardaron lo mismo
    responder 401 "Credenciales inválidas."
```

El señuelo se genera una vez con una contraseña aleatoria que se descarta. Tiene que usar **los mismos
parámetros** que los hashes reales, o vuelve a costar distinto.

> **Detalle que parece limpieza y no lo es**: en la función de verificación, la comparación de longitudes
> va **después** de derivar. Si cortara antes, el camino del señuelo terminaría más rápido que el de un
> hash real y el canal de tiempo se abriría por la puerta de al lado.

---

## 5 · El resto de la superficie

Un solo recurso, ruteado por método:

| Método                | Qué hace                                                                         |
| --------------------- | -------------------------------------------------------------------------------- |
| `GET /auth/sesion`    | Quién soy: usuario, permisos, organización activa, si debo cambiar la contraseña |
| `DELETE /auth/sesion` | Cerrar sesión                                                                    |
| `POST /auth/sesion`   | Cambiar la contraseña                                                            |
| `PATCH /auth/sesion`  | El rol de plataforma cambia de organización activa                               |

### `GET` sin sesión devuelve `200`, no `401`

Es la pregunta _"¿hay alguien?"_, y no tener sesión es una respuesta legítima:

```json
{ "ok": true, "autenticado": false }
```

Reservar el `401` para _"tenías sesión y se venció"_ es lo que le permite al cliente distinguir "mostrá
el login" de "se te venció, avisá y mandá al login".

Y hay una razón mecánica además de la semántica: si esta llamada pasara por el mismo cliente HTTP que
convierte todo `401` en "sesión perdida", **la comprobación de arranque entraría en bucle** con el
componente que escucha ese evento. Esta llamada tiene que ser la excepción.

### El `DELETE` borra la cookie siempre

Incluso si no había sesión válida. Si el navegador tiene una cookie vencida o de una sesión ya borrada,
es la única forma de que deje de mandarla.

### Cambiar la contraseña

**Exige la contraseña actual**, aunque haya sesión válida. Sin eso, una sesión robada permite cambiar la
contraseña y quedarse con la cuenta para siempre.

**Al cambiarla se cierran todas las sesiones del usuario** y se abre una nueva para el navegador que la
cambió. Uno cambia la contraseña justamente cuando cree que se la robaron: si las demás sobrevivieran,
el cambio no serviría de nada. Y se reabre una para no echar a quien acaba de hacer lo correcto.

**Este endpoint no puede exigir permisos.** Es la única salida del estado "contraseña temporal", así que
si pidiera una capacidad, el usuario quedaría encerrado sin poder salir.

---

## 6 · La contraseña temporal obligatoria

Cuando un administrador crea una cuenta o restablece una contraseña:

1. El servidor **genera** la contraseña (nunca la elige quien crea la cuenta).
2. Se guarda hasheada y el usuario queda con la marca `debe_cambiar_password`.
3. Se muestra **una sola vez**, en la respuesta de esa operación.
4. **No se registra en la auditoría.** El email sí; la contraseña temporal nunca, ni ahí.

Y el portero del servidor **encierra** al usuario mientras esa marca esté puesta: puede cambiar su
contraseña y nada más. Ese chequeo va **antes** de los permisos, no después — si fuera al final,
cualquier operación que no pida permisos lo dejaría trabajar con una contraseña que le dictaron por
teléfono.

### Generarla sin sesgo

```
ALFABETO = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # sin l, I, O, 0, 1

funcion generarTemporal(largo = 14):
    limite = 256 - (256 % ALFABETO.largo)     # descarta el resto incompleto
    salida = ""
    mientras salida.largo < largo:
        para cada byte en bytesAleatorios(largo * 2):
            si byte >= limite: continuar       # <-- esto es lo importante
            salida += ALFABETO[byte % ALFABETO.largo]
            si salida.largo == largo: cortar
    devolver salida
```

**El descarte del resto incompleto no es pedantería.** Un `byte % largoAlfabeto` sin él hace que los
primeros caracteres del alfabeto salgan más seguido: un sesgo pequeño pero real que reduce la entropía
de todas las contraseñas temporales del sistema.

El alfabeto sin caracteres ambiguos (`l`, `I`, `O`, `0`, `1`) es porque estas contraseñas se dictan por
teléfono o se copian a mano.

---

## 7 · Lo que este diseño NO incluye

Dicho de frente, para que se decida y no se descubra por accidente:

- **Sin segundo factor.** Si lo necesitás, el lugar natural es entre los pasos 5 y 7 del login, con la
  sesión creada en estado "pendiente de segundo factor".
- **Sin recuperación por email.** La contraseña la restablece un administrador y entrega una temporal.
  Agregar recuperación por correo exige una tabla de tokens de un solo uso, con vencimiento corto.
- **Sin límite de sesiones simultáneas** por usuario.
- **Sin rotación del token** en cada petición, solo extensión del vencimiento.
- **Sin limpieza automática de sesiones vencidas.** El índice por vencimiento está para cuando haga
  falta un trabajo programado; hasta entonces, las filas vencidas no molestan porque la consulta las
  descarta. Conviene escribirlo antes de que la tabla crezca.
