# Decisiones

El **porqué** de lo que no es obvio. Cada entrada existe porque alguien va a querer
"simplificar" eso más adelante, y hay una razón concreta por la que está así.

Lo que cambió y cuándo lo tiene git. Acá está el argumento.

---

## D1 · La etapa vive en Supabase, no en GHL

**Contra el principio original.** El diseño decía *"GHL es la única fuente de verdad; el tool
es una pantalla"*. Para la etapa del pipeline y el monto de la venta, eso ya no es cierto.

**Por qué.** El Pipeline tiene que responder en milisegundos y sobrevivir a que GHL esté lento
o caído. Se sincroniza hacia GHL en el Avanzar, pero la pantalla lee de Supabase.

**Lo que se acepta a cambio.** Si alguien mueve un contacto de stage a mano en GHL, la
plataforma no se entera.

---

## D2 · Nunca reportar un éxito que no ocurrió

Si una escritura a GHL falla, la respuesta lo dice y la UI deshace su pintado optimista.

Suena obvio y se violó tres veces en formas distintas:

- Un endpoint devolvía `sincronizado: true` aunque GHL no encontrara el contacto.
- El envío de mensajes daba por bueno un 2xx que Meta después rechazaba.
- `buscarPorTag` devolvía `[]` cuando la llamada fallaba, indistinguible de "el territorio está
  vacío" — un 429 habría congelado el territorio entero.

**El patrón común:** un valor de retorno que no distingue "no hay nada" de "no pude
averiguarlo". Cada vez que una función pueda fallar, el `null` y el `[]` tienen que significar
una sola cosa.

---

## D3 · Sin dato, el elemento no se renderiza

Es la regla que más se viola y la que más caro sale.

Un `0%` medido y un `0%` no medido no son el mismo hecho. Un `✓ AL DÍA` verde afirma salud que
nadie midió. Un "Sin datos" gris es información; un cero es una mentira con formato de dato.

**Corolario que costó una sesión entera:** con semillas, un backend caído se ve idéntico al
estado normal esperado. Por eso los estados **cargando / listo / error** tienen que verse
distintos, y por eso desapareció el `.catch(() => {})` de Auditoría de Agentes.

---

## D4 · Las semillas se eliminaron cuando entraron datos reales

Con contactos reales, un dato inventado no es una demo: es una mentira.

**El patrón de desmantelamiento**, en cinco reglas:

1. Un campo opcional actúa de **discriminante estructural** (`ghlContactId` presente = real).
   Nunca un booleano `esSemilla`.
2. El prefijo `EJEMPLO` es para el ojo humano; el código no lo lee.
3. Mientras conviven: merge por clave, el real gana campo a campo con `??`, y `null` significa
   "no lo sé" (conserva), nunca "es cero".
4. Al desmantelar, el array semilla **se vacía**, no se borra la función que lo produce, con un
   comentario fechado.
5. Cada mutador tiene un early-return: sin el discriminante, la escritura se queda en memoria.

**Una excepción deliberada:** `makeFillerAlerts` se borró entera en vez de quedar devolviendo
`[]`. Las otras producen estructuras legítimas que quedaron vacías; esa existía **solo** para
inflar conteos por encima de la realidad. Conservarla vacía sería conservar la invitación.

---

## D5 · Los íconos se calculan, no se guardan

**La regla:** *lo que se deriva en la lectura no se queda viejo; lo que se denormaliza, sí.*

Cuando los íconos eran campos sueltos (`callsIA: {count, contestada}`), la ficha decía una cosa
y la fila otra. Ahora se calculan de los mismos datos que alimentan los tabs.

**Las dos denormalizaciones conscientes**, ambas por la misma razón —su origen no vuelve a
estar disponible sin repedirle algo a GHL:

- `llamadas_ia_*` — vienen de custom fields; traerlos en vivo costaría una llamada por contacto.
- `closer_mensajes.autor` — su origen (`source`/`userId`) se pierde si no se guarda al ingerir.

**La prueba de que la regla es real:** `bot_estado`, `cita_el` y `cita_meet_url` estuvieron
`NULL` durante semanas mientras el código decía escribirlas. Nadie lo notó porque nadie las
leía de vuelta. Están marcadas como muertas y no se dropearon: un DROP vuelve a disparar el
problema del schema cache sin ninguna ganancia.

---

## D6 · Una sola derivación por regla

`estadoBotDesdeTags` y `botDesdeTags` fueron dos implementaciones divergentes de "¿está
prendido el bot?" durante semanas. Una escribía una columna que estaba `NULL`.

Ahora hay **una** función (`botDesdeTags`) y la otra es su proyección binaria. No pueden
divergir porque una llama a la otra.

Lo mismo aplica a `hasConversationTask`, a `pendingTasksBreakdown` y a `AUDITORES_ACTIVOS`: si
dos vitrinas muestran el mismo hecho, comparten la función que lo calcula.

---

## D7 · El auditor: dos salidas, no una

Un solo booleano `fallo` decidía a la vez "apagar el bot de una persona real" y "hay algo que
mejorar en el prompt". Un *"podría ser más breve"* le cortaba la conversación a alguien.

