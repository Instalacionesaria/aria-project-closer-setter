# 03 · El chat — WhatsApp e Instagram dentro de la ficha

El tab que se abre primero, y el que más reglas tiene. Responde dos preguntas que un usuario hace
seguido: **"¿por qué no puedo escribirle a este contacto?"** y **"¿por qué este mensaje dice enviado y no
llegó?"**.

---

## 1 · De dónde salen los mensajes

**De la caché propia, no del CRM. Cero llamadas por petición.**

Los mensajes los mantienen el webhook —al instante— y la ingesta del reloj de 10 segundos. El chat solo
los lee.

### El tope de 200, y el error que parece inocente

Se muestran los **últimos 200** mensajes. Y se piden así:

```
ordenar por fecha DESCENDENTE · tope 200 · dar vuelta en memoria
```

**Con `ascendente + tope 200` se queda con los 200 más VIEJOS.** Pasada esa cantidad, el chat mostraría
el arranque de la conversación y **esconde lo reciente** — que es exactamente lo que el usuario abrió a
mirar. Es una línea, no falla nunca, y rompe la pantalla en cuanto una conversación crece.

### El orden y los separadores de día

Los mensajes van **en orden cronológico ascendente**, el más nuevo abajo, y **la vista abre en el
último**. Nadie abre un chat para leer el principio.

**Y hacen falta separadores de día.** Sin ellos, una conversación con mensajes de días distintos se lee
como si fuera al revés: `19:14` seguido de `08:09` parece que el tiempo retrocede, cuando en realidad
cambió el día. El dato de la fecha ya viaja en cada mensaje; el problema aparece cuando la pantalla lo
descarta y pone un "HOY" fijo.

---

## 2 · La ventana de 24 horas

**La regla del canal**, no nuestra: solo se puede mandar **texto libre** dentro de las 24 horas
posteriores al **último mensaje que escribió el contacto**. Pasada esa ventana, solo plantillas
aprobadas.

### El defecto que la hizo visible

Un mensaje se mandó, la aplicación lo dio por enviado, **y nunca llegó**. En el CRM estaba en rojo:
_"pasaron más de 24 horas desde que el cliente respondió"_.

> **La llamada había devuelto éxito.** El CRM acepta el mensaje, le crea su fila, y **recién después** el
> canal lo rechaza. Un `si (falló)` no puede ver eso: para cuando el fallo existe, la respuesta ya se
> contestó.
>
> **El estado de entrega no es un valor de retorno: es un hecho que evoluciona.**

### Se resuelve con las dos mitades, y hacen falta las dos

**Prevenir.** La ventana se calcula desde la fecha del último entrante, que las dos vías de ingesta ya
mantienen y que **solo avanza, nunca retrocede**. El servidor **corta antes de gastar la llamada**, y el
compositor queda deshabilitado **con el motivo a la vista**.

**Reflejar.** El estado real y el texto del error se guardan sobre la fila que ya existe. El chat pinta
el saliente fallido **en rojo, con el texto del CRM debajo**.

La primera cubre el caso conocido sin gastar nada; la segunda cubre **todo lo demás** que el canal puede
rechazar — un número sin WhatsApp, un dispositivo desconectado.

### El riesgo del bloqueo preventivo, y por qué se acepta

La caché puede estar unos segundos vieja. **Los dos errores no son simétricos**, y por eso la decisión es
fácil:

| Si dice…                   | Consecuencia                                                                                                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cerrada** y está abierta | Se bloquea un mensaje legítimo — **por segundos**: el webhook actualiza al instante, la ingesta cada 10 s y el chat repregunta cada 5 s. **El compositor se rehabilita solo** |
| **Abierta** y está cerrada | Se manda, el canal lo rechaza, y queda marcado como fallido con su motivo — la segunda mitad haciendo su trabajo                                                              |

**Lo que no se hace es preguntarle al CRM antes de cada envío.** Sería una llamada por mensaje para
adelantar un dato que ya está en la caché.

---

## 3 · Los estados de entrega

Se guarda el valor **tal como lo da el CRM**: entregado, leído, fallido, pendiente…

### Tres decisiones que van juntas

**Sin lista cerrada de valores permitidos, a propósito.** El vocabulario es del CRM y del canal, **no
nuestro**. Una restricción sobre una lista que no controlamos convierte cualquier estado nuevo en una
inserción fallida — y lo que se rompe es **la ingesta**, o sea el chat entero, por un valor que solo
queríamos mostrar.

**Un saliente propio nace PENDIENTE, no "enviado".** El CRM lo aceptó; el canal todavía no lo entregó.
Registrarlo como entregado sería **repetir el defecto de arriba**.

**El error se muestra sin traducir.** Es el texto que hay que poder reconocer el día que el canal cambie
la redacción o la regla. Traducido, ese día nadie entiende qué pasó.

### Y por qué hace falta una pasada extra del servidor

La ingesta solo relee conversaciones con actividad **nueva**, y **un mensaje que falla minutos después no
cambia la fecha de la conversación**. Sin una pasada de cierre, el estado fallido **no llegaría nunca**.

Está en el documento `05` de esta carpeta.

---

## 4 · El compositor

Tres piezas: **el menú de enlaces**, el campo de texto, y **el interruptor del bot**.

### El interruptor del bot

| Regla                                                     | Por qué                                                  |
| --------------------------------------------------------- | -------------------------------------------------------- |
| **Solo se dibuja donde hay agente**                       | En Instagram no hay bot, y después de la llamada tampoco |
| **Apagar y encender piden confirmación**                  | Las dos direcciones son consecuentes                     |
| **Queda deshabilitado mientras hay una urgencia abierta** | Se reactiva **al resolver la intervención**              |

