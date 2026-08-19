# 07 — Errores a evitar

Los fallos concretos que un sistema construido con este diseño **ya pagó en producción**. No son
hipótesis: cada uno ocurrió, y ninguno lanzó una excepción.

Conviene leerlo **antes** de escribir la primera línea. Es el documento más útil de la carpeta.

Este documento es autosuficiente: no depende de los otros de la carpeta.

---

## 0 · La forma que tienen todos

Casi todos los defectos graves de un sistema multiempresa comparten una firma:

> **Un éxito reportado que no ocurrió.**

Una operación que responde 200 con todo fallado. Un dato que se pinta en pantalla y no se guarda. Un
contador que suma poblaciones distintas. Una consulta que devuelve las filas de otro cliente.

Ninguno lanza una excepción. Ninguno rompe una prueba que ya existía. Todos se descubren **mirando datos
reales y preguntando "¿esto que dice la pantalla es cierto?"**.

De ahí salen las tres reglas que valen para todo lo que sigue:

1. **Si una escritura falla, la respuesta lo dice.** Siempre, aunque sea accesoria y no se pueda hacer
   nada al respecto.
2. **Un valor nulo significa una sola cosa.** Nunca "no hay" _y_ "no pude averiguarlo" a la vez.
3. **Lo que no se puede probar, no se afirma.** Un cero medido y un cero por falta de datos se muestran
   distinto.

---

## 1 · Aislamiento

### Olvidarse de abrir el contexto no da error: usa las credenciales globales

Una operación que verifica permisos pero **no** abre el contexto de su organización sigue funcionando —
con lo que haya configurado globalmente, que suele ser la organización principal. Con un solo cliente
nadie lo nota. Con dos, uno escribe en la cuenta externa del otro.

**Ocurrió en catorce operaciones ya escritas.** Ninguna fallaba.

> **Lo único que lo agarra** es una prueba que lea el código fuente de cada operación y verifique que abre
> el contexto. Escribila antes de la segunda operación, no después de la decimocuarta.

### Un valor por defecto que anula la decisión

La regla era: _una organización sin credencial no opera y lo dice_. El código decía:

```
crmToken: () => credencialesActivas()?.token ?? entorno("CRM_TOKEN")
```

Ese `??` convertía **"esta organización no tiene token"** en **"usá el de la principal"**, para todas.
La regla estaba escrita, documentada y con pruebas; dos caracteres al final de una línea la desactivaban.

> Los fallbacks tienen que ser **explícitos, nombrados y acotados** a la organización que corresponde. Un
> fallback que no se ve en una revisión de código no se puede revisar.

### Una clave foránea que cruza inquilinos sin quejarse

Si `pedidos.usuario_id` referencia `usuarios(id)` a secas, **nada impide** que un pedido de la
organización A apunte a un usuario de la B. La base lo acepta: el identificador existe.

Ocurrió con un parámetro que tenía valor por defecto —el identificador de una persona real— y **todo** lo
registrado, de cualquier organización, quedó firmado por esa persona.

> Las referencias dentro del inquilino van al **par**: clave única `(org_id, id)` en la tabla
> referenciada, y foránea compuesta en la que referencia. Y los parámetros que dicen _quién hizo esto_ van
> **obligatorios y sin valor por defecto**: si mañana aparece un llamador nuevo, que no compile hasta que
> diga quién es.

### Un procedimiento almacenado sin el parámetro de organización

PostgreSQL resuelve las sobrecargas por cantidad de argumentos. Si existe `f(p_org_id)` y quedó una `f()`
heredada, **un llamador que se olvide el argumento no falla**: ejecuta la vieja, que ignora la
organización.

> Borrar la versión sin parámetro es parte del trabajo. Y `create or replace` **no** puede quitar valores
> por defecto de los parámetros: hay que borrar y recrear, y el borrado **se lleva los permisos**, así que
> hay que reponerlos en la misma migración.

### El contexto que no propaga

En los sistemas de contexto local asíncrono hay dos primitivas: una que "entra" y no cierra, y una que
"envuelve" y cierra. **La primera no propaga hacia afuera de una función asíncrona.**

Dos consecuencias medidas:

