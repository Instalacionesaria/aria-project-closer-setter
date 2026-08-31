# 05 · Los portones y el debounce — cuándo se gasta plata

**Cada portón evita gasto, y van en orden de más barato a más caro de evaluar.**

Es la parte que más fácil se rehace mal, porque **un portón de menos no falla: solo factura**.

---

## 1 · Los cinco portones del chat

| #   | Portón                                 | Qué pregunta                                                                  |
| --- | -------------------------------------- | ----------------------------------------------------------------------------- |
| 1   | **Territorio**                         | ¿De qué etapa es este contacto? Sin territorio, no se sabe qué trabajo juzgar |
| 2   | **El agente está atendiendo**          | ¿Está activo **el agente que voy a juzgar**?                                  |
| 3   | **No está ya marcado**                 | ¿Ya tiene un fallo abierto? Entonces ya está en la cola                       |
| 4   | **El debounce**                        | ¿Hay suficiente conversación nueva para juzgar?                               |
| 5   | **Hay al menos un mensaje DEL AGENTE** | Los **hechos**, no las etiquetas                                              |

Y uno más, justo antes de la línea que gasta: **¿este auditor está encendido?**

### El portón 5 no es redundante con el 2, y ésa es la lección

> **Una etiqueta puede mentir.** Quedó puesta, el automatismo no corrió, alguien la editó a mano.
>
> **Sin una sola línea del agente en la conversación no hay nada que auditar, diga lo que diga la
> etiqueta.**

Es el portón que cierra el falso positivo original: sin él, el criterio **"la IA dejó de responder"**
se cumple **siempre** que no hay agente — y le imputaba al agente su propia ausencia.

### El portón 2 pregunta por el agente correcto, no por "algún agente"

Desde que hay una etiqueta de activado **por agente**, el portón cambió de pregunta:

> No es _"¿hay un agente atendiendo?"_ sino _"¿está atendiendo **el que voy a juzgar**?"_

**El caso que lo hace obligatorio:** durante el traspaso entre etapas, un contacto puede llevar el
territorio de una y la etiqueta de agente activo **de la otra**. Un portón que pregunte por "algún
agente" **audita al equivocado**.

### Y el portón 2 tiene una escotilla, con el default del lado correcto

Existe una forma de saltearlo, para poder probar mientras los automatismos del CRM todavía no aplican
las etiquetas de activado.

> **Se enciende con una variable de entorno, y el default está en apagado.**
>
> El motivo lo enseñó este mismo producto: cuando el default era "salteado salvo que la variable diga
> lo contrario", **el modo de prueba se volvía a encender solo** en cualquier entorno donde la
> variable no estuviera — un preview, un clon local, un proyecto nuevo.
>
> **Activar una prueba tiene que costar trabajo; desactivarla, no.**

Y hay una segunda forma, distinta: **la corrida en seco**. Evalúa y devuelve el veredicto **sin
escribir nada** —ni etiqueta, ni nota, ni fila—. Saltea el portón 2 y **no saltea el 5**, que es el
chequeo factual.

### Una sola definición de "el agente atiende"

Los dos carriles —el rojo y el amarillo— la comparten.

> El carril amarillo nació **copiando** el filtro, y contra datos reales eso matcheaba **cero
> contactos**: el cron habría corrido todos los días devolviendo "sin conversaciones" **sin que nada
> fallara**. El mismo modo de falla que los prompts que no existían mientras el panel reportaba éxito.

**Dos definiciones del mismo hecho divergen en silencio.**

---

## 2 · Los cuatro portones de la voz, que son otros

| #   | Portón                                     | Por qué                                                       |
| --- | ------------------------------------------ | ------------------------------------------------------------- |
| 1   | **La llamada fue contestada**              | Sin conversación no hay nada que auditar. Es el filtro gratis |
| 2   | **El agente está identificado**            | Un origen sin agente conocido **no se audita**                |
| 3   | **El auditor está encendido**              | Existe ≠ está encendido                                       |
| 4   | **No hay análisis previo de esta llamada** | El webhook reintenta                                          |

