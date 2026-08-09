# Módulo Setter

El espejo del closer en pre-agenda: de la entrada del lead hasta la cita. **Todo lo que no
esté acá funciona igual que en el closer** — leer [05-CLOSER](05-CLOSER.md) primero.

## La simetría

| | **Setter** | **Closer** |
|---|---|---|
| Territorio | Pre-agenda: entrada → cita | Post-agenda: cita → venta |
| Copiloto IA | Lead Flow (texto + voz) | Appointment Flow (texto + voz) |
| Su "ganado" | Agendado (won, $0) y LT vendido (won, con monto) | GANADO — el monto HT vive solo acá |
| Su columna 🔥 | Calificado sin agendar | Cierre en curso |
| Colas exclusivas | Estancadas y Oportunidades LT | Registro pendiente (calls sin resultado) |
| Comisión | Base fija + diferida por agendas hands-on + LT por autoría | % sobre ventas |
| Al agendar | El contacto **sale** de todas sus colas | El contacto **entra** a su territorio |

Al agendar, el swap reemplaza `zona_setter` por `zona_closer`. Es el mismo contacto cambiando
de dueño: **cero reseteo de datos**.

## El pipeline de 7 etapas

`Nuevo` → `En calificación` → `Calificado sin agendar` (🔥) → `Low-Ticket ofrecido` →
`Agendado` (handoff al closer) → `Nurture` → `Descalificado`.

## Mi Día — las colas propias

Además de las que comparte con el closer:

### Conversaciones estancadas

Ámbar. Leads apagados hace más de 6 h. Fila con tinte y una línea gris de inactividad — **sin
píldora de "Estancado"**: la píldora muestra la situación real (ej. "EN CALIFICACIÓN"). El
estancamiento es una condición temporal, y las condiciones temporales nunca son píldoras.

**El ciclo de rescates:** la fila muestra el contador ("2º rescate"), enviar el rescate
completa la tarea, y hay un **tope de 3**. Al agotarse, el sistema mueve el contacto solo a
`NURTURE · SIN RESPUESTA`, con autor `Sistema`. Si responde, renace en Respondieron.

> **Hueco conocido:** en WhatsApp con bot, enviar el rescate dispara la pausa temporal y el
> bot retoma. En **Instagram** no hay bot, y el mecanismo que documentaba cómo completar un
> rescate ahí dependía de un botón ⏱ del compositor que se eliminó. **No hay vía definida
> hoy.** No se inventó un reemplazo: pendiente de especificar.

### Oportunidades low-ticket

Violeta. Contactos que el bot derivó por falta de capital. Su bot queda en `derivado_lt` — un
banner morado informativo, sin gating, y el toggle pide una confirmación reforzada para
devolverlo al camino high-ticket.

### Buzón general

Cola única, sin tarea previa. **Filtros por canal**: Todos / WhatsApp / Instagram, con
contador. Los leads de Instagram muestran el chip `📷 IG PROFILE` en vez de una fuente de
formulario — Instagram no tiene formulario, es DM directo.

## Avanzar — las cinco salidas

| Salida | Detalle que pide |
|---|---|
| **Agendó** | Solo manual, con selector de slots |
| **Venta Low-Ticket** | Producto del catálogo + monto pre-llenado editable + forma de pago |
| **Seguimiento** | Los mismos dos grupos que el closer; cambia el contenido del automático |
| **No califica** | Sin capital / Sin urgencia / No es el perfil / Datos falsos |
| **Nurture** | Pidió tiempo / Se enfrió — componente compartido con el closer |

**Cualquier salida de Avanzar en Setter marca "Completadas Hoy".** Y una Venta LT dispara
confeti y sonido, igual que una venta del closer.

## El cockpit

Comisiones del mes en dos tramos, cada uno con su porcentaje configurable en Ajustes:

- **LT cobradas** = bruto low-ticket × % directa
- **Diferidas** = bruto de ventas HT originadas × % diferida

El hero es la suma. No puede mostrar $0 mientras haya ventas reales, porque literalmente se
calcula sumándolas.

**"Agendas generadas" está separada en dos tarjetas**: *automáticas* (las agendó el bot) y
*generadas por vos*. La corrección es de producto, no cosmética: lo que agendó el bot solo no
es mérito del setter.

Sin anillo de meta en v1.

### El latch de atribución

`atribucionSetter` se enciende con la **primera** intervención manual sobre el contacto —
Avanzar, resolver una intervención, fijar o completar una tarea, o un toggle de bot con autor
real (nunca `Sistema`) — y ya no se apaga.

> **Límite honesto:** el latch existe y es real, pero las "diferidas" del cockpit todavía
> salen de una base de referencia, no de cruzar los stores para sumar ventas HT reales de
> contactos marcados. Esa integración cruzada requiere que el contacto del closer sepa qué
> setter lo originó, y es un trabajo de arquitectura aparte.

## Diferencias de comportamiento que conviene tener presentes

- **Instagram no tiene bot.** Las reglas de humano-vs-bot no aplican; el toggle 🤖 no se
  renderiza, y el ícono queda atenuado con el tooltip "Sin agente IA asignado".
- **El contador de tareas del setter tiene cinco categorías**, no tres: urgentes + estancadas
  + oportunidades + respondieron + seguimientos de hoy. Igual que en el closer, una sola
  función pura alimenta las tres vitrinas.
- **La cola de urgentes del setter va a estar vacía** hasta que exista su auditor. Es
  correcto, no un bug — ver [07-AUDITOR-IA](07-AUDITOR-IA.md).
- **`traerMiDia` del setter no tiene backend propio para todo.** El store del setter no hace
  los mismos fetches que el del closer; parte de sus datos siguen siendo semilla. Ver
  [10-ESTADO](10-ESTADO.md).
