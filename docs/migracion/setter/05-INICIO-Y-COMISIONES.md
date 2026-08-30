# 05 · Inicio del Setter — las dos comisiones y el sello de atribución

La pantalla responde una sola pregunta: **¿cuánto llevo ganado este mes?**

Y tiene dos tramos, porque el setter cobra por dos cosas distintas:

```
Comisión chica   = bruto de sus ventas chicas       × su % directo
Comisión diferida = bruto de las ventas grandes que  × su % diferido
                    cerró el closer sobre leads que
                    él originó
```

**El segundo tramo es el que define la arquitectura del módulo entero.** Sin saber qué contactos trabajó
a mano cada setter, no se puede calcular — y ahí entra el sello de atribución.

---

## 1 · Lo que esta pantalla reemplaza, y por qué importa contarlo

Antes de calcularse, el tablero eran **diez constantes escritas a mano** en el navegador: el bruto de
ventas chicas, el bruto de las diferidas, las agendas automáticas, el porcentaje de asistencia. De las
cifras que mostraba, **solo tres tenían aritmética — y las tres multiplicaban una base fija.**

> El titular de comisiones era, literalmente, **un porcentaje configurable aplicado a un número
> inventado.**

Es el defecto más caro de replicar sin darse cuenta, porque **se ve perfecto**: los números son
verosímiles, cambian cuando alguien toca el porcentaje en la configuración, y no se parecen a un
marcador de posición.

**La prueba que lo detecta es una sola:** registrá una venta y mirá si el tablero cambia. Si no cambia,
el número no sale de los datos.

---

## 2 · El sello de atribución — la pieza sin la que nada de esto existe

> **Se enciende con la primera intervención manual del setter sobre un contacto, y ya no se apaga.**

Determina si una agenda o una venta futura de ese contacto cuenta como **trabajo del setter** o como
**trabajo del sistema**, sin importar quién cierre al final.

### La regla que hay que respetar: se escribe solo si está vacío

**El segundo setter que toque el contacto no le roba la atribución al primero.** Y el primero es el que
lo originó, que es justamente lo que paga la comisión diferida.

**Que la escritura no toque ninguna fila no es un error acá**: es el sello ya encendido.

### Y tiene que estar persistido, no en memoria

Cuando el sello vivía en el navegador **se escribía en seis lugares y no se leía en ninguno**: moría al
refrescar. La comisión diferida no se podía calcular, y el tablero mostraba una base fija.

> **Es el motivo por el que el tablero es lo último que se construye y no lo primero.** Depende de un
> dato que las otras pantallas tienen que haber estado escribiendo antes.

### Un hueco conocido que conviene heredar sabiéndolo

En la pantalla, **cinco acciones** encienden el sello: responder, resolver un urgente, fijar o completar
una tarea, tocar el interruptor del agente, y registrar un resultado.

> **Solo la última lo persiste.** Las otras cuatro lo encienden **en memoria** y se pierde al refrescar.

O sea que hoy la atribución equivale, en la práctica, a "registró un resultado sobre este contacto". Si
querés el comportamiento completo, esas cuatro acciones tienen que escribir también.

**Y una regla que sí está bien y hay que copiar:** apagar el agente **automáticamente** —lo hace el
sistema— **no** enciende el sello. No es una intervención del setter.

---

## 3 · Las cinco reglas del tablero

### Regla 1 · Sin porcentaje cargado, `null` — nunca `$0`

Un setter sin su porcentaje configurado **no ve cero**: ve el campo sin dibujar, con un enlace a la
configuración.

> **`$0` afirma que ganó cero.** Eso es distinto de "nadie configuró su porcentaje", que es lo que pasa
> el primer día de cualquier empresa nueva.

Y viaja como un hecho declarado —"falta el porcentaje de este tramo"— para que la vista lo diga **sin
adivinarlo** de que el número vino vacío.

**El total sigue la misma regla:** si los dos tramos están sin configurar, el total es `null`. Si uno
está, el total es ese uno.

