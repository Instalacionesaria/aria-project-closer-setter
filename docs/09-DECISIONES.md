# Decisiones

El **porqué** de lo que no es obvio. Cada entrada existe porque alguien va a querer
"simplificar" eso más adelante, y hay una razón concreta por la que está así.

Lo que cambió y cuándo lo tiene git. Acá está el argumento.

---

## D1 · La etapa vive en Supabase, no en GHL

**Contra el principio original.** El diseño decía _"GHL es la única fuente de verdad; el tool
es una pantalla"_. Para la etapa del pipeline y el monto de la venta, eso ya no es cierto.

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

**La regla:** _lo que se deriva en la lectura no se queda viejo; lo que se denormaliza, sí._

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
mejorar en el prompt". Un _"podría ser más breve"_ le cortaba la conversación a alguien.

Ahora son **intervención** (daño en curso, apaga el bot) y **hallazgos** (trabajo del técnico,
no interrumpe a nadie). Un hallazgo rojo no le apaga el bot a nadie.

---

## D8 · El portón del auditor sigue siendo por tags, aunque eso lo deje en cero

`bot_activado` no lo tiene ningún contacto de la cuenta, y los workflows que lo aplicarían
están en borrador. El bot **sí** atiende — hay conversaciones completas que lo prueban.

Había una alternativa: decidir por **evidencia** (¿hay mensajes del bot en la conversación?),
que habría funcionado desde el día uno.

**Decisión de Fabio: esperar a que los workflows existan.** El motivo es que la plataforma no debería adivinar
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
_antes_ de que la reconciliación escribiera, **siempre**. Un entrante tardaba un tick completo
en llegar al Buzón: ~15 s. Con ingesta primero, ~6 s.

**El presupuesto es un deadline cooperativo, no un `Promise.race`.** Un race no cancela nada: la
mitad seguiría corriendo después de responder y podría congelarse entre el `update` de
`last_message_ghl_at` y `efectosDeEntrante`, perdiendo para siempre el evento de historial, la
cancelación del seguimiento y el revive de la tarea.

**Y si hubo truncamiento, la marca de agua no se escribe.** `marcaNueva` avanza _antes_ de los
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

| Qué                                                                  | Por qué no                                                                                                                                                                                                                                    |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Empujar el Buzón a SQL**                                           | Ya existió una vista que hacía eso y se borró deliberadamente: dos definiciones del mismo criterio divergen en silencio                                                                                                                       |
| **Compartir la lectura de contactos entre las dos mitades del tick** | Mi Día necesita leer _después_ de las escrituras. Parchear el snapshot en memoria es frágil: si mañana se agrega una mutación y nadie actualiza el parche, muestra datos viejos de un modo que no se nota                                     |
| **El drill-down de sentimiento**                                     | La spec pide la _frase disparadora_, y el auditor no emite ninguna. Hoy solo se podría listar el último mensaje, que es literalmente lo que esa spec prohíbe. Se le quitó el hover a los `%` para que no finjan una interacción que no existe |
| **Sumar una librería de charts**                                     | El sparkline se resuelve con `<polyline>` y `onMouseMove`. Se prefirió no sumar la dependencia                                                                                                                                                |
| **`framer-motion`**                                                  | 39 KB gzip (24% del bundle) para dos componentes. Reemplazado por una transición CSS y un tween con `requestAnimationFrame`, misma duración y misma curva                                                                                     |
| **Emojis sueltos en la UI**                                          | La iconografía viene de `lucide-react`. Los emojis que quedan en píldoras y microtextos vienen de specs anteriores                                                                                                                            |

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

## D22 · La organización sale del contexto, y sin ella se lanza

`db()` saca la empresa de `credencialesActivas()` y **lanza** si no hay ninguna. La alternativa
cómoda era `?? ORG_PRINCIPAL`.

Se descartó porque es el mismo modo de fallar que este proyecto ya se comió una vez con el cron de
citas: **silencioso, plausible, y descubierto por un cliente**. Una consulta sin organización no
tiene una respuesta correcta — tiene una respuesta peligrosa, que son los datos de otra empresa.

El costo es real y se aceptó: un handler que se olvida de `activar()` devuelve 500 en vez de andar.
Por eso hay un test que lo caza en el commit.

## D23 · Un webhook sin empresa NO se atribuye por descarte

Si el `locationId` de un evento no corresponde a ninguna empresa, se guarda crudo con
`org_id = null` y **no se procesa**. Responde 200: el evento llegó bien y no hay nada que reintentar.

La tentación era mandarlo a la empresa principal "por ahora". Eso es una fuga **indetectable**: los
datos de un cliente entrando a ARIA se ven exactamente igual que los de ARIA. El índice parcial sobre
`org_id is null` de la `019` existe para poder auditar esas filas.

Es la razón por la que `conOrg()` en `db.ts` respeta un `org_id: null` explícito y solo ese: es la
única excepción a que el Proxy pise la organización, y existe para esta línea.

## D24 · El secreto del webhook se valida DESPUÉS de saber la empresa

Suena al revés y es deliberado: el secreto es **por empresa** (`ghl_webhook_secret`), así que no hay
contra qué compararlo hasta saber contra cuál.

El costo es parsear el cuerpo de alguien que todavía no se autenticó. El beneficio es que el workflow
de una empresa deja de poder inyectar eventos a nombre de otra — con un secreto único compartido
entre las cinco eso era trivial, y rotarlo obligaba a tocar los workflows de todos los clientes.

## D25 · Un modo de prueba cuesta trabajo activarlo, no desactivarlo

`AUDITOR_SIN_PORTON_TAGS` saltea el portón del tag `bot_activado`. Estuvo **encendido por default**
un día, para una prueba, y al apagarlo se invirtió el default en el **código**: ahora saltea el
portón solo si vale `"1"`.

