# LISTA-TAGS — Tags y custom fields del CRM

> **Este documento NO es portable como los numerados.** Los documentos `00` a `10` y `PRUEBAS` describen
> un andamiaje genérico. Este es el **inventario concreto de literales** que el producto intercambia con
> su CRM: 28 tags y 22 custom fields, con quién escribe cada uno y quién lo lee.
>
> Se transfiere porque sin él hay que redescubrir el contrato entero mirando código. Si el destino usa
> otro CRM, los **nombres** cambian pero **las columnas de quién escribe y quién lee no**: eso es el
> diseño, y es lo que hay que replicar.

**La fuente de verdad es el archivo de contrato del código, no este documento.** Si los dos se
contradicen, gana el archivo — y este documento se actualiza. Cada literal de acá salió de ahí.

---

## Cómo leer las dos columnas

| Columna        | Qué significa                                                                                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Lo escribe** | Quién lo **aplica**. Si dice CRM, lo pone un workflow de la subcuenta; si dice App, lo pone la aplicación cuando alguien registra algo                                       |
| **Lo lee**     | Quién **deriva** algo de él. Si dice CRM, hace falta un workflow que **dispare** con ese tag; si dice App, la aplicación saca de ahí una etapa, una cola o el estado del bot |

> **La regla que rompe todo si se ignora: un tag lo escribe UN SOLO lado.** Si el CRM y la aplicación
> aplican el mismo tag, se pisan y el estado queda indefinido — y no falla nada, simplemente el contacto
> aparece en la cola equivocada. Las dos excepciones de esta lista están marcadas y son deliberadas.

**Los nombres van exactos**: minúsculas, guion bajo, sin acentos ni espacios. **Un tag mal escrito no da
error: no hace nada.** Es el defecto más caro de esta lista porque es invisible.

**Confianza:** `confirmado` = existe y está verificado en la subcuenta. `pendiente` = todavía no existe;
la aplicación lo usa internamente pero **no lo manda** hasta que exista.

---

# PARTE A · LOS 28 TAGS

## A.1 · Territorio — 2

Deciden a qué módulo pertenece el contacto. Es la separación más importante de todas.

| Tag           | Lo escribe | Lo lee | Para qué                                                                        |
| ------------- | ---------- | ------ | ------------------------------------------------------------------------------- |
| `zona_setter` | CRM        | App    | Territorio pre-agenda. El lead entró y todavía no agendó                        |
| `zona_closer` | CRM        | App    | Portón de entrada al módulo Closer. Se aplica al agendar y **persiste siempre** |

**El traspaso es un reemplazo, no un agregado**: al agendar, `zona_setter` sale y entra `zona_closer`.
Es el mismo contacto cambiando de dueño, **sin resetear ningún dato**.

## A.2 · Estado del agente de IA — 10

La familia más grande y la que más cuidado necesita: de estos tags sale el ícono 🤖 y la decisión de si
un contacto genera tarea humana.

| Tag                        | Lo escribe | Lo lee    | Para qué                                                                     |
| -------------------------- | ---------- | --------- | ---------------------------------------------------------------------------- |
| `bot_activado_appflow`     | CRM        | App       | El agente de chat **post-agenda** está atendiendo                            |
| `bot_activado_leadflow`    | CRM        | App       | El agente de chat **pre-agenda** está atendiendo                             |
| `bot_activado`             | CRM        | App       | **LEGADO.** El chatbot atiende, sin decir cuál agente. Solo lectura          |
| `bot_reactivar`            | CRM        | CRM · App | Orden de volver a encender el bot. **No decide estado**: es una orden        |
| `bot_apagado_manual`       | CRM        | App       | Un humano apagó el bot a mano                                                |
| `bot_desactivado_postcall` | App        | CRM · App | Ya tuvo la llamada de cierre. Lo aplican **5 de las 6 salidas** de Avanzar   |
| `bot_desactivado_appflow`  | App        | CRM · App | El auditor encontró un fallo grave del agente post-agenda                    |
| `bot_desactivado_leadflow` | App        | CRM · App | El auditor encontró un fallo grave del agente pre-agenda                     |
| `bot_pausado_fallo`        | —          | App       | **LEGADO.** Era el tag único de los dos anteriores. Ya no se aplica          |
| `derivado_lt`              | CRM · App  | App       | El bot derivó a producto chico, **o** alguien movió la tarjeta a esa columna |

