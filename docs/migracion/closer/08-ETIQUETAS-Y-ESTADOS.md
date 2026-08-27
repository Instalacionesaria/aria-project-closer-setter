# 08 · Etiquetas y estados — qué gobierna qué

El inventario completo de literales está en `LISTA-TAGS.md`, en la raíz de la carpeta de migración. Éste
responde otra pregunta, que es la que hace falta al construir: **qué etiqueta decide qué cosa en la
pantalla del Closer.**

---

## 1 · El mapa completo

| Etiqueta                   | Qué decide en el Closer                                       |
| -------------------------- | ------------------------------------------------------------- |
| `zona_closer`              | **Que el contacto exista** en este módulo                     |
| _(sin territorio)_         | **Congelado**: se ve atenuado, no cuesta llamadas             |
| `venta_ganada`             | Columna **Ganado** · píldora `VENTA` · ícono 💰               |
| `adelanto_ganado`          | Columna **Cierre en curso** · píldora `ACORDÓ COMPRAR`        |
| `descalificado`            | Columna **Descalificado**                                     |
| `nurture_appflow`          | Columna **Nurture**                                           |
| `noshow`                   | Columna **No-show**                                           |
| `seguimiento`              | Columna **Seguimiento** — la señal **más débil**              |
| `seguimiento_recupero`     | Ícono ⏱ encendido · caso "serie automática corriendo"         |
| `seguimiento_manual`       | Nada visible: le dice al CRM que **no persiga**               |
| `bot_activado_appflow`     | Ícono 🤖 activo · **habilita al auditor**                     |
| `bot_desactivado_appflow`  | **Cola de urgentes** · 🤖 en rojo · interruptor deshabilitado |
| `bot_pausado_fallo`        | Lo mismo — **legado**, se lee y ya no se aplica               |
| `bot_desactivado_postcall` | 🤖 muerto · **el interruptor deja de dibujarse**              |
| `bot_apagado_manual`       | 🤖 apagado                                                    |
| `derivado_lt`              | 🤖 derivado · confirmación reforzada para revertir            |
| `cita_agendada`            | Solo lectura. **Nunca se escribe ni se quita**                |
| `estancado`                | Lo aplica el barrido del CRM; acá solo se lee                 |

---

## 2 · Las cuatro reglas de las etiquetas

**1 · Una etiqueta la escribe UN SOLO lado.** Si el CRM y la aplicación aplican la misma, se pisan y el
estado queda indefinido — **y no falla nada**: el contacto simplemente aparece en la cola equivocada.

**2 · Los nombres van exactos.** Minúsculas, guion bajo, sin acentos ni espacios. **Una etiqueta mal
escrita no da error: no hace nada.** Es el defecto más caro porque es invisible.

**3 · Escritura exacta, lectura tolerante.** Al escribir, la coincidencia es letra por letra —si no, el
CRM **responde éxito y descarta**—. Al leer, se ignoran mayúsculas y espacios: si la cuenta guardó
`Venta_Ganada`, no reconocerlo mandaría a un contacto vendido a la columna equivocada.

**4 · Las etiquetas desconocidas se ignoran en silencio, a propósito.** Una cuenta real tiene decenas —de
campañas, de origen, de estado— y **ninguna dice en qué terminó la llamada**. Solo los seis resultados
clasifican.

---

## 3 · La prioridad de resultados, y por qué hace falta

**Las etiquetas se ACUMULAN.** Registrar un resultado nuevo no borra los anteriores, y el arreglo que
devuelve el CRM **no trae fechas**. Un contacto puede llegar con `seguimiento` **y** `venta_ganada` a la
vez, y el orden en que vengan es arbitrario.

> Sin una prioridad declarada, **la misma persona cae en una columna o en otra según cómo vino ordenada
> la respuesta**. Dos cargas de la misma pantalla la muestran en dos lugares.

### El criterio: cuál describe mejor el PRESENTE

Las etiquetas no envejecen igual:

- **Los cinco resultados exclusivos se limpian entre sí.** Registrar uno quita los otros cuatro. Si uno
  está puesto, es el último que se registró.
- **`seguimiento` no lo quita nadie.** Sirve antes y después de la llamada, así que convive con todos.
  Una vez que un contacto pasó por seguimiento, **arrastra la etiqueta para siempre**. Prueba que
  **estuvo** en seguimiento, nunca que **está**.

| #   | Etiqueta          | Columna         | Por qué en ese lugar                                            |
| --- | ----------------- | --------------- | --------------------------------------------------------------- |
| 1   | `venta_ganada`    | Ganado          | Se cobró. Terminal                                              |
| 2   | `adelanto_ganado` | Cierre en curso | Hay plata comprometida                                          |
| 3   | `descalificado`   | Descalificado   | Una **decisión tomada**, no una espera                          |
| 4   | `nurture_appflow` | Nurture         | Frío pero **explícitamente reversible**                         |
| 5   | `noshow`          | No-show         | Un **hecho operativo**: el contacto sigue vivo                  |
| 6   | `seguimiento`     | Seguimiento     | El más pegajoso, **la señal más débil**: gana solo si está solo |

