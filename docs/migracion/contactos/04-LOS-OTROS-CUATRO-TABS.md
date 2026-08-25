# 04 · Los otros cuatro tabs — Llamada, Perfil, Historial, Notas

El Chat está en el documento `03`. Estos cuatro son los que completan la ficha, y cada uno tiene **su
propia llamada, que se pide al abrirlo**.

---

## 1 · Llamada — el archivo cronológico

Todas las llamadas del contacto, la más reciente primero. **Nunca se borra ninguna.**

### Cada llamada lleva su tipo de agente

Es lo primero que hay que poder distinguir, porque **no son la misma cosa y no se miden igual**:

| Tipo                          | Qué es                                     |
| ----------------------------- | ------------------------------------------ |
| **Llamada de cierre**         | La reunión con el closer, una persona      |
| **Agente de voz pre-agenda**  | El robot que llama para agendar            |
| **Agente de voz post-agenda** | El robot que llama después de la cita      |
| **Llamada de IA genérica**    | Cuando no se puede identificar cuál agente |

### Qué se muestra, y solo cuando existe

**La regla que gobierna este tab: si el dato no existe, el bloque no se dibuja.** Un campo vacío afirma
algo falso.

| Bloque                       | Existe solo en…                            |
| ---------------------------- | ------------------------------------------ |
| **Puntaje y coaching**       | Las llamadas **de cierre** con una persona |
| **Resumen y sentimiento**    | Las **contestadas**                        |
| **El audio**                 | Las **contestadas**                        |
| **La transcripción**         | Las que la tengan                          |
| **El veredicto del auditor** | Las que ya se **analizaron**               |

### Dos precisiones que evitan confundir dos cosas parecidas

**El sentimiento y el veredicto del auditor son distintos.** El sentimiento lo da la plataforma de voz y
va al lado del resumen. El veredicto —verde, amarillo, rojo— lo pone **nuestro auditor**, y va en su
propio bloque con su motivo.

> **Sin análisis no se dibuja nada.** Un verde que nadie midió sería un dato falso: afirmaría que la
> llamada estuvo bien cuando lo único cierto es que nadie la revisó.

**Y las llamadas de la persona no suman al ícono 📞.** Ese ícono cuenta llamadas del **agente de voz**
contestadas. Mezclarlas haría que el ícono diga una cosa y el archivo otra.

### La transcripción va desplegable

Colapsada por omisión, con **el conteo de turnos a la vista** —"Transcripción · 14 turnos"— y se abre al
hacer click. Desplegada por omisión, empuja todo lo demás fuera de la pantalla; ausente, no se puede
verificar qué dijo el agente.

---

## 2 · Perfil — agrupado por significado, no por formulario

Los datos que el contacto dio o que un agente registró sobre él.

### Cuatro grupos

| Grupo             | Qué junta                                   |
| ----------------- | ------------------------------------------- |
| **Detalles**      | Lo básico del contacto                      |
| **Origen**        | De dónde vino                               |
| **Calificación**  | Todo lo que mide **si encaja**              |
| **Interacciones** | Todo lo que mide **si se está enganchando** |

### La regla, y por qué no es obvia

> **Se agrupa por lo que el dato SIGNIFICA, no por el formulario del que salió.**

Un campo del anuncio, uno del video de ventas y uno que registró el agente **caen los tres en
Calificación** si los tres miden si el contacto encaja.

Y es necesario porque **la misma pregunta existe en dos formularios con dos claves distintas** — el lead
pudo entrar por cualquiera de los dos. Agrupando por formulario, "Etapa del negocio" aparecería **dos
veces con dos nombres**, y el usuario no sabría cuál mirar.

### Tres detalles del dibujo

**Los grupos sin campos no se dibujan.** Un encabezado con nada abajo es ruido.

**La etiqueta que se ve es corta, no la pregunta entera.** "Objetivo de facturación", no "¿Cuál es tu
objetivo de facturación?". La pregunta completa no cabe y no aporta.

**La procedencia informa, no agrupa.** Una marca chica —"vía llamada de IA"— dice de dónde salió ese dato
sin sacarlo de su grupo por significado.

---

## 3 · Historial — la línea de tiempo inmutable

Todo lo que pasó con el contacto, en orden, **y no se puede editar ni borrar**.

### El autor es real, siempre

| Autor         | Cuándo                 |
| ------------- | ---------------------- |
| Un **nombre** | Lo hizo una persona    |
| **`Sistema`** | Lo hizo un automatismo |

