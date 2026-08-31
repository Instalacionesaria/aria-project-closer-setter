# 01 · Qué hace el auditor, y qué no

## 1 · Las dos salidas

| Salida           | Pregunta que responde                                          | Qué produce                                                     |
| ---------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| **Intervención** | ¿Hay que apagar al agente y que un humano tome **esto** ahora? | Una nota en el contacto + la etiqueta que enciende la cola roja |
| **Hallazgo**     | ¿Qué le pasa al agente que se pueda **corregir en su prompt**? | Una fila con su patrón, su diagnóstico y su corrección          |

**Son independientes en las dos direcciones**, y la rúbrica se lo dice al modelo con esas palabras:

- Puede haber **hallazgos sin intervención** — el daño ya ocurrió y el contacto se fue tranquilo.
- Puede haber **intervención sin ningún hallazgo** — el contacto está enojado con el precio y el
  agente lo manejó bien, pero alguien tiene que llamarlo.

### La vara de la intervención está escrita, y es corta

**Solo cuatro condiciones** la justifican:

| #   | Condición                                                                                                            |
| --- | -------------------------------------------------------------------------------------------------------------------- |
| 1   | El contacto está claramente enojado o a punto de irse, y el agente no lo maneja                                      |
| 2   | El agente dio información incorrecta **sobre dinero, fechas o condiciones**, y el contacto la está tomando por buena |
| 3   | El contacto pidió algo concreto **tres o más veces** sin obtenerlo                                                   |
| 4   | El contacto pidió expresamente **hablar con una persona**                                                            |

> **NO es intervención** que el agente sea verboso, formal, repetitivo, poco cálido, o que se le
> escape una oportunidad de venta. **Todo eso son hallazgos.**

Y el motivo de la intervención es **una frase concreta de esta conversación**, no "requiere revisión":
la va a leer el vendedor en su cola de urgencias y tiene que saber qué pasó sin abrir el chat.

---

## 2 · El veredicto de tres niveles

Todo análisis auditable termina en **uno** de tres. No es opcional y no hay un cuarto.

| Nivel           | Qué significa                              | Qué guarda                                            |
| --------------- | ------------------------------------------ | ----------------------------------------------------- |
| 🟢 **verde**    | El agente trabajó bien                     | **Destacado + evidencia**: qué hizo bien, con su cita |
| 🟡 **amarillo** | Al menos un hallazgo de severidad amarilla | Los hallazgos, **sin** corrección citada del prompt   |
| 🔴 **rojo**     | Fallo crítico: pide intervención           | Diagnóstico + corrección de prompt citada             |

### `null` es la ausencia de veredicto, no un cuarto nivel

Tres casos lo producen: una conversación **no auditable**, una **siembra de línea base**, y los
análisis anteriores a que existieran los niveles.

> **Las filas viejas se dejaron en `null` a propósito.** Rellenarlas como verdes habría **fabricado
> salud medida** — el modelo anterior no distinguía "salió limpio" de "tenía observaciones".

---

## 3 · Amarillo es un hecho contable, no una impresión

Es la redacción que reemplazó a "sin fallo, pero hay algo observable", y el cambio importa:

> **Si no podés nombrar el hallazgo con su cita y su código de patrón, no es amarillo.**

Con la redacción vieja, el modelo devolvía amarillo con **cero hallazgos**. El efecto no habría sido
un error visible sino algo peor: el contador de verdes bajando el día del cambio **sin que nada
hubiera cambiado en los agentes**.

De ahí la regla que la rúbrica repite: **una observación no justifica amarillo.** Si merece amarillo,
es un hallazgo y va con su cita. Si no llega, va en observaciones y el nivel sigue siendo verde. **No
hay tercera opción, y no se sube el nivel "por las dudas": inflar amarillos hace que el técnico deje
de mirarlos.**

---

## 4 · El verde se sostiene, o no es un verde

Un verde **medido** y una tarjeta **sin auditar** se veían igual. Toda la razón del cambio fue
distinguirlos, así que el verde ahora tiene una obligación simétrica a la del amarillo:

| Campo         | Qué es                                                                  |
| ------------- | ----------------------------------------------------------------------- |
| **destacado** | En una línea, **qué hizo bien** el agente. Concreto, no elogio genérico |
| **evidencia** | La línea **exacta y literal del agente** que lo demuestra               |

> **Van juntos o no van.** Un mérito afirmado sin la línea que lo respalda es la misma clase de dato
> que un hallazgo sin cita — **y es peor, porque nadie audita un elogio.**

**Y si de verdad no hay una línea citable, los dos quedan vacíos y el nivel sigue siendo verde**: no
encontrar un elogio no es encontrar una falla. Lo que no se hace es inventar un mérito.

**En rojo los dos van vacíos**: ahí hablan el diagnóstico y la corrección.

---

## 5 · El resumen y las observaciones: lo que dice un veredicto cuando no hay nada que corregir

Un verde que solo dice "verde" no le sirve a nadie. Por eso **todo** veredicto trae dos campos más.

