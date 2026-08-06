# Módulo Closer

El territorio post-agenda: de la cita a la venta. Es el módulo más grande y el más usado.

Cuatro tabs: **Inicio** (cockpit) · **Mi Día** (la cola de trabajo) · **Pipeline** · **Agenda**.

## Inicio — el cockpit

Oscuro y dorado. El dorado significa dinero y logro, nada más.

- **Cash Collected del mes**, protagonista. Subtítulo: *"Cobrado real, no prometido"*.
- **Anillo de comisión** contra su meta (configurada en Ajustes > Mi Cuenta). Se llena con
  cada Venta registrada, según el % que define el admin. Muestra "faltan $X → N ventas más".
- Tarjetas: Ventas (con tasa) · Acuerdos · Calls del mes · Show rate · Comisión.
- **Puente a Mi Día**: "X tareas pendientes → Ejecutar Mi Día". Toda la tarjeta es clicable,
  no solo el botón.
- Histórico de ingresos (4 meses).

Al registrar una Venta: celebración dorada breve (confeti) + sonido configurable.

**El anillo y el número animan sincronizados** (1,8 s, misma curva) y vuelven a animar cuando
el valor cambia. El anillo capea al 100%; el texto del centro muestra el monto real sin capar.

**Guardia:** "Meta superada" 🎉 nunca se muestra si la comisión es $0, sin importar cómo haya
quedado configurada la meta. Un porcentaje sobre base cero no es un logro.

## Mi Día — la cola de trabajo

Clara y calmada. Un snapshot arriba con tarjetas que hacen scroll a su sección, y después las
colas en orden.

### Las cinco colas

| Cola | Qué junta | Cómo se deriva |
|---|---|---|
| **Intervenciones urgentes** | Rojo. La IA falló y hace falta un humano | Tag `bot_pausado_fallo` en los tags cacheados |
| **Agenda de hoy** | Las citas del día | `closer_citas` con fecha de hoy |
| **Respondieron · Buzón general** | Escribió y nadie contestó | `zona_closer` + bot apagado + último entrante posterior a la última resolución |
| **Seguimientos de hoy** | Los que tocan o vencen hoy | Vista `closer_seguimientos_de_hoy` |
| **Completadas hoy** | Lo cerrado en el día | Avances de hoy + resoluciones de buzón de hoy |

**El Buzón es derivado, no un flag.** No hay una columna "está en el buzón": es una query. Eso
evita el estado que se desincroniza.

**Un contacto en Urgentes NO aparece en Buzón.** Dos colas para la misma persona hacen que
atender una no cierre la otra: gana la más específica.

**"Completadas Hoy" siempre se ve**, aunque esté vacía. Es el ancla de la pantalla. Y se
calcula por query, nunca por flag: a medianoche se vacía sola porque cambia la fecha.

### Anatomía de la fila

Es la misma estructura en Mi Día, Pipeline y el widget de Agenda — un solo componente:

```
[Score] NOMBRE  [chip fuente]  [píldora de situación]  microtexto de última actividad  [6 íconos]  ›
```

- **Score**: letra de fit, círculo sólido. Sin datos → `—`.
- **Chip de fuente**: `META ADS` · `VSL OPT-IN` · `📷 IG PROFILE` · `DIRECTO` (fallback —
  ninguna fila sin origen).
- **Píldora**: la situación **real** del contacto. Nunca una condición temporal — el
  estancamiento y el vencimiento se comunican con tinte de fila y microtexto, jamás como
  píldora.
- **Microtexto**: un evento real, nunca genérico. Rojo si está vencido.

Una fila completada se **atenúa**, no se resume: baja la opacidad, la píldora va a gris y el
nombre se tacha, pero el chip de fuente y **todos** los íconos se siguen renderizando con sus
valores reales.

### Iconografía — los 6 slots

Siempre los 6 en el DOM, en este orden. Inactivos atenuados ~22%, **jamás con un "0"**.

