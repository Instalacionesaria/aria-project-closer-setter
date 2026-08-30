# 01 · Mi Día del Setter — las seis colas

**Seis, no cinco.** Dos que el Closer no tiene, y una del Closer que acá no existe.

| Cola                              | ¿La tiene el Closer? | Cuenta para el contador   |
| --------------------------------- | -------------------- | ------------------------- |
| **1 · Intervenciones urgentes**   | Sí                   | **Sí**                    |
| **2 · Conversaciones estancadas** | **No**               | **Sí**                    |
| **3 · Oportunidades chicas**      | **No**               | **Sí**                    |
| **4 · Respondieron · buzón**      | Sí                   | **Sí**                    |
| **5 · Seguimientos de hoy**       | Sí                   | **Sí**, con una excepción |
| **6 · Completadas hoy**           | Sí                   | No                        |
| ~~Agenda de hoy~~                 | Sí                   | — **no existe acá**       |

**La agenda no existe y no es un pendiente:** el setter trabaja **por definición antes de que haya
cita**. Ponerle una sección de citas sería una sección permanentemente vacía.

**Una sola llamada trae las seis**, y **no habla con el CRM**: una consulta base alimenta tres colas, más
una consulta puntual por cada una de las otras.

---

## La regla de fondo, y de dónde viene

> **Cero banderas. Las seis colas se derivan de datos.**

Vale la pena decir de dónde salió, porque es el defecto que este módulo pagó:

Las colas salían de **booleanos escritos a mano en objetos de ejemplo** — `urgente: true`,
`estancada: true`, `oportunidadLt: true`. **No había una fecha ni un contador detrás de ninguna**: el
"se apagó hace 11 h" era un texto fijo. Un contacto entraba a una cola porque alguien había escrito la
bandera, y salía cuando la acción la borraba.

**Un estado guardado se desincroniza; una consulta no puede.**

Y hay una segunda regla que se hereda del Closer y acá también aplica: **quien arma las colas es dueño
de su consulta**. Si otro código lee esas filas pidiendo menos columnas, el compilador no dice nada y la
pantalla degrada en silencio.

---

## El portón: la etiqueta de territorio

Antes que cualquier cola, **un filtro**: solo entran los contactos con la etiqueta del setter. Es el
mismo mecanismo que la etiqueta del closer, y es lo que hace que **un contacto esté en las colas de un
rol o del otro, nunca en las dos** — las etiquetas de territorio son mutuamente excluyentes.

---

## Cola 1 · Intervenciones urgentes

Mismo criterio que el Closer, cambiando qué agente falló: entra el contacto con una etiqueta de fallo del
auditor **y** la etiqueta del territorio del setter.

### Y hoy está vacía a propósito

> **El auditor del setter todavía no existe**, así que nadie aplica una etiqueta de fallo sobre un
> contacto de pre-agenda.

Tres decisiones de cómo se maneja eso, y las tres importan:

1. **La derivación va escrita igual.** El día que el auditor exista, **la cola se llena sola**, sin tocar
   nada.
2. **La sección no se atenúa ni se oculta.** Vacía porque su auditor no existe es un hecho **distinto** de
   vacía porque hoy no hay urgencias.
3. **Y no se le muestra al usuario un texto de diagnóstico** explicando que falta el auditor. Eso es
   jerga interna: quien lo lee no puede hacer nada con ella, y el día que el auditor exista el texto
   queda mintiendo.

**El punto 3 es la corrección de un defecto real** — ver el `04` de la carpeta del Closer sobre por qué
un mensaje de falta que sobrevive a lo que describe enseña a no creerle a los demás.

---

## Cola 2 · Conversaciones estancadas

**Propia del Setter.** Leads que se apagaron.

### Qué va

Los contactos **no congelados** que tienen la **etiqueta de estancado**.

### Quién decide que está estancado — y no somos nosotros

> **La etiqueta la aplica un barrido del CRM contra su propia ventana de inactividad.** Acá **solo se
> lee**.

Es la misma relación que tiene el Closer con esa etiqueta. Medir el estancamiento por nuestra cuenta
sería una segunda fuente para el mismo hecho, y dos fuentes divergen.

### Cómo se muestra

