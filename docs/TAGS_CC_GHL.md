# TAGS_CC_GHL — el contrato de tags entre GoHighLevel y Comando Central

**Para pasarle a GHL y arrancar las pruebas sección por sección.**

Este documento no lleva número a propósito: los 13 numerados describen *cómo funciona el sistema*.
Este es la **lista operativa** — qué tags tienen que existir y quién los aplica — y se lee de
costado, no en secuencia.

> **La fuente de verdad es [`src/lib/ghl/contrato.ts`](../src/lib/ghl/contrato.ts).** Cada literal de
> este documento se sacó de ahí, de `resultados.ts`, `resultadosSetter.ts`, `etapas.ts`,
> `etapasSetter.ts` y de los archivos que los leen. Si algún día este `.md` y esos archivos se
> contradicen, **gana el código**.

---

## Dónde estamos hoy (medido en producción, 2026-08-10)

Los 22 contactos de la caché, contados por tag:

| Tag | Contactos | Qué significa |
|---|---|---|
| `zona_closer` | **19** | El módulo Closer opera con datos reales |
| `zona_setter` | **0** | El módulo Setter está completo y **no tiene un solo contacto**. Es el bloqueo #1 |
| `bot_activado` | **0** | El auditor de IA no analiza a nadie. Es el bloqueo #2 |
| `estancado` | **0** | La cola *Conversaciones estancadas* está vacía en los dos módulos |
| `derivado_lt` | **0** | La cola *Oportunidades low-ticket* del setter está vacía |

Los dos primeros ceros no son un problema del código: son los dos workflows en borrador. Todo lo
demás de este documento existe para el día en que dejen de ser cero.

---

## Las tres reglas que hay que entender antes de crear un tag

**1. Los tags son interruptores, no etiquetas.** Un tag no describe al contacto: *hace que algo
pase*. En GHL dispara un workflow; en Comando Central mueve una etapa, llena una cola o desbloquea
una pantalla. Un tag mal escrito no da error — **no hace nada**, y eso es lo más difícil de
detectar.

**2. El nombre es exacto.** Minúsculas, guion bajo, sin acentos, sin espacios. `Zona_Closer`,
`zona closer` y `zona-closer` son tres tags distintos y ninguno de los tres es `zona_closer`. La
lectura de nuestro lado sí es tolerante (normaliza espacios y mayúsculas), pero **la escritura y los
workflows de GHL no lo son**.

**3. Hay tres direcciones, y confundirlas rompe cosas.** Cada tag de las tablas de abajo dice cuál
es la suya:

| Dirección | Qué significa |
|---|---|
| **GHL → CC** | Lo aplica un workflow de GHL. Comando Central **solo lo lee**. Si lo escribiéramos nosotros, habría dos fuentes para el mismo hecho |
| **CC → GHL** | Lo aplica Comando Central cuando alguien registra algo. GHL puede colgarle workflows, pero **no debe aplicarlo él** o se pisan |
| **Compartido** | Lo escriben los dos, en momentos distintos y sin solaparse. Solo hay un caso, y está marcado |

---

## Estado de cada tag, de un vistazo

| Estado | Qué quiere decir |
|---|---|
| ✅ **Existe** | Confirmado en la subcuenta. Se puede usar hoy |
| 🔨 **Hay que crearlo** | Comando Central ya lo usa internamente, pero **no sale a GHL** hasta que exista ahí. Lo frena `assertEnviable()` a propósito, para que un nombre inventado no llegue nunca a producción |
| ⚠️ **A confirmar** | Existe en la cuenta pero no sabemos quién lo aplica ni cuándo. Solo lo leemos |

---

# 1 · TERRITORIO — el portón de entrada de todo

Sin estos dos tags **no hay nada**: ni Closer, ni Setter, ni auditor. Es lo primero que hay que
publicar.

