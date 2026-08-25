# 05 · El polling del contacto — de dónde sale cada dato y cada cuánto

La pregunta que responde este documento: **cuando la ficha de un contacto está abierta, qué se está
refrescando, cada cuánto, y qué no.**

El polling general de la aplicación está en la carpeta `closer`, documento `04`. Acá va solo lo del
contacto.

---

## 1 · La tabla que resume todo

| Dato del contacto                     | Cómo se mantiene fresco                             | Cada cuánto         | Cuesta al CRM  |
| ------------------------------------- | --------------------------------------------------- | ------------------- | -------------- |
| **Los mensajes**                      | Reloj propio, **solo con la ficha abierta en Chat** | **5 s**             | 0              |
| **La ventana de respuesta**           | En la **misma** respuesta que los mensajes          | 5 s                 | 0              |
| **Las etiquetas**                     | Webhook · barrido cada 2 h · botón manual           | Por evento          | Ver abajo      |
| **El estado del bot**                 | **Se deriva** de las etiquetas, en cada lectura     | Con las etiquetas   | 0              |
| **Los seis íconos**                   | **Se calculan** en el servidor, en cada listado     | Con cada listado    | 0              |
| **La píldora y la etapa**             | Con la lista que abrió la ficha                     | Con esa lista       | 0              |
| **Llamada, Perfil, Historial, Notas** | **Una vez, al abrir el tab**                        | Sin reloj           | 0              |
| **Los contadores de voz**             | Al sincronizar el contacto                          | Último sincronizado | 1 por refresco |

**La columna de la derecha es la que importa:** casi todo lo que la ficha muestra cuesta **cero** llamadas
al CRM. Se paga al **traer** el dato, no al mostrarlo.

---

## 2 · El único reloj de la ficha

**Cada 5 segundos, y con tres condiciones:**

1. La ficha está **abierta**.
2. El tab activo es el **Chat**.
3. La pestaña del navegador está **visible**.

La tercera la garantiza el módulo de relojes, no este código: **pestaña oculta = cero intervalos
corriendo**, y al volver, **un disparo inmediato**.

### Y trae dos cosas en una respuesta

Los mensajes **y** el estado de la ventana de respuesta. Un endpoint aparte para la ventana habría
duplicado el reloj **para un dato que esa misma consulta ya podía leer** de la misma fila.

### La clave del reloj lleva el identificador del contacto

Se registra como `chat:<id del contacto>`. Y eso resuelve un problema solo: **al cambiar de contacto sin
cerrar la ficha, la clave cambia**, el reloj viejo se da de baja y arranca el nuevo. Con una clave fija,
los dos correrían a la vez y el chat mostraría mensajes de dos personas mezclados.

---

## 3 · Lo que NO tiene reloj, y por qué

| Qué                                   | Por qué no                                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Llamada, Perfil, Historial, Notas** | Su dato no cambia mientras alguien mira. Y si cambia, es porque esa misma persona lo cambió — y quien escribe actualiza su propia lista |
| **Las etiquetas del contacto**        | Las mantiene el webhook al instante y el barrido cada 2 horas. Un reloj gastaría una llamada por ciclo para releer lo mismo             |
| **Los seis íconos**                   | Viajan **dentro** de cada contacto en cada listado. Ya vienen frescos                                                                   |
| **El auditor de IA**                  | Lo dispara el **webhook** al entrar o salir un mensaje. Con reloj, **cada ciclo con actividad sería una llamada al modelo de lenguaje** |

**El caso de las etiquetas merece una nota**, porque tiene una consecuencia visible: el estado del bot y
la cola de urgencias **dependen de las etiquetas cacheadas**, y la ingesta de mensajes **no refresca
etiquetas**.

> Un mensaje entrante llega al Buzón en ~6 segundos. **Un cambio de etiqueta puede tardar hasta 2 horas**
> —hasta el próximo barrido— salvo que llegue su webhook.

Eso no es un defecto, es el diseño; pero **hay que saberlo antes de prometer inmediatez**. Y hay una
palanca: conectar el evento de "contacto actualizado" del CRM baja esas 2 horas a segundos. Si ese evento
no está conectado, el barrido es la única vía.

---

## 4 · Abrir la ficha sí cuesta una llamada

Es la excepción a "cero llamadas al CRM":

