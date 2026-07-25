# Contrato GHL ↔ Motor — Comando Central
**Nombres exactos que el backend debe usar · Julio 2026 · v1**

Este doc es la referencia canónica de nombres en la subcuenta de GHL. Todo lo que el motor lea o escriba vía API usa ESTOS identificadores literales.

---

## 0. Principio de arquitectura (leer primero)

**GHL es la única fuente de verdad. El motor (Kevin) es el mensajero. El tool es la pantalla.**

- **GHL guarda TODO** el estado del contacto: sus respuestas de forms (custom fields), su posición en el embudo (stage del pipeline), sus marcas (tags), su historial de mensajes. Si el tool se apagara, no se pierde nada — todo vive en GHL.
- **El tool NO es una base de datos.** No almacena datos propios; es un visor que muestra lo que vive en GHL y registra las decisiones del humano (que se vuelven tags/campos en GHL).
- **Kevin transporta datos CRUDOS entre ambos, en las dos direcciones:**
  - **GHL → tool (lectura):** Kevin lee de GHL el stage, los custom fields y los tags, detecta mensajes entrantes (webhooks), y le pasa al tool esos datos **sin formatear**. Ejemplo: manda `{ stage: "Seguimiento", nivel_interes: "Muy interesado" }` — NO manda "SEGUIMIENTO · MUY INTERESADO".
  - **tool → GHL (escritura):** cuando el humano registra un Avanzar, Kevin escribe el custom field correspondiente + aplica el tag. El workflow de GHL (disparado por el tag) ejecuta lo predecible (mover stage, etc.).

**Kevin NO formatea, NO traduce, NO concatena, NO decide dónde se muestra el contacto.** Eso es 100% trabajo del tool:
- **La píldora** (estado principal + subcategoría) la ARMA el tool: toma el stage (estado principal: VENTA/SEGUIMIENTO/AGENDADO...) + el custom field de la subcategoría del stage actual, y pinta "SEGUIMIENTO · MUY INTERESADO" con su formato. Kevin solo pasó los dos datos crudos.
- **Dónde aparece el contacto** (Buzón / Urgentes / Estancadas / solo pipeline) lo decide el tool leyendo las señales que Kevin transporta: mensaje entrante sin responder → Buzón; tag `bot_pausado_fallo` → Urgentes; tag `estancado` → Estancadas; nada de eso → solo vive en el pipeline.

**Regla mental para Kevin:** *lee de GHL, transporta crudo, escribe en GHL. El estado siempre se jala de GHL, nunca del tool. La presentación (píldoras, secciones) es del tool, no del motor.*

Principio hermano en workflows: *Kevin decide y etiqueta; GHL ejecuta lo predecible.* La lógica de negocio vive visible en los workflows de GHL (disparados por tags), no enterrada en el código del motor. Excepción única: datos que solo el motor tiene en ese instante (análisis de conversación, detección de fallos).

---

## 1. Custom Values (variables de cuenta)

| Custom Value | Merge field | Contenido |
|---|---|---|
| Calendario Quiroz | `{{custom_values.calendario_quiroz}}` | Booking link del calendario del closer Jorge Quiroz (URL real dentro del value en GHL) |

*Patrón para futuros closers: un custom value por closer — `calendario_[nombre]`.*

---

## 2. Tags

⚠️ La lista completa y vigente de tags está en la **§9 LISTA MAESTRA DE TAGS** (al final del documento), agrupada por función con quién aplica cada uno y qué dispara. Esta sección queda como puntero — usar la §9 como única referencia.

---

## 3. Pipelines y stages (nombres literales)

**Pipeline "Lead Flow" (setter):**
Nuevo → En calificación → Calificado sin agendar → Low-ticket ofrecido → Agendado *(won, valor 0)* → Nurture → Descalificado

**Pipeline "Appointment Flow" (closer):**
Agendado → Cierre en curso → Seguimiento → Ganado *(won, el monto HT vive en el Opportunity Value)* → Adelanto *(ganado parcial)* → No-show → Nurture → Descalificado