Ahora son **intervención** (daño en curso, apaga el bot) y **hallazgos** (trabajo del técnico,
no interrumpe a nadie). Un hallazgo rojo no le apaga el bot a nadie.

---

## D8 · El portón del auditor sigue siendo por tags, aunque eso lo deje en cero

`bot_activado` no lo tiene ningún contacto de la cuenta, y los workflows que lo aplicarían
están en borrador. El bot **sí** atiende — hay conversaciones completas que lo prueban.

Había una alternativa: decidir por **evidencia** (¿hay mensajes del bot en la conversación?),
que habría funcionado desde el día uno.

**Decisión de Fabio: esperar a Francisco.** El motivo es que la plataforma no debería adivinar
el estado del bot; si el tag no está, el sistema de GHL tiene un hueco y taparlo desde acá lo
volvería invisible.

**Lo que se agregó a cambio:** que el cero no sea un silencio.
`GET /api/agentes/auditor-estado` devuelve el embudo y una lista de lo que falta, redactada
para reenviar.

---

## D9 · El debounce es una resta, no un contador

Contar "5 mensajes de la IA" con una columna incremental es más directo y se desincroniza: con
un backfill, con el borrado de gemelos de la ingesta, con un redeploy a mitad de una escritura.

La resta contra la línea base del último análisis se auto-cura, porque las dos puntas salen de
la misma fuente. Si aparecen o desaparecen mensajes, se mueven juntas.

---

## D10 · El tick corre en secuencia, no en paralelo

El plan original decía `Promise.allSettled`. Habría **empeorado** la frescura.

Los dos relojes viejos no estaban desfasados: estaban **en fase** (`registrarReloj` dispara al
registrarse, y ambos se registraban en el mismo montaje). Mi Día leía la tabla microsegundos
*antes* de que la reconciliación escribiera, **siempre**. Un entrante tardaba un tick completo
en llegar al Buzón: ~15 s. Con ingesta primero, ~6 s.

**El presupuesto es un deadline cooperativo, no un `Promise.race`.** Un race no cancela nada: la
mitad seguiría corriendo después de responder y podría congelarse entre el `update` de
`last_message_ghl_at` y `efectosDeEntrante`, perdiendo para siempre el evento de historial, la
cancelación del seguimiento y el revive de la tarea.

**Y si hubo truncamiento, la marca de agua no se escribe.** `marcaNueva` avanza *antes* de los
filtros, así que persistirla dejaría conversaciones sin procesar detrás de ella, para siempre.

**Lo que este cambio NO ahorra:** nada del lado de Supabase. Siguen siendo dos escaneos. Lo que
ahorra son invocaciones; lo que compra es frescura.

---

## D11 · Los candados nacen como RPC

Un `.update().or()` de PostgREST falló en producción con un `42703` sobre una columna que
existía y cuyo SELECT funcionaba — schema cache viejo tras un ALTER.

Todo candado va como función de Postgres: esquiva el camino de filtros y deja el claim en una
sentencia atómica.

**Y ningún candado se libera al terminar.** Si el trabajo explota, reintentar en caliente
duplica llamadas justo cuando el servicio externo está fallando. El próximo ciclo reintenta
solo.

---

## D12 · El agrupamiento de alertas se hace en el cliente

En SQL, `casesCount` sería un `COUNT(*)` desacoplado de la lista de casos que viaja — que es
literalmente el malentendido de "×15 casos" mostrando 2 ejemplos.

En el cliente, `casesCount === casos.length` **por construcción**. Ese bug no puede volver.

El servidor sí decide **qué texto gana** (el del hallazgo más reciente del patrón) y lo manda
una sola vez, en una lista aparte. Repetir el diagnóstico ×15 sería la duplicación que tenía la
semilla.

---

## D13 · El estado de entrega no tiene CHECK

El vocabulario de estados es de GHL y Meta, no nuestro. Un CHECK sobre una lista que no
controlamos convierte un estado nuevo en un INSERT fallido, y lo que se rompería es la
**ingesta** —o sea el chat entero— por un valor que solo queríamos mostrar.

Mismo criterio, al revés, para `error_envio`: se guarda el texto de GHL **sin traducir**. Es lo
que hay que poder reconocer el día que Meta cambie la redacción.

---

## D14 · El secreto del webhook de llamadas va en la URL

Assistable solo ofrece un campo de URL, sin headers. Una URL es peor que un header: se copia,
se pega en un chat, queda en logs de proxies.

**Se compensa por el lado del daño posible, no de la probabilidad:**

1. Token **propio** (`LLAMADAS_TOKEN`), distinto del `WEBHOOK_SECRET` que protege el endpoint
   que aplica tags y dispara al auditor.
2. El endpoint es **inerte**: guarda el cuerpo crudo y responde 200. No llama a GHL, no llama
   al modelo, no escribe en ninguna otra tabla. El peor caso de un token filtrado es basura en
   la bandeja.

---

## D15 · Se guarda crudo antes de interpretar

