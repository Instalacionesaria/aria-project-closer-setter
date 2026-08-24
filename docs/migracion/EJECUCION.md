# EJECUCIÓN — El documento que se lee primero

> **Asistente de código: este documento manda sobre todos los demás.** Donde otro documento ofrezca dos
> opciones, acá está elegida. Donde otro documento describa algo que este declara fuera de alcance, no se
> implementa. Si encontrás una contradicción que este documento no resuelve, **parás y preguntás** — no
> elegís.

---

## 1 · Qué se construye, y de qué tamaño

La capa de acceso de una aplicación SaaS donde varias empresas usan la misma instalación sin verse entre
sí. Login, organizaciones, usuarios, roles, aislamiento de datos y credenciales cifradas por empresa.

**El tamaño real, porque cambia qué es sobreingeniería:**

| Dato                              | Valor              |
| --------------------------------- | ------------------ |
| Organizaciones cliente            | 5, a un año        |
| Usuarios por organización         | Hasta 3            |
| Usuarios totales del sistema      | ~20                |
| Peticiones simultáneas esperadas  | Decenas, no miles  |

**Lo que eso significa:** nada de particionado, ni caché de permisos, ni optimización de consultas, ni
límites de tasa sofisticados. **Y lo que NO significa:** el aislamiento entre organizaciones no se relaja.
Son clientes de alto valor; una fuga entre dos de ellos es peor acá que en un producto con mil clientes
chicos.

**La regla de tamaño:** si una solución existe para resolver un problema de escala, no se implementa. Si
existe para impedir que un cliente vea los datos de otro, se implementa completa.

---

## 2 · Restricciones deliberadas: lo que NO se usa

Esta sección es la que más reduce la probabilidad de error. **Buena parte de las advertencias de los
documentos son contingentes** —"si usás vistas…", "si usás particiones…", "si usás procedimientos
almacenados…"— y al prohibir esas funciones, esas advertencias dejan de aplicar.

| No se usa                                                 | Qué advertencia vuelve inaplicable                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Procedimientos almacenados** con lógica de negocio      | La trampa de las sobrecargas por cantidad de argumentos (`04` § 5)                  |
| **Vistas sobre tablas de negocio**                        | La vista que se ejecuta con permisos de su dueño y evade las políticas (`09` § 2)   |
| **Tablas particionadas**                                  | Activar la seguridad de a una partición (`09` § 2)                                  |
| **Tablas de catálogo compartidas** (por ahora)            | El esquema `comun` entero, y su agujero por exclusión. **No se crea ese esquema**   |
| **Funciones de servidor auto-expuestas** (`'use server'`) | La superficie de endpoints que la prueba del portero no ve. Solo manejadores de ruta |
| **Cualquier primitiva de caché** en rutas del API         | Toda la discusión de claves de caché por organización. La regla queda: nada se cachea |
| **Escrituras que cruzan los dos dominios** en una operación | La falta de atomicidad entre dominios (`09` § 6)                                   |
| **Políticas que consultan otra tabla**                    | La recursión infinita en políticas (`09` § 2)                                       |

Cada línea de esa tabla elimina una sección entera de riesgo. **Si en algún momento hace falta una de
esas cosas, se para y se pregunta** — no se agrega leyendo la advertencia correspondiente.

Y dos más, que son limitaciones aceptadas por escrito:

- **Un usuario pertenece a una sola organización**, y el correo es único en todo el sistema. Una persona
  no puede tener cuenta en dos empresas. El mensaje de error lo explica sin decir en cuál existe.
- **Con dos pestañas abiertas en organizaciones distintas, la última elección manda para las dos.** Se
  mitiga con el cartel permanente, no se resuelve.

---

## 3 · Las decisiones, ya tomadas

Los documentos ofrecen alternativas para poder aplicarse en cualquier proyecto. **Acá están cerradas.** No
se reabren.

| Decisión                        | Elegido                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------- |
| Base de datos                   | PostgreSQL administrado, en la misma región que las funciones               |
| Acceso a la base                | **Constructor de consultas encadenable.** Nunca SQL en cadenas de texto     |
| Controlador                     | Uno que soporte **transacciones interactivas** — se verifica en la etapa 0  |
| Mecanismo de aislamiento        | **Seguridad a nivel de fila como mecanismo principal**, con una capa fina encima |
| Roles de base                   | Tres: `migrador`, `app_inquilino`, `app_identidad`. Tres cadenas de conexión |
| Esquemas                        | Dos: `identidad` y `negocio`. **`comun` no se crea** (ver § 2)              |
| Contexto por petición           | Almacenamiento local asíncrono, con la primitiva que **envuelve y cierra**  |
| Hash de contraseñas             | El lento que trae la biblioteca estándar del entorno, con parámetros explícitos y guardados en el propio hash |
| Sesiones                        | Token opaco en tabla. Cookie con prefijo `__Host-`                          |
| Rol de plataforma               | **Tiene todas las capacidades cargadas en la tabla.** Sin atajo en el portero |
| Roles por organización          | La columna existe, **queda vacía**. Los roles los definimos nosotros        |
| Rellenos de datos en migraciones | **Por bucle de organizaciones.** No se crea política para el rol que migra |
| Arranque del primer administrador | **Script contra la base**, no endpoint HTTP                                |
| Segundo factor                  | Basado en tiempo, **obligatorio** para el rol de plataforma                 |
| Clave maestra                   | Variable de entorno, 32 bytes, aceptando dos formatos                       |