Tinte ámbar y una línea de inactividad — **pero la píldora sigue mostrando la situación real** ("en
calificación", "nuevo").

> **El estancamiento es una condición temporal, y las condiciones temporales nunca son píldoras.** Es la
> misma regla que hace que "vencido" tampoco lo sea.

### El ciclo de rescates — y una advertencia sobre lo que está escrito

El diseño de producto define un ciclo: la fila muestra el contador ("2º rescate"), enviar el rescate
completa la tarea, y **al tercero el sistema mueve el contacto solo** a nurture sin respuesta, con autor
`Sistema`. Si después responde, reaparece en Respondieron.

> **Ese contador y ese tope de tres NO están en la derivación de la cola.** La cola es hoy "tiene la
> etiqueta de estancado", sin contador y sin tope. Si vas a replicar el ciclo completo, es trabajo a
> escribir, no a copiar.

### Un hueco conocido, que conviene heredar sabiéndolo

En el canal con agente, enviar el rescate dispara la pausa temporal y el agente retoma. **En el canal sin
agente no hay bot**, y el mecanismo que documentaba cómo completar un rescate ahí dependía de un botón
que se eliminó. **No hay vía definida.** No se inventó un reemplazo.

---

## Cola 3 · Oportunidades chicas

**Propia del Setter.** Contactos que el agente derivó porque no califican para el producto grande pero sí
pueden comprar algo chico.

### Qué va

Los **no congelados** con la etiqueta de derivación.

> **Acá esa etiqueta significa exactamente lo que dice**: derivado a producto chico. Es distinto del uso
> que tiene en el registro de resultados, donde significaría una venta — y ahí **no** se usa. Ver el
> `03` § 3.

### Cómo se muestra

Tinte violeta, con un aviso **informativo** — sin bloquear nada. Y devolver el contacto al camino del
producto grande **pide una confirmación reforzada**, porque es deshacer una decisión que tomó el agente
con información de la conversación.

---

## Cola 4 · Respondieron · buzón general

**Mismo criterio que el Closer**, con las mismas condiciones y sin una sola bandera:

| #   | Condición                                                     |
| --- | ------------------------------------------------------------- |
| 1   | No está congelado                                             |
| 2   | **No está ya en Urgentes** — gana la cola más específica      |
| 3   | El agente está **apagado**                                    |
| 4   | Tiene un mensaje entrante                                     |
| 5   | Ese entrante es **posterior** a la última vez que se resolvió |

Ordenado por el mensaje más reciente primero, con el texto del último entrante en la fila.

**Si el agente está activo, no es trabajo del humano todavía.** Es la regla que atraviesa los dos módulos.

### Lo propio del Setter: filtros por canal

El buzón del setter lleva **filtros de canal** con su contador. Según el canal el lead llegó de formas
distintas: donde no hay formulario, es mensaje directo — y esas filas muestran un chip de origen distinto
en vez de una fuente de formulario.

---

## Cola 5 · Seguimientos de hoy

Los mismos cuatro casos que el Closer, con el mismo orden —primero los fijados, después por fecha—.

**Y con un filtro que no es obvio:** la vista de seguimientos **no sabe de territorios**, así que se
cruzan contra los contactos del setter que ya se trajeron. Sin ese cruce, un setter vería los
seguimientos del closer.

**El contador excluye los automáticos en curso**, igual que en el Closer: se muestran para que se vea que
la serie corre, pero no son tarea de nadie hoy.

---

## Cola 6 · Completadas hoy

Los resultados registrados hoy **por el setter**.

> **El filtro por rol es lo que separa su trabajo del de un closer sobre el mismo contacto.** Sin él, un
> resultado del closer aparecería como tarea completada del setter.

Es un detalle chico con una consecuencia grande: el mismo contacto puede recibir un resultado de cada rol
el mismo día, y cada uno tiene que ver el suyo.

**Y la fila huérfana entra igual**: un resultado de un contacto que ya no está en la caché se muestra sin
nombre, pero se muestra. El trabajo se hizo y tiene que constar; lo que no se hace es inventarle datos.

---

## El contador de tareas

Suma **cinco** de las seis colas:

```
urgentes + estancadas + oportunidades + buzón + seguimientos que piden manos
```

**No suma** las completadas —ya no son tarea— ni los seguimientos automáticos en curso.

> Son **cinco categorías**, no las tres del Closer. Y como en el Closer, **una sola función alimenta las
> tres vitrinas** donde aparece el número: la marca del menú, el título de Inicio y el encabezado de Mi
> Día. Con tres fórmulas, salen tres números distintos para lo mismo.

---

## Lista de verificación

1. **Seis colas**, y la agenda **no existe** — no es un pendiente.
2. **Cero banderas**: las seis se derivan de datos.
3. Un **portón de territorio** antes de todo: un contacto está en las colas de un rol o del otro.
4. Urgentes está **vacía a propósito** y la derivación ya está escrita — sin texto de diagnóstico.
5. Estancadas: **la etiqueta la pone el CRM**, acá solo se lee.
6. El estancamiento es **tinte y microtexto, nunca píldora**.
7. El contador de rescates y el tope de tres **no están implementados**.
8. Oportunidades chicas: aviso informativo **sin bloquear**, y confirmación reforzada para revertir.
9. El buzón, con las **cinco condiciones** y filtros por canal.
10. Los seguimientos se **cruzan contra el territorio**: la vista no lo sabe.
11. Completadas **filtra por rol**.
12. El contador suma **cinco categorías** y excluye los automáticos en curso.
