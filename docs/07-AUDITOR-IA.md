# El auditor de IA

Un agente que audita a los otros agentes. Lee la conversación entre el chatbot de GHL y el
contacto, la evalúa contra una rúbrica, y produce **dos salidas que no hay que mezclar**:

- **Intervención** — hay daño en curso y un humano tiene que tomar la conversación *ahora*.
  Aplica `bot_pausado_fallo` + una nota `[IA] …`. Eso enciende la cola roja.
- **Hallazgos** — qué se puede corregir en el **prompt** del agente. No interrumpe a nadie:
  alimenta la lista de trabajo del técnico en Auditoría de Agentes.

> Que fueran lo mismo es lo que hacía que un *"podría ser más breve"* le apagara el bot a una
> persona real.

## ⚠️ Hoy no está analizando nada, y es a propósito

El portón 2 exige `bot_activado` o `bot_reactivar`. Verificado contra la subcuenta: **cero
contactos tienen alguno de los dos**, y los workflows que los aplicarían están en borrador.

Fabio decidió mantener el portón por tags y esperar a Francisco, en vez de que la plataforma
adivine el estado del bot. **El auditor está en cero deliberadamente.**

> **El interruptor, y por qué el default está al revés que antes.** Entre el 06 y el 07 de
> agosto el portón estuvo salteado: Fabio pidió encenderlo para ver al auditor trabajar durante
> unas pruebas, y quedó así un día. Ya está apagado.
>
> Lo que cambió al apagarlo es de qué lado está el default: antes `AUDITOR_SIN_PORTON_TAGS`
> salteaba el portón **salvo** que valiera `0`, y ahora lo saltea **solo** si vale `1`. La
> diferencia importa porque un modo de prueba que se desactiva con una variable de entorno se
> vuelve a encender solo en cualquier entorno donde la variable no esté — un preview, un clon
> local, un proyecto nuevo. Activar una prueba tiene que costar trabajo; desactivarla, no.
>
> En el mismo movimiento se borró el default hardcodeado de `AUDITOR_USER_IDS_IA`, que era el
> userId de GHL de una persona real de ARIA. Con cinco empresas ese id no existe en las otras
> subcuentas, y si existiera sería de otra persona.

Para ver el estado exacto: **`GET /api/agentes/auditor-estado`**. Devuelve el embudo contacto
por contacto, el conteo de cada tag, los salientes por autoría, si el prompt de la empresa está cargado,
y una lista `loQueFalta[]` redactada para reenviar tal cual. El `presente` del prompt ahora
mira la columna de la empresa, no un archivo del repo.

Dos renglones de ese endpoint son alarmas tempranas:

- `desconocido` alto con `agente_ia` en cero → el bot firma sus mensajes distinto de lo
  esperado. Se ajusta con `AUDITOR_FUENTES_IA` sin desplegar.
- `sinClasificar` clavado → la reconciliación no está corriendo.

## Los cinco portones

En orden, de más barato a más caro de evaluar. Cada uno evita gasto.

| # | Portón | Nota |
|---|---|---|
| 1 | Territorio `zona_closer` | Este es el auditor de **chat del closer**. El del setter será su propio agente |
| 2 | `botAtendiendo(tags)` | **Bloquea al 100% hoy** — ver arriba |
| 3 | No tiene ya `bot_pausado_fallo` | Ya está en la cola; re-analizar duplicaría la nota |
| 4 | **Debounce: 5 mensajes nuevos de la IA** | `AUDITOR_UMBRAL_IA` |
| 5 | Hay ≥1 mensaje clasificado como `agente_ia` | Los **hechos**, no los tags |

**El portón 5 no es redundante con el 2.** Un tag puede mentir: quedó puesto, el workflow no
corrió, alguien lo editó a mano. Sin una sola línea del agente en la conversación no hay nada
que auditar, diga lo que diga el tag.

`botAtendiendo` es distinta de `estadoBotDesdeTags` a propósito: incluye `bot_reactivar`, que
el contrato define como una **orden** y no como un estado. Para el ruteo del Buzón esa
diferencia importa (todavía no contestó); para el auditor no (ya hay un agente que va a
responder).

