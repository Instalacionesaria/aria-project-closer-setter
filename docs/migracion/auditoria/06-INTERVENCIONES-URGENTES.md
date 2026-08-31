# 06 · Intervenciones urgentes — cómo el rojo llega a la cola

**Es la única salida del auditor que interrumpe a una persona.** Todo lo demás es trabajo del técnico.

```
veredicto rojo
      │
      ├─ 1. la NOTA en el contacto      "[IA] <motivo de esta conversación>"
      │
      └─ 2. la ETIQUETA del agente que falló
                 │
                 ├─→ el CRM PAUSA a ese agente
                 └─→ la cola roja del vendedor lo muestra
```

---

## 1 · La nota va PRIMERO, y el orden no es un detalle

**Es la etiqueta la que dispara el automatismo y hace aparecer al contacto en la cola.**

> Si se aplicara antes, existiría una ventana en la que **el vendedor ve la urgencia sin el motivo** y
> lee un texto genérico.

**Y la nota lleva un prefijo declarado** —`[IA]`— para poder releerla después **sin confundirla con
una nota escrita por una persona**.

El cuerpo de la nota es **el motivo de la intervención**: una frase concreta de esta conversación. Ver
el `01` § 1.

---

## 2 · La etiqueta es la del agente que falló, no una genérica

| Etapa del agente que falló | Etiqueta que se aplica          |
| -------------------------- | ------------------------------- |
| Post-agenda                | La de desactivado de ese agente |
| Pre-agenda                 | La del otro                     |

> **Una etiqueta única pausaría a los dos agentes o a ninguno.** El CRM necesita saber **cuál** pausar,
> y reacciona a cada una por su lado.

**Y el agente que se nombra en la etiqueta sale de la misma fuente que el que se juzgó**, así que no
puede apuntar a otro.

### Para LEER da igual cuál fue

La pregunta de la cola es _"¿este contacto ya está marcado?"_, y ahí **se miran las tres**: las dos por
agente **y la legada**, que se sigue leyendo y ya no se escribe.

> **Un contacto marcado con la etiqueta vieja tiene que seguir apareciendo en la cola.** Dejar de
> leerla lo habría hecho desaparecer sin que nada fallara.

### La trampa al armar el automatismo en el CRM

> **No uses un filtro _"contiene desactivado"_.** Existe otra etiqueta parecida que **significa lo
> contrario** — "esta persona ya pasó por la llamada", no "el agente falló". **El filtro va por el
> nombre completo.**

---

## 3 · La cola es una consulta, no un campo

**No existe una columna "es urgente".** La cola se deriva, en el momento, de dos hechos que ya están:

```
tiene alguna etiqueta de fallo del auditor   Y   está en MI territorio   Y   no está congelado
```

**Y hay una cola por rol**, con el mismo criterio y distinto territorio. Como los territorios son
mutuamente excluyentes, **un contacto aparece en la cola de un rol o en la del otro, nunca en las
dos**.

> **Hasta que existió la segunda, un lead con el agente caído en pre-agenda quedaba marcado y sin que
> ninguna pantalla lo mostrara.**

### Un contacto en Urgentes NO aparece en el buzón

**Gana la cola más específica.** Dos colas para la misma persona hacen que se atienda dos veces o
ninguna.

### El motivo sale de la base propia, no del CRM

La misma frase viaja a **dos destinos**: la nota en el CRM, y la fila del análisis. **La cola lee la
fila.**

> Leerlo del CRM era **una llamada por contacto** —1+N— cada vez que alguien mirara la pantalla. Con
> una consulta a la base propia, la cola cuesta **cero llamadas al CRM**, y la respuesta lo declara.

**Y cuando todavía no hay motivo guardado, se dice eso** —"requiere intervención, revisar
conversación"— en vez de inventar un diagnóstico.

---

## 4 · Resolver una intervención

Cuando el vendedor toma la conversación a mano:

| Paso | Qué                                                                         |
| ---- | --------------------------------------------------------------------------- |
| 1    | Los hallazgos **activos** de ese contacto pasan a **"resuelto por humano"** |
| 2    | Se quitan **las tres etiquetas de fallo** del contacto en el CRM            |

**En ese orden**, y el motivo está escrito:

> Si el CRM falla, el hallazgo **ya quedó resuelto** en la base propia y lo único que pasa es que el
> contacto reaparece en la cola — **el estado de antes**. Al revés, una etiqueta quitada con la base
> sin actualizar dejaría al contacto **fuera de la cola con su alerta todavía activa: invisible.**

### Se quitan las tres, y no la que corresponde

**Al resolver no se sabe —ni hace falta saber— con cuál quedó marcado**: puede tener la vieja o
cualquiera de las dos nuevas. **Quitar una sola lo dejaría volviendo a la cola en el próximo refresco
con la alerta ya resuelta**, que es justo el defecto que este paso vino a cerrar.