El motivo no es estético. Un default peligroso que se desactiva con una variable de entorno se
vuelve a encender solo en cualquier entorno donde la variable no esté — un preview, un clon local,
un proyecto nuevo. La variable tiene que ser la que **enciende**.

En el mismo movimiento se borró el default hardcodeado de `AUDITOR_USER_IDS_IA`, que era el userId
de GHL de una persona real de ARIA: con cinco empresas ese id no existe en las otras subcuentas, y si
existiera sería de otra persona.

## D26 · Lo que no se puede medir no se muestra, y se dice por qué

El panel de Estadísticas tenía 61 números y ninguno salía de la base. Al conectarlo, **28** se
podían calcular y el resto no.

Los que no tienen dato de origen **no se renderizan**: sin velo, sin cero, sin guion de relleno.
Y el endpoint devuelve `sinDato` con el motivo de cada uno, que la vista lista al pie.

La razón de mostrar el motivo y no solo omitir: quien mira el panel tiene que poder distinguir _"el
negocio no tiene este número"_ de _"el sistema todavía no lo mide"_. Son dos conclusiones opuestas y
la segunda es la única que se puede arreglar.

> Lo peor que había no era el número inventado: era la **etiqueta**. El encabezado de
> `gerenciaStore` afirmaba que la sección Equipo era "100% EN VIVO" y que su contraprueba de
> automatización era "genuina", y las dos cosas eran falsas. Un número inventado con etiqueta de
> real es el peor caso, porque nadie lo verifica — el código dice que ya está verificado.

## D27 · Una sección "en desarrollo" dice qué VA A HACER, no por qué no lo hace

El velo de §8 muestra la sección completa detrás y una línea en presente: _"Va a decir de qué anuncio
salió cada lead"_. No dice "todavía no está listo" ni promete una fecha, y un test lo hace cumplir.

Dos motivos. El cliente necesita saber qué viene, no enterarse de nuestras deudas. Y el motivo
técnico ya vive en [10-ESTADO](10-ESTADO.md): repetirlo en la UI serían dos vitrinas del mismo hecho.

Las claves están en un literal del código y **no** en una variable de entorno: activar una sección
que muestra números tiene que aparecer en un diff para que alguien lo mire.

## D28 · El stub de Meta no simula cifras

El stub de GHL simula efectos y anota la intención en el outbox. El de Meta devuelve **vacío**.

La diferencia es qué pasa si alguien confunde el stub con el real. Un tag que no se aplicó se nota
enseguida; un gasto en pauta simulado se usa para decidir dónde poner plata. Inventar una cifra ahí
sería el peor dato falso del producto.

## D29 · El nivel 0 adelanta el análisis, pero exige un mensaje nuevo del agente

El debounce de 5 mensajes tenía un agujero documentado como consecuencia matemática de la regla:
_una conversación donde la IA manda 4 mensajes y el contacto se va enojado nunca se audita_. Cinco
heurísticas de costo cero sobre `closer_mensajes` lo cierran — el análisis dispara con `delta ≥ 5`
**o** con una alarma.

Pero la alarma exige además `delta ≥ 1`, y ese piso es la mitad de la decisión. **Una alarma no se
consume**: la queja sigue en los 3 mensajes recientes del contacto después de que el análisis
corrió. Sin el piso, la conversación alarmada se re-analizaría en cada mensaje entrante hasta que
la queja envejeciera — y el debounce ya no la frena, porque la alarma es justo lo que lo saltea.

El criterio del piso sale de qué audita esto: **al agente**. Si el agente no dijo nada nuevo desde
el último veredicto, no hay nada nuevo que juzgar. El peor caso de una conversación alarmada pasa a
ser un análisis por mensaje del agente en vez de uno cada cinco, y solo mientras esté alarmada.

Cada análisis guarda en `closer_analisis_agente.alarmas` cuál señal lo adelantó. No es telemetría
decorativa: es lo único que va a permitir **borrar** las señales que disparen seguido y nunca
terminen en veredicto rojo.

## D30 · El carril amarillo tiene su propia dimensión, no un umbral flojo

Los siete criterios de la rúbrica son de **fallo**. Para que el auditor pueda decir "esto se podía
hacer mejor" sin acusar a nadie, la salida obvia era aflojarle el umbral a los siete. No se hizo.

Un criterio con umbral flojo produce ruido, y el ruido le enseña al técnico a ignorar la pestaña —
que es perder la herramienta entera, no degradarla. `acompanamiento` es una dimensión aparte, con
su propia escala de tres niveles y sus propios descartes.

Y de esa escala **solo el peldaño más bajo se reporta**. `respondio` —correcto pero plano— se mide
y se descarta a propósito: casi toda conversación tiene algo que se podía decir mejor, así que
reportarlo sería un amarillo diario garantizado sin señal adentro. Se le pide igual al modelo, para
que tenga dónde poner lo tibio en vez de empujarlo hacia `desacompaso`.

## D31 · Los webhooks se muestran; el secreto lo generamos nosotros

La UI le pedía al cliente el secreto del webhook de GHL y el token de Assistable, como si fueran
credenciales suyas. El cliente no tiene de dónde sacarlos, y **un campo que se puede dejar vacío se
deja vacío** — dejando la URL abierta a que cualquiera inyecte eventos y dispare gasto de API.

