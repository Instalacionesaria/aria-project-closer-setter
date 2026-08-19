# 00 — Visión general: un sistema de acceso multiempresa, genérico y extensible

**Qué construye esta serie:** la capa de acceso de una aplicación SaaS donde varias empresas usan la
misma instalación sin verse entre sí, con usuarios, roles configurables y credenciales propias por
empresa.

No describe ningún producto en particular. Describe **el andamiaje**: login, sesiones, organizaciones,
roles, permisos, aislamiento de datos y almacenamiento de secretos. Lo que la aplicación haga encima
de eso es indistinto.

Cada documento de esta carpeta es **autosuficiente**: se puede leer y aplicar sin abrir los otros y
sin acceso a ningún repositorio externo. Se repiten cosas a propósito.

---

## 1 · El modelo, en cuatro conceptos

```
ORGANIZACIÓN ──1:N── USUARIO ──N:M── ROL ──N:M── PERMISO
     │                   │
     │                   └── SESIÓN (0:N)
     │
     └── CREDENCIALES de servicios externos (cifradas)
```

**Organización** — el inquilino. Una empresa cliente. Todo dato de negocio le pertenece a una.

**Usuario** — una persona. Pertenece a **una** organización. Puede tener varios roles.

**Rol** — un nombre para un conjunto de permisos (`administrador`, `operador`, `auditor`…). **No están
fijos en el código**: se definen como datos y se pueden agregar sin tocar el núcleo. Ver el documento
`03`.

**Permiso** — una capacidad concreta y granular (`usuarios.crear`, `reportes.ver`). Lo que el código
consulta es el permiso, nunca el nombre del rol.

**Sesión** — una ventana de acceso abierta desde un navegador. Se puede cerrar en cualquier momento.

**Credenciales** — los secretos que cada organización usa para hablar con servicios externos. Cifradas
en reposo, distintas por organización, nunca compartidas.

---

## 2 · Las cinco reglas que sostienen todo

Si de esta serie sobrevive una sola página, que sea ésta. Cada regla existe porque su ausencia produce
un fallo **silencioso** — de esos que no lanzan excepción, no rompen un test y no aparecen en un log.

### Regla 1 · El aislamiento se impone, no se pide

Ninguna consulta de la aplicación escribe el filtro por organización a mano. Hay **una** capa que lo
inyecta, y si no sabe de qué organización se trata, **falla** en vez de devolver datos.

Si el filtro depende de que quien escribe la consulta se acuerde, alcanza **una** omisión en **un**
lugar para que un cliente vea las filas de otro. Y eso no falla: la consulta anda, devuelve filas, y
el número está mal.

### Regla 2 · El permiso se pregunta por capacidad, no por nombre de rol

`si (puede("usuarios.crear"))`, nunca `si (rol === "administrador")`.

Comparar nombres de rol esparce la definición de cada rol por todo el código: agregar un rol nuevo
obliga a buscar cada `if` y decidir si entra. Con capacidades, un rol nuevo es una fila de
configuración y **cero cambios de código**.

### Regla 3 · El frontend no decide permisos

Oculta lo que no corresponde para no confundir, pero **cada** operación del servidor vuelve a
preguntar quién es y qué puede. Un menú escondido es una comodidad; la frontera real está del lado
del servidor.

La tentación es fuerte: si el menú ya oculta la sección, parece que la API no necesita validar.
Necesita — cualquiera puede llamarla con su sesión y una herramienta de línea de comandos.

### Regla 4 · Las invariantes críticas viven en la base de datos

Que el administrador principal no se pueda degradar, que la organización principal no se pueda
desactivar, que un rol de plataforma no exista en una organización cliente: eso son **restricciones y
disparadores de la base**, no condicionales del backend.

Un `if` se saltea con un script de mantenimiento, una consola de administración, un endpoint nuevo
que nadie revisó, o una sentencia a mano un domingo. Una restricción de la base no.

### Regla 5 · Lo que no se puede saber, no se afirma

Un valor nulo significa **una sola cosa**: nunca "no hay" _y_ "no pude averiguarlo" a la vez. Si una
escritura falla, la respuesta lo dice, aunque sea accesoria.