### El resumen: descripción, no juicio

Dos a cuatro frases contando **qué pasó**: quién habló, qué pidió el contacto, hasta dónde llegó y
cómo terminó.

> **Se escribe SIEMPRE, incluso cuando la conversación no es auditable.** Ahí es lo único que se puede
> decir, y es exactamente lo que hay que decir: _"la llamada duró 19 segundos: el agente saludó, el
> contacto respondió una palabra y se cortó"_.

### Las observaciones: hasta cuatro, con etiqueta

| Etiqueta           | Qué es                                                                 |
| ------------------ | ---------------------------------------------------------------------- |
| `cobertura_prompt` | El prompt pide algo que en **esta** conversación no ocurrió            |
| `ritmo`            | Se cortó o se abandonó antes de que la conversación se desarrollara    |
| `oportunidad`      | Algo que el agente podía aprovechar y no aprovechó, sin llegar a fallo |
| `contexto`         | Algo que conviene saber y que **no** es responsabilidad del agente     |

Cada una lleva su texto concreto y **su cita, o `null`** si es sobre la conversación entera (una
duración, un corte, algo que **no** pasó).

### La diferencia que no hay que confundir

> **Un hallazgo IMPUTA. Una observación DESCRIBE.**
>
> _"No hizo las dos preguntas porque la llamada duró 19 segundos"_ es una observación.
> _"No hace las preguntas de calificación nunca"_ es un hallazgo, y lleva su corrección.

Una observación **no tiene código de patrón, no tiene corrección, y no mueve el nivel**.

### Los tres estados de la columna, y el tercero es el que importa

| Valor  | Qué significa                                                                  |
| ------ | ------------------------------------------------------------------------------ |
| `null` | **No se pidieron** — conversación no auditable, o una fila del carril amarillo |
| `[]`   | **Se pidieron y no hubo ninguna.** Un hecho medido                             |
| `[…]`  | Las que hubo                                                                   |

**Escribir `[]` siempre borraría la diferencia**, que es exactamente la regla que atraviesa el
producto: `null` y `[]` no pueden significar las dos cosas.

Y hay un candado en la base: **no se pueden guardar observaciones sobre un análisis no auditable.**
Observar algo de una conversación que el propio auditor declaró imposible de juzgar **es juzgarla**.

---

## 6 · El nivel se DERIVA, y no se le cree al modelo

El modelo devuelve un nivel. **No es el que se guarda.**

```
1. Sin auditar            → null       (no hay veredicto)
2. Con intervención       → rojo       (es la definición de rojo)
3. Con hallazgos          → amarillo   (reportó algo observable)
4. Sin hallazgos          → verde, salvo que el modelo pida amarillo
```

**No es desconfianza gratuita.** La base tiene una invariante declarada:

```
rojo  ⟺  pide intervención
```

Así que un modelo que devuelva "amarillo" junto a `intervención: true` **tumbaría la escritura
entera** y el análisis se perdería — **con la inferencia ya pagada**, que es el peor final posible.
Derivar convierte un error del modelo en una fila correcta.

> **La invariante la hace cumplir la base de datos, no la disciplina de quien escriba el próximo
> INSERT.** Es la misma técnica que impide las observaciones sobre lo no auditable: **el estado
> inválido se vuelve inescribible.**

Hay una prueba que barre **las 48 combinaciones** posibles y verifica que rojo equivalga siempre a
pedir intervención.

---

## 7 · La conversación que NO se audita

Antes de evaluar nada, la rúbrica corta:

| Condición                                                        | Vale para  |
| ---------------------------------------------------------------- | ---------- |
| No hay **ninguna línea del agente**                              | chat y voz |
| Menos de **dos intercambios reales** (menos de 2 de cada lado)   | chat y voz |
| Más de la mitad de los mensajes son **audio o imagen sin texto** | solo chat  |

> **Sin agente no hay nada que auditar, y bajo ninguna circunstancia eso es una falla del agente: es
> la ausencia de un agente.**

Sale con "no auditable" y su motivo, **hallazgos vacíos, sin intervención, y con el resumen escrito**.
No se fuerza un veredicto.

---

## Lista de verificación

1. **Dos salidas independientes**: intervención y hallazgo.
2. La vara de la intervención son **cuatro condiciones escritas**; el estilo nunca es una.
3. El motivo de la intervención es **una frase de esta conversación**.
4. **Tres niveles**, y `null` es la ausencia de veredicto.
5. **Amarillo es contable**: sin cita y sin código, no es amarillo.
6. El verde lleva **destacado + evidencia, juntos o ninguno**.
7. **El resumen se escribe siempre**, incluso sin auditar.
8. Las observaciones **describen, no imputan**, y no mueven el nivel.
9. `null` ≠ `[]` en observaciones, y la base lo hace cumplir.
10. El nivel **se deriva**; la invariante la impone la base.
11. La precondición corta **antes** de evaluar, y no se fuerza un veredicto.
