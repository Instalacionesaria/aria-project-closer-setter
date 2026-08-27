# 09 · Ingesta y reconciliación — el lado del servidor

**El documento más importante de la carpeta para replicar el consumo de recursos.** El `04` explica los
relojes del navegador; éste explica qué pasa del otro lado cuando esos relojes llaman.

La afirmación que hay que poder sostener al terminar:

> **Todo el equipo con la pantalla abierta todo el día cuesta lo mismo que una sola pestaña**, y el costo
> crece con la actividad de la cuenta, no con su tamaño.

---

## 1 · Las tres vías de entrada, y qué agujero tapa cada una

Ninguna sola alcanza. Están en orden de inmediatez.

| Vía                       | Latencia  | Qué trae                                      | Qué NO cubre                                                                      |
| ------------------------- | --------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| **1 · El webhook**        | Inmediata | El mensaje, el contacto o la cita del evento  | Lo que el CRM **no avisa**: automatismo apagado, despliegue a mitad, error de red |
| **2 · La reconciliación** | ~10 s     | Todo lo que **tuvo actividad** desde la marca | Lo que no cambió la fecha de la conversación                                      |
| **3 · Los crons**         | Horas     | Citas, etiquetas, territorio                  | —                                                                                 |

> **Los webhooks se pierden, y un contacto que se pierde no vuelve solo.** Ése es el motivo entero de que
> exista la vía 2: convierte el peor caso de un webhook caído en _"aparece tarde"_ en vez de _"no aparece
> nunca"_.

---

## 2 · El candado — la pieza central

Antes de gastar **una sola** llamada al CRM, la reconciliación intenta tomar un candado con **una única
sentencia**:

```
UPDATE  <fila de control>
   SET  ultima_reconciliacion = ahora()
 WHERE  ultima_reconciliacion < ahora() - <ventana>
RETURNING …
```

**Cero filas devueltas = otro proceso ya corrió hace menos que la ventana → se sale sin gastar nada.**

### Por qué UNA sentencia y no dos

**Es una actualización condicional, no una lectura seguida de una escritura.** Dos peticiones simultáneas
**no pueden ganar las dos**: la base serializa el `UPDATE`. Con leer-y-después-escribir, dos pestañas que
llegan en el mismo milisegundo **pasan las dos** y se gastan dos veces las llamadas.

### El número, y qué significa exactamente

| Constante               | Valor    |
| ----------------------- | -------- |
| **Ventana del candado** | **10 s** |

> **La cadencia del cliente NO es el límite de llamadas al CRM. Este número lo es.**

Es la palanca que hay que tener clara antes de que alguien pida "que sea más rápido": se puede bajar el
reloj del navegador de 10 a 5 segundos **sin tocar el presupuesto**. Lo único que cambia es cuántas veces
se intenta tomar el candado, y un intento fallido cuesta **una consulta a la base propia y nada más**.

> **Y el candado nace como una operación de la base, no como un update con filtros desde el cliente.** Un
> filtro armado del lado de la aplicación no garantiza la atomicidad que hace que esto funcione.

---

## 3 · La marca de agua — por qué el costo no crece con la cuenta

### El problema

El filtro por etiquetas del buscador de conversaciones del CRM **se ignora** —verificado—, así que **no se
puede pedir "solo las de mi territorio"**. Y la cuenta tiene del orden de **15.000 conversaciones**.

### La solución

El buscador devuelve las conversaciones **ordenadas por último mensaje, descendente**. Se camina la lista
**solo hasta cruzar la marca de agua** de la pasada anterior, y ahí se corta.

**El costo es O(actividad en los últimos 10 segundos), no O(tamaño de la cuenta).**

| Constante                 | Valor  | Qué significa                           |
| ------------------------- | ------ | --------------------------------------- |
| Conversaciones por página | **50** | Lo que se pide por llamada              |
| Tope de páginas           | **4**  | Máximo **200** conversaciones por ciclo |

El tope existe para acotar el peor caso: una ráfaga enorme no puede convertir un ciclo en decenas de
llamadas.

### Las tres invariantes que sostienen la reentrancia

No son evidentes leyendo el código, y **romper cualquiera pierde mensajes**.

**1 · La marca solo puede avanzar, y lo garantiza la base.** El paso se escribe como _"quedate con el
mayor entre lo que hay y lo que traigo"_, no como una asignación. Un proceso colgado que escribe tarde
**no puede hacerla retroceder**.

**2 · La marca se guarda al FINAL, y solo si el paso anterior completó.** Un abandono a mitad **nunca**
deja la marca adelantada sobre trabajo no hecho.

**3 · La lista de "lo que ya vi" es una foto tomada ANTES de las escrituras del ciclo.** Recargarla a
mitad haría que el ciclo **se auto-saltee**: vería como ya procesado lo que él mismo acaba de escribir.