Reglas: el stage de GHL = fuente de verdad del pipeline. El dashboard lo lee (webhook) y el movimiento lo dispara el TAG que aplica Kevin al registrar un Avanzar (no el dashboard escribiendo el stage directo). Puente al agendar (WF 04.2): won en Lead Flow + creación de oportunidad en Appointment Flow + swap `zona_setter`→`zona_closer`. Si el deal muere post-agenda, el won del setter no se revierte.

---

## 4. Custom Fields — unique keys (REALES, de GHL)

**Campos duplicados VSL/Meta — RESUELTO (son intencionales).** Las preguntas de etapa/objetivo/obstáculo existen en dos campos distintos según el form (VSL vs. Meta) A PROPÓSITO: el Perfil del tool muestra separada la info de cada fuente. NO unificar. Regla de lectura cuando se necesita UN valor (Pre-score, ruteos, agente): gana el del form VSL (más reciente/completo); si no existe, usar el de Meta.

**Carpeta Calificación — form VSL (landing):**
- ¿En qué etapa está tu negocio hoy? → `contact._en_qu_etapa_est_tu_negocio_hoy` ⚠️dup
- ¿Cuál es tu objetivo de facturación? → `contact._cul_es_tu_objetivo_de_facturacin` ⚠️dup
- ¿Qué tipo de servicios ofreces (o planeas ofrecer)? → `contact._qu_tipo_de_servicios_ofreces_o_planeas_ofrecer`
- ¿Cuál es el mayor obstáculo...? → `contact._cul_es_el_mayor_obstculo_que_te_est_impidiendo_llegar_a_ese_objetivo` ⚠️dup
- Si somos buena opción y hay cupo, ¿listo para empezar ahora? → `contact._si_somos_una_buena_opcin_para_ti_y_tenemos_cupo_disponible_estaras_listo_para_empezar_ahora`
- ¿Podrías asumir una inversión de $4,000 a $8,000 USD? → `contact._podras_asumir_una_inversin_de_4000_a_8000_usd`
- Al agendar, confirmas tu compromiso de asistencia → `contact._al_agendar_confirmas_tu_compromiso_de_asistencia`
- Tiene equipo? (por llamada IA) → `contact.tiene_equipo_`

**Carpeta Meta Lead Ads — form Meta:**
- En que etapa esta tu negocio hoy? → `contact.en_que_etapa_esta_tu_negocio_hoy` ⚠️dup
- Cual es tu objetivo de facturacion? → `contact.cual_es_tu_objetivo_de_facturacion` ⚠️dup
- Cual es el mayor obstaculo...? → `contact.cual_es_el_mayor_obstaculo_que_te_esta_impidiendo_llegar_a_ese_objetivo` ⚠️dup

**Carpeta Interacciones:**
- Confirmación cita por WhatsApp (clic al botón post-agenda) → `contact.confirmacin_cita_por_wsp`
- Video pre-call (% visto) → `contact._video_precall`
- Video pre-call fecha → `contact._video_precall_fecha`
- Llamadas IA intentos (nº de intentos hasta contestar) → `contact._llamadas_ia_intentos`
- Llamadas IA contestadas (puede haber 2: leadflow + appflow) → `contact._llamadas_ia_contestadas`
- Última llamada IA — resultado (responde/buzón/etc.) → `contact.ultima_llamada_ia__resultado`
- Origen nurture (No-show / Pidió tiempo / Se enfrió) → `contact.origen_nurture`

**Carpeta Sistema:**
- Link reagenda → `contact._link_reagenda`
- Link del Meet (enlace de la videollamada del contacto) → `contact.link_del_meets`
- Pre-score Meta (Caliente/Tibio/Probable LT) → `contact.prescore`

