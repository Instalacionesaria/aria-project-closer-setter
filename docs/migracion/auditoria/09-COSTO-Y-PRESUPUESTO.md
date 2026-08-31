# 09 · Costo y presupuesto

**Es el único módulo del producto que gasta plata por conversación.** Todo lo demás cuesta llamadas al
CRM; esto cuesta inferencia.

---

## 1 · Los parámetros, y por qué NO son configurables

| Parámetro                | Valor                                                   |
| ------------------------ | ------------------------------------------------------- |
| Modelo                   | **Constante del código**, igual para todas las empresas |
| Esfuerzo de razonamiento | **Alto**, ídem                                          |
| Techo de tokens          | **16.000** (pensamiento **+** texto)                    |
| Costo por análisis       | **~US$ 0,01 – 0,02**                                    |

> **Dejaron de ser configurables a propósito.**
>
> Eran variables de entorno más dos columnas por empresa. El motivo salió de este mismo producto: un
> comportamiento gobernado por una variable de entorno **se vuelve a encender solo** en cualquier
> entorno donde la variable no esté.
>
> **Con el modelo pasaba al revés: una empresa podía quedar auditando con otro modelo sin que nadie lo
> hubiera decidido y sin que apareciera en ningún diff.**

**Cambiar el modelo pasa a ser un cambio de código, que es más incómodo — y ésa es la idea.**

**Y se guarda el modelo REAL con el que se juzgó cada análisis**: si mañana cambia, los análisis viejos
siguen diciendo con qué se produjeron.

---

## 2 · La clave del proveedor es de CADA empresa, y sin ella no se audita

Es la fuga más silenciosa que tuvo este módulo:

> El cliente del proveedor, **sin argumento explícito, lee la clave del entorno**. Así que durante un
> tiempo **todas las auditorías se le facturaban a la empresa principal — las de sus clientes
> también.**
>
> **No era una fuga de datos: era una fuga de plata, del tipo que no se nota hasta la factura.**

| Situación                     | Qué pasa                                                 |
| ----------------------------- | -------------------------------------------------------- |
| La empresa tiene su clave     | Audita con la suya                                       |
| La empresa **no tiene** clave | **No audita**, y lo dice **con el nombre de la empresa** |

> **Auditar con la cuenta de un tercero es peor que no auditar.**

**La clave va explícita en cada llamada.** Sin el argumento, la empresa activa deja de importar.

---

## 3 · El caché del prefijo, y dónde va el corte

El bloque estable del contexto —**el contexto del agente + su prompt + la rúbrica**— se marca para
cachear, con una vida de **una hora**.

| Operación         | Costo relativo    |
| ----------------- | ----------------- |
| Escribir el caché | **2×** la entrada |
| Leerlo            | **0,1×**          |

> **Se paga sola con UNA lectura por hora.**

### El corte estaba mal puesto, y el error es fácil de repetir

**El caché toma todo el prefijo hasta el bloque marcado, inclusive.**

El corte estaba en **los patrones conocidos**, que es el último bloque. Y **los patrones cambian
solos** —salen de los hallazgos—, así que **cada hallazgo nuevo invalidaba el caché entero de esa
empresa**:

> **Se pagaba la escritura una y otra vez sin llegar a cobrar una sola lectura.**

**Movido a la rúbrica**, el prefijo cacheado es exactamente lo que no cambia entre análisis de la misma
empresa, y **los patrones quedan afuera**.

### Y la vida de una hora, no la del default

Con el debounce de 5 mensajes, **dos análisis de la misma empresa separados por menos de unos minutos
son la excepción**, así que una vida corta casi nunca llegaba a cobrarse.

### El carril amarillo NO cachea, y también es deliberado

Hace **una llamada por empresa y por día**: la corrida de mañana nunca encuentra la de hoy.

> **Un caché que jamás acierta no es una optimización: es un recargo.**

---

## 4 · El debounce ES el control de gasto

> **El transcript se re-manda entero cada vez, así que el costo de una conversación crece con el
> CUADRADO de su longitud.**

| Sin debounce                   | Con debounce                   |
| ------------------------------ | ------------------------------ |
| Un análisis **por mensaje**    | Uno cada 5 mensajes del agente |
| 20 mensajes → **~20 llamadas** | 20 mensajes → **~2 llamadas**  |