`dryRun` saltea el portón 2 — no escribe nada, y es la única forma de probar la rúbrica
mientras los tags no existan. Lo que **no** saltea es el 5.

## El debounce

Regla de Fabio: esperar a que la IA mande **5 mensajes** y recién ahí auditar la conversación
completa con contexto.

**No hay contador. Se resta:**

```
delta = (mensajes con autor='agente_ia' AHORA) − (ese conteo guardado en el último análisis)
```

Una columna incremental sería más directa y peor: se desincroniza con un backfill o con el
borrado de gemelos de la ingesta. La resta se auto-cura, porque las dos puntas salen de la
misma fuente.

Tampoco se cuenta contra GHL: serían 2 llamadas por evento incluso cuando la respuesta es "no
analizar", y el presupuesto de GHL es más escaso que los centavos del modelo.

**El candado** (`closer_auditor_claim`, 120 s) evita que los webhooks de entrante y saliente
—que llegan casi juntos— disparen dos análisis. **No se libera al terminar**: si el análisis
explota, la resta sigue por encima del umbral y el próximo mensaje reintenta. Liberarlo en
caliente abriría un bucle de reintentos justo cuando GHL o Anthropic están fallando.

**Arranque en frío:** un contacto con 30 mensajes previos y actividad reciente recibe un
análisis sobre todo. Si la conversación lleva más de 14 días muerta, se escribe una fila de
línea base **sin llamar al modelo**, solo para sembrar el contador.

Ahorro real: una conversación de 20 mensajes con 10 de la IA pasa de ~20 llamadas al modelo
a ~2.

### El nivel 0 — el agujero del debounce, cerrado (2026-08-07)

> Hasta esta fecha acá decía: *"una conversación donde la IA manda 4 mensajes y el contacto se va
> enojado nunca se audita. Es consecuencia matemática de la regla, no un bug tapable."* Era cierto,
> y era el caso que más duele. Ya no pasa.

Antes de rendirse, el debounce corre **cinco heurísticas de costo cero** sobre `closer_mensajes`
—nuestra caché, no GHL— y si alguna levanta, adelanta el análisis:

| Señal | Qué mira |
|---|---|
| `frustracion_lexica` | el contacto se quejó, en sus 3 mensajes más recientes |
| `intencion_de_pago` | quiere pagar o comprar **ahora** |
| `pregunta_repetida` | repitió sustancialmente la misma pregunta, no en mensajes contiguos |
| `agente_se_repite` | el agente mandó dos mensajes casi idénticos |
| `contacto_se_fue` | último mensaje del agente + 60 min de silencio, habiendo hablado antes |

El portón queda: **`delta ≥ 5`, o `delta ≥ 1` con alarma.**

> El piso de `delta ≥ 1` es lo que evita el bucle. Una alarma **no se consume**: la queja sigue en
> los 3 mensajes recientes después de que el análisis corrió, y sin el piso la conversación
> alarmada se re-analizaría en cada mensaje entrante. El criterio: esto audita **al agente**, así
> que si el agente no dijo nada nuevo, el veredicto anterior ya cubre lo que hay.

Las señales no juzgan a nadie — solo adelantan el momento de mirar. El veredicto lo sigue dando el
modelo con su cita textual y su regla de atribución. Cada análisis guarda cuál lo adelantó en
`closer_analisis_agente.alarmas`, para poder **borrar** después las que disparen sin terminar nunca
en rojo.

El léxico completo, con la regla para agregar términos y lo que se dejó afuera a propósito, está
en [13-LEXICO-AUDITOR](13-LEXICO-AUDITOR.md).

## El carril amarillo — una mejora por día (2026-08-07)

El rojo corre por conversación, en caliente, y su consecuencia es apagarle el bot a alguien. El
amarillo corre **una vez por día y por empresa** (`GET /api/auditor-amarillo`, 21:00 UTC = 16:00 de
Lima) y su consecuencia es una línea en Auditoría de Agentes para el técnico.

