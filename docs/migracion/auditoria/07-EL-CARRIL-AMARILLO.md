# 07 · El carril amarillo — una mejora por día

Son **dos carriles**, y la diferencia no es de intensidad:

|                    | **Carril rojo**                   | **Carril amarillo**                        |
| ------------------ | --------------------------------- | ------------------------------------------ |
| Cuándo corre       | Por conversación, **en caliente** | **Una vez por día y por empresa**, en frío |
| Qué lo dispara     | Un mensaje                        | Un reloj programado                        |
| Su consecuencia    | **Apagarle el agente a alguien**  | Una línea en la pantalla del técnico       |
| A quién interrumpe | Al vendedor                       | **A nadie**                                |

---

## 1 · Lo que el amarillo NO hace, y es deliberado

| No hace                             | Por qué                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| **No propone corrección de prompt** | Redactar el reemplazo es **la parte cara** del veredicto, y acá no hace falta              |
| **No genera tarea para nadie**      | No entra a ninguna cola: un contacto no aparece en el día de nadie por un amarillo         |
| **No apaga ningún agente**          | Escribe su análisis **sin fallo**                                                          |
| **No usa caché de prompt**          | Hace **una** llamada por empresa y por día: la corrida de mañana nunca encuentra la de hoy |

> **Un caché que jamás acierta no es una optimización: es un recargo.**

---

## 2 · La corrida, en orden — y el orden es el punto

| #   | Paso                                                                                      |
| --- | ----------------------------------------------------------------------------------------- |
| 1   | **Candidatos del día**: actividad hoy, el agente atendiendo, de un territorio con auditor |
| 2   | **El tope**, consultado antes de mirar nada                                               |
| 3   | Fuera los que **ya tienen un hallazgo rojo hoy**                                          |
| 4   | Agrupar por **señal heurística** y elegir **un** patrón                                   |
| 5   | **El descarte**, antes de gastar                                                          |
| 6   | **Una** llamada al modelo                                                                 |

**Los pasos 2 y 5 son los que sostienen el presupuesto.**

> Se consultan primero por el mismo motivo: **si el techo ya está alcanzado, todo lo que venga después
> es trabajo que no se va a poder escribir.**

### El borde del día se calcula en la zona de CADA empresa

**La hora del reloj es fija; el borde del día no.** Un error de signo en un huso negativo mueve la
ventana un día entero **sin que nada falle** — por eso ese cálculo está aislado y probado.

**La hora elegida deja al técnico el resto de la jornada para aplicar el ajuste.**

### El territorio se filtra ANTES de elegir el patrón

Si un contacto de un agente **sin auditor** llegara a la elección y ganara, **la corrida del día se
perdería entera**: hay un solo patrón por día, y ese patrón sería inescribible.

### Cómo se elige el patrón del día

> **La señal más repetida. Si empatan, la que tenga el candidato más reciente. Y dentro de la señal
> elegida, el contacto más reciente.**

Está aislado para poder probarlo, porque **un desempate mal escrito no rompe nada visible** —siempre
elige _algo_—, solo elige mal todos los días. **Ese es el tipo de error que no aparece hasta que
alguien compara a mano.**

### Y elegir a quién mirar no cuesta llamadas al CRM

Las señales salen de **la caché propia**. La única llamada al CRM del día es la del elegido.

---

## 3 · El tope duro: uno por empresa y por agente, por día

> **Es un techo, no una cadencia suave que se acelera cuando hay mucho para decir.**
>
> **Un techo se razona y se presupuesta; una cadencia suave hay que simularla para saber cuánto sale.**

### Y se cuenta por CRITERIO, no solo por severidad

Es el defecto que cazó el primer ensayo contra datos reales:

> **El carril rojo también produce hallazgos de severidad amarilla** —los que encuentra de paso y que
> no piden intervención—. Contarlos acá **bloqueaba este carril con trabajo ajeno**, y de hecho lo
> hizo: la corrida devolvió "tope alcanzado" por dos amarillos que había producido el rojo.

**Un amarillo de este carril se distingue por su criterio propio**, que es el único lugar que lo
escribe. **No por la severidad.**

---

## 4 · El descarte: por patrón, agente y versión del prompt

```
(código de patrón, agente, versión del prompt)
```

**La versión del prompt es la parte que lo hace correcto:**

> Si el técnico editó el prompt, **la misma recomendación sobre el prompt NUEVO sí es información**:
> dice que el arreglo no alcanzó. **Sin la versión, un patrón arreglado quedaría silenciado para
> siempre.**

### Y hay un límite honesto que conviene copiar con su explicación

**No se puede descartar por el código antes de tenerlo**: el código lo produce el modelo. Así que se
descarta contra **el conjunto de códigos abiertos** de ese agente con esa versión, y si el modelo
devuelve uno de ellos, **no se escribe**.

**La llamada ya se gastó** —es el costo de no poder adivinar el código—, pero el duplicado no llega a
la pantalla.

