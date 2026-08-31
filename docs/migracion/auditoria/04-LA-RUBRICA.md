# 04 · La rúbrica, adentro

Es el producto entero. Todo lo demás la alimenta o la frena.

---

## 1 · Qué se le manda al modelo, y en qué orden

Cuatro bloques de contexto, más el mensaje con la conversación:

| #   | Bloque                                     | Cambia entre análisis                |
| --- | ------------------------------------------ | ------------------------------------ |
| 1   | **El contexto del agente**                 | No — es fijo por territorio y canal  |
| 2   | **El prompt del agente**                   | No — solo cuando el técnico lo edita |
| 3   | **La rúbrica**                             | No — es fija                         |
| 4   | **Los patrones ya conocidos**              | **Sí** — crecen con cada hallazgo    |
| —   | Los **hechos medidos** + el **transcript** | Sí — son el mensaje                  |

**Los primeros tres son el prefijo estable, y ahí va el corte del caché.** El cuarto queda afuera a
propósito: ver el `09`.

---

## 2 · La estructura de la rúbrica, sección por sección

| Sección                      | Qué establece                                                 |
| ---------------------------- | ------------------------------------------------------------- |
| **Las dos salidas**          | Intervención vs. hallazgo, y que son independientes           |
| **Cómo leer el transcript**  | Los autores y la **regla de atribución innegociable**         |
| **Precondición**             | Cuándo NO se audita, y que no se fuerce un veredicto          |
| **Los criterios**            | Siete, cada uno con su **disparo** y sus **descartes**        |
| **Intervención humana**      | Las cuatro condiciones, y qué NO es intervención              |
| **Severidad**                | Rojo vs. amarillo de cada hallazgo                            |
| **Categoría**                | Comportamiento · base de conocimiento · información adicional |
| **La corrección al prompt**  | Las dos ramas: con prompt y sin prompt                        |
| **El código de patrón**      | Formato, y la orden de reusar uno existente                   |
| **El nivel del veredicto**   | Los tres, y que la coherencia la verifica el código           |
| **Resumen y observaciones**  | Que se llenan siempre, y la diferencia con un hallazgo        |
| **Sentimiento del contacto** | Del contacto, no del agente, e independiente del resto        |

**Lo único que cambia entre los cuatro auditores son dos piezas**: la lista de criterios (por
territorio) y el bloque de medio (chat o voz). **Todo lo demás es el mismo texto.**

---

## 3 · El transcript ETIQUETA, no filtra

Cada línea lleva **fecha, hora y autor real**:

```
[03/08 14:02] CONTACTO: hola, me pasan el link de pago?
[03/08 14:02] AGENTE IA: ¡Claro! Te lo envío en un momento 😊
[03/08 16:40] AUTOMATIZACIÓN: Hola 👋 te recordamos tu sesión de mañana.
[03/08 17:20] ASESOR HUMANO: Perdón por la demora, acá va: pay.link/x
```

Filtrar a los que no son el agente **parece más limpio** y produce cinco errores concretos:

| #   | Qué pasa al filtrar                                                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------- |
| 1   | La bronca del contacto suele responder a **una plantilla automática**. Sin verla, el auditor le atribuye el enojo al agente |
| 2   | Un **asesor humano posterior** convierte "dejó de responder" en un **traspaso**                                             |
| 3   | Si la promesa incorrecta la hizo una plantilla, **la corrección va al flujo, no al prompt**                                 |
| 4   | "Insiste y no entiende" se juzga **contando turnos**; sacar mensajes cambia la cuenta                                       |
| 5   | La evidencia que se guarda tiene que poder **recortarse del mismo transcript** que vio el modelo                            |

**Y un texto entre corchetes —`[nota de voz sin transcripción]`— es un mensaje que existió y cuyo
contenido no tenemos.** La rúbrica dice explícitamente: no supongas qué decía.

