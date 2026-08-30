# 03 · Avanzar del Setter — las cinco salidas

El mismo mecanismo que el del Closer —un solo lugar donde se registra un resultado— con **cinco** salidas
en vez de seis, y con tres diferencias de fondo que no son un parámetro.

| Salida          | Columna         | Qué pide                                               | Avisa al CRM  |
| --------------- | --------------- | ------------------------------------------------------ | ------------- |
| **Agendó**      | Agendado        | Selector de horarios                                   | **No** — § 2  |
| **Venta chica** | Oferta chica    | Producto del catálogo + monto editable + forma de pago | **No** — § 3  |
| **Seguimiento** | En calificación | Situación → después el modo                            | Sí            |
| **No califica** | Descalificado   | Razón                                                  | Sí (etiqueta) |
| **Nurture**     | Nurture         | Pidió tiempo / Se enfrió                               | Sí            |

**Las cinco escriben en la base propia.** Lo que cambia entre ellas es qué llega al CRM.

---

## 1 · La diferencia de fondo con el Closer

> **El Closer apaga el agente de IA en toda salida menos No-show**, porque cualquier resultado suyo
> demuestra que el contacto ya tuvo su llamada de venta.
>
> **El Setter es pre-agenda por definición: ninguna de sus cinco salidas prueba que hubo una llamada.**

Aplicar ese apagado desde acá **mataría el agente de un lead que todavía se está calificando** — y peor
en la salida Seguimiento, que es justamente la que lo deja en manos del agente durante días.

**Por eso las dos lógicas están separadas y no parametrizadas.** No difieren en un valor: difieren en el
negocio. Meterlas en la misma función con una condición por rol deja dos reglas trenzadas donde ninguna
se lee.

Lo que **sí** se comparte de verdad —el puerto hacia el CRM, el tipo del efecto, el portón de
congelado— se usa tal cual.

---

## 2 · "Agendó" no aplica ninguna etiqueta, y es deliberado

Es la salida que más se copia mal, porque la intuición dice que agendar debería mover al contacto.

**El traspaso de territorio lo hace un automatismo del CRM cuando la cita se crea de verdad.** Y esta
aplicación **no crea citas**: el contacto agenda por su propio enlace, y la pantalla de agenda solo lee.

> **Aplicar la etiqueta del closer desde acá sería peor que no hacerlo:** movería el contacto al
> territorio del closer **sin que exista ninguna cita**, y el closer se encontraría con un lead en su
> cola sin nada agendado.

La cita real llega por su webhook y por el cron de respaldo.

**Lo que sí hace esta salida:** registra el avance con la atribución del setter, y corta sus series —
como todas, ver § 5.

---

## 3 · Tres de las cinco NO escriben campo en el CRM, y hay que entender por qué

Ésta es la parte que parece un defecto y es la decisión correcta.

> **Los vocabularios del setter no están en las listas desplegables del CRM. Y escribir un valor que no
> está en la lista es el peor caso posible: el CRM responde ÉXITO y descarta el valor.**

O sea que escribirlo igual sería **reportar un éxito que no ocurrió** — exactamente lo que prohíbe la
regla que atraviesa todo el producto.

### Los dos choques concretos, verificados campo por campo

| Lo que el setter ofrece                                                      | Lo que el campo del CRM acepta                               |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Forma de pago chica**: Transferencia · Tarjeta · Efectivo · Otro           | Contado · Splitwise · Pago diferido · Cuotas                 |
| **No califica**: Sin capital · Sin urgencia · No es el perfil · Datos falsos | Precio · No es el momento · Competencia · No califica · Otro |

**Ninguno de los dos conjuntos es subconjunto del otro, así que no hay traducción honesta.** Inventar un
mapeo aproximado sería peor: el dato llegaría al CRM diciendo otra cosa.

### El dato no se pierde

Viaja en el detalle del avance guardado en la base propia, y **se muestra en la píldora**. Lo que no se
hace es fingir que llegó al CRM.

### Cómo se destraba

De una de dos formas, y **las dos son del lado del CRM**: agregar esas opciones a las listas existentes,
o crear campos propios del setter. Hasta entonces, el campo queda sin escribir — declarado, no olvidado.

---

## 4 · La venta chica tampoco avisa al CRM

**No existe ninguna etiqueta que signifique "vendió el producto chico".**

El único candidato es la etiqueta de **derivación**, y significa otra cosa: _derivado_ a producto chico es
un **ruteo**, no un cobro. Usarla marcaría como venta **a todo el que recibió la oferta**.