| Tag | Estado | Dirección | Qué tiene que hacer GHL | Qué desbloquea en Comando Central |
|---|---|---|---|---|
| `zona_closer` | ✅ Existe | GHL → CC | Aplicarlo **al agendar** una cita, como swap: quita `zona_setter` y pone `zona_closer` (workflow `🟨 04.1`) | **Todo el módulo Closer.** Mi Día, Pipeline, la ficha, Estadísticas. Y le dice al auditor que juzgue con la rúbrica post-agenda (Appointment Flow) |
| `zona_setter` | ✅ Existe | GHL → CC | Aplicarlo cuando el lead entra y **todavía no agendó** (workflow `🟨 04.1/04.2`) | **Todo el módulo Setter.** Sus 6 colas, su Pipeline de 7 etapas, su cockpit. Y la rúbrica pre-agenda (Lead Flow) |

**El swap es de una sola vía y `zona_closer` no se quita nunca.** Eso es correcto y deliberado: un
contacto descalificado o en nurture sigue siendo del mundo del closer. Quién trabaja hoy lo deciden
la etapa y las colas, no el territorio.

> ⚠️ **Hoy hay 0 contactos con `zona_setter`.** Es lo único que separa al módulo Setter de estar
> funcionando: el código está completo y verificado, y se llena solo en cuanto el tag empiece a
> aplicarse. Mientras tanto sus pantallas se ven vacías **y lo dicen** — no muestran ceros
> inventados.

---

# 2 · ESTADO DEL AGENTE DE IA — el portón del auditor

| Tag | Estado | Dirección | Qué tiene que hacer GHL | Qué hace en Comando Central |
|---|---|---|---|---|
| `bot_activado` | ✅ Existe | GHL → CC | Aplicarlo **mientras el chatbot está atendiendo** al contacto, y quitarlo cuando deja de atender (workflows `🟦 08.1 Apagar App Flow Agent` / `🟦 08.2 Reactivar`) | **Enciende el auditor de IA.** Sin este tag el auditor no analiza a nadie. Además rutea el Buzón: con bot activo la conversación no es trabajo del humano todavía |
| `bot_reactivar` | ✅ Existe | GHL → CC | Aplicarlo como **orden** de volver a encender el bot | El auditor lo cuenta como "hay un agente que va a contestar", así que la conversación vuelve a ser auditable. Para el Buzón **no** cuenta como encendido: todavía no está atendiendo |
| `bot_apagado_manual` | ✅ Existe | GHL → CC | Aplicarlo cuando un humano apaga el bot desde GHL | El toggle 🤖 de la ficha muestra "apagado manual" y el auditor deja de mirarlo |
| `derivado_lt` | ✅ Existe | **Compartido** | Aplicarlo cuando el bot **deriva la conversación a low-ticket** y se pausa | Tres cosas: el estado del bot pasa a "derivado LT", el contacto entra a la cola **Oportunidades low-ticket** del setter, y es el tag de la etapa *Low-Ticket ofrecido*. **Comando Central también lo escribe**, al arrastrar una tarjeta a esa columna del pipeline — ver el recuadro |
| `bot_desactivado_postcall` | ✅ Existe | **CC → GHL** | **No aplicarlo.** Lo escribe Comando Central | Lo aplican **5 de las 6 salidas de Avanzar del closer** (todas menos No-show): cualquier resultado prueba que ya hubo llamada de venta, así que el chatbot muere. En No-show se **quita**, porque el workflow de recuperación necesita al bot trabajando |
| `bot_pausado_fallo` | ✅ Existe | **CC → GHL** | **No aplicarlo, y no quitarlo.** Si su workflow también lo escribiera, se pisan con el auditor | Lo aplica el **auditor de IA** cuando encuentra un fallo grave (veredicto rojo), y lo quita Comando Central al resolver la intervención. Mientras está puesto, el contacto vive en la cola **Urgentes** — del closer o del setter según su territorio |