Todo webhook mete su cuerpo entero en `closer_webhook_inbox` **antes** de mapearlo. Si el mapeo
falla, el evento no se perdió.

**Corolario para features nuevas:** cuando no se sabe qué trae un payload, se recibe y se
guarda desde el día uno, y la tabla se diseña mirando datos reales. Inventar columnas y
descubrir después que faltaba la mitad es más caro que esperar tres payloads.

---

## D16 · Errar hacia "no sé" en la clasificación de autoría

`source: "api"` sin `userId` es ambiguo. Se clasifica como `desconocido`, nunca como
`agente_ia`.

Las dos formas de equivocarse no cuestan lo mismo:

- Llamar IA a lo que no lo es → el auditor puede mandar a una persona real a la cola roja por
  algo que escribió un humano.
- Llamar desconocido a lo que sí era el bot → el contador del debounce avanza más lento y el
  análisis llega tarde.

El segundo es barato y recuperable. El primero es el bug original con otro disfraz.

---

## D17 · Lo que se decidió NO hacer

| Qué | Por qué no |
|---|---|
| **Empujar el Buzón a SQL** | Ya existió una vista que hacía eso y se borró deliberadamente: dos definiciones del mismo criterio divergen en silencio |
| **Compartir la lectura de contactos entre las dos mitades del tick** | Mi Día necesita leer *después* de las escrituras. Parchear el snapshot en memoria es frágil: si mañana se agrega una mutación y nadie actualiza el parche, muestra datos viejos de un modo que no se nota |
| **El drill-down de sentimiento** | La spec pide la *frase disparadora*, y el auditor no emite ninguna. Hoy solo se podría listar el último mensaje, que es literalmente lo que esa spec prohíbe. Se le quitó el hover a los `%` para que no finjan una interacción que no existe |
| **Sumar una librería de charts** | El sparkline se resuelve con `<polyline>` y `onMouseMove`. Se prefirió no sumar la dependencia |
| **`framer-motion`** | 39 KB gzip (24% del bundle) para dos componentes. Reemplazado por una transición CSS y un tween con `requestAnimationFrame`, misma duración y misma curva |
| **Emojis sueltos en la UI** | La iconografía viene de `lucide-react`. Los emojis que quedan en píldoras y microtextos vienen de specs anteriores |

---

## D18 · "Contestada" se deriva de tres señales, no de la duración

Un buzón de voz **dura 1.86 segundos y tiene grabación**. `duracion > 0` lo habría contado como
llamada atendida, inflando el contador 📞 que el closer usa para decidir a quién perseguir.

Se exigen tres cosas: que el motivo de desconexión no sea de los que dicen "no atendió nadie",
que la llamada haya durado algo, y que **quede rastro de la charla** (turnos, transcripción o
resumen). La tercera es la que salva del motivo desconocido: el día que Retell agregue un
motivo nuevo que no esté en la lista, la ausencia de conversación igual lo delata.

Corolario incómodo pero correcto: una llamada no contestada **no ofrece audio ni sentimiento
aunque el payload los traiga**. Ofrecer "escuchar el audio" de algo que nadie atendió, y un
veredicto emocional sobre un silencio, son dato falso.

---

## D19 · Un agente de voz desconocido no se asume conocido

`assistant_id` que no está en el mapa → `voz_ia`, nunca `app_flow_voz`.

Hoy hay un solo asistente y la tentación de asumirlo es fuerte. Sería un dato falso barato: el
día que Lead Flow empiece a marcar, sus llamadas aparecerían como del closer en la ficha de un
contacto del setter.

Lo único que los contadores necesitan —que **no** es una `sales_call`— se sabe igual, así que
degradar no cuesta ningún dato: se pierde la etiqueta del chip, nada más. Mismo criterio que
D16 con la autoría de los mensajes.

---

## D20 · Las plantillas de WhatsApp viven en una tabla, no en el código

La API de GHL **no las lista** (medido, ver [08-MENSAJERIA](08-MENSAJERIA.md)), así que la
lista se configura. Podía ser una variable de entorno o un archivo del repo; es una tabla.

El motivo es operativo: agregar una plantilla aprobada no puede exigir un deploy. Meta las
aprueba con su propio calendario, y el día que caiga una nueva alguien tiene que poder usarla
esa misma tarde.

La tabla nace **vacía**. Sembrarla con ejemplos es lo que se acaba de desmontar en las pestañas
de closer y de auditoría: una plantilla de mentira en el selector se ve idéntica a una
aprobada, y la diferencia recién aparece cuando el envío rebota contra un contacto real.

---

## D21 · Una credencial ajena que llega en un payload no se guarda

El webhook de Assistable trae `variables.custom_values` con los valores personalizados de la
subcuenta de GHL — que en esta cuenta incluyen el access token de Facebook entero. Nadie lo
pidió: viaja porque el agente los recibe todos.

Se redacta antes del INSERT. Guardarlo sería copiar una credencial viva a una segunda base,
con su propio backup y su propio riesgo de fuga, **para no usarla jamás**.

La regla general: un secreto que llega sin haber sido pedido se recorta en la frontera, no se
archiva "por si acaso".