Las 16:00 le dejan al técnico el resto de la jornada para aplicar el ajuste. La hora del cron es
fija, pero **el borde del día se calcula en la zona de cada empresa**.

La corrida, en orden:

1. Candidatos del día: actividad hoy, el agente atendiendo, **sin** hallazgo rojo hoy, y de un
   territorio cuyo agente esté en `AUDITORES_ACTIVOS`.
2. Agrupa por señal heurística —las mismas cinco del nivel 0, leídas de la caché— y elige **un**
   patrón: el más repetido; si empatan, el más reciente.
3. **Antes de gastar**, descarta por `(error_code, agente, prompt_hash)`.
4. Si sobrevive: **una** llamada al modelo.

**Tope duro: un amarillo por empresa y por agente, por día.** Es un techo, no una cadencia suave —
un techo se razona y se presupuesta.

Lo que el amarillo **no** hace, y es deliberado:

- **No propone corrección de prompt.** Redactar el reemplazo es la parte cara del veredicto.
- **No genera tarea para nadie.** No entra a Mi Día, ni a Urgentes, ni al Buzón. Un contacto no
  aparece en ninguna cola del closer por un amarillo.
- **No apaga ningún bot.** Escribe su análisis con `fallo = false`.

### La dimensión `acompanamiento`

Los siete criterios de la rúbrica son de **fallo**. El amarillo necesita decir "esto se podía hacer
mejor" sin que sea un defecto, y eso **no se consigue aflojando los umbrales de los siete**: un
criterio flojo produce ruido, y el ruido le enseña al técnico a ignorar la pestaña.

Es una dimensión aparte, con su propia escala:

| Nivel | Qué es | ¿Hallazgo? |
|---|---|---|
| `acompano` | el agente leyó dónde estaba el lead y respondió a eso | no |
| `respondio` | contestó bien, pero pasó por alto una señal del lead | **no**, a propósito |
| `desacompaso` | el lead estaba en un lugar y el agente siguió con su agenda | sí |

`respondio` se mide y se descarta: casi toda conversación tiene algo que se podía decir mejor, así
que reportarlo sería un amarillo diario garantizado sin señal adentro. Se pide igual en el esquema
para que el modelo tenga dónde poner lo tibio en vez de empujarlo a `desacompaso`.

Descartes propios: menos de 3 mensajes con texto del contacto, la conversación terminó en cita o en
un sí, quien respondió después no fue el agente, el lead pidió algo que el prompt no cubre, o
faltan las dos citas textuales. Rige la **misma regla de atribución** que el rojo.

> **Un amarillo del carril amarillo se distingue por `criterio = 'acompanamiento'`**, no por
> `severidad`. El carril rojo también produce hallazgos de severidad `amarillo` —los que encuentra
> de paso y no piden intervención—, y confundirlos bloqueaba el tope diario con trabajo ajeno. Lo
> cazó el primer dry run contra producción.

## La rúbrica

### Los cinco defectos que arregla

La versión original tenía cinco criterios sueltos y un booleano:

1. Un solo `fallo` decidía a la vez "apagar el bot" y "hay algo que mejorar".
2. Ningún criterio exigía evidencia → veredictos infalsificables y motivos genéricos.
3. "Dejó de responder" es una afirmación **temporal** y el transcript no tenía ni una fecha.
4. No existía "no auditable": tres audios sin transcripción se juzgaban igual que veinte
   mensajes de texto.
5. Un traspaso a un humano se leía como abandono del agente.

### Cómo está armada ahora

- **Precondición** que corta antes de evaluar: sin mensajes del agente, mayormente audio, o
  conversación muy corta → `auditable: false` y nada más.
- **Siete criterios**, cada uno con su condición de **disparo** y su lista de **descartes**.
  Los descartes son la parte que importa: son los que evitan que el modelo confirme un
  criterio por parecido semántico.
- **Cita textual obligatoria** por hallazgo. Si no se puede copiar la línea que lo prueba, el
  hallazgo no existe.
- **Regla de atribución innegociable**: solo se le imputa al agente lo que dice una línea
  `AGENTE IA`.

