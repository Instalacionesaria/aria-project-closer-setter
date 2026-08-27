# 04 · El polling — cómo se mantiene todo el Closer en vivo

Cómo la pantalla se mantiene fresca sin fundir el presupuesto de llamadas al CRM.

**La respuesta corta:** cuatro relojes en el frontend, todos registrados en **un solo módulo**, y del
lado del servidor un candado que hace que **N pestañas cuesten lo mismo que una**.

---

## 1 · Un solo módulo de relojes, y por qué

Antes había **ocho `setInterval` sueltos repartidos en cuatro archivos**, cada uno golpeando al CRM cada
10–30 segundos **incluso con la pestaña oculta**.

Ahora todo reloj se registra en un módulo que garantiza dos cosas que ningún reloj suelto puede
garantizar por sí mismo:

### Garantía 1 · Pestaña oculta = cero intervalos corriendo

**Un solo escuchador** del evento de visibilidad pausa y reanuda todos. Y al volver, **cada reloj dispara
una vez de inmediato**: el usuario que vuelve a la pestaña quiere ver fresco, no esperar al próximo
ciclo.

Con relojes sueltos, cada uno necesitaría su propia lógica de pausa — y el que se olvide sigue gastando
con la pestaña en segundo plano, que es la mitad del día.

### Garantía 2 · Un reloj por clave

Registrar dos veces la misma clave **reemplaza** el anterior. Así **dos montajes del mismo componente no
duplican el tráfico**, que es lo que pasa cuando un componente se monta dos veces por una navegación o
un re-render.

### Y una tercera, del lado del que consume

**Guard de "en vuelo".** El reloj es un intervalo crudo: si un ciclo tarda más que el intervalo, el
siguiente arranca encima. El reloj principal lleva una marca de "ya hay uno corriendo" y **se saltea el
ciclo** en vez de acumularlos.

Sin ese guard, una respuesta lenta se convierte en una avalancha: dos, cuatro, ocho peticiones en vuelo,
cada una más lenta que la anterior.

> **Nota de diseño que conviene conservar:** este módulo está encapsulado a propósito para que el día que
> se active una suscripción en tiempo real, **el frontend deje de tener relojes cambiando un solo
> archivo**. Los relojes son la solución de hoy, no la arquitectura.

---

## 2 · Los números, todos juntos

**Ésta es la tabla que hay que replicar igual.** Cada valor tiene un motivo, y cambiarlo tiene una
consecuencia medible.

| Constante                             | Valor      | Qué pasa si se toca                                                   |
| ------------------------------------- | ---------- | --------------------------------------------------------------------- |
| **Reloj principal** (ingesta + colas) | **10 s**   | Más rápido **no cuesta más llamadas** — lo limita el candado, no esto |
| Reloj del chat                        | **5 s**    | Solo con la ficha abierta en ese tab                                  |
| Reloj del tablero                     | **60 s**   | Son métricas del mes: más rápido redibuja lo mismo                    |
| **Ventana del candado del servidor**  | **10 s**   | **ESTE es el límite real de llamadas al CRM**                         |
| Presupuesto de la ingesta             | **4 s**    | Deadline cooperativo, no una carrera                                  |
| Techo del endpoint                    | **15 s**   | Red de seguridad de la plataforma, no la perilla                      |
| Conversaciones por página             | **50**     | Lo que se pide por llamada                                            |
| Tope de páginas por ciclo             | **4**      | Máximo **200** conversaciones por ciclo                               |
| Tope de la pasada de cierre           | **2**      | Conversaciones con salientes sin resolver, por ciclo                  |
| Ventana de deduplicación              | **10 min** | Para reconocer el mismo mensaje llegado por dos vías                  |

> **La fila que hay que entender antes que ninguna:** el reloj del navegador y el límite de llamadas al
> CRM son **dos números distintos**. El primero decide cuántas veces se **pregunta**; el segundo, cuántas
> veces se **gasta**. Confundirlos lleva a bajar la frecuencia de la pantalla creyendo que se ahorra, y a
> empeorar la experiencia sin ahorrar nada.

