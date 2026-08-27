# 07 · La fila y los seis íconos — el componente compartido

**Un solo componente para Mi Día, el Pipeline y la Agenda.** Si son tres, divergen — y las tres parecen
correctas.

---

## 1 · La anatomía

```
[Score] NOMBRE  [chip de fuente]  [píldora de situación]  microtexto de última actividad  [6 íconos]  ›
```

| Pieza              | Qué muestra                        | Si falta el dato                                  |
| ------------------ | ---------------------------------- | ------------------------------------------------- |
| **Score**          | La letra de calificación           | Un guion, **nunca un cero**                       |
| **Chip de fuente** | De dónde vino el lead              | Un valor de reserva — **ninguna fila sin fuente** |
| **Píldora**        | La situación **real** del contacto | Solo la categoría, sin inventar subcategoría      |
| **Microtexto**     | Un evento **real** y fechado       | No se pone una frase genérica                     |
| **Seis íconos**    | El estado completo                 | Atenuados, **nunca un "0"**                       |

### La píldora: `CATEGORÍA · SUBCATEGORÍA`

Todo en mayúsculas. La categoría sale de la etapa; la subcategoría, del campo que **corresponde a esa
etapa**.

| Etapa           | Píldora                        |
| --------------- | ------------------------------ |
| Agendado        | `AGENDADO`                     |
| Seguimiento     | `SEGUIMIENTO · MUY INTERESADO` |
| Cierre en curso | `ACORDÓ COMPRAR · $5.000`      |
| Ganado          | `VENTA · CONTADO · $100`       |
| No-show         | `NO-SHOW · NO CONTESTÓ`        |
| Nurture         | `NURTURE`                      |
| Descalificado   | `NO LE INTERESA · SIN CAPITAL` |

**Cuatro reglas que van juntas:**

1. **La arma la aplicación, no el CRM.** El automatismo transporta los dos datos crudos y **no concatena
   nada**.
2. **Un solo lugar decide el formato.** Cuando se concatenaba a mano en seis puntos, el mismo estado
   producía `Seguimiento · Dudando` y `SEGUIMIENTO · DUDANDO`.
3. **Es la situación REAL, nunca una condición temporal.** "Vencido" y "estancado" son **tinte de fila y
   microtexto**, jamás píldora.
4. **Sin subcategoría no se inventa una.** Queda la categoría sola.

### El microtexto es un hecho, no una frase

"Respondió hace 2 h", "cita vencida hace 3 días". **Rojo si está vencido.** Nunca "sin actividad
reciente", que no dice nada y ocupa el mismo lugar.

---

## 2 · Una fila completada se atenúa, no se resume

Baja la opacidad, la píldora va a gris, el nombre se tacha — **y el chip de fuente y los seis íconos
siguen ahí con sus valores reales**.

Resumirla —dejar solo el nombre— ahorra píxeles y **pierde justo lo que permite decidir si hubo que
volver sobre ese contacto**.

---

## 3 · Los seis íconos

**Siempre los seis, en este orden, en el DOM.** Los inactivos se atenúan a un ~20 %. **Jamás un "0".**

| #   | Ícono  | Qué dice                                   | Cómo se calcula                                                                             |
| --- | ------ | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| 1   | 📹 + n | Reuniones que **ya tuvo** con el closer    | Citas pasadas no canceladas **menos** los no-show registrados                               |
| 2   | 📅     | Tiene una cita **futura** vigente          | Citas con fecha futura no canceladas                                                        |
| 3   | 📞 + n | Llamadas del agente de voz **contestadas** | Contadores cacheados de los campos del CRM. Intentos sin respuesta → atenuado con una marca |
| 4   | 🤖     | Estado del agente de IA                    | **Derivado de las etiquetas**, nunca de una columna                                         |
| 5   | ⏱      | Seguimiento automático corriendo           | Una serie automática pendiente                                                              |
| 6   | 💰     | Venta **cobrada**, con el monto            | El monto, **solo** si la etapa es ganado                                                    |

### La regla que sostiene los seis

> **Los calcula el SERVIDOR y viajan dentro de cada contacto, en todos los endpoints que listan
> contactos.** La pantalla no deriva ninguno por su cuenta: los pinta **un único componente** a partir de
> ese objeto.

Dicho como se especificó: _"si ese contacto se mueve a otra parte del pipeline esto siempre lo acompañará,
así que cuando se muestre en cualquier parte traerá esa información."_

