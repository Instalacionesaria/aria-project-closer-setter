# 02 · Al hacer click en un contacto — qué se abre y qué se muestra

Se hace click en una fila —en Mi Día, en el Pipeline, en la Agenda— y aparece **la ficha**: un panel
lateral con todo lo del contacto.

---

## 1 · Las dos reglas de la apertura

**1 · La ficha se abre donde se la invoque. Nunca navega.**

No es una pantalla: es un panel que se superpone. El usuario **no pierde el contexto** de dónde estaba, y
al cerrarla vuelve a la misma lista en la misma posición.

Si navegara, atender diez contactos de una cola serían veinte navegaciones y diez pérdidas de scroll.

**2 · Es un solo componente para toda la aplicación.**

La misma ficha se abre desde las tres pantallas del closer, desde las del setter y desde la auditoría. No
hay una versión por pantalla — **si hubiera tres, mostrarían tres cosas distintas del mismo contacto**, y
las tres parecerían correctas.

---

## 2 · El encabezado — solo estado, nunca acción

Lo primero que se ve, y **nada de acá es clicable**. Es una foto del contacto, no un panel de control.

| Pieza                       | Qué muestra                          |
| --------------------------- | ------------------------------------ |
| **Nombre y teléfono**       | Con sus marcas (destacado, etc.)     |
| **La píldora de situación** | En qué está el contacto **ahora**    |
| **Los seis íconos**         | Su estado completo, siempre los seis |

### La píldora del encabezado es un espejo obligatorio

> **Mismo texto y mismo color** que la píldora de la fila que abrió la ficha.

No es un detalle estético. Si la fila dice una cosa y el encabezado otra, **el usuario deja de confiar en
las dos** — y no tiene forma de saber cuál es la correcta.

### Cómo se arma la píldora

Formato fijo: **`CATEGORÍA · SUBCATEGORÍA`**, todo en mayúsculas. La categoría sale de la etapa; la
subcategoría, de un campo del CRM que **depende de la etapa actual**.

| Etapa          | Píldora                        |
| -------------- | ------------------------------ |
| Agendado       | `AGENDADO`                     |
| Seguimiento    | `SEGUIMIENTO · MUY INTERESADO` |
| Acordó comprar | `ACORDÓ COMPRAR · $5.000`      |
| Venta          | `VENTA · CONTADO · $100`       |
| No-show        | `NO-SHOW · NO CONTESTÓ`        |
| Nurture        | `NURTURE`                      |
| No le interesa | `NO LE INTERESA · SIN CAPITAL` |

Cuatro reglas que van juntas:

1. **La armamos nosotros, no el CRM.** El automatismo transporta los dos datos crudos —la etapa y el
   campo— y **no concatena nada**. Si concatenara, habría dos formatos para el mismo estado.
2. **Un solo lugar decide el formato.** Cuando se concatenaba a mano en seis puntos distintos de la
   ficha, los datos de ejemplo producían `Seguimiento · Dudando` y el registro real
   `SEGUIMIENTO · DUDANDO` — **para el mismo estado**.
3. **La píldora es la situación REAL.** Una condición temporal —vencido, estancado— es **tinte de fila y
   microtexto, jamás píldora**.
4. **Sin subcategoría no se inventa una.** Queda solo la categoría. Rellenarla con un valor de reserva
   sería afirmar algo que el CRM no dijo.

---

## 3 · Los seis íconos — el estado completo, siempre visible

**Siempre los seis, en el mismo orden.** Los inactivos se atenúan; **nunca se muestra un "0"**.

| Ícono  | Qué dice                                   | De dónde sale                                                 |
| ------ | ------------------------------------------ | ------------------------------------------------------------- |
| 📹 + n | Reuniones que **ya tuvo** con el closer    | Citas pasadas no canceladas **menos** los no-show registrados |
| 📅     | Tiene una cita **futura** vigente          | Las citas con fecha futura no canceladas                      |
| 📞 + n | Llamadas del agente de voz **contestadas** | Los contadores cacheados de los campos del CRM                |
| 🤖     | Estado del agente de IA                    | **Derivado de las etiquetas**, nunca de una columna           |
| ⏱      | Seguimiento automático corriendo           | Una serie automática pendiente                                |
| 💰     | Venta **cobrada**, con el monto            | El monto, **solo** si la etapa es ganado                      |

### La regla que sostiene los seis

> **Los íconos los calcula el servidor y viajan DENTRO de cada contacto, en todos los endpoints que
> listan contactos.** La pantalla no deriva ninguno por su cuenta: los pinta **un único componente** a
> partir de ese objeto.

