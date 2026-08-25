# 02 · Pipeline — las reglas

Siete columnas, en orden del embudo:

**Agendado · Seguimiento · Cierre en curso · Ganado · No-show · Nurture · Descalificado**

**El Pipeline son TODOS los contactos del territorio**, clasificados en una de las siete. No es una
selección ni una vista filtrada: es el universo completo, repartido. Si un contacto del territorio no
aparece en ninguna columna, hay un defecto.

Y como Mi Día, **no habla con el CRM**: es una consulta a la caché propia.

---

## Regla 1 · La etapa vive en la base propia, no en el CRM

Es la regla de la que dependen todas las demás, y es una inversión respecto de lo que parece natural.

| Situación                                | De dónde sale la etapa                    |
| ---------------------------------------- | ----------------------------------------- |
| El contacto **ya recibió un Avanzar**    | **De la base propia.** Ahí manda, y punto |
| El contacto **nunca recibió un Avanzar** | Se **deriva de los tags**, en la lectura  |

**En el CRM no hay ningún campo "etapa" que leer.** El stage lo mueve un workflow disparado por el tag,
y la búsqueda de contactos devuelve tags, no stages. Así que la etapa **se deduce**.

Dos consecuencias que hay que respetar:

- **Un solo lugar deduce la etapa.** La misma función la usan el endpoint y el frontend, para que los
  dos clasifiquen igual. Dos implementaciones de esto divergen en silencio, y el resultado es un
  contacto que el contador cuenta en una columna y la lista pinta en otra.
- **El refresco de contacto no toca la etapa.** Cuando se relee un contacto del CRM se actualizan sus
  tags, su nombre, sus teléfonos — **nunca su etapa**. Si la tocara, un Avanzar registrado hace cinco
  minutos se perdería en el próximo refresco.

---

## Regla 2 · La etapa manda la columna. La cita es un dato de la fila

> Nunca se arma una columna a partir de las citas.

Cuando la columna "Agendado" se armaba desde la caché de citas, **había contactos que el contador
contaba y que no tenían fila en ninguna parte**: el contador miraba una lista y la columna otra.

La cita **se muestra** en la fila —es la información más útil de la columna Agendado— pero **no decide**
a qué columna pertenece nadie.

---

## Regla 3 · La etapa de entrada es explícita, no un valor por defecto

Un contacto del territorio sin ningún tag de desenlace es alguien que **ya agendó** —el traspaso de
territorio ocurre justo al agendar— y que **todavía no recibió ningún Avanzar**.

Eso es exactamente **Agendado**: la etapa de entrada del embudo. **No es "no sé dónde ponerlo".**

Por eso va declarada como una constante con nombre y no escondida en un valor de reserva al final de la
función. Es una regla de negocio, no un detalle de programación — y escrita así, el día que alguien
quiera cambiarla sabe dónde mirar.

---

## Regla 4 · Los tags se acumulan, así que hace falta una prioridad declarada

Es la regla menos evidente y la que más se nota si falta.

**Registrar un resultado nuevo no borra los anteriores**, y el arreglo de tags que devuelve el CRM **no
trae fechas**. Así que un contacto puede llegar con `seguimiento` **y** `venta_ganada` a la vez, y el
orden en que el CRM los liste es arbitrario.

> Sin una prioridad declarada, **la misma persona cae en una columna o en otra según cómo vino ordenada
> la respuesta**. Dos cargas de la misma pantalla la muestran en dos lugares distintos.

### El criterio: cuál de los tags presentes describe mejor el PRESENTE

Los tags no envejecen igual:

- **Los cinco desenlaces exclusivos** —venta, adelanto, descalificado, nurture, no-show— **se limpian
  entre sí**: registrar uno quita los otros cuatro. Si uno está puesto, es el último que se registró.
- **`seguimiento` no lo quita nadie.** Sirve antes y después de la llamada, así que convive con todos.
  Una vez que un contacto pasó por seguimiento, **arrastra el tag para siempre**. Prueba que **estuvo**
  en seguimiento, nunca que **está**.

De ahí sale el orden: los cinco exclusivos ganan sobre `seguimiento`, y entre ellos se ordenan por qué
tan definitivo es el desenlace.

| #   | Tag               | Columna         | Por qué en ese lugar                                                        |
| --- | ----------------- | --------------- | --------------------------------------------------------------------------- |
| 1   | `venta_ganada`    | Ganado          | Se cobró. Terminal: nada lo supera                                          |
| 2   | `adelanto_ganado` | Cierre en curso | Hay plata comprometida. Más que pendiente, menos que cobrado                |
| 3   | `descalificado`   | Descalificado   | Cerrado en negativo: es una **decisión tomada**, no una espera              |
| 4   | `nurture_appflow` | Nurture         | También frío, pero **explícitamente reversible**. Por eso debajo del "no"   |
| 5   | `noshow`          | No-show         | Es un **hecho operativo**, no una resolución: el contacto sigue vivo        |
| 6   | `seguimiento`     | Seguimiento     | El más pegajoso, y por eso **la señal más débil**: gana solo si es el único |

### El caso que justifica todo el orden

