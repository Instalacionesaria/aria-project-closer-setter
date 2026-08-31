# 02 · Los cuatro auditores

**Dos etapas × dos canales = cuatro.** Cada uno tiene su tarjeta, su prompt y sus análisis, y **los
cuatro conviven en la misma tabla** distinguidos por el identificador del agente.

| Auditor                | Etapa       | Canal | Qué juzga                                      |
| ---------------------- | ----------- | ----- | ---------------------------------------------- |
| **Chat · post-agenda** | Post-agenda | Chat  | Confirmar y acompañar la cita hasta la llamada |
| **Chat · pre-agenda**  | Pre-agenda  | Chat  | Calificar y conseguir que agende               |
| **Voz · post-agenda**  | Post-agenda | Voz   | Lo mismo que el de chat, por teléfono          |
| **Voz · pre-agenda**   | Pre-agenda  | Voz   | Ídem                                           |

---

## 1 · El de pre-agenda NO es el de post-agenda con otro contexto

Es la decisión que más se copia mal, porque la salida obvia es pasarle un contexto distinto a la
misma rúbrica.

> **La misión del agente es otra, así que lo que cuenta como falla también.**

| En post-agenda                                        | En pre-agenda                                        |
| ----------------------------------------------------- | ---------------------------------------------------- |
| "Abandonó la conversación" = dejó colgada una cita    | El contacto **todavía no agendó**: es otra cosa      |
| "Prometió algo incorrecto sobre el programa"          | **No aplica** a quien nunca habló del programa       |
| El daño caro es perder a alguien que ya iba a comprar | El daño caro es **agendar a quien no puede comprar** |

**Auditar pre-agenda con la rúbrica de post-agenda no da un resultado peor: da uno convincente y
falso** sobre un trabajo distinto, y encima gastando.

### Lo que sí se comparte, y no es poco

| Se comparte                                                                |
| -------------------------------------------------------------------------- |
| El **molde** de la rúbrica entero                                          |
| La **regla de atribución innegociable**                                    |
| La **precondición** de auditabilidad                                       |
| El bloque de **corrección de prompt**                                      |
| El **código de patrón**, los **tres niveles** y el **sentimiento**         |
| La llamada al modelo, el parseo, la derivación del nivel y la persistencia |

**Duplicar la rúbrica entera para cambiar una sección habría garantizado que las dos divergieran en
la regla de atribución** — que es justo la que no puede divergir.

---

## 2 · Voz no es chat con otro texto: cambia cómo se lee la evidencia

**Los criterios son LOS MISMOS del territorio.** Lo que cambia es el medio:

> _"Presión por agendar" es el mismo fallo dicho por chat o por teléfono. Partir los patrones por
> canal solo repartiría los "×15 casos" del técnico en dos mitades más chicas._

Lo que el medio de voz agrega son **tres realidades del habla transcrita que NO son fallos del
agente**:

| Realidad                                           | Por qué está escrita                                |
| -------------------------------------------------- | --------------------------------------------------- |
| Muletillas, repeticiones cortas, autocorrecciones  | Son normales en una conversación hablada            |
| **Errores de la transcripción automática**         | Palabras mal transcritas, nombres deformados        |
| Un corte abrupto puede ser **la línea telefónica** | Solo es hallazgo si la conducta del agente lo causó |

Y cambia **quién habla**: en chat hay cinco autores posibles; en voz hay tres, y el tercero es la
trampa.

---

## 3 · Los autores del transcript, que son el corazón de la atribución

### En chat, cinco

| Etiqueta                   | Qué es                                                                   |
| -------------------------- | ------------------------------------------------------------------------ |
| **CONTACTO**               | La persona. Es a quien se atiende                                        |
| **AGENTE IA**              | El agente automático **que se está auditando**                           |
| **ASESOR HUMANO**          | Una persona del equipo escribiendo a mano                                |
| **AUTOMATIZACIÓN**         | Una plantilla enviada por un flujo del CRM. **No** la escribió el agente |
| **ORIGEN NO IDENTIFICADO** | El sistema no pudo atribuir ese mensaje                                  |

### En voz, tres — y el tercero no es una persona

| Etiqueta      | Qué es                                                              |
| ------------- | ------------------------------------------------------------------- |
| **AGENTE IA** | El agente de voz auditado                                           |
| **CONTACTO**  | La persona que atendió                                              |
| **SISTEMA**   | Una herramienta que el agente ejecutó, o un evento de la plataforma |