Lo que cambió es de qué lado nace el valor, no si existe. Pero el GET muestra el secreto
**efectivo**, no la columna, y esa distinción evita romper producción: hoy ARIA tiene las dos
columnas en `null` y anda con los globales, que ya están pegados en GHL y en Assistable. Como la
resolución es `propio ?? global`, generar uno propio **cambia el secreto que el endpoint espera** —
o sea que abrir la pantalla de Ajustes habría cortado la ingesta sin que nadie pidiera nada. Un GET
no puede tener esa consecuencia. Se genera solo cuando no hay ninguno.

## D32 · El autor de lo automático es `Sistema`, no una persona

`AUTOR_POR_DEFECTO = "Jorge Q."` estaba en tres archivos, de cuando no había sesión y el closer era
uno solo. En `agentes/ajustes.ts` el comentario ya lo admitía: _"es un dato falso, solo que menos
visible que un cero inventado"_ — quien aplica un ajuste al prompt es el técnico, no el closer.

Ahora el autor sale de `ctx.nombre`. Y lo que llega sin autor —un cron, un webhook— se firma
`Sistema`, no con el nombre de la persona más probable. Firmar una escritura automática con el
nombre de alguien es atribuirle algo que no hizo, y contradice la regla 5 de `CLAUDE.md`.

El endpoint de notas acepta `autor` en el cuerpo pero **no lo obedece si hay sesión**: un cliente
que mande otro nombre estaría firmando con la identidad de otro.

## D33 · El verde se mide; `null` no es un verde barato

`fallo boolean` metía dos hechos en la misma casilla: "el agente trabajó bien" y "no se pudo decir
nada". Con eso, una tarjeta sin fallas y una tarjeta sin auditar se veían igual — y afirmar salud
que nadie midió es justo lo que D3 prohíbe.

Los tres niveles lo separan, pero la tentación era llenar el hueco: hacer el backfill de las filas
viejas con `fallo = false` como `verde`. **No se hizo.** El modelo de antes no distinguía "salió
limpio" de "tenía observaciones sin gravedad", y esa diferencia la decidía el modelo mirando la
conversación. Rellenarlas habría fabricado salud medida sobre análisis que nunca la afirmaron —
el mismo error de siempre, esta vez con el sello de "verificado".

Así que `nivel` es nullable y esas filas quedaron en `null`. Mismo criterio que
`closer_avances.autor_usuario_id` en la `025`: nullable y sin backfill inventado.

En la UI la distinción es **el número, no el color**: el chip verde dice "✓ 9 VERDES · de 12". Una
afirmación de salud viaja con su base, igual que cualquier otra tasa del producto (§4.9). "Sin
datos" no tiene número que mostrar, y por eso no se pueden confundir.

## D34 · `fallo` sobrevive como proyección, y lo hace cumplir Postgres

`fallo` no se dropeó: lo leen Urgentes, `setter/urgentes.ts` y el panel de sentimiento, y sacarlo
en el mismo commit que introduce `nivel` sería el contract sin el expand.

Pero dos columnas que responden lo mismo divergen — regla 3. La invariante no queda en manos de
quien escriba el próximo INSERT: la fuerza un CHECK, `(nivel = 'rojo') = fallo`. Una fila
incoherente no se puede escribir ni a mano.

Eso tiene una consecuencia en el código que es la parte importante: `derivarNivel()` **no le cree
al modelo**. Si devolviera `"amarillo"` junto a `requiere_intervencion: true`, el CHECK tumbaría el
INSERT _después_ de haber gastado la inferencia — el peor final posible, porque el análisis se
pierde entero y en el log solo queda un `23514`. Derivar el nivel de los hechos convierte un error
del modelo en una fila correcta.

## D35 · Bloqueado ≠ no existe, y se ve distinto

Los auditores de voz están apagados por decisión, no por falta de construcción. Son dos estados
diferentes y mostrarlos igual convierte una decisión de producto en lo que parece un bug.

`tieneAuditor: false` dice "esto todavía no lo construimos" — panel gris. `bloqueado: true` dice
"esto está listo y decidimos no encenderlo" — panel ámbar con candado y su motivo. Y **no
atenuado**: una tarjeta gris se lee como deshabilitada por un error, y esta decisión hay que poder
defenderla delante del cliente.

El flag es una constante del código (`AUDITOR_VOZ_HABILITADO`) y no una variable de entorno, por el
mismo motivo que el modelo en la `028`: encender un auditor que gasta plata tiene que aparecer en un
diff que alguien mire. Vive en `src/lib/` porque lo leen los dos lados — si fueran dos constantes,
el día que se separen la pantalla diría "activo" mientras el cron no corre.

Lo apagado es **el análisis**, no la ingesta. Las llamadas se siguen recibiendo, guardando y
mostrando en el tab Llamada. El día que se desbloquee hay material real esperando, que es la mitad
del punto de bloquearlo así.

## D36 · Lo que se construye y no se ejercita, no está construido

`api/admin/empresas.ts` nunca funcionó. `closer_org_config.org_id` es la PRIMARY KEY, es `not null`
y no tiene default, y el INSERT no lo mandaba: **todo** intento de crear una empresa moría con
`null value in column "org_id"`.

Pasó desapercibido durante toda la fase 7 porque la única empresa que existe —ARIA— la sembró la
migración `018` con el UUID escrito a mano. El panel se construyó, se documentó como terminado, y
la primera vez que alguien apretó el botón fue Fabio, en producción.

Es la **tercera** vez que este proyecto paga lo mismo: los `docs/prompts/*.md` que nunca existieron
mientras el panel reportaba éxito, `closer_conexiones` como almacén de credenciales que nadie leía
—borrada el 2026-08-08 en la `036`, junto con su endpoint y sus tres envoltorios— y ahora esto. El patrón es idéntico —una escritura que se ve exitosa contra un camino que nunca se
recorrió— y contradice la regla 2 de `CLAUDE.md` de la forma más incómoda: no es que se reporte un
éxito falso, es que **nadie preguntó**.

