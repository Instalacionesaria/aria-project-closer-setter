# El módulo Setter — cómo funciona, para replicarlo

El espejo del Closer en **pre-agenda**: de que entra el lead hasta que hay una cita.

Esta carpeta describe el módulo entero — qué muestra cada pantalla, con qué reglas, qué etiquetas lo
gobiernan, qué escribe cada acción y cómo se refresca — para que otra herramienta pueda **reproducir el
comportamiento**. Sin nombres de archivo, de tabla ni de proveedor.

> **Leé primero la carpeta `closer`.** Buena parte del Setter es el mismo mecanismo con otro vocabulario,
> y acá solo se explica **lo que cambia**. Lo que se comparte de verdad —la fila, la ficha, las notas—
> está en el `07`, con la lista de qué NO se comparte y por qué.

---

## Los siete documentos

| #      | Documento                                                            | Qué contiene                                                        |
| ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| **01** | [Mi Día](01-MI-DIA.md)                                               | Las **seis** colas — dos que el Closer no tiene, y una que le falta |
| **02** | [Pipeline](02-PIPELINE.md)                                           | Sus siete etapas propias, y por qué solo tres tienen etiqueta       |
| **03** | [Avanzar](03-AVANZAR.md)                                             | Las cinco salidas, y por qué **tres no escriben campo** en el CRM   |
| **04** | [Polling y datos en vivo](04-POLLING-Y-DATOS-EN-VIVO.md)             | **El Setter no tiene relojes.** Qué implica y qué cuesta            |
| **05** | [Inicio y comisiones](05-INICIO-Y-COMISIONES.md)                     | Los dos tramos, y el sello de atribución del que dependen           |
| **06** | [Etiquetas y estados](06-ETIQUETAS-Y-ESTADOS.md)                     | Qué etiqueta decide qué en esta pantalla                            |
| **07** | [Lo que comparte con el Closer](07-LO-QUE-COMPARTE-CON-EL-CLOSER.md) | Qué se reusa, qué **no**, y por qué no se parametrizó               |

---

## El modelo, en una página

### La simetría, que es lo primero que hay que tener claro

|                     | **Setter**                                | **Closer**                            |
| ------------------- | ----------------------------------------- | ------------------------------------- |
| Territorio          | Pre-agenda: entrada → cita                | Post-agenda: cita → venta             |
| Su copiloto de IA   | El agente de captación                    | El agente de citas                    |
| Su "ganado"         | **Agendado** (sin monto) y la venta chica | La venta, con el monto grande         |
| Su columna caliente | Calificado sin agendar                    | Cierre en curso                       |
| Colas exclusivas    | **Estancadas** y **oportunidades chicas** | Agenda de hoy                         |
| Pantallas           | **Tres** — no tiene Agenda                | Cuatro                                |
| Comisión            | Base + diferida por agendas + venta chica | Porcentaje sobre ventas               |
| Al agendar          | El contacto **sale** de todas sus colas   | El contacto **entra** a su territorio |

### El traspaso, que es el único momento en que se cruzan

Al agendar, la etiqueta de territorio **se reemplaza**: sale la del setter, entra la del closer. Es el
mismo contacto cambiando de dueño, **sin resetear ningún dato**.

> Y lo hace **el CRM**, no la aplicación. Ver el `03` § 2: aplicar la etiqueta del closer desde el
> registro de resultados movería el contacto **sin que exista ninguna cita**.

### Las tres pantallas

| Pantalla     | Para qué                        | Reloj                     |
| ------------ | ------------------------------- | ------------------------- |
| **Inicio**   | ¿Cuánto llevo ganado este mes?  | **Ninguno**               |
| **Mi Día**   | ¿Qué hago ahora?                | **Ninguno** — ver el `04` |
| **Pipeline** | ¿Cómo está mi cartera de leads? | **Ninguno**               |

**Ninguna de las tres tiene reloj**, y eso no es un olvido de esta documentación: es lo que hace el
código. El `04` explica qué implica y qué costaría cambiarlo.

### Las cinco reglas, que son las mismas

Valen igual que en el Closer, y por los mismos motivos:

1. **Sin dato, el elemento no se dibuja.** Un cero medido y un cero no medido no son el mismo hecho.
2. **Nunca reportar un éxito que no ocurrió.** Es la regla que decide el § 3 entero de este módulo.
3. **Una sola derivación por regla.** Dos implementaciones divergen en silencio.
4. **Lo que se calcula al leer no envejece**; lo guardado calculado, sí.
5. **Los eventos automáticos no pasan por el registro humano.**

### Y una que es propia del Setter

> **Ninguna de sus cinco salidas prueba que hubo una llamada de venta.**

Es pre-agenda **por definición**. De ahí sale la diferencia de fondo con el Closer —que apaga el agente
en casi toda salida— y es el motivo por el que las dos lógicas están separadas y no parametrizadas.

---

## El orden en que conviene construirlo

Asumiendo que el Closer ya existe, porque la mitad se reusa.

| #   | Qué                                  | Por qué acá                                                                |
| --- | ------------------------------------ | -------------------------------------------------------------------------- |
| 1   | **La etiqueta de territorio** (`06`) | Sin ella el módulo no tiene contactos, y las tres pantallas están vacías   |
| 2   | **Las seis colas** (`01`)            | La pantalla donde se trabaja                                               |
| 3   | **Avanzar** (`03`)                   | Sin resultados no hay etapas ni completadas                                |
| 4   | **El Pipeline** (`02`)               | Lee lo que Avanzar escribió                                                |
| 5   | **El sello de atribución** (`05`)    | Se enciende con las acciones de los pasos 2 y 3 — **antes** que el cockpit |
| 6   | **Inicio** (`05`)                    | Depende del sello: es lo último, no lo primero                             |

**El paso 5 antes del 6 no es un detalle.** La comisión diferida no se puede calcular sin saber qué
contactos trabajó a mano cada setter, y ese sello **tiene que estar persistido antes** de que el tablero
intente sumarlos. Cuando vivía en el navegador —se escribía en seis lugares y no se leía en ninguno—
moría al refrescar, y el tablero mostraba una base inventada.