> **El orden de precedencia importa** y está en una sola función (`botDesdeTags`): los apagados
> ganan siempre. `bot_pausado_fallo` → `bot_desactivado_postcall` → `derivado_lt` →
> `bot_apagado_manual` → `bot_activado`. Sin ninguno, el bot se considera **apagado** — nunca se
> asume que está atendiendo.
>
> ### El único tag que escriben los dos lados: `derivado_lt`
>
> Lo aplica **el bot de GHL** al derivar la conversación, y lo aplica **Comando Central** cuando
> alguien arrastra una tarjeta a la columna *Low-Ticket ofrecido* del pipeline del setter. No se
> pisan porque significan lo mismo: el lead está en camino de low-ticket, lo haya decidido el bot o
> una persona. Es el único caso en todo el contrato — **conviene que su workflow sea idempotente**
> (que no rompa ni duplique nada si el tag ya estaba puesto).

---

# 3 · RESULTADOS DE AVANZAR · CLOSER — las 6 salidas post-llamada

Estos tags **los escribe Comando Central** cuando un closer registra el resultado de su llamada.
Lo que GHL tiene que hacer es **colgarles el workflow que mueve el stage del pipeline** — nosotros
nunca escribimos el stage.

| Salida en CC | Tag | Estado | Stage de GHL al que tiene que mover | Custom field que también escribimos |
|---|---|---|---|---|
| **Venta** | `venta_ganada` | ✅ Existe | `Ganado` + Opportunity Value con el monto | `contact.forma_de_pago_venta` |
| **Acordó comprar** (falta pago) | `adelanto_ganado` | ✅ Existe | `Adelanto` | — (solo monto) |
| **Seguimiento** | `seguimiento` | ✅ Existe | `Seguimiento` | `contact.nivel_de_inters_seguimiento` |
| **No le interesa** | `descalificado` | ✅ Existe | `Descalificado` | `contact.motivo_de_descalificacin` |
| **No-show** | `noshow` | ✅ Existe | `No-show`, y **dispara la recuperación** (`06.4`) | `contact.razn_de_noshow` |
| **Nurture** | `nurture_appflow` | ✅ Existe | `Nurture` | `contact.origen_nurture` |

**Cinco de los seis son mutuamente excluyentes**: registrar uno quita los otros cuatro
(`venta_ganada`, `adelanto_ganado`, `descalificado`, `noshow`, `nurture_appflow`). `seguimiento` es
la excepción — sirve pre y post llamada, así que convive con todos y **no lo quita nadie**.

---

# 4 · SEGUIMIENTOS — las series automáticas

| Tag | Estado | Dirección | Qué tiene que hacer GHL | Qué hace en Comando Central |
|---|---|---|---|---|
| `seguimiento_recupero` | ✅ Existe | **CC → GHL** | Disparar la **serie del closer: 3 toques en 7 días** | Lo aplica el Avanzar → Seguimiento en modo automático. Su presencia enciende el ⏱ en la ficha |
| `seguimiento_manual` | ✅ Existe | **CC → GHL** | **Nada, y eso es el punto**: marca que lo retoma un humano, para que **ningún workflow lo persiga** | Modo manual del seguimiento. La fecha vive de nuestro lado (es lógica de cola, no de negocio) |
| `seguimiento_para_agendar` | ✅ Existe | **CC → GHL** (desde el setter) | Disparar la **serie del setter: 3 toques en 5 días**, empujando a agendar | La aplica el Avanzar → Seguimiento del setter |
| `seguimiento_decision_lt` | ✅ Existe | **CC → GHL** (desde el setter) | Disparar la **serie del setter: 2 toques en 3 días**, para decidir el low-ticket | Ídem, cuando el seguimiento es por un LT ofrecido |
| `seguimiento_terminado` | ⚠️ A confirmar | GHL → CC | **Decirnos qué significa.** Por el nombre parece "la serie se agotó" | Nada todavía: solo lo leemos. Si confirman que lo aplica el workflow al terminar la serie, lo usamos para la tarea *"Seguimiento agotado — revisar"* |

**Los cuatro primeros son mutuamente excluyentes.** Un contacto está en una serie, o en manual, o en
ninguna — nunca en dos. Aplicar uno quita los otros tres. Y **cualquier salida de Avanzar los
cancela**: si el lead ya agendó o se descalificó, seguir mandándole "para agendar" es peor que no
haber hecho nada.

---

