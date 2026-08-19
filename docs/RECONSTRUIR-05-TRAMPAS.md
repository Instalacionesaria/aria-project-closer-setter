# RECONSTRUIR · 05 — Las trampas

Los errores que este sistema ya cometió, o que tiene abiertos hoy. Es el documento más útil de la
serie: lo demás explica cómo funciona, esto explica **cómo se rompe**.

Están agrupadas por lo que tienen en común, que casi siempre es lo mismo: **el fallo no se ve**.

---

## 1 · Las que fallan en silencio

Estas son las peligrosas. No lanzan, no rompen un test, no aparecen en un log. El sistema sigue
andando y la respuesta está mal.

### Olvidarse de activar el contexto no da error: usa las credenciales globales

Un endpoint que llama al portero y **no** activa las credenciales de su empresa sigue funcionando —
con las credenciales globales, que son las de la empresa principal. Con una sola empresa nadie lo
nota. Con dos, un cliente escribe en el CRM del otro.

Pasó con **catorce endpoints** ya escritos. Ninguno fallaba.

> **Lo único que lo agarra es un test que lea el código fuente** de cada endpoint y verifique que
> active el contexto. Escribilo antes que el segundo endpoint, no después del catorceavo.

### El `??` que anuló la decisión

La regla era: _una empresa sin token no opera y lo dice_. El código decía:

```ts
ghlApiKey: () => credencialesActivas()?.ghlPit ?? process.env.GHL_PIT;
```

Ese `??` convertía **"esta empresa no tiene token"** en **"usá el de la principal"**. La decisión
estaba escrita, documentada y testeada… y un operador de dos caracteres la desactivaba.

> Al reconstruir: los _fallbacks_ de credenciales tienen que ser explícitos y nombrados (`desdeEntorno`),
> nunca un `??` al final de un getter. Un fallback que no se puede ver en el diff no se puede revisar.

### Una función de base de datos sin el parámetro de organización resuelve a la versión vieja

Postgres resuelve las sobrecargas por aridad. Una función `f(p_org_id uuid)` y una `f()` heredada
conviven, y **un llamador que se olvide el argumento no falla**: ejecuta la global, que ignora la
empresa.

> La contracción (borrar la versión sin parámetro) es parte del trabajo, no una limpieza opcional. Y
> `CREATE OR REPLACE` **no** puede quitar defaults de parámetros: hay que `DROP` + `CREATE`, y el
> `DROP` **se lleva los permisos**, así que hay que reponerlos en la misma migración.

### Un valor por defecto en un parámetro firma con la persona equivocada

Una función tenía `closerId?: string` con un valor por defecto: el uuid de una persona real. Ninguno
de los tres endpoints lo pasaba, así que **todo** lo registrado —de cualquier rol y de cualquier
empresa— quedaba firmado por esa persona. La clave foránea apuntaba solo al `id`, no al par
`(org_id, id)`, así que nada fallaba.

> Los parámetros que dicen _quién hizo esto_ van **obligatorios y sin valor por defecto**. Si mañana
> aparece un llamador nuevo, que no compile hasta que diga quién es.

### Un 403 no se ve como error: se ve como dato vacío

El cliente HTTP intercepta el 401 (sesión vencida) y deja pasar el 403 como un `Error` cualquiera. Y
los `catch` de las vistas suelen devolver una lista vacía para no romper la pantalla.

Resultado: a un rol que no tiene permiso, la ficha del contacto **no le dice "no tenés permiso"**. Le
muestra "este contacto no tiene notas". Pasó de verdad: un rol estaba autorizado en uno de los cinco
tabs, y quien auditaba veía un tab con datos y cuatro en blanco.

> Los endpoints que llenan una misma pantalla tienen que pedir **el mismo conjunto de roles**, y
> conviene un test que lo verifique. Y el 403 merece su propio tratamiento en el cliente, distinto de
> "no hay datos".

