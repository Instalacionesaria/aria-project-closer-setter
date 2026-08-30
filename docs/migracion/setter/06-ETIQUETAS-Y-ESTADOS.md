# 06 · Etiquetas y estados del Setter — qué gobierna qué

El inventario completo de literales está en `LISTA-TAGS.md`, en la raíz de la carpeta de migración. Éste
responde la pregunta que hace falta al construir: **qué etiqueta decide qué cosa en la pantalla del
Setter.**

Las **cuatro reglas de las etiquetas** —un solo escritor, nombres exactos, escritura exacta con lectura
tolerante, y las desconocidas se ignoran— están en el `08` del Closer y valen igual acá. No se repiten.

---

## 1 · El mapa completo

| Etiqueta                   | Qué decide en el Setter                                            |
| -------------------------- | ------------------------------------------------------------------ |
| `zona_setter`              | **Que el contacto exista** en este módulo — el portón              |
| `zona_closer`              | Que **ya no** exista acá: hizo el traspaso                         |
| _(sin territorio)_         | **Congelado**: se ve atenuado, no se mueve, cuesta 0 llamadas      |
| `setter_nuevo`             | Columna **Nuevo** — **pendiente de crear**                         |
| `setter_en_calificacion`   | Columna **En calificación** — **pendiente de crear**               |
| `setter_calificado`        | Columna **Calificado sin agendar** — **pendiente de crear**        |
| `derivado_lt`              | Columna **Oferta chica** · **cola de Oportunidades** · 🤖 derivado |
| `nurture_appflow`          | Columna **Nurture** — la misma que el Closer                       |
| `descalificado`            | Columna **Descalificado** — la misma que el Closer                 |
| `estancado`                | **Cola de Estancadas** · tinte ámbar. Lo pone el CRM; acá se lee   |
| `bot_activado_leadflow`    | 🤖 activo · **habilita al auditor** del setter                     |
| `bot_desactivado_leadflow` | **Cola de urgentes** · 🤖 en rojo · interruptor deshabilitado      |
| `bot_pausado_fallo`        | Lo mismo — **legado**, se lee y ya no se aplica                    |
| `bot_apagado_manual`       | 🤖 apagado                                                         |
| `seguimiento_para_agendar` | Serie automática del setter (3 toques · 5 días)                    |
| `seguimiento_decision_lt`  | Serie automática del setter (2 toques · 3 días)                    |
| `seguimiento_manual`       | Nada visible: le dice al CRM que **no persiga**                    |

**Nada de la fila del agente de post-agenda aparece acá**, y viceversa. Es el punto del § 3.

---

## 2 · El portón, y las dos etiquetas de territorio

> **Antes de cualquier cola y de cualquier columna: solo entran los contactos con `zona_setter`.**

Es el mismo mecanismo que el portón del Closer, y lo que hace que **un contacto esté en las colas de un
rol o del otro, nunca en las dos** — los territorios son mutuamente excluyentes.

### El traspaso lo hace el CRM, con un intercambio

Al crearse la cita: **sale `zona_setter`, entra `zona_closer`.** Un solo automatismo, el mismo contacto
cambiando de dueño, **sin resetear ningún dato**.

Por eso el registro de resultados del setter **no** aplica la etiqueta del closer — ver el `03` § 2.

### El congelado, igual que en el Closer

**Ningún territorio** = congelado: se ve atenuado, **no se puede mover**, y no cuesta llamadas al CRM.

**Copiá bien la definición:** es "no está en **ningún** territorio", no "perdió el mío". Con la segunda,
**todo contacto del otro módulo nace congelado** y ese módulo queda inerte hacia el CRM sin que nada
falle.

### Una consecuencia del portón que conviene ver venir

Un contacto ya traspasado **desaparece del módulo del setter** — el portón lo deja afuera. Así que la
columna **Agendado** del pipeline muestra, en la práctica, a los que el setter marcó como agendados y
**todavía tienen `zona_setter`**: la ventana entre el resultado y el momento en que la ingesta trae el
intercambio de territorio.

**No es un defecto**, es lo que significa "terminal para el setter". Pero explica por qué esa columna se
vacía sola con el tiempo, y hay que saberlo antes de salir a buscar el error.

---

## 3 · Dos etiquetas por agente, y por qué el setter no puede tocar las del closer

Cada territorio tiene **su par**: una de activado y una de desactivado.

| Territorio  | Activado                | Desactivado                |
| ----------- | ----------------------- | -------------------------- |
| Pre-agenda  | `bot_activado_leadflow` | `bot_desactivado_leadflow` |
| Post-agenda | `bot_activado_appflow`  | `bot_desactivado_appflow`  |

**Son dos y no una** porque el auditor tiene que saber **cuál** agente está atendiendo: juzgar al de
post-agenda por una conversación que atendió el de pre-agenda **le imputaría el fallo al equivocado**.

