# closer-setter-excc-1 — Las dos pestañas, y qué hay que conectar

> **Ojo: este documento NO es portable como el resto de la carpeta.** Los documentos `00` a `10` y
> `PRUEBAS` describen un andamiaje genérico que sirve para cualquier producto. Este describe **dos
> pantallas concretas de un producto concreto**: la del Closer y la del Setter. Se transfiere junto con
> los otros porque el destino es rehacer estas dos pantallas, pero no confundas los roles: los otros
> dicen _cómo se construye la base_, este dice _qué se construye arriba_.

Las dos pestañas son **la misma máquina en dos tramos del embudo**. Si entendés una, entendés la otra: la
segunda es la primera con otro vocabulario.

| Pestaña    | Tramo del embudo        | Su objetivo | Su "ganado"                   |
| ---------- | ----------------------- | ----------- | ----------------------------- |
| **Closer** | De la cita a la venta   | Cobrar      | Venta, con monto              |
| **Setter** | De la entrada a la cita | Agendar     | Cita agendada (y venta chica) |

Y el momento en que un contacto pasa de una a la otra es **uno solo**: cuando se agenda. Ahí cambia de
dueño, **sin resetear ningún dato**. Es el mismo contacto con otro responsable.

---

# PARTE 1 · CLOSER

Cuatro tabs internos: **Inicio · Mi Día · Pipeline · Agenda**.

## 1.1 · Inicio — el tablero

Lo primero que ve al entrar. Responde una pregunta: _¿cómo voy este mes?_

**Qué muestra:**

- **Lo cobrado en el mes**, como número protagonista. Cobrado real, no prometido — son dos cosas
  distintas y solo una va acá.
- **Un anillo de comisión** contra su meta, con "faltan $X → N ventas más".
- Tarjetas: ventas, acuerdos sin pagar, llamadas del mes, tasa de asistencia, comisión.
- **Un puente a Mi Día**: "X tareas pendientes → Ejecutar Mi Día". Toda la tarjeta clicable, no solo el
  botón.

**Qué conectar:** una sola llamada, `GET /closer/inicio`, que devuelve todo el tablero ya calculado.

**Las tres reglas de esta pantalla:**

1. **Sin dato no se muestra un cero.** Si la comisión no está configurada, va un `—`, no `$0`. Un cero
   afirma "no ganaste nada"; un guion dice "no lo sé".
2. **"Meta superada" nunca aparece si la comisión es cero**, por más que la meta esté en cero también. Un
   porcentaje sobre base cero no es un logro.
3. **El número y el anillo animan juntos** y vuelven a animar cuando el valor cambia. El anillo se topa
   en 100 %; el número del centro muestra el monto real sin topar.

## 1.2 · Mi Día — la cola de trabajo

La pantalla donde se trabaja. Arriba un resumen con tarjetas que hacen scroll a su sección; abajo las
colas, en orden.

**Las cinco colas, en este orden:**

| Cola                             | Qué junta                             |
| -------------------------------- | ------------------------------------- |
| **Intervenciones urgentes**      | La IA falló y hace falta un humano ya |
| **Agenda de hoy**                | Las citas del día                     |
| **Respondieron · Buzón general** | Escribieron y nadie contestó          |
| **Seguimientos de hoy**          | Los que tocan o vencen hoy            |
| **Completadas hoy**              | Lo cerrado en el día                  |

**Qué conectar:** `GET /closer/mi-dia` devuelve las cinco colas armadas.

**Las cuatro reglas de esta pantalla:**

1. **Las colas se calculan, no se guardan.** No hay una columna "está en el buzón": es una consulta. Un
   estado guardado se desincroniza; una consulta no puede.
2. **Un contacto está en una cola sola.** Si está en Urgentes, no aparece en Buzón. Dos colas para la
   misma persona hacen que atender una no cierre la otra: gana la más específica.
3. **"Completadas hoy" siempre se ve**, aunque esté vacía. Es el ancla de la pantalla. Y como se calcula
   por fecha, a medianoche se vacía sola.
