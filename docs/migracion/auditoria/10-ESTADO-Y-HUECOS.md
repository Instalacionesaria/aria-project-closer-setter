# 10 · Estado y huecos conocidos

Lo que está construido, lo que puede dejarlo en cero, y **los defectos que conviene heredar
sabiéndolos**. Ninguno se inventó para este documento: todos salen de leer el código.

---

## 1 · Qué está construido

| Pieza                                  | Estado                                     |
| -------------------------------------- | ------------------------------------------ |
| Motor de **chat**, los dos territorios | ✅ Construido, con rúbrica propia cada uno |
| Motor de **voz**, los dos territorios  | ✅ Construido, reusando el motor de chat   |
| **Carril amarillo** diario             | ✅ Construido                              |
| **Nivel 0** (las cinco señales)        | ✅ Construido                              |
| Los **cuatro espacios de prompt**      | ✅ Construidos, por empresa                |
| **Cola de urgentes** de los dos roles  | ✅ Construida                              |
| **Barrido de respaldo** de voz         | ✅ Construido                              |
| **Diagnóstico del embudo**             | ✅ Construido — § 2                        |

---

## 2 · Lo que puede dejar el auditor de chat en CERO, y cómo se ve

> **El portón del agente atendiendo puede bloquear al 100% de los contactos, y eso es un estado
> esperado, no una falla.**

Pasa cuando el CRM **todavía no aplica** las etiquetas de agente activo — porque los automatismos que
lo hacen están en borrador, o porque el agente firma sus mensajes distinto de lo esperado.

### Un cero silencioso es indistinguible de una caída

Por eso existe **un endpoint de diagnóstico** que recorre el embudo **contacto por contacto** y
devuelve, sin gastar una sola llamada al CRM y sin escribir nada:

| Qué reporta                                                     |
| --------------------------------------------------------------- |
| El embudo completo: cuántos pasan cada portón                   |
| El conteo de **cada etiqueta relevante**                        |
| Los mensajes salientes **por autoría**                          |
| Si el **prompt de esa empresa** está cargado                    |
| Una lista redactada de **lo que falta**, para reenviar tal cual |

> Convierte el cero en un reclamo concreto: no _"el auditor no funciona"_, sino _"0 de 8 contactos
> tienen la etiqueta de agente activo; la aplica tal automatismo, que está en borrador"_.

### Dos renglones son alarmas tempranas

| Señal                                                   | Qué significa                                                     |
| ------------------------------------------------------- | ----------------------------------------------------------------- |
| Muchos salientes **sin atribuir** y **cero del agente** | El agente firma distinto de lo esperado — se ajusta sin desplegar |
| Los mensajes **sin clasificar** clavados en un número   | La reconciliación **no está corriendo**                           |

**El primero es el que más engaña**, porque el auditor no falla: simplemente **no ve al agente**, y
todo se comporta como si el agente no existiera.

---

## 3 · El hueco que la propia rúbrica declara, y por qué

> **Una conversación donde el agente manda 4 mensajes y el contacto se va enojado nunca se auditaba.**

**Es consecuencia matemática del debounce**, no un defecto tapable — y está cerrado por el nivel 0
(`05` § 6). Lo que queda como límite honesto es el borde: **con cero mensajes nuevos del agente no
corre, ni con alarma.**

**Y la salida manual existe**: hay un disparo que ignora el debounce.

---

## 4 · Los defectos concretos que conviene heredar sabiéndolos

Son cuatro. **Ninguno rompe nada visible**, que es exactamente por qué están escritos.

### 4.1 · La pantalla de prompts dice que los dos de voz no tienen auditor — y sí lo tienen

**El motor de voz lee esos dos prompts.** La pantalla los marca como _"todavía no hay un auditor para
este agente"_.

| Consecuencia                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- |
| El técnico lee que **su prompt de voz no se está usando**, y sí se está usando                                       |
| Puede decidir **no cargarlo**, y entonces las correcciones de voz salen sin cita — degradadas por una etiqueta falsa |

**La causa es una lista escrita a mano**: el endpoint declara, campo por campo, qué auditor consume
cada prompt, y **los dos de voz quedaron declarados como "ninguno"** cuando se escribió — antes de que
el motor existiera.

> **La regla que se rompió es la de una sola derivación:** ese dato ya existe en la lista de agentes
> con auditor. Derivarlo de ahí lo habría corregido solo el día que la voz se encendió.

