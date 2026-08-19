# 05 — Administración: organizaciones, usuarios y el primer administrador

Cómo nacen las organizaciones y las cuentas, y qué protecciones evitan que alguien se quede afuera de su
propio sistema.

Este documento es autosuficiente: no depende de los otros de la carpeta.

---

## 1 · El problema del huevo y la gallina

Para crear un usuario hace falta ser administrador. Para ser administrador hay que existir. Con la base
vacía, no hay forma de entrar.

Hace falta una operación de arranque que corra **una sola vez**. Con cuatro candados:

| Candado                    | Qué hace                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Secreto de arranque**    | Exige un valor que solo está en las variables de entorno. Sin él configurado, la operación **responde error y no corre** |
| **Un solo disparo**        | Si ya existe un administrador principal, responde conflicto y no hace nada                                               |
| **Datos desde el entorno** | El email y la contraseña iniciales salen de variables de entorno, **no del cuerpo de la petición**                       |
| **Fuerza de contraseña**   | Valida el mínimo antes de guardar                                                                                        |

El segundo es el decisivo: **después del primer uso está muerto para siempre**, y no hay forma de
revivirlo desde la API.

El tercero cierra el hueco obvio: si el email viniera en la petición, quien tuviera el secreto podría
crear un administrador con **su** email.

```
funcion arranque(peticion):
    secretoEsperado = entorno("SECRETO_ARRANQUE")
    si no secretoEsperado:
        responder 503 "Secreto de arranque sin configurar"; devolver
    si peticion.secreto != secretoEsperado:
        responder 401 "Secreto inválido"; devolver

    si existeAdministradorPrincipal():
        responder 409 "Ya hay un administrador principal"; devolver

    email    = entorno("ADMIN_EMAIL")
    password = entorno("ADMIN_PASSWORD")
    si no email o no password:
        responder 503 "Faltan las variables del administrador inicial"; devolver
    si password.largo < MINIMO:
        responder 400 "Contraseña débil"; devolver

    org = crearOrganizacion({ nombre: entorno("ORG_NOMBRE"), es_principal: verdadero })
    usuario = crearUsuario({
        org, email, password_hash: hashear(password),
        es_admin_principal: verdadero, debe_cambiar_password: falso,
    })
    asignarRol(usuario, "superadministrador")
    auditar("arranque", { usuario, org })
    responder 201
```

> **Si tu plataforma te deja correr un comando fuera del ciclo HTTP** —un script de despliegue, una
> consola de administración, una tarea de migración— **es mejor lugar para esto que un endpoint**. Un
> comando no está expuesto a internet y no necesita el secreto.
>
> El endpoint es la variante para entornos sin consola (funciones sin servidor, contenedores efímeros).

---

## 2 · Alta de organización

Requiere la capacidad `organizaciones.crear`, que en la práctica solo tiene el rol de plataforma.

**Lo importante es lo que NO hace: heredar.**

Una organización nueva nace **sin ninguna credencial de servicios externos**. Y por lo tanto **no opera,
y lo dice**. No hereda las de la organización principal ni las de ninguna otra.

> Esto es una lección pagada. En el sistema del que salen estas notas hubo un momento en que una
> organización nueva **heredaba** el token del proveedor externo de la organización principal, por un
> valor por defecto que parecía inofensivo. El resultado: la organización nueva escribía en la cuenta
> externa de otra empresa. Nada falló — el token era válido, la API respondía 200.
>
> La regla que salió de ahí: **si falta una credencial, la organización no opera y la interfaz explica
> qué falta.** Nunca un valor por defecto que la haga funcionar con las credenciales de otro.

Los valores por defecto que **sí** conviene poner:

```
activa         = verdadero
es_principal   = falso
zona_horaria   = la del despliegue, o pedirla en el alta
```

### Qué crear junto con la organización

Nada más. Ni usuarios, ni datos de ejemplo, ni configuración inventada.

La tentación de "sembrar" una organización nueva con datos de demostración termina en clientes que ven
información que no es suya y no saben si es real. Si hace falta una demostración, que sea una
organización de demostración explícita.

### El alta de organización necesita la escotilla

Es una de las pocas operaciones que legítimamente corre **sin** contexto de organización: la está
creando. Si tu capa de aislamiento lanza cuando no hay organización activa —y debería—, esta operación
tiene que usar el acceso sin filtro, y estar en la lista de autorizadas.

---

## 3 · Alta de usuario

Requiere `usuarios.crear`.

### La contraseña temporal

**La genera el servidor.** Nunca la elige quien crea la cuenta, y nunca la manda el cliente.