### Paginar sin ordenar

Pedir páginas de 1000 filas sin `ORDER BY` **no garantiza nada**: dos páginas seguidas pueden repetir
una fila y saltearse otra. Con inserciones concurrentes —que es lo normal— el conteo sale mal y no
hay error.

Probado contra la base: hoy no se reproduce, porque el plan es un recorrido secuencial estable. La
garantía sigue sin existir.

### Contar dos poblaciones distintas en el mismo número

Un indicador que decía _"N verdes de M"_ tomaba el numerador de una consulta y el denominador de una
vista, y las dos filtraban distinto. Se rompió **tres veces**, siempre igual: alguien tocó una mitad
y no la otra. Ninguna vez falló un test — el número quedaba mal, con toda la cara de un dato medido.

> Si dos consultas alimentan un mismo número, o comparten la derivación o hay un test que verifica
> que digan lo mismo. Especialmente si viven en lenguajes distintos (una consulta y una vista SQL).

---

## 2 · Las del contexto por request

### El contexto no propaga hacia afuera de una función asíncrona

`enterWith` abre el contexto para la continuación **actual**. Llamarlo dentro de una función `async`
y esperar que el llamador quede en ese contexto no funciona.

Dos consecuencias concretas:

- **En los hooks de test**: la limpieza de un `afterAll` nunca corrió, y quedaron filas de prueba en
  producción (y un contacto de prueba en el CRM real).
- **En un bucle de empresas**: el contexto de la empresa A puede seguir vivo cuando empieza la B.

> Para un request, la variante que abre-y-no-cierra está bien. Para un bucle, hay que usar la que
> **envuelve** la ejecución y cierra al terminar. Son dos funciones distintas a propósito.

### Dos pestañas del super admin, dos empresas, la última gana

La empresa que el super admin está mirando vive en **una columna de la sesión**. Con dos pestañas
abiertas en empresas distintas, la última elección manda para las dos — y **no falla**: la segunda
pestaña simplemente empieza a mostrar los datos de la otra empresa.

Está abierto hoy. Mitigado por el banner permanente que dice de qué empresa son los datos, que es
justamente para lo que existe.

> Si te importa el caso, la elección tiene que viajar por pestaña (un id de contexto en el request,
> validado contra los permisos de la sesión), no en una única columna.

---

## 3 · Las del login

### Buscar por la columna cruda cuando la unicidad es sobre `lower(email)`

El índice único es sobre `lower(email)`, pero la búsqueda del login usa la columna tal cual. Funciona
solo porque todos los caminos que crean cuentas guardan el email en minúsculas.

El día que una cuenta entre con una mayúscula —una carga manual, una migración, un script—, esa
persona **no puede entrar** y el mensaje va a decir "credenciales inválidas".

> La búsqueda tiene que usar la misma expresión que el índice.

### El contador de intentos se reinicia al bloquear

Al llegar al quinto fallo se bloquea 15 minutos **y el contador vuelve a cero**. Cuando el bloqueo
vence, el atacante tiene otros 5 intentos limpios.

Es una decisión defendible (evita que el bloqueo se vuelva permanente por fallos viejos), pero hay
que tomarla a propósito: si querés bloqueos crecientes, hace falta guardar la cantidad de bloqueos
además de la de intentos.

### El 429 por IP alimenta su propio contador

El rechazo por IP se registra con la misma acción que un login fallido, y el contador cuenta esa
acción. Mientras alguien siga golpeando, el bloqueo se sostiene solo.

Como defensa está bien; como diagnóstico confunde, porque el registro no distingue "intentó y falló"
de "ni lo dejamos intentar".

### La consulta del freno por IP no tiene índice que la sostenga

Filtra por acción + IP + fecha, y los índices de esa tabla son por fecha y por empresa. Con la tabla
chica no se nota. Con cien mil filas, cada intento de login hace un recorrido completo.

---

## 4 · Las del frontend

