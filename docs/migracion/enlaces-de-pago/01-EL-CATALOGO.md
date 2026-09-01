# 01 · El catálogo de enlaces

**Una lista de URLs con etiqueta, que el administrador carga y el equipo usa desde el chat.**

---

## 1 · Una entrada: seis campos

| Campo            | Tipo                                      | Obligatorio | Qué es                                                     |
| ---------------- | ----------------------------------------- | ----------- | ---------------------------------------------------------- |
| **Etiqueta**     | Texto                                     | Sí          | Lo que lee el vendedor en el menú                          |
| **Categoría**    | Una de la lista, o nueva                  | Sí          | Para agrupar el menú                                       |
| **URL**          | Texto                                     | Sí          | Lo que se inserta en el mensaje                            |
| **Procesador**   | Texto libre                               | —           | Con qué se cobra. **Es informativo**: no conecta con nada  |
| **Monto**        | Número                                    | **No**      | De referencia. **No cobra**: se muestra al lado del nombre |
| **Visible para** | Vendedor de una etapa, la otra, o las dos | Sí          | Quién lo ve en su menú                                     |

### El monto es opcional a propósito, y hay que respetarlo

**Hay enlaces sin monto** —un formulario, un recurso, un catálogo— y hay enlaces con monto fijo. La
diferencia se ve en el menú: con monto, el ítem dice **monto + procesador**; sin monto, **solo el
procesador**.

> **Un monto obligatorio obligaría a inventar un número para las entradas que no cobran nada.**

### Y el monto NO es el monto de la venta

Es lo que dice esa página de pago. **No prellena el registro de la venta, no lo verifica, y no se
compara con lo que efectivamente entró.** Ver el `04`.

---

## 2 · Las categorías

**Son etiquetas de organización libres**, y hay tres de arranque:

```
Enlaces de pago  ·  Low-ticket  ·  Recursos
```

| Regla                                                                           |
| ------------------------------------------------------------------------------- |
| El formulario ofrece las existentes **y "+ Crear nueva"**                       |
| Una categoría nueva se agrega **al crear el enlace**, no en una pantalla aparte |
| **Las categorías vacías no se dibujan** en el menú del chat                     |
| Se guardan junto al catálogo                                                    |

> **Las tres de arranque se dejaron a propósito cuando se vaciaron las demás semillas**: son
> etiquetas de organización, no datos que se puedan confundir con algo cobrable, y **sin ninguna el
> formulario de alta arranca sin dónde clasificar**.

---

## 3 · El alcance por rol

Cada enlace declara para quién es: **el vendedor de post-agenda, el de pre-agenda, o los dos.**

**No es cosmético:** las dos etapas venden cosas distintas. El producto chico del setter no tiene por
qué aparecerle al closer, y el enlace de la venta grande no tiene por qué aparecerle a alguien que
todavía está calificando.

> **Y "los dos" es una opción explícita**, no la ausencia de elección. Un enlace sin alcance no
> aparecería en ningún lado y nadie sabría por qué.

---

## 4 · La pantalla de administración

Vive en la configuración, en la sección de **operación del equipo**, y **la ve solo el
administrador**.

Es una tabla con las seis columnas y dos acciones:

| Columna                                                  | Acción                           |
| -------------------------------------------------------- | -------------------------------- |
| Etiqueta · Categoría · Monto · Procesador · Visible para | **Editar** y **Borrar** por fila |

Más un botón de **agregar**, que abre el mismo formulario.

### Se guarda con un botón, no al tipear

Los cambios se acumulan y **se persisten cuando la persona aprieta "Guardar cambios"**.

> Es deliberado: **así el botón tiene un propósito real y no es cosmético.** Y hay un indicador de
> "hay cambios sin guardar" para que nadie se vaya creyendo que guardó.

**Al replicarlo, esa es la parte que hay que conservar**: el estado intermedio es visible, y salir sin
guardar no debería perder trabajo en silencio.

---

## 5 · La regla que ya costó una corrección: nunca una semilla que parezca un cobro

El catálogo **venía con dos enlaces de ejemplo** a un dominio de prueba. Se borraron.

> **El vendedor los veía en el menú junto a los reales, y un link de cobro falso que se puede mandar
> por accidente es peor que la ausencia del menú.**

**El catálogo arranca vacío y lo carga cada empresa.** Un menú vacío es un estado honesto: dice "todavía
no hay enlaces cargados", que es exactamente lo que pasa.

> **Y hay un detalle de migración que conviene tener presente:** lo que ya quedó guardado en el
> navegador de alguien **no se limpia solo**. Si alguien todavía ve un enlace de ejemplo, es su copia
> vieja. Ver el `03`.

---

## 6 · Lo que un enlace NO tiene, y hace falta saberlo antes de diseñar

| No tiene                         | Consecuencia                                                    |
| -------------------------------- | --------------------------------------------------------------- |
| **Un identificador de contacto** | El mismo enlace se le manda a todos: no se sabe quién pagó cuál |
| **Una fecha de vencimiento**     | Un enlace viejo con un precio viejo sigue funcionando           |
| **Un estado**                    | No hay "activo / pausado": o está en la lista o se borra        |
| **Un historial**                 | No queda registro de quién lo mandó, a quién, ni cuándo         |
| **Una moneda declarada**         | El monto es un número suelto                                    |

**Ninguna de esas ausencias es un defecto de implementación**: son decisiones que nunca se tomaron. El
`05` las lista como lo que son.

---

## Lista de verificación

1. **Seis campos**, y el monto es **opcional**.
2. El monto es **de referencia**: no cobra, no prellena y no se verifica.
3. El procesador es **texto libre e informativo**.
4. **Categorías libres**, tres de arranque, y las vacías no se dibujan.
5. **Alcance por rol**, con "los dos" como opción explícita.
6. La administración es **del administrador**, con guardado explícito.
7. **Ninguna semilla que parezca un cobro real.**
8. Un enlace **no tiene contacto, ni vencimiento, ni estado, ni historial, ni moneda**.