**Por qué "todas las capacidades en la tabla" y no el atajo:** con cuatro roles y veinte usuarios, el
atajo ahorra poco y crea un camino de código que se ejercita distinto que el normal. Con las capacidades
en la tabla hay un solo camino, y una prueba de catálogo garantiza que el rol de plataforma las tenga
todas.

**Por qué la capa fina y no el objeto interpuesto completo:** con la seguridad a nivel de fila haciendo el
trabajo, la capa de la aplicación solo tiene que hacer dos cosas —**inyectar la organización en las
escrituras y lanzar cuando no hay contexto**—. Son unas pocas decenas de líneas. Reimplementar toda la
superficie del constructor de consultas es trabajo que no compra nada acá.

---

## 4 · Cómo leer los doce documentos

**No todos se leen igual, y tratarlos igual es la causa principal de error.**

| Documento          | Cómo tratarlo                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| `01` **normativo** | El SQL se aplica. **Salvo las diez tablas de identidad, donde manda el `09` § 2**                        |
| `02` **normativo** | El login se implementa como está, con los agregados del `08` § 5                                          |
| `03` **normativo** | El portero se implementa como está. La lista blanca de rutas es literal                                  |
| `04` **contexto**  | Explica **por qué**. Lo que se implementa de acá es la capa fina y las pruebas del § 7                    |
| `05` **normativo** | Con el arranque por script, no por endpoint                                                              |
| `06` **normativo** | Completo, con las columnas de refresco del `08` § 9                                                      |
| `07` **contexto**  | Se lee antes de cada etapa. **No se implementa nada de acá**: es una lista de errores a no cometer       |
| `08` **mixto**     | § 1 a 5 y § 9 a 10: normativo. § 6 a 8 y § 11 a 14: contexto y decisiones ya tomadas en el § 3 de acá    |
| `09` **normativo** | El más importante. El SQL de la § 2 y la lista blanca de la § 5 se aplican literalmente                  |
| `10` **operación** | **No se implementa ahora**, salvo dos cosas: el aviso de la excepción de aislamiento y la sonda           |
| `PRUEBAS`          | La lista de trabajo. Cada fila de la etapa se escribe **en la misma entrega** que el código que verifica  |
| `00`, `README`     | Mapa. No traen instrucciones                                                                              |

**Regla de precedencia:** entre dos documentos que se contradigan, **gana el de número más alto**. Entre
cualquiera de ellos y este documento, gana este.

**Y una advertencia sobre los documentos de contexto:** están llenos de frases como *"medilo con un plan de
ejecución"* o *"verificalo en la documentación de tu versión"*. **Esas no son tareas.** Son avisos para
cuando aparezca un problema de rendimiento. No se convierten en trabajo sin preguntar.

---

## 5 · Las etapas, con su criterio de cierre

Una etapa no está terminada hasta que su criterio se cumple **y sus filas de `PRUEBAS` existen y pasan**.
No se avanza a la siguiente antes.

### Etapa 0 · Infraestructura

Corredor de pruebas, integración continua, herramienta de migraciones, y una base PostgreSQL levantándose
desde cero en cada corrida con los tres roles, los dos esquemas y **dos organizaciones sembradas con datos
distintos**.

> **Son varios días de trabajo poco vistoso y todo lo demás depende de que exista.** Es la etapa que más
> se subestima.

**Antes de nada, la prueba del controlador**, que decide si el resto del diseño es implementable:

```
abrir transacción
  set_config('app.org_id', '<un uuid>', true)
  leer current_setting('app.org_id', true)   → tiene que devolver el uuid
cerrar transacción
  leer de nuevo                              → tiene que devolver nulo o cadena vacía
```

Si eso no funciona con el controlador elegido, **se para y se avisa**: hay que cambiar de controlador
antes de escribir una línea más.

**Cierre:** una prueba que falla a propósito bloquea la integración; el entorno de pruebas se levanta solo
desde las migraciones; hay dos organizaciones con un usuario cada una.

### Etapa 1 · El esquema

El SQL del `01`, con las diez tablas de identidad tal como las escribe el `09` § 2.

**Cierre:** las invariantes fallan **contra la base**, no contra el backend — borrar al administrador
fundador, desactivar la organización principal y asignar el rol de plataforma a un usuario de un cliente
tienen que fallar las tres. Y la prueba de catálogo devuelve **cero tablas** sin seguridad activada,
forzada, con política y con permisos.