### Regla 2 · Las bases viajan junto a la comisión

Con la comisión van **el bruto y la cantidad de ventas** de cada tramo.

> **Un número sin su base no se puede verificar.** "$150" no le dice nada a nadie; "$150 = 30 % de $500
> en 1 venta" se puede revisar contra el CRM.

### Regla 3 · Lo que no se puede medir viaja con su motivo

Dos cifras del diseño original **no se pueden calcular todavía**, y no desaparecen: viajan vacías **con
la explicación de por qué**.

| Cifra                        | Por qué no se puede                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Agendas automáticas**      | No se puede distinguir una cita creada por el agente de una creada por un humano: el registro de citas no guarda quién la creó |
| **Porcentaje de asistencia** | Necesita saber si el contacto **asistió**, y el CRM nunca marca esa condición                                                  |

**La vista los muestra como pendientes, no como ceros.** Es la regla 1 otra vez, aplicada a una cifra que
falta por una limitación de la fuente y no por falta de configuración.

### Regla 4 · Lo que agendó el agente solo no es mérito del setter

Sus agendas son **los resultados que él registró**. Las automáticas son las citas de contactos que
**ningún setter tocó a mano**.

Mezclarlas convierte el tablero en un contador del rendimiento del agente de IA, presentado como el
rendimiento de la persona.

### Regla 5 · El mes es el de la zona horaria de la empresa

El período arranca el primero del mes **en la zona de la empresa**, no en la del servidor. Con una
empresa en otro huso, la última venta del mes cae en el mes equivocado.

> **Nunca aritmética de zonas horarias a mano.** Es la misma regla del Closer, y la que más silenciosamente
> se rompe.

---

## 4 · Por qué son consultas separadas y no un cruce

El tramo diferido necesita **las ventas grandes de los contactos atribuidos a este setter**. Se hace en
dos pasos: traer los ids atribuidos, y después filtrar las ventas por esos ids.

**No es una limitación a corregir:** el registro de resultados referencia al contacto **por su
identificador de texto**, no por una relación declarada, así que no hay cruce disponible. Y son pocos por
definición — los contactos que un setter trabajó a mano en un mes.

**Y si no hay ninguno atribuido, la segunda consulta ni se hace.** Un filtro por una lista vacía puede
traer todo en vez de nada, según el motor.

---

## 5 · El tablero cuesta cero llamadas al CRM

Todo sale de la base propia: los porcentajes, las ventas del período, los contactos atribuidos. **Y la
respuesta lo declara**, igual que las otras dos pantallas.

---

## 6 · Los tres estados de la pantalla

| Estado                  | Qué se ve                           |
| ----------------------- | ----------------------------------- |
| **Cargando**            | No se afirma nada todavía           |
| **Cargó, todo en cero** | Los ceros medidos, atenuados        |
| **No se pudo saber**    | Se dice, y **no** se muestran ceros |

> Un tablero vacío por falta de ventas y uno vacío porque el servidor no contestó **no son el mismo
> hecho**, y la persona que lo mira toma decisiones distintas según cuál sea.

---

## Lista de verificación

1. **Dos tramos**: ventas chicas propias y ventas grandes diferidas.
2. El **sello de atribución** es la pieza de la que depende el segundo tramo.
3. El sello **se escribe solo si está vacío**: el segundo setter no roba al primero.
4. El sello tiene que estar **persistido**; en memoria muere al refrescar.
5. Hoy **solo el registro de resultados lo persiste** — las otras cuatro acciones, no.
6. El apagado **automático** del agente **no** enciende el sello.
7. Sin porcentaje: **`null` y un enlace**, nunca `$0`.
8. **Las bases viajan** con cada comisión.
9. Lo que no se puede medir viaja **con su motivo**.
10. **Las agendas del agente no son del setter.**
11. El mes es el de la **zona de la empresa**.
12. **Cero llamadas al CRM**, declarado en la respuesta.
13. **Cargando, vacío y sin saber** son tres estados distintos.