**⚠️ Campos que estaban en el plan pero NO aparecieron en la lista de GHL — estado confirmado por Francisco:** `Miembro comunidad` y `Low-ticket comprado` → PAUSADOS (no crear por ahora). `Estado de calificación` (A/B/C/D) → STANDBY hasta sesión con Jorge.

**Campos de SUBCATEGORÍA a crear (pintan las píldoras del tool; el humano elige en el modal de Avanzar → Kevin escribe el campo + aplica el tag). Carpeta "Resultados de Avanzar":**
- Nivel de interés seguimiento → `contact.nivel_de_inters_seguimiento` — Próximo a pagar / Muy interesado / Dudando / Enfriándose → píldora "SEGUIMIENTO · X"
- Motivo de descalificación → `contact.motivo_de_descalificacin` — Precio / No es el momento / Competencia / No califica / Otro → píldora "DESCALIFICADO · X"
- Forma de pago venta → `contact.forma_de_pago_venta` — Contado / Splitwise / Buy Now Pay Later / Cuotas → píldora "VENTA — X"
- Razón de no-show → `contact.razn_de_noshow` — Avisó quiere reagendar / Plantón sin aviso / Falla técnica / Datos incorrectos → píldora "NO-SHOW · X" + insumo de Gerencia
- (Fuente / Campaña → PAUSADOS por ahora)

**Regla de acumulación (NO borrar):** un contacto puede pasar por varios desenlaces en el tiempo (ej. Seguimiento → No-show → Venta), acumulando varios de estos campos llenos. Kevin NO borra los anteriores al escribir uno nuevo. La píldora del tool muestra SOLO la subcategoría del campo que corresponde al STAGE ACTUAL (Ganado→forma de pago, Nurture→origen nurture, Seguimiento→nivel de interés, No-show→razón, Descalificado→motivo); los demás quedan como historial invisible en la píldora pero disponibles para Gerencia (ej. "clientes que fueron no-show y luego compraron").

**Regla de lectura para duplicados VSL/Meta (cuando Kevin necesita UN valor):** el del form VSL gana (más reciente y completo); si no existe, usar el de Meta. En el PERFIL del tool se muestran separados (bloque Form VSL / bloque Form Meta) — la regla aplica solo a cálculos (Pre-score, ruteos).

**⚠️ Custom field de OPORTUNIDAD (no contacto) a crear:** `Resultado de call` (dropdown: Venta / Adelanto / Seguimiento / No-show / Nurture / Descalificado). Lo escribe el workflow de resultado post-call, no Kevin.

---

## 5. Carpetas de workflows (organización)

**Estructura por agente (reorganización de hoy):**

**LEAD FLOW:** Leads & Secuencia inicial (01) · Seguimiento (02) · Ruteo y derivaciones (03) · Sistema Comando Central (interruptores del bot LF)

**APP FLOW:** Agenda & Recordatorios (citas) · AI Call · Resultados post-call · Resultados de Avanzar · Sistema Comando Central (interruptores del bot AF)

Cada agente tiene su carpeta "Sistema Comando Central" — es el punto de enganche de Kevin: entra al territorio del contacto y ahí están los workflows-interruptor que el tool dispara. Los workflows de resultado/mensajería NO van en Sistema (esa es solo interruptores).

---

## 6. Workflow pendiente — Detección de estancamiento (07.x)

**Propósito:** que una conversación que el humano (closer o setter) respondió pero dejó sin desenlace reaparezca sola en la sección Estancadas tras 3-4 días de silencio, para que tenga oportunidad de reconversar.

**Requisito frontend (pendiente):** el tool aplica un tag (ej. `conversacion_activa_[rol]`) cuando el humano responde y completa una tarea SIN marcar "mantener". Sin ese tag, el workflow no tiene disparador.

**Ficha del workflow (GHL):**
- Trigger: Tag Added `conversacion_activa` (o Customer Replied del lado del humano).
- Wait 3-4 días. **Re-entry ACTIVADO** — cada mensaje nuevo (del contacto o del humano) reinicia el Wait; la conversación viva no se marca estancada.
- Condición de cancelación durante la espera: si hay respuesta nueva o se registra un Avanzar (desenlace) → salir sin marcar.
- Si se cumplen los 3-4 días de silencio total → aplicar tag `estancado`.