Casi todos los defectos graves de un sistema así tienen la misma forma: **un éxito reportado que no
ocurrió**. Una operación que responde 200 con todo fallado. Un contador que suma poblaciones
distintas. Un valor que se muestra como medido cuando en realidad falta.

---

## 3 · Qué es obligatorio y qué es elección

La serie describe decisiones concretas para poder ser aplicable, pero conviene saber qué es esencial y
qué se puede cambiar.

| Pieza                 | Recomendación de la serie                            | ¿Se puede cambiar?                                                         |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------- |
| Base de datos         | PostgreSQL                                           | Sí, si soporta restricciones y disparadores. Sin eso, la Regla 4 se cae    |
| Hash de contraseñas   | Algoritmo lento con parámetros embebidos             | Sí, entre `argon2id`, `scrypt` o `bcrypt`. **No** a un hash rápido         |
| Sesiones              | Token opaco en cookie + tabla                        | Sí, pero leer el documento `02` § "Por qué no tokens autocontenidos" antes |
| Cifrado de secretos   | Cifrado autenticado (AEAD) con nonce único           | El algoritmo sí. Que sea autenticado, no                                   |
| Contexto por petición | Almacenamiento local asíncrono, o contexto explícito | Sí. **No** una variable global ni un singleton de proceso                  |
| Roles                 | Configuración en datos, con capacidades granulares   | Se puede empezar con una lista fija, pero migrar después cuesta            |

Lo esencial es lo de las cinco reglas. Todo lo demás es implementación.

---

## 4 · Las decisiones que hay que tomar antes de empezar

Cuatro preguntas que definen la forma de todo lo demás. Conviene contestarlas por escrito.

**¿Un usuario pertenece a una organización o a varias?**
Esta serie asume **una**, que es lo que cubre el 95 % de los casos y es mucho más simple. Si un usuario
tiene que operar en varias, la relación usuario–organización pasa a ser una tabla intermedia y la
sesión tiene que recordar en cuál está trabajando ahora. Cambiarlo después es una migración de datos y
de todo el código de permisos: decidirlo ahora.

**¿Hay un rol de plataforma que ve todas las organizaciones?**
Esta serie asume que **sí** (`superadministrador`), porque alguien tiene que dar de alta a los
clientes y ayudarlos. Ese rol es el mayor riesgo del sistema y por eso está acotado: solo existe en la
organización principal, y cuando mira otra organización la interfaz lo muestra de forma permanente.

**¿Los roles son fijos o configurables?**
Si en un año vas a querer un rol nuevo sin desplegar código, tienen que ser datos. El documento `03`
describe las dos variantes y cuándo conviene cada una.

**¿Qué secretos guarda cada organización?**
Si cada cliente conecta sus propias integraciones, hacen falta credenciales cifradas por organización
(documento `06`). Si todas usan las mismas credenciales del proveedor, no.

### Y tres más, que se toman sin darse cuenta

Estas no son sobre el modelo: son sobre el stack. Se deciden eligiendo bibliotecas en la primera hora,
y las tres condicionan si las defensas de esta serie funcionan o solo **parecen** funcionar. Están
desarrolladas en el documento `08`, que conviene leer junto con este.

**¿El código habla con la base por un constructor encadenable o con SQL en cadenas de texto?** Con SQL
crudo, la capa que inyecta el filtro por organización **no se puede construir**, y el aislamiento pasa
a depender de la disciplina humana. Es la decisión más cara de revertir de toda la serie.

**¿Con qué rol de base se conecta la aplicación?** Si se conecta como propietaria de las tablas o con
un rol privilegiado, la seguridad a nivel de fila **no se le aplica**: la segunda capa existe en el
esquema y no protege de nada.

**¿Tu framework cachea respuestas?** Las cachés de renderizado y las de la red de distribución no
saben nada de organizaciones. Una respuesta de un cliente servida a otro es la falla que todo esto
evita, y llega por un camino donde ninguna capa de datos participa.

---

## 5 · La serie