El detalle de qué hace el servidor con cada uno de esos números está en el documento
[`09`](09-INGESTA-Y-RECONCILIACION.md).

---

## 3 · Los cuatro relojes

Una sola tabla de cadencias, en un solo lugar, **para que nadie invente la suya**.

| Reloj                         | Cada     | Corre cuando                             | Qué trae                                             |
| ----------------------------- | -------- | ---------------------------------------- | ---------------------------------------------------- |
| **El principal**              | **10 s** | El módulo Closer está abierto            | Ingesta desde el CRM **+** las cinco colas de Mi Día |
| El del **chat**               | 5 s      | Hay una ficha abierta **en el tab Chat** | Mensajes y el estado de la ventana de respuesta      |
| El de **Inicio**              | 60 s     | El tab Inicio está a la vista            | Las métricas del tablero                             |
| El de **urgentes del setter** | 60 s     | El módulo Setter está abierto            | Su cola roja                                         |

### Y lo que NO tiene reloj, a propósito

| Qué                  | Cómo se actualiza                                              |
| -------------------- | -------------------------------------------------------------- |
| **El Pipeline**      | Al montar, al recuperar el foco, y **después de cada Avanzar** |
| **La Agenda**        | Al montar, al recuperar el foco, y con **el botón Refrescar**  |
| **El auditor de IA** | Lo dispara el **webhook** cuando entra o sale un mensaje       |

**El Pipeline y la Agenda no necesitan reloj** porque su dato no cambia solo: la etapa vive en la base
propia y solo la mueve un Avanzar; las citas las mantienen el webhook y un cron. Un reloj ahí sería
tráfico sin información nueva.

**El auditor no puede tener reloj**: colgarlo de un intervalo convertiría **cada ciclo con actividad en
una llamada al modelo de lenguaje**. Va por evento, y solo por evento.

---

## 4 · El reloj principal, que hace dos cosas en una petición

Antes eran **dos relojes y dos peticiones**: uno para traer datos del CRM, otro para leer las colas.
Ahora es una sola llamada que hace las dos mitades. Bajó de 12–13 a **unas 7 peticiones por minuto y por
pestaña**.

### Corre en secuencia, y el orden importa

**Primero la ingesta, después las colas.** Con dos relojes separados estaban _en fase_ —el módulo dispara
al registrarse, y los dos se registraban en el mismo montaje—, así que **las colas leían la tabla
microsegundos antes de que la ingesta escribiera**.

Resultado medido: un mensaje entrante tardaba **un ciclo entero** en aparecer en el Buzón, unos 15
segundos. Ahora, unos 6.

> **El alcance de esa mejora, dicho con precisión:** aplica al **Buzón**, que depende de la fecha del
> último entrante. **A Urgentes no**, porque depende de los tags cacheados y la ingesta de mensajes no
> refresca tags. Los tags los mantiene otro cron.

### El presupuesto es un deadline cooperativo, no una carrera

La mitad que habla con el CRM tiene un presupuesto de tiempo (unos 4 segundos). Y está implementado como
un **deadline que se consulta entre conversaciones**, no como una carrera contra un temporizador.

**Por qué importa la diferencia:** una carrera **no cancela nada**. La mitad perdedora seguiría corriendo
después de haber respondido, y podría quedar congelada entre dos escrituras — perdiendo para siempre el
evento de historial, la cancelación del seguimiento y la reapertura de la tarea.

El deadline corta **entre** conversaciones, **nunca a mitad de una**.

### La regla de admisión, que hay que defender

Un endpoint que corre "todo lo del reloj de 10 segundos" **atrae cada agregado futuro**, y cada agregado
hereda la latencia máxima y el radio de explosión completo.