**Rol de Kevin:** transportar el tag `estancado` al tool vía webhook (para pintar la sección Estancadas). Kevin NO calcula el tiempo — el timer es 100% GHL. Aplica igual a closer y setter (un workflow por rol, o uno con condición de rol).

**Tag nuevo:** `estancado` (+ el/los `conversacion_activa_closer` / `conversacion_activa_setter` que aplique el tool).

---

## 7. Atribución del setter (latch) — para separar métricas hands-off vs. setter

**Regla de negocio:** el Lead Flow es hands-off por defecto (el bot capta, califica, agenda solo). El setter interviene solo en la excepción (bot falló, no logró resultado, o derivación a LT). En el momento en que el setter interviene manualmente, el contacto queda marcado como suyo, y **todo lo que ocurra después es del setter** (aunque el bot reactivado cierre). Ya no es hands-off.

**Mecánica (latch):** un tag `atribucion_setter` que se enciende con la primera intervención manual del setter y **persiste** (no se apaga). Disparador exacto A CONFIRMAR: lectura actual = cualquier intervención manual del setter (responder ya cuenta); alternativa = solo cuando reactiva el agente tras intervenir.

**Rol de Kevin:** leer `atribucion_setter` para atribuir agendas/ventas. Regla: contacto CON la marca → "generada por el setter" (cuenta para su desempeño y su comisión diferida/LT); contacto SIN la marca → "automática (sistema)". La atribución NO depende de quién apretó el botón final, sino de si existe la marca. Alimenta la separación del dashboard del setter (agendas automáticas vs. generadas por el setter).

**Tag nuevo:** `atribucion_setter`.

---

*Docs hermanos: MOTOR-Interpretacion-Conversaciones (arquitectura del motor) · CHECKLIST-GHL-Backend (construcción). Cuando las unique keys estén pegadas, este doc viaja a Kevin junto con ambos.*

---

## 9. LISTA MAESTRA DE TAGS

Leyenda de "quién aplica": **Bot** = el agente IA vía Agent Action · **WF** = un workflow de GHL · **Kevin** = el motor vía API (traduce una acción del humano en el tool) · **Meta/Form** = al entrar el lead.

### Territorio y ciclo de vida
| Tag | Qué significa | Quién aplica | Qué dispara / para qué |
|---|---|---|---|
| `zona_setter` | Nació en funnel del setter (Lead Flow) | WF entrada (01.1a/01.1b) | Lo lee el puente 04.2 para atribuir la agenda; organiza el pipeline |
| `zona_closer` | Cruzó a territorio closer (App Flow) | WF 04.1 al agendar | Marca territorio post-agenda |
| `cita_agendada` | Tiene una cita viva | WF 04.1 | Detector post-call (If en resultados); se quita al cerrar/cancelar |
| `lead_meta_ads` | Entró por Meta Lead Ads | WF/Meta | Dispara ruteo 01.3 |
| `estancado` | Respondido sin desenlace, 3-4 días de silencio | WF estancamiento | Kevin lo transporta → sección Estancadas del tool |

### Interruptores del bot (Sistema)
| Tag | Qué significa | Quién aplica | Qué dispara |
|---|---|---|---|
| `bot_apagado_manual` | El humano apagó el bot desde el tool (decisión manual) | Kevin (a orden del tool) | WF 07.1 → Conversation AI Off |
| `bot_pausado_fallo` | El motor DETECTÓ un fallo del bot | Kevin (detección) | WF 07.1 → Off + aparece en Urgentes |
| `bot_desactivado_postcall` | Fin de sales call (apagado permanente) | WF resultados post-call | WF 07.1 → Off |
| `bot_reactivar` | Reactivar el bot | Kevin — cuando (a) el humano da clic al icono del agente en la conversación, o (b) se resuelve una urgencia | WF 07.2 → AI On |