**Por qué el activado son dos tags y no uno.** El auditor tiene que saber **cuál** agente está
atendiendo: juzgar al agente post-agenda por una conversación que atendió el pre-agenda le imputaría el
fallo al equivocado.

**Por qué el desactivado son dos y no uno.** Cada uno pausa a su bot. Con un tag único, un fallo del
agente pre-agenda apagaría también al post-agenda, que puede estar trabajando bien.

> **Trampa al configurar el CRM:** no armes el workflow con un filtro "contiene `bot_desactivado`".
> `bot_desactivado_postcall` ya existe y significa lo contrario — "esta persona ya pasó por la llamada",
> no "el bot falló". El filtro tiene que ser por el nombre completo.

**`bot_pausado_fallo` es legado y se lee igual.** La aplicación ya no lo aplica, pero lo sigue leyendo —y
quitando al resolver— porque quedaron contactos con él puesto. **No hace falta crearlo** en un CRM nuevo.

**`derivado_lt` es una de las dos excepciones a "un solo lado escribe"**, y es deliberada: el bot lo
aplica cuando deriva, y la aplicación lo aplica cuando alguien mueve la tarjeta a esa columna. Las dos
acciones significan lo mismo, así que no hay estado indefinido.

## A.3 · Resultados de Avanzar — 6

Los aplica la aplicación cuando alguien registra un resultado. **El CRM no debe aplicarlos nunca.**

| Tag               | Lo escribe | Lo lee    | Se aplica cuando                                                   |
| ----------------- | ---------- | --------- | ------------------------------------------------------------------ |
| `venta_ganada`    | App        | CRM · App | Se registra una **Venta** → etapa Ganado + valor de la oportunidad |
| `adelanto_ganado` | App        | CRM · App | Se registra **Acordó comprar, falta pago**                         |
| `seguimiento`     | App        | CRM · App | Se registra un **Seguimiento**, del closer o del setter            |
| `descalificado`   | App        | CRM · App | **No le interesa** (closer) o **No califica** (setter)             |
| `noshow`          | App        | CRM · App | **No-show**. Dispara recuperación y **NO apaga el bot**            |
| `nurture_appflow` | App        | CRM · App | **Nurture**, del closer o del setter                               |

**El No-show es la única salida que deja el bot vivo**, porque dispara un flujo de recuperación que
necesita al agente trabajando. Las otras cinco lo apagan con `bot_desactivado_postcall`.

## A.4 · Seguimientos — 5

Cuál serie de recontacto se dispara. Cada una tiene su cadencia del lado del CRM.

| Tag                        | Lo escribe | Lo lee | Qué serie dispara                          |
| -------------------------- | ---------- | ------ | ------------------------------------------ |
| `seguimiento_recupero`     | App        | CRM    | Serie del closer: **3 toques · 7 días**    |
| `seguimiento_manual`       | App        | CRM    | **Ninguna.** Marca que lo retoma un humano |
| `seguimiento_para_agendar` | App        | CRM    | Serie del setter: **3 toques · 5 días**    |
| `seguimiento_decision_lt`  | App        | CRM    | Serie del setter: **2 toques · 3 días**    |
| `seguimiento_terminado`    | CRM        | —      | **Sin confirmar.** Ver abajo               |

**`seguimiento_recupero` es lo que enciende el ícono ⏱.** Su presencia significa "hay un seguimiento
automático corriendo", y por eso ese ícono es de solo lectura en la interfaz: se enciende únicamente al
registrar el resultado.

**`seguimiento_manual` no dispara nada, y ese es su punto:** le dice al CRM que **no** persiga a este
contacto porque lo retoma una persona. La fecha del recordatorio vive en la aplicación, no acá.

**`seguimiento_terminado` existe en la subcuenta pero nadie confirmó su semántica.** Por el nombre parece
la marca de "serie agotada", que es justo el disparador que falta para avisar "seguimiento agotado —
revisar". **Solo lectura hasta confirmarlo.**

## A.5 · Etapas del pipeline del setter — 3, las tres pendientes

| Tag                      | Lo escribe | Lo lee | Etapa                                         |
| ------------------------ | ---------- | ------ | --------------------------------------------- |
| `setter_nuevo`           | App        | App    | Entró y nadie lo tocó                         |
| `setter_en_calificacion` | App        | App    | Hay conversación, todavía no hay veredicto    |
| `setter_calificado`      | App        | App    | Califica pero no agendó — la columna caliente |

