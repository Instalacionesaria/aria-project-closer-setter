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

Para ver el estado exacto: **`GET /api/agentes/auditor-estado`**. Devuelve el embudo contacto
por contacto, el conteo de cada tag, los salientes por autoría, si el archivo de prompt existe,
y una lista `loQueFalta[]` redactada para reenviar tal cual.

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

> **El agujero, dicho en voz alta:** una conversación donde la IA manda **4** mensajes y el
> contacto se va enojado **nunca se audita**. Es consecuencia matemática de la regla, no un bug
> tapable. La salida es `POST /api/closer/analizar {forzar:true}`.

Ahorro real: una conversación de 20 mensajes con 10 de la IA pasa de ~20 llamadas al modelo
a ~2.

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

Vive en **`docs/prompts/<agente>.md`**, versionado en git. **Todavía no existe** — todo
degrada limpio: sin archivo, `fragmento_prompt` queda `null` y la corrección se emite como
instrucción autónoma para agregar. Cuando aparezca, **no hay que tocar código**.

Dos trampas resueltas:

- **`includeFiles` en `vercel.json` no es opcional.** `@vercel/nft` no traza lecturas
  dinámicas, así que sin declararlo el `.md` anda en local y desaparece en producción sin
  ruido. Por eso el diagnóstico reporta `presente`.
- **Se versiona por hash del contenido**, no por commit: el archivo puede no cambiar entre
  commits. El hash es lo que permite avisar *"el prompt cambió desde que se detectó esto"* —
  sin él, el técnico pega un reemplazo de un fragmento que ya no existe.

## El costo

| | |
|---|---|
| Modelo | `claude-opus-5` (`CLAUDE_MODEL` lo sobreescribe) |
| Por análisis | **~US$0,01–0,02** |
| Esfuerzo | `medium` (`AUDITOR_EFFORT`) — dejó de ser una clasificación y ahora exige citar el prompt y redactar un reemplazo |

**El transcript se re-manda entero cada vez**, así que el costo de una conversación crecía con
el **cuadrado** de su longitud. El debounce es, en la práctica, el control de gasto de este
agente.

Palancas que existen y no están aplicadas: bajar de modelo (es una clasificación contra
criterios explícitos con esquema fijo — el caso típico donde un modelo más chico rinde igual),
y auditar solo en el saliente.

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