> **El ahorro de verdad está un paso antes:** si todas las señales del día ya tienen un amarillo
> abierto sobre este prompt, **no se llama**. Es el caso común de un patrón que el técnico todavía no
> tocó.

---

## 5 · La dimensión propia: acompañamiento

Los siete criterios de la rúbrica son **de fallo**. El amarillo necesita decir _"esto se podía hacer
mejor"_ sin que sea un defecto.

> **Y eso NO se consigue aflojando los umbrales de los siete.** Un criterio flojo produce ruido, y **el
> ruido le enseña al técnico a ignorar la pestaña** — que es exactamente perder la herramienta.

**La pregunta que hace este carril es otra:**

> **¿El agente leyó DÓNDE ESTABA EL LEAD, y le respondió a eso?**

Y el orden está impuesto: **primero se describe el comportamiento del lead, después se juzga la
respuesta.**

> **Un juicio sobre el agente sin haber leído primero al lead es una opinión sobre estilo, y de eso no
> sirve nada.**

### La escala: tres niveles, y solo uno se reporta

| Nivel            | Qué es                                                           | ¿Hallazgo?          |
| ---------------- | ---------------------------------------------------------------- | ------------------- |
| **Acompañó**     | Registró la señal del lead y su respuesta va hacia ahí           | No                  |
| **Respondió**    | Correcto pero pasó de largo una señal. Sin daño, sin desconexión | **No, a propósito** |
| **Se desacopló** | El lead estaba en un lugar y el agente siguió con su agenda      | **Sí**              |

**El del medio se mide y se descarta:**

> Casi toda conversación tiene algo que se podía decir mejor, así que reportarlo sería **un amarillo
> diario garantizado, sin señal adentro**.
>
> **Se pide igual en el esquema** para que el modelo tenga dónde poner lo tibio **en vez de empujarlo
> hacia el nivel que sí se reporta.**

Es la misma técnica que el resumen del carril rojo: darle al modelo un lugar honesto para lo que no
llega a hallazgo.

### Los descartes propios

| Descarte                                                                              |
| ------------------------------------------------------------------------------------- |
| **Menos de 3 mensajes con texto del contacto** — no dio señal suficiente que leer     |
| La conversación **terminó en cita, en compra o en un "sí" explícito**                 |
| **Quien respondió después de la señal no fue el agente**                              |
| El lead pidió algo que **el prompt explícitamente no cubre** — es un límite de diseño |
| **Faltan las dos citas** — la del contacto y la del agente que vino después           |

> _"Una nota de estilo sobre un cierre que funcionó no vale el día del técnico."_

**Y rige la misma regla de atribución que el carril rojo.** Si quien respondió fue una plantilla o una
persona, **no hay nada que evaluar del agente**.

### Las dos citas son obligatorias

**Sin las dos, el hallazgo no existe y no se reporta.** Es la misma regla del rojo: **una recomendación
sin la línea que la prueba no se puede verificar ni discutir.**

---

## 6 · Cómo se guarda: un hallazgo sin veredicto real

El hallazgo necesita un análisis padre. **Se escribe uno sin fallo**, con su disparo propio, y eso es
lo que hace que **la cola roja y el panel de sentimiento lo ignoren**.

> **Un amarillo con fallo le apagaría el agente a alguien, que es exactamente lo que este carril no
> hace.**

**Y las tres columnas de corrección quedan vacías a propósito**, no por omisión.

---

## 7 · La corrida en seco

**Recorre todo el camino de decisión —candidatos, tope, señal, descarte— y se detiene justo antes de
llamar al modelo.**

Es la misma salida que tiene el carril rojo y sirve para lo mismo: **verificar contra datos reales sin
gastar ni escribir.**

Y devuelve **por qué** haría lo que haría: a quién elegiría, con qué agente, y cuántos códigos ya están
abiertos sobre ese prompt.

---

## Lista de verificación

1. **Dos carriles**: uno en caliente que interrumpe, uno en frío que no.
2. El amarillo **no corrige prompts, no genera tareas, no apaga agentes y no cachea**.
3. **El tope y el descarte se consultan primero**, antes de trabajar.
4. El **borde del día** se calcula en la zona de cada empresa.
5. El **territorio se filtra antes** de elegir el patrón.
6. **La señal más repetida; empate por el más reciente**, y está aislado para probarlo.
7. Elegir a quién mirar **cuesta cero llamadas al CRM**.
8. **Un techo por empresa y por agente, por día**, contado **por criterio**.
9. El descarte lleva **la versión del prompt**, o un patrón arreglado queda silenciado para siempre.
10. **Dimensión aparte**, no umbrales flojos.
11. **Solo el peldaño de abajo se reporta**; el del medio existe para absorber lo tibio.
12. **Las dos citas son obligatorias.**
13. El análisis padre va **sin fallo**, o le apagaría el agente a alguien.
14. La **corrida en seco** llega hasta el borde del gasto y dice qué haría.