**Son tres y no siete, y el motivo importa.** El pipeline del setter tiene siete etapas, pero cuatro ya
tienen tag y crear duplicados sería un error:

| Etapa                   | Con qué se resuelve                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------- |
| Producto chico ofrecido | `derivado_lt` — ofrecerle el producto chico **es** derivarlo                                          |
| Agendado                | El traspaso `zona_setter` → `zona_closer`. Un tag propio sería una segunda fuente para el mismo hecho |
| Nurture                 | `nurture_appflow`                                                                                     |
| Descalificado           | `descalificado`                                                                                       |

**Las tres están marcadas como pendientes y la aplicación no las manda.** Pero las usa igual para su
propio pipeline, porque la fuente de verdad de la etapa es la base de datos, no el CRM. Las siete
columnas funcionan desde el día uno, y **la escritura al CRM se enciende sola** cuando los tags existan.

## A.6 · Solo lectura — 2

Los aplica el CRM; la aplicación solo los mira.

| Tag             | Lo escribe | Lo lee    | Para qué                                                       |
| --------------- | ---------- | --------- | -------------------------------------------------------------- |
| `cita_agendada` | CRM        | CRM · App | Detector post-call. **Nunca lo escribimos ni lo quitamos**     |
| `estancado`     | CRM        | App       | Lo pone el barrido de inactividad. Pinta la cola de estancadas |

---

# PARTE B · LOS 22 CUSTOM FIELDS

## B.1 · Los que escribe la aplicación — 5

Son las **subcategorías** de cada resultado: el tag dice _qué pasó_, el campo dice _por qué_.

| Campo                                 | Lo llena                 | Valores                             |
| ------------------------------------- | ------------------------ | ----------------------------------- |
| `contact.forma_de_pago_venta`         | Avanzar → Venta          | Contado · Splitwise · BNPL · Cuotas |
| `contact.nivel_de_inters_seguimiento` | Avanzar → Seguimiento    | La situación elegida                |
| `contact.motivo_de_descalificacin`    | Avanzar → No le interesa | La razón elegida                    |
| `contact.razn_de_noshow`              | Avanzar → No-show        | La razón elegida                    |
| `contact.origen_nurture`              | Avanzar → Nurture        | No-show · Pidió tiempo · Se enfrió  |

> **Los nombres con letras faltantes no son erratas.** `motivo_de_descalificacin`, `razn_de_noshow`,
> `nivel_de_inters_seguimiento`: el CRM genera la clave quitando los acentos **y la letra acentuada con
> ellos**. Hay que copiarlos **exactamente así**. Escribirlos "bien" es escribir un campo que no existe.

> **Y la trampa que hace perder una tarde:** escribir en un desplegable un valor que **no está en su
> lista** devuelve éxito y descarta el dato. No falla, no avisa. Por eso tres de las cinco salidas del
> setter no escriben campo: sus vocabularios no están en los desplegables del CRM, y el dato vive en la
> base de datos propia.

## B.2 · Los que lee — Calificación — 11

Lo que el lead respondió en un formulario. **Todos de solo lectura.** Alimentan el grupo "Calificación"
de la ficha y el score.

**Del formulario de la landing — 8:**

| Campo                                                                                                  | Etiqueta en la ficha     |
| ------------------------------------------------------------------------------------------------------ | ------------------------ |
| `contact._en_qu_etapa_est_tu_negocio_hoy`                                                              | Etapa del negocio        |
| `contact._cul_es_tu_objetivo_de_facturacin`                                                            | Objetivo de facturación  |
| `contact._qu_tipo_de_servicios_ofreces_o_planeas_ofrecer`                                              | Tipo de servicios        |
| `contact._cul_es_el_mayor_obstculo_que_te_est_impidiendo_llegar_a_ese_objetivo`                        | Mayor obstáculo          |
| `contact._si_somos_una_buena_opcin_para_ti_y_tenemos_cupo_disponible_estaras_listo_para_empezar_ahora` | Listo para empezar ahora |
| `contact._podras_asumir_una_inversin_de_4000_a_8000_usd`                                               | Inversión $4-8k          |
| `contact._al_agendar_confirmas_tu_compromiso_de_asistencia`                                            | Compromiso de asistencia |
| `contact.tiene_equipo_`                                                                                | Tiene equipo             |

**Del formulario de anuncios — 3:**

