# 04 · Polling y datos en vivo del Setter

**El dato más importante de este documento: el Setter no tiene ningún reloj.**

No es una omisión de esta documentación. Es lo que hace el código, y hay que decidir a conciencia si se
replica o se corrige.

| Pantalla        | Reloj del Closer | Reloj del Setter   |
| --------------- | ---------------- | ------------------ |
| Inicio          | 60 s             | **Ninguno**        |
| Mi Día          | 10 s             | **Ninguno**        |
| Pipeline        | 10 s             | **Ninguno**        |
| Agenda          | 10 s             | — no existe        |
| El chat abierto | 5 s              | **El mismo** — § 4 |

---

## 1 · Qué refresca entonces

Las tres pantallas del setter se alimentan de **dos cargas y un evento**:

| Cuándo                      | Qué se recarga                                |
| --------------------------- | --------------------------------------------- |
| **Al montar la aplicación** | Las seis colas **y** el tablero de comisiones |
| **Tras cada resultado**     | Las seis colas — **el tablero no**, ver § 3   |
| **Al abrir una ficha**      | Las notas de ese contacto                     |

**Y nada más.** Un setter que deja la pestaña abierta media hora sigue viendo las colas de hace media
hora: un lead que respondió no aparece, y una tarea que resolvió un compañero sigue ahí.

> **Lo que sí está actualizado es lo que él mismo hace.** El resultado se pinta al instante y después se
> recarga desde la base. La ceguera es a **lo que pasa afuera**.

---

## 2 · El reloj que está declarado y no lo usa nadie

Hay una cadencia declarada para la cola roja del setter —60 segundos— y **ningún código la lee**. Está
escrita en la tabla de cadencias y referenciada solo por la documentación.

> **Un reloj declarado que nadie enciende es peor que ninguno**: hace creer que la pantalla se refresca.

Si vas a replicar esto, elegí una de las dos y no la mitad:

- **Encenderlo**: registrar las tres pantallas del setter en el mismo mecanismo de relojes del Closer.
- **Sacarlo**: borrar la cadencia declarada, para que la tabla diga la verdad.

---

## 3 · El tablero de comisiones no se recarga tras una venta chica

Es un caso concreto del mismo hueco, y **el más visible para el usuario**:

1. El setter registra una **venta chica** de $500.
2. Las colas se recargan: la tarjeta se mueve, "Completadas hoy" la cuenta.
3. **El tablero de Inicio sigue mostrando la comisión de antes**, hasta que recargue la página.

**Su propia venta no aparece en su propio tablero.** Al replicar, el resultado que toca dinero
—venta chica— tiene que disparar también la recarga del tablero.

---

## 4 · Lo que sí es en vivo: el chat

**El chat del setter es el mismo componente que el del Closer**, y con él viene su reloj de 5 segundos.
Mientras hay una conversación abierta, los mensajes entrantes aparecen solos.

Es la única parte del módulo que se actualiza sin que el usuario haga nada — y es la que más importa
que lo haga, porque el setter trabaja adentro de la conversación.

---

## 5 · Lo que no cambia: el costo hacia el CRM sigue siendo cero

Aunque no haya relojes, la regla de fondo del producto **vale igual acá**:

> **Las tres pantallas del setter cuestan CERO llamadas al CRM.** Las seis colas salen de la caché
> propia, el pipeline también, y el tablero se calcula con la base.

**Y la respuesta lo declara**: cada una informa que hizo cero llamadas. Es una afirmación verificable, no
una promesa en un comentario. Si mañana alguien mete una llamada al CRM en el camino de una pantalla, ese
número deja de ser cero y se nota.

**Esto es lo que hace que encender los relojes sea barato:** poner las tres pantallas a 10 segundos
multiplica consultas a la base propia, **no** al CRM. Es lo que hace que valga la pena hacerlo.

---

## 6 · Quién llena la caché, entonces

**El mismo motor de ingesta que alimenta al Closer**, sin nada propio del setter. Está desarrollado en el
`09` de la carpeta del Closer y acá solo importan tres consecuencias:

| Consecuencia                                                                                 |
| -------------------------------------------------------------------------------------------- |
| Un contacto **nuevo del setter** aparece cuando lo trae la ingesta, no cuando el CRM lo crea |
| La etiqueta de **estancado** —que pone el CRM— llega por la misma vía                        |
| El **traspaso al closer** también: la etiqueta cambia en el CRM y la ingesta la trae         |

**Ninguno de los tres es instantáneo**, y con las pantallas sin reloj, la demora que ve el setter es la
de la ingesta **más** el tiempo hasta que recargue.

---

## 7 · Las reglas de refresco que sí se comparten

Están desarrolladas en el `04` de la carpeta del Closer y valen igual acá:

| Regla                                                                                            |
| ------------------------------------------------------------------------------------------------ |
| **Un solo módulo de relojes** — si se encienden, se registran ahí, no con temporizadores sueltos |
| **Sin superposición**: si una carga tarda más que el intervalo, no se dispara otra encima        |
| **Se recarga siempre tras un resultado**, con éxito o con error                                  |
| **Con error se deshace el pintado optimista**, en vez de dejar la tarjeta donde no va            |
| El estado de carga distingue **"cargando"**, **"vacío"** y **"no se pudo saber"**                |

Esa última es la que evita el peor mensaje posible: una pantalla que dice "no tenés tareas" cuando en
realidad no pudo preguntarlo.

---

## 8 · Un detalle que ya costó un error: qué conserva la recarga

Las colas **no traen** notas, historial, llamadas ni perfil — eso se pide aparte al abrir la ficha. Así
que la recarga **fusiona**, no reemplaza:

> Lo que manda el servidor **pisa** (colas, etapa, píldoras: es la razón de recargar). Lo que el servidor
> no puede saber **se conserva**.

Sin esa fusión, **toda nota escrita se borraba de la pantalla un segundo después de escribirla**, porque
el resultado dispara la recarga. La nota estaba guardada; la pantalla la perdía.

---

## Lista de verificación

1. **Cero relojes** en las tres pantallas — decidí si lo replicás o lo corregís.
2. Refrescan **al montar** y **tras cada resultado**. Nada más.
3. Hay una cadencia **declarada y muerta**: encendela o borrala, no la dejes a medias.
4. El **tablero no se recarga tras una venta chica** — su propia venta no aparece.
5. **El chat sí es en vivo**, con el mismo reloj de 5 segundos.
6. Las tres pantallas cuestan **cero llamadas al CRM**, y lo declaran.
7. La caché la llena **la misma ingesta** que el Closer: nada es instantáneo.
8. La recarga **fusiona**: pisa lo del servidor, conserva notas e historial.
9. **"Cargando", "vacío" y "no se pudo saber"** son tres estados distintos.