Ninguna es un problema de seguridad —el backend valida igual— pero todas confunden a quien las ve.

### Un 401 por el camino de Avanzar no devuelve a nadie al login

Hay **dos** clientes HTTP con manejo de error opuesto: uno lanza (y dispara el evento que manda al
login) y el otro devuelve `null` para que la aplicación siga con datos de ejemplo. Un 401 por el
segundo camino no echa a nadie: la sesión está vencida y la pantalla sigue como si nada.

### Un fallo de red se ve igual que "no hay sesión"

La consulta inicial de sesión captura cualquier error y responde "no autenticado". Sin internet, la
aplicación muestra la pantalla de login en vez de decir que no pudo preguntar.

> Es el mismo principio que la regla 3 del proyecto: `null` no puede significar "no hay" **y** "no
> pude averiguarlo".

### Un rol sin entrada en el menú deja al usuario en una pantalla que le rebota

Pasó con el rol de compra de medios: era asignable desde el panel y no tenía entrada de menú, así que
entraba a la primera vista disponible y le devolvía 403 completa.

> Todo rol asignable necesita al menos una pantalla, o no tiene que ser asignable.

### El mensaje "tu sesión venció" nunca se ve

Se lanza como error, pero el mismo 401 ya disparó el evento que desmonta la pantalla. El texto existe
y no llega a nadie.

### El tema visual cacheado no es por usuario

Se guarda en el almacenamiento del navegador para no parpadear al arrancar. En una máquina
compartida, el primer cuadro del próximo usuario usa el tema del anterior. Es imposible de arreglar
del todo: para saber de quién es el tema hay que preguntar al servidor, y para no parpadear hay que
pintar antes de preguntar.

---

## 5 · Las del entorno

Específicas de este hosting, pero el patrón se repite en otros.

- **Todo archivo bajo `api/` se publica como endpoint**, y el único filtro es un guion bajo en la
  ruta. Un test dentro de esa carpeta se publica **como endpoint ejecutable**. Los tests del backend
  van en una subcarpeta con guion bajo.
- **Los imports del backend necesitan la extensión del archivo compilado**, y no se puede importar
  una carpeta. El compilador no lo detecta: falla en ejecución sin decir cuál módulo.
- **Después de cualquier cambio de esquema hay que avisarle a la capa REST** que recargue. Sin eso, la
  primera escritura falla sobre una columna que existe.
- **Las variables de entorno se congelan al desplegar.** Agregar una exige volver a desplegar.
- **La función se mata al llegar al tope de duración, sin avisar.** Una tarea larga pierde el informe
  entero: cuántos elementos procesó, cuáles fallaron, dónde retomar. La solución es **cortar antes
  por cuenta propia** y reportar lo que quedó.

---

## 6 · La lección que las une

Casi todos los defectos serios de este proyecto tienen la misma forma:

> **Un éxito reportado que no ocurrió.**

Una nota que se pinta y no se guarda. Un tag que se aplica al agente equivocado. Un endpoint que
responde `200` con todos sus elementos fallados. Un contador que suma poblaciones distintas. Una
venta que muestra confeti y no escribe nada.

Ninguno lanzó una excepción. Ninguno rompió un test que ya existía. Todos se descubrieron mirando
datos reales y preguntando _"¿esto que dice la pantalla es cierto?"_.

De ahí salen las tres reglas que conviene llevarse:

1. **Si una escritura falla, la respuesta lo dice.** Siempre. Aunque sea accesoria, aunque no se
   pueda hacer nada al respecto.
2. **`null` significa una sola cosa.** Nunca "no hay" y "no pude averiguarlo" a la vez.
3. **Lo que no se puede probar, no se afirma.** Un cero medido y un cero por falta de datos se
   muestran distinto.

Y el corolario práctico: **verificá contra datos reales**. En este proyecto, la diferencia entre
"parece que anda" y "anda" apareció recién ahí, todas las veces.