> **Y la prohibición explícita: no se guarda una marca parcial cuando se agota el presupuesto.**
>
> La marca nueva se calcula **antes** de los filtros, así que cubre conversaciones que todavía no se
> procesaron. Guardarla las dejaría **detrás** de la marca y sus mensajes **se perderían para siempre**.
>
> Si hubo truncamiento, **el paso de la marca se saltea entero**. Y no se pierde el trabajo hecho: el
> progreso se guarda **contacto por contacto**, no en la marca.

---

## 4 · El presupuesto de tiempo — un deadline, no una carrera

La mitad que habla con el CRM tiene un presupuesto:

| Constante                            | Valor    |
| ------------------------------------ | -------- |
| **Presupuesto de la reconciliación** | **4 s**  |
| **Techo del endpoint**               | **15 s** |

El techo es una red de seguridad de la plataforma. **Lo que se ajusta es el presupuesto.**

### Por qué es un deadline cooperativo y no una carrera contra un temporizador

Una carrera **no cancela nada**. La mitad perdedora **seguiría corriendo** después de haber respondido, y
podría quedar congelada **entre dos escrituras** — perdiendo para siempre el evento de historial, la
cancelación del seguimiento y la reapertura de la tarea.

> **El deadline se consulta ENTRE conversaciones. Nunca corta a mitad de una.**

Es la diferencia entre "tardé de más" y "dejé el dato a medio escribir".

---

## 5 · El ciclo, paso a paso

Un solo endpoint hace las dos mitades. Antes eran dos relojes y dos peticiones; bajó de 12–13 a **unas 7
peticiones por minuto y por pestaña**.

```
1 · Tomar el candado           → si no se toma, salir. Costo: 1 consulta local
2 · INGESTA (habla con el CRM) → buscar por marca de agua, releer lo cambiado
3 · Cerrar mensajes en el aire → ver § 6
4 · Pasar la marca             → SOLO si el paso 2 completó
5 · COLAS (solo base propia)   → armar las cinco colas de Mi Día
6 · Responder                  → las colas, y qué pasó con la ingesta
```

### El orden importa, y se midió

**La ingesta va primero, en secuencia.** Con dos relojes separados estaban _en fase_ —el módulo de relojes
dispara al registrarse, y los dos se registraban en el mismo montaje—, así que **las colas leían la tabla
microsegundos antes de que la ingesta escribiera**.

|                                                   | Antes | Ahora    |
| ------------------------------------------------- | ----- | -------- |
| Un mensaje entrante tarda en aparecer en el Buzón | ~15 s | **~6 s** |

> **El alcance de esa mejora, dicho con precisión:** aplica al **Buzón**, que depende de la fecha del
> último entrante. **A Urgentes no**, porque depende de las etiquetas cacheadas y la ingesta de mensajes
> **no refresca etiquetas**. Ésas las mantiene un cron aparte.

### La regla de admisión, que hay que defender

Un endpoint que corre "todo lo del reloj de 10 segundos" **atrae cada agregado futuro**, y cada agregado
hereda la latencia máxima y el radio de explosión completo.

> **Como mucho UNA mitad que toque el CRM por ciclo. Todo lo demás tiene que ser más barato que un viaje
> de ida y vuelta.**

---

## 6 · La pasada que cierra los mensajes en el aire

Un caso que ni el webhook ni la marca de agua cubren, y que **sin esto queda roto para siempre**.

> **Un mensaje saliente que el canal rechaza minutos después NO cambia la fecha de la conversación.**

La reconciliación solo relee conversaciones con actividad **nueva**, así que ese mensaje **quedaría en
"enviando" eternamente**.

La pasada extra relee **solo** conversaciones con salientes sin resolver de la última hora, **con tope de
2 por ciclo**.

### Y excluye los identificadores fabricados

Cuando el canal no manda identificador de mensaje, el webhook **inventa uno** con un prefijo reconocible.
Esos **no existen del lado del CRM**, así que sin excluirlos **la consulta nunca se vaciaría**: costaría
**2 llamadas por ciclo, para siempre, sin resolver nada**.

Es el tipo de defecto que no rompe nada y gasta presupuesto indefinidamente — el más difícil de notar.

---

## 7 · La deduplicación: el mismo mensaje por dos vías

El webhook y la reconciliación traen **el mismo mensaje**, y hay que reconocerlo como uno solo.

El problema es que **no siempre comparten identificador**: cuando el canal no lo manda, el webhook fabrica
uno. Así que la comparación no puede ser solo por identificador.

| Criterio                                     | Ventana        |
| -------------------------------------------- | -------------- |
| Mismo identificador                          | Siempre        |
| Misma dirección, mismo texto y fecha cercana | **10 minutos** |

La ventana de gemelo existe porque las dos vías pueden diferir unos segundos en la fecha. Demasiado
angosta, entran duplicados; demasiado ancha, se colapsan dos mensajes idénticos legítimos —por eso la
comparación **cuenta copias, no presencia**.

---

## 8 · Los crons — lo que corre sin nadie mirando