**Quitar una etiqueta que el contacto no tiene no hace nada**, así que pedir las tres no cuesta nada y
no puede equivocarse.

### "Resuelto por humano" NO es "el patrón está arreglado"

Son **dos estados y no uno**:

| Estado                  | Qué significa                                   |
| ----------------------- | ----------------------------------------------- |
| **Resuelto por humano** | El **caso puntual** está atendido               |
| **Ajustado**            | El técnico **corrigió el prompt** — ver el `08` |

**La falla del agente sigue ahí después de resolver el caso.**

### Y NO se le pide al agente que vuelva a atender

> Quitar la pausa **no es lo mismo** que pedirle al agente que retome a alguien cuya conversación se
> pausó por un fallo grave. Eso es **una decisión de producto, no una consecuencia técnica** de
> resolver la alerta.

**Consecuencia concreta: después de resolver, el contacto sale de la cola y queda sin agente, en manos
del humano que lo tomó.** Que es exactamente lo que "resolver por humano" significa.

### El resultado se reporta separado: se hizo ≠ salió bien

| Qué se devuelve                                               |
| ------------------------------------------------------------- |
| Cuántos hallazgos se resolvieron                              |
| Si la operación sobre el CRM **salió bien**                   |
| Si **realmente se aplicó**, o solo quedó anotada la intención |

> **Una resolución que no pudo quitar la etiqueta no devuelve un error**: la resolución **ya ocurrió**,
> y decir que no se resolvió nada sería mentir. Se reporta la verdad completa —"resuelto, pero la
> etiqueta no se pudo quitar"— en vez de elegir entre **dos medias verdades**.

**Y la idempotencia va por contacto y por día**: reintentar la misma resolución no anota dos veces, y
resolver otra alerta del mismo contacto la semana siguiente sí.

---

## 5 · La voz NO entra a la cola, y es una decisión

| Qué hace el rojo            | Chat   | Voz                          |
| --------------------------- | ------ | ---------------------------- |
| Nota `[IA]` en el contacto  | **Sí** | **Sí**, marcada como llamada |
| Aplica la etiqueta de fallo | **Sí** | **No**                       |
| Entra a la cola de urgentes | **Sí** | **No**                       |
| Corrección de prompt        | **Sí** | **Sí**                       |

**No es una limitación que se resigna:**

> **La llamada ya terminó.** No hay agente hablando que interrumpir ni conversación que pausar.
>
> **Y aplicar la etiqueta pausaría al agente de CHAT de ese contacto** — que es otro agente, y puede
> estar trabajando bien. **Apagar al inocente por el error del otro.**

Lo que sí pasa en los dos casos es lo que importa de fondo: **la nota, y la corrección de prompt para
que el agente no repita el error.**

**El destino operativo del rojo de voz es la pantalla de Auditoría**, no una cola de tareas.

---

## 6 · Una regla que cierra el círculo: si no se guardó, no se analizó

Cuando la escritura del análisis falla, **se registra y se sigue** —para no tumbar el evento entrante—.
Pero la respuesta **no puede decir que se analizó**.

> Durante un tiempo, el evento contestaba que la llamada estaba auditada, **con nivel y todo**,
> mientras en la base no había ninguna fila. Es la regla 2 al pie de la letra —un éxito reportado que
> no ocurrió— y además **dejaba la llamada invisible para el barrido de respaldo**, que busca
> exactamente eso.

---

## 7 · El auditor nunca tumba el evento que lo disparó

**Devuelve siempre; nunca lanza.**

> Un error del auditor no puede provocar que el CRM reintente el evento **ni que desactive el flujo
> que lo manda**.

Todo camino de fallo sale con "no analizado" **y su motivo escrito**, que es lo que después permite
distinguir "la conversación no era auditable" de "el auditor falló" — dos cosas que **desde la pantalla
se ven igual** si el motivo no viaja.

---

## Lista de verificación

1. El rojo produce **nota + etiqueta**, en ese orden.
2. La nota lleva **prefijo declarado** y el motivo de **esta** conversación.
3. La etiqueta es **la del agente que falló**; para leer se miran **las tres**.
4. El filtro del automatismo va **por nombre completo**.
5. La cola es **una consulta**, no un campo.
6. **Una cola por rol**, y un contacto está en una o en la otra.
7. **Urgentes gana sobre el buzón.**
8. El motivo se lee de **la base propia**: cero llamadas al CRM.
9. Sin motivo guardado **se dice**, no se inventa.
10. Resolver: **base primero, CRM después**, y se quitan **las tres** etiquetas.
11. **"Resuelto por humano" ≠ "patrón ajustado"**: son dos estados.
12. **No se le pide al agente que retome**: el contacto queda en manos del humano.
13. Se reporta **"se hizo" separado de "salió bien"**.
14. **La voz no entra a la cola**, y el motivo es que apagaría al agente equivocado.
15. **Si no se guardó, no se analizó.**
16. El auditor **nunca tumba el evento** que lo disparó.