### Etapa 2 · El aislamiento

Los tres roles, las políticas, la variable con alcance de transacción, y la capa fina de la aplicación.

**Cierre — y este es el criterio más importante de todo el proyecto:** con dos organizaciones sembradas y
**conectando con el rol real de la aplicación**, una consulta desde A no devuelve ni una fila de B; sin
organización en contexto no se ve nada; el rol de identidad **lanza permiso denegado** al tocar negocio; y
el rol del inquilino lanza al tocar sesiones.

> Correr estas pruebas con el rol propietario las hace pasar todas sin que nada esté protegido.

### Etapa 3 · Permisos y portero

Catálogo de capacidades, roles, portero con la lista blanca de rutas, verificación de origen.

**Cierre:** la prueba que recorre los manejadores de ruta y verifica que **todos** llaman al portero, salvo
la lista explícita de rutas públicas.

### Etapa 4 · Contraseñas y sesiones

Login completo, estados de sesión, cookie, freno por intentos, segundo factor.

**Cierre:** el login con correo inexistente y con contraseña incorrecta tardan lo mismo; una cabecera de
origen falsificada no evade el freno; una sesión en estado restringido no alcanza ninguna ruta fuera de su
lista.

### Etapa 5 · Administración

Script de arranque, alta de organizaciones y usuarios, restablecimiento.

**Cierre:** un administrador del cliente A que opere sobre un usuario del cliente B recibe **404** en las
cinco operaciones. Y una organización nueva nace sin credenciales, no opera, y la respuesta lo dice.

### Etapa 6 · Credenciales

Cifrado, la función única, enmascarado, refresco con candado.

**Cierre:** el paquete que se publica al navegador **no contiene los nombres ni los valores** de ninguna
variable secreta.

### Etapa 7 · Publicación

Ninguna ruta del API usa primitivas de caché; ninguna respuesta autenticada lleva caché pública; ninguna
ruta de autenticación registra cuerpos.

### Etapa 8 · Detección

Solo dos cosas: que la excepción de la capa de aislamiento **avise por un medio que interrumpa**, y la
sonda horaria con dos organizaciones de control. El resto del `10` es operación, no código.

---

## 6 · Reglas para el asistente

**Se para y se pregunta** —no se elige— cuando:

- dos documentos se contradicen y este no lo resuelve;
- hace falta algo de la lista del § 2;
- una prueba de `PRUEBAS` no se puede escribir como está descrita;
- una decisión del § 3 parece imposible de aplicar con las bibliotecas elegidas.

**No se inventa.** Si un documento describe una tabla, una columna, un código de respuesta o un nombre de
función, se usa **ese**. Los nombres son las cadenas que buscan las pruebas: `conIdentidad(`,
`activarContexto(`, `exigir(`. Un sinónimo rompe la prueba sin romper el código, que es la peor
combinación.

**Las pruebas van en la misma entrega que el código.** Una prueba escrita después se escribe para pasar.

**Nada se marca como terminado sin verificarlo contra la base.** Abrir la base, contar filas, y comparar
con lo que muestra la pantalla. Los defectos de esta familia —una consulta sin filtro, un contador que
suma poblaciones distintas— **no se encuentran leyendo código**.

**Al cerrar cada etapa, un resumen corto:** qué quedó implementado, qué filas de `PRUEBAS` pasan, y **qué
se decidió que no estaba escrito**. Ese último punto es el que importa: es donde aparecen las decisiones
que nadie tomó a propósito.

---

## 7 · Lo que queda fuera de alcance, a propósito

Para que no se agregue por iniciativa propia:

- Inicio de sesión con proveedores externos
- Recuperación de contraseña por correo — la restablece el administrador de cada organización
- Sesiones visibles y revocables por el propio usuario
- Facturación, planes, límite de sesiones simultáneas
- Permisos por registro individual
- Roles privados por cliente (la columna existe, queda vacía)
- Un esquema o una base por cliente
- Servicio dedicado de gestión de claves
- Exportación y borrado automatizados por organización

Ninguna bloquea al primer cliente. Todas se pueden agregar después sin reescribir, y el `08` § 14 dice
cuál es el detonante de cada una.

---

## 8 · La única forma de que esto salga bien

El sistema equivalente ya funciona en la plataforma anterior. **Lo que se está comprando acá no es que
funcione: es que no filtre.** Y los defectos de esa familia comparten una propiedad que hace inútil la
revisión normal:

> **No fallan.** La consulta anda, devuelve filas, responde 200 — y el número está mal, o los datos son de
> otro cliente.

Por eso el criterio de cierre de cada etapa es una prueba que **falla** cuando la regla no se cumple, y no
una demostración de que la pantalla anda. Una pantalla que anda es compatible con todos los defectos que
estos doce documentos intentan impedir.
