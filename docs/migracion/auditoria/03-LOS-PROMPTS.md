# 03 · Los prompts — los cuatro espacios, y qué hace el auditor con ellos

**Hay cuatro espacios de prompt, uno por agente auditado**, y viven en la pantalla de Auditoría de
Agentes, en su propia pestaña.

| Espacio                          | Lo lee                         |
| -------------------------------- | ------------------------------ |
| **Agente de chat · post-agenda** | El auditor de chat post-agenda |
| **Agente de chat · pre-agenda**  | El auditor de chat pre-agenda  |
| **Agente de voz · post-agenda**  | El auditor de voz post-agenda  |
| **Agente de voz · pre-agenda**   | El auditor de voz pre-agenda   |

**No son los prompts del auditor.** Son los prompts **de los agentes auditados** — el texto que
gobierna cómo se comporta cada agente en el CRM. El auditor los tiene adentro **como referencia**.

---

## 1 · Para qué los tiene adentro

Para que el veredicto no diga solo:

> _"prometió un financiamiento que no existe"_

sino:

> _"**esta línea del prompt** lo permite. Reemplazala por **esta otra**."_

**Sin el prompt, la corrección es un consejo genérico. Con el prompt, es un parche listo para pegar.**

Es la diferencia entre las dos formas de corrección que puede emitir un hallazgo:

| Con prompt cargado                                         | Sin prompt cargado                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------- |
| Cita el **texto exacto y literal** que causa la falla      | No cita nada — el fragmento queda vacío                    |
| La corrección es un **reemplazo**, listo para pegar        | La corrección es una **instrucción autónoma** para agregar |
| En el mismo idioma, tono y formato que el resto del prompt | Empieza indicando **a qué sección** debería ir             |

> **Si no encuentra ningún fragmento que explique la falla, lo deja vacío. No inventa una cita.**

**Y la corrección arregla el PATRÓN, no el caso puntual**: no menciona al contacto ni cita la
conversación adentro del bloque de corrección.

---

## 2 · Dónde viven, y por qué eso importa tanto

> **En la configuración de CADA EMPRESA. Un archivo del repositorio no sirve.**

Dos motivos, y los dos son de fondo:

1. **El prompt es propio de cada cuenta del CRM.** Un archivo solo puede tener uno, y **auditar al
   agente de la empresa B contra el prompt de la empresa A no da un resultado peor: da uno
   convincente y falso.**
2. **Cambiarlo exigía un despliegue.** El cliente no puede pedirle un commit a nadie cada vez que
   ajusta su propio agente.

**Guardar no requiere desplegar: el siguiente análisis lo toma solo.**

### El caché va indexado por empresa + agente

Una instancia caliente del servidor que ya cargó el prompt de una empresa **no puede servírselo al
auditor de otra**.

> Ése es el peor tipo de defecto de los que aparecen acá: **no falla, produce hallazgos convincentes
> y falsos.**

**Y guardar limpia el caché.** Sin eso, esa instancia seguiría auditando con el texto viejo **mientras
el panel dice "guardado"** — un éxito reportado sin efecto.

---

## 3 · El defecto que costó esto, y que conviene heredar sabiendo

Durante todo un período, **el auditor corrió sin prompt de referencia y nadie lo supo**:

- El panel ya guardaba los prompts, con su hash y sus líneas, y los mostraba **confirmados en
  pantalla**.
- La lectura miraba **otro lado** — dos archivos que nunca existieron.

> **La escritura andaba y la lectura miraba a otra parte.** Un éxito reportado sin efecto, que es
> exactamente lo que la regla 2 del producto prohíbe.

**La prueba que lo detecta:** guardá un prompt con una frase inconfundible y mirá si el próximo
veredicto la cita. Si nunca la cita, la lectura no está leyendo lo que la escritura escribe.

---

## 4 · Se versiona por hash del contenido

Cada prompt tiene una **versión**: un hash corto del texto.

### Y se recalcula del texto en cada lectura, no se lee de la columna guardada

Son dos hechos distintos:

| Qué                          | Qué dice                                             |
| ---------------------------- | ---------------------------------------------------- |
| El hash **guardado al lado** | Qué hash tenía el texto **cuando se guardó**         |
| El hash **recalculado**      | Qué hash tiene el texto **que el auditor usa ahora** |

**Si alguien edita la fila por fuera del panel, los dos dejan de coincidir** — y el que vale para
comparar es el recalculado.

