# 07 · Lo que el Setter comparte con el Closer — y lo que no

Los dos módulos se parecen tanto que hay **dos errores simétricos** al replicarlos:

| Error                              | Qué produce                                                         |
| ---------------------------------- | ------------------------------------------------------------------- |
| **Duplicar lo que sí es lo mismo** | Dos derivaciones de una regla, que **divergen en silencio**         |
| **Fusionar lo que no es lo mismo** | Una función con condiciones por rol, donde **ninguna regla se lee** |

Este documento traza la línea. **La regla para trazarla es una sola:**

> **Se comparte lo que es la misma acción sobre el mismo dato. No se comparte lo que difiere en el
> negocio.** Que dos cosas se escriban parecido no las hace la misma cosa.

---

## 1 · Lo que SÍ se comparte, tal cual

| Qué                             | Por qué es literalmente lo mismo                                |
| ------------------------------- | --------------------------------------------------------------- |
| **La ficha del contacto**       | Es el mismo contacto. Ver la carpeta `contactos`                |
| **El chat**                     | Misma conversación, mismo reloj, misma ventana de mensajería    |
| **Las notas**                   | Misma tabla, misma acción — y **cada rol lee las del otro**     |
| **El historial**                | Ídem                                                            |
| **Las llamadas y el perfil**    | Datos del contacto, no del rol                                  |
| **La fila y sus indicadores**   | El estado del contacto no depende de quién lo mire              |
| **El puerto hacia el CRM**      | Aplicar y quitar etiquetas, escribir campos: mismas operaciones |
| **El portón de congelado**      | Misma pregunta, sobre el territorio de cada uno                 |
| **El motor de ingesta**         | Llena una sola caché para los dos                               |
| **La sesión y los permisos**    | Un solo mecanismo, con el rol como filtro                       |
| **El registro de seguimientos** | La misma tabla y la misma vista; el rol es una columna          |

### Las notas compartidas no son un detalle

**El setter escribe una nota, y el closer la lee cuando ese contacto llega a su territorio.** Es el
traspaso de contexto entre las dos personas que trabajan al mismo lead — y por eso la nota viaja **firmada
con quién la escribió**, nunca con un autor genérico.

**Un defecto real que costó esto:** durante un tiempo el setter no llamaba al servicio de notas por
ninguna vía. Las notas se pintaban en pantalla, el usuario las daba por guardadas, y **desaparecían en la
siguiente recarga**. El servicio ya aceptaba los dos roles desde el primer día; lo que faltaba era
llamarlo.

---

## 2 · Lo que NO se comparte, y por qué

| Qué                             | Por qué son cosas distintas                                                   |
| ------------------------------- | ----------------------------------------------------------------------------- |
| **Los efectos de un resultado** | El Closer apaga el agente en casi toda salida; el Setter **en ninguna** — § 3 |
| **Las etapas del pipeline**     | Siete y siete, **ninguna igual**: son dos embudos                             |
| **Las colas de Mi Día**         | Seis y cinco, con criterios propios y una que allá no existe                  |
| **El tablero de inicio**        | Comisión sobre ventas vs. dos tramos con atribución                           |
| **Las series de seguimiento**   | 5 días vs. 7: persiguen una cita, no un cierre                                |
| **Los vocabularios**            | Formas de pago y razones distintas — ver el `03` § 3                          |

---

## 3 · El caso que define la línea

Es el que hay que entender antes de decidir qué unificar:

> **El Closer apaga el agente de IA en toda salida menos No-show**, porque cualquier resultado suyo
> demuestra que el contacto **ya tuvo su llamada de venta**.
>
> **El Setter es pre-agenda por definición: ninguna de sus cinco salidas prueba que hubo una llamada.**

Aplicar ese apagado desde el setter **mataría el agente de un lead que todavía se está calificando** — y
peor en la salida Seguimiento, que es justamente la que lo deja en manos del agente durante días.

**No difieren en un valor: difieren en el negocio.** Y una condición por rol adentro de la función del
otro deja **dos reglas trenzadas** en un archivo que ya era largo. Separadas, cada una dice lo que hace.

> **La prueba para decidir:** ¿se puede expresar la diferencia como un parámetro **sin explicar por qué**?
> Si hace falta un comentario de tres párrafos para justificar el `if`, son dos funciones.

---

## 4 · La forma correcta de compartir: el dato, no la rama

Lo que sí funcionó fue **compartir por composición, no por condición**:

| Se comparte                                                   | Se separa                       |
| ------------------------------------------------------------- | ------------------------------- |
| El puerto que habla con el CRM                                | Qué se le manda                 |
| El tipo del efecto, para que las dos respuestas se lean igual | Qué efectos produce cada salida |
| El portón de congelado                                        | Qué territorio se mira          |
| El registro de seguimientos                                   | Qué serie se elige              |

**Resultado:** las dos respuestas se leen igual —efecto por efecto, con "se hizo" separado de "salió
bien"— sin que ninguna de las dos lógicas tenga que conocer a la otra.

---

## 5 · Los datos que conviven en la misma tabla, separados por el rol

El registro de resultados y el de seguimientos **son una sola tabla para los dos módulos**, y el rol es
una columna. Eso está bien, y trae **tres consecuencias que hay que respetar**:

| Regla                                                                                          |
| ---------------------------------------------------------------------------------------------- |
| **"Completadas hoy" filtra por rol.** Sin eso, un resultado del closer aparece como del setter |
| **Los seguimientos se cruzan contra el territorio.** La vista **no sabe de territorios**       |
| **El mismo contacto puede tener un resultado de cada rol el mismo día**, y cada uno ve el suyo |

La segunda es la más fácil de olvidar, porque **no falla**: sin el cruce, un setter simplemente ve
seguimientos que no son suyos y no hay ningún error en ningún lado.

---

## 6 · Las cinco reglas del producto, que valen para los dos

1. **Sin dato, el elemento no se dibuja.** Un cero medido y un cero no medido no son el mismo hecho.
2. **Nunca reportar un éxito que no ocurrió.**
3. **Una sola derivación por regla.**
4. **Lo que se calcula al leer no envejece**; lo guardado calculado, sí.
5. **Los eventos automáticos no pasan por el registro humano.**

Y la que es propia del Setter, que ya apareció tres veces en esta carpeta porque decide tres cosas
distintas:

> **Ninguna de sus cinco salidas prueba que hubo una llamada de venta.**

---

## Lista de verificación

1. Se comparte **la misma acción sobre el mismo dato**; se separa lo que difiere en el negocio.
2. **Ficha, chat, notas, historial, llamadas, perfil y fila**: compartidos tal cual.
3. **Las notas cruzan de un rol al otro** — es el traspaso de contexto entre personas.
4. Una nota va firmada con **quién la escribió**, nunca con un autor genérico.
5. **Efectos, etapas, colas, tablero, series y vocabularios**: separados.
6. La prueba del `if`: si hace falta explicarlo, **son dos funciones**.
7. Se comparte **por composición** —el puerto, el tipo, el portón—, no por condición.
8. Una sola tabla con el rol como columna, y **tres reglas** que eso obliga a respetar.
