# 08 · La pantalla de Auditoría de Agentes

Es **la pantalla del técnico**, y tiene dos pestañas: **los agentes** y **los prompts** (ver el `03`).

---

## 1 · La rejilla de cuatro tarjetas

Una por agente auditado. **Una tarjeta puede estar en tres estados, y los tres se ven distinto a
propósito.**

| Estado                         | Qué muestra                                                |
| ------------------------------ | ---------------------------------------------------------- |
| **Sin auditor**                | La tarjeta **completa**, con un panel que dice **por qué** |
| **Con auditor y sin análisis** | Un **guion**, y un chip que dice **SIN DATOS**             |
| **Con datos**                  | Los contadores reales                                      |

### La que no tiene auditor NO se atenúa

> **Atenuarla la haría leer como "deshabilitada por un bug".**

Y el motivo **es distinto según el caso** —no existe todavía, o está apagado a propósito—, así que se
dice cuál. Ver el `02` § 6.

### La que tiene auditor y no tiene análisis muestra un guion, no un cero

> **Un cero afirma una medición que nadie hizo.**

**Y un chip que dice "sin datos", no un tilde verde de "al día"** — que afirmaría salud.

### Y hay un tercer caso real que también se distingue

**Hay análisis, pero ninguno tiene nivel** (son anteriores a que los niveles existieran). Ahí se dice
"sin fallas" **sin contar verdes**, porque contarlos sería afirmar algo que nadie midió.

### Los tres estados de carga se ven distintos

**Cargando / listo / error.** Sin eso, **un servidor caído se vería idéntico al estado normal
esperado**, que es el peor error posible en esta pantalla.

---

## 2 · De dónde sale cada número de la tarjeta

| Número                | De dónde                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------ |
| **Sentimiento**       | El reparto de los veredictos de la ventana. Lo produce el modelo, una vez por conversación |
| **Tasa y operativos** | De **las citas del CRM**, no de los análisis                                               |
| **Delta**             | La misma tasa contra el período anterior, en puntos                                        |
| **Historia**          | Doce semanas                                                                               |

> **Un agente puede atender de maravilla y no conseguir la cita.** Son cosas distintas y se miden por
> separado.

### Y hay un número que NO se calcula, a propósito

Uno de los indicadores del diseño original **no está definido** —no se sabe qué cuenta exactamente— y
**elegir el criterio por cuenta propia sería inventar una regla de negocio**. Viaja vacío y la vista
conserva lo que había.

### La ventana es una sola constante

**Los contadores de la tarjeta, la lista de análisis y los patrones hablan del mismo período.**

> **Tres constantes iguales son tres constantes que un día no lo son.**

---

## 3 · Patrones y casos: dos listas, no una

El servidor manda **dos listas separadas**:

| Lista        | Qué es                                                                     |
| ------------ | -------------------------------------------------------------------------- |
| **Patrones** | Un patrón por (agente, código). Con **el texto del hallazgo más reciente** |
| **Casos**    | Cada hallazgo suelto, con su contacto y su evidencia                       |

> **El diagnóstico, el fragmento del prompt y la corrección son del PATRÓN, no del caso.** Mandarlos
> repetidos en cada una de las quince filas de un grupo es exactamente la duplicación que tenía la
> versión sembrada.

### Quién decide qué

| Decisión                       | Dónde se toma                                           |
| ------------------------------ | ------------------------------------------------------- |
| **Qué texto gana**             | El servidor: el del hallazgo más reciente de ese código |
| **Cómo se agrupa y se cuenta** | **El cliente**                                          |

**El agrupamiento se queda en el cliente para que el contador sea la cantidad de casos POR
CONSTRUCCIÓN.** Es lo que evita que vuelva el desfase de _"×15 casos"_ mostrando dos ejemplos.

**Y "el texto que gana" no puede ser "el primero que tenga algo":** las filas vienen ordenadas de más
reciente a más vieja, así que la primera de cada patrón es la que aporta los textos. _"El primero que
tenga algo"_, con datos reales, es **"uno cualquiera"**.

---

## 4 · El bloque de corrección

```
   DICE AHORA   (borde rojo)
        ↓
 DEBERÍA DECIR  (borde verde)
```

Apilado, con el chip del origen y la sección del prompt.

### El texto preformateado es obligatorio, no cosmético

> **Un fragmento real de prompt tiene viñetas, saltos y sangría.** Sin respetar los espacios, llega
> como **un chorizo de una línea que no se puede pegar de vuelta.**

### Y avisa cuando el prompt cambió

**Si la versión del prompt de hoy no es la que estaba cuando se detectó el hallazgo**, aparece una
advertencia: **el fragmento citado puede ya no existir**.

> Sin ese aviso, el técnico pega un reemplazo de algo que no está.

**La condición es precisa**: hay fragmento citado, hay prompt cargado hoy, y las dos versiones
difieren. Con el prompt sin cargar **no se avisa nada**, porque no hay nada contra qué comparar.