*Nota: NO existe tag `pausa_temporal` — la pausa al intervenir manualmente es el auto-pause NATIVO del agente (config, 2h), no un tag. Verificar el nombre exacto del tag de fallo en GHL: `bot_pausado_fallo` (Francisco escribió una vez "bot_apagado_fallo" — usar el que exista realmente).*

### Ruteo y derivaciones (Lead Flow) — los aplica el AGENTE de GHL vía Agent Action (no Kevin)
| Tag | Qué significa | Quién aplica | Qué dispara |
|---|---|---|---|
| `derivado_lt` | Sin capital pero con interés → low-ticket | **Bot (Agent Action)** | WF 03.x: apaga bot + oportunidad al setter |
| `nurture_leadflow` | Con capital sin urgencia, o silencio total | **Bot (Agent Action)** | WF 03.x → stage Nurture |
| `descalificado` | Spam / hostil / sin perfil | **Bot (Agent Action)** / Kevin | WF: If cita_agendada bifurca (ver Resultados) |
| `ruta_infoproducto` | Objetivo "primeros clientes" | WF 01.3 | Marca de perfil para seguimiento |

### Seguimientos
| Tag | Qué significa | Quién aplica | Qué dispara |
|---|---|---|---|
| `seguimiento_para_agendar` | Seguimiento setter para agendar | Kevin (Avanzar) | Serie 02.1a |
| `seguimiento_decision_lt` | Seguimiento setter decisión LT | Kevin (Avanzar) | Serie 02.1b |
| `seguimiento_recupero` | Seguimiento automático post-call (3 toques/7 días) | Kevin (Avanzar) | Serie Recupero |
| (respuesta del contacto) | — | trigger Customer Replied | WF 02.6 saca de las series + limpia tags |

### Resultados post-call (App Flow) — cada uno lleva If `cita_agendada` al inicio: SÍ → escribe `Resultado de call` + apaga bot (`bot_desactivado_postcall`); NO → solo su acción normal, sin tocar Resultado de call. (Excepción no-show: no apaga bot, y siempre tuvo cita.)
| Tag | Qué significa | Quién aplica | Qué dispara |
|---|---|---|---|
| `venta_ganada` | Venta cerrada | Kevin (Avanzar) | WF → stage Ganado + Opportunity Value |
| `adelanto_ganado` | Adelanto/seña | Kevin (Avanzar) | WF → stage Adelanto |
| `seguimiento` | Seguimiento (sirve pre y post call) | Kevin (Avanzar) | WF: If cita_agendada → Resultado de call=Seguimiento; si no → seguimiento normal |
| `nurture_appflow` | Nurture tras call | Kevin (Avanzar) | WF 06.1 → stage Nurture (+ escribe Origen nurture) |
| `descalificado` | Descartado (sirve pre y post call) | Bot / Kevin | WF: If cita_agendada → Resultado de call=Descalificado + stage; si no → descalifica normal |
| `noshow` | No asistió (siempre tuvo cita) | WF 06.4 / Kevin | Recuperación 06.4 (NO apaga bot) + Resultado de call=No-show |

*Nota: `seguimiento_postcall` y `descalificado_postcall` fueron ELIMINADOS — se unificaron en `seguimiento` y `descalificado` con el If `cita_agendada` que bifurca. El detector `cita_agendada` distingue post-call de pre-call; no hacen falta tags separados.*

### Atribución
| Tag | Qué significa | Quién aplica | Qué dispara |
|---|---|---|---|
| `atribucion_setter` | El setter intervino (latch, persiste) | Kevin (1ª intervención manual) | Lo lee Gerencia/dashboard setter para atribuir |