> **Al abrir la ficha se refresca el contacto contra el CRM: 1 llamada.**

Y se aprovecha para dos cosas de una: trae las etiquetas frescas **y** actualiza los contadores de
llamadas del agente de voz, que son campos personalizados y de otro modo costarían una llamada por fila
en cualquier lista.

Es una llamada por apertura, por acción explícita de una persona. Comparado con refrescar en un reloj, es
gratis.

---

## 5 · Enviar un mensaje: 1 llamada, o 0

| Situación                           | Costo                                                    |
| ----------------------------------- | -------------------------------------------------------- |
| La ventana de respuesta **abierta** | **1** llamada                                            |
| La ventana **cerrada**              | **0** — el servidor **corta antes** de gastar la llamada |

La segunda fila es una decisión de diseño, no una optimización: el mensaje **iba a fallar de todos modos**,
así que gastar la llamada solo agrega latencia y un fallo que hay que explicar después.

---

## 6 · Las dos vías que mantienen los mensajes, y qué cubre cada una

Ninguna sola alcanza.

| Vía                      | Latencia  | Qué cubre                                             | Qué NO cubre                                                              |
| ------------------------ | --------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| **El webhook**           | Inmediata | Cada mensaje que el CRM avisa                         | Los que **no avisa**: automatismo caído, despliegue a mitad, error de red |
| **La ingesta del reloj** | ~10 s     | **Todo lo que tuvo actividad** desde la última pasada | Lo que no cambió la fecha de la conversación                              |

### Y el caso que ninguna de las dos cubre

> **Un mensaje que el canal rechaza minutos después NO cambia la fecha de la conversación.**

La ingesta solo relee conversaciones con actividad **nueva**, así que ese mensaje **quedaría en
"enviando" para siempre**.

Por eso hay una **tercera pasada**: relee solo conversaciones con salientes sin resolver de la última
hora, **con tope de 2 por ciclo**.

**Y excluye los identificadores fabricados.** Cuando el canal no manda identificador, el webhook inventa
uno. Esos **no existen del lado del CRM**, así que sin excluirlos **la consulta nunca se vaciaría**:
costaría 2 llamadas por ciclo, para siempre, sin resolver nada.

Es el tipo de defecto que no rompe nada y gasta presupuesto indefinidamente.

---

## 7 · La fecha del último entrante — el dato del que dependen tres cosas

Una sola fecha, y de ella dependen:

1. **La ventana de respuesta** — si el compositor está habilitado.
2. **El Buzón** — si el contacto entra a la cola de "respondieron".
3. **La reapertura de una tarea completada** — si el contacto vuelve a escribir.

Por eso tiene una propiedad que hay que preservar:

> **Solo avanza. Nunca retrocede.**

Si retrocediera —por una pasada que llega tarde con datos viejos— se reabriría una ventana cerrada, un
contacto atendido volvería al Buzón, y una tarea cerrada se reabriría sola. **Las tres al mismo tiempo,
sin ningún error.**

---

## 8 · Qué pasa cuando un ciclo falla

**Se deja lo que había.** No se vacía la lista, no se inventan mensajes, no se muestra un cero.

Es la regla general de la aplicación aplicada acá: **un dato que no se pudo traer y un dato que dice cero
no son el mismo hecho**, y no pueden verse igual. Una lista que se vacía al fallar un ciclo hace que el
usuario crea que se borró la conversación.

---

## Lista de verificación

1. **Un solo reloj** en la ficha: el chat, cada 5 s, y **solo** con ese tab abierto y la pestaña visible.
2. Ese ciclo trae **mensajes y ventana** en una respuesta.
3. La clave del reloj lleva el **identificador del contacto**, para que al cambiar no corran dos.
4. Los otros cuatro tabs **se piden al abrirlos** y no tienen reloj.
5. Los íconos y el estado del bot **se derivan/calculan**, no se refrescan aparte.
6. Las etiquetas van por **webhook y barrido**: la latencia puede ser de horas, y **se sabe**.
7. **Abrir la ficha cuesta 1 llamada**, y se aprovecha para dos cosas.
8. Enviar con la ventana cerrada cuesta **0**: se corta antes.
9. **Tres pasadas** mantienen los mensajes, y la tercera **excluye los identificadores fabricados**.
10. La fecha del último entrante **solo avanza**.
11. Si un ciclo falla, **se deja lo que había**.
