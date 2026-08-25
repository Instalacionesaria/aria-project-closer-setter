# 01 · Cómo llega un contacto — las etiquetas y las vías de entrada

Todo empieza acá: **un contacto existe en el CRM y la aplicación tiene que verlo.** Si esta parte está
mal, todo lo demás muestra pantallas vacías sin decir por qué.

---

## 1 · La etiqueta que lo trae: el territorio

**No se traen todos los contactos del CRM.** Una cuenta real tiene decenas de miles, y la mayoría no son
trabajo de nadie en esta aplicación. Lo que decide es **una etiqueta de territorio**:

| Etiqueta      | Qué significa                           | De quién es el contacto |
| ------------- | --------------------------------------- | ----------------------- |
| `zona_setter` | Entró como lead y **todavía no agendó** | Del setter              |
| `zona_closer` | **Ya agendó** una cita                  | Del closer              |

**Al agendar, la etiqueta se reemplaza**: sale `zona_setter`, entra `zona_closer`. Es el mismo contacto
cambiando de dueño, **sin resetear ningún dato** — su historial, sus notas y sus llamadas siguen ahí.

### La decisión de pertenencia vive en UNA función

> Un solo lugar decide si un contacto pertenece a un módulo. **Cambiar el criterio es tocar una función,
> no recorrer la lógica.**

Y esa función tiene un interruptor que conviene entender: **puede exigir la etiqueta o no exigirla**.
Arranca sin exigirla —con datos de ejemplo que no tienen etiquetas, el filtro dejaría la aplicación
vacía— y **se enciende cuando los contactos llegan del CRM de verdad**.

Es un detalle chico con una consecuencia grande: **el día que se enciende, todo contacto sin etiqueta
desaparece de las pantallas**. Mejor saberlo antes que descubrirlo.

---

## 2 · Congelado: el que perdió su territorio

Un contacto **congelado** es el que **no está en ningún territorio**: perdió su etiqueta y no ganó la
otra.

| Qué le pasa                                | Qué NO le pasa                  |
| ------------------------------------------ | ------------------------------- |
| Sigue **visible** en el Pipeline, atenuado | **No desaparece**               |
| Sigue siendo **movible**                   | **No se borra** de la base      |
| **No se gasta ni una llamada más** en él   | No entra a las colas de trabajo |

**Y se descongela solo**: si una etiqueta de territorio reaparece en un refresco futuro, el mismo
mecanismo lo devuelve.

### El defecto que esta definición corrigió, y que vale como advertencia

La regla era "perdió `zona_closer`". Con esa definición, **todo contacto del setter nacía congelado** —
nunca tuvo `zona_closer`, la gana recién al agendar.

> El módulo del setter habría quedado **inerte hacia el CRM desde el primer sincronizado, sin que nada
> fallara**. Pantallas vacías, cero errores, y ninguna pista.

La lección general: **cuando hay dos territorios, una regla escrita en términos de uno solo rompe el
otro en silencio.**

---

## 3 · La fuente: de dónde vino el lead

Cada contacto lleva un **chip de fuente** que se deriva de sus etiquetas al momento de espejarlo:

| Si sus etiquetas dicen…  | Fuente               |
| ------------------------ | -------------------- |
| Algo de Instagram        | El chip de Instagram |
| La etiqueta del anuncio  | Anuncios             |
| Algo del video de ventas | Video / opt-in       |
| **Nada reconocible**     | **Directo**          |

> **Ninguna fila sin fuente.** El último caso no es un error: es un valor de reserva deliberado. Una fila
> sin chip parece una fila rota, y el usuario deja de confiar en las que sí lo tienen.

---

## 4 · Las cuatro vías por las que entra o se actualiza

Ninguna sola alcanza, y cada una cubre un agujero de las otras.

| Vía                              | Cuándo                           | Qué trae                                                |
| -------------------------------- | -------------------------------- | ------------------------------------------------------- |
| **1 · El webhook**               | Al instante, por evento del CRM  | **Un** contacto: el del evento                          |
| **2 · La ingesta de mensajes**   | Cada 10 s, con el módulo abierto | Los mensajes y la fecha del último entrante             |
| **3 · El barrido de territorio** | Cada 2 horas                     | **Relee las etiquetas** de todos, mantiene el congelado |
| **4 · El botón manual**          | Cuando alguien lo aprieta        | Todo, para esa organización                             |

### Por qué el webhook no alcanza