| Documento                  | Qué contiene                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-VISION-GENERAL`        | Este. El modelo, las reglas, las decisiones previas y el orden de construcción                                                                                                                 |
| `01-ESQUEMA-DE-DATOS`      | El SQL completo: tablas, restricciones, disparadores, índices, seguridad a nivel fila                                                                                                          |
| `02-AUTENTICACION`         | Contraseñas, sesiones, cookies, bloqueo por intentos. El login de punta a punta                                                                                                                |
| `03-ROLES-Y-PERMISOS`      | El modelo extensible de roles y capacidades, y el portero del servidor                                                                                                                         |
| `04-AISLAMIENTO`           | Cómo se separan los datos entre organizaciones sin confiar en la disciplina                                                                                                                    |
| `05-ADMINISTRACION`        | Alta de organizaciones y usuarios, el primer administrador, restablecer contraseñas                                                                                                            |
| `06-CREDENCIALES`          | Guardar y usar secretos por organización: cifrado, rotación, enmascarado                                                                                                                       |
| `07-ERRORES-A-EVITAR`      | Los fallos concretos que este diseño ya pagó en producción, y cómo evitarlos                                                                                                                   |
| `08-ENDURECIMIENTO`        | **Los huecos de los siete anteriores**, con su solución: la segunda capa que puede ser inerte, la caché entre inquilinos, sesiones, roles con dueño, credenciales con refresco, segundo factor |
| `09-ESCOTILLA-Y-ESTADOS`   | **Los dos defectos que abre el `08`**: las políticas de la base rompen el login, y los estados de sesión dejan pasar operaciones. Con el SQL de las ocho tablas de identidad                   |
| `10-DETECCION-Y-OPERACION` | Cómo enterarse de que algo está pasando **ahora**: seis señales, incidentes, respaldos, el camino no tomado, riesgos residuales                                                                |
| `PRUEBAS`                  | **Cada regla con la prueba que la sostiene**, por etapa. Es la lista de trabajo                                                                                                                |

---

## 6 · El orden de construcción

En este orden, y las razones no son estéticas.

**0 · La infraestructura de pruebas y las migraciones.** Corredor de pruebas, integración continua que
lo ejecute en cada cambio, y herramienta de migraciones versionadas. _Criterio para cerrar la etapa:
una prueba que falla a propósito bloquea la integración._ Las pruebas que leen el código fuente
sostienen todo lo que viene después; si no tienen dónde correr, no existen. Y sin migraciones
versionadas, las invariantes de la base **divergen entre entornos**: el disparador está en producción
y no en pruebas, y la prueba que debía fallar pasa.

**1 · El esquema con sus invariantes** (`01`). Primero la base, con sus restricciones y disparadores.
Es el piso sobre el que todo lo demás puede equivocarse sin hacer daño.

**2 · El contexto de organización y la capa de aislamiento** (`04`), **con el rol de base dedicado y las
políticas del `08` § 1**. **Antes** del primer endpoint. Si se hace después, hay que volver a pasar por
todos — y el que se olvide no va a fallar, va a leer los datos de otro cliente.

**3 · El catálogo de permisos y el portero** (`03`). Antes de escribir la primera operación, para que
nazca con su verificación.

**4 · Contraseñas y sesiones** (`02`).

**5 · El primer administrador y el alta de organizaciones** (`05`).

**6 · Las credenciales por organización** (`06`), si aplica.

**7 · La prueba arquitectónica** que recorre el código y verifica que ninguna operación se saltee el
portero ni el aislamiento. Descrita en `03` § 6 y `04` § 7. **Escribirla temprano**: es lo único que
sostiene las reglas cuando el equipo crece o cuando el código lo escribe un asistente.

**8 · Lo que hace falta antes del primer cliente externo**: segundo factor para el rol de plataforma,
auditoría del acceso de soporte, sesiones visibles y revocables, y el procedimiento de exportación y
borrado por organización. La lista completa, con el orden, en el `08` § 13.

**9 · La detección**, que no es una etapa final sino la que permite enterarse de lo que las ocho
anteriores no impidieron. Seis señales, todas sobre tablas que ya existen (`10`).

> Y una lista aparte, para tener al lado mientras se construye: **`PRUEBAS`** tiene cada regla de toda
> la carpeta con la prueba que falla si no se cumple, agrupada por etapa. Si hay que recortar por
> tiempo, se recorta de ahí — y así se sabe qué se está resignando.

> **Antes de escribir la primera línea, leer `07-ERRORES-A-EVITAR`.** Es la lista de lo que ya salió
> mal en un sistema construido con este diseño. Casi todo vuelve a pasar si nadie lo dice.