### Y el discriminante es estructural, no un booleano

**Que haya fragmento citado significa que el auditor tenía el prompt.** Que no lo haya significa que la
corrección es una instrucción para agregar.

> **Nunca un campo "es nuevo".** El dato ya lo dice.

---

## 5 · El botón que cierra un grupo, y qué manda el cliente

**"Marcar grupo resuelto"** registra la corrección aplicada y **cierra los casos**.

### El cliente manda lo mínimo

| Manda el cliente                               | Lo pone el **servidor**                             |
| ---------------------------------------------- | --------------------------------------------------- |
| Agente, código de patrón, **ids de los casos** | El título, el diagnóstico, la corrección y el autor |

> **El servidor ya los tiene, porque los produjo él.** Dejar que el navegador los mandara permitiría
> que **una pestaña vieja escriba texto viejo en un registro que es permanente.**

### Y se cierran los casos que el técnico TENÍA EN PANTALLA

**No "todos los de este código".**

> Entre que abrió el detalle y apretó el botón **pudo entrar un caso nuevo**, y cerrarlo sin haberlo
> visto es justo lo que el botón promete no hacer: _"cierra los ×N casos"_ — **los N que dice la
> pantalla**.

---

## 6 · Reincidencia: una consulta, no una bandera

> **El primer hallazgo posterior al último ajuste.**

**Es una consulta derivada, no un campo que alguien tenga que acordarse de escribir.**

**Una bandera se desincroniza; una consulta no.** Y aparece en la pantalla junto a la fecha: _"volvió a
pasar el X, después del ajuste"_ — que es la única forma de saber que **la corrección no alcanzó**.

---

## 7 · La lista de conversaciones auditadas

Además de los patrones, el detalle de cada agente lista **todas las conversaciones auditadas**: verdes,
amarillas, rojas y **las que no se pudieron juzgar**, con su veredicto completo.

> Antes la pantalla mostraba **solo hallazgos agrupados por patrón**, y un verde no produce ningún
> hallazgo: **la conversación mejor atendida era la única sin lugar donde aparecer.** El técnico veía
> "0 rojos, 0 amarillos" y ninguna forma de leer qué había dicho el auditor.

### Su filtro es distinto al de los contadores, y está justificado por escrito

| Vitrina        | Filtra                        | Por qué                                                                            |
| -------------- | ----------------------------- | ---------------------------------------------------------------------------------- |
| **Contadores** | Solo lo **auditable**         | Son **métricas de calidad**: un análisis que no juzgó nada no dice nada del agente |
| **La lista**   | **Incluye los no auditables** | No es una métrica: es **el registro de lo que el auditor miró**                    |

**Los dos excluyen la siembra de línea base**, que no es un análisis.

> **Está escrito porque el producto ya pagó una vez por no escribirlo:** un chip comparaba dos
> poblaciones distintas —el numerador sin ese filtro, el denominador con él— y **nadie podía explicar
> el número**.
>
> **Dos filtros distintos están bien si están justificados. Dos filtros distintos por descuido son un
> número que miente.**

### Y el no auditable es la fila más informativa

Una llamada de 19 segundos que el auditor declaró imposible de juzgar tiene **sin nivel, cero
hallazgos, y un resumen que dice exactamente qué pasó**.

**Es la fila que un filtro por "auditable" habría escondido.**

---

## 8 · El historial de ajustes

Las correcciones ya aplicadas, con **la fecha real de la base** — nunca el literal "Hoy" que escribía
la versión en memoria.

Es lo que sostiene la reincidencia del § 6: sin registro del ajuste, no hay contra qué comparar.

---

## 9 · El enlace al contacto se arma en el SERVIDOR

**El identificador de la cuenta del CRM es una credencial de servidor: el navegador no la tiene ni debe
tenerla.**

**Y sin ese dato, no hay enlace** — la vista no dibuja un botón que no lleva a ningún lado.

---

## Lista de verificación

1. **Tres estados de tarjeta**, los tres distintos, y el sin-auditor **no se atenúa**.
2. Sin análisis: **guion y "sin datos"**, nunca `0%` ni un tilde verde.
3. **Cargando / listo / error** se ven distintos.
4. **Calidad y conversión se miden por separado.**
5. Lo que no está definido **viaja vacío**: no se inventa el criterio.
6. **Una sola ventana** para las tres vitrinas.
7. **Dos listas**: el texto es del patrón, no del caso.
8. El servidor elige **qué texto gana**; el cliente **agrupa y cuenta**.
9. El bloque de corrección **respeta los espacios**, y avisa si el prompt cambió.
10. El discriminante es **estructural**, nunca un booleano.
11. Al cerrar un grupo, **el servidor pone los textos** y se cierran **los casos en pantalla**.
12. La reincidencia es **una consulta**, no una bandera.
13. La lista **incluye los no auditables**; los contadores no. **Y está justificado.**
14. El enlace al CRM **se arma en el servidor**, o no se dibuja.