### Para qué sirve: "el prompt cambió desde que se detectó esto"

Cada análisis y cada hallazgo guardan **el hash del prompt con el que se juzgó**. Con eso la pantalla
puede avisar que **el fragmento citado puede ya no existir**.

> Sin ese aviso, el técnico pega un reemplazo de un fragmento que ya no está.

Y el hash tiene un segundo uso, en el carril amarillo: **el descarte de duplicados va por
`(patrón, agente, hash del prompt)`**. Si el técnico editó el prompt, la misma recomendación sobre el
prompt **nuevo** sí es información —dice que el arreglo no alcanzó—. **Sin el hash, un patrón
arreglado quedaría silenciado para siempre.** Ver el `07`.

---

## 5 · Quién puede editarlos — y por qué no es el administrador

> **Quien mantiene el prompt del agente en el CRM es el TÉCNICO, no el administrador.**

Los prompts vivían junto a las claves de API, y por eso exigían rol de administrador. **Pedir ese rol
para editar un texto obliga a darle también acceso a todas las credenciales de la empresa** — la clave
del CRM, la del proveedor del modelo, la de la plataforma de anuncios.

Ahora el permiso es **técnico** (con administrador y super-administrador por herencia).

### Y se verifica en el servidor

> **Esconder la pestaña en la interfaz no es un permiso.** El endpoint queda expuesto igual y
> cualquiera con una sesión lo llama a mano.

### Fue una MUDANZA, no una copia

**De la pantalla vieja no quedó ni la lectura.** Dos campos editando el mismo dato es el patrón que
este producto ya pagó caro.

---

## 6 · La ausencia es un estado normal

Una empresa que no cargó su prompt **no es un error**:

| Qué pasa                                                              |
| --------------------------------------------------------------------- |
| El auditor **audita igual**, "de forma general"                       |
| El fragmento citado queda **vacío**                                   |
| La corrección sale como **instrucción autónoma**                      |
| El diagnóstico del estado lo **reporta** como ausente, con la empresa |

**Y el vacío significa borrar**, al revés que en una credencial: un prompt vacío es un estado válido,
y **no se pierde para siempre por accidente** — está en el CRM, de donde se copió.

### El caso sin empresa activa no lanza, y eso es asimétrico a propósito

Una consulta sin empresa puede devolver **datos de otra empresa**; un prompt sin empresa solo hace que
el auditor pierda una referencia y degrade a instrucción autónoma. **Lo segundo no justifica tirar un
análisis.** Y tampoco se cachea, para no envenenar la instancia caliente.

---

## 7 · Lo que la pantalla de prompts muestra de cada uno

| Dato                           | Por qué está                                            |
| ------------------------------ | ------------------------------------------------------- |
| El **texto entero**, editable  | No es un secreto: es lo que hay que poder editar        |
| **Líneas + versión**           | Para saber qué está corriendo, de un vistazo            |
| **Si hay un auditor usándolo** | Un campo gris que nadie explica se lee como "está roto" |

> **Los que todavía no tienen auditor lo DICEN**, con esas palabras: _"se guarda igual, y lo va a usar
> cuando exista"_.

Y los tres estados de carga —**cargando / vacío / no se pudo saber**— se ven distintos. Un `[]` que
también significa "no pude averiguarlo" es lo que la regla 2 prohíbe.

**Al guardar se relee**, para traer la versión nueva: mostrar la vieja sería mentir sobre qué está
corriendo.

---

## Lista de verificación

1. **Cuatro espacios**, uno por agente auditado. No son los prompts del auditor.
2. Con prompt → **reemplazo citado**; sin prompt → **instrucción autónoma**.
3. **No se inventa una cita** si no hay fragmento que explique la falla.
4. La corrección arregla **el patrón**, no el caso.
5. Viven en la configuración **de cada empresa**, nunca en el repositorio.
6. **Guardar no requiere desplegar**, y **limpia el caché**.
7. El caché va por **empresa + agente**.
8. El hash **se recalcula del texto**, no se lee de la columna.
9. El hash sostiene **"el prompt cambió"** y el descarte del carril amarillo.
10. El permiso es del **técnico**, y **se verifica en el servidor**.
11. **La ausencia es un estado normal**: se audita igual y se reporta.
12. La pantalla dice **cuáles tienen auditor**, en vez de atenuarlos.
