# Las reglas y la prueba que sostiene cada una

Esta carpeta tiene miles de líneas de requisitos. El riesgo de eso no es que sean muchos: es que se
apliquen a medias mientras todos creen que están aplicados enteros.

> **Diez documentos aplicados a medias son peores que cinco aplicados completos**, porque los primeros
> vienen con la confianza de los diez.

La defensa no es más documentación. Es esta lista: **cada regla que importa, con la prueba que falla si
no se cumple.** Las reglas con prueba sobreviven; las que solo están escritas duran hasta el primer
viernes con apuro.

Este documento es autosuficiente: se puede usar sin leer los demás, como lista de trabajo.

---

## Cómo usar esta lista

- **Si tenés que recortar por tiempo**, recortá de acá — y así sabés qué estás resignando, en vez de
  descubrirlo cuando alguien pregunte si el sistema es seguro y la respuesta honesta sea "creo que sí".
- **Cada prueba se escribe en la misma etapa que el código que verifica.** No al final. Una prueba
  escrita después se escribe para pasar.
- **Las marcadas ⛔ son las innegociables.** El resto es mejorable después sin reescribir nada.

### Los cinco tipos, y por qué la diferencia importa

| Tipo             | Qué hace                                                      | Por qué es distinto                                                           |
| ---------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Código**       | Lee los archivos del proyecto y verifica que cumplen la forma | Es lo único que agarra **la operación que se va a escribir el mes que viene** |
| **Base**         | Corre contra la base y espera que la operación **falle**      | Verifica invariantes que un condicional del backend no puede garantizar       |
| **Catálogo**     | Consulta el catálogo del motor de base                        | No se puede engañar con un comentario y **no se queda vieja**                 |
| **Construcción** | Inspecciona lo que se publica                                 | Verifica el artefacto, no la intención                                        |
| **Producción**   | Corre contra el sistema en vivo                               | Es la única que detecta el fallo **mientras está pasando**                    |

La mayoría de los proyectos solo tiene pruebas de comportamiento. **Las de código y de catálogo son las
que sostienen un diseño como éste**, porque las reglas que importan no son sobre lo que el sistema hace,
sino sobre lo que ningún archivo debe olvidarse de hacer.

---

## Los ocho innegociables, en orden

Este orden no es una preferencia: cada uno apoya al siguiente.

| #     | Qué                                                                                                                     | Por qué va acá                                                                     |
| ----- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **1** | Corredor de pruebas e integración continua, **antes del esquema**                                                       | Sin esto, nada de lo demás existe. Solo se cree que existe                         |
| **2** | Herramienta de migraciones versionadas                                                                                  | Sin esto las invariantes divergen entre entornos y la prueba que debía fallar pasa |
| **3** | Rol de base dedicado + forzar las políticas + `with check` + variable local en transacción + **el rol de la escotilla** | Es la segunda capa. Sin las pruebas, no se puede afirmar que exista                |
| **4** | Las reglas de caché, con su prueba                                                                                      | Es la única fuga que ninguna capa de datos mira                                    |
| **5** | Ningún secreto en el paquete del navegador                                                                              | Una filtración acá es permanente y publicada                                       |
| **6** | Las dos pruebas de código: toda operación llama al portero, toda operación abre el contexto                             | Son las que agarran lo que todavía no se escribió                                  |
| **7** | **Dos organizaciones sembradas en desarrollo, siempre**                                                                 | Con una sola, ninguno de estos defectos se manifiesta                              |
| **8** | Segundo factor para el rol que ve todas las organizaciones                                                              | Sin él, una contraseña filtrada es una brecha de todos los clientes                |

El **7** es el más barato de la lista y el que más defectos va a encontrar. No es una prueba: es una
condición del entorno de desarrollo.

**Y el mapeo, sin el cual esta lista no se puede ejecutar.** "Recortá de acá y sabé qué estás
resignando" solo funciona si cada innegociable se puede localizar entre las filas de más abajo. Sin este
mapeo, un innegociable puede quedarse sin una sola fila y nadie lo nota:

| Innegociable | Sus filas están en                                                 |
| ------------ | ------------------------------------------------------------------ |
| **1**        | Etapa 0, fila 1                                                    |
| **2**        | Etapa 0, fila 2                                                    |
| **3**        | Etapa 1 (catálogo) y Etapa 2 (las seis de aislamiento y escotilla) |
| **4**        | Etapa 7, filas 1 a 3                                               |
| **5**        | Etapa 6, fila 1                                                    |
| **6**        | Etapa 2 (abre el contexto) y Etapa 3 (llama al portero)            |
| **7**        | Etapa 0, fila 3 — y no es una prueba sino el entorno               |
| **8**        | Etapa 4, las dos últimas filas                                     |

