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

## Plantillas: la salida cuando la ventana está cerrada

Pasadas las 24 h, lo único que Meta acepta es una **plantilla previamente aprobada**. El mismo
banner ámbar que explica el bloqueo ofrece el botón *"Enviar plantilla aprobada"* — el
diagnóstico y la salida, juntos.

> **Hoy el botón no se ve, y es correcto.** `closer_plantillas` está vacía por decisión de
> Fabio (2026-08-06: las plantillas se resuelven más adelante), y un botón que abre una lista
> vacía promete una salida que no existe. La ficha solo lo renderiza si hay al menos una
> cargada — o sea que **se enciende solo** con la primera fila, sin tocar código ni desplegar.
> Mismo mecanismo que el archivo de prompt del auditor.

### La lista no se descubre, se configura

El paso obvio era listarlas por API. **No se puede**, y está medido el 2026-08-06 contra la
subcuenta real, que sí tiene plantillas aprobadas:

| Ruta | Respuesta |
|---|---|
| `GET /locations/{id}/templates?type=whatsapp` | `200 {"templates":[],"totalCount":0}` |
| `GET /conversations/providers/whatsapp/templates` | `404` |
| `GET /locations/{id}/whatsapp/templates` | `404` |
| `GET /whatsapp/templates` | `404` |

La primera responde 200 con cero porque su esquema de respuesta es `oneOf: [SMS, Email]`: una
plantilla de Meta **no es representable ahí** ni aunque quisiera. Viven en Settings > WhatsApp
> Templates, que es otro almacén, y la API v2 no lo expone.

> **No falta un scope: no hay ruta.** Que la subcuenta tenga plantillas aprobadas y que la API
> devuelva cero no es una contradicción — son dos almacenes distintos.

Así que viven en `closer_plantillas` (017) y se cargan a mano una sola vez. Que sea una **tabla**
y no una variable de entorno ni un archivo del repo tiene un motivo concreto: agregar una
plantilla aprobada no puede exigir un deploy. Meta las aprueba con su propio calendario, y el
día que caiga una nueva alguien tiene que poder usarla esa misma tarde.

**La tabla nace vacía a propósito.** Una plantilla de mentira en el selector se ve idéntica a
una aprobada, y la diferencia recién aparece cuando el envío rebota contra un contacto real.

### Dos métodos de envío

Cuál sirve para cada plantilla se decide probando una real. El código soporta los dos desde el
día uno para que la respuesta no exija reescribir nada.

| Método | Cómo | Límite |
|---|---|---|
| `template_id` | `POST /conversations/messages` con `templateId` | **No acepta variables**: sirve para plantillas sin `{{1}}`, o con los que GHL resuelva solo |
| `workflow` | `POST /contacts/{id}/workflow/{workflowId}` | Es el camino documentado y el único con variables, a costa de que alguien arme el workflow en GHL |

Un CHECK impide la fila que rompería en producción y no en la inserción: una plantilla marcada
`workflow` sin `workflow_id` se vería perfecta en la lista y fallaría recién al enviar.

### Por qué los ids hay que cargarlos a mano

Se intentó sacarlos de otro lado antes de pedirlos, y las dos vías están cerradas:

- **Del historial, no.** `GET /conversations/messages/{id}` sobre salientes con
  `source: "workflow"` —incluido un `TYPE_WHATSAPP` con `wamid` real de Meta y `status: read`—
  **no devuelve ningún `templateId`**. GHL no registra qué plantilla generó cada mensaje.
- **Los workflows, a medias.** `GET /workflows/?locationId=` sí lista los 120 con id, nombre y
  estado, así que **el `workflowId` no hace falta pedirlo**: se encuentra por nombre. Lo que no
  se puede es `GET /workflows/{id}` (404), o sea saber qué acciones tiene adentro.

De ahí la división del trabajo: alguien crea el workflow en GHL y lo deja **publicado**; el
código lo encuentra solo. Lo único irreductiblemente manual es el **texto** de la plantilla,
que hay que copiar de la UI porque ninguna ruta lo expone.

### Detalles que importan

- **El cuerpo se muestra entero, con sus saltos de línea.** Una plantilla no se puede editar ni
  retirar, y a diferencia de un mensaje libre no la escribió quien la manda: tiene que poder
  leer qué va a salir antes de apretar.
- **No se pinta nada optimista.** El texto lo compone GHL, y por el camino de workflow ni
  siquiera sabemos cuándo sale. La burbuja aparece cuando la reconciliación la trae, que es
  cuando de verdad existe. Por eso ese camino responde `encolado`, no `enviado`.
- **El saliente se guarda con autor `workflow`**, no `asesor` ni `agente_ia`. Lo eligió un
  humano pero no lo escribió. Con `agente_ia` el auditor juzgaría al agente por un texto que
  aprobó Meta y encima le correría el debounce; con `asesor` le atribuiría al closer una
  redacción que no es suya.
- **Mandar una plantilla NO reabre la ventana.** Solo la reabre un mensaje *del contacto*.
  `ultimo_entrante_el` no se toca.
- **Con la ventana abierta también funciona.** Bloquearlo sería inventar una regla que Meta no
  tiene; simplemente ahí conviene escribir a mano.
- `template_id` y `workflow_id` **no viajan al browser**: el cliente manda el `id` nuestro y el
  servidor resuelve el resto.

## Lo que falta

- **Cargar las plantillas.** El código está; `closer_plantillas` está vacía. Hace falta el
  nombre, el idioma, el cuerpo aprobado y —según el método— el `templateId` o el `workflowId`,
  sacados de Settings > WhatsApp > Templates en GHL.
- **Probar cuál de los dos métodos funciona.** Ninguno está confirmado contra una plantilla
  real; el error de GHL viaja entero y sin traducir justamente para que la primera prueba lo
  decida.
- **Reintentar** un mensaje fallido con un botón. GHL tiene su "Try again"; acá el closer
  reescribe cuando la ventana se reabra.
