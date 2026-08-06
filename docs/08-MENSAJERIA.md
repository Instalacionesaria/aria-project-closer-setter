# Mensajería

El chat y las reglas de WhatsApp. Responde dos preguntas concretas: *"¿por qué no puedo
escribirle a este contacto?"* y *"¿por qué este mensaje figura como enviado y no llegó?"*.

## La ventana de servicio de 24 horas

Meta solo permite mandar **texto libre** dentro de las 24 h posteriores al **último mensaje que
escribió el contacto**. Pasada esa ventana, lo único que acepta son plantillas aprobadas.

### El bug que la hizo visible

Un mensaje se mandó desde Comando Central, la plataforma lo dio por enviado, y nunca llegó. En
GHL estaba en rojo:

> *Message failed to send because more than 24 hours have passed since the customer last
> replied to this number.*

**`POST /conversations/messages` había devuelto 2xx.** GHL acepta el mensaje, le crea su fila,
y recién *después* Meta lo rechaza. El `if (!r.ok)` no puede ver eso: para cuando el fallo
existe, la respuesta HTTP ya se contestó.

> **El estado de entrega no es un valor de retorno: es un hecho que evoluciona.**

### Cómo se resuelve

**Prevenir.** `src/lib/whatsapp.ts` calcula la ventana desde `ultimo_entrante_el`, que las dos
vías de ingesta ya mantienen y que **solo avanza, nunca retrocede**. El backend corta con un
409 `ventana_24h_cerrada` **antes** de gastar la llamada, y el compositor queda deshabilitado
con el motivo — la misma restricción que muestra GHL en su bandeja.

**Reflejar.** `closer_mensajes.estado` y `error_envio` guardan el veredicto real. La
reconciliación los trae y los corrige sobre filas que ya existen. El chat pinta el saliente
fallido en rojo, con el texto de GHL debajo.

Hacen falta las dos: la primera cubre el caso conocido sin gastar nada, la segunda cubre todo
lo demás que Meta puede rechazar — número sin WhatsApp, dispositivo desconectado.

### El riesgo del bloqueo preventivo, y por qué se acepta

La caché puede estar unos segundos vieja. Los dos errores no son simétricos:

| Error | Consecuencia |
|---|---|
| Dice **cerrada** y está abierta | Se bloquea un mensaje legítimo. Dura segundos: el webhook actualiza al instante, la reconciliación cada 10 s, y el chat repregunta cada 5 s → **el compositor se rehabilita solo** |
| Dice **abierta** y está cerrada | Se manda, Meta lo rechaza, y queda marcado como fallido con su motivo — la segunda mitad haciendo su trabajo |

Lo que **no** se hace es preguntarle a GHL antes de cada envío: sería una llamada por mensaje
para adelantar un dato que ya está en la caché.

## Estados de entrega

`closer_mensajes.estado` guarda el valor **tal como lo da GHL**: `delivered`, `read`, `failed`,
`pending`…

**Sin CHECK, a propósito.** El vocabulario es de GHL y Meta, no nuestro. Un CHECK sobre una
lista que no controlamos convierte cualquier estado nuevo en un INSERT fallido — y lo que se
rompería es la **ingesta**, o sea el chat entero, por un valor que solo queríamos mostrar.

**Un saliente propio nace `pending`, no `enviado`.** GHL lo aceptó; Meta todavía no lo entregó.
Registrarlo como entregado sería repetir el bug.

**El error se muestra sin traducir.** Es el texto que hay que poder reconocer el día que Meta
cambie la redacción o la regla.

### Por qué hace falta una pasada extra

La reconciliación solo relee conversaciones con actividad **nueva**, y un mensaje que falla
minutos después no cambia la fecha de la conversación. Sin la pasada de cierre, el `failed`
no llegaría nunca. Los detalles y sus dos acotaciones están en
[04-DATOS-Y-RELOJES](04-DATOS-Y-RELOJES.md).

## El chat

Se lee de la caché (`closer_mensajes`), no de GHL. Cero llamadas por request.

**El tope de 200 mensajes se aplica del lado nuevo**: se pide descendente y se da vuelta en
memoria. Con `order(asc).limit(200)` se quedaba con los 200 **más viejos** — pasada esa
cantidad, el chat mostraría el arranque de la conversación y escondería lo reciente.

El endpoint devuelve, en la misma respuesta que los mensajes, el estado de la ventana de 24 h.
Un endpoint aparte habría duplicado el reloj para un dato derivado de una columna que ese
request ya podía leer.

### Autoría

Cada mensaje guarda quién lo escribió. La clasificación está en
[03-INTEGRACION-GHL](03-INTEGRACION-GHL.md) § Cómo se identifica quién escribió un mensaje.

Los mensajes del compositor propio se marcan `asesor` **de primera mano**, sin inferir: es el
único saliente cuya autoría se sabe con certeza. Importa que quede bien — si contara como del
agente, el auditor juzgaría al bot por lo que escribió un humano, y encima le avanzaría el
contador del debounce.

### Mensajes sin texto

`esMensajeDeChat` ya **no exige `body`**. Antes se descartaba todo mensaje sin texto, lo que
borraba del mapa los audios, imágenes y adjuntos de WhatsApp: si el contacto mandaba una nota
de voz furiosa, para el auditor ese mensaje no existió y el turno anterior parecía sin
respuesta.

Ahora el mensaje sobrevive y `textoDeMensaje` deja un marcador honesto —
`[mensaje de voz sin transcripción]`, `[imagen]`— entre corchetes, para que el modelo pueda
distinguirlo del contenido real.

**En la caché sí se sigue exigiendo texto**, y a propósito: alimenta el tab Chat, donde una
burbuja vacía no comunica nada. El marcador es una decisión del transcript del auditor, no un
dato que corresponda guardar como si fuera el mensaje.

## Paginación de la API de GHL

`mensajesDeConversacion` acepta `{limite, paginas}`. **Los defaults importan:**

- La **reconciliación se queda en una página** — corre cada 10 s y multiplicar sus llamadas
  rompería el presupuesto.
- Solo el **analizador** pide varias, y solo cuando ya decidió que va a analizar.

Si se alcanza el tope, el transcript lleva una línea que lo dice, para que el modelo no
concluya que la conversación empieza donde empieza el recorte.

> Verificado: sin `limit` GHL devuelve 20 y `nextPage: true`; con `limit=50` devuelve los 28
> que había y `nextPage: false`. El `MAX_MENSAJES = 40` del analizador nunca mordía.

## Lo que falta

- **Mandar plantillas aprobadas** desde la plataforma, que es la salida real cuando la ventana
  está cerrada. Hoy hay que hacerlo desde GHL. La vía es disparar un workflow — ver
  [03-INTEGRACION-GHL](03-INTEGRACION-GHL.md) § Lo que GHL NO expone.
- **Reintentar** un mensaje fallido con un botón. GHL tiene su "Try again"; acá el closer
  reescribe cuando la ventana se reabra.