---

## Etapa 0 · Antes del esquema

| ⛔  | Regla                                                             | La prueba                                                       | Tipo   |
| --- | ----------------------------------------------------------------- | --------------------------------------------------------------- | ------ |
| ⛔  | Las pruebas corren en cada cambio y pueden bloquear               | Una prueba que falla a propósito **bloquea la integración**     | Código |
| ⛔  | Las migraciones son versionadas y se aplican igual en todos lados | El entorno de pruebas se levanta **solo desde las migraciones** | Base   |
| ⛔  | Hay dos organizaciones con datos distintos en desarrollo          | El sembrado crea dos, con un usuario en cada una                | Base   |

---

## Etapa 1 · El esquema y sus invariantes

| ⛔  | Regla                                                                 | La prueba                                                                                                                  | Tipo     |
| --- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------- |
|     | El administrador fundador no se borra, no se desactiva, no se degrada | Las tres operaciones **fallan contra la base**, no contra el backend                                                       | Base     |
|     | La organización principal no se desactiva                             | La operación falla contra la base                                                                                          | Base     |
|     | El rol de plataforma solo existe en la organización principal         | Asignarlo a un usuario de un cliente falla contra la base                                                                  | Base     |
|     | Un rol privado de una organización no se asigna a usuario de otra     | La inserción cruzada falla contra la base                                                                                  | Base     |
|     | La auditoría es inmutable                                             | `update` y `delete` fallan, **y el rol no tiene el permiso**                                                               | Base     |
|     | Las referencias dentro del inquilino no cruzan organizaciones         | Insertar una fila que referencia un registro de otra organización falla                                                    | Base     |
| ⛔  | Toda tabla tiene seguridad de fila activada, forzada y con política   | Consulta al catálogo: **cero tablas** sin las tres cosas                                                                   | Catálogo |
| ⛔  | Y además, permisos: la tabla es **accesible** para el rol que la usa  | `has_table_privilege` por tabla. Una tabla con política perfecta y sin permiso pasa la fila anterior y rompe en producción | Catálogo |

La última es la más valiosa del documento entero: es la que agarra la tabla que alguien va a crear
dentro de seis meses sin acordarse de nada de esto.

---

## Etapa 2 · El aislamiento

| ⛔  | Regla                                                       | La prueba                                                                                                                                                                                                                                                    | Tipo     |
| --- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| ⛔  | Ninguna consulta corre sin organización activa              | Una consulta sin contexto **lanza**                                                                                                                                                                                                                          | Código   |
| ⛔  | Toda operación abre el contexto de su organización          | Recorre los archivos de operaciones y verifica que cada una lo abre — **salvo las rutas públicas y las operaciones del dominio de identidad**, que van en una lista explícita. Sin esa exención la prueba falla sobre código correcto y se termina ignorando | Código   |
|     | Un solo lugar crea el cliente de base                       | Ningún archivo fuera de la capa de datos importa el controlador                                                                                                                                                                                              | Código   |
| ⛔  | Los roles de la aplicación no pueden saltear las políticas  | `bypassrls` es falso y no son superusuarios                                                                                                                                                                                                                  | Catálogo |
| ⛔  | Sin organización en contexto, no se ve nada de negocio      | La consulta **lanza o devuelve 0**. Exigir exactamente 0 hace una prueba que pasa o falla según el estado del agrupador de conexiones                                                                                                                        | Base     |
| ⛔  | Con la organización A no se ve ni una fila de la B          | Dos organizaciones sembradas, consulta desde A                                                                                                                                                                                                               | Base     |
| ⛔  | La escotilla no llega a las tablas de negocio               | Con el rol de identidad, consultar negocio **lanza permiso denegado** (no vacío)                                                                                                                                                                             | Base     |
| ⛔  | El dominio del inquilino no llega a las tablas de identidad | Con el rol del inquilino, consultar sesiones **lanza**                                                                                                                                                                                                       | Base     |
|     | Solo los archivos autorizados usan el acceso sin filtro     | Lista explícita, y un archivo nuevo rompe la suite                                                                                                                                                                                                           | Código   |

---

## Etapa 3 · Permisos y el portero