**El caso que justifica el orden:** seguimiento durante semanas y después "no le interesa". Quedan las dos
etiquetas. Si `seguimiento` ganara, el contacto seguiría en **la columna de trabajo activo** de alguien
que ya lo dio por perdido, todos los días.

### Lo que NO entra en la prioridad

| Qué                                      | Por qué                                                                     |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| Las etiquetas de **modo** de seguimiento | Dicen **cómo** se persigue, no en qué terminó                               |
| Las **series del otro módulo**           | El traspaso de territorio **no las quita**: un recién agendado las arrastra |

La segunda importa: tratarlas como resultado **metería en Seguimiento a buena parte de los que están en
Agendado**.

---

## 4 · El estado del agente de IA — el default es APAGADO

De las etiquetas sale un estado, y **el valor por omisión no es "activo"**:

> **Sin ninguna etiqueta que lo diga, el agente está APAGADO.**

Es la decisión correcta y no la cómoda. Con el default en activo, un contacto cuyas etiquetas todavía no
llegaron **no generaría tarea humana** —porque "la IA lo está atendiendo"— y quedaría sin responder sin
que nadie lo note.

Con el default en apagado, el peor caso es que aparezca una tarea que el agente ya estaba atendiendo: se
ve, se resuelve, y no se pierde nadie.

### El estado gobierna dos cosas

| Consecuencia                      | Regla                              |
| --------------------------------- | ---------------------------------- |
| **Si el contacto entra al Buzón** | Solo si el agente está **apagado** |
| **Si se dibuja el interruptor**   | Solo donde **hay** agente          |

Y de ahí la regla de fondo del módulo:

> **Una IA activa nunca genera tarea humana.** Si el agente está atendiendo, no debería haber una tarea
> esperando manos.

**La excepción legítima**: pausa temporal + el contacto volvió a escribir. El humano ya escribió, el
agente se apartó, y el contacto respondió. Ése es justo el caso que justifica que la tarea reviva.

---

## 5 · Las dos etiquetas por agente, y la trampa al configurar el CRM

**El activado son dos etiquetas y no una** porque el auditor tiene que saber **cuál** agente está
atendiendo: juzgar al de post-agenda por una conversación que atendió el de pre-agenda **le imputaría el
fallo al equivocado**.

**El desactivado son dos por lo mismo**: cada uno pausa a su agente. Con una sola, un fallo del de
pre-agenda **apagaría también al de post-agenda**, que puede estar trabajando bien.

> **Trampa al armar el automatismo:** no uses un filtro _"contiene `bot_desactivado`"_. Ya existe
> `bot_desactivado_postcall` y **significa lo contrario** — "esta persona ya pasó por la llamada", no "el
> agente falló". El filtro va por el nombre completo.

---

## 6 · El territorio y el congelado

| Estado                         | Qué pasa                                                           |
| ------------------------------ | ------------------------------------------------------------------ |
| Tiene `zona_closer`            | Está en el módulo, cuenta para todo                                |
| **No tiene ningún territorio** | **Congelado**: visible, atenuado, movible, **y cuesta 0 llamadas** |

**Se descongela solo** si una etiqueta de territorio reaparece en un refresco.

**Y el congelado se ve, no desaparece.** El contador de la base total **desglosa**: `N activos · M
congelados`. Si desaparecieran, el closer vería bajar su cartera sin ninguna explicación disponible.

### La definición que hay que copiar bien

Es "**no está en ningún territorio**", no "perdió el mío". Con la segunda definición, **todo contacto del
otro módulo nace congelado** —nunca tuvo esta etiqueta, la gana recién al agendar— y ese módulo queda
inerte hacia el CRM **sin que nada falle**.

---

## Lista de verificación

1. Una etiqueta la escribe **un solo lado**.
2. Nombres **exactos**: una mal escrita **no da error**.
3. **Escritura exacta, lectura tolerante.**
4. Las desconocidas **se ignoran**; solo los seis resultados clasifican.
5. Hay una **prioridad declarada**, y `seguimiento` es la más débil.
6. Las series del otro módulo **no clasifican**.
7. El agente por omisión está **apagado**, no activo.
8. **Una IA activa nunca genera tarea humana**, con su excepción.
9. **Dos etiquetas por agente**, y el filtro del automatismo va por nombre completo.
10. Congelado = **ningún** territorio, se ve, y el total lo **desglosa**.