- **14 caracteres** de un alfabeto sin caracteres ambiguos (sin `l`, `I`, `O`, `0`, `1`), porque estas
  contraseñas se dictan por teléfono o se copian a mano.
- **Sin sesgo de módulo**: hay que descartar los bytes que caen en el resto incompleto del rango. Un
  `byte % largoAlfabeto` sin ese descarte hace que los primeros caracteres del alfabeto salgan más
  seguido, y eso reduce la entropía de **todas** las contraseñas temporales del sistema.
- Se guarda **hasheada** y el usuario nace con la marca de "debe cambiar la contraseña".

```
funcion generarTemporal(largo = 14):
    limite = 256 - (256 % ALFABETO.largo)
    salida = ""
    mientras salida.largo < largo:
        para cada byte en bytesAleatorios(largo * 2):
            si byte >= limite: continuar        # <-- el descarte
            salida += ALFABETO[byte % ALFABETO.largo]
            si salida.largo == largo: cortar
    devolver salida
```

**Se muestra una sola vez**, en la respuesta del alta. No se puede volver a consultar: para eso está el
restablecimiento, que genera otra.

**Y no se registra en la auditoría.** El email sí; la contraseña temporal nunca, ni ahí. Un registro de
auditoría con contraseñas temporales es una lista de credenciales válidas de cuentas que todavía no las
cambiaron.

### Qué validar, y con qué responder

| Validación                                              | Respuesta                                   |
| ------------------------------------------------------- | ------------------------------------------- |
| Falta el nombre                                         | `400`                                       |
| El email no tiene forma de email                        | `400`, con un código legible por el cliente |
| Email ya existente                                      | `409`, código `email_duplicado`             |
| Rol inexistente                                         | `400`                                       |
| Cualquier rechazo de la base (restricción o disparador) | `409`, **con el mensaje de la base**        |

Devolver el mensaje de la base tal cual es deliberado: si los mensajes de los disparadores están escritos
para leerse ("El administrador principal no se puede degradar"), traducirlos en el backend sería mantener
dos textos que dicen lo mismo y que van a divergir.

> **Con una excepción importante: los mensajes de las restricciones de unicidad y de clave foránea no se
> devuelven nunca.** Y no es por estética.
>
> Las verificaciones de unicidad y de integridad referencial **no pasan por la seguridad a nivel de
> fila**: se hacen sobre la tabla entera, sin filtrar por organización. Un mensaje de "ya existe una fila
> con ese valor" es entonces un canal que **confirma la existencia de un registro de otra organización**,
> aunque quien pregunta no pueda verlo.
>
> Cada restricción de ese tipo se traduce a un código propio y a un texto que no revela nada
> (`email_duplicado`, y no el detalle de la base). Los mensajes de los **disparadores**, que uno escribió
> a propósito para que los lea una persona, sí se devuelven.

### La escalada que hay que bloquear en dos capas

**Un administrador no puede otorgar el rol de plataforma.** Ni siquiera dentro de la organización
principal. Con eso, cualquier administrador se convertiría en dueño de todas las organizaciones.

Va bloqueado **en el endpoint y en la base**:

- el endpoint rechaza la asignación si el solicitante no tiene el rol de plataforma;
- un disparador rechaza la fila si el rol está marcado como "solo organización principal" y el usuario no
  pertenece a ella.

Las dos capas, porque el endpoint se puede saltear con un script y el disparador no.

### El usuario nace en su organización, y ahí se queda

**Cambiar la organización de un usuario no es una edición de perfil**, y conviene que la operación de
modificación **no lo permita**.

Mover a alguien de organización le cambia el dueño a todo lo que hizo: sus registros, sus asignaciones,
su atribución. Si el producto lo necesita, tiene que ser una operación con su propio nombre, su propia
capacidad y su propio registro de auditoría — no un campo más en el formulario de edición.

---

## 4 · Las protecciones contra quedarse afuera

Estos son los errores que dejan un sistema inutilizable, y todos son fáciles de cometer desde una
pantalla de administración.

| Escenario                                            | Qué lo evita                                                                        |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------- |
| El administrador se borra a sí mismo                 | El endpoint rechaza operar sobre el propio identificador                            |
| El administrador se quita su propio rol              | Idem                                                                                |
| Alguien borra al administrador fundador              | Disparador de la base                                                               |
| Alguien lo desactiva o le cambia el email            | Disparador de la base                                                               |
| Alguien le quita el rol de plataforma                | Disparador de la base                                                               |
| Se borra el último administrador de una organización | Verificación en el endpoint: contar los administradores activos antes de desactivar |
| Se desactiva la organización principal               | Disparador de la base                                                               |