Independientes del navegador: corren **aunque nadie tenga la aplicación abierta**.

| Cron                       | Cadencia           | Qué hace                                                        |
| -------------------------- | ------------------ | --------------------------------------------------------------- |
| **Respaldo de citas**      | Dos veces por hora | Reconcilia las citas y refresca los contactos con cita próxima  |
| **Respaldo de territorio** | Cada 2 horas       | **Relee las etiquetas**, mantiene el congelado y la pertenencia |
| **Auditor diario**         | Una vez al día     | Un patrón por empresa y por día, como máximo                    |
| **Respaldo de métricas**   | Una vez al día     | Las métricas de la plataforma de anuncios                       |

### Por qué existe el de territorio, con el número que lo justificó

Se compararon las etiquetas de la caché contra el CRM: **de 22 contactos, 10 divergían** — y siempre en la
misma dirección, faltaban en la caché.

El webhook refresca **un** contacto por evento, lo que tapa el caso frecuente. Pero **una etiqueta
aplicada por un automatismo que no dispara webhook no tenía ninguna vía de entrar**, y lo único que releía
el conjunto corría solo cuando alguien apretaba un botón.

> Y era decisivo para el otro módulo del producto: sus contactos llegan **por ese barrido y por ninguna
> otra vía**. Sin el cron, el día que se publicaran sus automatismos los contactos **no habrían aparecido**
> hasta que alguien apretara el botón — con las pantallas vacías y **ninguna señal de por qué**.

---

## 9 · El presupuesto completo, en una tabla

Lo que cuesta cada cosa. **Es la tabla que hay que mirar antes de agregar cualquier reloj.**

| Operación                                      | Llamadas al CRM                                           |
| ---------------------------------------------- | --------------------------------------------------------- |
| **Ciclo en reposo**                            | **1** (la búsqueda por marca de agua)                     |
| Ciclo con actividad                            | 1 + 1 por conversación cambiada                           |
| Cerrar mensajes en el aire                     | 0 en reposo · hasta **2** mientras haya algo sin resolver |
| Abrir una ficha                                | **1**                                                     |
| Enviar un mensaje                              | 1 · **0** si la ventana de respuesta está cerrada         |
| Sincronizar a mano                             | 2 + 1 por contacto activo. **Los congelados cuestan 0**   |
| Cron de citas                                  | 1 + 1 por contacto nuevo, por empresa                     |
| Cron de territorio                             | 2 + 1 por contacto activo, por empresa                    |
| **Mi Día · Pipeline · Agenda · Inicio · Chat** | **0** — todo sale de la caché                             |
| **Estadísticas**                               | **0** — agregación por consulta sobre la base propia      |

**La penúltima fila es el diseño entero.** Las pantallas que el closer mira todo el día cuestan cero. El
presupuesto se gasta en **traer** los datos, una vez, en el momento en que cambian.

### El orden de magnitud, para dimensionar

Con el cron de territorio en su cadencia y su tope, el barrido de etiquetas de una empresa consume del
orden de **1.200 llamadas por día**: alrededor del **0,6 %** del presupuesto disponible. Es el número que
conviene tener a mano cuando alguien propone subir una cadencia.

---

## 10 · Multiempresa: una advertencia que no es opcional

Cada ciclo, cada cron y cada webhook corre **en el contexto de una empresa**, con sus credenciales.

> **Ninguna consulta corre sin empresa activa.** La capa de datos la saca del contexto y **lanza** si no
> hay ninguna.

Y hay una consecuencia que muerde en los crons: los que recorren **varias** empresas tienen que **abrir y
cerrar** el contexto en cada vuelta. Con una primitiva que "entra" y no cierra, **el contexto de la
primera empresa puede seguir vivo cuando empieza la segunda** — y la segunda escribe en la cuenta externa
de la primera, sin que nada falle.

---

## Lista de verificación

1. **Tres vías** de entrada, y el barrido es la garantía contra webhooks perdidos.
2. El candado es **una** sentencia condicional, no lectura + escritura.
3. **Ventana de 10 s**: N pestañas cuestan como una.
4. La **cadencia del cliente no es el límite**; el candado lo es.
5. Marca de agua con **50 por página y tope de 4 páginas**.
6. La marca **solo avanza**, se guarda **al final**, y **nunca parcial**.
7. La foto de "lo ya visto" se toma **antes** de las escrituras del ciclo.
8. Presupuesto de **4 s** como **deadline cooperativo**, cortando **entre** conversaciones.
9. **Ingesta primero, colas después**, en secuencia.
10. **Una sola mitad** toca el CRM por ciclo.
11. La pasada de cierre tiene **tope de 2** y **excluye los identificadores fabricados**.
12. Deduplicación por identificador **y** por gemelo dentro de **10 minutos**.
13. Las pantallas de todos los días cuestan **cero**.
14. Todo corre **con empresa activa**, y los recorridos por empresa **abren y cierran** el contexto.