### ⚠️ Micro-decisiones abiertas de tags
- Disparador del `atribucion_setter`: ¿cualquier intervención manual (lectura actual) o solo al reactivar el agente?
- Naming del tag de conversación activa: RESUELTO → `conversacion_activa_setter` / `conversacion_activa_closer` (por rol) + `estancado` único. ARQUITECTURA DEL BARRIDO — 2 workflows por rol (4 total, en las carpetas Sistema Comando Central):
  - **WF-A (reloj):** trigger Tag Added `conversacion_activa_[rol]` → Wait 3-4 días → quita el tag + añade `estancado`.
  - **WF-B (limpieza al haber actividad):** trigger Customer Replied + condición tiene `conversacion_activa_[rol]` → Remove From Workflow WF-A + Remove Tag `conversacion_activa_[rol]`. NADA MÁS: WF-B solo MATA el reloj viejo, NO reinicia.
  - **Quién reinicia el reloj: el TOOL, condicionado al desenlace.** Si el humano responde y completa la tarea SIN desenlace (la deja abierta) → el tool re-aplica `conversacion_activa_[rol]` → WF-A arranca fresco. Si el humano responde y hace Avanzar (Descalificado / Venta / cualquier desenlace) → el tool NO aplica el tag → no hay timer (la tarea ya está cerrada, no en limbo).
  - Clave: el timer solo existe mientras la tarea esté genuinamente en el limbo (respondida sin cerrar). El re-add debe quitar el tag primero (WF-B lo hace) para que la re-aplicación del tool dispare de nuevo. Kevin NO re-aplica; solo transporta `estancado` al tool.
  - Nota: no se usa "Wait for Contact Reply" nativo — solo cuenta respuestas a mensajes que el propio workflow envía, y el reloj no envía nada.
- `seguimiento_activo`: ELIMINADO (se decidió trabajar con los tags detallados directamente).

### Distinción importante: barrido vs. serie de seguimiento
- **Serie de seguimiento** (`seguimiento_recupero`, `seguimiento_para_agendar`, etc.): la dispara el Avanzar → Seguimiento. El contacto ya tiene stage y serie.
- **Barrido de estancamiento** (`conversacion_activa_[rol]` → `estancado`): NO viene de Avanzar. Lo dispara el tool cuando el humano responde y completa una tarea SIN dar desenlace. Es la red para "respondí pero no cerré". Los dos mecanismos no se solapan.

---

## 8. Resultado de call (reparto de llamadas para Gerencia)

**Problema que resuelve:** hoy los Avanzar (venta / adelanto / seguimiento / nurture / etc.) se mezclan sin distinguir cuáles vienen de una call. Sin eso, Gerencia no puede mostrar "de 100 calls, X% cerró, Y% adelanto, Z% seguimiento, etc.".

**La distinción NO la hace Kevin — la hace el workflow.** Kevin sigue haciendo lo de siempre (aplica el tag del Avanzar: `venta_ganada`, `nurture_appflow`, etc.). Cada uno de esos workflows lleva al INICIO un If/Else:

**If ¿el contacto tiene el tag `cita_agendada`?**
- **SÍ (fue post-call):** además de sus acciones normales, escribe el custom field de oportunidad `Resultado de call` con la categoría correspondiente (Venta / Adelanto / Seguimiento / No-show / Nurture / Descalificado).
- **NO (fue por chat, sin cita):** hace sus acciones normales pero NO escribe `Resultado de call` (no hubo call que categorizar).

Así el mismo workflow maneja venta-por-call y venta-por-chat; solo categoriza como call cuando había cita. NO se quita el tag `cita_agendada` (otros workflows lo usan).

**Rol de Kevin:** ninguno nuevo — solo aplica los tags que ya aplicaba. La categorización de call vive en los workflows de GHL (visible y editable por Francisco), no en el código de Kevin.

**Custom field a crear:** `Resultado de call` (OPORTUNIDAD, dropdown: Venta / Adelanto / Seguimiento / No-show / Nurture / Descalificado).

**Consumidor:** la métrica de reparto de calls en el dashboard de Gerencia.