**Y el desactivado, por lo mismo**: con una sola etiqueta, un fallo del agente de pre-agenda **apagaría
también al de post-agenda**, que puede estar trabajando bien.

### El caso que hace que esto no sea teórico

**Durante el traspaso, un contacto puede tener `zona_closer` y `bot_activado_leadflow` a la vez.** Tiene
un agente activo que **no** es el que el auditor del closer va a juzgar. Un portón que pregunte "¿hay
algún agente activo?" en vez de "¿está activo **el mío**?" audita al equivocado.

> **Trampa al armar el automatismo**: no uses un filtro _"contiene `bot_desactivado`"_. Ya existe
> `bot_desactivado_postcall` y **significa lo contrario** — "esta persona ya pasó por la llamada", no "el
> agente falló". El filtro va por el nombre completo.

---

## 4 · El estado del agente: el default sigue siendo APAGADO

Igual que en el Closer, y por el mismo motivo:

> **Sin ninguna etiqueta que lo diga, el agente está APAGADO.**

Con el default en activo, un contacto cuyas etiquetas todavía no llegaron **no generaría tarea humana**
—porque "la IA lo está atendiendo"— y quedaría sin responder sin que nadie lo note.

**El estado gobierna lo mismo que allá**: si el contacto entra al buzón (solo con el agente apagado), y si
se dibuja el interruptor (solo donde hay agente).

### Y hay una diferencia propia del Setter

> **Ninguna salida del registro de resultados apaga el agente.** El Closer lo apaga en casi todas; el
> Setter, en ninguna. Ver el `03` § 1.

### Un canal sin agente

El módulo trabaja **dos canales**, y en uno de ellos no hay agente de IA. Ahí el interruptor **no se
dibuja** —no hay nada que encender— y el ciclo de rescates de la cola de estancadas **no tiene vía
definida**. Ver el `01`.

---

## 5 · Las dos series propias, y la trampa de leerlas como resultado

| Etiqueta                   | Qué significa                        |
| -------------------------- | ------------------------------------ |
| `seguimiento_para_agendar` | Serie automática · 3 toques · 5 días |
| `seguimiento_decision_lt`  | Serie automática · 2 toques · 3 días |

**Son del setter, y el Closer solo las lee** — para no pisarlas desde el otro territorio.

> **Ninguna de las dos clasifica como resultado, en ningún módulo.** Y en el Closer eso es crítico: **el
> traspaso de territorio no las quita**, así que un contacto recién agendado **las sigue arrastrando**.
> Tratarlas como resultado metería en Seguimiento a buena parte de los que están en Agendado.

`seguimiento_manual` no se ve en ninguna pantalla y **su ausencia de efecto visual es su punto**: le dice
al CRM que no persiga a este contacto, porque lo retoma una persona.

---

## 6 · La etiqueta de derivación tiene DOS lecturas, y no son la misma

`derivado_lt` es el caso donde más fácil se confunde una lectura con la otra:

| Dónde                      | Qué significa ahí                                        |
| -------------------------- | -------------------------------------------------------- |
| **Cola de Oportunidades**  | El agente lo derivó: **hay una oferta para hacer**       |
| **Columna Oferta chica**   | Lo mismo, en el pipeline                                 |
| **Registro de resultados** | **Nada — no se usa.** Significaría una venta, y no lo es |

> **Derivado ≠ vendido.** Usarla como etiqueta de venta chica marcaría como venta **a todo el que recibió
> la oferta**. Ver el `03` § 4.

---

## 7 · Las tres pendientes, y la regla que las hace inofensivas

`setter_nuevo`, `setter_en_calificacion` y `setter_calificado` **todavía no existen en la cuenta**.

**Cada literal lleva declarado su nivel de confianza, y uno pendiente no se puede mandar.** Sin esa
declaración, la aplicación escribiría una etiqueta inexistente — **que el CRM acepta y descarta, sin
avisar**.

**Y no bloquean nada**, porque la etapa vive en la base propia. Ver el `02` § 3.

---

## Lista de verificación

1. El **portón es `zona_setter`**, y los territorios son excluyentes.
2. El **traspaso es un intercambio** de etiquetas, y lo hace el CRM.
3. **Congelado = ningún territorio**, no "perdió el mío".
4. La columna **Agendado se vacía sola**: el portón deja afuera al traspasado.
5. **Dos etiquetas por agente**, y el filtro del automatismo va por nombre completo.
6. Durante el traspaso conviven **`zona_closer` + agente de pre-agenda activo**.
7. El agente por omisión está **apagado**.
8. **Ninguna salida del setter apaga el agente.**
9. En el canal sin agente **no se dibuja el interruptor**.
10. Las **dos series propias no clasifican** como resultado, en ningún módulo.
11. `derivado_lt` significa **derivado, no vendido**.
12. Las **tres pendientes no se mandan**, y la aplicación funciona igual.