# 5 · ETAPAS DEL PIPELINE DEL SETTER — los 3 que hay que crear

El pipeline del setter tiene **7 etapas**, y solo **3 necesitan un tag nuevo**. Las otras cuatro ya
están cubiertas, y crearles un tag propio sería duplicar el mismo hecho.

| Etapa | Tag | Estado | Qué tiene que hacer GHL |
|---|---|---|---|
| **Nuevo** | `setter_nuevo` | 🔨 **Hay que crearlo** | Solo crearlo. El workflow es opcional — nos sirve para que sus automatizaciones puedan reaccionar |
| **En calificación** | `setter_en_calificacion` | 🔨 **Hay que crearlo** | Ídem |
| **Calificado sin agendar** | `setter_calificado` | 🔨 **Hay que crearlo** | Ídem. Es la etapa 🔥: califica para high-ticket y todavía no agendó |
| **Low-Ticket ofrecido** | `derivado_lt` | ✅ Ya existe | Nada nuevo: el tag que ya usa el bot al derivar significa exactamente esto |
| **Agendado** | *(ninguno)* | — | **Nada, a propósito.** Esta etapa la resuelve el swap `zona_setter` → `zona_closer` del `🟨 04.1` cuando la cita existe de verdad. Un tag propio sería una segunda fuente para el mismo hecho |
| **Nurture** | `nurture_appflow` | ✅ Ya existe | El mismo del closer |
| **Descalificado** | `descalificado` | ✅ Ya existe | El mismo del closer |

> **Las 7 columnas ya funcionan sin estos tres tags.** La fuente de verdad de la etapa es nuestra
> base (`closer_contactos.stage_key`), así que el pipeline se puede usar y mover desde el día uno.
> Lo único que falta es que el tag **salga hacia GHL**, y eso se enciende solo en cuanto los tres
> existan: no hay que tocar código ni desplegar.

---

# 6 · RESULTADOS DE AVANZAR · SETTER — las 5 salidas pre-agenda

| Salida en CC | Tag | Estado | Qué pasa en GHL | Qué queda registrado |
|---|---|---|---|---|
| **Agendó** | *(ninguno)* | — | **Nada, a propósito.** La cita la crea el booking link y el swap lo hace el `🟨 04.1`. Aplicar `zona_closer` desde acá movería el contacto al closer **sin que exista ninguna cita** | El avance, la atribución del setter, y se **cortan sus series** |
| **Venta LT** | *(ninguno)* | 🔨 **Falta el tag** | Hoy nada. **No usamos `derivado_lt`**: derivar a low-ticket y haberlo vendido son cosas distintas, y el workflow que escucha "derivado" se dispararía sobre alguien que ya compró | La venta con su producto, monto y forma de pago, en nuestra base. Se ve en la píldora y en el cockpit de comisiones |
| **Seguimiento** | `seguimiento` + la serie | ✅ Existe | El workflow de la serie elegida | La única de las cinco que **sí escribe un custom field** en GHL: `contact.nivel_de_inters_seguimiento` |
| **No califica** | `descalificado` | ✅ Existe | El workflow de descalificado | El motivo queda en nuestra base — ver el recuadro de abajo |
| **Nurture** | `nurture_appflow` | ✅ Existe | El workflow de nurture | `contact.origen_nurture` (el vocabulario coincide con el del closer) |

> ### Dos dropdowns donde el setter no entra, y qué haría falta
>
> Hay dos custom fields que **no le podemos escribir** al registrar una salida del setter, porque su
> vocabulario no está en el dropdown de GHL. Y eso importa: cuando se le manda un valor que no está
> en la lista, **GHL responde 200 y descarta el valor** — o sea que reportaríamos un éxito que no
> ocurrió.
>
> | Campo | Lo que ofrece el setter | Lo que acepta el dropdown hoy |
> |---|---|---|
> | `contact.forma_de_pago_venta` | Transferencia · Tarjeta · Efectivo · Otro | Contado · Splitwise · Buy Now Pay Later · Cuotas |
> | `contact.motivo_de_descalificacin` | Sin capital · Sin urgencia · No es el perfil · Datos falsos | Precio · No es el momento · Competencia · No califica · Otro |
>
> Ninguno de los dos conjuntos contiene al otro, así que no hay traducción honesta posible. **El dato
> no se pierde**: queda en nuestra base y se ve en la píldora. Se destraba de dos formas, las dos
> del lado de GHL: **agregar esas opciones a los dropdowns existentes**, o **crear custom fields
> propios del setter**. Cualquiera de las dos alcanza.