Dos consecuencias concretas:

1. **El id se genera en Node, no con un `default gen_random_uuid()`.** Un default cerraría este bug
   y abriría otro peor: cualquier INSERT que olvide el id crearía una empresa fantasma en silencio.
   Una fila de esa tabla no es un registro más — es una EMPRESA, con once tablas apuntándole por FK.
   Que siga siendo obligatorio explícito hace que el próximo olvido falle ruidoso.

2. **El guard vive en `integracion.test.ts`, no en la suite offline.** Ningún test puro podía
   cazarlo: `tsc` está contento —la columna no aparece en el tipo del insert— y la regla vive en el
   esquema. Contra la base real es el único lugar donde _"¿este INSERT entra?"_ es contestable.

Lo que queda como deuda de proceso: **apretar cada botón del panel de administración una vez** antes
del 15 de agosto. Un endpoint con tests unitarios y sin una sola ejecución real es una hipótesis.

## D37 · El contexto de empresa es por sesión, y se mitiga con un aviso en vez de resolverse

`closer_sesiones.empresa_activa` es **un valor por sesión**, y todas las pestañas del navegador
comparten la sesión. Un `super_admin` con dos pestañas en dos empresas escribe en la última que
eligió: la escritura sale bien, en la empresa equivocada, y **sin ningún error visible**.

Es el peor modo de fallar que tiene el aislamiento. Las otras tres capas —el Proxy de `db()`, los
tests que lo hacen cumplir, RLS sin políticas— fallan cerrado y ruidoso. Ésta no falla: acierta en
el lugar incorrecto.

### La alternativa existe y funciona

Mover el contexto a la URL: prefijo `/e/<slug>/` en la ruta y un header `X-Empresa-Id` por
request, con la URL ganando sobre la sesión. Está diseñada entera, no es una idea suelta.

Se pospuso por tres razones, en orden de peso:

1. **Toca `exigir()`**, que es el punto ÚNICO por donde pasa el aislamiento entre empresas. Todo
   endpoint lo llama; una regresión ahí no se ve como un bug, se ve como datos de otra empresa.
2. **Llegaba a días del lanzamiento del 15/08**, con la multiempresa recién puesta y la
   autenticación sin haber sido ejercitada en producción por usuarios reales.
3. **El riesgo alcanza a un solo rol**, y hoy ese rol es una persona que conoce el problema.

### Lo que se acepta a cambio

Un aviso permanente en vez de una garantía técnica. La disciplina de una sola pestaña sostiene la
corrección de los datos hasta que se implemente el prefijo — y "disciplina" es exactamente la
palabra: si alguien abre dos, nada lo detiene y nada se lo dice después.

Por eso el aviso **no se puede descartar**. Un banner que se cierra y se recuerda como leído
protege el primer día y ninguno de los siguientes, que es cuando el hábito ya se relajó.

> **Y por eso tampoco se detectan las pestañas.** `BroadcastChannel` o `localStorage` darían un
> aviso más preciso —"tenés otra pestaña abierta en Acme"— a cambio de infraestructura de
> sincronización entre pestañas para un problema cuya solución de verdad es otra. Sería construir
> la mitigación con más cuidado que el arreglo.

## D38 · Las especificaciones no se versionan

`docs/especs/` está en `.gitignore` desde el 2026-08-08. Son el contrato de cada tarea: llegan por
chat, se ejecutan, y quedan en disco para poder releer qué se pidió exactamente.

El motivo no es que sean secretas: es que **describen trabajo futuro, alternativas descartadas y
fases ya ejecutadas**, y en el repo compartido se leerían como si fueran el estado del
producto. Un lector que abra `ESPEC-RUTAS-Y-EMPRESA-EN-URL.md` no tiene cómo saber que nada de eso
está implementado.

Lo que sobrevive a una espec implementada es la entrada en `09-DECISIONES` o en `10-ESTADO`, no la
espec. `docs/` es el estado; las especs son el pedido.

**Consecuencia al escribir docs, y es la parte que importa:** un documento versionado **no puede
apuntar a una espec** como si el lector pudiera abrirla. Si un `docs/*.md` necesita explicar algo
que vive en una espec, lo explica él mismo. Un enlace que no abre nada para quien lea el repo es el mismo
problema que `docs/prompts/*.md` — dos archivos que nunca existieron mientras el panel los
reportaba como cargados.

## D39 · El Avanzar del setter va a `closer_avances`, con el rol como discriminador

La alternativa era una tabla propia, y aísla mejor: un bug escribiendo del lado del setter no
podría tocar filas del closer. Se descartó porque el revenue del negocio es **la suma de los dos**
—el high-ticket que cierra el closer y el low-ticket que vende el setter— y con dos tablas cada
métrica de Estadísticas pasa a ser un `UNION` o se duplica. Dos implementaciones del mismo hecho
divergen en silencio: es la regla 3, y acá lo que diverge es plata.

El costo es un CHECK más complejo, y se acepta porque **no depende de que nadie se acuerde**:

```sql
check ((rol = 'closer' and salida in (…)) or (rol = 'setter' and salida in (…)))
```

Un Avanzar de setter con `salida = 'no_show'` no entra ni a mano. Verificado contra producción
con las ocho combinaciones.

> **El `default 'closer'` de la columna no es pereza.** `closer_avances` tiene un trigger de
> inmutabilidad que aborta todo UPDATE con un `raise` incondicional, así que un backfill no
> rellenaría nada: reventaría la transacción entera, con un mensaje que ni siquiera habla de esa
> columna. `add column ... default` es DDL y no dispara triggers de fila. Es la misma salida que
> ya documentó la `019`.