Y uno más: **si no hay transcripción, no hay qué leer.**

**No hay debounce en voz, y es correcto:** una llamada **ya es una conversación completa** con
principio y fin. El disparo es uno a uno con el evento.

**Y el candado tampoco se comparte**, porque el del chat es **por contacto**: usarlo haría que una
llamada y un mensaje simultáneos del mismo contacto **se descartaran mutuamente**. El candado natural
de la voz es su propia deduplicación por llamada.

---

## 3 · El debounce: no hay contador, se resta

> **La regla: esperar a que el agente mande 5 mensajes y recién ahí auditar la conversación completa,
> con contexto.**

```
delta = (mensajes del agente AHORA) − (ese mismo conteo guardado en el último análisis)
```

### Por qué una resta y no una columna que se incrementa

Una columna incremental sería más directa **y peor**:

| Problema de la columna                                                    |
| ------------------------------------------------------------------------- |
| Se desincroniza con una carga masiva de históricos                        |
| Se desincroniza con el borrado de mensajes duplicados que hace la ingesta |
| Hay que acordarse de escribirla en todos los caminos                      |

> **La resta se auto-cura**: las dos puntas salen de la misma fuente, así que si aparecen o
> desaparecen mensajes, **se mueven juntas**.

### Y no se cuenta contra el CRM

Serían **dos llamadas por evento incluso cuando la respuesta es "no analizar"**, y el presupuesto del
CRM es más escaso que los centavos del modelo.

### El ahorro, medido

**Una conversación de 20 mensajes con 10 del agente pasa de ~20 llamadas al modelo a ~2.**

### Un detalle que ya rompió el debounce una vez

**La línea base solo la fijan los análisis de CHAT.** Sin ese filtro, el primer análisis de **voz** del
contacto —que no participa de este conteo— se volvía "el análisis más reciente" y **reseteaba la línea
base a cero**: el chat se re-analizaba de más en cada mensaje.

**La unidad de este debounce son mensajes de chat. La voz no participa.**

---

## 4 · El candado: antes de gastar, y no se libera al terminar

Los eventos de mensaje entrante y saliente **llegan casi juntos todo el tiempo**, y los dos verían el
mismo delta.

| Regla                             |
| --------------------------------- |
| Se toma **antes** de gastar       |
| Dura **120 segundos**             |
| **No se libera al terminar**      |
| Es **por empresa y por contacto** |

> **No liberarlo es deliberado.** Si el análisis explota, la resta **sigue por encima del umbral** y
> el próximo mensaje reintenta solo. Liberarlo en caliente abriría un bucle de reintentos justo
> cuando el CRM o el proveedor del modelo están fallando.

**Y la clave lleva la empresa.** Sin eso, dos empresas que tuvieran el mismo contacto **compartían una
sola ranura** y una de las dos se quedaba sin auditar en silencio. El candado tiene que **fallar
cerrado**.

---

## 5 · El arranque en frío

Un contacto que ya tenía 30 mensajes cuando se encendió el auditor **supera el umbral de una**.

| Situación                       | Qué se hace                                                             |
| ------------------------------- | ----------------------------------------------------------------------- |
| La conversación está **viva**   | Se audita — es lo que se quiere: un veredicto sobre lo que está pasando |
| Lleva **más de 14 días muerta** | **Se siembra la línea base sin llamar al modelo**                       |

La siembra es **una fila que no es un análisis**: es la marca de dónde arrancar a contar. Va sin nivel,
sin resumen y sin observaciones.

> **Inventarle un resumen llenaría la vitrina de filas que dicen algo sobre nada.** Y por eso las
> vitrinas la excluyen explícitamente.

---

## 6 · El nivel 0: el agujero del debounce, y cómo se cierra gratis