### El sello de tiempo va en la zona de la EMPRESA

Era una constante del módulo, y ahí estaba el problema: **el módulo se carga una vez y audita
conversaciones de varias empresas**, así que la zona de la primera quedaba congelada para todas.

**El modelo lee esos sellos para comparar horas entre líneas**, así que una empresa en otro huso
recibía la conversación con los horarios corridos y el veredicto se calculaba sobre eso.

**Y el ancho es fijo, con relleno de ceros.** No es paranoia: un ancho variable es exactamente lo que
confunde a un modelo que tiene que comparar horas.

### Solo la cola de la conversación

Se mandan **los últimos 40 mensajes**, y si se recortó, **el transcript lo dice en su primera línea**.
Lo viejo no explica el fallo de hoy, y el transcript es lo que domina el costo.

---

## 4 · Los hechos se miden en código, y el modelo tiene prohibido recalcularlos

> **"Dejó de responder" es una afirmación temporal, y los modelos calculan mal el tiempo.**

Se miden acá y viajan como datos, con la instrucción de no contradecirlos:

| Hecho medido                                                            |
| ----------------------------------------------------------------------- |
| Cuántos mensajes hay, **por autor**                                     |
| De quién es el último, y **hace cuánto**                                |
| Hace cuánto fue **el último del agente** (o "nunca escribió")           |
| **¿Alguien respondió después del último mensaje del contacto?** Sí / No |
| Cuántos mensajes **sin texto** (audio o imagen)                         |
| **El umbral de silencio** que define "dejó de responder" — 60 minutos   |

**La cuarta es la condición (b) del criterio de abandono**, y es un hecho estructural del arreglo, no
una interpretación.

### En voz, los hechos son otros

| Hecho medido                                                                                       |
| -------------------------------------------------------------------------------------------------- |
| **Duración** de la llamada, en segundos                                                            |
| Turnos transcritos, **cuántos de cada lado**                                                       |
| **Cómo terminó**, según la telefonía                                                               |
| El motivo de cierre que reporta la plataforma                                                      |
| El **sentimiento estimado por la plataforma** — declarado como dato de terceros: _"el tuyo manda"_ |

> **En voz no hay sello de tiempo por línea, y eso está dicho:** la plataforma no manda horarios por
> turno, e **inventarlos sería darle al modelo un dato falso**. La duración total viaja en los hechos,
> que es lo que sí se sabe.

---

## 5 · Los criterios: disparo y descartes

**Cada criterio tiene una condición de disparo y una lista de descartes.**

> **Los descartes son la parte que importa: son los que evitan que el modelo confirme un criterio por
> parecido semántico.**

Y sobre todos ellos, una regla: **cada hallazgo exige una cita textual. Si no se puede copiar la línea
exacta que lo prueba, el hallazgo no existe y no se reporta.**

### Los siete de post-agenda — confirmar y acompañar

| Criterio                               | Se dispara cuando…                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Frustración no manejada**            | El contacto expresa fastidio y la respuesta siguiente del agente lo ignora, lo repite o sigue el guion            |
| **Abandonó la conversación**           | **Los tres a la vez**: el último mensaje es del contacto, nadie respondió después, y el silencio supera el umbral |
| **Promesa incorrecta**                 | El agente afirma algo falso, se contradice, o promete precio/fecha/descuento que no le corresponde                |
| **No es lo que busca**                 | El contacto dice que no le sirve y el agente sigue empujando el mismo camino                                      |
| **Insiste y no lo entiende**           | El contacto pide **lo mismo tres veces o más** sin obtenerlo                                                      |
| **Fuera de alcance sin salida**        | El agente no puede resolverlo y **ni deriva ni dice qué va a pasar**                                              |
| **Le faltó un dato que debería tener** | Pregunta razonable que debería estar en su base de conocimiento                                                   |

**Descartes que vale la pena copiar tal cual:**