4. **Una IA activa nunca genera tarea humana.** Si el bot está atendiendo, no debería haber una tarea
   esperando manos.

### La fila, que es la misma en todas partes

Un solo componente para Mi Día, Pipeline y Agenda. Si son tres componentes, divergen.

```
[Score] NOMBRE  [chip de fuente]  [píldora de situación]  microtexto de última actividad  [6 íconos]  ›
```

- **Score**: la letra de calificación. Sin dato → `—`.
- **Chip de fuente**: de dónde vino el lead. **Ninguna fila sin fuente** — si no se sabe, va un valor de
  reserva.
- **Píldora**: la situación **real** del contacto, nunca una condición temporal. "Está estancado" o "está
  vencido" se comunican con el color de la fila y el microtexto, **jamás** con la píldora.
- **Microtexto**: un evento real ("respondió hace 2 h"), nunca una frase genérica.

**Una fila completada se atenúa, no se resume.** Baja la opacidad, la píldora va a gris, el nombre se
tacha — y el chip y **los seis íconos siguen ahí con sus valores reales**.

### Los seis íconos

**Siempre los seis en la pantalla**, en el mismo orden. Los inactivos se atenúan; **nunca** se muestra un
"0".

| Ícono  | Qué dice                                     |
| ------ | -------------------------------------------- |
| 📹 + n | Reuniones que ya tuvo con el closer          |
| 📅     | Tiene una cita futura                        |
| 📞 + n | Llamadas de agente IA **contestadas**        |
| 🤖     | Estado del agente: activo, pausado, apagado… |
| ⏱      | Tiene un seguimiento automático corriendo    |
| 💰     | Venta, con el monto                          |

> **La regla que hay que respetar sí o sí: los íconos se CALCULAN de los mismos datos que alimentan las
> pantallas. Nunca son un campo aparte.** Cuando eran campos sueltos, la ficha decía una cosa y la fila
> otra, y las dos parecían correctas.

## 1.3 · Pipeline

Siete columnas, en orden: **Agendado · Seguimiento · Cierre en curso · Ganado · No-show · Nurture ·
Descalificado**.

**Qué conectar:** `GET /closer/pipeline`.

**Dos reglas:**

1. **La etapa manda la columna.** La cita es un dato de la fila, nunca el criterio de pertenencia. Cuando
   la columna "Agendado" se armaba desde las citas, había contactos que el contador contaba y que no
   tenían fila en ninguna parte.
2. **Todo valor que el filtro ofrece tiene su sección.** Una sección vacía muestra su encabezado con el
   conteo y un mensaje — **no desaparece**. Y con dos mensajes distintos: "sin contactos en esta etapa" vs
   "ninguno coincide con el filtro".

La tercera columna cambia de significado: **"próxima cita"** en Agendado, **"última actividad"** en el
resto.

## 1.4 · Agenda

Calendario del día más los próximos días. Cada cita es una tarjeta que se expande:

- **Cerrada**: hora · score y nombre · estado de la cita.
- **Abierta**: un resumen de dos o tres líneas sobre quién es y qué le importa · botones de videollamada
  y de abrir la ficha.

**Qué conectar:** `GET /closer/agenda`.

**Regla:** el botón de video solo está activo si la cita tiene sala. Sin sala, ícono atenuado con
explicación — **no desaparece**.

## 1.5 · La ficha del contacto

Un panel lateral que se abre **donde se lo invoque**. Nunca navega a otra pantalla.

**Encabezado**: nombre, teléfono, la píldora de situación y los seis íconos. La píldora del encabezado es
un **espejo obligatorio** de la píldora de la fila que abrió la ficha: mismo texto, mismo color. Si no
coinciden, el usuario deja de confiar en las dos.

**Cinco tabs, y cada uno es una llamada propia al abrirlos:**