- **En un bucle de organizaciones**, el contexto de la primera puede seguir vivo cuando empieza la
  segunda.
- **En los ganchos de preparación de las pruebas**, el contexto no queda puesto para las pruebas. Eso hizo
  que una limpieza nunca corriera y quedaran filas de prueba **en producción**.

### Una variable global como contexto

Funciona perfecto en desarrollo —una petición a la vez— y en producción dos peticiones de organizaciones
distintas se pisan. El bug es intermitente, depende de la carga, y no se reproduce.

---

## 2 · Permisos

### Un rechazo por permiso que se ve como "no hay datos"

Si el cliente HTTP convierte cualquier error en una lista vacía para no romper la pantalla, un `403` se
muestra como _"no hay nada acá"_. El usuario no sabe que le falta un permiso: **cree que el sistema está
vacío**.

Ocurrió con una pantalla de cinco secciones donde un rol estaba autorizado en **una**: quien la abría veía
una sección con datos y cuatro en blanco, sin ningún error.

> Es el peor de esta lista, porque **nadie reporta un bug de algo que "simplemente no tiene datos"**.
>
> Dos consecuencias: el `403` merece su propio tratamiento, distinto del vacío legítimo; y **todas las
> operaciones que llenan una misma pantalla tienen que pedir el mismo conjunto de capacidades**, con una
> prueba que lo verifique.

### Comparar nombres de rol "solo esta vez"

Aparece siempre, y con un argumento razonable ("es un caso especial del administrador"). Cada una de esas
comparaciones es un lugar que hay que encontrar y revisar cuando llegue un rol nuevo — y el que se olvide
no va a fallar: va a dejar afuera a alguien que debería entrar, o adentro a alguien que no.

> Si de verdad es un caso especial, es una **capacidad nueva**. Cuesta una fila.

### Un rol asignable sin ninguna pantalla

Ocurrió: un rol era asignable desde el panel y no tenía ninguna sección de menú. Quien lo tenía entraba a
la primera pantalla disponible y recibía un rechazo completo, sin explicación.

> Todo rol asignable necesita al menos una pantalla, o no debería ser asignable.

### El rol de plataforma sin acotar en la base

Si el condicional que impide crear un rol de plataforma fuera de la organización principal vive solo en el
backend, un script de mantenimiento, una consola o un endpoint nuevo lo saltea. **Es una escalada entre
inquilinos**: el administrador de un cliente se otorga acceso a todos los demás.

> Va en la base, con un disparador.

### Guardar los permisos dentro del token de sesión

Quitarle un permiso a alguien deja de tener efecto hasta que su sesión venza. Con sesiones de siete días,
eso es una semana.

---

## 3 · Autenticación

### Buscar por la columna cruda cuando el índice único es sobre la función

Si el índice es `unique (lower(email))` y el login busca `where email = $1`, funciona **solo** mientras
todos los caminos guarden en minúsculas. El día que una carga manual, una migración o un script meta una
mayúscula, esa persona **no puede entrar** y el mensaje dice "credenciales inválidas".

> La consulta usa la **misma expresión** que el índice.

### El mensaje uniforme sin el tiempo uniforme

Responder "no existe" al instante y "contraseña incorrecta" 100 ms después **dice exactamente lo que el
mensaje único venía a esconder**. Con un cronómetro se enumeran cuentas igual.

> Hay que derivar el hash igual cuando el email no existe, contra un **señuelo** con los mismos
> parámetros. Y la comparación de longitudes va **después** de derivar: si cortara antes, el camino del
> señuelo terminaría más rápido y el canal de tiempo se abriría por la puerta de al lado.

### El freno por intentos que se reinicia sin decidirlo

Al bloquear, si el contador vuelve a cero, cuando el bloqueo vence el atacante tiene otra tanda limpia. Si
no vuelve a cero, hay que decidir cuándo se limpia o el bloqueo se vuelve permanente.

> Es una decisión, no un detalle. Si querés bloqueos crecientes, guardá la **cantidad de bloqueos** además
> de la de intentos.

### El rechazo por IP que alimenta su propio contador

Si el rechazo se registra con la misma acción que un intento fallido y el contador cuenta esa acción, el
bloqueo se sostiene solo mientras alguien golpee. Como defensa funciona; como diagnóstico confunde, porque
el registro no distingue "intentó y falló" de "ni lo dejamos intentar".