- Frustración: **el contacto está molesto con un tercero** (el precio, la empresa) y no con la atención.
- Abandono: **alguien respondió después, aunque sea una plantilla** — eso es un traspaso o un
  seguimiento, no un abandono. Y el último mensaje del contacto puede ser **un cierre que no pide
  respuesta** ("dale, gracias").
- Promesa: **el agente aclaró o corrigió en el mismo tramo**, o fue una respuesta prudente ("un asesor
  lo va a confirmar").
- Insistencia: **el agente pidió un dato que necesitaba** para poder resolverlo.

> Y el criterio de abandono lleva una advertencia explícita: **nunca se usa para decir que "el agente
> no estuvo presente"**. Esa ausencia ya se filtró en la precondición. Este criterio es sobre un
> agente que **sí** estaba atendiendo y dejó colgada una pregunta concreta.

### Los siete de pre-agenda — calificar y conseguir la cita

| Criterio                                  | Se dispara cuando…                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| **Calificación saltada**                  | Empujó a agendar **sin preguntar nada que permita calificar**                |
| **Presionó a quien no califica**          | El contacto dijo que no puede, y el agente **siguió empujando la cita**      |
| **No ofreció la salida que correspondía** | No califica pero mostró interés, y el agente **cerró sin ofrecer nada**      |
| **Información falsa sobre el servicio**   | Afirmó algo que **contradice el prompt** o que el prompt no respalda         |
| **Abandonó a un lead calificado**         | Mostró que califica y la conversación se cortó **sin próximo paso**          |
| **No entendió la objeción**               | Respondió algo que no toca la objeción, o la repitió con otras palabras      |
| **Le faltó un dato que debería tener**    | Preguntó algo **que el prompt sí contesta** y el agente derivó sin necesidad |

**Tres no tienen equivalente en post-agenda** —los de calificación—, y **uno se comparte tal cual**,
porque significa lo mismo en las dos etapas.

**Los dos daños caros de esta etapa están escritos adentro del criterio:**

> **Agendar a ciegas le llena la agenda al vendedor de gente que no puede comprar.**
>
> **Una promesa inventada acá llega a la llamada de venta como una expectativa que el vendedor tiene
> que romper.**

Y un descarte que es una decisión de producto: en "le faltó un dato", **si el dato no está en el
prompt, eso es un hueco del prompt y no una falla del agente**.

---

## 6 · Severidad, categoría y patrón

### Severidad de cada hallazgo

| Severidad    | Qué es                                                   |
| ------------ | -------------------------------------------------------- |
| **rojo**     | Le cuesta clientes o le da información falsa a la gente  |
| **amarillo** | Le baja la conversión o la calidad, **sin daño directo** |

> **Un hallazgo puede ser rojo sin que la conversación requiera intervención** — el daño ya ocurrió y
> el contacto se fue tranquilo. Y puede haber intervención con hallazgos solo amarillos.

### Categoría

`comportamiento` (tono, largo, insistencia, manejo) · `base_conocimiento` (le falta un dato o tiene
uno equivocado) · `informacion_adicional` (debería estar diciendo algo que hoy no dice).

### El código de patrón, que es lo que hace útil la pantalla

> **Agrupa casos iguales bajo un mismo nombre, así el técnico ve "×15 casos" en vez de quince
> problemas sueltos.**

Y por eso **la lista de patrones ya detectados viaja en el contexto**, con una orden en mayúsculas:
_si tu hallazgo es el mismo patrón, **reusá ese código exacto**, aunque vos lo hubieras nombrado
distinto._

| Regla del código                                                         |
| ------------------------------------------------------------------------ |
| Minúsculas, guiones bajos, 3 a 48 caracteres, sin acentos ni espacios    |
| Describe **la falla**, no la conversación                                |
| `promete_financiamiento_inexistente` ✅ · `caso_juan_perez` ❌           |
| El título es ese mismo patrón en lenguaje humano, **6 palabras o menos** |

**Máximo tres hallazgos por análisis**, los más importantes.

---

## 7 · El esquema de salida es el contrato

El modelo **no puede devolver otra forma**. Y hay cuatro restricciones prácticas que conviene heredar:

| Restricción                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------- |
| **No hay tope de items en el esquema** — el máximo de hallazgos se recorta en código                                                      |
| **Prohibir propiedades extra es obligatorio en CADA objeto**, incluidos los anidados                                                      |
| **Nada de largos mínimos ni patrones de texto** en el esquema: el formato del código de patrón lo valida la base y lo normaliza el código |
| El fragmento del prompt va **obligatorio y anulable**, no opcional                                                                        |

> **Una clave opcional en un esquema estricto es más frágil que una obligatoria que puede ser nula.**

### Y lo que llega se limpia una por una, no todo o nada

| Qué                                                       | Qué se hace                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| Un **código de patrón** que no sobrevive la normalización | **Se descarta el hallazgo, no el análisis**                  |
| Una **etiqueta de observación** que no se reconoce        | Se descarta esa observación                                  |
| Un **sentimiento** o un **criterio** desconocido          | Cae al valor neutro                                          |
| **Con "no auditable"**: hallazgos y observaciones         | Quedan vacíos **por construcción**, sin confiar en el modelo |

**Un código inválido violaría la restricción de la base y tumbaría la escritura entera.** Tirar el
hallazgo es mejor que tirar el análisis.

---

## 8 · Los parámetros de la llamada, y la trampa del techo

| Parámetro                | Valor            |
| ------------------------ | ---------------- |
| Esfuerzo de razonamiento | **Alto**         |
| Techo de tokens          | **16.000**       |
| Formato de salida        | Esquema estricto |

> **El techo cubre pensamiento + texto, y ya se rompió dos veces por no tenerlo presente.**
>
> Con esfuerzo alto, el pensamiento se lleva la mayor parte. Cuando el techo quedó corto, la salida
> vino truncada, el análisis **se perdió entero con la inferencia ya pagada** — y el error se
> reportaba como "sin veredicto", sin decir por qué.

**Por eso se chequea explícitamente el motivo de corte** en vez de dejar que reviente el lector de la
respuesta, y hay tres finales declarados:

| Final                       | Qué se devuelve                                          |
| --------------------------- | -------------------------------------------------------- |
| El modelo **declinó**       | No es un fallo del agente auditado: **no se marca nada** |
| Salida **truncada**         | Se dice, con el nombre del problema                      |
| La salida **no era válida** | Se dice                                                  |

**Y la regla operativa:** cuando se agregan campos de texto libre al veredicto, **el techo sube en el
mismo cambio**. Dejarlo igual es volver a pagar el mismo error a sabiendas.

---

## Lista de verificación

1. **Cuatro bloques de contexto**, y los tres primeros son el prefijo estable.
2. Solo cambian **los criterios** y **el medio**; el resto del molde es idéntico.
3. El transcript **etiqueta, no filtra** — con cinco motivos concretos.
4. El sello de tiempo va **en la zona de la empresa**, con ancho fijo.
5. Se manda **solo la cola**, y se dice cuando se recortó.
6. **Lo temporal se mide en código** y el modelo tiene prohibido recalcularlo.
7. **En voz no se inventan horarios por línea.**
8. Cada criterio tiene **disparo y descartes**; los descartes son lo que importa.
9. **Cita textual obligatoria**: sin ella el hallazgo no existe.
10. **Severidad ≠ intervención**: un rojo puede no pedir intervención.
11. El **código de patrón** se reusa, y la lista de conocidos viaja en el contexto.
12. **Máximo tres hallazgos** por análisis, recortados en código.
13. Lo inválido **se descarta por partes**, nunca el análisis entero.
14. El **techo cubre pensamiento + texto**, y se chequea el motivo de corte.