## D40 · Los efectos del setter son otra función, no un parámetro

Parametrizar `aplicarEfectosGhl` con un `rol` era la salida obvia. Es la equivocada, y la razón es
una sola línea de negocio:

**El closer aplica `bot_desactivado_postcall` en toda salida menos No-show**, porque cualquier
resultado suyo demuestra que el contacto ya tuvo su llamada de venta. El setter es **pre-agenda por
definición**: ninguna de sus cinco salidas lo prueba. Aplicar ese tag desde ahí mataría el chatbot
de un lead que todavía se está calificando — y justo en la salida Seguimiento, que es la que lo
deja en manos del bot durante días.

No es una diferencia de configuración: es una regla distinta. Meterla con un `if (rol === …)`
adentro de una función de 150 líneas habría dejado las dos lógicas trenzadas para ahorrar
duplicación que en realidad no existe.

## D41 · El % de comisión vive en la base, indexado por id

Vivía en `settingsStore` → `localStorage`, o sea **por navegador**: dos admins de la misma empresa
veían números distintos del mismo closer y ninguno estaba equivocado, cada uno leía su propio blob.
Ese número multiplica plata cobrada.

Se eligió una tabla `closer_comisiones (org_id, usuario_id, tipo, pct)` sobre una columna `jsonb`
en `closer_org_config` por dos motivos: esa tabla no tiene hoy ninguna columna jsonb —son todas
escalares— y, sobre todo, Estadísticas necesita **cruzar** el porcentaje con las ventas por
persona. Con jsonb eso se resuelve trayendo el blob entero a Node; con una tabla es un join.

**Indexado por `usuario_id` y no por nombre**, que es como estaba. Con la clave vieja, renombrar a
un usuario le borraba su comisión en silencio: la fila del panel se arma desde `closer_usuarios`,
así que aparecía con el nombre nuevo y el campo vacío, y nada fallaba hasta el día de pago.

**Sin default y sin cero.** Una comisión sin cargar es `null`. Un 0% afirma que esa persona no
cobra comisión, y es un hecho distinto de "todavía no lo configuraron" — que es el estado de
cualquier empresa el primer día. Cuando el tipo pasó a `number | null`, TypeScript marcó los seis
lugares que lo daban por hecho: ninguno mostraba `—`, todos habrían mostrado `$0`.

## D42 · Un script que no existe esconde tests que no corren

`PLAN-LANZAMIENTO-15AGO.md` citaba `npm run test:integracion` en sus reglas de trabajo. **No
existía.** La suite de integración estaba escrita, versionada y documentada, y se corría a mano con
`$env:INTEGRACION=1; npx vitest run …` — o sea, casi nunca.

Al agregar el script, la primera corrida dio **6 de 7 fallando**, y ninguno era nuevo:

1. `activar()` en un `beforeAll` **no propaga**. Es la trampa que `credenciales.ts` documenta:
   `enterWith` fija el contexto de la cadena actual, y llamado dentro de una función `async` muere
   con la continuación de esa función. Llevaba roto desde la migración multi-empresa.
2. Una aserción esperaba dos tags donde el código manda tres desde que existe la regla del bot
   post-call.