Los criterios: `frustracion` · `dejo_de_responder` · `promesa_incorrecta` ·
`no_es_lo_que_busca` · `insiste_no_entiende` · `fuera_de_alcance` · `dato_faltante`.

### Los hechos se miden en código

Los modelos calculan mal el tiempo, y el criterio 2 es enteramente temporal. Así que se miden
y se inyectan como dato: cuántos mensajes por autor, hace cuánto fue el último de cada uno, si
alguien respondió después del contacto, cuántos mensajes sin texto, y el umbral de silencio.

### El transcript etiqueta, no filtra

```
[03/08 14:02] CONTACTO: hola, me pasan el link de pago?
[03/08 14:02] AGENTE IA: ¡Claro! Te lo envío en un momento 😊
[03/08 16:40] AUTOMATIZACIÓN: Hola 👋 te recordamos tu sesión de mañana.
[03/08 17:20] ASESOR HUMANO: Perdón por la demora, acá va: pay.link/x
```

Filtrar a los que no son el agente parece más limpio y produce cinco errores concretos:

1. La bronca del contacto suele responder a una **plantilla de workflow**. Sin verla, el
   auditor le atribuye el enojo al agente.
2. Un `ASESOR HUMANO` posterior convierte "dejó de responder" en un **traspaso**.
3. Si la promesa incorrecta la hizo una plantilla, la corrección va al workflow, no al prompt.
4. "Insiste y no entiende" se juzga **contando turnos**; sacar mensajes cambia la cuenta.
5. La evidencia que se guarda tiene que poder recortarse del mismo transcript que vio el
   modelo.

### Parámetros de la llamada

`max_tokens: 8000`, no 2000. **El techo cubre pensamiento + texto**: con el pensamiento
adaptativo encendido y un veredicto que incluye diagnóstico y corrección, el JSON salía
cortado, `JSON.parse` lanzaba, y el `catch` lo reportaba como "sin veredicto" sin decir por
qué. Ahora se chequea `stop_reason` explícitamente.

Notas de structured outputs: `maxItems` no está soportado (el tope de 3 hallazgos se recorta
en código), `additionalProperties: false` es obligatorio en cada objeto anidado, y
`fragmento_prompt` va en `required` con tipo nullable — una clave opcional en un esquema
estricto es más frágil que una obligatoria que puede ser `null`.

## El prompt del agente auditado, adentro

Para que el veredicto no diga solo *"prometió un financiamiento que no existe"* sino *"esta
línea del prompt lo permite, reemplazala por esta otra"*.

Vive en **la configuración de la empresa**: las columnas `prompt_*` de `closer_org_config`, que
se editan en **Auditoría de Agentes › Prompts**. Sin prompt cargado todo degrada
limpio: `fragmento_prompt` queda `null` y la corrección se emite como instrucción autónoma para
agregar. Cargarlo **no requiere deploy**: el siguiente análisis lo toma solo.

> **Vivía en `docs/prompts/<agente>.md` hasta el 2026-08-07**, y el cambio no fue cosmético. Un
> archivo del repo solo puede tener un prompt, y el prompt del chatbot es propio de cada
> subcuenta de GHL: auditar al agente de la empresa B contra el de ARIA no da un resultado peor,
> da uno **convincente y falso**. Además cambiarlo exigía un commit, que es una barrera absurda
> para que un cliente ajuste su propio agente.
>
> Los dos archivos `.md` nunca existieron, así que durante todo ese tiempo el auditor corrió sin
> prompt de referencia. Peor: desde la fase 4 el panel ya los guardaba en la base con su hash y
> los mostraba confirmados en pantalla — la escritura andaba y la lectura miraba otro lado. Un
> éxito reportado sin efecto, que es lo que §4.2 prohíbe.

