# 02 · Pipeline del Setter — las siete etapas propias

**Nuevo → En calificación → Calificado sin agendar → Oferta chica → Agendado → Nurture → Descalificado**

Son siete como las del Closer, y **ninguna es la misma**. Es otro embudo, no una variante.

| Etapa                      | Qué significa                                  | Terminal para el setter |
| -------------------------- | ---------------------------------------------- | ----------------------- |
| **Nuevo**                  | Entró y nadie lo tocó                          | No                      |
| **En calificación**        | Hay conversación, todavía no hay veredicto     | No                      |
| **Calificado sin agendar** | Califica y no agendó — **la columna caliente** | No                      |
| **Oferta chica**           | Se le ofreció el producto chico                | No                      |
| **Agendado**               | **El traspaso.** Ya es del closer              | **Sí**                  |
| **Nurture**                | Frío, reversible                               | Sí                      |
| **Descalificado**          | No califica                                    | Sí                      |

**"Agendado" es terminal para el setter y de entrada para el closer.** Es la misma columna vista desde
los dos lados del traspaso.

---

## Regla 1 · La etapa vive en la base propia

Igual que en el Closer: la etapa la escribe el registro de resultados y **nadie más**. Si nunca hubo uno,
se deriva de las etiquetas.

**Y acá esa regla es más importante que allá**, por lo que viene abajo: la mayoría de las etapas del
setter **no tienen etiqueta en el CRM**, así que si la base no mandara, cuatro de las siete columnas no
existirían.

---

## Regla 2 · Solo TRES etapas tienen etiqueta propia, y las otras cuatro no la necesitan

Es la decisión que más se copia mal, porque la salida obvia es crear siete etiquetas.

| Etapa                  | Etiqueta                                                                     |
| ---------------------- | ---------------------------------------------------------------------------- |
| Nuevo                  | **Propia** (pendiente de crear)                                              |
| En calificación        | **Propia** (pendiente de crear)                                              |
| Calificado sin agendar | **Propia** (pendiente de crear)                                              |
| **Oferta chica**       | La etiqueta de **derivación** — ofrecerle el producto chico **es** derivarlo |
| **Agendado**           | **Ninguna.** Lo resuelve el traspaso de territorio                           |
| **Nurture**            | La misma que usa el Closer                                                   |
| **Descalificado**      | La misma que usa el Closer                                                   |

> **Crear una etiqueta para "Agendado" sería una segunda fuente para el mismo hecho.** El traspaso ya lo
> dice, y dos fuentes divergen.

Y las otras tres reusan etiquetas que ya existen y **significan exactamente eso**. Duplicarlas sería
tener dos nombres para un estado.

### Las tres que faltan son las de calificación, y eso tiene sentido

Son **el trabajo específico del setter** — el tramo que el CRM no representaba porque el módulo nunca
escribió nada.

---

## Regla 3 · Las etapas pendientes NO se mandan, y la aplicación funciona igual

Las tres etiquetas de calificación **todavía no existen en la cuenta**. Y eso no bloquea nada:

| Qué                                   | Estado                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| Las **siete columnas** de la pantalla | **Funcionan desde el día uno**                         |
| La etapa                              | Vive en la **base propia**, que es la fuente de verdad |
| El aviso al CRM                       | **No sale** hasta que la etiqueta exista               |

> **Y se enciende sola** el día que las etiquetas existan: no hay que tocar código, solo marcarlas como
> disponibles.

**El mecanismo que lo hace posible** es que cada literal lleve declarado su nivel de confianza, y que un
literal pendiente **no se pueda mandar**. Sin eso, la aplicación escribiría una etiqueta inexistente —
que el CRM acepta y descarta, sin avisar.

**Y la pantalla lo dice.** La columna cuya etiqueta todavía no existe lo indica; es un hecho de la
columna y la vista puede decirlo sin inventar nada.

---

## Regla 4 · Mover una tarjeta escribe la etapa, y avisa al CRM si puede

Arrastrar entre columnas:

1. Escribe la etapa en la **base propia** — la fuente de verdad.
2. Manda la etiqueta al CRM **para que dispare sus automatismos**, si esa etapa tiene etiqueta y existe.

**En ese orden.** Al revés, un fallo de la base dejaría al CRM disparando automatismos por una etapa que
acá no existe.

**Y las etapas son excluyentes**, así que el aviso al CRM también **quita las etiquetas de las otras
etapas** — salteando las que todavía no existen. Sin eso, un contacto queda con dos etapas puestas y la
próxima lectura por etiquetas elige cualquiera de las dos.

### El paso 2 no puede tumbar el paso 1

Cuando la etiqueta no se puede mandar —no existe, o esa etapa no tiene—, **eso no es un error**: es el
estado esperado. La respuesta lo reporta **efecto por efecto**, con "se hizo" separado de "salió bien", y
con el motivo escrito. Lanzar acá sería lo peor posible: la etapa **ya se guardó**, así que el usuario
vería un error y la tarjeta movida.

### Y sobre un contacto congelado, la operación se rechaza

Un contacto que **perdió su territorio en el CRM** se sigue viendo en su columna, atenuado, y **no se
mueve**: el intento devuelve un rechazo con su motivo. Escribirle una etiqueta sería mandar una orden
sobre alguien que ya no está en el embudo.

**Se rechaza antes de escribir nada** — no se guarda la etapa y después se avisa.

---

## Regla 5 · Lo que se hereda del Pipeline del Closer

Estas valen igual y no se repiten acá — están desarrolladas en el `02` de la carpeta del Closer:

| Regla                                                                 |
| --------------------------------------------------------------------- |
| **La etapa manda la columna**; la cita es un dato de la fila          |
| **Toda columna existe siempre**, con dos mensajes de vacío distintos  |
| El contador lleva **las siete claves**, incluidas las que dan cero    |
| **Los congelados se ven**, atenuados y movibles                       |
| **Escritura exacta, lectura tolerante** de etiquetas                  |
| **Sin reloj**: al montar, al recuperar el foco, y tras cada resultado |

---

## Regla 6 · La prioridad de resultados, y qué NO clasifica acá

Como en el Closer, las etiquetas **se acumulan** y hace falta una prioridad declarada.

Pero hay una diferencia propia del Setter que conviene tener presente **en el otro sentido**:

> **Las series de seguimiento del setter no clasifican como resultado — ni acá ni en el Closer.**
>
> Y en el Closer eso es crítico: **el traspaso de territorio no las quita**, así que un contacto recién
> agendado **las sigue arrastrando**. Tratarlas como resultado metería en Seguimiento a buena parte de
> los que en realidad están en Agendado.

---

## Lista de verificación

1. **Siete etapas propias**, ninguna igual a las del Closer.
2. "Agendado" es **terminal acá y de entrada allá**: es el traspaso.
3. La etapa vive en la **base propia**; acá eso sostiene cuatro columnas sin etiqueta.
4. **Solo tres etapas** necesitan etiqueta nueva. Las otras cuatro reusan o no necesitan.
5. **Ninguna etiqueta para "Agendado"**: sería una segunda fuente para el mismo hecho.
6. Un literal **pendiente no se manda**, y la aplicación **funciona igual**.
7. La columna con etiqueta pendiente **lo dice**.
8. Mover una tarjeta: **base primero, CRM después**, y quitando las etiquetas de las otras etapas.
9. El aviso al CRM **nunca lanza**: la etapa ya se guardó. Se reporta efecto por efecto.
10. Un contacto **congelado se ve y no se mueve** — se rechaza antes de escribir.
11. Las **series del setter no clasifican** como resultado en ninguno de los dos módulos.