| Ícono | Significado | Se enciende con |
|---|---|---|
| 📹 + n | Reuniones **con el closer** | Citas pasadas no canceladas, menos los No-show registrados |
| 📅 | Tiene cita futura | Cita vigente |
| 📞 + n | Llamadas de agente IA **contestadas** | Acumulativo de por vida. Intentos sin respuesta → ícono atenuado con `✗`. **Las sales calls jamás suman acá** |
| 🤖 | Estado del agente | Verde activo · ámbar pausa temporal · rojo pausado por fallo · gris apagado por humano · violeta+LT derivado · atenuado muerto post-call |
| ⏱ | Seguimiento automático activo | Serie corriendo. **Solo lectura** — se enciende únicamente desde Avanzar |
| 💰 | Venta | Etapa ganado, con el monto |

**El único flag junto al nombre es ⭐ (destacado).** El viejo 🎙 se eliminó: esa información la
absorbió 📹.

> Regla dura detrás de todo esto: **los íconos se CALCULAN de los mismos datos que alimentan
> los tabs, nunca viven como un campo paralelo.** Cuando eran campos sueltos, la ficha decía
> una cosa y la fila otra.

## Avanzar — el único registro de resultados

Botón de ancho completo debajo del header de la ficha. Navegación en dos pasos: grid de
resultados → pantalla de detalle con flecha atrás.

Las seis salidas:

| Salida | Color | Detalle que pide |
|---|---|---|
| **Venta** | verde | Monto + tipo de pago (`Contado`/`Splitwise`/`BNPL`/`Cuotas`) |
| **Acordó comprar, falta pago** | azul | Monto asegurado |
| **Seguimiento** | violeta | Dos pantallas: Situación → Modo |
| **No le interesa** | rojo | Razón de descalificación |
| **No-show** | ámbar | Razón (4 chips, sin default) |
| **Nurture** | azul | Pidió tiempo / Se enfrió |

Todas exigen su selección obligatoria antes de habilitar el botón. La nota siempre es
opcional.

### Qué dispara una Venta

Registrarla actualiza, en el mismo instante: la animación y el sonido · la tarjeta en el
Pipeline · el anillo y el Cash Collected de Inicio · la fila en "Completadas Hoy" · la nota en
el tab Notas · el evento en Historial.

### La regla de la IA muerta

> Una vez que el contacto tuvo su llamada con el closer, el agente de IA **nunca más** puede
> estar habilitado — **excepto si el resultado fue No-show**, porque ese dispara un workflow
> de recuperación que necesita a la IA trabajando.

En código: `no_show` → bot `activo`. Cualquier otra salida → `muerto_postcall`, el toggle deja
de renderizarse. Los contactos de IG se excluyen: nunca tuvieron bot.

Hay una tercera categoría que la regla no debe pisar: **bot activo pero roto**
(`pausado_fallo` + urgente). Eso es un problema en curso, no un estado post-call.

## Pipeline

Siete etapas, en orden: **Agendado · Seguimiento · Cierre en curso · Ganado · No-show ·
Nurture · Descalificado**.

> **Invariante:** la etapa manda la columna. La cita es un dato de la fila, **nunca** el
> criterio de pertenencia. Cuando la columna "Agendado" se armaba desde la caché de citas,
> había contactos que el contador contaba y que no tenían fila en ninguna parte.

> **Invariante:** todo valor que el filtro ofrece **debe** tener su sección. Una sección vacía
> muestra su header con el conteo y un mensaje — nunca desaparece del DOM. Con dos mensajes
> distintos según la causa: "Sin contactos en esta etapa" vs. "Ningún contacto coincide con el
> filtro seleccionado".

La tercera columna cambia de significado: **"Próxima cita"** en Agendado, **"Última
actividad"** en el resto. Una cita vencida se muestra en ámbar con el prefijo `Cita vencida ·`.

**Los congelados se ven**, con opacidad reducida y un chip `FUERA DE ZONA` con tooltip. Siguen
siendo movibles. El contador de Base Total desglosa: `N activos · M congelados`.

## Agenda

Calendario del día + Próximos Días. Cada cita es una tarjeta expandible:

- **Colapsada**: hora · score + nombre · píldora del estado de la cita · chevron.
- **Expandida**: briefing de IA (2–3 líneas: quién es, de dónde vino, qué le importa) · línea
  del video pre-call · botones "Link del Meet" y "Abrir Ficha".

El botón de video solo está activo si la cita tiene sala. Sin sala, ícono atenuado con
tooltip — nunca desaparece del DOM.

## La ficha del contacto

Un componente global que se abre como drawer **donde se lo invoque**. Nunca navega.

