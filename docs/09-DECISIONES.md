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

La razón de mostrar el motivo y no solo omitir: quien mira el panel tiene que poder distinguir *"el
negocio no tiene este número"* de *"el sistema todavía no lo mide"*. Son dos conclusiones opuestas y
la segunda es la única que se puede arreglar.

> Lo peor que había no era el número inventado: era la **etiqueta**. El encabezado de
> `gerenciaStore` afirmaba que la sección Equipo era "100% EN VIVO" y que su contraprueba de
> automatización era "genuina", y las dos cosas eran falsas. Un número inventado con etiqueta de
> real es el peor caso, porque nadie lo verifica — el código dice que ya está verificado.

## D27 · Una sección "en desarrollo" dice qué VA A HACER, no por qué no lo hace

El velo de §8 muestra la sección completa detrás y una línea en presente: *"Va a decir de qué anuncio
salió cada lead"*. No dice "todavía no está listo" ni promete una fecha, y un test lo hace cumplir.

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
*una conversación donde la IA manda 4 mensajes y el contacto se va enojado nunca se audita*. Cinco
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
columnas en `null` y anda con los globales, que Francisco ya pegó en GHL y en Assistable. Como la
resolución es `propio ?? global`, generar uno propio **cambia el secreto que el endpoint espera** —
o sea que abrir la pantalla de Ajustes habría cortado la ingesta sin que nadie pidiera nada. Un GET
no puede tener esa consecuencia. Se genera solo cuando no hay ninguno.

## D32 · El autor de lo automático es `Sistema`, no una persona

`AUTOR_POR_DEFECTO = "Jorge Q."` estaba en tres archivos, de cuando no había sesión y el closer era
uno solo. En `agentes/ajustes.ts` el comentario ya lo admitía: *"es un dato falso, solo que menos
visible que un cero inventado"* — quien aplica un ajuste al prompt es el técnico, no el closer.

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
INSERT *después* de haber gastado la inferencia — el peor final posible, porque el análisis se
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
mientras el panel reportaba éxito, `closer_conexiones` como almacén de credenciales que nadie lee, y
ahora esto. El patrón es idéntico —una escritura que se ve exitosa contra un camino que nunca se
recorrió— y contradice la regla 2 de `CLAUDE.md` de la forma más incómoda: no es que se reporte un
éxito falso, es que **nadie preguntó**.

Dos consecuencias concretas:

1. **El id se genera en Node, no con un `default gen_random_uuid()`.** Un default cerraría este bug
   y abriría otro peor: cualquier INSERT que olvide el id crearía una empresa fantasma en silencio.
   Una fila de esa tabla no es un registro más — es una EMPRESA, con once tablas apuntándole por FK.
   Que siga siendo obligatorio explícito hace que el próximo olvido falle ruidoso.

2. **El guard vive en `integracion.test.ts`, no en la suite offline.** Ningún test puro podía
   cazarlo: `tsc` está contento —la columna no aparece en el tipo del insert— y la regla vive en el
   esquema. Contra la base real es el único lugar donde *"¿este INSERT entra?"* es contestable.

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
fases ya ejecutadas**, y en el repo compartido con Kevin se leerían como si fueran el estado del
producto. Un lector que abra `ESPEC-RUTAS-Y-EMPRESA-EN-URL.md` no tiene cómo saber que nada de eso
está implementado.

Lo que sobrevive a una espec implementada es la entrada en `09-DECISIONES` o en `10-ESTADO`, no la
espec. `docs/` es el estado; las especs son el pedido.

**Consecuencia al escribir docs, y es la parte que importa:** un documento versionado **no puede
apuntar a una espec** como si el lector pudiera abrirla. Si un `docs/*.md` necesita explicar algo
que vive en una espec, lo explica él mismo. Un enlace que para Kevin no abre nada es el mismo
problema que `docs/prompts/*.md` — dos archivos que nunca existieron mientras el panel los
reportaba como cargados.