### 4.2 · Marcar un patrón de voz como ajustado se rechaza

La base acepta los cuatro agentes. **El endpoint que registra un ajuste valida contra una lista escrita
a mano con los dos de chat**, así que un patrón de voz devuelve _"agente inválido"_.

| Consecuencia                                                                           |
| -------------------------------------------------------------------------------------- |
| Los hallazgos de voz **aparecen** en la pantalla — la consulta no filtra por agente    |
| Pero **no se pueden cerrar** desde el botón                                            |
| Y sin ajuste registrado, **la reincidencia de voz nunca se puede calcular** (`08` § 6) |

**Mismo defecto que el anterior: una lista paralela que quedó atrás.**

### 4.3 · Una rama muerta que dice algo falso

Queda un camino que devuelve _"el auditor de chat de pre-agenda todavía no existe"_. **Ya existe**, así
que ese mensaje **es inalcanzable** — pero sigue escrito.

No causa daño hoy. **Lo causa el día que alguien lo lea buscando por qué algo no se audita.**

### 4.4 · Comentarios que describen un estado anterior

El interruptor de voz **está encendido**, y el comentario que lo acompaña sigue explicando que **el
motor todavía no existe**. Lo mismo con alguna mención a la etiqueta de fallo legada, que ya no se
escribe.

> **Un comentario que sobrevive a lo que describe enseña a no creerle a los demás.** Es la misma regla
> por la que un mensaje de "falta esto" no se le muestra a un usuario.

---

## 5 · Los tres estados que este módulo se cansó de confundir

Vale la pena tenerlos juntos, porque **son la lección que atraviesa todo el producto** y acá se pagó
tres veces:

| Confusión                                      | Cómo se ve cuando está mal                                  |
| ---------------------------------------------- | ----------------------------------------------------------- |
| **"Salió limpio"** vs. **"no lo miré"**        | Una tarjeta sana y una sin auditar se ven iguales           |
| **"No hubo ninguna"** vs. **"no se pidieron"** | Una lista vacía que también significa "no pude averiguarlo" |
| **"No existe"** vs. **"está apagado"**         | Una tarjeta bloqueada que se lee como un error              |

**Los tres se resolvieron igual**: con un valor distinto para cada hecho, y con la base impidiendo el
estado inválido cuando se pudo.

---

## 6 · Lo que falta medir

**Cada análisis guarda qué señal lo adelantó, y todavía nadie leyó ese dato.**

> **Una señal que dispara seguido y NUNCA termina en un veredicto rojo es gasto puro**, y sin esa
> lectura no hay forma de saber cuál sacar.

Es una consulta de agrupación sobre lo que ya está guardado — **no hace falta instrumentar nada más**,
solo mirarlo después de unas semanas de datos.

**Y lo mismo con el léxico**: hay una lista de pendientes declarada —variantes regionales de medios de
pago, emojis de enojo, errores de tipeo— **que a propósito no se implementó hasta ver datos reales.**

---

## 7 · Las palancas de costo declaradas y no aplicadas

Están en el `09` § 4 y se repiten acá porque son la respuesta a "¿y si crece el volumen?":

| Palanca                                                            |
| ------------------------------------------------------------------ |
| **Ventana deslizante** en vez de re-mandar el transcript entero    |
| **Resumen acumulado** de lo viejo                                  |
| **Auditar solo en el mensaje saliente** (hoy se audita en los dos) |

---

## Lista de verificación

1. **Los cuatro motores están construidos**, más el carril amarillo y el nivel 0.
2. El portón del agente **puede bloquear al 100%**, y eso es esperado, no una falla.
3. Hay un **diagnóstico del embudo** que convierte el cero en un reclamo concreto.
4. Dos alarmas tempranas: **el agente firma distinto**, y **la reconciliación no corre**.
5. El agujero del debounce **está cerrado** por el nivel 0, y queda un borde declarado.
6. **La pantalla de prompts miente sobre los dos de voz.**
7. **Un patrón de voz no se puede marcar como ajustado**, y por eso no tiene reincidencia.
8. Queda **una rama muerta** con un mensaje falso.
9. Hay **comentarios que describen un estado anterior**.
10. **Falta leer** qué señal sirve, y decidir el léxico con datos reales.