> **El agujero, dicho en voz alta:** una conversación donde el agente manda **4** mensajes y el
> contacto se va enojado **nunca se audita**. Es consecuencia matemática de la regla, y es el caso que
> más duele.

Antes de rendirse, el debounce corre **cinco señales de costo cero** sobre la caché propia —**no sobre
el CRM ni sobre el modelo**— y si alguna levanta, adelanta el análisis.

| Señal                   | Qué mira                                                                       |
| ----------------------- | ------------------------------------------------------------------------------ |
| **Frustración léxica**  | El contacto se quejó, **en sus 3 mensajes más recientes**                      |
| **Intención de pago**   | Quiere pagar o comprar **ahora**                                               |
| **Pregunta repetida**   | Repitió sustancialmente la misma pregunta, **no en mensajes contiguos**        |
| **El agente se repite** | Mandó dos mensajes casi idénticos                                              |
| **El contacto se fue**  | Último mensaje del agente + **60 min** de silencio, **habiendo hablado antes** |

**El portón queda:**

```
delta ≥ 5        →  corre (el debounce de siempre)
delta ≥ 1 + alarma →  corre (adelantado por el nivel 0)
delta = 0        →  no corre, ni con alarma
```

### El piso de `delta ≥ 1` es lo que evita el bucle

> **Una alarma no se consume:** la queja sigue en los 3 mensajes recientes **después** de que el
> análisis corrió. Sin el piso, la conversación alarmada se re-analizaría **en cada mensaje entrante**
> hasta que la queja envejezca — y el debounce ya no la frena, porque la alarma es justo lo que lo
> saltea.
>
> **El criterio: esto audita AL AGENTE. Si el agente no dijo nada nuevo, el veredicto anterior ya
> cubre lo que hay.**

### Las señales no juzgan: solo adelantan el momento de mirar

El veredicto lo sigue dando el modelo, con su cita textual y su regla de atribución. **Si una
heurística se equivoca, el costo es una inferencia de más — nunca una etiqueta mal puesta.**

Por eso están calibradas para **errar hacia mirar**: un falso positivo cuesta centavos, un falso
negativo es un lead maltratado que nadie ve.

### Y cada análisis guarda cuál lo adelantó

Para poder **medir cuál sirve**: una señal que dispara seguido y **nunca** termina en rojo es gasto, y
sin ese dato no hay forma de saberlo. Se guarda `null` cuando salió por el debounce normal —**no una
lista vacía**—, porque "nadie miró alarmas" y "se miraron y no había" no son el mismo hecho.

### Las cinco valen para las dos etapas, y hay un argumento

Podría parecer que las señales de pago solo aplican post-agenda. **Aplican en pre-agenda con más
urgencia:**

> En post-agenda, alguien que dice "quiero pagar" **ya tuvo su llamada de venta**: hay un humano que
> lo conoce y que va a retomar. En pre-agenda no: es un lead que **todavía nadie atendió** diciéndole
> a un bot que quiere comprar. **Si el bot no entiende, no hay nadie mirando.**

---

## 7 · El léxico, en tres reglas

| #   | Regla                                                                |
| --- | -------------------------------------------------------------------- |
| 1   | **Todo va normalizado**: minúsculas, **sin acentos**, sin puntuación |
| 2   | Se compara **la expresión rodeada de espacios**, no como substring   |
| 3   | Solo se miran **los 3 mensajes más recientes del contacto**          |

La segunda evita que `caro` matchee dentro de `carozo`. La tercera evita que un "esto no me sirve" de
hace dos semanas, ya resuelto, sea una alarma de ahora.

### La regla para agregar un término

> **Si podés imaginarlo en una conversación que va bien, no va.**

Un término demasiado común **alarma siempre, y eso equivale a no tener alarma**.

### Lo que quedó afuera a propósito