**Seguimiento durante semanas y después "no le interesa".** El contacto queda con los dos tags. Si
`seguimiento` ganara, seguiría apareciendo en **la columna de trabajo activo** de un closer que ya lo
dio por perdido — todos los días, para siempre.

### Lo que NO entra en la prioridad

| Qué                                                      | Por qué queda afuera                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Los tags de **modo** de seguimiento (automático, manual) | Dicen **cómo** se persigue, no en qué terminó. Nunca se escriben sin `seguimiento`   |
| Las **series del setter**                                | El traspaso de territorio **no las quita**: un contacto recién agendado las arrastra |

La segunda es la importante: tratar las series del setter como desenlace **metería en Seguimiento a
buena parte de los que en realidad están en Agendado**.

---

## Regla 5 · La lectura de tags es tolerante; la escritura es exacta

Dos criterios opuestos a propósito, y los dos son correctos:

| Operación    | Criterio                                 | Por qué                                                                                                      |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Escribir** | Coincidencia **exacta**, letra por letra | Un valor que no coincide hace que el CRM **devuelva éxito y no escriba nada**                                |
| **Leer**     | Se ignoran mayúsculas y espacios         | Si la subcuenta guardó `Venta_Ganada`, no reconocerlo mandaría a un contacto vendido a la columna equivocada |

Y los tags desconocidos **se ignoran en silencio, a propósito**: la subcuenta tiene decenas —de
campañas, de origen, de estado— y ninguno dice en qué terminó la llamada. **Solo los seis desenlaces
clasifican.**

---

## Regla 6 · Toda columna existe siempre, aunque esté vacía

> Una sección vacía muestra su encabezado con el conteo y un mensaje. **No desaparece del DOM.**

Y con **dos mensajes distintos según la causa**, porque no significan lo mismo:

| Mensaje                                       | Cuándo                                 |
| --------------------------------------------- | -------------------------------------- |
| "Sin contactos en esta etapa"                 | La etapa está vacía de verdad          |
| "Ninguno coincide con el filtro seleccionado" | Hay contactos, pero el filtro los sacó |

Con un solo mensaje, el usuario no puede distinguir "no tengo nada que hacer acá" de "estoy mirando con
un filtro puesto y me olvidé".

**Y el corolario:** todo valor que el filtro **ofrece** tiene que tener su sección. Un filtro que ofrece
una opción que no lleva a ninguna parte es un filtro que miente.

**El contador va con las siete claves siempre presentes**, incluidas las que dan cero. Si se armara solo
con las que tienen contactos, las columnas vacías no tendrían de dónde sacar su número.

---

## Regla 7 · Los congelados se ven

Un contacto **congelado** es uno que perdió el tag de territorio: ya no es trabajo de este closer.

> **No desaparece.** Se muestra con opacidad reducida y una marca de "fuera de zona" con su
> explicación, y **sigue siendo movible**.

Y el contador de la base total **desglosa**: `N activos · M congelados`. Un total que los sume sin
distinguir hace que los números de esta pantalla no cierren con los de ninguna otra.

Si desaparecieran, el closer vería bajar su pipeline sin ninguna explicación disponible.

---

## Regla 8 · La tercera columna cambia de significado

| En la etapa    | La tercera columna muestra |
| -------------- | -------------------------- |
| Agendado       | **Próxima cita**           |
| Las otras seis | **Última actividad**       |

En Agendado, lo único que importa es cuándo es la reunión. En el resto, la cita ya pasó o no existe, y
lo que importa es hace cuánto que no pasa nada.

Y una cita **vencida** en la columna Agendado se muestra en ámbar con el prefijo "cita vencida", nunca
oculta: es justo el caso que hay que atender.

---

## Cómo se actualiza

**El Pipeline no tiene reloj propio, y es deliberado.** Se pide:

| Cuándo                      | Por qué                                           |
| --------------------------- | ------------------------------------------------- |
| Al **montar** la pantalla   | Hay que mostrar algo                              |
| Al **recuperar el foco**    | El usuario volvió y quiere ver fresco             |
| Después de **cada Avanzar** | Es el único evento que mueve a alguien de columna |

Pedirlo entre esos tres momentos **solo redibujaría lo mismo**: la etapa vive en la base propia y no
cambia sola. Un reloj acá sería tráfico sin información nueva.

Está desarrollado en el documento `04` de esta carpeta.

---

## Lista de verificación

1. El Pipeline son **todos** los contactos del territorio, sin excepción.
2. La etapa la manda la **base propia**; solo se deriva de los tags si nunca hubo un Avanzar.
3. **Un solo lugar** deduce la etapa, compartido por el servidor y la pantalla.
4. El refresco de contacto **no toca** la etapa.
5. La **etapa manda la columna**; la cita es un dato de la fila.
6. La etapa de entrada es una **constante con nombre**, no un valor de reserva.
7. Hay una **prioridad de desenlaces declarada**, y `seguimiento` es el más débil.
8. Las series del setter **no** clasifican como desenlace.
9. Escritura exacta, **lectura tolerante**.
10. Las **siete columnas existen siempre**, con dos mensajes distintos de vacío.
11. Los **congelados se ven**, atenuados y movibles, y el total los desglosa.
12. **Sin reloj**: al montar, al recuperar el foco, y después de cada Avanzar.