**Y se cargan de una sola vez para todos los contactos de la pantalla**, no uno por fila. Una consulta
alimenta las cinco colas de Mi Día, las siete columnas del Pipeline y la ficha.

### El defecto que existía, para no repetirlo

Los seis se derivaban de campos que **solo existían en los datos de ejemplo**. Para un contacto real,
**cinco de los seis estaban permanentemente apagados**. Y el bloque de dibujo vivía duplicado en **cinco
vitrinas con lógica distinta**: el mismo contacto se veía "sin bot" en las listas y "IA activa" en la
ficha.

> **Los íconos se CALCULAN de los mismos datos que alimentan las pantallas. Nunca son un campo paralelo.**

---

## 4 · Cinco precisiones que evitan afirmar de más

**1 · Nulo y cero no son lo mismo.** En los contadores de llamadas, **nulo** = "nunca se sincronizó" y
**cero** = "el CRM dice que no contestó ninguna". La interfaz los pinta igual —atenuado— pero **la
diferencia importa para diagnosticar**.

**2 · El estado del agente nulo no se rellena.** Nulo significa "no tiene agente" o "ninguna etiqueta lo
dice". Las dos se pintan atenuadas. **Nunca se pone "activo" por conveniencia.**

**3 · El botón de videollamada no es el ícono 📹.** Uno es una **acción** —unirse a la sala—, el otro un
**hecho** —cuántas reuniones tuvo—. Son cosas distintas y conviene que sigan siéndolo.

**4 · La cita vencida no enciende ningún ícono.** Existe como dato para que el Pipeline muestre "cita
vencida" en su columna. Una cita pasada sin registrar **nunca desaparece**.

**5 · Una venta prometida no es una venta.** El ícono 💰 solo se enciende con la **cobrada**. "Acordó
comprar" también guarda un monto, pero ése vive **solo en la píldora**.

### Y una marca aparte del bloque de seis

El único distintivo junto al nombre es el de **destacado**. Todo lo demás está en los seis íconos — y
agregar un séptimo símbolo suelto es cómo se llega a tener información del contacto en dos lugares que
después se contradicen.

---

## 5 · El estado del agente de IA, en sus siete valores

El ícono 🤖 no es binario. Sale **entero de las etiquetas**:

| Estado                  | Qué significa                                         | Interruptor                  |
| ----------------------- | ----------------------------------------------------- | ---------------------------- |
| **Activo**              | El agente está atendiendo                             | Se ve                        |
| **Pausa temporal**      | Un humano escribió y el agente se apartó              | Se ve                        |
| **Pausado por fallo**   | El auditor encontró un problema — **es una urgencia** | Deshabilitado hasta resolver |
| **Apagado a mano**      | Alguien lo apagó                                      | Se ve                        |
| **Derivado**            | El agente derivó la conversación                      | Con confirmación reforzada   |
| **Muerto post-llamada** | Ya hubo llamada de cierre                             | **No se dibuja**             |
| **Sin agente**          | Ese canal no tiene bot                                | **No se dibuja**             |

**Los dos últimos no muestran interruptor**, y es distinto de mostrarlo deshabilitado: no hay nada que
encender.

---

## 6 · Qué hace un click

| Dónde                             | Qué pasa                                                     |
| --------------------------------- | ------------------------------------------------------------ |
| **En cualquier parte de la fila** | Abre la ficha **encima**, sin navegar y sin perder el scroll |
| En la flecha del final            | Lo mismo — es una afordancia, no otra acción                 |

**Una sola zona clicable por fila.** Dos acciones distintas en la misma fila obligan a apuntar, y en una
lista de treinta filas eso se paga en cada click.

---

## Lista de verificación

1. **Un componente** para las tres pantallas.
2. La píldora la arma **la aplicación**, en **un lugar**, y **no inventa** subcategoría.
3. Una condición temporal **nunca** es píldora.
4. El microtexto es **un evento real**, nunca genérico.
5. Una fila completada **se atenúa**, con todos sus datos.
6. **Los seis íconos siempre**, atenuados si no aplican, **nunca un "0"**.
7. Los calcula el **servidor**, viajan con el contacto y los pinta **un solo componente**.
8. Se cargan **de a todos**, no uno por fila.
9. **Nulo ≠ cero**, y el estado nulo **no se rellena**.
10. El estado del agente tiene **siete valores**, y dos **no dibujan interruptor**.
11. **Una sola zona clicable** por fila.