**Y el nivel 0 no cambia esa cuenta en la conversación normal:** corre sobre la caché propia, así que
**cerrar el agujero del debounce es gratis**. Lo único que cambia es el peor caso de una conversación
alarmada — **un análisis por mensaje del agente en vez de uno cada cinco, y solo mientras esté
alarmada**.

### Las palancas que existen y NO están aplicadas

Se declaran para que quien replique sepa que están disponibles:

| Palanca                                                         |
| --------------------------------------------------------------- |
| **Ventana deslizante** en vez de re-mandar el transcript entero |
| **Resumen acumulado** de lo viejo                               |
| **Auditar solo en el mensaje saliente**, no en los dos          |

**Hoy se audita en los dos eventos** —entrante y saliente— y hay un motivo escrito: **los criterios de
la rúbrica se reparten entre ambos.** La frustración y el "no es lo que busco" se ven en el entrante;
la calidad de la respuesta, en el saliente.

---

## 5 · Los topes que ya están puestos

| Tope                                                          | Dónde                                |
| ------------------------------------------------------------- | ------------------------------------ |
| **Máximo 3 hallazgos** por análisis                           | Recortado en código                  |
| **Últimos 40 mensajes** del transcript                        | Lo viejo no explica el fallo de hoy  |
| **3 páginas** de conversación pedidas al CRM                  | Cubre cualquier conversación real    |
| **1 amarillo** por empresa y por agente, por día              | El carril amarillo                   |
| **Tope chico y por empresa** en el barrido de respaldo de voz | Cada elemento es una inferencia paga |
| **200 patrones conocidos** en el contexto                     | La lista que viaja al modelo         |

**Y el barrido de respaldo dice cuántos quedaron pendientes.**

> **Un barrido que se guarda para sí que dejó cosas afuera se lee como "ya está todo auditado".**

---

## 6 · Lo que NO cuesta llamadas al CRM

| Qué                                         | Costo hacia el CRM |
| ------------------------------------------- | ------------------ |
| El **debounce**                             | **Cero**           |
| Las **cinco señales** del nivel 0           | **Cero**           |
| Elegir el candidato del **carril amarillo** | **Cero**           |
| La **cola de urgentes** y su motivo         | **Cero**           |
| Los **patrones y casos** de la pantalla     | **Cero**           |

> **El presupuesto del CRM es más escaso que los centavos del modelo.** Por eso el debounce se calcula
> sobre la caché propia: contra el CRM serían **dos llamadas por evento incluso cuando la respuesta es
> "no analizar"**.

**Las únicas llamadas al CRM del auditor son:** el contacto (para los portones), su conversación, y —si
hay rojo— la nota y la etiqueta.

---

## 7 · El peor final posible, y cómo se evita

**Que la inferencia se pague y el análisis se pierda.** Pasa de tres formas, y las tres están cerradas:

| Cómo se pierde                                       | Cómo se evita                                                  |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| **Salida truncada** por techo corto                  | Techo alto, y se **chequea el motivo de corte** explícitamente |
| **La escritura viola una restricción de la base**    | El nivel **se deriva**; lo inválido **se descarta por partes** |
| **La función muere por tiempo** dentro de un webhook | Un **barrido de respaldo** programado                          |

**Y cuando la escritura falla, la respuesta NO dice que se analizó.** Ver el `06` § 6.

---

## Lista de verificación

1. Modelo y esfuerzo son **constantes del código**, no configuración.
2. Se guarda el **modelo real** con el que se juzgó cada análisis.
3. La clave del proveedor es **de cada empresa**, va **explícita**, y sin ella **no se audita**.
4. El corte del caché va en **la rúbrica**, con los patrones **afuera**.
5. Vida del caché: **una hora**.
6. El **carril amarillo no cachea**, a propósito.
7. El costo crece con **el cuadrado** de la conversación: el debounce es el control.
8. El **nivel 0 es gratis** en la conversación normal.
9. Hay **palancas declaradas y no aplicadas**: ventana, resumen, auditar solo en el saliente.
10. **Seis topes** puestos, y el barrido **dice lo que dejó afuera**.
11. Todo lo que puede salir de la **caché propia** sale de ahí.
12. **Las tres formas de perder una inferencia pagada** están cerradas.
