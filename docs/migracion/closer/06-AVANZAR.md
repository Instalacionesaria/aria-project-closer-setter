# 06 · Avanzar — el único registro de resultados

El botón de ancho completo debajo del encabezado de la ficha. **De acá sale todo lo que las otras
pantallas muestran**: las columnas del Pipeline, los números del tablero, la píldora de cada fila y la
fila en "Completadas hoy".

---

## 1 · Por qué es el único, y qué se rompe si deja de serlo

> **Con dos caminos que escriban resultados, las cuatro vitrinas divergen sin que nada falle.**

Ya se pagó esa factura con las notas: se escribían en una tabla u otra según el camino, así que aparecían
en un lado y no en el otro — y de trece resultados con nota, **solo dos llegaron a destino**.

**Y no es solo consistencia: la píldora de cada fila es un hecho, no una inferencia**, precisamente
porque la registró una persona. Un segundo camino que escriba la etapa convierte ese hecho en una
suposición.

---

## 2 · Las seis salidas, y qué escribe cada una

Cada salida está declarada en **un catálogo**: su etiqueta, su columna, su campo de subcategoría y las
opciones válidas de ese campo. **Un resultado que no está en el catálogo se rechaza.**

| Salida                         | Columna         | Detalle que pide            | Escribe subcategoría |
| ------------------------------ | --------------- | --------------------------- | -------------------- |
| **Venta**                      | Ganado          | Monto + **forma de pago**   | Sí                   |
| **Acordó comprar, falta pago** | Cierre en curso | Monto asegurado             | **No**               |
| **Seguimiento**                | Seguimiento     | Situación → después el modo | Sí                   |
| **No le interesa**             | Descalificado   | Razón de descalificación    | Sí                   |
| **No-show**                    | No-show         | Razón                       | Sí                   |
| **Nurture**                    | Nurture         | Pidió tiempo / Se enfrió    | Sí                   |

### Los cuatro efectos de un resultado

Cada salida dispara hasta cuatro cosas, y **la respuesta dice qué pasó con cada una**:

| #   | Efecto                         | Dónde         |
| --- | ------------------------------ | ------------- |
| 1   | **La etapa** del contacto      | Base propia   |
| 2   | **La etiqueta** del resultado  | CRM           |
| 3   | **El campo de subcategoría**   | CRM           |
| 4   | **El estado del agente de IA** | CRM (ver § 5) |

Y dos más según el caso: **la nota** (siempre opcional) y **la tarea de seguimiento** (solo en esa salida).

---

## 3 · Las cuatro reglas de validación

**1 · Todas exigen su selección antes de habilitar el botón.** La nota siempre es opcional; la
subcategoría, nunca.

**2 · Una subcategoría que no coincide EXACTO con una opción del catálogo se rechaza.**

> Y no por prolijidad: si se deja pasar, **el CRM responde éxito y no escribe nada**. Nadie se entera.

**3 · La interfaz manda la INTENCIÓN, nunca una fecha calculada por el navegador.**

Se manda _"modo manual, dentro de 3 días"_ y **el servidor resuelve la fecha** contra la zona horaria de
la organización.

> El defecto que esto cierra: aritmética de fechas en la zona del cliente que después de cierta hora
> **devolvía el día siguiente**. Un seguimiento que vencía un día antes o después, según a qué hora se
> registró.

**4 · La etiqueta de la interfaz se traduce al literal del CRM en un solo lugar.** La pantalla muestra
`Avisó · quiere reagendar`; el CRM espera `Avisó quiere reagendar`. Con la traducción repartida, cada
lugar la hace distinto y algunos escriben en el vacío.

---

## 4 · El orden de escritura, que no es intercambiable

> **Primero la base propia, después el CRM.**

**Qué se garantiza:** el resultado, la etapa, la nota y la tarea entran **juntos o no entran**. Una
transacción, un dominio, una base.

**Qué NO se puede garantizar:** que la etiqueta llegue al CRM, porque es otro sistema.

### Por qué en ese orden

Al revés —etiqueta primero— un fallo de la base dejaría al CRM **disparando automatismos por un resultado
que acá no existe**. Y eso **no se repara solo**: el automatismo ya corrió.

### Y la respuesta cuenta la verdad, efecto por efecto

> **Si la etiqueta entró pero el campo falló, eso se ve. No se colapsa en un "listo".**