> **Y se mudaron de pantalla el 2026-08-07.** Estaban en Ajustes › Credenciales, que exige `admin`.
> Quien mantiene el prompt del agente en GHL es el **técnico**, y pedirle `admin` para editar un
> texto obligaba a darle también el PIT de GHL, la key de Anthropic y el token de Meta. Ahora
> viven en Auditoría de Agentes › Prompts, con `exigir(["tecnico","admin","super_admin"])`
> verificado en el backend — esconder la pestaña no es un permiso.
>
> Es una **mudanza, no una copia**: de Ajustes no quedó ni la lectura. Dos campos editando el
> mismo dato es el patrón que este proyecto ya pagó caro.

Dos cosas que importan:

- **Se versiona por hash del contenido.** El hash se recalcula del texto en cada lectura y NO se
  lee de la columna `*_hash` que el panel guarda al lado: esa dice qué hash tenía el texto al
  guardarse, y el que vale para comparar contra `closer_hallazgo_agente.prompt_hash` es el del
  texto que el auditor está usando ahora. Es lo que permite avisar *"el prompt cambió desde que
  se detectó esto"* — sin él, el técnico pega un reemplazo de un fragmento que ya no existe.
- **El caché de prompts está indexado por empresa + agente.** Una instancia caliente de Vercel
  que ya cacheó el de ARIA no puede servírselo al auditor de otra empresa.
- Con la mudanza se cayó la dependencia de **`includeFiles` en `vercel.json`**, y con ella su
  trampa: `@vercel/nft` no traza lecturas dinámicas, así que el `.md` andaba en local y
  desaparecía en producción sin ruido.

## Por empresa

Desde el 2026-08-07 el auditor es por empresa en todo lo que importa:

| Qué | De dónde sale | Si falta |
|---|---|---|
| API key de Anthropic | `closer_org_config.anthropic_key_cifrada` | **No audita**, y lo dice con el nombre de la empresa |
| Modelo y esfuerzo | `anthropic_modelo` / `anthropic_thinking` | Default global: `claude-sonnet-5` / `high` |
| El prompt del agente auditado | `prompt_appointment_texto` / `prompt_lead_texto` | Degrada limpio: corrección como instrucción autónoma |
| El candado | `closer_auditor_claim(p_org_id, …)` | — |
| La caché del prompt | Indexada por **empresa + agente** | — |

> `new Anthropic()` sin argumentos lee `process.env.ANTHROPIC_API_KEY`, así que hasta ese día
> **todas las auditorías se le facturaban a ARIA** — las de sus clientes también. No era una fuga de
> datos: era una fuga de plata, del tipo que no se nota hasta la factura.

Una empresa sin key propia **no audita** en vez de auditar con la de otra. Es lo correcto: auditar
con la cuenta de un tercero es peor que no auditar.

## El costo

| | |
|---|---|
| Modelo | `claude-sonnet-5`, **constante del código** (`MODELO_AUDITOR`) |
| Esfuerzo | `high`, ídem (`ESFUERZO_AUDITOR`) |
| Por análisis | **~US$0,01–0,02** |
| Techo | `max_tokens: 8000` — cubre pensamiento **más** texto |

> **Dejó de ser configurable el 2026-08-07, y es a propósito.** Era `CLAUDE_MODEL` /
> `AUDITOR_EFFORT`, más dos columnas por empresa. El motivo sale de este mismo repo:
> `AUDITOR_SIN_PORTON_TAGS` demostró que un comportamiento gobernado por una variable de entorno
> **se vuelve a encender solo** en cualquier entorno donde la variable no esté — un preview, un
> clon local. Con el modelo pasaba al revés: una empresa podía quedar auditando con otro modelo
> sin que nadie lo hubiera decidido y sin que apareciera en ningún diff. Cambiarlo ahora es un
> cambio de código, que es más incómodo y ésa es la idea. Las columnas se dropearon en la `028`.

**El transcript se re-manda entero cada vez**, así que el costo de una conversación crece con el
**cuadrado** de su longitud. El debounce es, en la práctica, el control de gasto de este agente.

### El caché del prompt

El bloque estable del `system` —contexto + prompt del agente + rúbrica— va con
`cache_control: { type: "ephemeral", ttl: "1h" }`. Escritura 2x el input, lectura 0,1x: se paga
sola con **una** lectura por hora.