**La contraseña del administrador fundador SÍ se puede cambiar.** Lo inmutable es _quién es_ y _qué puede
hacer_, no su credencial: si no se pudiera rotar, una filtración sería permanente.

**Por qué unas en la base y otras en el endpoint.** Las de la base son las que **nunca** deben ocurrir,
por ninguna vía: son invariantes del sistema. Las del endpoint son reglas de operación que dependen del
contexto (quién está pidiendo qué), y esa información la base no la tiene.

Cuando dudes, ponela en la base: un condicional del backend se saltea con un script de mantenimiento,
una consola, un endpoint nuevo o una sentencia a mano un domingo.

---

## 5 · Restablecer una contraseña

```
POST /admin/usuarios/{id}/restablecer-password     requiere: usuarios.editar
```

1. Genera una temporal nueva (§ 3).
2. La guarda hasheada y marca "debe cambiar la contraseña".
3. **Cierra todas las sesiones de ese usuario.** Si el motivo del restablecimiento es que le robaron la
   cuenta, dejar las sesiones vivas no arregla nada.
4. La devuelve **una sola vez** en la respuesta.
5. Audita la acción, con quién la pidió. **Sin la contraseña.**

---

## 6 · Desactivar en vez de borrar

**Los usuarios se desactivan, no se borran.** Lo que hicieron sigue referenciado desde los datos de
negocio, y borrarlos deja registros huérfanos o fuerza una cascada que destruye historia.

Un usuario inactivo:

- no puede iniciar sesión (el login lo rechaza con el mismo mensaje genérico);
- sus sesiones abiertas **se cierran al desactivarlo** — si no, sigue trabajando hasta que venza;
- sigue apareciendo como autor de lo que hizo.

Lo mismo para las organizaciones: `activa = falso`. Una organización inactiva no opera, sus usuarios no
entran, y sus tareas programadas la saltean **diciéndolo** en el resultado.

---

## 7 · La auditoría

Registrá al menos: inicio de sesión, intento fallido, alta y baja de usuario, cambio de roles, cambio de
credenciales, alta de organización.

**Y tres que no son obvias, porque son las que después permiten _detectar_ algo:**

| Acción                  | Dónde se emite                                    | Para qué sirve                                                                                                                                            |
| ----------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permiso_denegado`      | En el portero, al rechazar por falta de capacidad | Un pico en una organización casi nunca es un ataque: es un rol al que le falta una capacidad, **y nadie lo va a reportar** porque la pantalla se ve vacía |
| `credencial_ilegible`   | En la función que descifra credenciales           | Clave maestra cambiada o valor alterado, antes de que el cliente llame                                                                                    |
| `organizacion_cambiada` | Al cambiar de organización activa                 | Es el registro de **quién de tu equipo miró los datos de qué cliente**                                                                                    |

Sin esas tres, la auditoría solo cuenta lo que salió bien.

Dos decisiones de diseño que conviene copiar:

**El identificador de usuario es nulificable.** Un intento de acceso con un email inexistente no tiene
usuario al que atribuirlo, y **ése es justo el evento que hay que poder investigar**. Exigirlo obligaría
a descartar el intento o a inventar una referencia.

**El detalle va en un campo estructurado** (JSON), con el motivo real. El usuario recibe siempre
"credenciales inválidas"; la auditoría guarda si fue email inexistente, cuenta inactiva o contraseña
incorrecta. La distinción existe para quien investiga, no para quien ataca.

**Nunca una contraseña**, ni la fallida, ni la temporal.

Y hacela **inmutable** con un disparador que rechace modificaciones y borrados. Una auditoría que se
puede editar no sirve para auditar.

---

## 8 · Lista de verificación

1. Operación de arranque con secreto, un solo disparo, y datos desde el entorno.
2. Una organización nueva **no hereda credenciales**. Si falta una, no opera y lo dice.
3. Contraseñas temporales generadas en el servidor, sin sesgo, mostradas una vez, nunca registradas.
4. Un administrador **no** puede otorgar el rol de plataforma. Endpoint **y** base.
5. Nadie se puede borrar, desactivar ni degradar a sí mismo.
6. El administrador fundador y la organización principal, protegidos por disparadores.
7. No se puede dejar una organización sin administrador activo.
8. Restablecer contraseña **cierra las sesiones** del usuario.
9. Desactivar, no borrar. Y al desactivar, cerrar sesiones.
10. Mover un usuario de organización no es una edición de perfil.
11. Auditoría inmutable, con usuario nulificable y sin secretos.