| ⛔  | Regla                                                                        | La prueba                                                                                                                                | Tipo   |
| --- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| ⛔  | Toda operación llama al portero                                              | Recorre los archivos de operaciones **y las funciones que el framework expone solas**, salvo las rutas públicas (login, salud, arranque) | Código |
|     | El permiso se pregunta por capacidad, nunca por nombre de rol                | Ninguna comparación con un nombre de rol en el código                                                                                    | Código |
|     | Todo rol asignable tiene al menos una pantalla                               | Cruce entre roles asignables y secciones de menú                                                                                         | Código |
|     | Las operaciones de una misma pantalla piden el mismo conjunto de capacidades | Agrupadas por pantalla, los conjuntos coinciden                                                                                          | Código |
|     | Un rechazo por permiso no se muestra como "no hay datos"                     | El cliente HTTP distingue el rechazo del vacío legítimo                                                                                  | Código |
|     | Toda petición que modifica verifica el origen                                | Una petición con origen ajeno se rechaza                                                                                                 | Código |

---

## Etapa 4 · Contraseñas y sesiones

| ⛔  | Regla                                                                       | La prueba                                                                                                                                                                 | Tipo     |
| --- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
|     | El mensaje único va con el tiempo único                                     | El login con email inexistente y con contraseña incorrecta **tardan lo mismo**                                                                                            | Código   |
|     | El freno por intentos no se evade                                           | Una cabecera de origen falsificada **no** evade el freno                                                                                                                  | Código   |
|     | La búsqueda usa la misma expresión que el índice único                      | Un usuario guardado con mayúsculas puede entrar                                                                                                                           | Base     |
|     | La sesión tiene techo absoluto                                              | Una sesión creada hace más del techo no entra, aunque se haya usado a diario                                                                                              | Base     |
|     | La cookie lleva el prefijo y los atributos                                  | La respuesta del login trae el nombre y los cuatro atributos                                                                                                              | Código   |
|     | El cambio de contraseña **no** exige capacidades                            | Es la única salida del estado de contraseña temporal                                                                                                                      | Código   |
| ⛔  | Ninguna ruta de autenticación registra cuerpos                              | Ningún archivo de esas rutas pasa el cuerpo a la función de registro                                                                                                      | Código   |
|     | Ninguna ruta específica de un estado está en dos listas                     | Comparando **sin** el conjunto común (consultar y cerrar sesión, que están a propósito en las cuatro)                                                                     | Código   |
|     | De todo estado se puede salir y preguntar quién soy                         | Cerrar sesión y consultar la sesión están en las cuatro listas                                                                                                            | Código   |
| ⛔  | Un endpoint nuevo nace cerrado a los estados restringidos                   | Recorre las rutas **que llaman al portero**: las que no están en ninguna lista responden rechazo. Sin acotarlo, la prueba falla sobre el login y la comprobación de salud | Código   |
|     | La sesión a medio autenticar no llega a nada real                           | Con una sesión pendiente, todas las rutas fuera de su lista rechazan                                                                                                      | Código   |
| ⛔  | Todo rol de plataforma exige segundo factor                                 | Consulta a la tabla de roles: **cero filas** con `solo_principal` y la bandera apagada; y asignar un rol así sin la bandera falla                                         | Catálogo |
| ⛔  | Un usuario con un rol que exige segundo factor no obtiene sesión habilitada | El login devuelve un estado restringido, no `activa`, y el portero corta                                                                                                  | Código   |
|     | El estado de la sesión existe como dato                                     | La columna está en el esquema con su restricción de valores. Sin ella todo el mecanismo es decorativo                                                                     | Catálogo |

---

## Etapa 5 · Administración

| ⛔  | Regla                                                       | La prueba                                                       | Tipo   |
| --- | ----------------------------------------------------------- | --------------------------------------------------------------- | ------ |
|     | Nadie se borra, desactiva ni degrada a sí mismo             | La operación sobre el propio identificador se rechaza           | Código |
|     | No se puede dejar una organización sin administrador activo | Desactivar al último administrador se rechaza                   | Código |
|     | Un administrador no puede otorgar el rol de plataforma      | Rechazo en el endpoint **y** en la base                         | Base   |
|     | Restablecer una contraseña cierra las sesiones              | Después del restablecimiento, las sesiones del usuario no valen | Base   |
|     | La contraseña temporal nunca queda registrada               | No aparece en la auditoría ni en ningún registro                | Código |
|     | El generador de temporales no tiene sesgo                   | Distribución de caracteres sobre muchas muestras                | Código |
|     | Una organización nueva no hereda credenciales               | Nace sin ninguna, no opera, y la respuesta lo dice              | Base   |

---

## Etapa 6 · Credenciales