### El freno por IP sin índice que lo sostenga

Contar los intentos por IP sobre la tabla de auditoría es buena idea —evita una tabla y una dependencia—
pero si los índices son solo por fecha y por organización, esa consulta hace un **recorrido completo en
cada intento de login**. Con la tabla chica no se nota.

### Un caché de credenciales entre peticiones

En funciones sin servidor, las instancias se reutilizan entre peticiones de **organizaciones distintas**.
Un caché de proceso "para no descifrar dos veces" es exactamente cómo el token de una organización termina
usándose para otra.

---

## 4 · Interfaz

Ninguno es un problema de seguridad —el servidor valida igual— pero todos confunden a quien los ve, y dos
hacen perder datos.

### Dos clientes HTTP con manejo de error opuesto

Si en el mismo frontend hay uno que lanza (y manda al login ante un `401`) y otro que devuelve nulo para
seguir con datos de ejemplo, **un `401` por el segundo camino no echa a nadie**: la sesión está vencida y
la pantalla sigue como si nada.

### Un fallo de red que se ve igual que "no hay sesión"

Si la consulta inicial de sesión captura cualquier error y responde "no autenticado", sin internet la
aplicación muestra el login en vez de decir que no pudo preguntar. Es la regla 2 del § 0 incumplida.

### Reemplazar la lista entera con lo que dice el servidor

Un dato recién enviado por el usuario todavía no está en la respuesta del servidor. Si cada consulta
periódica **reemplaza** el estado local, ese dato **desaparece de la pantalla y vuelve** unos segundos
después. Y si el envío falló de verdad, la marca de error local se borra en la próxima consulta: el
usuario ve el error un segundo y después nada.

> La respuesta es **fusionar**, no reemplazar: conservar lo local que el servidor todavía no confirmó. Y
> contar **copias**, no presencia — si alguien manda dos veces el mismo texto, comparar por presencia da
> por confirmada la segunda cuando llega la primera.

### Mostrar un control que no puede cumplir

Un botón que se ve, se aprieta y no hace nada porque la función que debía atenderlo no está conectada. Y
la variante peor: un botón que **festeja** (mensaje de éxito, animación) mientras la escritura no ocurrió.

> Si no hay quien atienda una acción, **el control no se renderiza**. Y el festejo se dispara con la
> confirmación del servidor, no con el clic.

### Un caché en el navegador que no es por usuario

Guardar preferencias visuales en el almacenamiento local para no parpadear al arrancar significa que, en
una máquina compartida, el primer cuadro del próximo usuario usa las preferencias del anterior. Es
imposible de arreglar del todo: para saber de quién son hay que preguntar al servidor, y para no
parpadear hay que pintar antes de preguntar.

---

## 5 · Datos y consultas

### Paginar sin ordenar

Pedir páginas sin `order by` **no garantiza nada**: dos páginas seguidas pueden repetir una fila y
saltearse otra. Con inserciones concurrentes —lo normal— el conteo sale mal **y no hay error**.

> Puede no reproducirse en desarrollo, porque el plan de ejecución resulta estable. La garantía sigue sin
> existir.

### Contar dos poblaciones distintas en el mismo número

Un indicador que toma el numerador de una consulta y el denominador de otra, y las dos filtran distinto.
**Se rompió tres veces**, siempre igual: alguien tocó una mitad y no la otra. Ninguna vez falló una
prueba — el número quedaba mal, con toda la cara de un dato medido.

> Si dos consultas alimentan un mismo número, o comparten la derivación o hay una prueba que verifica que
> digan lo mismo. Especialmente si viven en lenguajes distintos, como una consulta y una vista SQL.

### Guardar la hora de "cuando lo recibimos" y ordenar por ella

Si un dato tiene una hora propia del sistema externo, **ordenar por la hora de recepción desordena todo**
en cuanto haya un reproceso o una carga masiva. Medido en un caso real: **el 78 % de las filas** quedaba
en otra posición.

> Guardá las dos horas y ordená por la del origen.

### Mostrar horas de varios días sin separadores