**Header** (solo estado, nunca clicable): nombre + teléfono + flags · píldora de situación ·
los 6 íconos. La píldora del header es un **espejo obligatorio** de la píldora de la fila que
abrió la ficha: mismo texto, mismo color.

**Tabs**: `Chat` · `Llamada` · `Perfil` · `Historial` · `Notas`.

- **Chat** — la conversación real desde la caché. Autofocus del compositor en desktop.
- **Llamada** — archivo cronológico de todas las llamadas, cada una con su chip de agente
  (`🎙 SALES CALL` / `📞 LEAD FLOW VOZ` / `📞 APP FLOW VOZ`). El score y el coaching existen
  **solo** en sales calls.
- **Perfil** — agrupa por **significado**, no por formulario de origen: DETALLES / ORIGEN /
  CALIFICACIÓN (fit) / INTERACCIONES (engagement). Un campo de Meta, uno de VSL y uno del
  agente caen los tres en Calificación si los tres miden fit. Los grupos sin campos no se
  renderizan.
- **Historial** — timeline inmutable, con autor real (nombre o `Sistema`).
- **Notas** — las de Avanzar con su contexto automático, más "+ Nota" manual.

### El compositor

`[+] menú de enlaces` · campo de texto · `🤖 toggle`.

**El toggle solo se renderiza donde hay agente.** No existe en IG ni post-sales-call. Ambas
acciones (apagar y encender) piden confirmación. Mientras hay una intervención urgente abierta
queda deshabilitado: solo se reactiva al resolver.

Un mensaje manual con el bot activo dispara `pausa_temporal`, con autor `Sistema` en el
historial — quien decide pausar es el sistema, el humano solo escribió.

**El botón ⏱ del compositor no existe.** El seguimiento se activa únicamente desde Avanzar.

### El menú +

Dos capas que no se confunden:

1. **Catálogo central** — lo gestiona el admin en Ajustes, con scope por rol. Cada entrada
   muestra **etiqueta + monto + procesador**, nunca solo el monto.
2. **Secciones fijas** — `REAGENDA` · `MI CALENDARIO` (el enlace personal del usuario) ·
   `VIDEOLLAMADA` (la sala de la cita existente; **nunca** se genera un Meet suelto).

Los tres links del circuito de citas son distintos: el booking link (fijo, del closer) ≠ el
link del Meet (nace con cada cita) ≠ el link de reagenda (nace con cada cita).

## El ciclo de vida de una tarea

**Responder completa la tarea.** No hace falta pasar por Avanzar.

Al enviar un mensaje a un contacto con tarea de conversación activa, la tarea **se completa de
inmediato** y aparece una barra de 5 s sobre el compositor. Esa barra es puramente la ventana
visual para **deshacer**: hover la pausa y la pone ámbar ("📌 Fijar tarea"), y un clic ahí
revierte el completado y fija la tarea.

> El completado ocurre al enviar, no al terminar la barra. Antes vivía en el callback de la
> barra, así que cerrar la ficha antes de los 5 s dejaba la tarea sin completar.

**Fijada** = no se completa y sube al tope de su sección, con un chip ámbar y un separador
"SIN ATENDER" antes del primer contacto no fijado. También hay un botón directo en el header
("Fijar Tarea" / "Completar Tarea") para el caso "quiero cerrarla ahora sin responder".

**Qué cuenta como tarea de conversación**: `respondido` o `seguimientoPendiente`. La Agenda
del día **no** — esa se cierra con Avanzar.

**Revive**: si el contacto vuelve a escribir después de completada, la tarea se reabre con
autor `Sistema`.

### Regla de visibilidad

> **Una IA activa nunca genera tarea humana.** Si el bot está atendiendo, no debería haber una
> tarea esperando manos.

La excepción legítima es `pausa_temporal` + `respondido`: el humano ya escribió, el bot se
pausó, y el contacto volvió a escribir. Ese es justamente el caso que justifica el revive.

## Contadores

Una sola función pura (`pendingTasksBreakdown`) alimenta las tres vitrinas: el badge del nav,
el título de Inicio y el header de Mi Día. Antes cada una tenía su propia fórmula y mostraban
tres números distintos para lo mismo.

Cuenta: urgentes + respondieron + seguimientos de hoy. **No** incluye la Agenda ni las
Completadas.