---

# 7 · SOLO LECTURA — tags que ya existen y usamos tal cual

| Tag | Estado | Quién lo aplica en GHL | Qué hace en Comando Central |
|---|---|---|---|
| `cita_agendada` | ✅ Existe | El workflow al agendar (`🟨 04.1`), junto con `zona_closer` | **Detector post-llamada**: decide si un Avanzar vino de una llamada o de un chat. Nunca lo escribimos ni lo quitamos |
| `estancado` | ✅ Existe | El workflow de barrido, contra su propia ventana de inactividad | Llena la cola **Conversaciones estancadas** — del closer y del setter. Nosotros no decidimos cuándo una conversación se estancó: eso lo mide GHL |

> ⚠️ **Una contradicción a resolver sobre `cita_agendada`**: el contrato dice en un lugar que se
> quita al cerrar o cancelar la cita, y en otro que **no** se quita porque otros workflows lo usan.
> No afecta al portón de entrada (ese es `zona_closer`), pero sí a la lógica que decide si escribir
> "Resultado de call". **Hace falta confirmar cuál de las dos es.**

---

# 8 · CUSTOM FIELDS — el otro lado del contrato

No son tags, pero se configuran en el mismo lugar y sin ellos la mitad de la ficha queda vacía.

## Los 5 que Comando Central ESCRIBE

Son las subcategorías de las píldoras de Avanzar. **Los valores del dropdown tienen que coincidir
letra por letra** con los de la tabla del punto 3 — un valor que no matchea se descarta con un 200.

| Campo | Lo escribe |
|---|---|
| `contact.nivel_de_inters_seguimiento` | Avanzar → Seguimiento (closer **y** setter) |
| `contact.forma_de_pago_venta` | Avanzar → Venta (closer) |
| `contact.motivo_de_descalificacin` | Avanzar → No le interesa (closer) |
| `contact.razn_de_noshow` | Avanzar → No-show (closer) |
| `contact.origen_nurture` | Avanzar → Nurture (closer y setter) |

> **Los typos y las vocales comidas son intencionales** (`descalificacin`, `razn`, `inters`,
> `confirmacin`). Son las *unique keys* reales de la cuenta, no prosa. "Arreglarlas" hace que el
> campo deje de encontrarse y el Perfil quede vacío sin que nada falle.
>
> De los cinco dropdowns, **solo `nivel_de_inters_seguimiento` se verificó valor por valor**. Los
> otros cuatro existen pero sus opciones no se listaron nunca: **conviene confirmarlas antes de las
> pruebas**, porque un valor que no coincide falla en silencio.

## Los que solo LEEMOS (alimentan el tab Perfil)

Los llenan los formularios y los agentes de GHL; nosotros no los tocamos nunca.

| Grupo | Campos |
|---|---|
| **Calificación · Form VSL** | `_en_qu_etapa_est_tu_negocio_hoy` · `_cul_es_tu_objetivo_de_facturacin` · `_qu_tipo_de_servicios_ofreces_o_planeas_ofrecer` · `_cul_es_el_mayor_obstculo_que_te_est_impidiendo_llegar_a_ese_objetivo` · `_si_somos_una_buena_opcin_para_ti_y_tenemos_cupo_disponible_estaras_listo_para_empezar_ahora` · `_podras_asumir_una_inversin_de_4000_a_8000_usd` · `_al_agendar_confirmas_tu_compromiso_de_asistencia` · `tiene_equipo_` |
| **Calificación · Form Meta** | `en_que_etapa_esta_tu_negocio_hoy` · `cual_es_tu_objetivo_de_facturacion` · `cual_es_el_mayor_obstaculo_que_te_esta_impidiendo_llegar_a_ese_objetivo` |
| **Interacciones** | `confirmacin_cita_por_wsp` · `_video_precall` · `_video_precall_fecha` · `_llamadas_ia_intentos` · `_llamadas_ia_contestadas` · `ultima_llamada_ia__resultado` · `origen_nurture` |