> **El breakpoint estaba mal puesto hasta el 2026-08-07.** `cache_control` cachea todo el prefijo
> **hasta ese bloque inclusive**, y estaba en `<patrones_conocidos>`, que es el último. Los
> patrones salen de `closer_hallazgo_agente` y cambian solos, así que cada hallazgo nuevo
> invalidaba el caché entero: se pagaba la escritura una y otra vez sin cobrar una sola lectura.
> Ahora el breakpoint está en la rúbrica y los patrones quedan afuera.
>
> El **carril amarillo no cachea**, y también es deliberado: hace una llamada por empresa y por
> día, así que la corrida de mañana nunca encuentra la de hoy. Un caché que jamás acierta no es
> una optimización, es un recargo.

Palancas que existen y no están aplicadas: ventana deslizante o resumen acumulado en vez de
re-mandar el transcript entero, y auditar solo en el saliente.

## Los cuatro auditores

| Auditor | Estado | Su tarjeta |
|---|---|---|
| Chat · closer | ✅ construido | `appointment-flow-ai` |
| Chat · setter | ❌ no existe | `lead-flow-ai` |
| Llamadas · closer | ❌ no existe | `appointment-flow-voz` |
| Llamadas · setter | ❌ no existe | `lead-flow-voz` |

**El de setter no es "el mismo con otro contexto".** La rúbrica de post-agenda juzga confirmar
y acompañar una cita; la de pre-agenda juzga calificar y conseguir que agende. Por eso el
portón 1 lo bloquea en vez de dejarlo correr con la rúbrica equivocada. La cola de urgentes del
setter va a estar vacía hasta que exista — es correcto.

**Los dos de voz** ya tienen fuente **y esquema**: el webhook de Assistable archiva cada
llamada en `closer_llamadas`, con `turnos` guardando el `transcript_object` entero justamente
para que puedan atribuir cada frase, igual que hace `autoria.ts` con el chat. Falta la rúbrica
— y falta una llamada **contestada**: las tres que llegaron cayeron en buzón de voz, así que
todavía nadie vio una transcripción real. Ver [11-VOZ-Y-LLAMADAS](11-VOZ-Y-LLAMADAS.md).

`closer_analisis_agente.agente_id` distingue por agente, así que los cuatro conviven en la
misma tabla y cada uno alimenta su tarjeta.

## La pestaña Auditoría de Agentes

Grid de 4 tarjetas. Las que **no tienen auditor** se ven completas pero con un panel que dice
por qué, sin números inventados — atenuarlas las haría leer como deshabilitadas por un bug.

La que **tiene auditor pero no tiene análisis** muestra `—`, no `0%`: un cero afirma una
medición que nadie hizo. Y un chip `SIN DATOS`, no un `✓ AL DÍA` verde, que afirmaría salud.

Los tres estados —**cargando / listo / error**— se ven distintos. Sin semillas, un backend
caído se vería idéntico al estado normal esperado, que es el peor error posible en esta
pantalla.

### El bloque de corrección

**DICE AHORA** (borde rose) → ↓ → **DEBERÍA DECIR** (borde emerald), apilado, con el chip del
archivo y la sección. `whitespace-pre-wrap` es obligatorio: un fragmento real de prompt tiene
viñetas y sangría, y sin eso llega como un chorizo de una línea que no se puede pegar de
vuelta.

Si el prompt cambió desde que se detectó el hallazgo, aparece una advertencia: el fragmento
citado puede ya no existir.

### Los grupos

Los casos se agrupan por `errorCode`. **El agrupamiento se hace en el cliente**, para que
`casesCount === casos.length` **por construcción** — así no puede volver el desfase de "×15
casos" mostrando 2 ejemplos.

El servidor manda **dos listas**: patrones y casos. El diagnóstico, el fragmento y la
corrección son del **patrón**, no del caso; repetirlos ×15 sería la misma duplicación que tenía
la semilla.

### Reincidencia

`reincidenteDesde` es el primer hallazgo posterior al último ajuste. Es una **query derivada**,
no un flag que alguien tenga que acordarse de escribir: un flag se desincroniza, una query no.
