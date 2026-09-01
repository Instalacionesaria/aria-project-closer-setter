# 02 · El menú del chat — dónde se usa el enlace

**El compositor del chat tiene tres piezas:**

```
[ + ]   [ campo de texto ]   [ 🤖 ]
  │
  └─ el menú de enlaces
```

El `+` abre un panel sobre el compositor. **Es el único lugar donde se usa el catálogo.**

---

## 1 · Dos capas que no se confunden

| Capa                    | Qué es                                                          | De dónde sale      |
| ----------------------- | --------------------------------------------------------------- | ------------------ |
| **El catálogo**         | Los enlaces que cargó el administrador, agrupados por categoría | El catálogo (`01`) |
| **Las secciones fijas** | Reagenda · Mi calendario · Videollamada                         | **Del código**     |

**La segunda capa no es configurable**, y hoy es la que tiene el problema. Ver el § 4.

---

## 2 · Cómo se arma la parte del catálogo

```
para cada categoría:
    los enlaces de esa categoría cuyo alcance incluye MI rol
    si no queda ninguno, la categoría no se dibuja
```

**Cada ítem muestra dos líneas:**

| Línea      | Contenido                                                      |
| ---------- | -------------------------------------------------------------- |
| **Título** | La etiqueta                                                    |
| **Debajo** | Con monto: `monto · procesador` — Sin monto: solo `procesador` |

> **Nunca solo el monto.** Un ítem que dice "$500" y nada más se manda al contacto equivocado.

**El orden es el de carga**, sin ordenamiento propio: los enlaces salen en el orden en que se
agregaron, dentro de su categoría.

---

## 3 · Qué pasa al hacer click: INSERTA, no envía

```
si el campo de texto está vacío  →  queda la URL sola
si ya hay algo escrito           →  la URL se agrega EN UNA LÍNEA NUEVA
en los dos casos                 →  el menú se cierra
```

> **La persona ve el mensaje antes de que salga.** Un menú que envía directo convierte un click
> equivocado en un mensaje enviado a un cliente real, sin vuelta atrás.

**Y no se registra nada:** insertar un enlace no deja rastro. No hay "se le mandó el link de pago el
martes". Ver el `04`.

### Lo que sí pasa al enviar el mensaje

Es el comportamiento normal del chat, y conviene tenerlo presente porque **el enlace lo hereda**:

| Al enviar un mensaje manual                                     |
| --------------------------------------------------------------- |
| Si el agente de IA está activo, **se pausa temporalmente**      |
| Si el contacto tenía una tarea de conversación, **se completa** |

**Mandar un link de pago es un mensaje manual como cualquier otro.**

---

## 4 · Las secciones fijas, y las dos URLs inventadas

Debajo del catálogo hay tres secciones que **no salen de ninguna configuración**:

| Sección           | Cuándo aparece                 | Qué inserta                                           |
| ----------------- | ------------------------------ | ----------------------------------------------------- |
| **Reagenda**      | Solo si el contacto tiene cita | Dos opciones — una de ellas **fabrica una dirección** |
| **Mi calendario** | Siempre                        | El enlace personal de quien está usando la aplicación |
| **Videollamada**  | Solo si el contacto tiene cita | **Fabrica una dirección de videollamada**             |

### ⚠️ Dos de esos botones insertan una dirección que no existe

**Y las dos se arman con el nombre del contacto**, así que parecen personalizadas:

| Botón                                  | Qué inserta                                                            |
| -------------------------------------- | ---------------------------------------------------------------------- |
| Reagenda → **"Que elija el contacto"** | Una dirección con **un dominio de ejemplo** y el nombre del contacto   |
| Videollamada → **"Link del Meet"**     | Una dirección de videollamada **inventada** con el nombre del contacto |

> **Las dos terminan en un mensaje a un cliente real, y las dos llevan a ninguna parte.**

**Y la segunda contradice lo que el diseño dice con todas las letras:** la sección de videollamada debe
mostrar **la sala de la cita que ya existe**, y **nunca generar una suelta**.

### La regla que hay que copiar, y que hoy no se cumple

> **Los tres enlaces del circuito de citas son distintos y ninguno se inventa:**
>
> - **El de agendar** — fijo, del vendedor. Sale de su configuración personal.
> - **El de la videollamada** — **nace con cada cita**. Si la cita no lo trae, **no hay sala**.
> - **El de reagendar** — **nace con cada cita**. Ídem.

**Si el dato no vino con la cita, el botón no se dibuja.** Es la regla 1 del producto aplicada acá: sin
dato, el elemento no se renderiza — **no se fabrica uno plausible**.

### Y una tercera, más silenciosa

**"Mi link para agendar" inserta el enlace personal del usuario, que arranca vacío.** Si no lo cargó,
el botón **inserta una cadena vacía**: parece que no pasó nada.

> El enlace personal **se vació a propósito** —traía un dominio de ejemplo con el nombre de una persona
> real, y se copiaba a cualquier empresa nueva—. Vaciarlo fue correcto; **lo que falta es que el botón
> no se dibuje cuando no hay nada que insertar.**

---

## 5 · Lo que este menú NO hace

| No hace                                          | Por qué importa                                  |
| ------------------------------------------------ | ------------------------------------------------ |
| **No busca.** Es una lista completa              | Con muchos enlaces se vuelve difícil de recorrer |
| **No recuerda** el último usado                  | Nada se ordena por frecuencia                    |
| **No personaliza** la URL por contacto           | El mismo enlace para todos — ver el `04`         |
| **No adjunta archivos**                          | Solo inserta texto                               |
| **No deja registro** de que se insertó un enlace | No hay forma de saber a quién se le mandó qué    |

**Ninguna es un defecto oculto**: son el alcance que tiene hoy. Se listan para que quien lo replique
decida cuáles quiere.

---

## Lista de verificación

1. **Dos capas**: el catálogo configurable y las secciones fijas del código.
2. Las categorías **vacías no se dibujan**, y el filtro es **por rol**.
3. Cada ítem muestra **etiqueta + monto + procesador**, nunca solo el monto.
4. El click **inserta en una línea nueva y cierra el menú**. No envía.
5. Enviar el enlace **pausa al agente** y **completa la tarea**, como cualquier mensaje manual.
6. **Dos botones fabrican una dirección inexistente** y la ponen en un mensaje a un cliente.
7. Los **tres enlaces del circuito de citas son distintos**, y ninguno se inventa.
8. **Si el dato no vino con la cita, el botón no se dibuja.**
9. "Mi link para agendar" **inserta vacío** cuando no está cargado.
10. El menú **no busca, no ordena por uso, no personaliza y no deja registro**.