| Término                   | Por qué no                                                               |
| ------------------------- | ------------------------------------------------------------------------ |
| `no`, `pero`, `todavía`   | Aparecen en cualquier conversación                                       |
| `precio`, `cuánto cuesta` | **Es la pregunta normal del embudo**, no una señal                       |
| `caro`                    | Ambiguo: puede ser una objeción sana que el agente maneja bien           |
| `urgente`                 | Lo usa el que tiene apuro por comprar tanto como el enojado              |
| Insultos sueltos          | En varios países son muletillas sin carga: van las expresiones completas |

**Las variantes de "vos" y de "tú" van las dos**, a propósito: el producto se vende en varios países.

### Y la lista tiene una prueba que la ata a su documento

**Un test verifica que el documento del léxico y el código digan lo mismo.** Dos listas que se separan
es exactamente lo que este producto ya pagó caro.

---

## 8 · Cómo se comparan dos textos, sin dependencias

Las dos señales de repetición necesitan medir parecido. Se usa **solapamiento de palabras**
—normalizadas, sin palabras vacías, con un umbral de 0,6—:

> Barato, sin dependencias, y suficiente para detectar la misma pregunta reformulada sin marcar dos
> preguntas distintas del mismo tema. **Se descartó la distancia de edición**: es cuadrática por par, y
> acá se compara cada mensaje contra los demás.

**Y las palabras vacías hay que quitarlas**: sin eso, dos preguntas cualesquiera comparten "el", "de",
"que".

### Un detalle que cazó una prueba

**La contigüidad se mide sobre la conversación COMPLETA, no sobre los mensajes del contacto.** Dos
mensajes seguidos del contacto suelen ser **una frase partida en dos**, no una repetición. Pero
midiendo índices dentro de la lista filtrada, **dos preguntas separadas por una respuesta del agente
—que es justo el caso a detectar— quedaban "contiguas" y no se comparaban nunca.**

---

## 9 · Y el que hace falta cuando el análisis corre adentro de un webhook

**Un análisis pesado adentro de un evento entrante puede morir por tiempo de ejecución.** Cuando eso
pasa, muere **sin dejar rastro**: no hay fila, no hay error guardado, y el único lugar donde se habría
dicho algo es el cuerpo de una respuesta HTTP que el emisor descarta.

> **Subir el techo de tiempo no alcanza: mueve el techo, no crea el reintento.**

Por eso hay **un barrido programado de respaldo** que busca lo que quedó sin analizar. Y trae dos
reglas que conviene copiar:

| Regla                                                                                   |
| --------------------------------------------------------------------------------------- |
| **Tope chico y por empresa** — acá cada elemento del barrido es **una inferencia paga** |
| **Si quedaron más, la respuesta lo dice**                                               |

> **Un barrido que se guarda para sí que dejó cosas afuera se lee como "ya está todo auditado".**

---

## Lista de verificación

1. **Cinco portones en chat**, del más barato al más caro.
2. El portón de los **hechos** no es redundante con el de las etiquetas: **una etiqueta puede mentir**.
3. El portón pregunta por **el agente que se va a juzgar**, no por "algún agente".
4. La escotilla tiene el **default en apagado**.
5. **Una sola definición** de "el agente atiende", compartida por los dos carriles.
6. **Voz tiene sus propios portones** y no tiene debounce.
7. El debounce **resta**, no cuenta; y **no consulta al CRM**.
8. La línea base la fijan **solo los análisis de chat**.
9. El candado va **antes de gastar**, **no se libera**, y **falla cerrado por empresa**.
10. El arranque en frío **siembra sin gastar** si la conversación lleva 14 días muerta.
11. El **nivel 0** cierra el agujero **gratis**, con el piso de `delta ≥ 1`.
12. Las señales **adelantan, no juzgan**, y se guarda cuál disparó.
13. El léxico va **normalizado, por palabra entera, y solo lo reciente**.
14. Un análisis dentro de un webhook necesita **un barrido de respaldo** con tope y con aviso.