Es la aplicación directa de la regla de nunca reportar un éxito que no ocurrió. Y tiene una consecuencia
de interfaz: el registro es **optimista** —la píldora cambia y el aviso de éxito sale antes de que el
servidor conteste, porque esperar medio segundo hace sentir la aplicación rota—, así que **hace falta un
canal para avisar después** que algo accesorio no se guardó. Sin él, ese aviso termina en una consola que
nadie abre.

---

## 5 · La regla de la IA muerta

> Una vez que el contacto tuvo su llamada con el closer, el agente de IA **nunca más** puede estar
> habilitado — **excepto si el resultado fue No-show**.

| Salida          | Qué pasa con el agente                                             |
| --------------- | ------------------------------------------------------------------ |
| **No-show**     | **Queda activo.** Dispara un flujo de recuperación que lo necesita |
| Las otras cinco | **Muerto post-llamada**, y el interruptor deja de dibujarse        |

**Y hay una tercera categoría que esta regla no debe pisar: el agente activo pero roto.** Un contacto con
el agente pausado por fallo del auditor está en un problema **en curso**, no en un estado post-llamada.
Si la regla lo tratara como muerto, la urgencia dejaría de ser atendible.

**Los contactos sin agente quedan fuera**: en el canal donde no hay bot, nunca lo hubo.

---

## 6 · La salida de Seguimiento, que tiene dos pantallas

Es la única con dos pasos: primero **la situación** —en qué está el contacto— y después **el modo** —cómo
se lo va a perseguir—.

| Modo           | Qué dispara                     | Enciende el ícono ⏱ |
| -------------- | ------------------------------- | ------------------- |
| **Automático** | Una serie de toques del CRM     | **Sí**              |
| **Manual**     | **Nada.** Lo retoma una persona | No                  |

**El modo manual no dispara ninguna serie, y ése es su punto:** le dice al CRM que **no persiga** a este
contacto porque lo retoma alguien. La fecha del recordatorio vive en la aplicación, no en el CRM.

**Y no todas las situaciones admiten modo automático.** El catálogo lo declara por situación; una
combinación no permitida se rechaza con su motivo, no se degrada en silencio.

---

## 7 · Lo que dispara una Venta

Registrarla actualiza, **en el mismo instante**:

1. La celebración y el sonido.
2. La tarjeta en el **Pipeline**.
3. El anillo y el cobrado del mes en **Inicio**.
4. La fila en **"Completadas hoy"**.
5. La nota en el tab de **Notas**.
6. El evento en el **Historial**.

> **Si alguna de esas seis no se actualiza sola, quedan dos números distintos para el mismo hecho** — y el
> usuario no tiene forma de saber cuál creer.

Es el mejor caso de prueba de todo el módulo: **registrar una venta y verificar las seis vitrinas sin
recargar.**

---

## 8 · Lo que Avanzar NO hace

| No hace                                        | Quién lo hace                             |
| ---------------------------------------------- | ----------------------------------------- |
| **Completar una tarea de conversación**        | Responder un mensaje ya la completa       |
| **Registrar eventos automáticos**              | Se anotan solos, con autor `Sistema`      |
| **Mover a alguien de territorio**              | El traspaso lo hace el CRM al agendar     |
| **Activar un seguimiento desde el compositor** | **No existe ese camino**, y es deliberado |

La última fila importa: **el seguimiento se enciende únicamente desde acá**. Un segundo botón en el
compositor serían dos caminos para el mismo hecho — y dos caminos que se desincronizan.

---

## Lista de verificación

1. **Un solo lugar** registra resultados. Sin excepciones.
2. Las seis salidas salen de **un catálogo** con su etiqueta, columna, campo y opciones.
3. Una subcategoría **inexacta se rechaza**, porque el CRM la aceptaría y la descartaría.
4. La interfaz manda **intención**, no fechas: el servidor resuelve en la zona de la organización.
5. **Base propia primero, CRM después.**
6. La respuesta cuenta **efecto por efecto**, y hay un canal para avisar lo accesorio que falló.
7. **No-show deja el agente vivo**; las otras cinco lo matan.
8. El **pausado por fallo** no es un estado post-llamada y no se pisa.
9. Seguimiento tiene **dos pantallas**, y el modo manual **no dispara nada**.
10. Una venta actualiza **seis vitrinas sin recargar**.