Es el mismo patrón de [D36](#d36--lo-que-se-construye-y-no-se-ejercita-no-está-construido), esta vez
aplicado a los tests: **un test que no se corre no es un test, es un archivo**.

El script es un `.mjs` propio y no `INTEGRACION=1 vitest …` en el `package.json`, porque el prefijo
`VAR=valor comando` es sintaxis de shell POSIX y **en PowerShell es un error de parseo** — este
repo se desarrolla en Windows. La alternativa era sumar `cross-env`, una dependencia entera para
exportar una variable.

---

## D43 · Un default plausible es peor que un parámetro faltante

La Fase 5.2 salió a buscar código muerto y encontró algo distinto: **cuatro valores por defecto que
tapaban el olvido de un llamador**, todos de la época de una sola empresa, todos vivos.

| Dónde                                                                    | Qué hacía                                       | Cierre           |
| ------------------------------------------------------------------------ | ----------------------------------------------- | ---------------- |
| `closer_registrar_seguimiento(p_org_id DEFAULT '…0001')`                 | Escribía en ARIA en silencio                    | `035`            |
| ídem, `p_autor_nombre DEFAULT 'Usuario Activo'`                          | Firmaba con un nombre que no es de nadie        | `035`            |
| `CLOSER_POR_DEFECTO` en `seguimientos.ts`                                | Firmaba como Jorge Q. de ARIA                   | tipo obligatorio |
| `closer_hoy_org()` / `closer_dia_org()` / `closer_auditor_claim(2 args)` | Resolvían a la empresa principal por sobrecarga | `037`            |

El tercero es el que enseña la lección. `closerId` era opcional con ese default, y **ninguno de los
tres endpoints lo pasaba**: todo Avanzar y todo seguimiento —del closer y del setter, de cualquier
empresa— escribía `cerrado_por`, `creado_por`, `completada_por` y `autor_usuario_id` apuntando a una
persona de ARIA. No fallaba nada, porque la FK es al `id` solo y no al par `(org_id, id)`. Se
descubrió mirando el default, no el bug: nadie iba a reportar "el historial dice Jorge".

Se cerró antes de que hubiera daño —`closer_seguimientos` estaba en cero al revisar— y la forma de
cerrarlo importa: `closerId: string` **obligatorio**, sin default. Los seis llamadores aparecieron
como errores de compilación, que es la lista que hay que auditar. Un default no tiene lista.

> La regla, para lo que venga: **un parámetro que identifica a una empresa o a una persona no lleva
> valor por defecto.** Si falta, tiene que fallar. La `028` ya había tomado esta decisión con el
> modelo del auditor y `db()` con la empresa activa; esto la extiende a los últimos rincones donde
> el producto todavía se comportaba como si tuviera un cliente.

## D44 · Un formateador izado a nivel de módulo congela la zona de la primera empresa

Ocho archivos del backend importaban `ZONA_HORARIA_ORG` —`"America/Lima"`, una constante— mientras
`env.zonaHoraria()` leía la zona real de la empresa activa hacía semanas. Una empresa en Bogotá o en
Ciudad de México recibía fechas de Lima: el día equivocado durante las últimas horas de su jornada,
que es exactamente el bug que `src/lib/fechas.ts` existe para matar, ahora entre empresas.

El caso interesante es `analizador.ts`. Su formateador estaba **izado a nivel de módulo**, y eso es
lo correcto para el costo —construir un `Intl.DateTimeFormat` no es gratis y el auditor formatea un
sello por mensaje— y lo incorrecto para el multi-empresa: un módulo se carga una vez por instancia
de lambda y esa instancia atiende a varias empresas. Un `const` de módulo no puede depender del
request. Y esos sellos los lee el modelo para comparar horas entre líneas, así que el veredicto se
calculaba sobre una conversación con los horarios corridos.

Bajarlo adentro de la función arreglaba la corrección y perdía el costo. La salida es
`formateador(locale, opciones)` en `fechas.ts`: **memoiza por combinación**, así que la zona entra
como argumento en cada llamada y el objeto se construye una sola vez. Las dos cosas a la vez, y en
un solo lugar.

`ZONA_HORARIA_ORG` sigue existiendo, pero como lo que su propio comentario anticipaba desde el día
uno: **el default**, para el browser —que no tiene contexto de empresa y recibe la zona resuelta en
cada respuesta— y para cuando no hay contexto. En `api/` no se usa.

---

## D45 · El checklist se deriva; una casilla que alguien marca no es evidencia

El plan de lanzamiento pedía _"una vista que muestre por empresa qué está configurado y qué falta,
derivado del estado real — no un documento aparte que se desactualiza"_. La parte que importa es la
última: este proyecto ya pagó **tres veces** por afirmaciones que nadie verificó —los
`docs/prompts/*.md` que no existían mientras el panel reportaba éxito, `closer_conexiones` que nadie
leía, el alta de empresas que nadie ejercitó hasta que Fabio la apretó en producción (ver
[D36](#d36--lo-que-se-construye-y-no-se-ejercita-no-está-construido))— y siempre por el mismo
mecanismo.

Tres decisiones dentro de esa:

**Los estados son tres.** `listo`, `falta` y `sin_dato`. El tercero es el que hace que el checklist
sea confiable: si la lectura de prueba no se pudo hacer —falta `CIFRADO_CLAVE`, por ejemplo— el ítem
dice que no se sabe. Y "lista para operar" exige que **ningún** bloqueante esté fuera de `listo`, así
que un `sin_dato` bloqueante tampoco aprueba. No saber no es estar bien, y ésta es la pantalla donde
esa diferencia decide si se lanza una empresa.

**Dos ítems no aceptan la presencia del campo como prueba**, porque son los dos que pueden decir
verde sobre algo que no está:

- Un **webhook** con URL y secreto generados no dice nada sobre si el cliente los pegó en GHL: eso
  ocurre de un lado donde no tenemos ninguna visibilidad. La única evidencia es un evento recibido.
- Un **admin** creado con su contraseña temporal no dice nada sobre si la recibió. La única evidencia
  es `ultimo_acceso_el`.

Las dos veces la tentación es la misma —"el campo tiene algo, poné verde"— y las dos veces el error
se descubre el día del lanzamiento. Están fijadas con tests.

**Lee las credenciales resueltas, no las columnas.** La primera versión leía `closer_org_config` y
habría marcado _"falta el PIT"_ sobre **ARIA**: su PIT vive en la variable `GHL_PIT` desde antes del
multi-empresa, y `resolverCredenciales()` lo resuelve con el fallback de la principal. Un checklist
que se equivoca en el caso que todos conocen es un checklist que nadie vuelve a abrir. Es el mismo
error que `admin/webhooks.ts` casi cometió con el secreto —ahí también hay que mostrar el
**efectivo**— y se cierra igual: `desdeEntorno` distingue "cargado por esta empresa" de "apoyado en
una variable global", porque las dos funcionan y no son lo mismo.

Eso último **no lo agarra un unit test**: con datos sintéticos las dos ramas se ven bien. Lo fija un
test de integración que le pregunta a la base cuál es el estado de verdad, y que además verifica el
otro lado —que una empresa cliente **no** herede el PIT global—, que es el bug que cerró la `027`.

---

## D46 · Una sola función escribe la nota de un Avanzar

**2026-08-15.** Fabio reportó que las notas no se guardaban. No era un fallo: eran tres, y los tres
tenían la misma forma.

Había **tres rutas** por las que una nota podía entrar, y solo una la guardaba donde la ficha la
busca (`closer_notas`):

| Ruta                                                      | Dónde terminaba la nota           | ¿La ve el tab Notas? |
| --------------------------------------------------------- | --------------------------------- | -------------------- |
| `registrarResultadoAvanzar` — las 5 salidas del closer    | `closer_notas`                    | Sí                   |
| `registrarSeguimiento` — Seguimiento, **closer y setter** | `closer_seguimientos.nota`        | **No**               |
| `otraSalida` del setter — sus otras 4 salidas             | `closer_avances.detalle->>'nota'` | **No**               |

Las dos rutas rotas no perdían el texto: lo guardaban en una tabla con **otro lector**.
`closer_seguimientos.nota` la lee el motor de recordatorios el día del seguimiento; `detalle` es el
JSON del timeline. Ninguna de las dos la lee la ficha. Y como la interfaz pintaba la nota igual en
los tres casos, el usuario la veía guardada y desaparecía al recargar: el éxito falso que prohíbe la
regla 2, servido por la ruta más usada del producto.

**La corrección no es agregar dos inserts.** Con tres escritores sueltos, la salida número seis nace
rota igual y nadie se entera. Ahora hay **una** función —`guardarNotaDeAvance()`— que las tres rutas
llaman, y un test que falla si alguna deja de llamarla o si aparece un segundo escritor de
`closer_notas`. El olvido pasa de silencioso a visible, que es la única diferencia que importa.

**El setter, además, no tenía nada de esto.** Su `addNota` era `setContacts` a secas —sin fetch, sin
`await`, sin manejo de error— y nunca leía `/api/closer/notas`, un endpoint que acepta los dos roles
desde que existe. Peor: `recargar()` reconstruía los contactos desde las colas de Mi Día, que traen
`notas: []`, así que cada nota se borraba sola un segundo después de escribirla, disparada por el
mismo Avanzar que la había creado. Se pasó a `merge`: las colas mandan sobre etapas y píldoras, pero
no sobre lo que Mi Día no puede saber (notas, historial, llamadas, perfil).

**Por qué el test es sobre el texto del fuente.** Lo que hay que impedir no es un valor mal
calculado sino una ruta que se olvida de persistir, y eso no se ve desde una aserción sobre un
resultado — se ve mirando quién llama a quién. Mismo criterio que `aislamiento.test.ts`. Se verificó
que falla con el código roto antes de darlo por bueno: 4 de 6 en rojo.

---

## D47 · La ficha huérfana, y por qué NO se siembra en el store

**2026-08-15**, continuación de [D46](#d46--una-sola-función-escribe-la-nota-de-un-avanzar).

Quedaba una cuarta ruta rota. **Auditoría de Agentes** abre la ficha de cualquier conversación de
los últimos 30 días, y casi ninguna de esas personas está en las colas de hoy. Como
`closerStore.contacts` se arma con Mi Día, `contact` llegaba `null`, y el drawer caía a
`localNotas` — un `useState` heredado de la era demo que descartaba lo escrito sin guardarlo ni
avisar. Peor: `onAddNota` se pasaba **siempre**, así que cuando ninguna de sus dos ramas se cumplía
la nota no llegaba ni al fallback.

**La solución obvia era sembrar el contacto en `closerStore.contacts`** —es lo que se hizo en el
setter para el caso del Pipeline— y está descartada a propósito. De ese `Record` salen los KPIs del
cockpit: `ventas` cuenta `stage === "ganado"`, `noShow` cuenta `stage === "no_show"`, y
`salesCalls`/`atendieron` suman las `llamadas` de cada contacto — que el drawer **rellena al
abrirlo**. Sembrar un contacto viejo desde Auditoría le habría sumado sus llamadas a las métricas
del día, en silencio y solo para quien lo hubiera abierto. Arreglar las notas no puede costar
torcer el dashboard.

Así que la ficha se arregla sola: cuando tiene `ghlContactId` y ningún store la reclama
(`fichaHuerfana`), pide sus notas y persiste las que se escriban. `onAddNota` pasa a ser
`undefined` en ese caso — es lo que le cede el paso.

**El rol: se corrigió una incoherencia, no se aflojó una política.** La primera versión de esta
decisión dejaba el límite abierto —`/api/closer/notas` exige `closer` o `setter`, y Auditoría la ve
`tecnico`— argumentando que ampliar un permiso de escritura era decisión de Fabio. El argumento
estaba **mal informado**: `closer/llamadas.ts` ya incluía `tecnico`, por exactamente este motivo (el
tab Llamada de esta misma ficha). Los otros cuatro endpoints se habían quedado atrás, y el efecto
era una ficha que se veía a medias: el tab Llamada con datos, y Chat, Perfil, Historial y Notas
vacíos.

Ese es el modo de fallo que importa y el que fija el test: **un 403 acá no se ve como error, se ve
como dato vacío** — el `catch` del front lo convierte en "este contacto no tiene nada". Los cinco
endpoints de la ficha aceptan ahora el mismo conjunto de roles, y `_rolesFicha.test.ts` falla si
alguno se sale del conjunto. `closer/mi-dia.ts` queda **fuera** a propósito: es la cola de trabajo
del closer, no un tab de la ficha.

## D48 · Los avisos del servidor llegan a la pantalla

**2026-08-15.** El backend venía diciendo la verdad y nadie la escuchaba.

Avanzar es optimista: el toast verde sale antes de que el servidor conteste. Cuando la respuesta
traía _"quedó registrado, pero la nota no se guardó"_, eso terminaba en un `console.warn`. Una
consola que nadie abre no es "decirlo" — la regla 2 pide que si una escritura falla la respuesta lo
diga, y decírselo al navegador no es decírselo a la persona.

Ahora hay `src/lib/avisos.ts`: un `CustomEvent` del navegador, mismo patrón que `EVENTO_SIN_SESION`.
El store publica, el drawer escucha y lo muestra en el toast que ya tenía. Un evento y no un store
compartido porque quien avisa es una capa de datos y quien muestra es una vista: importarse
mutuamente sería un ciclo.

De paso apareció un tercer silencio, del mismo tipo: `setterStore.advance()` hacía
`if (!r.ok) console.warn(...)` sobre `avanzarSetter`, que **lanza** (el `pedir()` de `api.ts`
convierte cualquier 4xx/5xx en excepción). Esa rama era inalcanzable y la excepción escapaba de un
`advance()` que nadie espera: promesa rechazada sin dueño, `recargar()` sin correr, y el pintado
optimista quedándose en pantalla como si el Avanzar hubiera entrado. Ahora hay `try/catch`, el
aviso sale, y la recarga corre **siempre** — con éxito trae lo que el servidor dejó, y con error
deshace el pintado.

---

## D49 · La ficha de Auditoría es de solo lectura

**2026-08-15.** Lo encontró la verificación adversarial del propio arreglo de D47, y era peor que
el bug que se estaba arreglando.

`closerStore.advance()` guarda **toda** su persistencia dentro de un `if (c)`, donde `c` es
`contactsRef.current[name]`. Para la ficha huérfana —la que abre Auditoría, casi siempre alguien que
no está en las colas de hoy— `c` es `undefined`: no hay POST, no hay proyección, y el `setContacts`
final devuelve `prev` sin tocar nada. El drawer, en cambio, ejecutaba `setToast(result.toast)`,
`setCelebrate(true)` y `playSaleSound()` **sin condición**.

O sea: registrar una **venta** desde Auditoría mostraba "Venta registrada — $5.000", confeti y
sonido, y no escribía absolutamente nada. La regla 2 al revés y con premio. Y el canal de avisos de
D48 vive dentro de ese mismo `if (c)`, así que para esta ficha nunca podía dispararse.

**Se sacó la acción, no el síntoma** (decisión de Fabio). Auditoría deja de pasar `onAdvance` y
`onSetterAdvance`, y el drawer oculta el botón cuando no hay quien registre (`puedeAvanzar`). Un
botón que no puede cumplir no debería estar, y el rol de esa pantalla es `tecnico`: se audita, no se
opera. Closer y Setter conservan su Avanzar intacto — hay un test que lo verifica, porque "arreglar
Auditoría" no puede terminar apagándole el botón a quien vive de él.

**El hallazgo salió de mandar a revisar el propio arreglo.** Vale anotarlo: el bug del confeti no lo
introdujo el cambio de D47 —estaba en producción desde antes y nadie lo había visto— y apareció
porque alguien recorrió esa ruta preguntando "¿y si el store no tiene el contacto?".

---

## D50 · El auditor de voz necesitaba una red, no un techo más alto

**2026-08-16**, de la revisión de los auditores contra lo que produjeron de verdad.

De **17 llamadas contestadas con transcripción, solo 13 tenían análisis**. Tres de las cuatro
faltantes son posteriores al encendido del auditor y tenían todo lo necesario: 76 s, 26 s y una de
**127 s**.

La causa: `analizarLlamada()` tenía **un solo llamador**, el webhook, y la inferencia corría ahí
adentro con 60 s de presupuesto. Una llamada larga con `effort: high` y 16.000 tokens de techo
tarda más que eso, y cuando Vercel corta la función el análisis muere **sin dejar rastro** — no hay
fila, no hay error guardado, y lo único que lo habría dicho es el cuerpo de una respuesta HTTP que
Assistable descarta. La de 127 s, la más larga y la que más tokens produce, es justo la que uno
esperaría que se caiga primero.

**Subir `maxDuration` no era el arreglo.** Mueve el techo; no crea la segunda oportunidad. Se subió
igual a 300 s (cortar una inferencia a mitad tira lo ya pagado), pero lo que cierra el agujero es
`api/voz-respaldo.ts`: un cron cada 2 h que busca llamadas contestadas, con transcripción y **sin
análisis**, y las manda al mismo auditor. Es el patrón de `territorio-respaldo` y por el mismo
motivo: el webhook tapa el caso frecuente, el cron cierra el conjunto.

El tope es **5 por empresa y por corrida**, mucho más bajo que el de territorio, y la diferencia es
que acá cada ítem es **una inferencia paga** — allá el costo son llamadas a la API de GHL. 60
análisis diarios por empresa como techo duro, aunque entren mil llamadas. Lo que quedó afuera se
reporta en `pendientes`: un barrido que no dice que dejó cosas se lee como "ya está todo auditado".

## D51 · El denominador del chip de verdes, otra vez

**2026-08-16.** El mismo bug, tercera aparición, y vale por lo que enseña sobre su forma.

En producción la tarjeta de `appointment-flow-ai` decía **"0 VERDES de 3"**. Lo honesto era "0 de
1": las otras dos filas son análisis del 2026-08-07 con `nivel = null` — legado de la `031`, que
dejó sin nivel las filas viejas de `fallo = false` a propósito, porque rellenarlas como verdes
habría fabricado salud medida. **No pueden ser verdes**, así que engordaban la M sin poder sumar
nunca a la N.

Las tres veces el error tuvo la misma forma: **alguien tocó una mitad del chip y no la otra.** La
primera, el numerador no filtraba `auditable` y la vista sí. La segunda, el arreglo agregó
`nivel is not null` al numerador y no al denominador. Ninguna rompió un test ni lanzó un error: el
número quedaba mal, con toda la cara de un dato medido.

La `040` agrega `con_veredicto` a la vista **como columna aparte**, no como filtro del WHERE. Meter
`nivel is not null` en el WHERE habría roto el panel de ánimo: el sentimiento de una fila legacy es
un dato válido —el modelo lo midió— que no depende del veredicto. Son dos preguntas distintas sobre
el mismo conjunto, así que son dos contadores.

Y ahora hay un test (`_denominadorVerdes.test.ts`) que lee las dos mitades —la query de PostgREST y
el SQL de la vista— y falla si dejan de decir lo mismo. Las dos mitades viven en lenguajes
distintos y lo único que las ata es que coincidan; eso no se ve desde una aserción sobre un
resultado.
