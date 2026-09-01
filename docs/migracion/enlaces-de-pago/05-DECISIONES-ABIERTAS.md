# 05 · Decisiones abiertas

**Ninguna de estas se decidió, y ninguna se inventó en esta carpeta.** Están escritas con sus opciones
y sus consecuencias para que se puedan resolver de una vez, antes de construir.

Se ordenan por lo que bloquean: **las tres primeras bloquean el diseño; las demás son alcance.**

---

## Las que bloquean

### 1 · ¿Marcador de páginas o circuito de cobro?

**Es la decisión raíz.** Todo lo demás depende de ella.

| Opción                      | Qué implica                                                                   |
| --------------------------- | ----------------------------------------------------------------------------- |
| **A · Marcador compartido** | Mover el catálogo a la base y sacar las URLs inventadas. **Nada más.**        |
| **B · Circuito de cobro**   | Generar el enlace por contacto, recibir el aviso de pago, y conectar la venta |

**La opción A es lo que hay hoy, bien hecho.** La B es otro proyecto.

> **Y hay un punto intermedio que conviene nombrar:** el catálogo en la base **más** un registro de
> "a este contacto se le mandó este enlace tal día". Eso ya da trazabilidad **sin** depender de
> ninguna pasarela.

### 2 · Si es circuito de cobro: ¿con qué se cobra?

**El campo "procesador" es texto libre hoy** — cada empresa escribe lo que usa. Para generar enlaces
hace falta lo contrario: **una integración concreta por empresa**.

| Lo que hay que decidir                                                      |
| --------------------------------------------------------------------------- |
| **Uno solo para todas las empresas**, o **uno por empresa**                 |
| Si es por empresa, **sus credenciales van cifradas** como las demás         |
| Qué pasa con una empresa que **cobra por transferencia** y no tiene ninguno |

> **La última no es un caso raro**: la forma de pago que ya ofrece el registro de la venta chica
> incluye transferencia y efectivo. **Un circuito de cobro que solo entiende tarjeta deja afuera a la
> mitad.**

### 3 · Si nadie avisa que se pagó, ¿el estado existe?

**Si no hay aviso automático, el sistema no puede saber que alguien pagó.**

| Opción                              | Consecuencia                                                |
| ----------------------------------- | ----------------------------------------------------------- |
| **No mostrar ningún estado**        | Honesto. Se sigue registrando a mano                        |
| **Que el vendedor lo marque**       | Es un dato declarado, no medido — **y hay que decirlo así** |
| **Recibir el aviso de la pasarela** | Es el único que mide de verdad                              |

> **Lo que no se puede es derivar "pagó" de "se le mandó el enlace".** Eso es reportar un éxito que no
> ocurrió, y es la regla que atraviesa todo el producto.

---

## Las de alcance

### 4 · ¿Un enlace vence?

Hoy no. Un enlace cargado hace seis meses **sigue apareciendo con el precio de hace seis meses**.

| Opción                                           |
| ------------------------------------------------ |
| No vence — se borra a mano cuando deja de servir |
| Tiene un estado **activo / pausado**             |
| Tiene fecha de vencimiento                       |

**La del medio es la más barata y cubre el caso real**: un enlace de una promoción que terminó, que no
se quiere borrar por si vuelve.

### 5 · ¿Quién puede cargar enlaces?

Hoy **solo el administrador**. Y hay un precedente que sugiere revisarlo:

> **Los prompts de los agentes se movieron del administrador al técnico**, porque pedir el rol de
> administrador para editar un texto obliga a **dar acceso también a todas las credenciales de la
> empresa**.

**Con los enlaces de cobro el razonamiento puede ser el opuesto** —una URL de cobro sí es sensible—,
pero conviene tomar la decisión y no heredarla.

### 6 · ¿El menú necesita buscar?

Con seis enlaces, no. **Con cuarenta, sí.** Es una decisión que depende de cuántos enlaces cargue una
empresa real, y hoy no hay ninguno cargado en ninguna, así que **no hay dato**.

**No se construye hasta que exista el problema**, pero conviene que la estructura no lo impida.

### 7 · ¿Y la moneda?

El monto es **un número suelto**: no dice en qué moneda está.

| Cuándo importa                                                            |
| ------------------------------------------------------------------------- |
| Una empresa que cobra en dos monedas                                      |
| Cuando el monto del enlace se compare con el monto registrado de la venta |

**Hoy no importa porque nada los compara.** El día que se comparen, un número sin moneda es un número
que no se puede comparar.

---

## Lo que NO es una decisión: hay que hacerlo igual

Estas tres no dependen de ninguna de las de arriba, y las tres son correcciones:

| #   | Qué                                                                         |
| --- | --------------------------------------------------------------------------- |
| 1   | **Sacar los dos botones que fabrican una dirección inexistente** (`02` § 4) |
| 2   | **No dibujar "Mi link para agendar" cuando está vacío**                     |
| 3   | **Mover el catálogo a la base**, por empresa (`03`)                         |

> **La primera es la más urgente y la más chica:** hoy dos botones ponen una dirección que no existe
> en un mensaje a un cliente real.

---

## Lista de verificación

1. La decisión raíz es **marcador vs. circuito de cobro**, y hay un punto intermedio con trazabilidad.
2. Si es circuito: **con qué se cobra**, uno o por empresa, y **qué pasa con transferencia y efectivo**.
3. **Sin aviso automático no hay estado "pagado"** que se pueda afirmar.
4. Vencimiento, permisos, búsqueda y moneda son **alcance**, no bloqueantes.
5. **Tres cosas hay que hacer igual**, y la primera es la que ve un cliente.