| Tab           | Qué muestra                                        | Qué conectar               |
| ------------- | -------------------------------------------------- | -------------------------- |
| **Chat**      | La conversación real, con el compositor abajo      | `GET /closer/chat`         |
| **Llamada**   | Todas las llamadas, cada una con su tipo de agente | `GET /closer/llamadas`     |
| **Perfil**    | Los datos del contacto, agrupados por significado  | `GET /closer/perfil`       |
| **Historial** | Línea de tiempo inmutable, con el autor real       | `GET /closer/historial`    |
| **Notas**     | Las notas, con "+ Nota" para agregar               | `/closer/notas` (GET/POST) |

**El Perfil se agrupa por significado, no por formulario de origen.** Un campo del anuncio, uno del video
y uno del agente caen los tres en "Calificación" si los tres miden lo mismo. Los grupos sin campos no se
dibujan.

**El compositor** tiene tres partes: un menú de enlaces, el campo de texto, y el interruptor del bot. El
interruptor **solo existe donde hay agente**, y tanto apagarlo como encenderlo piden confirmación.

## 1.6 · Avanzar — el único lugar donde se registra un resultado

Botón de ancho completo debajo del encabezado de la ficha. Dos pasos: primero la grilla de resultados,
después el detalle.

**Las seis salidas:**

| Salida                         | Qué pide                     |
| ------------------------------ | ---------------------------- |
| **Venta**                      | Monto + forma de pago        |
| **Acordó comprar, falta pago** | Monto asegurado              |
| **Seguimiento**                | Situación, y después el modo |
| **No le interesa**             | Razón                        |
| **No-show**                    | Razón                        |
| **Nurture**                    | Pidió tiempo / se enfrió     |

**Qué conectar:** `POST /closer/avanzar`.

**Tres reglas:**

1. **Todas exigen su selección** antes de habilitar el botón. La nota siempre es opcional.
2. **Registrar una venta actualiza todo de una vez**: la celebración, la tarjeta del pipeline, el anillo y
   el número de Inicio, la fila en "Completadas hoy", la nota y el historial. Si alguna de esas no se
   actualiza sola, quedan dos números distintos para el mismo hecho.
3. **Responder también completa la tarea**, sin pasar por Avanzar. Al enviar el mensaje la tarea se
   completa **en ese momento** —no cuando termina la animación— y aparece una barra de unos segundos para
   deshacer. Si el completado viviera al final de la animación, cerrar la ficha antes dejaría la tarea sin
   completar.

---

# PARTE 2 · SETTER

**Todo lo que no esté acá funciona igual que en el Closer.** Leé la parte 1 primero: no es una cortesía,
es que la mitad de esta pantalla es la misma.

Tres tabs: **Inicio · Mi Día · Pipeline**. **No tiene Agenda** — su trabajo termina cuando la cita
existe, y de ahí en adelante es del closer.

## 2.1 · La simetría, en una tabla

|                     | **Setter**                                | **Closer**                          |
| ------------------- | ----------------------------------------- | ----------------------------------- |
| Tramo               | Entrada → cita                            | Cita → venta                        |
| Su copiloto de IA   | El agente de captación                    | El agente de citas                  |
| Su "ganado"         | Agendado, y la venta chica con su monto   | La venta, con el monto grande       |
| Su columna caliente | Calificado sin agendar                    | Cierre en curso                     |
| Colas exclusivas    | Estancadas y oportunidades chicas         | —                                   |
| Comisión            | Base + diferida por agendas + venta chica | Porcentaje sobre ventas             |
| Al agendar          | El contacto **sale** de sus colas         | El contacto **entra** al territorio |

## 2.2 · Pipeline — siete etapas propias

**Nuevo → En calificación → Calificado sin agendar → Oferta chica → Agendado → Nurture → Descalificado**.

`Agendado` es el traspaso: el contacto deja de ser del setter.

**Qué conectar:** `GET /setter/pipeline`.

## 2.3 · Mi Día — dos colas que el closer no tiene

Además de urgentes, respondieron, seguimientos y completadas:

**Conversaciones estancadas.** Leads apagados hace más de unas horas. La fila lleva un tinte y una línea
de inactividad — **pero la píldora sigue mostrando la situación real** ("en calificación"), no "estancado".
El estancamiento es una condición temporal, y las condiciones temporales nunca son píldoras.

Y tienen un ciclo con tope: la fila muestra el contador ("2º rescate"), enviar el rescate completa la
tarea, y **al tercero el sistema mueve el contacto solo** a nurture sin respuesta, con autor `Sistema`. Si
después responde, vuelve a aparecer en Respondieron.

**Oportunidades chicas.** Contactos que el bot derivó porque no tenían capital para el producto grande. Su
bot queda en un estado propio, con un aviso informativo — **sin bloquear nada** — y volver a ponerlos en
el camino grande pide una confirmación reforzada.

**El buzón del setter tiene filtros por canal** (todos / WhatsApp / Instagram) con su contador, porque
según el canal el lead llegó de formas distintas: en Instagram no hay formulario, es mensaje directo.

**Qué conectar:** `GET /setter/mi-dia` y `GET /setter/urgentes`.

## 2.4 · Avanzar — cinco salidas

| Salida          | Qué pide                                                    |
| --------------- | ----------------------------------------------------------- |
| **Agendó**      | Selector de horarios                                        |
| **Venta chica** | Producto del catálogo + monto editable + forma de pago      |
| **Seguimiento** | Igual que el closer, con otro contenido automático          |
| **No califica** | Sin capital / sin urgencia / no es el perfil / datos falsos |
| **Nurture**     | Pidió tiempo / se enfrió                                    |

**Qué conectar:** `POST /setter/avanzar`.

**Dos reglas:**

1. **Cualquier salida marca "Completadas hoy"**, y la venta chica celebra igual que una venta grande.
2. **Dos de las cinco no avisan al CRM, y es correcto.** "Agendó" no, porque el traspaso lo hace el
   automatismo del CRM cuando la cita existe de verdad — avisarlo desde acá dejaría un lead en la cola del
   closer sin nada agendado. Y la venta chica tampoco, porque no hay una etiqueta que signifique eso: la
   única parecida significa _derivado_ a producto chico, que es un ruteo, no un cobro. **Las dos se
   registran igual en la base**, con su monto y su detalle.

## 2.5 · Inicio — el tablero del setter

Su comisión tiene **dos tramos**, cada uno con su porcentaje configurable:

- **Ventas chicas cobradas** × su porcentaje directo
- **Ventas grandes que él originó** × su porcentaje diferido

El número protagonista es la suma. **No puede mostrar cero si hay ventas reales**, porque literalmente se
calcula sumándolas. Y **sin porcentaje cargado muestra `—`, no `$0`**: un cero afirmaría que esa persona
no ganó nada, cuando lo que pasa es que nadie configuró su comisión.

**Las agendas van en dos tarjetas separadas: las que agendó el bot y las que agendó él.** No es cosmético:
lo que agendó el bot solo no es mérito del setter.

**Qué conectar:** `GET /setter/inicio`.

### El detalle que hace que la comisión diferida funcione

Para pagarle al setter por una venta que cerró el closer, hay que saber **quién originó ese contacto**. Eso
se resuelve con un sello que se pone **una sola vez**: se enciende con la primera intervención manual del
setter sobre el contacto —avanzar, resolver una urgencia, fijar o completar una tarea, un cambio de bot con
autor real— y **ya no se apaga**.

Dos condiciones para que no se rompa:

1. **Se guarda en la base, no se recalcula.** Si se deduce cada vez, cambia con los datos.
2. **Se escribe solo si está vacío.** El segundo setter que toque el contacto no le roba la atribución al
   primero, que es quien lo originó — y es exactamente lo que la comisión diferida paga.

---

# PARTE 3 · Lo que las dos comparten y no se puede romper

Cinco reglas. Si alguna se rompe, el sistema sigue funcionando y **muestra datos falsos**, que es peor.