### Escribir a mano pausa el bot, con autor `Sistema`

Un mensaje manual con el bot activo dispara una **pausa temporal**. Y en el historial figura con autor
**Sistema**, no con el nombre de la persona:

> **Quien decide pausar es el sistema. El humano solo escribió.**

Atribuirle la pausa a la persona sería registrar una decisión que no tomó.

### Lo que el compositor NO tiene

**No hay botón para activar un seguimiento.** El seguimiento se enciende **únicamente** desde Avanzar.
Tener dos caminos para el mismo hecho es tener dos caminos que se desincronizan.

---

## 5 · Responder completa la tarea

**No hace falta pasar por Avanzar para cerrar una tarea de conversación.** Al enviar el mensaje:

1. La tarea **se completa en ese momento**.
2. Aparece una barra de unos 5 segundos sobre el compositor.
3. Esa barra es **solo la ventana visual para deshacer**: al pasar el mouse se pausa y se pone ámbar, y
   un clic revierte el completado y **fija** la tarea.

> **El completado ocurre al enviar, no al terminar la barra.** Cuando vivía en el final de la animación,
> **cerrar la ficha antes de los 5 segundos dejaba la tarea sin completar** — y el usuario ya la
> consideraba hecha.

**Fijada** = no se completa y sube al tope de su sección, con su marca y un separador antes del primer
contacto no fijado.

**Y revive sola**: si el contacto vuelve a escribir después de completada, la tarea **se reabre** con
autor `Sistema`.

### Qué cuenta como tarea de conversación

Solo dos situaciones: **respondieron** y **seguimiento pendiente**. **La cita del día no** — esa se
cierra con Avanzar, porque responder un mensaje no es haber tenido la reunión.

---

## 6 · El reloj del chat y la burbuja optimista

**Cada 5 segundos, y solo mientras la ficha está abierta en este tab.** Es el reloj más rápido de la
aplicación, y es barato: lee de la caché.

Cada ciclo trae los mensajes **y el estado de la ventana** en la misma respuesta. Un endpoint aparte para
la ventana habría duplicado el reloj para un dato que esa misma consulta ya podía leer.

### La fusión, que es la parte que puede estar mal sin que se note

Al enviar, la burbuja aparece **de inmediato** con un identificador local. El servidor después devuelve
**la fila real**, con otro identificador. Hay que fusionar las dos listas, y hay dos formas de
equivocarse:

| Error                                   | Síntoma                                                                            |
| --------------------------------------- | ---------------------------------------------------------------------------------- |
| Reemplazar la lista entera              | **El mensaje fallido desaparece**: el closer ve el error un segundo y después nada |
| Comparar por presencia, no por cantidad | Dos mensajes con el mismo texto se colapsan en uno                                 |

La fusión **conserva los locales que el servidor todavía no reconoce**, comparando por texto — es el
único puente entre la burbuja optimista y la fila real. Y **cuenta copias, no presencia**.

> Esta es la parte del chat que **puede estar mal sin que se vea al mirar**: un mensaje perdido en la
> fusión aparece cuando ya pasó. Por eso va en una función aparte, con sus pruebas.

**Y si el ciclo falla, se deja lo que había.** No se inventan mensajes ni se vacía la lista.

---

## 7 · Los mensajes sin texto

Un audio, una imagen, un adjunto. **No se descartan.**

Cuando se descartaban, **desaparecían del mapa**: si el contacto mandaba una nota de voz furiosa, para el
auditor **ese mensaje no existió** y el turno anterior parecía sin respuesta.

Ahora sobreviven, y llevan **un marcador honesto entre corchetes** —`[mensaje de voz sin transcripción]`,
`[imagen]`— para que se pueda distinguir del contenido real.

**Con una asimetría deliberada:** en la caché del chat **sí se sigue exigiendo texto**, porque una burbuja
vacía no comunica nada. El marcador es una decisión de lo que ve el auditor, **no un dato que corresponda
guardar como si fuera el mensaje**.

---

## 8 · La autoría de cada mensaje

Cada mensaje guarda **quién lo escribió**. Y hay un caso que se sabe con certeza y no hay que inferir:

> **Los mensajes del compositor propio se marcan como del asesor, de primera mano.**

Importa que quede bien por dos razones: si contara como del agente de IA, **el auditor juzgaría al bot por
lo que escribió un humano**, y encima le avanzaría el contador que decide cuándo analizar.

---

## Lista de verificación

1. El chat lee de la **caché**: cero llamadas al CRM por petición.
2. Tope de 200 pedido **descendente** y dado vuelta.
3. Orden ascendente, **abre en el último**, con **separadores de día**.
4. La ventana se **previene** (cortando antes de gastar) **y se refleja** (con el estado real).
5. El estado de entrega **no es un valor de retorno**: se guarda y se corrige.
6. **Sin lista cerrada** de estados, y un saliente propio nace **pendiente**.
7. El error del canal se muestra **sin traducir**.
8. El interruptor del bot **solo donde hay agente**, con confirmación, deshabilitado si hay urgencia.
9. Escribir a mano pausa el bot **con autor Sistema**.
10. **No hay** botón de seguimiento en el compositor.
11. La tarea se completa **al enviar**, no al terminar la animación.
12. Reloj de 5 s **solo con la ficha abierta en este tab**, y trae la ventana en la misma respuesta.
13. La **fusión** conserva los locales y **cuenta copias**; si el ciclo falla, no se inventa nada.
14. Los mensajes sin texto **sobreviven con marcador**.
15. El saliente propio se marca como del asesor **de primera mano**.