| Campo                                                                             | Etiqueta en la ficha    |
| --------------------------------------------------------------------------------- | ----------------------- |
| `contact.en_que_etapa_esta_tu_negocio_hoy`                                        | Etapa del negocio       |
| `contact.cual_es_tu_objetivo_de_facturacion`                                      | Objetivo de facturación |
| `contact.cual_es_el_mayor_obstaculo_que_te_esta_impidiendo_llegar_a_ese_objetivo` | Mayor obstáculo         |

> **Tres preguntas están duplicadas entre los dos formularios, con claves distintas**, porque el lead
> pudo entrar por cualquiera de los dos. La ficha las agrupa **por significado**, no por formulario de
> origen: "Etapa del negocio" es una sola fila, venga de donde venga. Si se agruparan por formulario, el
> mismo dato aparecería dos veces con dos nombres.

## B.3 · Los que lee — Interacciones — 7

Lo que el contacto **hizo**, no lo que dijo. Alimentan el grupo "Interacciones" y varios de los íconos.

| Campo                                  | Etiqueta en la ficha              | De dónde sale                             |
| -------------------------------------- | --------------------------------- | ----------------------------------------- |
| `contact.confirmacin_cita_por_wsp`     | Confirmación de cita por WhatsApp | Clic al botón de confirmación post-agenda |
| `contact._video_precall`               | Video pre-call                    | Si vio el video previo a la llamada       |
| `contact._video_precall_fecha`         | Video pre-call · fecha            | Cuándo lo vio                             |
| `contact._llamadas_ia_intentos`        | Llamadas IA · intentos            | Alimenta el ícono 📞 atenuado             |
| `contact._llamadas_ia_contestadas`     | Llamadas IA · contestadas         | Alimenta el ícono 📞 encendido            |
| `contact.ultima_llamada_ia__resultado` | Última llamada IA · resultado     | El resultado del último intento           |
| `contact.origen_nurture`               | Origen nurture                    | **El mismo que escribe Avanzar** (B.1)    |

**`origen_nurture` es el único que aparece en las dos listas**: lo escribe el registro de resultados y se
lee en la ficha. Por eso son 22 campos distintos y no 23.

**Fijate que `ultima_llamada_ia__resultado` lleva doble guion bajo.** No es un error de tipeo de este
documento: es como quedó la clave en el CRM.

---

# PARTE C · Lo que falta crear

| Qué                                                           | Estado                                                              |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `setter_nuevo`, `setter_en_calificacion`, `setter_calificado` | **Faltan crear.** La aplicación los usa internamente y no los manda |
| `seguimiento_terminado`                                       | Existe, **semántica sin confirmar**. Solo lectura                   |
| Un tag para la **venta de producto chico**                    | **No existe ninguno.** Ver abajo                                    |

**Sobre la venta de producto chico:** el único candidato del contrato es `derivado_lt`, y significa otra
cosa — _derivado_ a producto chico es un **ruteo**, no un cobro. Usarlo marcaría como venta a todo el que
recibió la oferta. Mientras no exista el tag, la venta se registra igual en la base de datos, con su
monto y su detalle; lo único que no sale es el aviso al CRM.

---

# PARTE D · Si el destino usa otro CRM

Cuatro cosas que se transfieren aunque los nombres cambien.

**1 · La separación entre "quién escribe" y "quién lee" es el diseño, no un detalle.** Cada literal tiene
un dueño. Cuando dos lados escriben el mismo, el estado queda indefinido — y no falla nada, simplemente
el contacto aparece donde no debería.

**2 · Todos los literales viven en UN archivo, con su nivel de confianza.** No repartidos por el código.
Ese archivo es lo que permite dos cosas que valen mucho: que un literal que todavía no existe **no se
mande** —y que la aplicación funcione igual con su propia base de datos como fuente de verdad—, y que
haya un solo lugar donde mirar cuando algo no llega.

**3 · La fuente de verdad de la etapa es la base de datos propia, nunca el CRM.** El tag es un aviso al
CRM para que dispare sus automatismos, no el lugar donde vive el estado. Con el estado en el CRM, cada
consulta de una pantalla es una llamada a un servicio externo — y cuando ese servicio no responde, la
aplicación no tiene qué mostrar.

**4 · Escribir un valor fuera de la lista de un desplegable devuelve éxito y lo descarta.** Vale la pena
comprobar cómo se comporta el CRM destino ante eso **antes** de escribir el primer campo, porque el
síntoma es un dato que se ve bien en el código y no está en ninguna parte.