1. **Sin dato, el elemento no se dibuja.** Un cero medido y un cero no medido no son el mismo hecho. Un
   contador en cero se atenúa; no muestra "0".
2. **Nunca reportar un éxito que no ocurrió.** Si una escritura falla, la respuesta lo dice — aunque sea
   accesoria y no se pueda hacer nada.
3. **Una sola función por regla.** Si dos pantallas muestran el mismo número, comparten la función que lo
   calcula. Dos implementaciones divergen en silencio, y las dos parecen bien.
4. **Lo que se calcula al leer no se queda viejo; lo que se guarda calculado, sí.** Guardar un resultado
   ya calculado es la excepción, y se justifica por escrito.
5. **Los eventos automáticos no pasan por Avanzar.** Se registran solos, con autor `Sistema`.

## Las notas son de las dos pestañas

**Van a la misma tabla y por el mismo endpoint**, que acepta los dos roles. No hay un endpoint de notas por
rol y no debería haberlo: es el mismo dato sobre el mismo lead.

Es el error más fácil de cometer al construir la segunda pestaña: duplicar el almacenamiento. Cuando pasó,
las notas del setter vivían solo en memoria y **se perdían al recargar la página**, sin que nada fallara.

## Cómo se conecta cada endpoint

Todos siguen la misma forma, y conviene respetarla desde el primero:

```
1 · Verificar la sesión y el rol         -> si no, cortar acá
2 · Verificar el método (GET o POST)     -> si no, cortar acá
3 · Abrir el contexto de la empresa      -> ninguna consulta corre sin esto
4 · Responder { ok: true, ...datos }  o  { ok: false, error }
```

**Que la respuesta lleve siempre `ok`** es lo que permite que el frontend distinguya "no hay datos" de "no
pude averiguarlo". Sin eso, un error se ve como una lista vacía — y una lista vacía nadie la reporta.

---

# PARTE 4 · En qué orden conectar

No es una preferencia: cada paso hace visible el siguiente.

| #   | Qué                                               | Por qué va acá                                                          |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------- |
| 1   | **La fila y los seis íconos**, como un componente | Lo usan las tres pantallas. Hecho al final, hay que rehacer las tres    |
| 2   | **La ficha con sus cinco tabs**                   | Es a donde llevan todas las filas                                       |
| 3   | **Avanzar**, con sus salidas                      | Sin esto no hay resultados, y sin resultados los tableros están vacíos  |
| 4   | **Mi Día del closer**                             | La pantalla donde se trabaja                                            |
| 5   | **Pipeline y Agenda del closer**                  | Leen lo que Avanzar escribió                                            |
| 6   | **Inicio del closer**                             | Es el resumen de todo lo anterior: se conecta cuando hay algo que sumar |
| 7   | **El Setter completo**                            | Reusa todo lo de arriba. Si empezás por acá, lo construís dos veces     |

Y una advertencia sobre el paso 7: **el Setter parece la mitad del trabajo del Closer y no lo es.** Tiene
dos colas propias con su ciclo de rescates, un pipeline distinto, dos tramos de comisión y el sello de
atribución. Lo que se reusa es la fila, la ficha y la forma de Avanzar — no la lógica.

## La prueba mínima que hay que poder pasar

Antes de dar cualquiera de las dos pestañas por terminada:

1. **El mismo número se muestra igual en todas partes.** El contador del menú, el título de Inicio y el
   encabezado de Mi Día tienen que decir lo mismo — y decirlo porque comparten la función, no porque
   coincidieron.
2. **Registrar una venta actualiza las seis vitrinas de una vez**, sin recargar.
3. **Una nota escrita sobrevive a recargar la página.** Suena obvio; es el defecto que más veces apareció.
4. **Un contacto no está en dos colas a la vez.**
5. **Con dos empresas cargadas, ninguna ve los contactos de la otra.** Con una sola empresa en el entorno
   de desarrollo, ese defecto no se manifiesta nunca.