Una lista de eventos de días distintos, con solo la hora visible, se lee como si el tiempo retrocediera:
`19:14` seguido de `08:09`. **Los datos están ordenados y el usuario reporta que están desordenados**, con
razón: falta decir dónde cambia el día.

---

## 6 · Operaciones y despliegue

### Una tarea larga que se muere sin dejar informe

Si la plataforma corta la ejecución al llegar a un tope de tiempo, se pierde **el informe entero**:
cuántos elementos se procesaron, cuáles fallaron, dónde retomar.

> Cortar **antes por cuenta propia**, con un presupuesto menor al de la plataforma, y reportar lo que
> quedó pendiente. Cortar entre elementos, no en la mitad de uno.

### Una operación que responde éxito con todos sus elementos fallados

Si el resultado por lotes junta los errores por elemento y sigue —correcto, uno roto no puede tumbar a los
demás— pero el estado general solo mira el fallo del lote, la respuesta dice `ok: true` con todo fallado.

### Un tope silencioso

Si una operación procesa "los primeros N" y no dice cuántos quedaron, se lee como _"ya está todo hecho"_.
Reportá siempre lo que dejaste afuera.

### Una marca de tiempo que nadie escribe

Una columna "última sincronización" que nadie actualiza es **peor que no tenerla**: se lee como un hecho.
Ocurrió, y llevó a un diagnóstico equivocado que costó rehacer el análisis.

> Toda marca de estado tiene **un solo autor**, y se sella **solo cuando la operación de verdad ocurrió**.

### Todo archivo en cierta carpeta se publica como endpoint

En algunas plataformas sin servidor, cualquier archivo bajo el directorio de la API se publica. Un archivo
de pruebas ahí adentro **se publica como endpoint ejecutable**. Averiguá la convención de exclusión de tu
plataforma antes de poner el primer archivo auxiliar.

### Las variables de entorno se congelan al desplegar

Agregar una exige volver a desplegar. Es obvio hasta que alguien pasa una hora depurando por qué la
variable que acaba de crear "no existe".

### Un cambio de esquema sin avisarle a la capa REST

Si usás una capa que expone la base por HTTP y mantiene un caché del esquema, **hay que avisarle que
recargue** después de cada cambio. Sin eso, la primera escritura falla sobre una columna que existe.

---

## 7 · Las pruebas que valen más que su costo

No son pruebas de comportamiento: son **análisis estático escrito como prueba**. Cada una impide una clase
entera de error, y todas fueron escritas **después** del bug que las justifica.

| Prueba                                                             | Qué impide                                      |
| ------------------------------------------------------------------ | ----------------------------------------------- |
| Toda operación llama al portero                                    | Un endpoint sin verificación de permisos        |
| Toda operación abre el contexto de organización                    | Leer los datos de otro cliente                  |
| El acceso sin filtro, solo en archivos autorizados                 | La escotilla que se vuelve costumbre            |
| Un solo lugar crea el cliente de base de datos                     | Que alguien cree uno sin filtro "solo esta vez" |
| Toda tabla nueva declara la columna del inquilino                  | Una tabla sin aislamiento                       |
| Las operaciones de una misma pantalla piden las mismas capacidades | La pantalla que se ve a medias                  |
| El nombre de un secreto no aparece en el código del cliente        | Una credencial filtrada al navegador            |
| Numerador y denominador de un indicador filtran igual              | El número que miente con cara de medido         |

Se escriben leyendo el código fuente como texto, quitando comentarios primero (o un comentario que
mencione la escotilla hace fallar la prueba).

**Escribilas temprano.** Son lo único que sostiene estas reglas cuando el equipo crece, cuando pasa el
tiempo, o cuando el código lo escribe un asistente que no leyó esta documentación.

---

## 8 · El corolario

**Verificá contra datos reales.**

En el sistema del que salen estas notas, la diferencia entre "parece que anda" y "anda" apareció recién
ahí — **todas** las veces. Los defectos de esta lista no se encontraron leyendo código ni corriendo
pruebas: se encontraron abriendo la base, contando filas, y comparándolas con lo que la pantalla decía.

Cuando termines una parte, hacete la pregunta incómoda: **¿lo que muestra la pantalla es cierto, y cómo lo
sé?**
