# 04 · El dinero — qué se registra hoy, y qué no

**El enlace y la venta son dos cosas que hoy no se tocan.**

```
   el vendedor manda el enlace          el contacto paga          el vendedor registra la venta
              │                              │                              │
              │                              │                              │
        no queda registro              nadie se entera              a mano, en el Avanzar
```

**Los tres pasos existen. Las dos flechas del medio, no.**

---

## 1 · Dónde se registra un cobro hoy: el Avanzar

**A mano, y es la única vía.** El vendedor elige la salida que corresponde y escribe el monto.

| Salida             | Qué pide                         | Dónde va el monto                                                |
| ------------------ | -------------------------------- | ---------------------------------------------------------------- |
| **Venta** (grande) | Forma de pago + monto            | El detalle del avance **y el valor de la oportunidad en el CRM** |
| **Adelanto**       | Ídem                             | Solo el detalle — **no toca el CRM**                             |
| **Venta chica**    | Producto + monto + forma de pago | Solo el detalle — **no toca el CRM**                             |

### Por qué el adelanto no toca el valor de la oportunidad

> **Una seña pisaría el valor real del trato.**

### Y por qué la venta chica tampoco

> **Es otra venta, mucho menor, sobre el mismo contacto.** Escribirla ahí **destruiría el valor de la
> venta grande** que el otro vendedor todavía puede cerrar.

**Las dos decisiones están tomadas y hay que respetarlas.** Ver la carpeta `setter`, documento `03`.

---

## 2 · Las tres listas de "qué vendemos y a cuánto", y ninguna se habla con las otras

Es el hallazgo que más importa antes de diseñar nada:

| Dónde                               | Qué contiene                                   | Quién la mantiene               |
| ----------------------------------- | ---------------------------------------------- | ------------------------------- |
| **El catálogo de enlaces**          | Etiqueta, URL, procesador, monto de referencia | El administrador, por navegador |
| **Los productos de la venta chica** | Tres productos con su precio                   | **Nadie: están en el código**   |
| **El monto que se registra**        | Un número que el vendedor escribe o corrige    | El vendedor, caso por caso      |

### La segunda es la que sorprende

**La lista de productos de la venta chica está escrita en el código**, con tres entradas y su precio
adentro del nombre. **Y el precio prellena el monto**: elegir el producto completa la cifra sola.

> **Es una semilla que quedó**: el catálogo de enlaces se vació, los porcentajes de comisión se
> movieron a la base, y **esta lista se quedó como estaba.**

**Consecuencia:** una empresa que venda otra cosa, o al mismo producto a otro precio, **registra sus
ventas chicas eligiendo entre tres productos que no son suyos** — y con un monto prellenado que
tampoco.

**El monto es editable**, así que el número final puede ser correcto. **El producto no**: queda
guardado el nombre de la lista fija.

---

## 3 · Qué NO conecta el enlace con la venta

| Lo que falta                                  | Consecuencia                                                   |
| --------------------------------------------- | -------------------------------------------------------------- |
| **El enlace no lleva el contacto**            | El mismo enlace para todos: no se sabe quién pagó cuál         |
| **Insertar un enlace no deja registro**       | No hay "se le mandó el link el martes"                         |
| **Nada avisa cuando alguien paga**            | El vendedor se entera **porque el contacto se lo dice**        |
| **El monto del enlace no prellena la venta**  | Se vuelve a escribir a mano, y puede no coincidir              |
| **Nada compara lo cobrado con lo registrado** | Una venta registrada de más o de menos **no la detecta nadie** |

> **La consecuencia de fondo es una sola: el sistema no sabe si a alguien le entró plata. Sabe lo que
> un vendedor dijo que entró.**

**Para muchos negocios eso alcanza** —el vendedor es quien cierra y quien registra— pero es una
decisión, no un accidente, y conviene tomarla a conciencia. Ver el `05`.

---

## 4 · Lo que sí está bien resuelto y conviene copiar

No todo es un hueco. Estas tres decisiones ya están tomadas y sostienen cualquier cosa que se
construya encima:

| Decisión                                                                          |
| --------------------------------------------------------------------------------- |
| **El monto vive en el detalle del avance**, que es de donde lo leen los tableros  |
| **Las bases viajan con la comisión**: un número sin su base no se puede verificar |
| **Sin porcentaje cargado no se muestra `$0`**, porque `$0` afirma que ganó cero   |

**Y una cuarta, que es la que impide inventar:**

> **Nunca reportar un éxito que no ocurrió.** Aplicada acá: **si el sistema no puede saber que alguien
> pagó, no puede mostrar que pagó.** Un estado "pagado" derivado de que el vendedor mandó el enlace
> sería exactamente eso.

---

## 5 · La pregunta que hay que responder antes de construir

> **¿El enlace de pago es un marcador de páginas compartido, o es el principio de un circuito de
> cobro?**

| Si es un marcador                              | Si es un circuito de cobro                              |
| ---------------------------------------------- | ------------------------------------------------------- |
| Lo del `03` alcanza: moverlo a la base y listo | Hace falta generar el enlace por contacto               |
| El monto sigue siendo de referencia            | El monto lo fija el sistema, no el vendedor             |
| La venta se sigue registrando a mano           | Alguien tiene que avisar que se pagó                    |
| **Se puede terminar esta semana**              | **Es un proyecto, con una decisión de negocio adentro** |

**Las dos son respuestas válidas.** Lo que no se puede es construir la primera y presentarla como la
segunda.

---

## Lista de verificación

1. El cobro se registra **a mano, en el Avanzar**, y es la única vía.
2. **Solo la venta grande** escribe el valor de la oportunidad en el CRM.
3. **El adelanto y la venta chica no lo tocan**, y las dos razones están escritas.
4. Hay **tres listas de precios** que no se hablan entre sí.
5. Los **productos de la venta chica están en el código**, y prellenan el monto.
6. El enlace **no lleva contacto, no deja registro, y nadie avisa que se pagó**.
7. El sistema **no sabe si entró plata**: sabe lo que un vendedor dijo.
8. **Un estado "pagado" derivado de haber mandado el enlace sería un éxito inventado.**
9. Hay **una pregunta previa** —marcador o circuito de cobro— y decide todo lo demás.
