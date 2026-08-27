# 05 · Inicio y los contadores

El tablero que se ve al entrar. Responde una pregunta: **¿cómo voy este mes?**

Y trae la regla que más se viola de todo el módulo: **un número se calcula una sola vez.**

---

## 1 · Qué muestra

| Pieza                     | Qué dice                                               |
| ------------------------- | ------------------------------------------------------ |
| **Lo cobrado en el mes**  | El número protagonista. **Cobrado real, no prometido** |
| **El anillo de comisión** | Contra su meta, con "faltan $X → N ventas más"         |
| **Ventas** (con su tasa)  | Cuántas cerró                                          |
| **Acuerdos**              | Comprometidos sin cobrar                               |
| **Llamadas del mes**      | Cuántas ocurrieron sobre cuántas agendadas             |
| **Tasa de asistencia**    | Cuántos se presentaron                                 |
| **Comisión**              | Lo que le corresponde                                  |
| **El puente a Mi Día**    | "X tareas pendientes → Ejecutar Mi Día"                |
| **Histórico**             | Los últimos meses                                      |

**Una sola llamada trae el tablero entero, ya calculado.** Reloj de 60 segundos, y cero llamadas al CRM.

---

## 2 · Cobrado y prometido son dos cosas

> El número protagonista es **lo cobrado**. Un acuerdo sin pagar **no suma ahí**, aunque también tenga
> monto.

Van en tarjetas distintas a propósito. Sumarlos daría un número más lindo y **no sería plata**: el día que
un acuerdo no se concreta, el tablero habría estado mintiendo durante semanas.

Es la misma distinción que hace el ícono de venta en la fila: solo se enciende con la cobrada.

---

## 3 · Las tres reglas de esta pantalla

**1 · Sin dato no se muestra un cero.**

| Situación                         | Qué se muestra |
| --------------------------------- | -------------- |
| La comisión no está configurada   | **`—`**        |
| Está configurada y no vendió nada | **`$0`**       |

Un cero afirma "no ganaste nada". Un guion dice "no lo sé". Y no son el mismo hecho: el primero es un
resultado, el segundo es una configuración pendiente.

**2 · "Meta superada" nunca aparece si la comisión es cero**, por más que la meta también esté en cero. Un
porcentaje sobre base cero **no es un logro**, y celebrarlo hace que la celebración deje de significar
algo.

**3 · El número y el anillo animan juntos.** Misma duración, misma curva, y vuelven a animar cuando el
valor cambia. **El anillo se topa en 100 %; el número del centro muestra el monto real sin topar** — si el
número también se topara, alguien que superó su meta no vería cuánto.

---

## 4 · Los contadores: una función, tres vitrinas

El número de tareas pendientes aparece en **tres lugares**:

1. La marca del menú de navegación.
2. El título de Inicio ("X tareas pendientes").
3. El encabezado de Mi Día.

> **Los tres salen de UNA función pura.** Antes cada uno tenía su propia fórmula, y **mostraban tres
> números distintos para lo mismo.**

Es el caso de libro de la regla: si dos vitrinas muestran el mismo hecho, **comparten la función que lo
calcula**. Dos implementaciones divergen en silencio y las dos parecen correctas.

### Qué cuenta, y qué no

| Cuenta                           | No cuenta                                 |
| -------------------------------- | ----------------------------------------- |
| Intervenciones urgentes          | **La agenda del día**                     |
| Respondieron · buzón             | **Las completadas de hoy**                |
| Seguimientos que **piden manos** | **Los seguimientos automáticos en curso** |

**Las dos exclusiones de la derecha son deliberadas y valen la pena entenderlas:**

**La agenda no es una tarea pendiente.** Es una cita: va a pasar a una hora, no es algo que se pueda
"hacer ahora". Contarla haría que el número diga 12 cuando hay 8 cosas que atender.

**Los seguimientos automáticos se muestran pero no suman.** El closer quiere **ver** que la serie está
corriendo; no tiene nada que hacer con ella. Sumarlos haría que el contador diga "12 pendientes" cuando
nueve las está haciendo un robot — y a la tercera vez, deja de creerle al contador.

---

## 5 · El puente a Mi Día

**Toda la tarjeta es clicable, no solo el botón.** Es el camino que se usa docenas de veces por día, y un
área de click del tamaño de un botón lo convierte en un ejercicio de puntería.

---

## 6 · La celebración de una venta

Al registrar una venta: una animación breve y un sonido configurable.

**Y tiene que dispararse desde el mismo lugar que actualiza los números**, no desde un camino aparte. Si
la celebración sale y el número no cambia, el closer aprende que la animación no significa nada.

---

## 7 · Cómo se actualiza

| Momento                 | Qué pasa                      |
| ----------------------- | ----------------------------- |
| Reloj propio            | **60 s**                      |
| Al recuperar el foco    | Un disparo inmediato          |
| Después de un resultado | Se actualiza **sin recargar** |

**Sesenta segundos y no diez**, porque son métricas del mes: cambian cuando alguien registra algo, y eso
ya dispara su propia actualización. Un reloj más rápido redibujaría el mismo número.

**Y cuesta cero llamadas al CRM**: es agregación por consulta sobre la base propia.

---

## Lista de verificación

1. **Cobrado y prometido** en tarjetas distintas. El protagonista es lo cobrado.
2. **Sin configuración, un guion. Sin ventas, un cero.** No son lo mismo.
3. **"Meta superada" nunca con comisión en cero.**
4. Número y anillo **animan juntos**; el anillo se topa, el número no.
5. **Una función pura** alimenta las tres vitrinas del contador.
6. El contador **excluye** la agenda, las completadas y los seguimientos automáticos.
7. **Toda la tarjeta** del puente es clicable.
8. La celebración sale **del mismo lugar** que actualiza los números.
9. Reloj de **60 s**, y **cero** llamadas al CRM.