> **Los webhooks se pierden**: un automatismo desactivado, un despliegue a mitad de camino, un error de
> red. **Y un contacto que se pierde no vuelve solo.**

El barrido es la garantía: **el peor caso de un webhook caído pasa a ser "el contacto aparece tarde", no
"el contacto no aparece nunca"**.

### El número que justificó el barrido de etiquetas

Se compararon las etiquetas de la caché contra el CRM: **de 22 contactos, 10 divergían** — y siempre en
la misma dirección, faltaban en la caché.

El motivo: el webhook refresca **un** contacto por evento, lo que tapa el caso frecuente. Pero **una
etiqueta aplicada por un automatismo que no dispara webhook no tenía ninguna vía de entrar**. Lo único
que releía el conjunto corría solo cuando alguien apretaba un botón.

---

## 5 · Qué se guarda y qué se recalcula

La regla de fondo:

> **El CRM siempre gana: la tabla de contactos se sobrescribe entera en cada sincronizado.**

Y de ahí sale la regla que la hace segura:

> **Nada propio de la aplicación vive en esa tabla.** Lo que la aplicación decide —el fijado de una
> tarea, el completado del día, la fecha de un seguimiento manual— vive en **tablas aparte**,
> justamente para que un sincronizado no lo borre.

Si algo propio viviera ahí, se perdería en el próximo refresco, **sin error y sin aviso**.

### Lo que se copia tal cual

Identificador, nombre, teléfono, correo, las etiquetas crudas, y la fuente derivada de ellas.

### Lo que NO se guarda, y se deriva en cada lectura

| Dato                  | Por qué se deriva                                                   |
| --------------------- | ------------------------------------------------------------------- |
| **El estado del bot** | Sale de las etiquetas. Ver abajo — se intentó guardarlo y salió mal |
| **La etapa**          | Sale de las etiquetas… **salvo** si ya hubo un resultado registrado |
| **Los seis íconos**   | Se calculan de los mismos datos que alimentan las pantallas         |

**La historia del estado del bot vale como advertencia.** Había una columna para guardarlo, y la función
de sincronizado **decía llenarla**. En producción estaba vacía en los siete contactos, y **nadie la leía
de vuelta**: el estado ya se derivaba de las etiquetas en cada lectura. Una columna que se escribe y no
se lee es una columna que miente en cuanto alguien empiece a creerle.

### La excepción deliberada: los contadores de llamadas

Los contadores del agente de voz **sí se guardan**, y está justificado por escrito:

- su origen son **campos personalizados del CRM**, así que traerlos en vivo para pintar una lista
  costaría **una llamada por fila**;
- la función de sincronizado **ya tiene el contacto completo en la mano**, así que guardarlos es gratis.

> **Y su frescura se declara, no se promete:** es la del último sincronizado. **No es tiempo real y no se
> vende como tal.**

Esa última frase es la que hace aceptable la excepción. Una denormalización sin la frase es una
denormalización que alguien va a confundir con un dato vivo.

---

## 6 · Lo que cuesta cada vía

| Operación                                | Llamadas al CRM                                         |
| ---------------------------------------- | ------------------------------------------------------- |
| Webhook de contacto                      | 1 (el contacto del evento)                              |
| Ingesta de mensajes, en reposo           | **1** en total, no una por contacto                     |
| Barrido de etiquetas                     | 2 + 1 por contacto activo. **Los congelados cuestan 0** |
| Botón manual                             | 2 + 1 por contacto activo                               |
| **Leer cualquier pantalla de contactos** | **0** — todo sale de la caché                           |

**La última fila es el diseño entero.** Todo el presupuesto se gasta en **traer** los datos cuando
cambian; mostrarlos no cuesta nada.

---

## Lista de verificación

1. Los contactos se traen **por etiqueta de territorio**, no todos.
2. **Una sola función** decide la pertenencia, con su interruptor.
3. El congelado es "**no está en ningún** territorio", no "perdió el mío".
4. Un congelado **se ve, se mueve y no cuesta llamadas**. Y se descongela solo.
5. **Ninguna fila sin fuente**: hay un valor de reserva.
6. **Cuatro vías** de entrada, y el barrido es la garantía contra webhooks perdidos.
7. El CRM **sobrescribe** la tabla entera; **nada propio vive ahí**.
8. El estado del bot y los íconos **se derivan**, no se guardan.
9. Las denormalizaciones son **excepciones justificadas por escrito**, con su frescura declarada.
10. Leer las pantallas de contactos cuesta **cero** llamadas.