**Y esa distinción es load-bearing en dos lugares:**

1. **Los eventos automáticos nunca pasan por Avanzar.** Se registran solos, con autor `Sistema`.
2. **La pausa del bot al escribir a mano figura como `Sistema`** — quien decide pausar es el sistema, la
   persona solo escribió.

Atribuirle a alguien una decisión que no tomó convierte el historial en algo que no se puede usar para
entender qué pasó.

### Por qué inmutable

Es la única fuente para responder "¿qué pasó con este contacto?". **Un historial que se puede editar no
sirve para eso** — y la tentación de "corregir" una fila aparece justo cuando más importa que no se
toque. Se corrige **con una fila nueva**, como en un libro contable.

---

## 4 · Notas — y el defecto que costó más caro de toda la ficha

Dos orígenes en la misma lista:

| Origen            | Cómo llega                                            |
| ----------------- | ----------------------------------------------------- |
| **Desde Avanzar** | Con su contexto automático de qué resultado la generó |
| **A mano**        | Con el botón de agregar                               |

### Un solo lugar donde viven, y un solo endpoint

> **Las notas del closer y las del setter van a la MISMA tabla, por el MISMO endpoint**, que acepta los
> dos roles. No hay un endpoint de notas por rol y **no debería haberlo**: es el mismo dato sobre el
> mismo contacto.

### El defecto, porque conviene conocerlo antes de repetirlo

Un usuario escribió una nota y **no quedó**. Al investigarlo eran **tres defectos apilados**, y ninguno
daba error:

| Defecto                                                                                  | Síntoma                                                  |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| La nota se escribía en **otra tabla** según por qué camino se registrara                 | Aparecía en un lado y no en el otro                      |
| Un módulo **no le hablaba al endpoint** por ninguna vía: ni escribir, ni leer, ni borrar | Sus notas vivían en memoria y **se perdían al recargar** |
| Al recargar, la lista se reconstruía **con las notas vacías**                            | **Borraba la nota que acababa de crear**                 |

De la medición: **de 13 resultados registrados con nota, solo 2 llegaron a la tabla** — y los dos por el
camino correcto.

### Las tres reglas que salieron de ahí

1. **Un solo destino y un solo camino.** Si hay dos formas de guardar una nota, una de las dos está mal.
2. **Si la escritura falla, la respuesta lo dice** — aunque sea accesoria y no se pueda hacer nada. Una
   nota que no se guardó y una operación que responde éxito es exactamente "un éxito que no ocurrió".
3. **Recargar hace fusión, no reemplazo.** Las listas mandan sobre etapa y píldoras; las notas, el
   historial, las llamadas y el perfil **se piden aparte y no se pisan**.

La tercera es la que hay que tener presente al construir la ficha: **el reemplazo completo es el defecto
más fácil de introducir**, porque el código se ve más limpio.

---

## 5 · Un detalle común a los cuatro

**Cada tab se pide al abrirlo, no al abrir la ficha.** Traer los cinco de una serían cuatro llamadas para
pantallas que nadie va a mirar.

**Y ninguno tiene reloj propio.** El único que se refresca solo es el Chat. Los otros cuatro se piden una
vez y se quedan quietos, porque su dato no cambia mientras alguien mira la ficha — y si cambia, es porque
esa misma persona lo cambió, y el que escribe actualiza su propia lista.

---

## Lista de verificación

1. **Llamada**: cada una con su tipo de agente, y **el bloque no se dibuja si el dato no existe**.
2. Puntaje y coaching **solo** en las de la persona; resumen, audio y sentimiento **solo** en las contestadas.
3. **Sentimiento ≠ veredicto del auditor**, y sin análisis **no se muestra nada**.
4. Las llamadas de la persona **no suman** al ícono del agente de voz.
5. La transcripción va **desplegable**, con el conteo de turnos visible.
6. **Perfil agrupado por significado**, no por formulario de origen.
7. Los grupos vacíos **no se dibujan**; la etiqueta es **corta**.
8. **Historial inmutable**, con autor real o `Sistema`.
9. Los eventos automáticos son `Sistema`, **incluida** la pausa del bot al escribir a mano.
10. **Un solo destino y un solo endpoint** para las notas de los dos roles.
11. Si una escritura falla, **la respuesta lo dice**.
12. Recargar hace **fusión, no reemplazo**.
13. Cada tab **se pide al abrirlo**, y **ninguno tiene reloj** salvo el Chat.