**Los de VSL y los de Meta son campos DISTINTOS aunque la pregunta se parezca**, y no hay que
unificarlos: un contacto puede tener llenos los de uno, los del otro o ambos, y mostrarlos juntos
borraría esa información.

---

# 9 · Qué pedir, en orden, para arrancar las pruebas

Ordenado por lo que desbloquea, no por esfuerzo.

### Bloqueante — sin esto no se puede probar nada

1. **Publicar `🟨 04.1` / `🟨 04.2`** → aplican `zona_setter` y hacen el swap a `zona_closer`.
   Desbloquea: **el módulo Setter entero** y la rúbrica del auditor.
2. **Publicar `🟦 08.1` / `🟦 08.2`** → aplican y quitan `bot_activado`.
   Desbloquea: **el auditor de IA** (hoy no analiza a nadie) y el ruteo correcto del Buzón.

### Para probar el pipeline del setter completo

3. **Crear 3 tags**: `setter_nuevo`, `setter_en_calificacion`, `setter_calificado`.
   Sin ellos las 7 columnas funcionan igual, pero la etapa no viaja a GHL.

### Para cerrar los huecos de datos

4. **Confirmar las opciones de los 4 dropdowns** que no se verificaron:
   `forma_de_pago_venta`, `motivo_de_descalificacin`, `razn_de_noshow`, `origen_nurture`.
5. **Decidir los dos campos del setter** (recuadro del punto 6): agregar opciones a los dropdowns
   existentes, o crear campos propios del setter.
6. **Un tag para la venta low-ticket del setter** — hoy no existe ninguno que signifique eso.
7. **Aclarar `cita_agendada`**: ¿se quita al cerrar/cancelar la cita, o no?
8. **Aclarar `seguimiento_terminado`**: ¿quién lo aplica y cuándo?

### Lo que NO hay que tocar

- **`bot_pausado_fallo`** — lo escribe y lo borra el auditor. Un workflow que también lo escriba se
  pisa con él, y el síntoma es un contacto que vuelve a Urgentes con la alerta ya resuelta.
- **`bot_desactivado_postcall`** — lo escriben las salidas de Avanzar.
- **Los stages del pipeline** — los mueven los workflows de GHL disparados por nuestros tags.
  Nosotros nunca escribimos un stage.

### Lo que además hace falta y no es un tag

- **Los prompts de los dos agentes de texto**, tal cual están en GHL: *Appointment Flow AI*
  (post-agenda) y *Lead Flow AI* (pre-agenda). Se pegan en Auditoría de Agentes › Prompts, sin
  deploy. Sin ellos el auditor puede detectar un fallo pero **no puede citar la corrección** contra
  el prompt real, que es la mitad del valor.
- **Los webhooks**, opcionales: dan velocidad, no funcionalidad. Ver
  [03-INTEGRACION-GHL § El webhook](03-INTEGRACION-GHL.md).

---

## Cómo verificar sin abrir GHL

`GET /api/agentes/auditor-estado` devuelve el embudo contacto por contacto y una lista
`loQueFalta[]` ya redactada para reenviar. Y en **Ajustes › Empresas › Alta** está el checklist
derivado del estado real: dice qué falta y qué ya está, sin casillas que alguien tenga que marcar.

---

**Última revisión:** 2026-08-10, contra `contrato.ts`, `resultados.ts`, `resultadosSetter.ts`,
`etapas.ts`, `etapasSetter.ts`, `miDia.ts`, `miDiaSetter.ts`, `analizador.ts`, `seguimientos.ts`,
`setter/efectos.ts`, `setter/pipeline.ts` y `agentes/alertas.ts`.