| ⛔  | Regla                                                 | La prueba                                                          | Tipo         |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------ | ------------ |
| ⛔  | Ningún secreto llega al navegador                     | El paquete construido no contiene **los nombres ni los valores**   | Construcción |
|     | El nonce es distinto en cada cifrado                  | Cifrar dos veces el mismo valor da resultados distintos            | Código       |
|     | El descifrado fallido lanza con un mensaje accionable | Nunca devuelve nulo ni vacío                                       | Código       |
|     | Sin credencial, la organización no opera y lo dice    | **Ningún respaldo implícito** a la credencial de otra organización | Código       |
|     | Dos refrescos simultáneos no se invalidan             | Dos peticiones a la vez: una refresca, la otra usa el resultado    | Base         |
|     | Un estado ausente y uno vencido no se muestran igual  | Cada uno con su texto; nunca un cero como si fuera un dato         | Código       |

---

## Etapa 7 · El framework y lo que se publica

| ⛔  | Regla                                              | La prueba                                                                     | Tipo   |
| --- | -------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| ⛔  | Ninguna ruta autenticada se cachea                 | Ningún archivo de rutas usa primitivas de caché fuera de una lista autorizada | Código |
| ⛔  | Ninguna respuesta autenticada lleva caché pública  | Las respuestas traen la cabecera de no almacenar                              | Código |
| ⛔  | Toda memorización incluye la organización efectiva | Ninguna clave de caché sin la organización                                    | Código |
|     | Las respuestas de error no revelan estructura      | Ningún cuerpo de error contiene nombres de tablas ni consultas                | Código |

---

## Etapa 7b · La cadena de dependencias

Corta y fácil de olvidar, porque no se parece a las demás: una dependencia con un guion de instalación
malicioso corre en el servidor de construcción, **donde están todas las variables de entorno**.

| ⛔  | Regla                                         | La prueba                                                                       | Tipo         |
| --- | --------------------------------------------- | ------------------------------------------------------------------------------- | ------------ |
|     | Las versiones son exactas, sin rangos         | Revisar el manifiesto; un rango es un cambio que nadie aprobó                   | Código       |
|     | El archivo de bloqueo está versionado         | Un cambio en ese archivo sin cambio en el manifiesto **bloquea la integración** | Código       |
|     | Los guiones de instalación están desactivados | Con una lista corta de excepciones justificadas                                 | Construcción |

---

## Etapa 8 · Producción

Estas no son pruebas del proyecto: son pruebas **del sistema andando**. Son las únicas que detectan un
fallo mientras está pasando.

| ⛔  | Regla                                                | La prueba                                                                                                                                                                                                    | Tipo       |
| --- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| ⛔  | El aislamiento se sostiene ahora, no solo en pruebas | Sonda cada hora: dos organizaciones de control, ninguna ve a la otra                                                                                                                                         | Producción |
| ⛔  | Una operación sin contexto avisa, no solo falla      | La excepción del aislamiento emite un aviso inmediato                                                                                                                                                        | Producción |
|     | Las credenciales ilegibles se detectan               | Consulta diaria sobre la auditoría                                                                                                                                                                           | Producción |
|     | Los rechazos por permiso se vigilan                  | Resumen semanal por organización y capacidad                                                                                                                                                                 | Producción |
|     | Los intentos fallidos se vigilan                     | Consulta horaria, contando **emails distintos** por origen                                                                                                                                                   | Producción |
|     | El acceso de soporte queda registrado                | Todo cambio de organización activa queda en la auditoría                                                                                                                                                     | Producción |
|     | El respaldo se puede restaurar                       | Restauración ensayada, con la aplicación arrancando contra la copia                                                                                                                                          | Producción |
|     | El aviso funciona                                    | El resumen **se manda siempre**, también cuando todo está en cero                                                                                                                                            | Producción |
| ⛔  | Las tres acciones de auditoría se **emiten**         | Provocar cada una y verificar que aparece la fila. Sin esto, un cero en la vigilancia es indistinguible de "nadie cableó el punto de emisión", y tres de las seis señales quedan apagadas sin que nada falle | Código     |
|     | El aviso de aislamiento llega de verdad              | Provocar la excepción en un entorno de ensayo y confirmar que el mensaje **llega al medio elegido**. Escribir en el registro del servidor no cuenta                                                          | Producción |

---

## Lo que puede esperar, dicho para que no genere culpa

Nada de esto bloquea al primer cliente, y todo se agrega después sin reescribir:

- Sesiones visibles y revocables por el propio usuario
- Recuperación de contraseña por correo — mientras la haga el administrador de cada organización
- Roles privados por cliente: **basta con crear la columna vacía** en la primera migración
- Rotación de la clave maestra implementada: basta con el **procedimiento escrito**
- Exportación y borrado automatizados: basta con saber cómo se harían a mano
- Un servicio dedicado de gestión de claves
- Inicio de sesión con proveedores externos

Los ocho innegociables, no.