> **Un rol desconocido NO es el contacto.** Cuando todo lo que no era del agente se le presentaba al
> modelo como dicho por la persona, los turnos de herramienta —el resultado de una consulta de
> disponibilidad— entraban **como si el contacto los hubiera pronunciado**. Sobre esa base el auditor
> puede imputarle a una persona real algo que escribió una función.

La etiqueta lo dice adentro: _"ni el agente ni el contacto: no imputes nada de esta línea"_.

---

## 4 · La regla de atribución, que es la misma para los cuatro

> **Solo se le puede imputar al agente lo que dice una línea "AGENTE IA".**
>
> Si el problema lo causó una automatización, un asesor humano o una línea sin origen, **no es un
> hallazgo del agente**. Se puede mencionar en el diagnóstico si hace falta para entender la
> conversación, pero no se reporta como falla suya ni se propone corregir su prompt por eso.

Es la regla que hace que el transcript se **etiquete y no se filtre** — ver el `04` § 3.

---

## 5 · Cómo se decide qué auditor le toca a cada conversación

### En chat: por la etiqueta de territorio del contacto

```
territorio del contacto  →  agente de ese territorio  →  su rúbrica y su prompt
```

Si el contacto **no tiene territorio**, no se audita: no se sabe qué trabajo se está juzgando.

Y si llegaran a convivir los dos territorios —un automatismo a medio migrar, una edición a mano—
**gana el de post-agenda**: es la etapa más avanzada, y auditar con ese contexto a alguien que ya
agendó es lo correcto.

### En voz: por qué asistente atendió la llamada

```
el asistente que hizo la llamada  →  su agente de voz  →  su territorio  →  su rúbrica
```

> **Un origen sin agente identificado NO se audita.** Ni el asistente no mapeado, ni una reunión
> entre humanos. **Auditar "al más parecido" imputaría fallos al equivocado**, que es peor que no
> auditar.

---

## 6 · Los dos interruptores, que significan cosas distintas

Es una distinción que hay que copiar bien, porque las dos condiciones producen una tarjeta vacía y
**no son el mismo hecho**:

| Interruptor                     | Qué dice                                                      |
| ------------------------------- | ------------------------------------------------------------- |
| **"Este auditor no existe"**    | No hay rúbrica cableada para ese agente                       |
| **"Este auditor está apagado"** | Existe, tiene rúbrica y datos, y **está apagado a propósito** |

Y hay un tercero, que es de la pantalla: **"existe, está encendido y todavía no tiene análisis"** —
ver el `08`.

> **El interruptor de los auditores de voz es una constante del código, no una variable de
> entorno**, y eso es deliberado: **encender un auditor que gasta plata tiene que aparecer en un
> diff que alguien mire.**
>
> El motivo salió de una lección propia: un comportamiento gobernado por una variable de entorno **se
> vuelve a encender solo** en cualquier entorno donde la variable no esté — un preview, un clon local,
> un proyecto nuevo.

Cuando un auditor está apagado, **el motivo viaja con la decisión** en vez de vivir en la vista: una
tarjeta que dice "bloqueado" sin decir por qué se lee como un bug.

---

## 7 · Dos listas de agentes, y por qué no son una

| Lista                            | Qué contiene                                                     | Quién la usa                                     |
| -------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------ |
| **Los auditores de texto**       | Los dos de chat                                                  | El carril amarillo, y la línea base del debounce |
| **Todos los que tienen auditor** | Los dos de chat **+ los dos de voz** (si el flag está encendido) | Las vitrinas: qué tarjetas se encienden          |

**Meter los ids de voz en la primera habría mandado el cron amarillo a buscar mensajes de chat de un
agente que no escribe mensajes.** La voz entra y sale de la segunda con su propio flag.

---

## Lista de verificación

1. **Cuatro auditores**: dos etapas × dos canales, en la misma tabla, distinguidos por agente.
2. El de pre-agenda tiene **criterios propios**: no es el otro con otro contexto.
3. Se comparte **el molde**, no los criterios.
4. **Voz reusa los criterios del territorio** y cambia cómo se lee la evidencia.
5. En voz, un **rol desconocido no es el contacto**.
6. La **regla de atribución** es la misma para los cuatro.
7. En chat el auditor sale del **territorio**; en voz, del **asistente**.
8. Un origen **sin agente identificado no se audita**.
9. **"No existe" ≠ "está apagado"**, y el motivo viaja con la decisión.
10. El interruptor de voz es **constante del código**, no variable de entorno.
11. **Dos listas de agentes**, con consumidores distintos.