**Se registra igual en la base**, con su monto y su detalle, y dispara la celebración como una venta del
closer. Lo único que no sale es el aviso al CRM.

### Y NO se toca el valor de la oportunidad en el CRM, aunque lleve monto

El Closer lo fija solo en la venta, y no en el adelanto, porque una seña **pisaría el valor real del
trato**. Una venta chica es peor: es **otra venta, mucho menor, sobre el mismo contacto**, y escribirla
ahí **destruiría el valor de la venta grande** que el closer todavía puede cerrar.

El monto vive en el detalle del avance, que es de donde lo lee el tablero de comisiones.

---

## 5 · Las dos series de seguimiento, que son propias

| Serie                   | Cadencia          |
| ----------------------- | ----------------- |
| **Para agendar**        | 3 toques · 5 días |
| **Para decisión chica** | 2 toques · 3 días |

Son distintas de la serie del Closer (3 toques · 7 días) porque persiguen otra cosa: acá se persigue una
**cita**, allá un **cierre**.

Y como en el Closer: **el modo manual no dispara ninguna serie**, y ése es su punto — le dice al CRM que
no persiga a este contacto porque lo retoma una persona.

### Y la regla que las gobierna: TODA salida cancela las series

> Si el lead agendó, se descalificó o compró, **que le siga llegando "para agendar" durante cinco días es
> peor que no haber hecho nada** — y esas series las manda un automatismo que no sabe nada de este
> registro de resultados.

**En la salida Seguimiento se quitan las OTRAS**, no la propia: es la que se acaba de elegir.

**Lo mismo con las etiquetas de resultado**, que son excluyentes entre sí: al registrar una se quitan las
demás. Y esa lista **se arma del catálogo, no a mano**: el día que la venta chica gane su etiqueta, entra
sola. Una lista paralela escrita a mano se olvidaría.

---

## 6 · El portón de congelado, y por qué vuelve a preguntar

Antes de mandar nada al CRM: **si el contacto está congelado, no sale nada** — el resultado **se registra
igual** en la base, con el motivo escrito.

Y hay un detalle que hace la diferencia entre correcto y molesto:

> **No se cree la caché.** Si dice congelado, **se vuelve a preguntar al CRM** y recién ahí se decide.

Una caché atrasada haría que un contacto perfectamente vivo dejara de recibir sus etiquetas, y el usuario
vería "no se mandó nada" sin ninguna razón real. **Verificado recién, no solo caché.**

**El territorio que se mira es el propio**: un contacto del setter congelado es el que perdió
`zona_setter`.

---

## 7 · Lo que se comparte con el Avanzar del Closer

Estas reglas valen igual y están desarrolladas en el `06` de la carpeta del Closer:

| Regla                                                                      |
| -------------------------------------------------------------------------- |
| **Un solo lugar** registra resultados                                      |
| Todas exigen su selección; **la nota siempre es opcional**                 |
| La interfaz manda **la intención**, no una fecha calculada en el navegador |
| **Base propia primero, CRM después**                                       |
| La respuesta cuenta **efecto por efecto**, sin colapsar en un "listo"      |
| **Cualquier salida marca "Completadas hoy"**                               |

---

## 8 · Y una que es propia: el sello de atribución

**Toda salida de Avanzar enciende el sello de atribución del setter**, si no estaba encendido.

Es lo que después permite calcular su comisión diferida. Está desarrollado en el `05`, y tiene una
condición que hay que respetar: **se escribe solo si está vacío**, para que el segundo setter que toque
el contacto no le robe la atribución al primero.

---

## Lista de verificación

1. **Cinco salidas**, todas escriben en la base propia.
2. **Ninguna apaga el agente**: el setter es pre-agenda por definición.
3. Las dos lógicas están **separadas**, no parametrizadas por rol.
4. **"Agendó" no aplica etiqueta de territorio**: el traspaso lo hace el CRM con la cita real.
5. **Toda salida corta las series**; en Seguimiento, las otras. La lista sale del catálogo.
6. **Tres salidas no escriben campo**, porque el CRM aceptaría y descartaría el valor.
7. El dato **no se pierde**: vive en el detalle y se muestra en la píldora.
8. **La venta chica no tiene etiqueta** y no se inventa una.
9. **No se toca el valor de la oportunidad**: destruiría el de la venta grande.
10. **Dos series propias**, distintas de la del Closer.
11. El portón de congelado **vuelve a preguntar al CRM** antes de decidir.
12. Toda salida **enciende el sello de atribución**, y solo si estaba vacío.