> **Como mucho UNA mitad que toque el CRM. Todo lo demás tiene que ser más barato que un viaje de ida y
> vuelta.**

---

## 5 · El candado del servidor — N pestañas cuestan lo mismo que una

Es la pieza que hace que todo lo anterior sea sostenible.

Antes de gastar una sola llamada al CRM, la ingesta intenta tomar un candado con una **única sentencia**:

```
UPDATE … SET ultima_reconciliacion = now()
 WHERE ultima_reconciliacion < now() - <ventana>
RETURNING …
```

**Cero filas devueltas = otro proceso ya corrió hace menos que la ventana → se sale sin gastar ni una
llamada.**

**Es una actualización condicional, no una lectura seguida de una escritura.** Dos peticiones
simultáneas **no pueden ganar las dos**: la base serializa. Con leer-y-después-escribir, dos pestañas
que llegan al mismo milisegundo pasan las dos.

### La consecuencia que hay que entender bien

> **La cadencia del cliente NO es el límite de llamadas al CRM. El candado lo es.**

Se puede mover el reloj de 10 a 5 segundos **sin tocar el presupuesto**: lo único que cambia es cuántas
veces se intenta tomar el candado, y un intento fallido cuesta una consulta a la base propia.

Es la perilla que hay que tener clara antes de que alguien pida "que sea más rápido".

---

## 6 · La marca de agua — por qué el costo no crece con la cuenta

El filtro por tags del buscador del CRM **se ignora** —está verificado—, así que **no se puede pedir
"solo los de mi territorio"**.

La solución: el buscador devuelve las conversaciones **ordenadas por último mensaje, descendente**, y se
camina la lista **solo hasta cruzar la marca de agua** de la última pasada.

**El costo es proporcional a la actividad de los últimos 10 segundos, no al tamaño de la cuenta** — que
son unas 15.000 conversaciones.

### Las tres invariantes que sostienen la reentrancia

No son evidentes leyendo el código, y **romper cualquiera pierde mensajes**:

1. **La marca solo puede avanzar, y eso lo garantiza la base**, no el código que la escribe. Un proceso
   colgado que escribe tarde **no puede hacerla retroceder**.
2. **La marca se guarda al final, y solo si el paso anterior completó.** Un abandono a mitad **nunca**
   deja la marca adelantada sobre trabajo no hecho.
3. **La lista de "lo que ya vi" es una foto tomada ANTES de las escrituras del ciclo.** Recargarla a
   mitad haría que el ciclo se auto-saltee: vería como "ya procesado" lo que él mismo acaba de escribir.

> **Prohibido: guardar una marca parcial cuando se agota el presupuesto.** La marca nueva se calcula
> **antes** de los filtros, así que cubre conversaciones que todavía no se procesaron. Guardarla las
> dejaría **detrás** de la marca y sus mensajes se perderían **para siempre**.
>
> Si hubo truncamiento, **el paso de la marca se saltea entero**. Y no se pierde el trabajo hecho: el
> progreso se guarda **contacto por contacto**, no en la marca.

---

## 7 · La pasada que cierra los mensajes en el aire

Un caso que la marca de agua no cubre, y que sin esto queda roto para siempre.

La ingesta solo relee conversaciones con actividad **nueva**. Pero **un mensaje saliente que el canal
rechaza minutos después no cambia la fecha de la conversación** — así que su estado quedaría en
"enviando" eternamente.

Por eso hay una pasada extra que relee **solo** conversaciones con salientes sin resolver de la última
hora, con **tope de 2 por ciclo**.

**Y excluye los identificadores fabricados.** Cuando el canal no manda identificador de mensaje, el
webhook inventa uno. Esos no existen del lado del CRM, así que **la consulta nunca se vaciaría**:
costaría 2 llamadas por ciclo, para siempre, sin resolver nada.

---

## 8 · Los relojes del servidor

Independientes del frontend: corren **aunque nadie tenga la aplicación abierta**.