Dicho como lo pidió quien lo especificó: _"si ese contacto se mueve a otra parte del pipeline esto
siempre lo acompañará, así que cuando se muestre en cualquier parte traerá esa información."_

### El defecto que existía antes, para no repetirlo

Los seis íconos se derivaban de campos que **solo existían en los datos de ejemplo**. Para un contacto
real del CRM, **cinco de los seis estaban permanentemente apagados**. Y el bloque de dibujo vivía
duplicado en **cinco vitrinas con lógica distinta**: el mismo contacto se veía "sin bot" en las listas y
"IA activa" en la ficha.

### Cuatro precisiones que evitan afirmar de más

**`0` y "no sé" no son lo mismo.** En los contadores de llamadas, **nulo** significa "nunca se sincronizó
desde el CRM" y **cero** significa "el CRM dice que no contestó ninguna". La interfaz los pinta igual
—atenuado— pero **la diferencia importa para diagnosticar**.

**El estado del bot nulo no se rellena.** Nulo significa "no tiene bot" o "ninguna etiqueta lo dice", y
las dos se pintan atenuadas. **Nunca se pone "activo" por conveniencia.**

**El botón de videollamada no es el ícono 📹.** Uno es una acción —unirse a la sala—, el otro es un
hecho —cuántas reuniones tuvo—. Son cosas distintas y conviene que sigan siéndolo.

**La cita vencida no enciende ningún ícono.** Existe como dato para que el Pipeline pueda mostrar "cita
vencida" en su columna. Una cita pasada sin registrar **nunca desaparece**.

**Y una venta prometida no es una venta.** El ícono 💰 solo se enciende con la venta **cobrada**. "Acordó
comprar, falta pago" también guarda un monto, pero ese vive **solo en la píldora**.

---

## 4 · Los cinco tabs

| Tab           | Qué muestra                                        |
| ------------- | -------------------------------------------------- |
| **Chat**      | La conversación real, con el compositor abajo      |
| **Llamada**   | Todas las llamadas, cada una con su tipo de agente |
| **Perfil**    | Los datos del contacto, agrupados por significado  |
| **Historial** | Línea de tiempo inmutable, con el autor real       |
| **Notas**     | Las notas, con un botón para agregar               |

**Chat abre primero**, porque es lo que se necesita el 90 % de las veces.

**Cada tab es su propia llamada, y se pide al abrirlo.** No se traen los cinco al abrir la ficha: cuatro
de esas cinco llamadas serían para pantallas que nadie va a mirar.

El detalle de cada uno está en los documentos `03` y `04` de esta carpeta.

---

## 5 · El botón de Avanzar

Ancho completo, **debajo del encabezado**. Es el **único** lugar donde se registra un resultado.

Navegación en dos pasos: primero la grilla de resultados, después la pantalla de detalle con flecha
atrás. **Todas exigen su selección** antes de habilitar el botón; **la nota siempre es opcional**.

Que sea el único lugar es lo que hace que los tableros cierren: si un resultado se pudiera registrar
desde dos lugares, uno de los dos se olvidaría de actualizar algo.

---

## 6 · Un caso que hay que prever: la ficha huérfana

Se puede abrir la ficha de un contacto que **no está en ninguna de las listas cargadas** — pasa al
abrirla desde el Pipeline, o desde una pantalla de auditoría.

> Si el código asume que el contacto ya está en memoria, la ficha abre **vacía** y **lo que se escriba ahí
> se descarta sin pintar nada y sin avisar**.

La solución es sembrar una entrada mínima cuando falta. Y ojo con un detalle que ya causó el defecto: **si
un módulo indexa sus contactos por nombre y el otro por identificador**, la búsqueda falla en silencio
porque se busca con la clave equivocada.

---

## Lista de verificación

1. La ficha **se abre donde se la invoque** y **nunca navega**.
2. **Un solo componente** de ficha para toda la aplicación.
3. El encabezado es **solo estado**, nada clicable.
4. La píldora del encabezado es **espejo exacto** de la de la fila.
5. La píldora la **arma la aplicación**, en **un solo lugar**, y **no inventa** subcategoría.
6. Una condición temporal **nunca** es píldora.
7. **Los seis íconos siempre**, atenuados si no aplican, **nunca un "0"**.
8. Los íconos los **calcula el servidor** y viajan con el contacto a todas las pantallas.
9. **Un solo componente** los dibuja.
10. Nulo y cero **no son lo mismo**, y el estado del bot nulo **no se rellena**.
11. **Cinco tabs**, Chat primero, y **cada uno se pide al abrirlo**.
12. Avanzar es el **único** lugar donde se registra un resultado.
13. La ficha de un contacto que no está en memoria **siembra una entrada**, no abre vacía.
