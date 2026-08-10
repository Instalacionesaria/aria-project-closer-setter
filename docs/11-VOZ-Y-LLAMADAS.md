# Voz y llamadas

Las llamadas de los agentes de IA: cómo entran, dónde se guardan y dónde se ven. Responde
*"¿dónde queda la transcripción de una llamada?"* y *"¿por qué esta llamada figura como no
contestada si duró dos segundos?"*.

## Por qué no vienen de GHL

GHL **no expone las llamadas ni sus transcripciones**: no hay endpoint ni evento de webhook.
Fue lo que tuvo parados a los dos auditores de voz durante semanas — no faltaba la rúbrica,
faltaba la materia prima.

La fuente es **Assistable**, la plataforma donde corren los agentes de voz. Corre sobre Retell,
así que los vocabularios de `disconnection_reason` y `user_sentiment` son los de Retell.

## Cómo entra una llamada

```
Assistable  ──POST──►  /api/webhooks/llamada?token=…
                            │
                            ├─► closer_webhook_inbox   (el cuerpo crudo, redactado)
                            └─► closer_llamadas        (la fila parseada)
                                      │
                                      └─► GET /api/closer/llamadas ─► ficha, tab Llamada
```

### El token va en la URL

Assistable ofrece **un solo campo de URL**: no deja configurar headers. Una URL es peor que un
header —se copia, se pega en un chat, queda en logs de proxies— así que el diseño compensa por
el lado del daño posible, no por el de la probabilidad:

1. **Token propio** (`LLAMADAS_TOKEN`), distinto de `WEBHOOK_SECRET`. Aquel otro protege un
   endpoint que aplica tags, escribe notas en GHL y dispara al auditor. Si esta URL se filtra,
   no puede tocar nada de eso.
2. **El endpoint escribe dos tablas nuestras y nada más.** No llama a GHL, no llama al modelo,
   no dispara efectos. El peor caso de un token filtrado es basura en dos tablas.
3. Rotar es cambiar una variable de entorno y volver a pegar la URL en Assistable.

### Se guarda crudo antes de interpretar

El endpoint nació **inerte** a propósito: guardaba el cuerpo y nada más, para que los datos
reales decidieran el esquema (D15). Llegaron tres payloads el 2026-08-06 y respondieron la
pregunta que bloqueaba todo:

> **La transcripción viene en el mismo payload.** `full_transcript` + `transcript_object`, con
> el resumen, el sentimiento y la URL de la grabación. No hay que pedir nada aparte con el
> `call_id`.

Sigue guardando crudo primero. Si el parseo falla, el payload queda igual y la fila se
recupera después: se pierde la fila, nunca el dato.

### El payload trae una credencial que nadie pidió

`variables` viene con 160 claves, y adentro `custom_values` — los valores personalizados de la
subcuenta de GHL. En esta cuenta eso incluye **el access token de Facebook entero**. Viaja
porque el agente recibe todos.

`redactarSecretos()` recorta el valor de toda clave que contenga `token`, `secret`, `password`,
`api_key`… antes del INSERT. Guardarlo sería copiar una credencial viva a una segunda base, con
su propio backup y su propio riesgo de fuga, para no usarla nunca.

> Los tres payloads que ya estaban guardados se redactaron con un backfill el 2026-08-06.
> **Ese token de Facebook conviene rotarlo igual**: estuvo en reposo en la bandeja.

## "Contestada" es un hecho derivado, no un campo

La primera llamada de prueba **duró 1.86 segundos y tiene grabación**. Es un buzón de voz.
`duracion > 0` habría contado un buzón como llamada atendida, e inflado el contador 📞 que el
closer usa para decidir.

`contestoAlguien()` exige las tres cosas, y cada una tapa un agujero de las otras dos:

| Condición | Qué cubre |
|---|---|
| El motivo no está en `MOTIVOS_SIN_CONTACTO` | Buzón, ocupado, rechazada, no responde… |
| La llamada duró algo | Las que ni conectaron |
| Quedó rastro: turnos, transcripción o resumen | **El motivo desconocido.** Si Retell agrega un motivo nuevo que no está en la lista, la ausencia de conversación igual lo delata |

La tercera es la importante. Como el agente habla apenas conecta, una llamada real siempre deja
rastro — incluso si el contacto no llega a decir una palabra.

**Consecuencia visible:** una llamada no contestada no ofrece audio, ni resumen, ni
sentimiento, *aunque el payload los traiga*. El buzón de voz del 2026-08-06 tiene grabación y
sentimiento `neutral`; ofrecer "escuchar el audio" de algo que nadie atendió, y un veredicto
emocional sobre un silencio, son dato falso.

## De qué agente es cada llamada

`assistant_id` → `CallOrigin`, con el mapa en `src/lib/assistable.ts`.

Hoy hay **un** asistente conocido: `cmrtd28sb0083l2048msdf9hk` es Appointment Flow, y no es una
suposición — su saludo dice *"Estoy aquí para confirmar tu reunión con nuestro equipo"*, y
confirmar una reunión ya agendada es post-agenda, territorio del closer.

Un asistente que no está en el mapa cae en **`voz_ia`**, no en `app_flow_voz`. Asumir el único
que conocemos sería un dato falso barato de producir: el día que Lead Flow empiece a marcar,
sus llamadas aparecerían como del closer en la ficha de un contacto del setter. Lo único que
los contadores necesitan —que **no** es una sales call— se sabe igual, así que degradar no
cuesta ningún dato.

Se agregan agentes sin deploy con `ASISTENTES_VOZ_EXTRA` (`{"cmXXXX":"lead_flow_voz"}`).

## Dónde se ve

El tab **Llamada** de la ficha. El componente existía desde julio renderizando `CallRecord[]`;
lo que faltaba era que alguien le pasara una lista.

Se pide **una vez por apertura de ficha**, igual que notas e historial y por el mismo motivo:
un agente de voz no marca mientras el closer mira la pantalla, así que un reloj sería gasto sin
lector.

La proyección a `CallRecord` la hace `aCallRecord()`, el **mismo** módulo que usa el webhook al
escribir. Una sola derivación por regla: si "contestada" se calculara también en el cliente, un
día las dos vitrinas dirían cosas distintas y nadie sabría cuál miente.

Los dos contadores de la ficha salen de esa misma lista y no de un campo aparte: 📞 cuenta las
de IA contestadas, 📹 cuenta las `sales_call`.

### Las sales calls todavía no viven acá

`CallOrigin` tiene cuatro valores y el endpoint solo puede devolver tres. Las `sales_call` son
las reuniones del closer, que nadie graba ni transcribe hoy. Cuando exista esa fuente se suman
al mismo endpoint y la vista no cambia.

## Lo que falta

- ~~**Los dos auditores de voz.**~~ **Existen desde el 2026-08-10** (`analizadorVoz.ts`): el
  webhook audita toda llamada contestada con transcripción, con los criterios del territorio y el
  prompt de voz si está cargado. Lo que sigue faltando es **una llamada contestada real**: las
  tres que hay cayeron en buzón, así que la forma de `transcript_object` (`{role, content}`) está
  validada solo contra un fixture sintético — la primera contestada es la prueba de fuego, y los
  turnos malformados se descartan con validación defensiva en vez de explotar.
- **Reproducir el audio.** `grabacion_url` se guarda y viaja; el botón "Escuchar audio" del tab
  todavía no tiene reproductor.
- **`extracciones` y `herramientas`** se guardan y no los lee nadie. Se guardan porque son el
  material de la auditoría de voz y no se pueden recuperar después.