| Cron                       | Cada               | Qué hace                                                                 |
| -------------------------- | ------------------ | ------------------------------------------------------------------------ |
| **Respaldo de citas**      | Dos veces por hora | Reconcilia las citas y refresca los contactos con cita próxima           |
| **Respaldo de territorio** | Cada 2 horas       | **Relee los tags**, mantiene el congelado y la pertenencia al territorio |
| **Auditor diario**         | Una vez al día     | Como máximo un patrón por empresa y por día                              |
| **Respaldo de métricas**   | Una vez al día     | Las métricas de la plataforma de anuncios                                |

### Por qué existe el de territorio, con el número que lo justificó

Se compararon los tags de la caché contra el CRM: de 22 contactos, **10 divergían** — y siempre en la
misma dirección, faltaban en la caché.

Lo único que releía el conjunto corría **solo cuando alguien apretaba un botón**. El webhook refresca un
contacto por evento, lo que tapa el caso frecuente; pero **un tag aplicado por un automatismo que no
dispara webhook no tenía ninguna vía de entrar**.

> Y era decisivo para el otro módulo: sus contactos llegan **por ese barrido y por ninguna otra vía**. Sin
> el cron, el día que se publicaran sus automatismos los contactos no habrían aparecido hasta que alguien
> apretara el botón — con las pantallas vacías y **ninguna señal de por qué**.

---

## 9 · El presupuesto, en una tabla

Lo que cuesta cada cosa en llamadas al CRM. Es la tabla que hay que mirar antes de agregar cualquier
reloj.

| Operación                                  | Costo                                                           |
| ------------------------------------------ | --------------------------------------------------------------- |
| Ciclo en reposo                            | **1** llamada (la búsqueda por marca de agua)                   |
| Ciclo con actividad                        | 1 + 1 por conversación cambiada                                 |
| Cerrar mensajes en el aire                 | 0 en reposo · hasta 2 mientras haya algo sin resolver           |
| Abrir una ficha                            | 1                                                               |
| Enviar un mensaje                          | 1 · **0 si la ventana de respuesta está cerrada** (corta antes) |
| Sincronizar a mano                         | 2 + 1 por contacto activo. **Los congelados cuestan 0**         |
| Cron de citas                              | 1 + 1 por contacto nuevo, por empresa                           |
| Cron de territorio                         | 2 + 1 por contacto activo, por empresa                          |
| **Mi Día, Pipeline, Agenda, Inicio, Chat** | **0** — todo sale de la caché                                   |
| **Estadísticas**                           | **0** — es agregación por consulta sobre la base propia         |

**La fila que resume el diseño es la penúltima.** Las cuatro pantallas que el closer mira todo el día
cuestan **cero**. Todo el presupuesto se gasta en **traer** los datos, una vez, y en el momento en que
cambian.

---

## Lista de verificación

1. **Un solo módulo** registra todos los relojes del frontend.
2. **Pestaña oculta = cero intervalos**, y un disparo inmediato al volver.
3. **Un reloj por clave**: dos montajes no duplican el tráfico.
4. **Guard de "en vuelo"** en el reloj principal: los ciclos se saltean, no se acumulan.
5. **Una sola tabla de cadencias**, y nadie define la suya.
6. El reloj principal hace las dos mitades **en secuencia**, ingesta primero.
7. El presupuesto de tiempo es un **deadline cooperativo**, y corta entre conversaciones.
8. **Como mucho una mitad que toque el CRM** por ciclo.
9. El candado es una **actualización condicional**: N pestañas cuestan como una.
10. **La cadencia del cliente no es el límite de llamadas.** El candado lo es.
11. La marca de agua **solo avanza**, se guarda **al final**, y **nunca** parcial.
12. **Pipeline, Agenda y auditor sin reloj**: por evento y por acción.
13. Las pantallas que se miran todo el día cuestan **cero** llamadas al CRM.
