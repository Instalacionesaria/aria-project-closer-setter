# CLAUDE.md — Comando Central (ARIA IA)

**Contexto permanente del proyecto. Leer antes de cualquier cambio. Este archivo es la fuente de las reglas de producto — el código implementa lo que aquí se define, nunca al revés.**

---

## 1. Qué es este producto

**Comando Central**: dashboard para equipos comerciales high-ticket que opera sobre GoHighLevel (GHL). GHL es el archivador y ejecutor (contactos, custom fields, tags, workflows, citas); un motor de IA (backend propio, en desarrollo por Kevin) interpreta las conversaciones; este frontend es la cabina de mando de los humanos.

**Roles:** closer (post-agenda: llamadas de venta), setter (pre-agenda: leads hasta agendar), técnico (mantiene los agentes IA), admin (Francisco).

**Menú del sidebar:** Closer AI · Setter · Auditoría de Llamadas (antes "Sales Calls Audit", renombrado §41 — placeholder "Próximamente") · Auditoría de Agentes (antes "Agents Audit", renombrado §41) · Gerencia (placeholder "Próximamente") · Ajustes. Este documento sigue usando "Sales Calls Audit"/"Agents Audit" como nombres de MÓDULO en la prosa de abajo (§C/§D) y en nombres de archivo (`AgentsAudit.tsx`) — el string que ve el usuario en el sidebar es el de arriba.

**Embudo:** Meta Lead Ads / VSL opt-in / IG Profile → agente Lead Flow (texto+voz) califica y agenda → setter supervisa pre-agenda → cita → agente Appointment Flow confirma → closer hace la sales call → venta. Producto low-ticket ($97-500) para los que no califican al high-ticket ($4-8k).

## 2. Arquitectura (dónde vive cada cosa)

- **GHL** = fuente de verdad de: contactos, custom fields, tags (interruptores), stages de pipeline, citas, conversaciones. Dos pipelines: "Lead Flow" (setter, won = Agendado y LT vendido) y "Appointment Flow" (closer, won = GANADO).
- **Motor (Kevin, Supabase)** = analiza cada conversación UNA vez → 4 salidas: auditoría de agentes, sentimiento, briefing, extracción de perfil. Escribe eventos en Supabase; aplica tags vía API. El dashboard LEE de Supabase — nunca calcula al renderizar, nunca consulta servicios externos en vivo.
- **Este frontend** = muestra estado y registra decisiones humanas. Registrar en "Avanzar" escribe el evento + mueve el stage en GHL vía API. Los eventos automáticos (cita por link, pago por webhook) se registran solos con autor `Sistema` y JAMÁS pasan por Avanzar.
- **Layout/scroll:** el contenedor principal de las vistas usa `overflow-y-scroll` permanente (pista de scrollbar siempre activa) para evitar layout shift (saltos horizontales) al alternar entre vistas con scroll (Pipeline) y sin scroll.
- **Docs hermanos** (pedir a Francisco — **ninguno se versiona**): `CONTRATO-GHL.md` (nombres exactos de tags/campos/stages; en `.gitignore` desde el 2026-07-25 por decisión de Francisco, aunque el código y esta guía lo citen constantemente), `MOTOR-Interpretacion-Conversaciones.md`, `CHECKLIST-GHL-Backend.md`.

## 3. Glosario oficial (nunca usar otros términos)

- Resultados del cuadrante **Avanzar (closer)**: `Venta` / `Acordó comprar, falta pago` / `Seguimiento` (subcategoría = situación: Próximo a pagar / Muy interesado / Dudando / Enfriándose / Otro — §39.1) / `No le interesa` / `No-show` / `Nurture` (Pidió tiempo / Se enfrió — §39.2) — **6 salidas confirmadas** (ver pantallas exactas en §16 y §39). No-show exige subcategoría obligatoria (4 chips, sin default): Avisó·quiere reagendar / Plantón·sin aviso / Falla técnica / Datos incorrectos.
- **Avanzar (setter)**: `Agendó` (solo manual, selector de slots) / `Venta Low-Ticket` (selector de producto del catálogo + monto pre-llenado editable + forma de pago) / `Seguimiento` (2 grupos mutuamente excluyentes: automático — Para agendar / Para decisión LT — o manual — Mañana / En 3 días / 1 semana / Personalizada; ver §16.1) / `No califica` (Sin capital / Sin urgencia / No es el perfil / Datos falsos) / `Nurture` (Pidió tiempo / Se enfrió — componente `NurtureScreen` compartido con closer, §39.2).
- Stage ganado del closer = `GANADO`. "Se presentó" = hecho derivado (alimenta Show rate), nunca píldora.
- **Prohibidos:** "Cerró", "No se conectó", "Conectó", **"cadencia"** (siempre decir "seguimiento automático"), **"Perdido"/"Pérdida"** (siempre decir "Descalificado" — §39.5).
- Venta = pago verificado por humano. El webhook (fase 2) avisa, nunca registra solo.
- Toda salida de Avanzar incluye un campo "Nota" opcional que viaja directo al tab Notas con contexto (fecha, resultado, autor).

## 4. Reglas transversales (aplican a TODO)

1. Contadores en cero jamás se renderizan (icono queda atenuado, sin "0"). Secciones vacías en Mi Día se ocultan, excepto "Completadas Hoy" (siempre visible como ancla).
2. Botones de disparo (🤖, resolver, ⭐) con debounce: un tap activa con animación y queda bloqueado como estado; revertir = acción separada con confirmación. ⏱ ya NO es un botón (ver §16.1) — es solo estado de lectura, se enciende únicamente vía Avanzar.
3. Espejo acción/estado: compositor y controles = acciones (abajo); fila de iconos del header = solo estado, nunca clicable.
4. Fuente única de verdad: ninguna vista tiene estado propio; registrar algo actualiza TODAS las vistas al instante (Inicio, Mi Día, Pipeline, Agenda, Ficha, Historial).
5. Zonas de clic: toda la fila abre la ficha; expandir secundario = chevron que detiene propagación; botones de acción tienen su propio clic aislado.
6. La ficha del contacto es UN componente global que se abre como **drawer donde se invoca** — nunca navega a otro módulo. Autofocus del compositor al abrir en tab Chat (solo desktop).
7. Score: letra coloreada ANTES del nombre en listas; primer slot de iconos en la ficha. Sin datos → "—", jamás inventar.
8. Ítem del sidebar → SIEMPRE a la raíz de ese módulo.
9. Todo % lleva su base ("X de Y").
10. Textos derivados SOLO de eventos reales; sin dato, el elemento no se renderiza.
11. Temperatura: Inicio/cockpit = oscuro+dorado celebratorio; vistas de trabajo = claras. Dorado = dinero/logro, solo eso.
12. "Avanzar" es el ÚNICO registro de resultados (botón adaptativo negro/claro, nunca dorado).

## 5. Navegación principal (Sidebar)

- **Closer** → vista raíz del módulo Closer.
- **Setter** → vista raíz del módulo Setter.
- **Sales Calls Audit** (antes "Llamadas") → módulo de auditoría, deshabilitado ("Próximamente") en esta fase.
- **Agents Audit** (antes "Agentes") → módulo de supervisión de IA.
- **Gerencia** → placeholder "próximamente", deshabilitado.
- **Ajustes** → configuración, renderizada dinámicamente según el rol (Admin vs usuario normal).
- **Sugerir Mejora (💡)** → pie del sidebar. Popover con textarea. Captura texto, usuario, fecha y vista activa. Va a la bandeja de Sugerencias en Ajustes > Administración con chip clickeable de la vista de origen (filtra al hacer clic).
- **Modo Oscuro (Luna/Sol)** → pie del sidebar, junto a Sugerencias. Cambia el tema global.

## 6. Anatomía por módulo

### A. Closer

- **Inicio (cockpit):** oscuro + dorado celebratorio. Cash collected del mes protagonista ("Cobrado real, no prometido" + delta) · anillo de comisión contra su meta (configurada en Ajustes > Mi Cuenta, se llena con cada Venta registrada en Avanzar según el % de comisión que define el Admin; "faltan $X → N ventas más") · Tasa de Cierre (% de ventas sobre citas atendidas/leads gestionados) · tarjetas: Ventas (con tasa), Acuerdos ($ y leads), Calls del mes, Show rate (con meta) · puente "X tareas pendientes → Ejecutar Mi Día" (calcula dinámicamente Urgencias + Seguimientos vencidos/hoy + mensajes sin responder) · Histórico de ingresos (4 meses). Al registrar Venta: celebración fullscreen dorada breve (confeti) + sonido configurable.
- **Mi Día:** clara, calmada. Snapshot con tarjetas rápidas (Urgencias en rojo, Pendientes, Completadas en verde); clic hace scroll a la sección. Secciones (cola de trabajo): Urgentes (rojo, IA pausada, requiere abrir ficha + mensaje manual + marcar Resuelto) → Registro pendiente (calls sin resultado) → Respondieron → Buzón general → Seguimientos → Completadas Hoy (siempre visible).
- **Pipeline:** columnas Kanban (Venta, Seguimiento, No le interesa, No-show). Tarjetas con Score, Nombre, píldora de situación, micro-narrativa de última actividad y chevron.
- **Agenda:** calendario de citas del día + Próximos Días. Botón Unirse = Meet de la cita existente. Briefing IA por cita (tarjeta expandible): resumen de quién es / de dónde vino / qué le importa u objeción, más estado del **Video Pre-call** ("✓ Vio el video pre-call (87%)" en verde, o "⚠ No vio el video pre-call" en ámbar; solo si hay cita futura Y el video fue enviado).

### B. Setter (espejo del closer en pre-agenda)

- **Inicio (cockpit):** oscuro + dorado celebratorio. Comisiones del mes en dos líneas (LT cobradas + diferidas por ventas originadas). Sin anillo de meta en v1. Agendas del mes con desglose por canal ("14: 9 Meta · 5 IG"), Show rate propio, Oportunidades LT abiertas, puente a Mi Día.
- **Mi Día:** Intervenciones urgentes → Conversaciones Estancadas (ámbar; leads apagados hace >6h, fila tintada + línea gris de inactividad, **sin píldora de "Estancado"** — la píldora muestra la situación real, ej. "En Calificación"; genera "rescates" con tope 3, al agotarse pasa solo a Nurture con autor `Sistema`) → Oportunidades LT (violeta, derivados por el bot por falta de capital) → Respondieron → Buzón general (cola única sin tarea previa, filtros por canal: Todos/WhatsApp/Instagram, chips de fuente con icono de canal, ej. 📷 IG PROFILE) → Seguimientos → Completadas.
- **Pipeline (pre-agenda):** Nuevo → En Calificación → Calificado sin agendar (destacado 🔥) → Low-Ticket Ofrecido → Agendado (handoff al closer) → Nurture → Descalificado.
- **Comisión:** base fija + diferida SOLO por agendas hands-on (clasifica el sistema: intervino cuando estaba objetivamente trabada) + LT por autoría. IG = único canal sin bot (reglas humano-bot no aplican ahí; todo IG es hands-on).

### C. Sales Calls Audit

El archivo de las llamadas de venta del equipo (grabaciones + reportes del motor). Lista cronológica: fecha · contacto (abre su ficha-drawer) · closer · duración · score de la llamada (/100) · resultado registrado. Expandido: reporte completo — objeciones detectadas, puntos fuertes, mejoras sugeridas, ▶ grabación. El score y el coaching existen SOLO aquí y en el tab Llamada de la ficha (jamás para llamadas de agentes IA).

### D. Agents Audit

Grid de tarjetas (header + cápsula salud + tasa protagonista con base + sentimiento compacto + operativos en cajitas) · switcher 3 posiciones (Todos default / Texto / Voz) · banner de graves global (cola por antigüedad, solo se apaga resolviendo) · ficha del agente (sparkline 2 líneas con marcas de ajustes → operativos → lista de trabajo del técnico → historial del agente = el global pre-filtrado). Paneles de sentimiento: los % son botones → lista de contactos con la FRASE DISPARADORA (no el último mensaje); clic → ficha completa como drawer AQUÍ (nunca navegar a Closer).

### E. Ajustes

UNA vista sensible al rol.

- **Mi Cuenta (todos los roles):** meta del mes (solo closers, alimenta el anillo de Inicio) · Conectar Calendario (estado de conexión) · Mi enlace de agendamiento personal (se inyecta en el menú "+" del compositor; los booking links personales JAMÁS viven en el catálogo central) · Sonido de venta con preview (Caja registradora / Aplausos / Silencio).
- **Administración (solo admin):** Catálogo de Enlaces (lista central editable: Etiqueta, Monto, Procesador, URL, Categoría creable [Pago/LT/Recursos] y Scope de visibilidad [Closers/Setters/Todos] — de aquí se alimenta el menú "+" de todos los usuarios) · Comisiones por closer (% individual, calcula las métricas de Inicio) · Bandeja de Sugerencias (💡) (fecha, usuario, chip clickeable de la vista de origen que filtra al hacer clic, texto completo, check de "atendida" que la mueve al fondo colapsada).

## 7. La ficha del contacto (componente global — el más usado)

Un solo componente, se abre como **drawer** desde cualquier fila de cualquier módulo (regla 6). Estructura de arriba a abajo:

- **Header (solo estado, no clicable):** nombre + teléfono + flags (🎙/⭐) · **píldora de situación** (siempre la situación real: "AGENDADO · 08 JUL", "EN CALIFICACIÓN · PARCIAL 3/8", "SEGUIMIENTO · PARA AGENDAR"; el estancamiento NUNCA es píldora — es tinte ámbar de fila + línea gris) · **fila de iconos de estado** (solo lectura, nunca clicable, ver §8). Iconos inactivos atenuados ~22%, sin números en cero.
- **Botón "Avanzar"** (ancho completo, debajo del header): único registro de resultados. Abre el cuadrante con las salidas del rol (glosario §3) — cada salida con sus preguntas mínimas y campo de nota opcional. Adaptativo visualmente (negro en tema claro, claro en oscuro), nunca dorado.
- **Tabs:**
  - `Chat` — conversación completa; autofocus del compositor en desktop.
  - `Llamada` — archivo cronológico unificado de TODAS las llamadas, cada fila con chip que identifica al agente: 🎙 SALES CALL / 📞 LEAD FLOW VOZ / 📞 APP FLOW VOZ (nunca "Llamada IA" genérico); expandido: sales call → reporte con score/objeciones/grabación, IA → summary + audio. Score/coaching SOLO en sales calls. Implementado el 2026-07-10 (antes disabled/"próximamente") — detalle completo en §28.
  - `Perfil` — 4 grupos: DETALLES / ORIGEN / CALIFICACIÓN (eje fit) / INTERACCIONES (eje engagement), incluye estado del **Video Pre-call** ("87% visto · vía tracking · 05 Jul"). Campos y grupos vacíos no se renderizan.
  - `Historial` — todos los eventos con autor real (nombre del usuario o `Sistema`), timeline inmutable.
  - `Notas` — notas del modal Avanzar con contexto automático fecha·resultado·autor + botón "+ Nota" manual.
- **Compositor** (pie del tab Chat): menú **[+]** (enlaces) · campo de texto (autofocus en desktop) · toggle **🤖** (solo se renderiza en conversaciones con agente IA asignado; apagar = 1 tap con animación; prender = confirmación; no existe en IG ni post-sales-call — detalle completo del estado del toggle en §25). Ya NO tiene botón de reloj — todo seguimiento se activa únicamente desde "Avanzar" (§16.1). Mensaje manual con bot activo → pausa temporal ~2h que se auto-levanta si el contacto no responde.

## 8. Iconografía y chips — referencia completa

**Fila de iconos de estado** (header de la ficha y filas de listas; solo lectura; inactivos atenuados ~22%, jamás con "0"):

| Glifo | Significado | Se enciende cuando | Detalle |
|---|---|---|---|
| Letra de score (primer slot) | Fit del lead (A/B/C/D coloreada, círculo sólido con letra en blanco) | Hay datos de calificación; sin datos → "—" | Ver §9 |
| 📹 + número | Reuniones/llamadas **con el closer** ("📹1") | ≥1 registro `sales_call` en el tab Llamada | 2026-07-11: reemplaza la derivación anterior por `agenda.meetUrl` y al viejo flag 🎙 junto al nombre (eliminado) — ver §35. Acumulativo de por vida; si es 0, ícono atenuado sin número |
| 📅 | Tiene cita futura | Cita agendada vigente | En territorio setter solo se enciende en etapa Agendado |
| 📞 + número | Llamadas IA **contestadas** ("📞1 ✓") | Contestó al menos una | Acumulativo de por vida (Lead Flow + App Flow al mismo contador); intentos sin respuesta = icono atenuado con "✗"; sales calls JAMÁS suman aquí; si es 0, no se renderiza |
| 🤖 | Estado del agente IA de la conversación | Verde = activo / Ámbar = pausa temporal / Rojo = pausado por error (urgencia) / Gris = apagado por humano / Violeta + "LT" = derivado a low-ticket / atenuado = muerto post-call | No se renderiza en canales sin bot (IG); detalle completo del toggle en §25; regla de "muerto para siempre tras la sales call" en §34 |
| ⏱ | Seguimiento automático activo | Serie de toques corriendo (tag `seguimiento_activo`) | Solo lectura, nunca clicable — se enciende/apaga únicamente vía "Avanzar" → Seguimiento automático (§16.1) |
| 💰 | Venta LT o HT | Venta registrada | Acompañado del monto cobrado |

**Flags junto al nombre**: solo ⭐ destacado (botón al final de fila: tap → se rellena ámbar, sube al tope; desmarcar con confirmación). El flag 🎙 (tuvo sales call) que existió hasta el 2026-07-11 se eliminó — esa información ahora vive en el ícono 📹 de la fila (ver arriba, §35).

**Chips de fuente** (toda fila los lleva): `META ADS` · `VSL OPT-IN` · `📷 IG PROFILE` (único con icono, para distinguir canal a golpe de vista) · `DIRECTO` (fallback — ninguna fila sin origen).

**Chips del tab Llamada** (identifican al agente de cada llamada): `🎙 SALES CALL` · `📞 LEAD FLOW VOZ` · `📞 APP FLOW VOZ`.

## 9. Score e inteligencia visible (lo que el motor pinta en la UI)

- **Score = letra de FIT** (A/B/C/D): derivada de la calificación (capital, urgencia, etapa, facturación). Casi estática. **REGLA DURA vigente: ninguna señal de engagement (video, llamadas, aperturas) modifica la letra.** El diseño futuro (en standby, sesión con Jorge): letra + superíndice numérico 1-9 gris = temperatura/engagement, calculado por el motor desde Perfil>Interacciones; sin señales → sin número. NO implementar nada del superíndice sin spec explícito.
- **Briefing de llamada inminente** (Mi Día y Agenda del closer): 2-3 líneas generadas por el motor — quién es · de dónde vino · qué le importa/objeción (de la calificación y el chat) — SOLO de eventos reales, más la línea de estado del video pre-call.
- **Video pre-call**: vive SOLO en 3 vitrinas — línea del briefing · campo en Perfil>Interacciones con procedencia · eventos en Historial. Sin icono propio, sin flag, y NUNCA modifica el score.

## 10. El menú + del compositor (enlaces)

Mezcla dos fuentes y agrupa por secciones, en este orden:

1. **Categorías del catálogo central** según el rol del usuario logueado (closers ven pagos; setters ven low-ticket y agendamiento): `ENLACES DE PAGO` · `LOW-TICKET` · `RECURSOS` (+ categorías creables por el admin). Cada entrada muestra **etiqueta + monto + procesador** (nunca solo el monto). Categorías sin enlaces visibles para ese rol no se renderizan.
2. **Secciones fijas:** `REAGENDA` (dos entradas: "Elegir horario yo" — selector de slots / "Que elija el contacto" — envía el custom field Link reagenda de SU cita) · `MI CALENDARIO` ("Mi link para agendar" = el enlace PERSONAL del usuario logueado, desde Ajustes > Mi Cuenta) · `VIDEOLLAMADA` ("📹 Link del Meet" = la URL de la videollamada de la **cita existente** del contacto, extraída automáticamente; NUNCA se genera un Meet suelto; sin cita futura con meeting location, la sección no se renderiza).

**Enlaces = dos capas:** catálogo central (compartidos, gestiona el admin en Ajustes>Administración, con scope por rol) + enlaces personales (Mi Cuenta de cada usuario). Los tres links del circuito de citas no se confunden: booking link (fijo, del closer, custom value en GHL) ≠ link del Meet (nace con cada cita, vive en el appointment) ≠ link de reagenda (nace con cada cita, se copia al custom field del contacto).

## 11. Setter vs Closer — la simetría del producto

| | **Setter** | **Closer** |
|---|---|---|
| Territorio | PRE-agenda (entrada → cita) | POST-agenda (cita → venta) |
| Copiloto IA | Lead Flow (texto + voz) | Appointment Flow (texto + voz) |
| Su "ganado" | Agendado (won, $0) y LT vendido (won, con monto) | GANADO (el monto HT vive solo aquí) |
| Su columna 🔥 | Calificado sin agendar | Cierre en curso |
| Secciones exclusivas de Mi Día | Estancadas (por reloj — la pre-agenda no tiene fechas ancladas) y Oportunidades LT | Registro pendiente (calls sin resultado) |
| Comisión | Base fija + diferida por agendas hands-on→Venta + LT por autoría | % sobre ventas (config en Administración) |
| Al agendar | El contacto SALE de todas sus colas automáticamente | El contacto ENTRA a su territorio |

Regla de traspaso: setter→closer es el MISMO contacto cambiando de etapa — cero reseteo de datos (📞 acumulativo, perfil, historial continúan); solo cambian de dueño las tareas. Las urgencias se rutean por etapa: pre-agenda→setter, post-agenda→closer.

## 12. Píldoras y subcategorías (qué indica cada una)

**Píldora = la situación REAL del contacto** (stage + subcategoría cuando aplica), en mayúsculas dentro del chip. Nunca es una condición temporal: el estancamiento o el vencimiento se comunican con tinte ámbar/rojo de fila + línea de estado, jamás como píldora.

- **Territorio setter:** `EN CALIFICACIÓN · PARCIAL 3/8` · `CALIFICADO SIN AGENDAR` · `DERIVADO A LT` · `LOW-TICKET · VENDIDO $97` · `SEGUIMIENTO · PARA AGENDAR` (o · PARA DECISIÓN LT, automático — ⏱ encendido) · `SEGUIMIENTO — 12 JUL` (manual, sin ⏱) · `NURTURE · SIN RESPUESTA` (o · PIDIÓ TIEMPO / · SE ENFRIÓ) · `AGENDADO` · `DESCALIFICADO`.
- **Territorio closer:** `AGENDADO · 08 JUL` · `SEGUIMIENTO · RE-ENGANCHE` (automático — ⏱ encendido) · `SEGUIMIENTO — 12 JUL` (manual, sin ⏱) · `ACORDÓ COMPRAR · $500` (etapa Cierre en curso) · `VENTA · $3.000` · `NO-SHOW · PLANTÓN` (o la subcategoría que sea) · `NURTURE`.

**Subcategorías y qué dispara cada una** (la subcategoría decide la automation — por eso son obligatorias, en chips y sin default):

- **No-show (closer):** Avisó·quiere reagendar → camino reagenda sin recuperación · Plantón·sin aviso → workflow de recuperación · Falla técnica → reagenda inmediata con tono de disculpa · Datos incorrectos → corrección o descalificación.
- **Seguimiento (setter y closer, ver §16.1):** dos grupos mutuamente excluyentes, nunca ambos — **automático** ("el sistema persigue por ti", enciende ⏱): setter → Para agendar (3 toques·5 días) / Para decisión LT (2 toques·3 días); closer → Re-enganche (3 toques·7 días, única opción). **Manual** ("tú lo retomas", sin ⏱): Mañana / En 3 días / 1 semana / Personalizada — genera tarea con fecha, el toque es humano. La vieja subcategoría "Espera info" del setter desapareció, absorbida por Manual.
- **Nurture:** Pidió tiempo → re-contacto programado 30-60 días · Se enfrió → solo contenido.
- **No califica (setter):** Sin capital (semillero LT futuro) / Sin urgencia / No es el perfil / Datos falsos.
- **Venta Low-Ticket:** el PRODUCTO del catálogo es la subcategoría — decide qué onboarding dispara.
- **Venta (closer):** pide monto + forma de pago (la forma "adelanto" queda pendiente de definir su mecánica).

## 13. Ciclos y colas especiales

- **Ciclo de Estancadas (setter):** las genera el reloj (sin avance >6h o calificado-sin-agendar vencido); mutuamente excluyentes con Seguimiento pactado; la fila muestra el contador de rescates ("2º rescate"); enviar el rescate completa la tarea (en WA-con-bot: pausa temporal ~2h y el bot retoma; en IG: toque manual — **pendiente de re-especificar desde que el botón ⏱ del compositor se eliminó, §16.1; no implementar sin definición de Francisco**); **tope 3 rescates** → el sistema lo mueve solo a Nurture ("NURTURE · SIN RESPUESTA", autor `Sistema`); si responde, renace como Respondieron.
- **Buzón general:** mensajes PARA RESPONDER de contactos sin tarea formal activa — el contacto CONSERVA su píldora de situación (el buzón agrupa mensajes, no cambia categorías).

## 14. Flujos de datos clave (causa y efecto)

1. **El origen:** los leads entran por integraciones (Meta Ads, VSL opt-in, Instagram, WhatsApp) o webhooks del CRM. La IA los califica y asigna Score (A/B/C/D) y fuente.
2. **Avanzar → todo el sistema:** registrar una "Venta" en Avanzar dispara: animación (confeti central) y sonido (si está configurado) · mueve la tarjeta en el Pipeline a la columna Venta · actualiza el anillo de progreso y Cash Collected en Inicio · mueve el lead a "Completadas Hoy" en Mi Día · añade la nota al tab Notas · añade el evento al tab Historial.
3. **Menú "+" → Chat:** seleccionar un producto de pago inyecta el enlace formateado en el input del chat.
4. **Ajustes (Catálogo) → Menú "+":** crear una nueva categoría y enlace en Ajustes hace que aparezca instantáneamente en el menú "+" del compositor de los usuarios permitidos por el Scope.
5. **Botón 💡 → Ajustes (Sugerencias):** enviar una sugerencia desde cualquier lugar hace que aparezca en la bandeja del Admin con el chip de la vista exacta (ej. "Pipeline Setter").
6. **Recepción de mensaje → Mi Día:** un nuevo mensaje de un lead lo mueve automáticamente a "Respondieron" o "Buzón General" (si es Setter y no tiene tarea previa), actualizando los contadores del Snapshot al instante.

## 15. Correcciones pendientes de implementar (deuda del frontend)

1. ~~Modal Avanzar→Seguimiento del setter: dinámico...~~ — **hecho** (2026-07-09), y extendido también al closer: ver §16.1.
2. ~~Avanzar del closer: evaluar si se agrega una 6ª salida "Nurture"~~ — **hecho** (2026-07-11): ver §39.2.
3. Eliminar la palabra "cadencia" de toda la UI → "seguimiento automático".
4. Verificar que el 📞 no cuente sales calls (solo llamadas IA) y que existan los flags 🎙/⭐.
5. ~~Diseñar y construir las pantallas de Avanzar para Setter... Setter tampoco tiene su propia store compartida todavía...~~ — **hecho**: pantallas en §16.1/§24.C, store completa en §26.
6. ~~Propagar el resultado de Avanzar al resto de las vistas~~ — **hecho para Closer** (2026-07-09), ver §17.

## 16. Avanzar (closer) — pantallas confirmadas (fuente: capturas de Francisco, 2026-07-09)

Reemplaza cualquier versión anterior de este cuadrante. Navegación en 2 pasos: grid de resultados → pantalla de detalle con flecha atrás (←) y X para cerrar del todo. Al confirmar: se cierra el popup, aparece una notificación elegante (toast), y el contacto queda actualizado (píldora, Historial, Notas). Implementado en `src/views/ContactDrawer.tsx` (`CloserAvanzar`).

**Grid — "¿Cómo termina?"** (kicker "RESULTADO — LLAMADA O CHAT"; subtítulo: "Sirve igual tras una llamada o tras el chat (“ya no me interesa”, “va, lo compro”). Un clic mueve el pipeline y dispara lo que corresponda."). **Son 6 salidas** (Nurture se agregó el 2026-07-11 — ver §39.2; ya NO son 5):

1. **Venta** (verde) — "Pago total · mueve a Ganado" → detalle "Registrar Cierre" / "Ingresa los detalles de la venta": Monto Total ($), Tipo de pago (chips: `Contado` / `Splitwise` / `Buy Now Pay Later` / `Cuotas`), Nota opcional → botón "Guardar Venta".
2. **Acordó comprar, falta pago** (azul) — "Dejó seña · falta el resto" → detalle "Registrar: Acordó comprar, falta pago" / "Ingresa el monto de la seña o promesa": Monto Asegurado (USD), Nota → botón "Guardar acuerdo".
3. **Seguimiento** (violeta) — "Pactar fecha · entra a tu cola" → ~~detalle "Programar Seguimiento"... pantalla de 2 grupos mutuamente excluyentes (automático/manual)~~ **rediseñado el 2026-07-11 a 2 PANTALLAS** (Situación → Modo) — ver §39.1; §16.1 de abajo describe la pantalla "Modo" tal cual sigue, pero ya no es la única pantalla del flujo.
4. **No le interesa** (rojo) — "Mueve a Descalificado · objeción" → detalle "Descalificar Prospecto" / "Selecciona la razón principal": Razón de descalificación (chips: `Precio` / `No es el momento` / `Competencia` / `No califica` / `Otro`), Nota → botón "Confirmar Descalificación". (Corregido 2026-07-11 — antes decía "Perdido"/"Razón de pérdida"; ver §39.5.)
5. **No-show** (ámbar) — "Mueve a No-show · dispara recuperación" → detalle "Registrar No-show" / "Selecciona la razón": Razón del no-show (chips: `Avisó · quiere reagendar` / `Plantón · sin aviso` / `Falla técnica` / `Datos incorrectos`, ya definidas en §12), Nota → botón "Confirmar No-show".
6. **Nurture** (azul) — "No es ahora · a maduración" → detalle "Enviar a Nurture" / "¿Por qué a nurture?": Pidió tiempo / Se enfrió, Nota → botón "Enviar a Nurture". Componente compartido con el Nurture del setter — ver §39.2.

Todas las pantallas de detalle exigen su selección/monto obligatorio antes de habilitar el botón de confirmar (subcategoría/razón sin default). Nota siempre opcional. Esta sección reemplaza cualquier alusión previa a "forma de pago: Transferencia/Tarjeta/Efectivo/Otro" para closer — ese set de opciones no existe; el real es Contado/Splitwise/BNPL/Cuotas.

### 16.1 Modal Seguimiento — rediseño de 2 grupos y eliminación del botón ⏱ del compositor (2026-07-09)

Reemplaza por completo el selector de fecha (setter) y el de fecha+categoría (closer) descritos más arriba. Un solo componente compartido, `SeguimientoScreen` (`ContactDrawer.tsx`), usado por AMBOS roles desde su respectivo Avanzar → Seguimiento — mismo componente, mismo comportamiento, mismos estilos; lo único que cambia entre roles es el contenido del grupo automático.

- **A. El botón ⏱ del compositor desaparece por completo, en todos los roles y vistas.** El compositor queda: menú `[+]` · campo de texto · toggle `🤖` (donde aplique). Con él desaparece también la regla de exclusión ⏱/🤖 que vivía ahí (ya no hay un botón que bloquear). El ícono ⏱ de la fila de estado y del header de la ficha NO se toca — sigue existiendo como indicador de solo lectura de "seguimiento automático activo" (§8); de ahora en más se enciende/apaga ÚNICAMENTE a través de Avanzar → Seguimiento.
- **B. Pantalla única, 2 grupos:**
  - **⚡ Seguimiento automático** ("el sistema persigue por ti"): filas seleccionables con nombre + micro-texto de su serie. Setter → `Para agendar` (3 toques · 5 días) / `Para decisión LT` (2 toques · 3 días). Closer → una sola fila, `Re-enganche` (3 toques · 7 días) — para el contacto que salió de la llamada con "lo voy a pensar" sin pactar fecha.
  - **👤 Seguimiento manual** ("tú lo retomas"): chips de fecha idénticos en ambos roles — `Mañana` / `En 3 días` / `1 semana` / `Personalizada` (📅, con selector de fecha propio).
  - **Mutuamente excluyentes:** elegir una fila automática atenúa (opacity-40, no interactivo) el grupo manual completo, y viceversa. Nunca ambos a la vez.
  - Campo de nota opcional común a ambos grupos, encima del botón Confirmar (deshabilitado hasta que haya una selección válida — fecha elegida si es Personalizada).
- **C. Resultado al confirmar:**
  - **Automático:** píldora `SEGUIMIENTO · {OPCIÓN EN MAYÚSCULAS}` (ej. `SEGUIMIENTO · PARA AGENDAR`, `SEGUIMIENTO · RE-ENGANCHE`) · ícono ⏱ encendido · evento en Historial `"Seguimiento automático · {Opción}"`.
  - **Manual:** píldora `SEGUIMIENTO — {FECHA}` (ej. `SEGUIMIENTO — 12 JUL`) · SIN ⏱ (no hay serie corriendo) · evento `"Seguimiento manual · para el {fecha}"` · tarea que reaparece en la cola de Seguimientos ese día.
  - La vieja subcategoría "Espera info" del setter desaparece — queda absorbida por el grupo Manual.
- **D. Dato demo nuevo:** fila `RICARDO PAZ` en Mi Día del setter (sección Seguimientos) con píldora "Seguimiento agotado — revisar" y microtexto gris "serie completada sin respuesta · hace 1 día" — la tarea que el sistema genera cuando una serie automática termina sin que el contacto responda.
- **E. Nota honesta — Estancadas/IG:** el ciclo de rescates de Estancadas (§13) documentaba "en IG: ⏱ manual" como forma de completar un rescate; como ese botón ya no existe, ese mecanismo quedó sin una vía equivalente definida. No se inventó un reemplazo — pendiente de que Francisco especifique cómo se completa un rescate en IG ahora.
- **F. Closer, cambio de comportamiento:** la categoría del seguimiento (`Falta pago` / `Muy seguro` / `Quiere pensarlo` / `A futuro` / `Otro`) que existía en la pantalla anterior del closer YA NO EXISTE — el nuevo modal es idéntico en estructura al del setter, sin ese campo.

## 17. Fuente única de verdad (Closer) — implementada 2026-07-09

Regla §4.4 ("ninguna vista tiene estado propio; registrar algo actualiza TODAS las vistas al instante") está implementada para el módulo **Closer** vía `src/lib/closerStore.tsx`:

- **`ClosurerProvider`** envuelve `CloserAI()` y mantiene un único `Record<string, ClosurerContact>` (contactos indexados por nombre) + `cockpit` (Cash Collected/Ventas/Comisión, derivados de una base fija + deltas de ventas registradas en la sesión) + `cierreEnCursoMonto` (suma de "Acordó comprar" para el KPI "Sobre la mesa").
- **`useClosurer()`** expone `contacts`, `cockpit`, `openContact`/`closeContact`, `advance(name, input)` y `addNota(name, texto)`. `InicioTab`, `MiDiaTab`, `PipelineTab` y `AgendaTab` leen todos de aquí — no hay arrays estáticos locales por vista.
- **`advance()`** es lo único que muta contactos: al confirmarse un Avanzar (vía `CloserAvanzar` en `ContactDrawer.tsx`) actualiza `stage`/`situacion`/`monto`/`historial`/`notas`, limpia `urgente`/`agenda` (el contacto sale de esas colas) y marca `completedToday` (aparece en la nueva sección "✓ Completadas Hoy" de Mi Día, siempre visible per regla §4.1). Si el `stage` resultante es `"ganado"`, suma el monto a `cockpit.cashCollected`/`ventas` en vivo. `AdvanceInput.cadenciaActiva` (opcional) enciende/apaga el ícono ⏱ del contacto — lo setea `SeguimientoScreen` (§16.1): `true` en la rama automática, `false` en la manual; sin definir, se conserva el valor previo (las demás salidas de Avanzar no lo tocan).
- **Pipeline** agrupa dinámicamente por `stage` (`STAGE_ORDER`/`STAGE_META`); el badge de cada columna = "offset oculto" (contactos del CRM no representados en el demo) + miembros reales, así que una tarjeta que cambia de stage se resta de una columna y se suma a la otra sin tocar el total.
- **`ContactDrawer`** acepta `contact` (closer) y `setterContact` (setter) opcionales — ambos siguen el mismo patrón; si ninguno viene provisto, cae a un estado local demo (red de seguridad, no debería activarse en producción).
- ~~Pendiente natural: aplicar `ClosurerProvider`-equivalente a Setter~~ — **hecho** (`SetterProvider`/`setterStore.tsx`, §26, 2026-07-10).

## 18. Mi Día (Closer) — anatomía confirmada de fila y categorías (2026-07-09)

**Snapshot superior:** "Tareas de Hoy" = Urgentes + Respondieron + Seguimientos de hoy (suma en vivo, no incluye Agenda ni Completadas). Chips clicables: 🔴 "N urgentes" y 🟢 "N completadas" hacen scroll a su sección (`scrollToSection`, ids `midia-*`). Las 3 mini-tarjetas (Intervención urgente / Respondieron / Seguimientos hoy) también son anclas de scroll.

**Estructura inquebrantable de fila** (componente `MiDiaRow` en `CloserAI.tsx`, usado por Urgentes/Respondieron/Seguimientos): Score circular (§9) → Nombre → chip de Fuente (`META ADS`/`VSL OPT-IN`/`📷 IG PROFILE`/`DIRECTO`, campo `fuente` del contacto) → píldora de situación (color de `STAGE_META[stage].pill`) → microtexto gris de evento real (nunca genérico; rojo si está vencido) → iconos de estado (📅 solo si `stage==="agendado"`, 📞 con contador+check/cruz vía `callsIA` y atenuado sin número si es 0, 🤖 verde/rojo vía `botEstado`, ⏱ vía `cadenciaActiva`) → chevron. Urgentes reutiliza la misma fila con `prefix`/`badge`/`highlighted` para conservar "Falla detectada por IA:" y el badge de antigüedad.

**Las 3 categorías de cola** (cada una con 2 contactos demo, sembrados en `closerStore.tsx`):
- **Urgentes** (`urgente`): PEDRO GOMEZ (No-show·Plantón, VSL OPT-IN) y ARIEL MENDEZ (No interesado·Precio, META ADS, destacado/highlighted).
- **Respondieron · Buzón general** (`respondido`): SANTIAGO TORRES (Seguimiento·Muy seguro, META ADS) y CAMILA VEGA (Acordó comprar falta pago·$500, 📷 IG PROFILE).
- **Seguimientos de hoy** (`seguimientoPendiente`, distinto del stage macro "Seguimiento" del Pipeline — son los que vencen/tocan HOY): RODRIGO SILVA (vencido hace 1 día, texto rojo) y VALERIA CASTRO (programado para hoy, texto gris).

Un contacto puede tener más de una de estas banderas a la vez en teoría (no ocurre en el seed actual); `advance()` limpia `urgente`/`agenda` pero **no** limpia `respondido`/`seguimientoPendiente` todavía — pendiente de decidir si Avanzar también debe vaciarlas (probablemente sí, ya que hoy un Avanzar sobre un "Respondieron" no lo saca de esa lista salvo que también tenga `completedToday`, que sí lo oculta vía el filtro `!completedToday`; en la práctica esto ya resuelve el caso porque toda fila filtra por `!completedToday`).

## 19. Agenda de Hoy (Closer) — tarjeta de cita con expand/collapse (2026-07-09)

Implementado en `AgendaTab` (`CloserAI.tsx`), tipo `ScheduleSlot`:

- **Colapsado:** hora a la izquierda · Score + Nombre · píldora de estado de la cita (`estadoCita`: `confirmada` verde / `reprogramada` ámbar / `pendiente` gris, mapa `ESTADO_CITA_PILL`) · chevron para expandir.
- **Expandido** (toggle por tarjeta, estado local `expanded: Set<string>`): Narrativa del Briefing IA (`briefing`, no se renderiza si no existe) · línea de Video Pre-call (`videoPre`, regla dura: `✓ Vio el video pre-call (N%)` en verde si `visto`, `⚠ No vio el video pre-call` en ámbar si no, y el bloque completo no existe en el DOM si `videoPre` es `undefined`) · footer con dos botones: **"Link del Meet"** (primario, teal, `window.open(meetUrl)`) y **"Abrir Ficha"** (secundario, abre el drawer del contacto).
- 6 citas demo con estados variados: Valentina Gómez y Juan Pérez confirmados con video visto (100%/87%), Marta Pérez reprogramada sin briefing, Luis Gómez pendiente con video no visto, Sofia Sánchez confirmada con video parcial (64%), Carmen Gómez confirmada sin briefing (estado vacío legítimo).

## 20. Interacciones detalladas del Closer (2026-07-09)

**Hallazgo importante:** las clases `animate-in`/`fade-in`/`slide-in-from-*`/`zoom-in-*` usadas en TODO el proyecto (mío y de Kevin) nunca generaron CSS real — faltaba el plugin `tailwindcss-animate`. Se instaló (`npm i -D tailwindcss-animate`) y se agregó a `tailwind.config.js` (`plugins: [tailwindcssAnimate]`). Esto arregló retroactivamente todas las animaciones de fade/slide/zoom de modales, drawer y popovers en toda la app, no solo las nuevas.

- **A. Chevron + acordeón real:** el chevron de las tarjetas de "Agenda de Hoy" (tanto el widget de Mi Día como el tab Agenda) ahora es interactivo (antes era estático en el widget de Mi Día) y usa una animación de acordeón real vía CSS `grid-template-rows` (`0fr`↔`1fr` + `overflow-hidden` interior) — no un simple fade, y sin depender de Radix/framer-motion.
- **B. Slots fijos de iconos — 6 iconos, no 5:** `StatusIcons`, `MiDiaRow` y el header del drawer — 📹(meet)/📅/📞/🤖/⏱/💰 están SIEMPRE en el DOM para todos los contactos, sin excepción; solo cambian de color/opacidad (activo vs atenuado). Corregido dos veces el 2026-07-09: (1) una primera versión hacía que 📅 no se renderizara si `stage !== "agendado"` — Francisco confirmó que quiere los iconos siempre visibles, sin excepciones; (2) faltaba el ícono 📹 de videollamada (visible en el widget "Agenda de Hoy" pero ausente en Urgentes/Respondieron/Seguimientos, Pipeline y el header del drawer) — agregado vía prop `meet`/`showMeet` en `StatusIcons` (activo si `contact.agenda` existe); `showMeet={false}` solo en el widget de Agenda de Hoy porque esa fila ya tiene su propio botón de "Unirse"/video dedicado y agregar el ícono genérico ahí lo duplicaría.
- **C. Completadas Hoy:** filas con `opacity-75` (recupera 100% al hover), tono **gris/neutral** (`bg-muted`, no verde) para la píldora y el header de la sección, **nombre con `line-through`** (tachado, para que se reconozca de un vistazo como categoría aparte y no se confunda con tareas activas), y chevron indicando que abren la ficha. Corregido 2026-07-09: la primera versión usaba verde tenue sin tachado; Francisco pidió gris + tachado.
- **D. Header del Drawer:** rediseñado — Score circular `w-10 h-10` junto al nombre (`text-lg font-semibold`) con teléfono en microtexto debajo; fila de iconos de la derecha espejada con las mismas reglas de B, estrictamente de solo lectura (no son botones).
- **E. Perfil > Video pre-call:** nuevo campo `ClosurerContact.videoPreCall` (`{visto, pct?, fecha?, diasSinAbrir?}`); si `visto` → `"87% visto · vía tracking · 05 Jul"` (verde); si no → `"Enviado · sin abrir hace N días"` (ámbar); si no hay dato, el campo entero no se renderiza. Sembrado en JUAN PEREZ (87%, éxito) y RODRIGO SILVA (sin abrir hace 2 días, advertencia).
- **F. Compositor del Chat:** el menú **+** ahora abre un popover real (`ENLACES DE PAGO` con Nombre+Monto+Procesador, `MI CALENDARIO`, `VIDEOLLAMADA` — esta última solo si `contact.agenda` existe) que inserta texto en el mensaje. El toggle **🤖** ahora existe (antes no existía en absoluto): un tap lo apaga si está verde; si está gris, pide confirmación (popover "¿Encender el agente IA?") antes de encenderlo. ~~Todo esto es estado local del componente, no persiste en closerStore~~ — **corregido el 2026-07-10**: para Closer sí persiste en `closerStore` vía `setBotEstado` (ver §25). ~~El botón ⏱ se deshabilitaba con tooltip... (regla de exclusión ⏱/🤖)~~ — **el botón ⏱ del compositor se eliminó por completo el mismo día**, ver §16.1.A.

## 21. Menú + del compositor — catálogo y orígenes de datos (2026-07-09)

Rediseñado en `ContactDrawer.tsx` (`CATALOG`, `CatalogHeader`, `CatalogItem`) siguiendo el orden y estilo exactos de la referencia de Francisco. Orden de secciones (cada header solo se renderiza si tiene ítems): `ENLACES DE PAGO` → `LOW-TICKET` → `RECURSOS` → `REAGENDA` (solo si `contact.agenda` existe) → `MI CALENDARIO` (siempre) → `VIDEOLLAMADA` (solo si `contact.agenda` existe). Cada ítem: etiqueta a la izquierda, `$monto · procesador` a la derecha (nunca solo el monto).

**Tres fuentes de datos distintas (§5 de las notas de Francisco):**

1. **Catálogo central** (`{etiqueta, monto?, procesador, url, scope, categoria}`). En producción vive en **Ajustes > Administración > Catálogo de enlaces**, lo gestiona solo el rol `admin`, y `scope` (`["closer"]`/`["setter"]`/ambos) decide quién lo ve en su menú +. **Construido el 2026-07-10** — ver §30: el `CATALOG` local de este archivo se movió a `settingsStore.tsx`, Ajustes ahora es el CRUD real.
2. **Enlace personal** ("Mi link para agendar"): sale de **Ajustes > Mi Cuenta** (`settingsStore.tsx`, campo `miCuenta.linkPersonal`), único por usuario logueado. **Construido el 2026-07-10** — ver §30.
3. **Enlace dinámico** ("Link del Meet" y Reagenda): 100% contextual al contacto — en producción sale de `contact.appointment.meeting_location` / el custom field de reagenda de GHL. Hoy generamos una URL de ejemplo a partir del nombre del contacto; el gating (mostrar/ocultar la sección) sí es real (`contact.agenda` presente o no). Sigue siendo un placeholder — no forma parte de §30.

**Perfil — regla general de estilo:** todos los labels del tab Perfil (`Field`, "Categoría", "Video pre-call") usan `text-[10px] uppercase tracking-wider text-muted-foreground` — se unificó porque antes "Video pre-call" tenía un estilo de label distinto al resto. Video pre-call: porcentaje en `text-sm font-semibold text-emerald-600` + resto en `text-xs text-muted-foreground` (antes usaba tamaños/pesos menos diferenciados).

**Cero emojis (corregido 2026-07-09):** el menú + usaba 📹 hardcodeado para "Link del Meet" — eliminado. Regla del sistema de diseño: iconografía SIEMPRE de `lucide-react`, nunca emojis sueltos en la UI (los emojis en píldoras/microtextos de otras partes de la app — 🔥, ✓, ⚠ — vienen de specs anteriores de Francisco y se mantienen; esto es específico al menú +). `CatalogItem` ahora tiene `icon = Link2` como default (genérico para pago/low-ticket/mi calendario/reagenda-"que elija"), `CalendarClock` para "Elegir horario yo", `Video` para "Link del Meet". Clases exactas: header `text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1.5 mt-4 first:mt-0`; fila `flex items-center justify-between w-full px-2 py-1.5 rounded-md hover:bg-muted transition-colors text-left cursor-pointer`; ícono `w-4 h-4 mr-2 text-muted-foreground`; etiqueta `text-sm font-medium text-foreground`; metadato `text-xs text-muted-foreground`.

## 22. Intervenciones Urgentes — gating del chat (2026-07-09)

Implementado en `ContactDrawer.tsx` (`ChatTab`) + `closerStore.tsx` (`resolveIntervention`). Cuando `contact.urgente` existe:

- **Banner rojo** arriba del chat, solo informativo (sin botones): "⚠ Intervención requerida. {detail}".
- **Botón de bloqueo** (ancho completo, entre los mensajes y el compositor): empieza deshabilitado/gris "Responde al contacto para poder resolver"; se habilita (verde) recién después de que el humano **envía** un mensaje manual por el compositor normal.
- **Envío de mensajes real** (antes no existía en absoluto): Enter en el textarea o el ícono de avión de papel (reemplaza al micrófono cuando hay texto escrito) agregan el mensaje al historial visible del chat.
- **"Marcar como Resuelto"** llama a `onResolveIntervention` → `resolveIntervention(name)` en la store, que en una sola operación: limpia `contact.urgente` (sale de la cola roja de Mi Día al instante, misma store), pone `botEstado: "activo"` (el toggle 🤖 se sincroniza solo vía `useEffect` sobre `contact.botEstado`, sin acción manual), marca `completedToday: true` (cae a "✓ Completadas Hoy" con tachado, y `Tareas de Hoy`/el chip de urgentes del Snapshot bajan en vivo), y escribe `"Intervención resuelta por Usuario Activo"` en Historial.
- Mientras la intervención sigue abierta, el toggle 🤖 del compositor está deshabilitado (no se puede reactivar el bot a mano — solo se reactiva automáticamente al resolver).
- **`ChatTab` ahora tiene `key={name}`** en `ContactDrawer` — antes, al cambiar de contacto sin cambiar de tab, React no remontaba el componente y el estado local (mensajes, `botOn`, etc.) quedaba pegado del contacto anterior. Corregido para que cada ficha abra con estado limpio.
- ~~Pendiente explícito, no implementado: el vínculo con "Agents Audit"...~~ — **hecho** (2026-07-11): ver §31.

## 23. Mensajes Buzón General (Setter → Mi Día) (2026-07-09)

Implementado en `SetterView.tsx`. Sección nueva entre "Oportunidades low-ticket" y "Seguimientos" dentro de Mi Día, más una 5ª mini-card de snapshot (`grid-cols-2 md:grid-cols-5`) junto a Intervención Urgente/Estancadas/Oportunidades LT/Respondieron.

- **Modelo de datos** (actualizado 2026-07-10, ver §26): `Canal = "whatsapp" | "instagram"` vive en `setterStore.tsx`; Buzón ya no es un array separado (`BUZON_LEADS`) sino `Object.values(contacts).filter(c => c.respondido && !c.completedToday)` — el mismo patrón de flag-por-cola que el resto de Mi Día. `BUZON_COUNTS` (150/30/120) se mantiene como contador de referencia hardcodeado, a propósito — la lista real es una muestra demo, igual que el resto de las colas.
- **Filtro por canal**: 3 chips ("Todos", "WhatsApp", "Instagram") con contador entre paréntesis. Filtran el array ya filtrado por `respondido`, en memoria, sin llamada a red.
- **Distinción visual por canal**: leads de Instagram muestran tag "📷 IG Profile" en vez de la fuente Meta Ads/VSL habitual (Instagram no tiene formulario de fuente, es DM directo).
- **Apertura de ficha**: cada fila usa el mismo `ContactDrawer` que el resto de Setter (`role="setter"`) — desde el 2026-07-10 TODAS las secciones de Mi Día Y Pipeline abren la ficha con datos reales de `setterStore` (§26) — ya no hay contactos "vacíos" (`contact` null) en ningún punto de Setter.

## 24. Correcciones de consistencia Setter/Closer (2026-07-10)

Cuatro correcciones puntuales pedidas por Francisco tras revisar Setter en vivo.

- **A. Todas las filas de Mi Día (Setter) abren la ficha.** Antes, solo Buzón General tenía `onOpen` cableado (`LeadRow` lo recibía pero `Section` no lo pasaba) — Intervenciones urgentes, Conversaciones estancadas, Oportunidades low-ticket y Seguimientos eran filas muertas. `Section` ahora exige `onOpen: (name: string, info?: OpenInfo) => void` y las 4 secciones de `MiDiaTab` lo reciben (`OpenInfo` creció el 2026-07-10 para llevar también `canal`/`botDemo` del toggle 🤖 — ver §25). Pipeline queda fuera de este alcance (no se pidió).
- **B. El círculo con letra es SIEMPRE el score de fit (A/B/C/D, §9), nunca la inicial del nombre.** `BUZON_LEADS` tenía un bug real: usaba iniciales secuenciales del alfabeto ("D","E","F","G","H") sin relación con el avatar/color — p. ej. Martina Oyola tenía `initial: "F"` con `avatar: "rose"` (rose = C/D). Corregido a la letra real coherente con el color (`avatar: "none"` → `initial: "-"`, sin inventar calificación, regla 7 de §4). El resto de las listas (FOLLOWUP_NAMES, Pipeline, Estancadas/Urgentes/Oportunidades) ya usaban la letra correcta — no tenían el bug. Se documentó con un comentario en el tipo `Lead`/`PipelineLead` para que no se repita.
- **C. Grid de Avanzar del Setter rediseñado** (referencia: captura de Francisco, 2026-07-10) — reemplaza el modal genérico anterior (botones de texto plano). Mismo patrón visual que `CloserAvanzar`: `ModalShell` con kicker "RESULTADO — LLAMADA O CHAT", título = **nombre del contacto** (no "Avanzar" genérico), subtítulo "Registra el avance del prospecto en la fase de pre-agenda.", grid 2 columnas de 5 tarjetas con ícono circular + label + descripción (`SETTER_CARDS` en `ContactDrawer.tsx`): Agendó (Calendar, emerald, "Coordinado manualmente") · Venta Low-Ticket (CreditCard, violeta, "Suma a comisiones") · Seguimiento (Clock, ámbar, "Pactar fecha · entra a tu cola") · No califica (UserX, rosa, "Descalifica por perfil") · Nurture (Sprout, azul, "Enfriado · a lista de nutrición"). Las pantallas de detalle (subcategorías/campos/nota) pasaron del layout inline-bajo-el-grid al mismo patrón de navegación de 2 pasos con flecha atrás que usa `CloserAvanzar`/`SeguimientoScreen` — `SetterAvanzarModal` ahora requiere `name` como prop.
- **D. La píldora del header de la ficha es un ESPEJO obligatorio de la píldora de la fila que abrió esa ficha — mismo texto, mismo color.** Bug real encontrado: el header tenía el color hardcodeado en cyan (`bg-cyan-50 text-cyan-700...`) sin importar el contacto, y el teléfono debajo del nombre también estaba hardcodeado a un número fijo de ejemplo (no corregido hoy — fuera del pedido explícito de Francisco, que aclaró que el foco es la píldora, no el teléfono). Corregido en `ContactDrawer.tsx`:
  - **Closer** (con `closerStore`): el header usa `STAGE_META[contact.stage].pill` + `contact.situacion` — el MISMO color/fuente que ya usa `MiDiaRow` en `CloserAI.tsx`. Antes mostraba el texto correcto pero siempre en cyan.
  - **Setter**: en su momento (mismo día) se resolvió con un prop `pill` de solo-lectura threadeado fila→ficha; **superseded por §26** — desde que Setter tiene su propia store, el header simplemente lee `TAG_CLS_BY_TONE[setterContact.situacionTone]` + `setterContact.situacion`, el mismo par color/texto que ya calcula `LeadRow` — un solo mapa de tono (`TAG_CLS_BY_TONE`, en `setterStore.tsx`) alimenta ambas vitrinas, igual que `STAGE_META` hace para Closer.

## 25. Restaurar y reglar el toggle 🤖 del agente IA (2026-07-10)

Spec completa de Francisco ("Restaurar y reglar el toggle 🤖 del agente IA — territorio SETTER", con nota de verificación para closer). El toggle no se estaba renderizando/regulando correctamente en Setter; esto lo reconstruye desde cero con una máquina de estados explícita, compartida por ambos roles.

**A. Dónde vive y modelo de datos.** `BotEstado` (`closerStore.tsx`) reemplaza el viejo binario `"activo"|"pausado"` por 6 valores: `activo` / `pausado_fallo` / `apagado_manual` / `pausa_temporal` / `derivado_lt` / `muerto_postcall`. `botIconVisual(estado)` es la ÚNICA fuente de color+texto+tooltip para AMBAS vitrinas (header/filas de solo lectura Y el toggle del compositor — regla D.7); vive en `closerStore.tsx` para que `ContactDrawer.tsx`, `CloserAI.tsx` y `SetterView.tsx` importen la misma función en vez de reimplementar los colores tres veces.

- **Gating por canal**: `hasBot` se computa en `ContactDrawer` — para Closer, `contact.fuente !== "📷 IG PROFILE"`; para Setter, `setterContact.canal !== "instagram"` (§26: Setter ya tiene store propia, `canal` viaja en el contacto real, no en un prop separado). Sin bot → el toggle no se renderiza (compositor queda `[+] [texto]`), pero el ícono de estado SIGUE en el DOM, atenuado con tooltip "Sin agente IA asignado" (regla de icons-siempre-visibles, §20.B).
- **Setter (con store desde §26)**: los estados nuevos se sembraron en `setterStore.tsx` — **JORGE RUIZ** (Estancadas) → `apagado_manual`, **PEDRO SANCHEZ** (Oportunidades LT, ya tenía la píldora "DERIVADO A LT" — encaje narrativo perfecto) → `derivado_lt`, **SOFIA NUÑEZ** (Buzón) → `pausa_temporal`. El resto de contactos whatsapp quedan en el default `activo`; los de instagram (Martina Oyola, Ignacio Prada, Camila Rossi) no llevan `botEstado` — el `canal` los gatea sin él.
- **Closer (con store)**: nuevos seeds — `PEDRO GOMEZ`/`ARIEL MENDEZ` → `pausado_fallo` (ya eran los casos de Intervenciones Urgentes, solo se renombró el valor); `RODRIGO SILVA` → `apagado_manual`; `ANA MARTINEZ` → `derivado_lt`; `MIGUEL SANCHEZ` (+ `fuente: "META ADS"` agregado) → `pausa_temporal`; `VALENTINA GOMEZ` (+ fuente agregada, `stage: "ganado"`) → `muerto_postcall`. `CAMILA VEGA`/`VALERIA CASTRO` (fuente IG) perdieron su `botEstado` — no tiene sentido que un contacto sin bot tenga un estado de bot.

**B. Acciones manuales — AMBAS piden confirmación.** ~~Asimetría deliberada (apagar = 1 tap sin diálogo)~~ — **revertido el mismo día tras probarlo en vivo**: Francisco pidió que activar Y desactivar muestren diálogo. `ChatTab` ahora tiene 3 variantes de `confirmDialog`: `"apagar"` ("¿Desactivar agente IA? — El agente dejará de responder a este contacto."), `"normal"` ("¿Activar agente IA? — El bot retomará la conversación con este contacto."), `"reforzada"` (sin cambios: derivado_lt, "¿Devolver la conversación al agente HT?"). Las tres terminan en `onBotStateChange` con el evento de Historial correspondiente ("IA apagada" / "IA reactivada" / "IA reactivada (recuperada de low-ticket)").

**C. Estados automáticos.**
- `pausado_fallo`: reutiliza el banner/gating de Intervenciones Urgentes que ya existía (§22) — el toggle queda `disabled`, tooltip "Pausado por fallo — responde al contacto y marca como resuelto". Sale SOLO por "Marcar como Resuelto" (gateado a mensaje manual previo); para Closer eso ya reactivaba el bot en la store (`resolveIntervention`), sigue igual.
- `pausa_temporal`: nueva. Se dispara automáticamente al enviar un mensaje manual mientras `botEstado === "activo"` (`handleSend` en `ChatTab`) — simula al frontend detectando que un humano escribió, ya que no hay backend real. Evento en Historial con autor `"Sistema"` (no "Usuario Activo" — quien "decide" pausar es el sistema, el humano solo escribió un mensaje). Visual: toggle ON con un punto ámbar superpuesto (`bg-amber-400`). **No implementado**: el auto-levante real a las ~2h y el desvío a la cola "Respondieron" si el contacto responde — son eventos de reloj/backend que no existen en este frontend-only demo; están documentados como pendientes, no simulados con timers falsos.
- `derivado_lt`: nueva. Banner morado informativo (sin botón, sin gating — a diferencia del banner rojo de `pausado_fallo`) con el texto fijo "Derivado a low-ticket — el bot se pausó al derivar." Toggle OFF pero clicable → confirmación reforzada (punto B).
- `muerto_postcall`: nueva, solo Closer. El toggle no se renderiza en absoluto (mismo tratamiento que "sin bot"), pero con un tooltip de icono distinto ("IA inactiva — sales call realizada") para diferenciarlo de "nunca tuvo bot". **Alcance honesto**: solo `VALENTINA GOMEZ` (ganado) lo demuestra explícitamente — el resto de contactos en stage `ganado`/`cierre` de la seed original no se auditaron uno por uno para asignarles este estado retroactivamente (no era parte del pedido, que fue "verificar, no rediseñar" para closer); sería una limpieza de datos demo separada si Francisco la pide.

**D. Reglas duras verificadas**: el frontend nunca decide un estado por su cuenta — todas las transiciones pasan por `onBotStateChange`/`handleBotStateChange`, que además escribe SIEMPRE un evento a Historial (autor real: `"Usuario Activo"` en manuales, `"Sistema"` en la transición automática a pausa_temporal). El ícono de header/filas y el toggle comparten `botIconVisual` — no hay dos mapeos de color que puedan desalinearse.

**E. Pendiente explícito**: cómo se completa un rescate de Estancadas en Instagram (§13) sigue sin vía definida desde que el botón ⏱ se eliminó (§16.1.E) — no relacionado a este cambio, solo se re-flagea porque toca la misma zona del compositor.

## 26. Store de Setter, flujo de intervención urgente y "Completadas Hoy" (2026-07-10)

Francisco probó el toggle 🤖 restaurado (§25) en vivo y encontró tres huecos reales: el flujo de "Intervenciones Urgentes" (banner + botón gateado) no existía en Setter aunque sí en Closer; Avanzar en Setter no movía al contacto a "Completadas Hoy" (¡esa sección ni siquiera existía en Mi Día de Setter!); y quiso confirmación tanto para activar como para desactivar el bot (§25.B). Los dos primeros compartían la misma raíz: **Setter nunca tuvo una store compartida** (era la deuda explícitamente anotada desde §15.5/§17/§23) — así que en vez de parchear síntoma por síntoma, se construyó `src/lib/setterStore.tsx`, espejo de `closerStore.tsx`.

**A. `setterStore.tsx` — arquitectura.** `SetterProvider`/`useSetter()` mantienen `Record<string, SetterContact>` (23 contactos, uno por cada persona que antes vivía repartida en `URGENT`/`STALLED`/`OPPORTUNITIES`/`BUZON_LEADS`/`FOLLOWUP_NAMES`/`STAGES` de `SetterView.tsx` — JORGE RUIZ, que antes aparecía DOS VECES con datos ligeramente distintos en Estancadas y en Pipeline, ahora es un solo registro). `SetterContact` reemplaza los campos visuales sueltos (`tags`, `indicators`) por datos crudos + un mapa de tono compartido:
- `stage: SetterStageKey` (`nuevo`/`en_calificacion`/`calificado_sin_agendar`/`low_ticket_ofrecido`/`agendado`/`nurture`/`descalificado` — el pipeline de 7 etapas de §6.B; Pipeline hoy solo renderiza 2 columnas, `en_calificacion` y `agendado`, igual que antes — expandir a las 7 queda pendiente, no se pidió).
- Flags de cola de Mi Día, igual patrón que `ClosurerContact`: `urgente?`, `estancada?`, `oportunidadLt?`, `respondido?` (Buzón), `seguimientoPendiente?`, `completedToday?`.
- `situacion`/`situacionTone` (`SetterTagTone`: source/cyan/violet/amber/emerald/rose) en vez de un array de `tags` — `TAG_CLS_BY_TONE` (nuevo, en `setterStore.tsx` para que tanto `SetterView.tsx` como `ContactDrawer.tsx` lo importen sin depender uno del otro — evita el import circular que se producía al tenerlo en `SetterView.tsx`) mapea tono → clase Tailwind completa.
- `advance(name, input: SetterAdvanceInput)`: mismo comportamiento que `closerStore`'s `advance()` — pisa `stage`/`situacion`/`situacionTone`/`historial`/`notas`/`monto`, limpia `urgente`/`estancada`/`oportunidadLt`, y **siempre marca `completedToday: true`** — esto es lo que hace que CUALQUIER salida de Avanzar en Setter ahora caiga en "Completadas Hoy".
- `resolveIntervention(name)` y `setBotEstado(name, estado, evento, autor?)`: calcados de closerStore.

**B. Iconos de fila ahora dinámicos, no presets.** El viejo sistema `INDICATORS.{urgent,stalled,opportunity,followup,qualifying,scheduled}` (arrays fijos de 5 iconos por "tipo de cola") se eliminó — `ContactIcons` (en `SetterView.tsx`) calcula 📅/📞/🤖/⏱/💰 directamente desde los campos del `SetterContact`, exactamente como `MiDiaRow` ya hacía en `CloserAI.tsx`. Esto también arregla de raíz la regla D.7 del toggle (icono de fila y toggle del compositor comparten fuente) para TODA fila de Setter, no solo las 3 que tenían `botDemo` hardcodeado antes.

**C. "✓ Completadas Hoy" — sección nueva en Mi Día de Setter.** No existía en absoluto (era la causa directa del reporte de Francisco). `CompletadasSection`, calco visual exacto de la versión de Closer (§20.C): `opacity-75`, píldora y header en gris/`bg-muted`, nombre con `line-through`, siempre visible aunque esté vacía (regla §4.1). Verificado con Playwright: resolver la intervención de CARLA MENDOZA o confirmar cualquier salida de Avanzar mueve al contacto ahí en vivo, y el badge de la cola de origen baja en el mismo tick.

**D. Intervenciones Urgentes en Setter — CARLA MENDOZA.** Sembrada con `botEstado: "pausado_fallo"` + `urgente: { detail: "Fallo en webhook de Zapier al validar email..." }`, exactamente el mismo shape que `ARIEL MENDEZ`/`PEDRO GOMEZ` en closerStore. El flujo completo (banner rojo → botón "Responde al contacto para poder resolver" deshabilitado → se habilita tras un mensaje manual → "Marcar como Resuelto" limpia `urgente`, reactiva el bot, marca `completedToday`) funciona igual que en Closer porque `ChatTab` es un componente 100% compartido — no hubo que reimplementar nada ahí, solo darle a Setter datos reales para que lo dispare. Punto de Francisco "asegurate que el botón esté apagado por precaución" queda cubierto automáticamente: `pausado_fallo` siempre resuelve a `botOn = false` en `ChatTab`, sin importar el rol.

**E. `ContactDrawer.tsx` — unificación de props.** `pill`/`canal`/`botDemo` (agregados en §24/§25 como plumbing liviano para un Setter sin store) se eliminaron por completo — quedaban redundantes en cuanto Setter tuvo su propio `setterContact`. Nuevo prop `setterContact?: SetterContact | null`, hermano de `contact?: ClosurerContact | null`; toda variable derivada (`pildora`, `pildoraCls`, `historial`, `notas`, `hasBot`, `botEstado`, `grade`, `agendaActive`, `callsIA`, `cadenciaActiva`, `urgenteDetail`) se computa con una rama por rol en vez de encadenar `??` a ciegas entre closer/setter/local (un encadenado ingenuo `contact?.botEstado ?? setterContact?.botEstado ?? local` sería incorrecto: si `contact` existe pero su `botEstado` es `undefined`, debe caer a `"activo"`, NO seguir buscando en `setterContact`/local). El fallback local (`localPildora`/`localBotEstado`/etc.) se conserva solo como red de seguridad para una invocación futura sin store — ninguno de los dos roles la usa hoy en la práctica.

**F. `AvanzarResult` ampliado**: `setterStage?: SetterStageKey`, `situacionTone?: SetterTagTone`, `agendaFecha?: string`, junto a los ya existentes `stage?: StageKey` (closer). `buildSetterResult()` y `SeguimientoScreen` (cuando se usa desde Setter) llenan los campos de setter; `handleConfirmAvanzar` en `ContactDrawer` decide `onAdvance` vs. `onSetterAdvance` mirando cuál de los dos sets de campos viene poblado.

**G. Pipeline de Setter ahora abre la ficha.** No lo hacía (`PipelineRow` no tenía `onClick` en absoluto, gap preexistente, no introducido hoy). Ahora usa el mismo `onOpenContact` que Mi Día.

**H. Verificado con Playwright, sin regresión en Closer**: Avanzar (Nurture) sobre JORGE RUIZ lo mueve a Completadas Hoy y baja el badge de Estancadas en vivo; resolver a CARLA MENDOZA la mueve también; el toggle simétrico (apagar/activar, ambos con diálogo) funciona en Setter y Closer; Closer registrar una Venta sigue disparando celebración+toast+pill sin cambios.

## 27. Auditoría de derivación de íconos de estado (2026-07-10)

Francisco reportó un "bug de consistencia": contactos demo cuyo tab Llamada mostraba llamadas reales (ej. JUAN PEREZ con 1 sales call + 2 IA contestadas, §28.D/§28) tenían el ícono 📞 en cero. Causa raíz: varios íconos eran campos sueltos seteados a mano (`callsIA: {count, contestada}`) o derivaciones rotas (📅/📹 desde un solo `agenda`/`stage==="agendado"`, bot en Pipeline desde string-matching sobre el texto de la píldora, $ desde el monto crudo sin distinguir promesa de pago real) — violación directa de la regla transversal #4 ("un solo origen de verdad, dos vitrinas"): los íconos deben CALCULARSE de los mismos datos que alimentan los tabs, nunca vivir como campo paralelo.

**A. Orden y derivación fijados** (📹 · 📅 · 📞 · 🤖 · ⏱ · $, la letra de score siempre antes; regla de cero — sin dato, ícono atenuado ~22%, jamás un "0"):
- **📹 Videollamada**: `!!contact.agenda?.meetUrl` (Closer) / `!!contact.agendaMeetUrl` (Setter) — la cita YA tiene sala de Meet. Independiente de 📅.
- **📅 Cita futura**: `!!contact.agenda` (Closer) / `!!contact.agendaFecha` (Setter) — ya NO se deriva de `stage === "agendado"` (un contacto podía estar en ese stage sin tener cita real, ej. PABLO MUÑOZ/LUIS FERNANDEZ en la seed, que ahora correctamente muestran 📅/📹 apagados).
- **📞 Llamadas IA contestadas**: `countCallsContestadas(contact.llamadas)` — cuenta SOLO `origin !== "sales_call"` con `contestada === true`; las sales calls jamás suman aquí. Función nueva, exportada desde `closerStore.tsx`, reusada por Setter.
- **🎙 (flag junto al nombre, NO es parte de la fila de íconos)**: `hasSalesCall(contact.llamadas)` — ≥1 registro con `origin === "sales_call"`. Implementado por primera vez (antes solo documentado en §8/§21, nunca construido); ícono `Mic` de `lucide-react`, nunca emoji.
- **$ Dinero**: gating distinto por rol porque el campo `monto` no significa lo mismo en los dos stores. Closer: `stage === "ganado" ? contact.monto : null` (un "Acordó comprar" también escribe `monto` pero es promesa, no pago real — vive solo en la píldora "ACORDÓ COMPRAR · $500"). Setter: `contact.monto` directo, ya que ahí `monto` solo lo escribe la salida real `venta_lt` de Avanzar (verificado en `buildSetterResult` — ninguna otra rama lo toca), sin necesidad de un flag nuevo.
- **🤖/⏱**: sin cambios de fondo, pero el Pipeline de Closer dejó de inferir el estado del bot con un `situacion.startsWith(...)` sobre el texto de la píldora — ahora lee `contact.botEstado`/`contact.cadenciaActiva` igual que `MiDiaRow`.

**B. Dónde se tocó**: `countCallsContestadas`/`hasSalesCall` viven en `closerStore.tsx` y las reimporta `setterStore`-adjacent code; `AgendaInfo.meetUrl` (closer) y `SetterContact.agendaMeetUrl` (setter) son campos nuevos. Se eliminó `CallsIA`/`callsIA` de ambos tipos de contacto. Se reescribieron: `CallsBadge`/`SalesCallFlag` + `MiDiaRow` + el bloque de íconos del `PipelineTab` en `CloserAI.tsx` (el Pipeline tenía el peor drift y ahora reusa el mismo bloque que Mi Día, 1:1); `ContactIcons`/`SalesCallFlag`/`LeadRow` en `SetterView.tsx` (el ícono 📹 no existía en absoluto en la fila de Setter — se agregó); el header de la ficha y sus variables derivadas (`agendaActive`, `meetActive`, `callsCount`, `salesCallFlag`, `ventaMonto`) en `ContactDrawer.tsx`.

**C. Seed data auditada** (todos los contactos demo, no solo el caso de ejemplo): `SANTIAGO TORRES` y `RODRIGO SILVA` tenían `callsIA` hardcodeado — reemplazado por registros reales en `llamadas` (Santiago: 1 App Flow Voz contestada → 📞 1✓; Rodrigo: 2 Lead Flow Voz NO contestadas → 📞 queda atenuado, cambio de comportamiento intencional, no regresión). `VALENTINA GOMEZ`/`JUAN PEREZ`/`MARTA PEREZ`/`LUIS GOMEZ`/`SOFIA SANCHEZ`/`CARMEN GOMEZ` recibieron `meetUrl` en su `agenda` (copiado del array `SCHEDULE` del tab Agenda, ver gap en §27.D) para que 📹 se encienda junto a 📅. `PABLO MUÑOZ`/`LUIS FERNANDEZ` no se tocaron — sencillamente ya no tienen 📅/📹 falsos-positivos tras el fix de derivación.

**D. Gap conocido, no resuelto en esta pasada**: el tab Agenda dedicado (`CloserAI.tsx`) sigue usando un array `SCHEDULE: ScheduleSlot[]` separado de `ClosurerContact.agenda` para los mismos 6 contactos, con campos más ricos (`estadoCita`, `videoPre.pct`) que nunca se fusionaron con `AgendaInfo`. Fusionar ambas estructuras es una tarea más grande y riesgosa, deliberadamente fuera de alcance aquí — se hizo el fix mínimo (backfill de `meetUrl`) para no bloquear la corrección de íconos. El widget "Agenda de Hoy" de Mi Día (que usa el componente genérico `StatusIcons` con `showMeet={false}`, distinto de `MiDiaRow`) tampoco se tocó — es una vitrina secundaria con su propio botón "Unirse" que ya cubre el caso de uso del Meet.

**E. Verificado con Playwright** (Pipeline, Mi Día y ficha de JUAN PEREZ): el caso de verificación exacto de Francisco se confirma pixel a pixel — 🎙 junto al nombre, 📹 encendido, 📅 encendido, 📞 "2✓", $ atenuado (no ha pagado, solo tiene cita) — igual en la fila de Pipeline y en el header de la ficha; su tab Llamada muestra las 3 llamadas que sustentan ese conteo. PABLO MUÑOZ/LUIS FERNANDEZ confirmados con 📅/📹 apagados. SANTIAGO TORRES confirmado en "📞 1✓". RODRIGO SILVA confirmado con 📞 atenuado pese a tener 2 intentos (ninguno contestado). Sin errores de consola en ninguna pantalla.

## 28. Ajustes al toggle 🤖, Completadas Hoy, y tab Llamadas (2026-07-10)

Cuatro pedidos tras probar §26/§25 en vivo.

**A. Completadas Hoy — la fila NO se resume, se atenúa.** Francisco encontró que tanto la versión de Setter (nueva, §26.C) como la de Closer (histórica, §20.C) recortaban la fila a un mini-resumen (avatar+nombre+UNA píldora+chevron), perdiendo el chip de fuente y la fila completa de iconos. Corregido en ambos: `LeadRow` (Setter, `SetterView.tsx`) y `MiDiaRow` (Closer, `CloserAI.tsx`) ahora aceptan un prop `completed?: boolean` que solo cambia: opacidad de fila (75%→100% en hover), color de la píldora de situación (fuerza `TAG_MUTED`/gris en vez del tono real), y el nombre (`line-through`) — el chip de fuente y TODOS los iconos de estado se siguen renderizando exactamente igual que en una fila activa, con sus valores reales (ej. el ícono 🤖 en verde si el bot quedó activo). `CompletadasSection`/el bloque "✓ Completadas Hoy" de `MiDiaTab` ahora reutilizan estos componentes en vez de tener su propio JSX recortado — una sola fuente de verdad para "cómo se ve una fila", con un solo flag para la variante atenuada.

**B. Notificación de activación del bot — nace desde el ícono del toggle.** Al reactivar el agente (manual o vía "Marcar como Resuelto"), un chip verde "✓ IA activada" aparece flotando sobre el botón del toggle (`absolute bottom-full`, mismo patrón que los popovers de confirmación) y se auto-oculta a los ~2.2s. Implementado con un `useRef` que trackea el `botEstado` anterior dentro de `ChatTab` — dispara en CUALQUIER transición hacia `"activo"`, sin importar el origen (toggle manual o `onResolveIntervention`), así que cubre ambos casos con un solo mecanismo.

**C. Confirmado, no se tocó código**: Agenda de Hoy (widget de Mi Día y tab Agenda dedicado) ya mostraba el briefing de IA con chevron de expand/collapse desde §19 — Francisco pidió confirmación, no una funcionalidad nueva. **Corrección posterior:** aunque el briefing en sí no necesitó cambios, los ÍCONOS de este mismo widget sí tenían el bug de la auditoría de §27 — quedó fuera de esa pasada y se resolvió en §29.

**D. Tab "Llamadas" — implementado por primera vez** (antes `disabled: true`/"próximamente" en `TABS`, §7 solo lo describía conceptualmente). Spec completa de Francisco + 3 capturas de referencia (que se siguieron literalmente donde el prosa y la imagen podían leerse distinto — ej. la imagen no muestra un badge de sentimiento separado del "Resumen de la IA", así que se integró como badge inline junto al label en vez de un elemento nuevo).

- **Modelo de datos**: `CallRecord`/`CallOrigin`/`Sentimiento` — nuevos, en `closerStore.tsx` (compartidos, `setterStore.tsx` los reimporta) — `origin: "sales_call" | "app_flow_voz" | "lead_flow_voz"`, `contestada`, `resultado` (texto ya formateado que sigue a la duración — "Resultado: No interesado" para sales_call, "Contestó · confirmó" para IA), `resumenIA`/`sentimiento` (solo IA contestada), `scoreFinal`/`objeciones`/`puntosFuertes`/`aMejorar` (solo sales_call), `audioUrl` (ausente = sin reproductor). Campo `llamadas?: CallRecord[]` agregado a `ClosurerContact` y `SetterContact`.
- **`CallCard`** (`ContactDrawer.tsx`): colapsada por defecto — chip de origen (violeta fijo para sales_call; verde si la llamada de IA fue contestada, gris/muted si no — el color ES el indicador de estado, no hay un ícono de teléfono separado, siguiendo la referencia visual) + fecha · duración · resultado + chevron. Expandida: sales_call muestra Score Final grande, Objeciones (chips rosa) y Puntos Fuertes (checks verdes) en 2 columnas, A Mejorar (triángulos ámbar) ancho completo, botón "Escuchar grabación"; IA contestada muestra "Resumen de la IA" + badge de sentimiento + párrafo + botón "Escuchar audio" (solo si hay `audioUrl`); IA no contestada muestra únicamente "Sin conexión - Buzón de voz", sin reproductor ni resumen (no hubo conversación que resumir).
- **Estado vacío**: ícono de teléfono grande atenuado + "Sin registro de llamadas" + microtexto — igual al resto de estados vacíos del sistema.
- **Datos demo**: `JUAN PEREZ` (closer) lleva las 3 llamadas EXACTAS de las capturas de referencia (Sales Call 05 Jun · 88/100 · "No interesado"; App Flow Voz 04 Jun · confirmó; Lead Flow Voz 02 Jun · agendó) — verificado pixel a pixel contra las 3 capturas. `SOFIA NUÑEZ` (setter) lleva 2 llamadas de Lead Flow Voz (una contestada con resumen, una no contestada con "Sin conexión - Buzón de voz") para demostrar el caso pre-agenda y el estado sin audio.
- **Pendiente explícito**: la reproducción real de audio no existe (los botones "Escuchar audio"/"Escuchar grabación" son visuales, sin backend de audio) — consistente con que todo el proyecto es frontend-only; el resto de contactos de la seed no llevan `llamadas` (no se auditó uno por uno, sería trabajo de datos demo separado si se pide).

## 29. Widget "Agenda de Hoy" (Mi Día) — cierre del gap de §27.D (2026-07-10)

Francisco probó el caso de verificación de §27 en vivo y encontró que JUAN PEREZ, en el widget "Agenda de Hoy" de Mi Día (no en Pipeline ni en la ficha, que ya estaban correctos), seguía sin mostrar 📹 ni el conteo real de 📞 pese a tener 1 sales call + 2 IA contestadas + Meet en su tab Llamada — exactamente el gap que §27.D había dejado explícitamente sin resolver ("vitrina secundaria... no se tocó").

- **Causa exacta**: el botón dedicado de video (`"Unirse"` para la primera cita, un ícono `Video` suelto para el resto) se renderizaba SIEMPRE, sin mirar `item.agenda.meetUrl` — no había forma de distinguir una cita con sala lista de una sin ella. Y el resto de la fila usaba `<StatusIcons bot={item.agenda!.bot} showMeet={false} />`, que dejaba `phone`/`alarm`/`dollar` en sus defaults (`false`) sin conectarlos jamás a `item.llamadas`/`item.cadenciaActiva`/`item.stage` — el mismo patrón de campo-suelto-en-vez-de-derivación que motivó §27, sencillamente en un archivo que esa pasada no tocó.
- **Fix**: el botón de video/"Unirse" ahora solo aparece activo (y hace `window.open(meetUrl)`) si `item.agenda!.meetUrl` existe; sin sala, se muestra un ícono `Video` atenuado con tooltip "Sin sala de Meet" — nunca desaparece del DOM (regla de los 6 slots fijos, §20.B). El resto de la fila ya no usa el `StatusIcons` genérico — se reemplazó por el mismo bloque `IconSlot`/`Calendar`/`CallsBadge`/`BotIcon`/`AlarmClock`/`DollarSign` que usan `MiDiaRow` y `PipelineTab`, más `SalesCallFlag` junto al nombre — una sola fuente de verdad para "cómo se ve la fila de un contacto", ahora también en este widget.
- **Limpieza**: `AgendaInfo.bot` (el campo suelto que alimentaba el `Bot` viejo) se eliminó de la interfaz y de los 4 contactos que lo tenían en la seed (JUAN PEREZ, MARTA PEREZ, SOFIA SANCHEZ, CARMEN GOMEZ) — el ícono 🤖 ahora lee `item.botEstado`, igual que en todo el resto de la app. El componente genérico `StatusIcons` quedó sin ningún call site tras el fix — se eliminó por completo (código muerto).
- **Verificado con Playwright**: JUAN PEREZ en el widget ahora muestra 🎙 + botón "Unirse" (verde, activo porque tiene `meetUrl`) + 📅 encendido + 📞 "2✓" + 🤖/⏱/$ atenuados (coherente con Pipeline y la ficha) — mismo resultado en las 3 vitrinas. El resto de la agenda (Marta Pérez, Luis Gómez, Sofía Sánchez, Carmen Gómez) muestra el botón de video atenuado con estilo de ícono-apagado consistente con el resto de la fila, ya que ninguno tiene llamadas registradas. VALENTINA GÓMEZ (stage "ganado") muestra $ en verde, confirmando que el gating por stage también llegó a este widget. Sin errores de consola.

## 30. Ajustes real — settings store + conexión con el resto del sistema (2026-07-10)

Francisco pasó la arquitectura completa de Ajustes (Mi Cuenta + Administración, con el detalle de cómo el Catálogo de Enlaces alimenta el menú + del chat) y pidió construirla. `src/views/Ajustes.tsx` era 100% estático (arrays `ENLACES`/`COMISIONES`/`SUGERENCIAS` que no leían ni escribían nada) mientras los mismos datos vivían duplicados a mano en otros archivos (`CATALOG` en `ContactDrawer.tsx`, `META_COMISION` en `CloserAI.tsx`, `comisionPct` horneado en `closerStore.tsx`, el textarea de "Sugerir Mejora" sin destino). Se construyó un store compartido, mismo patrón que `closerStore.tsx`/`setterStore.tsx`.

**A. `src/lib/settingsStore.tsx` (nuevo)** — `SettingsProvider`/`useSettings()`, montado en `App.tsx` envolviendo TODO el árbol (por encima del switch de `view`, a diferencia de `ClosurerProvider`/`SetterProvider` que se remontan por vista) para que sus datos sobrevivan a cambiar de módulo. Contiene: `miCuenta` (`metaComision`, `calendarConectado`, `linkPersonal`, `sonidoVenta`), `comisiones: Record<string, number>` (seed `{"Diego M.": 10, "Ariel C.": 12}`), `catalog: CatalogLink[]` (seed = los 2 links que antes vivían en `ContactDrawer.tsx`), `categorias: string[]` (seed `["Enlaces de pago", "Low-ticket", "Recursos"]`, extensible vía "+ Crear nueva"), `sugerencias: Sugerencia[]`. IDs de seed prefijados `seed-cat-*`/`seed-sug-*` (distinto del prefijo `cat-*`/`sug-*` que usa el contador de creación en vivo) — un bug real apareció en la primera pasada: ambos usaban el mismo prefijo y el primer link creado a mano colisionaba con el id del seed (`cat-1` dos veces, error de React "two children with the same key").

**B. `src/lib/sound.ts` (nuevo)** — `playSaleSound(opt)` sintetiza los 3 sonidos con Web Audio API (`AudioContext`, osciladores para "caja registradora", ráfagas de ruido filtrado para "aplausos", no-op para "silencio") — decisión explícita de Francisco tras preguntarle: no hay archivos de audio en el proyecto (frontend-only, sin backend) así que se sintetiza en vez de depender de assets externos.

**C. Conexiones reales (ya no hay dos copias del mismo dato):**
- `CloserAI.tsx`: `META_COMISION` (constante fija) → `useSettings().miCuenta.metaComision`, alimenta el anillo de Inicio en vivo.
- `closerStore.tsx`: `COCKPIT_BASE.comisionPct` (horneado, 10% fijo) → `ClosurerProvider` ahora lee `useSettings().comisiones["Diego M."]` (constante `CURRENT_CLOSER_NAME`, el closer activo del demo) — cambiar el % en Administración mueve la comisión de Inicio al instante.
- `ContactDrawer.tsx`: el menú + ya no lee un `CATALOG` local — lee `useSettings().catalog`/`categorias` con el mismo filtro `scope.includes(role)` de siempre; "Mi link para agendar" usa `miCuenta.linkPersonal`. Al confirmar cualquier Avanzar con `celebrate: true`, además del confetti se llama `playSaleSound(miCuenta.sonidoVenta)`. La rama `venta_lt` de `buildSetterResult` (Setter) ganó `celebrate: true` — antes no lo tenía; ahora Setter también dispara confetti + sonido en una Venta Low-Ticket, tal como pide la spec ("Venta" o "Venta LT").
- **Sugerir Mejora (sidebar, `App.tsx`)**: el textarea ahora es controlado y su botón "Enviar" llama `settings.addSugerencia(texto, screenLabel, autor)`. `screenLabel` es un estado nuevo en `App.tsx` alimentado por un callback `onScreenChange` que `CloserAI`/`SetterView` invocan en un `useEffect` sobre su tab interno — Closer manda el label tal cual (`"Mi Día"`, `"Pipeline"`, etc.) y Setter lo sufija con `" Setter"` (`"Pipeline Setter"`), coincidiendo con el ejemplo literal de §14.5 ("chip de la vista de origen, ej. 'Pipeline Setter'"). Vistas sin sub-tabs (Agents Audit, Ajustes) usan directamente el label de `NAV`. `autor` = el rol activo capitalizado (Closer/Setter/Admin) — no hay auth real en el demo.

**D. `Ajustes.tsx` (reescritura completa, mismo layout visual que antes):**
- **Mi Cuenta**: todos los campos atados al store. "Mi meta del mes" solo se renderiza si `role === "closer"` (regla explícita de la spec). Sonido de Venta: 3 botones que además de guardar la preferencia reproducen un preview inmediato (`playSaleSound`), por la nota de §6 ("Sonido de venta con preview").
- **Administración** (`role === "admin"`):
  - *Catálogo de Enlaces*: tabla real + modal de alta/edición (`CatalogModal`, construido en el propio archivo, sin depender de `ModalShell` de `ContactDrawer.tsx`) con los 6 campos de la spec — Categoría tiene un flujo "+ Crear nueva" inline; Scope son 3 checkboxes literales (Closers/Setters/Todos) donde "Todos" es una casilla derivada que marca/desmarca ambas individuales a la vez. Borrar usa confirmación inline ("¿Eliminar? Sí/No"), no `window.confirm`.
  - *Comisiones por Closer*: inputs de % atados 1:1 a `comisiones`.
  - *Sugerencias del Equipo* (`SugerenciasCard`): chip de pantalla clickeable filtra la lista (con botón "Quitar filtro" visible); "Atendida" mueve la sugerencia a un grupo "Atendidas (N)" colapsado al fondo, expandible.

**E. Verificado con Playwright, sin regresión:** cambiar la meta a $1.000 movió el anillo de Inicio a "Meta superada por $2.400" en vivo; cambiar el link personal a una URL de prueba se reflejó de inmediato en "Mi link para agendar" del menú + de un contacto real; un link nuevo con scope `["setter"]` apareció en el + de Setter y NO en el de Closer (y viceversa ya era el comportamiento con los 2 links seed); subir la comisión de Diego M. a 25% cambió la comisión de Inicio de $3.400 a $8.500 (34.000 × 25%); una sugerencia enviada desde Setter > Pipeline apareció con el chip "Pipeline Setter", el filtro funcionó, y marcarla atendida la movió al grupo colapsado; registrar una Venta (closer) y una Venta Low-Ticket (setter) con "Aplausos" seleccionado disparó el confetti + toast + pill en ambos casos sin errores de consola (audio real no verificable en headless, pero `playSaleSound` no lanza excepciones).

## 31. Agents Audit real — store relacional de alertas + wiring bidireccional con Setter/Closer (2026-07-11)

`src/views/AgentsAudit.tsx` era 100% estático (§22): un array `AGENTS` con métricas fijas, badges de alerta sin caso real detrás, banner de "casos graves" sin acción, sin drill-down, sin `ContactDrawer`. Francisco pasó la arquitectura relacional (Agente ↔ Alerta ↔ Contacto: tipos, store, selectores derivados, mutaciones `resolveAlertBySetter`/`diagnoseAlertByTech`) más 5 capturas de referencia (grid → detalle de agente con sparkline de 12 semanas → drawer de grupo de alerta con diagnóstico/bloque de corrección/evidencia paginada).

**A. Grupos, no casos sueltos.** Las capturas muestran los casos agrupados por patrón ("×15 casos", un solo botón "Marcar grupo resuelto" que cierra todos a la vez) — más específico que el tipado plano del spec de texto. Se resolvió así: el store guarda `AgentAlert` atómico (uno por caso, con su propio `contactName`/`timestamp`, fiel al spec), y una función pura exportada `groupAlerts()` los agrupa por `agentId+errorCode` para la UI — un solo lugar de agrupación, consumido tanto por el badge de la tarjeta como por la lista de trabajo del detalle.

**B. `src/lib/agentAuditStore.tsx` (nuevo)** — `AgentAuditProvider`/`useAgentAudit()`, mismo patrón que `closerStore.tsx`/`setterStore.tsx`. Contiene `agents: AgentInfo[]` (los 4 agentes, con las métricas/sentiment/ops que antes vivían en `AgentsAudit.tsx`, más un `history` nuevo de 12 semanas para el sparkline), `alerts: AgentAlert[]`, y `adjustments: AdjustmentEntry[]` (el histórico de ajustes, también movido desde `AgentsAudit.tsx` — se seedea igual que antes pero ahora es estado real, no una constante local).

- `resolveAlertsForContact(contactName)`: pasa a `resolved_by_human` TODAS las alertas `active` de ese contacto — la llaman `CloserAIInner`/`SetterViewInner` desde el mismo `onResolveIntervention` que ya dispara `resolveIntervention()` de su propio store (dos llamadas en el mismo handler; `closerStore`/`setterStore` NO importan `agentAuditStore`, cero acoplamiento nuevo entre ellos).
- `patchAlertGroup(agentId, errorCode)`: pasa TODAS las alertas del grupo a `patched_by_tech` Y ADEMÁS prepende una fila nueva a `adjustments` (fecha "Hoy", agente, categoría, `×N` casos) — "Marcar grupo resuelto" literalmente ES un ajuste, así que el historial se actualiza solo, en vivo, sin duplicar la lógica.
- **"Casos graves" (banner)**: cuenta grupos DISTINTOS con severidad `rojo` que tengan ≥1 alerta `active` — no cuenta casos sueltos. "Verlos" navega al detalle del agente dueño del grupo rojo más antiguo.
- **Seed de alertas** (7 grupos, calibrados para reproducir el banner "3 casos graves" y los badges de las 5 capturas exactamente — verificado pixel a pixel con Playwright): Lead Flow AI → `promesa_vacia_financiamiento` (rojo, ×15, evidencia real de CARLOS RUIZ/ANA SILVA) + `no_detecta_intencion_pago` (rojo, ×9, **incluye a CARLA MENDOZA** — su `urgente.detail` real de `setterStore.tsx` es el diagnóstico) + `respuestas_demasiado_largas` (amarillo, ×22). Appointment Flow AI → `no_detecta_solicitud_pago` (amarillo, **incluye a ARIEL MENDEZ** — su `urgente.detail` real de `closerStore.tsx`, "el usuario solicitó el link de pago pero la IA no lo detectó", encaje semántico exacto). Lead Flow Voz → `corta_antes_tiempo` (rojo, ×5, sin evidencia — reproduce el estado vacío real "Muestra 0 de 5 · No hay ejemplos para mostrar" de la captura). Appointment Flow Voz → sin grupos, sigue "✓ AL DÍA". `casesCount` de cada grupo puede exceder la evidencia realmente seedeada (`makeFillerAlerts` genera el resto sin evidencia detallada) — mismo patrón ya usado para `BUZON_COUNTS` en `SetterView.tsx` (§23), documentado explícitamente, no es un descuido. **`PEDRO GOMEZ`** (closer, también con `urgente`) quedó deliberadamente SIN vincular a ningún grupo — su motivo real ("venía muy seguro · plantó") no encaja semánticamente con ningún patrón técnico de agente, y no todo urgente humano tiene por qué mapear a un bug de IA rastreado; forzar el vínculo habría sido peor que dejarlo suelto.
- **`ANA SILVA`** se agregó como contacto nuevo en `setterStore.tsx` (antes no existía) para que su evidencia en "Promesa vacía — financiamiento" tenga una ficha real que "Abrir Ficha" pueda resolver — mismo criterio que agregar `CARLA MENDOZA` en su momento (§26.D).

**C. `ClosurerProvider`/`SetterProvider` subieron a la raíz de `App.tsx`** (confirmado con el usuario, con el trade-off explicado de antemano). Antes vivían DENTRO de `CloserAI()`/`SetterView()` — se remontaban (perdiendo todo su estado) cada vez que el usuario cambiaba de módulo y volvía, un bug latente que nadie había notado porque ningún flujo de verificación anterior probó ese camino. Ahora viven junto a `SettingsProvider`/`AgentAuditProvider` en `App.tsx` (`SettingsProvider > AgentAuditProvider > ClosurerProvider > SetterProvider > AppInner`), y `CloserAI()`/`SetterView()` son simplemente sus `Inner` renombrados sin wrapper propio. Efecto colateral verificado con Playwright: registrar una Venta en Closer, cambiar a Setter y volver — el Cash Collected sigue reflejando la venta, ya no resetea. Esto es lo que permite que "Abrir Ficha" desde una evidencia de Agents Audit abra la MISMA ficha (con el mismo estado en vivo) que ya se ve en Closer/Setter, en vez de una copia semilla independiente.

**D. `AgentsAudit.tsx` (reescritura)**:
- **Grid**: banner de graves + badges por severidad ahora derivados de `groupAlerts()`, ya no de un campo `alerts?: AlertBadge[]` suelto.
- **`AgentDetailView`**: sparkline de 12 semanas construido con SVG crudo (`<polyline>`) — no se agregó ninguna librería de charts (no había ninguna instalada, confirmado por exploración). El indicador de sentimiento usa un ícono `lucide-react` (`Smile`/`Meh`/`Frown`) en vez de una cara-emoji como en la captura — coherente con la regla de §21 ("iconografía siempre de lucide-react, nunca emojis sueltos en la UI"), un caso donde la regla dura del proyecto pesa más que igualar el pixel de la referencia. Lista de trabajo ordenada severidad (rojo primero) → antigüedad descendente. Historial de ajustes filtrado por agente, con "Ver historial completo" que vuelve al grid (donde vive la tabla completa).
- **`AlertGroupDrawer`**: diagnóstico, bloque de corrección con "Copiar bloque" real (`navigator.clipboard.writeText`), evidencia paginada con "Abrir Ficha" (resuelve el contacto en `useClosurer()`/`useSetter()`, el que exista, y cierra el drawer de alerta antes de abrir la ficha para que no queden dos paneles superpuestos — bug encontrado y corregido en esta misma pasada) y "Ver en GHL" (placeholder, mismo tratamiento que el resto de los links externos del proyecto). Si una alerta puntual dentro del grupo pasa a `resolved_by_human` (vía el flujo de Setter/Closer), su tarjeta de evidencia específica muestra un badge "Salvado por humano" — verificado que NO cambia el estado de las demás alertas del mismo grupo (si 1 de 9 casos se resuelve, el grupo sigue con "9 rojos" hasta que un técnico lo parchea entero).
- Se omitió el botón secundario "Copiar junto con 1 ajuste más" de la captura — no hay un segundo ajuste real vinculado que copiar, y la regla 10 de §4 pide no renderizar texto sin dato real detrás.

**E. Verificado con Playwright, sin regresión**: grid reproduce badges/banner exactos de las capturas; detalle de Lead Flow AI reproduce sus 3 casos + historial; grupo de Lead Flow Voz reproduce el estado vacío de evidencia; resolver a CARLA MENDOZA desde Setter (flujo ya existente, sin tocar) marca SOLO su caso como "salvado por humano" dentro del grupo de 9; "Marcar grupo resuelto" en Lead Flow Voz vació su lista de trabajo, bajó "1 rojos" a "0", subió "resueltos en el período" de 1 a 2, y agregó la fila nueva al historial en vivo; cambiar de Closer AI a Setter y volver ya no resetea el estado de Closer. Sin errores de consola en ninguna pantalla.

## 32. Correcciones a Agents Audit tras revisión en vivo (2026-07-11)

Francisco probó §31 en vivo y pidió 4 ajustes puntuales.

**A. Tooltip interactivo en "Evolución de la tasa"** — el sparkline de §31 dibujaba las 2 líneas pero no tenía hover. Ahora, al mover el mouse sobre el gráfico: línea guía vertical en la semana más cercana, ambos puntos se agrandan (círculo blanco con borde de color), y una tarjeta flotante muestra la semana + "Tasa de trabajo: X%" + "Sentimiento positivo: Y%" — reproduce la referencia de Francisco pixel a pixel. Construido a mano sobre el mismo SVG (sin agregar Recharts ni ninguna librería de charts — se preguntó explícitamente y se optó por no sumar una dependencia nueva dado que el hover se resuelve bien con `onMouseMove` + cálculo de índice más cercano). De paso se implementaron las **"marcas de ajustes"** que el propio §6.D ya pedía desde el principio y nunca se habían construido: puntos violeta sobre la línea de tasa en las últimas semanas, uno por cada ajuste real del agente (`adjustmentCount`) — sin mapeo fecha-exacta→semana (el historial no tiene timestamps semanales), se ubican en las semanas más recientes del rango, que es donde de hecho ocurren los ajustes.

**B. Historial de Ajustes ahora es clickeable** — tanto la tabla global (grid) como la tabla filtrada por agente (detalle) abren un drawer de solo lectura (`AdjustmentDetailDrawer`) con diagnóstico + bloque de corrección aplicado + autor, al hacer clic en cualquier fila. `AdjustmentEntry` ganó los campos opcionales `diagnostico`/`correctionBlock`; las 4 filas semilla (que antes solo tenían título/categoría/autor) recibieron texto real y coherente con su propio issue. `patchAlertGroup` (Marcar grupo resuelto) ahora también copia el diagnóstico/bloque de corrección del grupo hacia la nueva fila que genera — antes esa información se perdía al pasar de "alerta" a "ajuste".

**C. Evidencia de agentes de VOZ — grabación/transcript en vez de bubbles de chat.** El grupo "Corta antes de que el cliente termine" (Lead Flow Voz) mostraba el estado vacío "No hay ejemplos para mostrar" porque nunca se seedeó evidencia de voz. `AgentAlert.evidence` pasó de `{userMsg, aiMsg}` a una unión discriminada `EvidenceChat | EvidenceCall` (`kind: "chat" | "call"`) — `EvidenceCall` reutiliza el mismo shape que `CallRecord` del tab Llamada (§28.D): `duracion`, `resultado`, `resumenIA`, `audioUrl`. El drawer de alerta ahora bifurca su render según `current.kind`: `"call"` muestra duración + resultado + transcript (resumen IA) + botón "Escuchar grabación" (visual, sin backend de audio real — consistente con el resto del proyecto); `"chat"` sigue mostrando las bubbles de siempre. Se creó un contacto nuevo, **`MATEO DIAZ`** (Setter, `setterStore.tsx`), con una `llamada` real de Lead Flow Voz que demuestra el bug exacto ("contestó y la llamada se cortó a mitad de su frase") — contacto nuevo en vez de reusar SANTIAGO TORRES/RODRIGO SILVA (que ya tenían sus conteos de 📞 verificados pixel a pixel en §27/§28, agregarles una llamada más habría corrido ese número documentado).

**D. Dos observaciones de Francisco, confirmadas como límites conocidos del demo (no bugs a corregir ahora):**
- **El conteo de un grupo (ej. "×15 casos") no siempre coincide con la cantidad de ejemplos de evidencia mostrados al paginar (a veces solo 1-2).** Es intencional — mismo patrón que `BUZON_COUNTS` en `SetterView.tsx` (§23): el conteo del grupo es una referencia semilla, la evidencia es una muestra demo. Cuando el motor de Kevin alimente esto con datos reales de Supabase, el conteo será la cuenta real de `AgentAlert` y la evidencia paginará sobre TODOS los casos reales, no una muestra — quedará resuelto solo, sin cambiar la arquitectura del componente.
- **Al abrir "Abrir Ficha" desde una evidencia, la conversación que se ve en el tab Chat de la ficha NO es la misma que la bubble mostrada en la evidencia.** Causa raíz: `ContactDrawer.tsx`'s `ChatTab` usa un único array `SEED_MESSAGES` hardcodeado y compartido por TODOS los contactos (ningún contacto tiene su propio historial de chat individual todavía — es una limitación estructural de todo el proyecto, no algo introducido en Agents Audit). Confirmado con Francisco: es aceptable para el demo, pero **quedará resuelto naturalmente cuando el motor conecte el chat real de cada contacto** (en producción, el tab Chat lee la conversación real de GHL, que por definición incluirá el mismo intercambio que generó la alerta). No se parchea ahora con una solución a medias (ej. hardcodear el mensaje de evidencia dentro de `SEED_MESSAGES` solo movería el problema, ya que ese array es compartido por todos).

**E. Tipos de "Análisis de Sentimiento IA" — guardados, sin UI todavía.** Francisco pasó la interfaz de datos para un futuro indicador de sentimiento/temperatura del lead (`SentimentAnalysis: {status: 'hot'|'warm'|'cold'|'objection', label, context, lastUpdated}`), pidiendo explícitamente que se guarde el tipo pero se omita por ahora la spec de comportamiento/visualización en la UI (Píldoras de Temperatura en Briefing IA y tab Perfil, degradación dinámica del sentimiento). **No implementado** — queda anotado acá para cuando Francisco retome esa spec completa.

## 33. Segunda ronda de correcciones — Agents Audit + banner de Inicio (2026-07-11)

**A. "Abrir Ficha" ya no pierde el contexto del caso.** Antes, al abrir la ficha desde una evidencia, se limpiaba `openGroupKey` (para evitar el bug de dos paneles superpuestos de §31.D) — pero eso significaba que cerrar la ficha (clic afuera) te devolvía a la vista de detalle del agente, no al caso que estabas revisando; había que volver a buscarlo en la lista de trabajo. Corregido: `openGroupKey` ya no se limpia al abrir la ficha — el `AlertGroupDrawer` simplemente deja de renderizarse mientras `ficheName` esté activo (`{openGroup && !ficheName && (...)}`) en vez de perder su estado. Cerrar la ficha (clic en el fondo o la X) revela de nuevo el mismo drawer de grupo, en el mismo caso, sin doble-panel ni pérdida de contexto.

**B. Evidencia de agentes de voz — ahora con flechas de paginación.** El grupo "Corta antes de que el cliente termine" (Lead Flow Voz) tenía un solo ejemplo real (MATEO DIAZ), y las flechas `‹ ›` solo se renderizan si `evidence.length > 1` — con 1 solo ejemplo, no aparecían, a diferencia de los grupos de agentes de texto que ya tenían 2. Se agregó un segundo ejemplo real de grabación/transcript (RODRIGO SILVA, mismo `errorCode`) para que la paginación exista igual que en los agentes de texto. El campo `evidence` de este segundo caso vive únicamente en el `AgentAlert` (no se tocó el `llamadas` real de Rodrigo en `closerStore.tsx`, que ya estaba verificado pixel a pixel en §27/§28) — mismo criterio que MATEO DIAZ.

**C. Banner "tareas pendientes/te esperan hoy" (Inicio) ahora es 100% clickeable.** Antes: en Closer, solo el botón interno "Ejecutar Mi Día" tenía `onClick`; en Setter, la tarjeta YA era un `<button>` completo (con estilos de hover ya preparados) pero **sin ningún `onClick`** — se veía clickeable y no hacía nada. Ambos `InicioTab` ganaron una prop `onGoToMiDia`, provista por `CloserAIInner`/`SetterViewInner` (que ya tienen `setTab`) — clic en cualquier parte de la tarjeta completa (no solo el botón/flecha) navega a Mi Día.

## 34. Regla de negocio: la IA muere para siempre tras la sales call (excepto No-show) (2026-07-11)

Francisco señaló una inconsistencia real en los íconos 🤖 de Mi Día/Pipeline: contactos que ya habían tenido su llamada de ventas con el closer (stage seguimiento/cierre/ganado/descalificado) mostraban el bot en verde (activo) o con estados intermedios (`apagado_manual`, `pausa_temporal`), cuando debería estar completamente muerto. La regla de negocio, tal como la dio Francisco:

> Una vez que el contacto tuvo una llamada con el closer, el agente de IA nunca más puede estar habilitado ni visible en el chat — **excepto si el resultado de Avanzar fue "No-show"**, porque ese resultado dispara un workflow de recuperación automática que necesita a la IA trabajando. Todas las demás opciones de Avanzar (Venta, Acordó comprar falta pago, Seguimiento, No le interesa) demuestran que el contacto ya conversó con el closer → la IA queda muerta para siempre.

**A. `advance()` en `closerStore.tsx` ahora asigna `botEstado` automáticamente**, ya no lo deja intacto:
```ts
const nextBotEstado = isIG ? c.botEstado : input.stage === "no_show" ? "activo" : "muerto_postcall";
```
`"no_show"` → `activo` (reactiva la IA para el workflow de recuperación). Cualquier otro stage resultante → `muerto_postcall` (el ícono se atenúa al 25% y el toggle del compositor deja de renderizarse por completo — lógica ya existente en `ChatTab`, `hasBot && !isMuerto`, sin cambios ahí). Contactos IG (`fuente === "📷 IG PROFILE"`) no tienen bot de por sí (§11) — se excluyen de esta asignación, conservan su `botEstado` (indefinido).

**B. Semántica final por stage** (verificada con Playwright registrando una Venta y un No-show en vivo):
- **Agendado** (pre-call): `botEstado: "activo"` explícito en los 7 contactos semilla — antes varios no tenían el campo, y como `MiDiaRow`/`PipelineTab` pasan `c.botEstado` crudo a `BotIcon` (sin el `?? "activo"` que sí existe en el header de `ContactDrawer.tsx`), se veían atenuados por error. Ahora la semilla es explícita en todos lados — un solo origen de verdad, sin depender de un fallback que solo vivía en un archivo.
- **Seguimiento / Cierre / Ganado / Descalificado** (post-call): todos los contactos semilla pasaron a `botEstado: "muerto_postcall"` — incluye corregir 3 que tenían un estado post-call incorrecto (`SANTIAGO TORRES` estaba en `"activo"`, `RODRIGO SILVA` en `"apagado_manual"`, `MIGUEL SANCHEZ` en `"pausa_temporal"`).
- **No-show**: `botEstado: "activo"` en los 4 contactos "limpios" (`ALFREDO`, `LUCIA FERNANDEZ`, `CARMEN MARTIN`, `CARLOS PEREZ`). **Excepción dentro de la excepción**: `PEDRO GOMEZ` sigue en `pausado_fallo` + `urgente` — el workflow de recuperación de no-show en sí puede fallar, y ahí sí queda pausado esperando intervención humana (no es un estado post-call "muerto", es un problema activo). `ANA MARTINEZ` sigue en `derivado_lt` (otro estado activo válido, sin relación con la regla).
- **`ARIEL MENDEZ`** (descalificado + `pausado_fallo` + urgente): se dejó sin tocar a propósito — tiene un problema técnico activo sin resolver (la IA no detectó una solicitud de pago), y eso es una tercera categoría ("bot activo pero roto, necesita intervención") que la regla de "post-call = muerto" no debe pisar.

**C. Consistencia con el tab Llamadas ("todo tiene que coincidir").** Todo contacto que pasó a `muerto_postcall` en la semilla ahora tiene un registro `sales_call` real en `llamadas` (antes solo `JUAN PEREZ` y `VALENTINA GOMEZ` lo tenían) — así el 🎙 (flag de sales call) y el tab Llamadas de la ficha reflejan la misma historia que el ícono 🤖 y la píldora de stage. `SANTIAGO TORRES`/`RODRIGO SILVA` conservan sus llamadas de IA existentes y ganaron una `sales_call` adicional. **Límite conocido**: si un usuario registra HOY un Avanzar en vivo sobre un contacto que no tenía `llamadas` semilla (ej. `LUIS FERNANDEZ`), su bot muere correctamente pero el tab Llamadas queda vacío — `advance()` no fabrica un registro de llamada (sería inventar un dato que no ocurrió realmente en este frontend-only demo). Aceptado como límite, igual que otros gaps de datos demo documentados en este archivo.

## 35. Corrección: el ícono 📹 es el contador de reuniones con el closer (2026-07-11)

Francisco corrigió una interpretación equivocada mía sobre el ícono de video: **no representa si la cita agendada ya tiene sala de Meet lista** (como se documentó en §27) — representa **cuántas reuniones/llamadas tuvo el contacto con el closer**, exactamente como 📞 cuenta llamadas de IA. Su indicación textual: *"El icono con la cámara representa la llamada con el closer. Si está apagada, o sea sin contraste, es porque aún no se tuvo calls. Si está con su borde marcado y un '1' quiere decir que tuvo 1 call con el closer."*

**A. El flag 🎙 junto al nombre deja de existir por completo.** Esa información (¿tuvo alguna sales call?) ahora la absorbe el propio ícono 📹 — ya no hace falta un segundo indicador redundante. Se eliminaron `hasSalesCall()`, el componente `SalesCallFlag` (en `CloserAI.tsx` y `SetterView.tsx`) y sus 6 puntos de uso (header de ficha, `MiDiaRow`, `PipelineTab`, widget Agenda de Hoy, `LeadRow` de Setter).

**B. Nueva derivación**: `countSalesCalls(llamadas)` (en `closerStore.tsx`, reemplaza a `hasSalesCall`) cuenta los registros con `origin === "sales_call"` en el tab Llamada del contacto — mismo patrón exacto que `countCallsContestadas` para 📞: 0 → ícono atenuado sin número; ≥1 → ícono en color pleno + el número. Aplicado en las 4 vitrinas que ya comparten esta regla (un solo origen de verdad, dos... cuatro vitrinas): header de `ContactDrawer.tsx`, `MiDiaRow`/`PipelineTab`/widget Agenda de Hoy en `CloserAI.tsx`, y `ContactIcons`/`LeadRow` en `SetterView.tsx`.

**C. El campo `agenda.meetUrl` / `agendaMeetUrl` NO se tocó** — sigue existiendo y sigue gatillando el botón real "Unirse"/"Link del Meet" en el widget Agenda de Hoy y en el menú + del compositor (VIDEOLLAMADA), que es una acción funcional distinta (abrir la sala) del ícono de estado de solo-lectura. Antes el widget Agenda de Hoy omitía el ícono de video en su fila (`showMeet={false}`) para no duplicar el botón de Unirse — con el nuevo significado de 📹 (contador histórico de reuniones, no "sala lista para HOY") esa razón para omitirlo ya no aplica, así que el widget ahora también muestra `VideoCallBadge` junto al resto de los íconos, sin quitar el botón de Unirse (son dos cosas distintas: una es la acción de unirse a la cita de hoy, la otra es el conteo histórico de reuniones ya tenidas).

**D. Verificado con Playwright**: `JUAN PEREZ` (1 sales call + 2 llamadas IA contestadas en su tab Llamada) muestra 📹"1" sin flag 🎙, idéntico en la fila de Pipeline y en el header de la ficha — coincide con lo que muestra su tab Llamada, que era exactamente el reclamo de Francisco ("eso debería figurar también en la lista de íconos, que al momento no coinciden aún"). Sin errores de consola.

## 36. Anillo dorado real + Cash Collected animado (Closer > Inicio, 2026-07-11)

Francisco pasó el spec del "Anillo Dorado de Comisiones" y la animación de "Cash Collected". Diagnóstico: el anillo YA estaba construido en SVG pero **nunca reflejó el progreso real** — el círculo de progreso tenía `strokeDasharray="289"` (≈ la circunferencia completa) sin ningún `strokeDashoffset`, así que siempre se dibujaba cerrado al 100% sin importar la comisión real. El Cash Collected y la comisión del centro del anillo eran números estáticos, sin animación.

**Decisión de librería (confirmada con el usuario)**: se instaló `framer-motion` tal como pide el spec — no había ninguna librería de animación en el proyecto (mismo tipo de decisión que Recharts, pero acá el usuario prefirió sumar la dependencia real en vez de reproducirlo a mano).

**A. `GoldRing` (nuevo componente, `CloserAI.tsx`)** — recibe `percentage` ya capado a 100 por el caller (`Math.min((cockpit.comision / miCuenta.metaComision) * 100, 100)`, `0` si no hay meta configurada). Circunferencia real (`2 * Math.PI * 46`), `motion.circle` con `useMotionValue` + `animate()` anima el `strokeDashoffset` desde "vacío" (offset = circunferencia completa) hasta el offset del porcentaje real, `ease: "easeOut"`, 1.8s. Ya no hay ningún valor hardcodeado — si la comisión es 0, el anillo arranca y permanece vacío; si supera el 100% de la meta, el anillo queda completamente cerrado (el texto del centro, sin embargo, siempre muestra el monto real sin capar).

**B. `AnimatedNumber` (nuevo componente, reutilizado 2 veces)** — Cash Collected y la comisión del centro del anillo. `useMotionValue(0)` + `useTransform` formatea el valor en vivo con la misma función `money()` que ya usa el resto de la app (sin duplicar lógica de formato), `animate()` con la MISMA duración (`RING_ANIM_DURATION = 1.8`) que `GoldRing` — ambos terminan de "cargar" exactamente al mismo tiempo, como pedía el spec. Al ser un componente de React normal (no un valor fijo), la animación se dispara de nuevo cada vez que `cockpit.cashCollected`/`cockpit.comision` cambian — verificado registrando una Venta en vivo: el contador y el anillo vuelven a animar desde su valor previo hacia el nuevo total.

**C. Detalle visual**: el Cash Collected ganó un `drop-shadow` dorado sutil (`filter: drop-shadow(0 0 24px rgba(212,175,55,0.35))`) para el "resplandor" que pedía el spec, sin tocar el gradiente de texto que ya existía.

**D. Verificado con Playwright**: captura a los ~400ms muestra el anillo parcialmente dibujado y ambos números a mitad de camino (ej. $18.901 de $34.000); tras ~2.2s ambos terminan asentados en su valor final y el anillo cerrado (meta superada, comisión > meta). Registrar una Venta nueva en vivo reinicia y vuelve a animar ambos, sincronizados, con los totales correctos. Sin errores de consola.

## 37. Persistencia real en Ajustes — "Guardar Cambios" (2026-07-11)

Francisco reportó que todo lo editable en Ajustes (enlace de agendamiento, catálogo de enlaces, comisiones, meta de comisión) se perdía al refrescar la página. Causa raíz: Ajustes vivía 100% en memoria — `settingsStore.tsx` no tenía ninguna capa de persistencia (confirmado que el proyecto entero no usaba `localStorage` en ningún punto hasta ahora). Pidió explícitamente un botón por campo o un botón general de "Guardar"; se implementó la segunda opción.

**A. Guardado explícito, no autosave.** Cada mutador de `settingsStore.tsx` (`setMiCuenta`, `setComisionPct`, `addCatalogLink`/`updateCatalogLink`/`removeCatalogLink`, `addCategoria`, `addSugerencia`, `toggleSugerenciaAtendida`) sigue actualizando el estado en memoria al instante como siempre (la UI reacciona en vivo), pero además marca `hasUnsavedChanges: true`. Nada se escribe a `localStorage` hasta que el usuario aprieta "Guardar Cambios" — así el botón tiene un propósito funcional real, no cosmético, tal como pidió Francisco.

**B. `saveSettings()`** serializa TODO el estado (`miCuenta`, `comisiones`, `catalog`, `categorias`, `sugerencias`) a `localStorage["comando-central:ajustes"]` en un solo blob y limpia `hasUnsavedChanges`. Es un guardado general (todos los campos a la vez), no por-sección — coherente con la opción que Francisco ofreció ("un botón en general de guardar").

**C. Carga**: `SettingsProvider` lee `loadPersisted()` una sola vez al montar y usa el valor persistido como estado inicial de cada uno de los 5 `useState`, cayendo al seed/default original si no hay nada guardado (primera visita, o `localStorage` no disponible). `nextId()` ahora incluye `Date.now()` además del contador incremental — necesario porque un contador que arranca de cero en cada carga de página podía colisionar con IDs ya persistidos de una sesión anterior.

**D. UI (`Ajustes.tsx`)**: barra inferior *sticky* ámbar ("Tenés cambios sin guardar — se perderán si recargás la página" + botón "Guardar Cambios"), visible solo cuando `hasUnsavedChanges` es `true`; al guardar, aparece un toast "Cambios guardados" (mismo patrón visual que el toast de `ContactDrawer.tsx`) y la barra desaparece.

**E. Verificado con Playwright** (contexto de navegador único, `localStorage` limpiado explícitamente al inicio): (1) primera carga muestra el valor semilla (`https://cal.example.com/diego-m`); (2) editar el link + Guardar Cambios + un `reload()` real confirma que el valor editado sobrevive; (3) editar el link DE NUEVO sin guardar + `reload()` confirma que revierte al último valor GUARDADO (no al semilla, no al edit sin guardar) — probando que la barra/botón es un gate funcional real, no decorativo. Sin errores de consola en ningún paso.

## 38. Pipeline del Closer — etapas fantasma en el filtro, cierre de la brecha (2026-07-11)

Francisco reportó que el filtro "Etapa" del Pipeline (closer) ofrecía 7 valores pero solo 5 secciones se renderizaban — faltaban "Cierre en curso" y "Nurture". Causa raíz real, más profunda que solo datos faltantes: (1) el botón "Etapa: Todas" era 100% decorativo — texto hardcodeado, sin `onClick`, sin lista de opciones real; y (2) `StageKey`/`STAGE_ORDER` solo tenían 6 valores (nunca existió `"nurture"` como stage), y el `.map` de secciones hacía `if (rows.length === 0) return null` — una sección con 0 miembros (tras el filtro de grade/destacados) desaparecía del DOM por completo, violando la regla transversal #1 de CLAUDE.md aplicada aquí a nivel de sección, no solo de contador.

**A. `StageKey` ganó `"nurture"`** (`closerStore.tsx`) — séptimo valor, entre `no_show` y `descalificado` en `STAGE_ORDER` (`["agendado","seguimiento","cierre","ganado","no_show","nurture","descalificado"]`). Nuevo tipo `NurtureOrigen = "no_show" | "pidio_tiempo" | "se_enfrio"` y campo opcional `ClosurerContact.nurtureOrigen` — documentan el sub-origen aunque, igual que el resto de la app, la píldora se sigue escribiendo como texto plano en `situacion` (`"NURTURE · NO-SHOW"` / `"NURTURE · PIDIÓ TIEMPO"` / `"NURTURE · SE ENFRIÓ"`), no derivada en render — mismo patrón que toda otra píldora del proyecto. `STAGE_META.nurture` usa tono violeta (dot/pill), sin precedente de color compartido con otra etapa.

**B. 3 contactos demo nuevos en "nurture"**: `SEBASTIAN LARA` (origen no-show — la serie de recuperación automática se agotó sin respuesta; **no** lleva `sales_call` en `llamadas` porque un no-show, por definición, nunca tuvo la llamada — `botEstado: "apagado_manual"`, no `muerto_postcall`, para no mentir con el tooltip "sales call realizada"), `PATRICIA VEGA` y `OSCAR JIMENEZ` (origen pidió-tiempo/se-enfrió — ambos SÍ tuvieron su sales call, así que llevan un registro `sales_call` real en `llamadas` y `botEstado: "muerto_postcall"`, consistentes con la regla de §34).

**C. El filtro "Etapa" ahora es real** (`PipelineTab` en `CloserAI.tsx`): estado `etapaFilter`/`etapaMenuOpen`, dropdown funcional (mismo patrón visual que el menú + del compositor — backdrop `fixed inset-0` + panel `absolute` con `z-20`) que ofrece "Todas" + las 7 etiquetas de `STAGE_ORDER` con su punto de color. Elegir una etapa puntual filtra a esa sola sección; "Todos" (el botón de reset) también limpia `etapaFilter`.

**D. Invariante aplicada en código** ("todo valor que el filtro ofrece DEBE tener su sección — nunca se omite por estar vacía"): `stagesToRender = etapaFilter ? [etapaFilter] : STAGE_ORDER` reemplaza el `STAGE_ORDER.map` directo; se eliminó el `if (rows.length === 0) return null`. Cada sección siempre renderiza su header (con el conteo `hiddenOffset + members.length`, sin cambios); el cuerpo bifurca: tabla si `rows.length > 0`, o un estado vacío de una sola línea si no — con dos mensajes distintos según la causa (`"Sin contactos en esta etapa"` si la etapa está genuinamente vacía, `"Ningún contacto coincide con el filtro seleccionado"` si hay miembros pero el filtro de grade/destacados los excluyó a todos).

**E. Verificado con Playwright**: "Etapa: Todas" muestra las 7 secciones en el orden correcto (Agendado, Seguimiento, Cierre en curso · 🔥 SOBRE LA MESA, Ganado, No-show, Nurture, Descalificado); el dropdown ofrece exactamente esas 7 etiquetas + Todas; filtrar a "Nurture" o "Cierre en curso" muestra solo esa sección con sus contactos reales; combinar el filtro de etapa (Nurture) con el de grade (A, que ninguno de los 3 nurture tiene) muestra el header con su conteo intacto y el mensaje "Ningún contacto coincide con el filtro seleccionado" en vez de desaparecer; "Todos" restaura las 7. Sin errores de consola.

## 39. Correcciones post-pipeline (2026-07-11) — Seguimiento 2 pantallas, Nurture closer, vocabulario, fecha demo

Francisco pasó `CORRECCIONES-VSCode-post-pipeline.md` con 6 correcciones puntuales tras auditar el tool en vivo, además de la corrección de etapas fantasma ya cubierta en §38.

### 39.1 Modal Avanzar → Seguimiento (closer) — rediseño de 2 pantallas (DISEÑO APROBADO)

Reemplaza la pantalla única de §16.1 para el **closer únicamente** (Setter no cambia — sigue igual que §16.1). Nuevo componente `CloserSeguimientoFlow` (`ContactDrawer.tsx`), que antecede a `SeguimientoScreen`:

- **Pantalla 1 — "¿Cómo está el contacto?"** (kicker "Seguimiento"; obligatoria): 5 tarjetas (`CLOSER_SITUACIONES`, componente `OptionCard` nuevo — icono circular + label + descripción, mismo lenguaje visual que el grid de Avanzar) ordenadas de más caliente a más frío: 🔥 **Próximo a pagar** ("Dijo que sí, es cuestión de días", tono emerald) · ⭐ **Muy interesado** ("Quiere, sin fecha de pago aún", amber) · ❓ **Dudando** ("Tiene una objeción sin resolver", violet) · ❄️ **Enfriándose** ("Perdiendo interés, riesgo de fuga", blue) · **Otro** ("Situación no listada", slate — nuevo tono, sin campo de texto). Elegir una tarjeta avanza inmediatamente a la pantalla 2 (no hay botón "Siguiente").
- **Pantalla 2 — "¿Cuándo lo retomas?"** = la `SeguimientoScreen` de siempre (§16.1), con flecha ← que vuelve a la pantalla 1 (limpia la situación elegida). Sin cambios de fondo, salvo que el grupo automático del closer renombró su única fila de **"Re-enganche"** a **"Recupero"** (mismo timing: 3 toques · 7 días) y ahora lleva ícono `Repeat` (antes sin ícono).
- **Píldora resultante**: `SeguimientoScreen` ganó un prop opcional `situacionPill` — cuando el closer lo provee (siempre, vía `CloserSeguimientoFlow`), la píldora final es **SIEMPRE** `SEGUIMIENTO · {SITUACIÓN}` (ej. `SEGUIMIENTO · MUY INTERESADO`), sin importar si el modo fue automático o manual — la fecha de un seguimiento manual queda solo en la 2ª línea (`activity`/microtexto de la fila), nunca en la píldora. Sin `situacionPill` (Setter, sin cambios), el comportamiento sigue siendo el de §16.1 (píldora derivada del modo).
- Datos demo corregidos (violaban esta regla — pills con subcategorías de una taxonomía vieja ya eliminada, ver §16.1.F): `CARLOS RUIZ`/`RODRIGO SILVA` → `Seguimiento · Dudando`; `ELENA MARTIN`/`FERNANDO LOPEZ`/`SANTIAGO TORRES`/`VALERIA CASTRO` → `Seguimiento · Muy interesado`; `DIEGO RODRIGUEZ` → `Seguimiento · Próximo a pagar`.

### 39.2 Nurture — 6ª salida del closer, componente compartido con Setter (DISEÑO APROBADO)

`CLOSER_CARDS` ganó una 6ª tarjeta: **Nurture** ("No es ahora · a maduración", ícono `Sprout`, tono blue) — con esto el grid pasó de 5 tarjetas (con "No-show" ocupando el ancho completo, `span2`) a 6 parejas exactas, así que `span2` se eliminó de "No-show".

Nuevo componente compartido `NurtureScreen` (`ContactDrawer.tsx`) — título "Enviar a Nurture" / subtítulo "No es ahora, pero no está muerto" / label "¿Por qué a nurture?": dos `OptionCard` — ⏳ **Pidió tiempo** ("Quiere, pero no ahora — presupuesto o timing") / ❄️ **Se enfrió** ("Perdió el impulso, sin decir que no"), nota opcional, botón "Enviar a Nurture" (habilita al elegir motivo). Produce `NURTURE · PIDIÓ TIEMPO` / `NURTURE · SE ENFRIÓ`, `stage: "nurture"` (closer, la etapa ya existía desde §38) o `setterStage: "nurture"` (setter, sin cambios).

- **Antes**: el Setter ya tenía Nurture (§3), pero implementado de forma genérica (chips de texto plano vía `SETTER_OUTPUTS`/`Chip`, sin iconos). **Ahora**: tanto Closer (`CloserAvanzar` → `step === "nurture"`) como Setter (`SetterAvanzarModal` → `selectedKey === "nurture"`) interceptan antes de llegar a la lógica genérica y renderizan el mismo `NurtureScreen` — un solo componente, un solo lugar donde viven las 2 subcategorías. `buildSetterResult`'s `case "nurture"` (código muerto tras la intercepción) se eliminó.
- **Microcopy corregido en ambos roles**: la descripción de la tarjeta Nurture decía "Enfriado · a lista de nutrición" (solo cubría "Se enfrió", no "Pidió tiempo") → ahora "No es ahora · a maduración" en `SETTER_CARDS` y en la nueva entrada de `CLOSER_CARDS`.
- La subcategoría "No-show" de Nurture (que existe conceptualmente — ver `NurtureOrigen` en `closerStore.tsx`, §38) sigue sin ser una opción manual en este modal — la aplica el sistema cuando una serie de recuperación se agota (sin implementar aún, ver límite ya documentado en §38 para el ciclo de Estancadas).

### 39.3 Regla de píldora: CATEGORÍA · SUBCATEGORÍA (reforzada con datos reales)

Ya era la regla (§12), pero la auditoría encontró seed data que la violaba con subcategorías de una taxonomía anterior (`Muy seguro`/`A futuro`, del viejo selector de fecha+categoría del closer, eliminado en §16.1.F). Corregido en `closerStore.tsx` — ver lista exacta en §39.1. La segunda línea de la fila (`activity`) sigue siendo síntesis de conversación/estado temporal, nunca dato de Avanzar — sin cambios, ya era así.

### 39.4 Píldoras en mayúsculas — auditado, ya correcto

Francisco reportó píldoras en minúsculas (ej. "No-show · Plantón"). Auditado con Playwright en Pipeline, Mi Día y el header de la ficha (closer y setter): las 3 vitrinas YA aplican `uppercase` vía CSS (`STAGE_META[...].pill` y `TAG_CLS_BY_TONE[...]` en ambos stores incluyen la clase en el 100% de los casos). No se encontró ningún punto de render de píldora sin la clase — **no se requirió ningún cambio de código**; se deja documentado acá para que quede como verificado, no ignorado.

### 39.5 Vocabulario: "Descalificado", nunca "Perdido"/"Pérdida"

Corregido en `ContactDrawer.tsx`: la tarjeta "No le interesa" del grid decía "Mueve a Perdido · objeción" → "Mueve a Descalificado · objeción"; el label del modal de detalle decía "Razón de pérdida" → "Razón de descalificación". Auditado con grep case-insensitive en todo `src/` — sin otras ocurrencias de "Perdido"/"Pérdida" en texto visible (el nombre de variable interno `razonPerdida` no es texto de usuario, se dejó sin tocar).

### 39.6 Bug de fecha demo — "Abierta hace 767 días"

`ARIEL MENDEZ` (urgente, `pausado_fallo`) tenía `daysBadge: "Abierta hace 767 días"` — un valor absurdo para una intervención urgente, que por definición se mide en minutos/horas, nunca en cientos de días. Corregido a `"Abierta hace 40 min"`. Auditado el resto de `daysBadge`/`when` de la seed (`closerStore.tsx`/`setterStore.tsx`) — ningún otro valor es irreal (el máximo es "hace 30 días", en contactos `nurture`/`descalificado`, coherente con esas etapas de cola larga).

### 39.7 Datos demo de Cierre en curso / Nurture (pipeline, §38) — ya cubierto

El pedido de poblar ambas secciones con 2-3 contactos demo coherentes ya se resolvió en §38 (Cierre en curso ya tenía 5 contactos previos a esa corrección; Nurture sumó `SEBASTIAN LARA`/`PATRICIA VEGA`/`OSCAR JIMENEZ`). Nada adicional en esta pasada.

**Verificado con Playwright, todo en un mismo build**: grid del closer muestra 6 tarjetas parejas (sin `span2`) con "Mueve a Descalificado"/"No es ahora · a maduración"; Seguimiento abre la pantalla Situación (5 tarjetas) → elegir "Muy interesado" → pantalla Modo con fila "Recupero" (ícono `Repeat`, "3 TOQUES · 7 DÍAS") → confirmar automático → píldora `SEGUIMIENTO · MUY INTERESADO` + toast "Seguimiento automático activado"; Nurture (closer) con "Se enfrió" → píldora `NURTURE · SE ENFRIÓ` + toast "Nurture registrado"; Nurture (setter, mismo componente) con "Pidió tiempo" → píldora `NURTURE · PIDIÓ TIEMPO`; "No le interesa" muestra "RAZÓN DE DESCALIFICACIÓN" sin rastro de "pérdida" en toda la app; Mi Día ya no muestra "767" en ningún lado. Sin errores de consola en ningún paso.

## 40. Ciclo de vida de tareas en Mi Día (2026-07-11)

Francisco auditó Mi Día en vivo y encontró que no existía ningún mecanismo real para completar tareas al responder — no había botón de completar, "Completadas Hoy" dependía 100% de Avanzar, y el conteo de "tareas pendientes" se mostraba con **tres números distintos** (nav badge / Inicio / header de Mi Día) porque cada vitrina tenía su propia fórmula (o, en el caso del nav badge, un literal hardcodeado). Construido desde cero, compartido por Closer y Setter.

**A. ~~Responder completa la tarea — sin pasar por Avanzar.~~ REEMPLAZADO por el sistema de barra de progreso + FIJAR — ver §43.** El toggle "mantener" del compositor y la acción `replyToTask(name, mantener)` de esta sección ya NO EXISTEN — el mecanismo real es la barra de completado de 5s de §43, con `pinTask`/`completeTask` como acciones separadas. El resto de esta sección (C-F) sigue vigente sin cambios.

**B. ~~Botón "mantener" — posponer el completado.~~ ELIMINADO, ver §43.** Reemplazado por el botón "Fijar Tarea"/"Completar Tarea" de la ficha + la barra de progreso hover-para-fijar. La semántica de fondo (pineado = no se completa, se sube al tope) se mantiene idéntica — solo cambió CÓMO se dispara.

**C. Pineados arriba de su sección, con separador visual.** `respondido` (Closer/Setter) y `oportunidadLt` (Setter) ahora se ordenan pineados-primero (`sort` estable por `pinned`) antes de renderizar; la fila pineada muestra un chip ámbar "📌 Le debes respuesta" y un tinte de fila ámbar (mismo lenguaje visual que el borde rosa de Urgentes, pero en ámbar). Cuando hay al menos un pineado, aparece un separador "SIN ATENDER" justo antes del primer contacto no-pineado — implementado en `MiDiaRow` (Closer, `CloserAI.tsx`), `LeadRow`/`Section`/`BuzonSection` (Setter, `SetterView.tsx`, `Section` ganó un prop opcional `pinnedCount`).

**D. Reaparición ("revive") — demo explícito, no un timer falso.** Si el contacto real vuelve a escribir después de completado, en producción eso llega por el mismo canal que alimenta `respondido` originalmente (webhook/GHL) — no hay uno en este frontend-only demo. Se construyó la acción real `reviveTask(name)` (reabre: `completedToday: false`, `respondido` de nuevo, historial `"Contacto respondió — tarea reabierta"` autor `Sistema`) y, para poder demostrarla y probarla sin inventar un timer falso, `ChatTab` muestra un banner "Tarea completada hoy. [↺ Simular respuesta del contacto]" cuando `isCompletedToday` — un affordance explícitamente etiquetado como demo, mismo criterio que la síntesis de audio de Ajustes (§30.B): cuando la capacidad real no existe en este frontend, se simula de forma honesta y visible, no se omite ni se finge con un timer.

**E. Regla de visibilidad — IA activa nunca genera tarea humana.** Auditados TODOS los contactos con `respondido`/`oportunidadLt`/`estancada`/`seguimientoPendiente` en ambos stores buscando el default implícito `botEstado` sin definir = `"activo"` conviviendo con una tarea humana (contradicción: si el bot está activo, no debería haber una tarea esperando manos humanas). Se encontraron y corrigieron violaciones reales en `setterStore.tsx`: `DIEGO SALAZAR` (Buzón, sin `botEstado`) y las 9 semillas de "Seguimientos" (`FERNANDO LOPEZ`, `ELENA MARTIN`, `MIGUEL RUIZ`, `PEDRO ALVAREZ`, `LAURA ALVAREZ`, `LUIS PEREZ`, `ELENA ROMERO`, `PEDRO MARTINEZ`, `RICARDO PAZ`) — todas ganaron `botEstado: "apagado_manual"` explícito. `SOFIA NUÑEZ` (setter, `pausa_temporal` + `respondido`) se dejó sin tocar a propósito: ese estado nace de un mensaje manual reciente, y tener además `respondido` demuestra el caso legítimo de "el humano ya escribió, el bot se pausó, pero el contacto volvió a escribir" — no es una violación, es el escenario que justifica `reviveTask`.

**F. Contadores unificados — antes 3 números, ahora 1 fuente.** Nuevas funciones puras exportadas `pendingTasksBreakdown(contacts)` (Closer: urgentes + respondieron + seguimientosHoy) y `setterPendingTasksBreakdown(contacts)` (Setter: urgentes + estancadas + oportunidades + respondieron + seguimientosHoy — el Setter tiene una categoría más). Reemplazan:
- Closer: el badge del nav (`TABS`, antes `badge: "7"` hardcodeado) ahora se computa en `Header` vía `useClosurer()`; el título de la tarjeta de Inicio (antes "28 tareas pendientes" literal, con "11 espera" también hardcodeado) ahora usa `tareas.total`/`tareas.respondieron` reales; el header de Mi Día ya tenía la fórmula correcta, ahora llama a la misma función en vez de reimplementarla.
- Setter: `TAB_BADGE = 14` (constante hardcodeada) eliminada — el nav ahora llama a `setterPendingTasksBreakdown()`. `InicioTab` tenía su propia fórmula (urgentes+estancadas+seguimientos, **sin** oportunidades ni respondieron) y `MiDiaTab` tenía OTRA fórmula distinta (urgentes+estancadas+oportunidades+seguimientos, **sin** respondieron) — literalmente los "14 / 12 / 11" que describió Francisco. Ambas ahora llaman a `setterPendingTasksBreakdown()`; el sub-texto de Inicio se reescribió para listar las 5 categorías (solo las que tengan >0, regla de cero de siempre) en vez de 3 fijas.

**Verificado con Playwright (ambos roles, ida y vuelta completa)**: antes de tocar nada, Closer mostraba 6/6/6 (nav/Mi Día/Inicio) y Setter 17/17/17 — ya consistentes tras el fix. Responder a `SANTIAGO TORRES` (Respondieron, closer) sin mantener lo mueve a Completadas Hoy con "Respondió al contacto", baja el badge a 5, y desaparece de Respondieron. Activar "mantener" y responder a `CAMILA VEGA` la pinea arriba de Respondieron con el chip "LE DEBES RESPUESTA" + separador "SIN ATENDER" antes del resto. "Simular respuesta del contacto" sobre `SANTIAGO TORRES` ya completado lo reabre en Respondieron (Completadas Hoy vuelve a 0). En Setter, mantener+responder a `PEDRO SANCHEZ` (Oportunidad LT) lo pinea igual que en Closer; responder sin mantener a `DIEGO SALAZAR` (Buzón) lo completa y el badge baja de 17 a 16. Sin errores de consola en ningún paso.

## 41. Auditoría v2 (2026-07-11) — vertical real, Perfil por significado, y pulido

Segunda pasada en vivo de Francisco (`AUDITORIA-v2-VSCode.md`). Su propio diagnóstico: "el tool está bien construido; lo que falla son los datos de ejemplo y algunos textos que no se adaptan" — así que el grueso de esta sección es limpieza de datos demo, con una excepción arquitectónica real (§41.2, Perfil).

### 41.1 Hallazgo mayor — el demo estaba poblado con datos de otro vertical

Todo el tool tenía datos demo de un negocio **inmobiliario** ("InmoLead AI — Capta 3-4 Propiedades al Mes", "¿cuántas propiedades captas?") cuando el negocio real es **agencias de servicios / high-ticket** (facturación de agencia, capital $4-8k, etapa del negocio — §1). Corregido: `<title>` de `index.html` ("Comando Central — Cierra Más Cuentas High-Ticket con IA"), el disclaimer del footer de Inicio (`CloserAI.tsx`, "InmoLead AI" → "Comando Central"), y el bloque "Formulario Llamada" del tab Perfil (ver §41.2 — ya no es texto hardcodeado de ningún vertical, es dato real por contacto).

### 41.2 Tab Perfil reconstruido — agrupa por SIGNIFICADO, no por rol ni por formulario de origen

Antes, `PerfilTab` (`ContactDrawer.tsx`) era 100% estático: TODOS los contactos mostraban literalmente el mismo teléfono, el mismo correo ("valentina.gomez@ejemplo.com" en la ficha de cualquiera, incluida "Sofia Nuñez" — la causa real del hallazgo C3 de Francisco, que parecía "datos cruzados" pero era simplemente contenido hardcodeado sin ninguna referencia a `contact`) y las mismas 4 preguntas de "Formulario Llamada" inmobiliarias.

Reconstruido según la regla que pasó Francisco: **el Perfil jala TODOS los campos con valor y los agrupa por significado**, sin importar de qué formulario/rol vinieron — un campo de Meta (facturación) + uno de VSL (capital) + uno del agente IA (¿tiene equipo?) caen los tres en el mismo grupo porque los tres miden fit.

- **Nuevo tipo compartido** (`closerStore.tsx`, reexportado por `setterStore.tsx`): `PerfilGroup = "detalles" | "origen" | "calificacion" | "interacciones"` y `PerfilField = { label, value, group, procedencia? }`. `ClosurerContact`/`SetterContact` ganaron `perfil?: PerfilField[]`.
- **`PerfilTab` ya no recibe `contact: ClosurerContact`** — recibe `perfil: PerfilField[]` y `videoPreCall?: VideoPreCallInfo` genéricos, computados en el `ContactDrawer` principal igual que el resto de variables por rol (`contact?.perfil ?? setterContact?.perfil ?? []`). Agrupa los campos por `group`, renderiza SOLO los grupos con al menos un campo (Video pre-call cuenta como parte de "Interacciones" para ese chequeo), y si no hay ningún grupo con datos muestra un estado vacío real ("Sin datos de perfil todavía.") — nunca el contenido hardcodeado de antes.
- **Datos reales sembrados** para una muestra representativa (no los ~50 contactos — sería limpieza de datos separada, mismo criterio que otras muestras parciales del proyecto: `BUZON_COUNTS`, evidencia de Agents Audit): closer → `JUAN PEREZ` (perfil completo, 4 grupos), `VALENTINA GOMEZ`, `ARIEL MENDEZ`; setter → `CARLA MENDOZA`, `PEDRO SANCHEZ`, `SOFIA NUÑEZ` (perfil parcial — solo Calificación/Origen, demostrando la consecuencia que describió Francisco: "en setter el Perfil se ve más vacío... en closer más completo", mismo contacto, misma lógica, solo cambia cuántos campos tienen valor). El resto de contactos, sin `perfil` sembrado, muestran correctamente el estado vacío — no es un bug, es la regla 10 funcionando.
- Preguntas de calificación reales sembradas (vertical agencia/high-ticket): "Etapa del negocio", "Facturación mensual", "Capital disponible", "Principal obstáculo", "¿Tiene equipo?" — con `procedencia` opcional ("vía agente IA", "vía Meta Ads") cuando aporta contexto real, tal como sugirió Francisco.

### 41.3 Módulo Agentes

- **B1 — subtítulo de métrica.** `agentAuditStore.tsx`: "Appointment Flow AI" y "Appointment Flow Voz" medían show-up/confirmación pero decían "agendaron" (texto fijo copiado de Lead Flow AI, que sí mide agenda). Corregido a "se presentaron" y "confirmaron" respectivamente — cada `subtext` sigue siendo texto libre por agente (no se creó una función derivadora), pero ahora coincide con el `goal` real de cada uno.
- **B2 — idiomas mezclados.** Sidebar unificado a español: "Sales Calls Audit" → "Auditoría de Llamadas", "Agents Audit" → "Auditoría de Agentes" (`App.tsx`, `NAV`). Layout del ítem de nav ajustado: cuando un ítem tiene `soon` (Próximamente), el badge ahora va en su propia línea debajo del label en vez de a la derecha en la misma fila — con "Auditoría de Llamadas" (más largo que "Sales Calls Audit") el layout de una sola fila truncaba el label o recortaba el badge; verificado con Playwright que ahora ambos se leen completos.
- **B3 — leyenda del sparkline.** Auditado: ya estaba siempre visible (no solo en hover), sin cambios de código.

### 41.4 Setter — datos demo

- **C1.** Las 8 filas filler de "Seguimientos" + `RICARDO PAZ` mostraban "SEGUIMIENTO · MUY SEGURO" — inválida en dos frentes (esa subcategoría es del closer, y ni siquiera existe ahí desde el rediseño de §39.1). Corregido a las subcategorías reales del setter (`setterStore.tsx`): alternan "SEGUIMIENTO · PARA AGENDAR" / "SEGUIMIENTO · PARA DECISIÓN LT".
- **C2.** `CARLA MENDOZA` mostraba la píldora de pipeline `"URGENCIA"` — la urgencia es un marcador/banner aparte (`urgente: {...}`, ya presente), nunca la píldora de situación. Corregida a `"EN CALIFICACIÓN"` (su stage real), igual que `JORGE RUIZ`; su `urgente` no se tocó — el banner rojo y el flujo de intervención siguen funcionando igual.
- **C3.** Resuelto de raíz por la reconstrucción del Perfil (§41.2) — el email cruzado era contenido hardcodeado, no un dato mal asignado.

### 41.5 Fechas demo — dos entradas futuras encontradas y corregidas

Auditoría §39.6 (767 días) ya estaba resuelta; esta pasada encontró 2 instancias adicionales de la misma familia de bug (evento fechado DESPUÉS de "hoy" = 8 julio): `setterStore.tsx`'s `seedHist()` tenía un evento en `"9 jul, 10:05"` (un día en el futuro) → corregido a `"8 jul, 10:05"`; `ContactDrawer.tsx`'s `NOTAS_SEED` (fallback local, red de seguridad sin contact/setterContact) tenía una nota en `"9 jul, 02:05"` → corregida a `"8 jul, 02:05"`. Auditado el resto de fechas `"NN Jul"` en ambos stores — ninguna otra excede el 05 Jul.

### 41.6 Ajustes — copiar enlace de agendamiento

"Mi enlace de agendamiento" ya tenía el `<input>` real con el valor (contrario a lo que parecía a primera vista) — lo único que faltaba era el botón de copiar. Agregado (`Ajustes.tsx`): botón con ícono `Copy`/`CircleCheck` (feedback 2s) que llama a `navigator.clipboard.writeText`, mismo patrón que el resto del proyecto para acciones sin backend real. Verificado con Playwright leyendo el clipboard tras el click.

### 41.7 Inicio del Closer — guardia defensiva contra "Meta superada" con comisión $0

Francisco reportó cash collected $0 + comisión $0 + "🎉 ¡Meta superada!" simultáneos — contradictorio, porque `cashCollected` siempre parte de `COCKPIT_BASE.cashCollected` ($34,000) y nunca puede ser $0 con los datos semilla actuales (verificado con Playwright en una carga limpia: $34.000/comisión $3.400/"Meta superada por $400", coherente). La única vía real hacia esa contradicción es una comisión % configurada en 0 desde Ajustes (con `metaComision` en 0 o negativo) — un caso de configuración admin, no un bug de datos. Se agregó de todos modos una guardia barata en `InicioTab` (`CloserAI.tsx`): `metaSuperada = falta <= 0 && cockpit.comision > 0` — "Meta superada"/🎉 nunca se muestra si la comisión es $0, sin importar cómo haya quedado configurada la meta.

## 42. Sistema de completar tareas — barra de progreso + FIJAR (2026-07-11)

Francisco pasó `IMPLEMENTACION-Toast-Pin-VSCode.md`, reemplazando por completo el mecanismo de §40.A/B (toggle "mantener" antes de enviar) por un sistema de barra de progreso post-envío. Componente compartido, comportamiento idéntico en Closer y Setter.

**A. La barra (`TaskCompleteBar`, `ContactDrawer.tsx`).** Al enviar un mensaje a un contacto con tarea de conversación activa (`hasReplyTask`: Closer `respondido`; Setter `respondido` U `oportunidadLt`), aparece una barra delgada sobre el compositor:
- **Estado normal**: verde con ✓ centrado, relleno animado (`requestAnimationFrame`, no CSS transition — necesario para poder pausar/reanudar con precisión) que avanza durante 5000ms (`TASK_COMPLETE_BAR_MS`). Al llegar a 100%, llama `onDone(false)` → completa la tarea automáticamente.
- **Hover**: la barra pasa a ámbar, muestra "📌 Fijar tarea", y el `requestAnimationFrame` se cancela (pausa real, no visual) — el tiempo transcurrido se acumula en `elapsedRef` para poder reanudar exactamente donde quedó si el mouse sale sin hacer clic.
- **Clic mientras está en hover**: `onDone(true)` → fija la tarea (no completa). Clic fuera del hover no hace nada (la barra solo reacciona al clic en su estado ámbar).
- La barra NO aparece para contactos de Agenda/Llamadas de hoy porque `hasReplyTask` solo mira `respondido`/`oportunidadLt` — un contacto con `agenda` pero sin esas flags nunca la dispara (verificado con Playwright: `JUAN PEREZ`, agenda hoy, sin botón "Fijar Tarea" ni barra tras responder).

**B. Botón de ficha "Fijar Tarea" / "Completar Tarea"** — junto al nombre en el header (no en el compositor), independiente del envío de mensajes: alterna con un solo clic, sin necesidad de escribir nada. Gris + "📌 Fijar Tarea" cuando no está pineada; ámbar + "📌 Completar Tarea" cuando sí. Mismo patrón que la barra pero como acción directa — cubre el caso "quiero fijar/cerrar esta tarea ahora mismo, sin responder de nuevo".

**C. Store: `pinTask`/`completeTask` reemplazan a `replyToTask`.** Ambas acciones (`closerStore.tsx`/`setterStore.tsx`) son ahora independientes en vez de una función con un booleano `mantener` — `pinTask(name)` solo setea `pinned: true`; `completeTask(name)` setea `completedToday: true, pinned: false` + historial. Los guards (`!c.respondido && !c.completedToday`, etc.) se mantuvieron idénticos a la versión anterior.

**D. "El pin manda" — sin cambios de código, ya funcionaba.** El doc pide que responder a una tarea YA pineada no la des-pinee automáticamente salvo que el usuario deje correr la barra sin fijar de nuevo — esto ya es el comportamiento natural del diseño: enviar un mensaje SIEMPRE muestra la barra (sin importar si ya estaba pineada), y si el usuario no interactúa, completa a los 5s; si vuelve a fijar (hover+clic), se mantiene pineada. No hizo falta lógica adicional para este caso.

**E. Marca visual en listas — ajustada, no rediseñada.** El pin 📌 junto al nombre (ya existía desde §40.C) se separó del chip de texto: ahora el ícono va pegado al nombre (`MiDiaRow`/`LeadRow`) y el chip usa ícono de reloj (`Clock`) en vez de repetir el pin, para diferenciar "esto está fijado" (icono junto al nombre) de "por qué esperar" (chip "Le debes respuesta").

**Verificado con Playwright (Closer y Setter, checklist completo del doc)**: responder a `SANTIAGO TORRES` sin interactuar con la barra → 5s después aparece en Completadas Hoy con el banner "Tarea completada hoy" en la ficha. Responder a `CAMILA VEGA` + hover (ámbar/pin) + clic → NO completa, sube al tope de Respondieron con pin junto al nombre + "Le debes respuesta" + separador "Sin atender"; el botón de ficha pasa a "Completar Tarea" (ámbar); clic ahí la completa sin necesidad de otro mensaje. `JUAN PEREZ` (agenda, sin tarea de conversación) no muestra ni el botón de ficha ni la barra al responder. En Setter, `PEDRO SANCHEZ` (Oportunidad LT) completa igual tras 5s sin interacción — mismo componente, mismo resultado. Viejo botón de pin del compositor confirmado eliminado (cero botones con ícono de pin en la barra de envío). Sin errores de consola en ningún paso.

## 43. Correcciones al sistema toast/pin — v2 (2026-07-11)

Tres bugs encontrados por Francisco tras probar §42 en vivo.

**Bug 1 — el completado dependía de que la barra terminara EN PANTALLA.** Si el usuario enviaba el mensaje y cerraba la ficha antes de los 5s, la tarea nunca se completaba (el `requestAnimationFrame` de `TaskCompleteBar` se cancela al desmontar). Causa raíz: el completado vivía en el propio `onDone(false)` de la barra, que solo dispara si el componente sigue montado. **Corregido invirtiendo el orden de las operaciones**: `handleSend()` ahora llama a `onComplete?.()` de inmediato (síncronamente, al enviar) — la barra de 5s deja de ser el mecanismo de completado y pasa a ser PURAMENTE la ventana visual para deshacer (FIJAR). Si el usuario fija dentro de la ventana (hover+clic), `onPin()` deshace el completado recién ocurrido. Esto obligó a relajar el guard de `pinTask` en ambos stores — antes excluía `completedToday`, ahora necesita poder actuar SOBRE una tarea recién completada para deshacerla (`pinTask` ahora también limpia `completedToday: false` explícitamente).

**Bug 2 — sin autofocus en el compositor.** El input de texto no recibía foco al abrir el tab Chat, pese a que la regla ya existía en CLAUDE.md desde el principio (§7: "Autofocus del compositor al abrir en tab Chat (solo desktop)") — nunca se había implementado. Agregado `textareaRef` + `useEffect` en `ChatTab` que llama `.focus()` al montar, gateado por `window.matchMedia("(min-width: 640px)")` para no disparar el teclado virtual en mobile.

**Bug 3 — el toast/pin solo vivía en Buzón/Oportunidad LT.** El doc de Francisco fue explícito: "una tarea de conversación" no es una propiedad de una sección específica — cualquier cola donde se responde por chat debe completarse igual. Esto **corrige una decisión previa de este mismo proyecto** (§40.A había excluido `seguimientoPendiente` a propósito, razonando que un seguimiento necesitaba pasar por Avanzar — Francisco corrigió ese criterio explícitamente). `hasReplyTask` (`ContactDrawer.tsx`) se amplió:
- Closer: `respondido` **O** `seguimientoPendiente` (antes solo `respondido`).
- Setter: `respondido` **O** `oportunidadLt` **O** `seguimientoPendiente` **O** `estancada` (antes solo los primeros dos).
- Los stores ganaron `hasConversationTask(c)` como el único lugar donde vive esta lista de flags — usado tanto por `pinTask` como por `completeTask`, para que no puedan desalinearse entre sí.
- El pineado-primero + separador "Sin atender" (antes solo en Respondieron/Oportunidad LT) se extendió a Seguimientos (Closer y Setter) y Estancadas (Setter) — mismo patrón, mismo componente (`Section` ganó `pinnedCount` desde §40, ahora también se usa ahí).
- Única excepción confirmada: Agenda/Llamadas de hoy sigue sin el mecanismo (se cierra con Avanzar) — `hasReplyTask` nunca mira el campo `agenda`, así que ya era así por construcción; verificado con Playwright que `JUAN PEREZ` (con cita hoy, sin tarea de conversación) no muestra ni el botón de ficha ni la barra al responder.

**Nota aparte, no implementada**: el ícono de micrófono del compositor sigue sin especificar (recordatorio de la auditoría v2, §41) — pendiente de que Francisco decida si es una feature real o se elimina.

**Verificado con Playwright**: enviar mensaje a `SANTIAGO TORRES` y cerrar la ficha ~200ms después (mucho antes de los 5s) → completado igual, aparece en Completadas Hoy. Autofocus confirmado activo (`document.activeElement` es el textarea) al abrir cualquier ficha en Chat. `RODRIGO SILVA` (Seguimientos de hoy, closer) ahora tiene botón "Fijar Tarea" y barra de completado — fijado dentro de la ventana de 5s lo deja en Seguimientos con el pin junto al nombre, separador "Sin atender", y NO en Completadas (el `completedToday` que se había puesto al enviar quedó correctamente revertido). `JORGE RUIZ` (Estancadas, setter) completa igual que Buzón al enviar y cerrar temprano. Sin errores de consola en ningún caso.

## 44. Coherencia de KPIs — dashboards Closer y Setter (2026-07-11)

Francisco reportó que ambos cockpits de Inicio mostraban números que se contradicen entre sí (ej. "$0 cobrado" conviviendo con "8 ventas registradas"). Diagnóstico real, verificado con Playwright en una carga limpia (`localStorage` vacío):

**A. Closer — YA estaba bien, no se tocó código.** El cockpit del closer (`closerStore.tsx`, `Cockpit`/`COCKPIT_BASE`, §36) ya deriva `comisión = cashCollected × %(Ajustes)`, `falta = metaComision(Ajustes) − comisión`, y el punto de julio del histórico YA es `cockpit.cashCollected` — los 3 checklist items de Francisco para Closer ya se cumplían en una carga fresca ($34.000 / comisión $3.400 / "Meta superada por $400", todo coherente). El "$0" que reportó viene casi con certeza de una configuración de Ajustes editada en una sesión de prueba anterior y persistida vía `localStorage` (§37) — no de un bug de fórmula. Mi Día tampoco muestra ninguna cifra de comisión propia (auditado, no existe ese texto en el código), así que el checklist item "comisión idéntica en Inicio y Mi Día" se cumple por ausencia de una segunda fuente que pudiera desalinearse.

**B. Setter — SÍ tenía el bug real.** `SetterView.tsx`'s `InicioTab` no tenía NINGÚN cockpit — cada tarjeta era un literal suelto ($0, $1,000, 42, 78%, 12, "+12%") sin relación entre sí ni con ningún dataset. Confirmado en vivo exactamente como describió Francisco: "$0 comisión" conviviendo con "Diferidas: $1.000" y "1 ventas directas" con "$0". Se construyó un `SetterCockpit` real (`setterStore.tsx`), espejo del `Cockpit` del closer:
- `SETTER_COCKPIT_BASE` (nuevo): `ltBruto`/`ltVentasCount`, `diferidaBruto`/`diferidaVentasCount`, `agendasAutomaticas`/`agendasGeneradasBase`, y — a propósito — `showRatePct: 78` y `oportunidadesLTBase: 12` como literales de referencia (mismo patrón que `BUZON_COUNTS`, §23): Francisco confirmó explícitamente que esos dos números YA eran coherentes entre sí y pidió no tocarlos; recalcularlos vía división introducía un 79% por redondeo, así que se preservan tal cual en vez de derivarse.
- **Dos tramos de comisión, cada uno parametrizado en Ajustes** (nuevo "Comisiones por Setter" en `settingsStore.tsx`/`Ajustes.tsx`, mismo patrón que "Comisiones por Closer"): `comisionLT = ltBruto × %directa` y `comisionDiferida = diferidaBruto × %diferida`. El hero "Comisiones del mes" = `comisionLT + comisionDiferida` — ya no puede mostrar $0 mientras haya ventas LT o diferidas reales, porque literalmente se calcula sumándolas.
- **"Agendas generadas: 42" se separó en dos tarjetas** ("Agendas automáticas" 33 / "Agendas generadas por ti" 9, suma = 42 sin cambiar el total) — la corrección explícita que pidió Francisco: "el bot agendó solo" no es mérito del setter, solo lo que él rescató lo es.
- **"+12% vs mes pasado" ahora tiene guardia** (`cockpit.comisionTotal > 0`) — mismo criterio que la guardia de "Meta superada" del closer (§41.7): nunca mostrar una comparación porcentual sobre una base de $0.
- **Latch de atribución (`atribucionSetter`)** — campo nuevo en `SetterContact`, implementado tal como lo describió Francisco: se enciende con la PRIMERA intervención manual (`advance`, `resolveIntervention`, `pinTask`, `completeTask`, o un toggle de bot con autor real — nunca "Sistema") y ya no se apaga. Aplicado consistentemente en todos los mutators de `setterStore.tsx`. **Límite honesto, documentado sin rodeos**: el latch existe y es real, pero las "diferidas" del cockpit siguen viniendo de `SETTER_COCKPIT_BASE` (no de una integración en vivo cruzando `closerStore`/`setterStore` para sumar ventas HT reales de contactos marcados) — construir esa integración cruzada es un trabajo de arquitectura mayor (requiere que `ClosurerContact` sepa qué setter originó cada lead) que no estaba pedido explícitamente y excede el alcance de "arreglar la coherencia de los números mostrados". Lo que SÍ es real y en vivo: `advance()` → Venta Low-Ticket suma al bruto LT del cockpit en la sesión actual, y → Agendó suma a "agendas generadas por ti" (todo Avanzar es por definición una intervención manual, así que nunca cuenta como "automática").
- Seed: `JORGE RUIZ` (setter, `apagado_manual` — un humano ya lo apagó a mano, a diferencia de `pausado_fallo`/`derivado_lt` que dispara el sistema) lleva `atribucionSetter: true` desde el arranque, para que el concepto sea inspeccionable sin necesitar una interacción en vivo primero.

**Verificado con Playwright**: carga limpia del Setter muestra $1.100 comisión ($100 LT al 20% + $1.000 diferida al 10%), "1 ventas directas", "2 ventas de closer (sobre $10.000 total)", Agendas automáticas 33 / generadas por ti 9, Show rate 78% (preservado exacto), Oportunidades LT 12 (preservado exacto) — sin ninguna contradicción. Cambiar "% Directa (LT)" de 20% a 50% en Ajustes recalcula Low-Ticket cobradas de $100 a $250 en vivo, sin tocar nada más. Sin errores de consola.

## 45. Dark Mode Premium — sistema de capas por elevación (2026-07-13)

Francisco pasó los "Lineamientos de Arquitectura Visual: Dark Mode Premium" — su propio diagnóstico: *"El secreto de un buen 'Dark Mode' premium (High-Ticket) no es usar negro absoluto en todo, sino crear 'capas de elevación' mediante incrementos sutiles de luminosidad y el uso estratégico de bordes, ya que en fondos oscuros las sombras pierden efectividad."* Causa raíz confirmada leyendo `src/index.css` antes de tocar nada: `--background` y `--card` eran el MISMO valor HSL (`240 10% 3.9%`), y `--border`/`--secondary`/`--muted`/`--accent` eran también idénticos entre sí — cero elevación real, todo pintado del mismo gris. Exactamente el "empasta la interfaz" que describió.

**A. Sistema de 3 niveles, en `.dark` de `src/index.css`** (única fuente de verdad — todo componente que ya use `bg-card`/`bg-popover`/`bg-secondary`/`bg-muted`/`border-border` se beneficia automático, sin tocar una sola clase):
- Nivel 0 (`--background: 240 10% 4%`) — SOLO el lienzo/canvas de scroll principal de cada vista.
- Nivel 1 (`--card`/`--popover`/`--sidebar-background: 240 5% 15%`) — tarjetas, drawer de la ficha, modales de Avanzar, sidebar, toasts, dropdowns: todo panel que "flota" sobre el lienzo.
- Nivel 2 (`--secondary`/`--muted`/`--accent`/`--sidebar-accent: 240 3.7% 22%`) — elementos interactivos DENTRO de una tarjeta (inputs, chips no seleccionados, botones secundarios, hover).
- `--border`/`--input: 240 3.7% 26%` (separadores, más luminosos que Nivel 2 — la separación real la da esto, nunca `drop-shadow`) · `--foreground: 0 0% 98%` (nunca blanco puro) · `--muted-foreground: 240 5% 70%`.
- Exentos a propósito, no tocados: el hero "Tu cockpit" del closer (oscuro+dorado celebratorio fijo, regla §4.11) y los bubbles de chat estilo WhatsApp de `ChatTab` (`#0b141a`/`#005c4b` — paleta intencional, no parte del sistema de elevación neutro).

**B. Bug de "inversión de elevación" — el hallazgo más repetido de la pasada.** Muchos componentes compartidos usaban `bg-background` (Nivel 0) para su estado por defecto, asumiendo (correctamente, en el `.dark` viejo) que se vería igual que su contenedor — al separar los niveles, esos elementos pasaron a verse como un "agujero" más oscuro que la tarjeta/modal/popover donde viven. Encontrados y corregidos vía grep dirigido (`bg-background`, `dark:bg-\[#`, `bg-background/9`) + inspección de cada contexto para distinguir "bug real" de "canvas legítimo":
- `Chip`/`OptionCard` y las 2 grillas de Avanzar (`CLOSER_CARDS`/`SETTER_CARDS`) en `ContactDrawer.tsx` — el componente MÁS usado del proyecto (§7), ahora con `dark:bg-secondary` en su estado no-seleccionado.
- `ModalShell` (toda pantalla de Avanzar) y `Toast`: `bg-background` → `bg-popover text-popover-foreground`.
- El drawer de la ficha (`bg-[#f5f5f7] dark:bg-card`), su header (`bg-card/80`), `PerfilTab`/`HistorialTab`/`NotasTab`, la barra de tabs (pill activa `bg-card`, antes `bg-background` — quedaba MÁS oscura que su propio track `bg-muted/50`, invirtiendo la jerarquía "seleccionado = elevado"), el box de Score Final de `CallCard`, y la fila auto/manual de `SeguimientoScreen`.
- Los 2 drawers laterales de `AgentsAudit.tsx` (`bg-popover`) y sus 2 badges flotantes ("AL DÍA"/conteo de severidad) — estos flotan SOBRE una tarjeta ya-elevada (Nivel 1), así que su fix fue `bg-muted/90` (Nivel 2), no Nivel 0: el mismo bug de inversión pero al revés (demasiado oscuro respecto a su propio padre, no respecto a la página).
- El chip "WhatsApp/Instagram" del Buzón General en `SetterView.tsx` (dentro de un `bg-card`) y todos los `<input>`/`<textarea>`/`<select>` con `border-input` de `ContactDrawer.tsx`/`Ajustes.tsx` (Nivel 2 vía `dark:bg-secondary`, ~30 inputs).
- El botón "Abrir Ficha" del widget Agenda de Hoy en `CloserAI.tsx` (vive dentro de la tarjeta de la cita).

**C. Regla de aplicación — aditivo, nunca reemplazo.** Todo fix se hizo agregando `dark:bg-xxx` sobre la clase existente (light mode intacto por construcción), EXCEPTO donde se confirmó que el valor viejo y nuevo son literalmente el mismo HSL en `:root` (ej. `bg-background`→`bg-card`, `bg-background`→`bg-popover`: en modo claro `--background`/`--card`/`--popover` son los tres blanco puro, cero diferencia visual) — nunca un swap que cambiara algo perceptible en claro. Verificado con Playwright en ambos temas antes de cerrar la tarea (grid de Avanzar, ficha, Buzón General) — cero diferencia en las capturas de modo claro tomadas antes/después.
- **Toolbars de filtro NO se tocaron** (Pipeline closer/setter — "Todos"/"Etapa"/chips A-B-C/Destacados): su wrapper es `bg-muted/10` sobre el lienzo, no una tarjeta — son controles de página, no paneles flotantes; su `bg-background` blende con el lienzo a propósito, mismo patrón en los dos roles.
- **Franjas de fila `bg-background/50` en `LeadRow` de Setter** tampoco se tocaron — es zebra-striping con opacidad (no un panel sólido), un detalle de estilo, no una violación de las 5 reglas.

**D. Nota de herramienta, no del producto**: al verificar con Playwright, el modo `headless` viejo de Chromium (`chromium.launch()` sin flags) renderiza mal cualquier `backdrop-filter: blur()` combinado con `rgba()` — pinta el header de la ficha como blanco puro pese a que el `getComputedStyle` real da `rgba(36,36,40,0.8)` (correcto). Con `chromium.launch({ args: ["--headless=new"] })` el render es fiel. Dejar registrado para cualquier verificación futura con Playwright en este proyecto — no es un bug de la app.

**Verificado (build + Playwright, `--headless=new`, ambos temas):** Closer Inicio/Mi Día/Pipeline, ficha + grid de Avanzar + detalle "Registrar Cierre", Setter Inicio/Mi Día (incluye chips Buzón General), Auditoría de Agentes (grid + badges), Ajustes — sidebar y tarjetas leen como paneles distintos del lienzo con borde visible, chips/inputs no seleccionados leen como Nivel 2, ningún texto en blanco puro. Sin errores de consola en ningún paso. `npm run build` limpio.

## 46. Gerencia — dashboard de dueño/admin, primer build real (2026-07-14)

Francisco pasó `IMPLEMENTACION-Gerencia-VSCode.md` + una referencia visual de 3 páginas (AI Studio) para construir el módulo "Gerencia" (§5/§6 lo tenían como placeholder "Próximamente" desde el principio del proyecto). Principio rector del doc, citado tal cual: *"TODOS los números derivan de un dataset común (contactos + oportunidades + eventos) y de los parámetros de Ajustes... NADA hardcodeado por tarjeta. La prueba: cambiar un parámetro en Ajustes o un dato del dataset recalcula todo el dashboard."*

**A. Arquitectura de datos — decisión explícita, 3 capas distintas.** El dataset de contactos sembrado en este demo (~29 por store) es una muestra, no el volumen real de una agencia (cientos de leads/mes) — no hay 450 contactos reales que contar para reproducir el volumen de la referencia. Se resolvió así, en `src/lib/gerenciaStore.tsx` (nuevo, hook puro `useGerenciaMetrics(period)`, no muta nada):
- **Secciones 1-3 (Volumen, Destino, Eficacia del sistema)**: leen de `GERENCIA_PERIOD_BASE` — una base de referencia POR PERÍODO (mismo patrón exacto que `BUZON_COUNTS`/`SETTER_COCKPIT_BASE` ya usado en el proyecto), con 3 datasets reales (`este_mes`, `mes_pasado`, `ultimos_3_meses`) más `personalizado` (alias de `este_mes`, con una nota honesta de "no conectado" — ver punto E).
- **Sección 4 (Dinero y Retorno)**: HÍBRIDA — revenue/ticket vienen de la base del período, pero **Inversión Meta Ads** y **Objetivo de Facturación** son 100% en vivo desde Ajustes (`useSettings().gerencia`, nuevo). ROAS/CPL/CPA/CPV se recalculan al instante si Francisco cambia esos 2 parámetros. Para períodos más largos que "este mes", la inversión se escala proporcional al volumen de leads de ese período (`inversion × entraron_período/entraron_esteMes`) — proxy razonable en vez de aplicar el mismo monto absoluto a un agregado de 3 meses, lo que rompería el ROAS sin sentido.
- **Sección 5 (Rendimiento del equipo)**: 100% EN VIVO — lee directo de `useClosurer().cockpit` y `useSetter().cockpit`, que YA son reactivos a las comisiones de Ajustes (§30/§44). Es la prueba más directa y airtight del principio del doc: cambiar el % de comisión en Ajustes mueve a Gerencia al instante, sin tocar una sola línea de este archivo nuevo. Ambas tarjetas muestran a "Diego M." (Setter y Closer) — el mismo usuario demo que ya usa el resto de la app para ambos roles (§17/§26/§30, sin auth real) — deliberadamente NO se inventaron nombres nuevos ("Gonzalo"/"Jorge Quiroz" de la referencia) porque hubiera sido un dato que no deriva de ningún lado real del dataset.
- **Sección 6 (Tendencia histórica)**: array ilustrativo de 6 meses (`GERENCIA_TREND`), mismo patrón que `CHART_HIST` de `CloserAI.tsx` — no atado a la base por período (igual que el histórico de Inicio tampoco está atado al cockpit en vivo). Documentado como placeholder, no como dato real.

**B. "Tasa de automatización" (hero de la sección 3) — la métrica más deliberadamente resuelta.** El doc pide "ventas sin `atribucion_setter` ÷ ventas totales". Cruzar nombres entre `closerStore`/`setterStore` para derivarlo en vivo dio un resultado real pero poco ilustrativo (0 de los 5 "ganado" sembrados en Closer coinciden por nombre con un contacto de Setter, así que el cruce daría 100% automatización — aburrido y no demuestra el concepto). Se resolvió agregando un campo nuevo, honesto y propio del lado del closer: `ClosurerContact.atribucionSetter?: boolean` (`closerStore.tsx`) — espejo de `SetterContact.atribucionSetter`, pero vive del lado del closer porque el traspaso setter→closer (§11) es el MISMO contacto cambiando de dueño, y la única forma honesta de saber si una venta puntual tuvo rescate humano es que el propio contacto lo recuerde, no cruzar dos stores que no siempre se pisan. Sembrado en los 5 "ganado": `JORGE ALVAREZ`/`DIEGO GOMEZ`/`MIGUEL PEREZ` → automáticas; `SHIRLEY FAJARDO`/`VALENTINA GOMEZ` → rescate → 60% real. La tarjeta muestra AMBOS números: el hero grande de la base del período (65%/61%/65% según período, escala grande e ilustrativa) y, debajo, una línea genuinamente en vivo ("En el dataset en vivo: 3 sin intervención · 2 con rescate (60%)") derivada de `closer.contacts` de verdad — sí cambiaría si se registrara una venta nueva con ese campo (límite honesto: `advance()` no tiene forma de setearlo en una venta nueva registrada en vivo, documentado igual que otros campos que no se recalculan solos en este frontend-only demo).

**C. Revenue/Ticket — corrección deliberada vs. la referencia.** La imagen de Francisco mostraba Revenue Total $43,100 conviviendo con Ticket Promedio HT $5,200 sobre 23 ventas — matemáticamente esos dos números de la referencia no cuadran entre sí (23 × $5,200 = $119,600, no $43,100). Se priorizó la consistencia interna y el rango real de precio HT de CLAUDE.md §1 ("high-ticket $4-8k") sobre calcar el mockup al dígito — mismo criterio que otras veces que la prosa/imagen de Francisco no cuadraban exactamente (§21, cero emojis vs. la captura). CPL/CPA/CPV sí calzan con la referencia (dependen solo de conteos de volumen + inversión, no del revenue corregido).

**D. Rol y permisos.** `Gerencia.tsx` recibe `role` — si `role !== "admin"` renderiza una pantalla de "Acceso restringido" (nunca el dashboard). Además, en `App.tsx`: el ítem del sidebar se filtra por completo (`visibleNav`) cuando el rol activo no es admin (no solo se deshabilita, como Ajustes — el doc pide explícitamente "no visible para roles operativos"), y un `useEffect` nuevo devuelve la vista a "closer" automáticamente si el usuario cambia de rol mientras está parado en Gerencia (vía el ciclo admin→closer→setter del user-card). Verificado con Playwright: cambiar de rol oculta el ítem y redirige sin dejar la vista huérfana.

**E. Selector de período — 3 reales, 1 pendiente.** "Este mes"/"Mes pasado"/"Últimos 3 meses" recalculan TODO el dashboard (volumen, funnel, destino, eficacia, dinero) de sus propias bases; "Personalizado" muestra un aviso honesto ("todavía no está conectado — pendiente de definir el origen, ¿picker de fechas contra Supabase?") en vez de fingir un rango real — mismo criterio que el doc de Francisco ya anticipaba en su sección "Pendiente de fuente" (feedback de la llamada de ventas, inversión de pauta manual vs. API).

**F. Ajustes — nueva tarjeta "Parámetros de Gerencia".** `settingsStore.tsx` ganó `GerenciaParams { inversionMetaAds, objetivoFacturacion }` (seed $3,000/$46,000, coincide con la referencia), persistido igual que el resto de Ajustes (§37, solo al apretar "Guardar Cambios"). UI nueva en `Ajustes.tsx` > Administración, mismo patrón visual que "Mi meta del mes".

**Verificado con Playwright**: grid completo (6 secciones) reproduce la referencia con corrección de revenue; hover en los 2 gráficos de tendencia muestra tooltip con mes/valor exacto; cambiar el selector a "Últimos 3 meses" recalcula leads por fuente (790/260/115), funnel (1165→54), destino, eficacia y dinero al instante, y el badge de delta de "Agendas del período" desaparece correctamente (no hay período-anterior definido fuera de "este mes"); ciclar el rol a Closer/Setter oculta "Gerencia" del sidebar y devuelve a Closer AI sin dejar la vista rota. `npm run build` limpio, sin errores de consola en ningún paso.

## 47. Fix: modal Seguimiento quedaba bloqueado tras la primera selección (2026-07-14)

Francisco reportó (Avanzar → Seguimiento → pantalla "Modo", en Closer Y en Setter, mismo componente) que una vez que elegía una opción — automática o manual — la pantalla "se quedaba bloqueada": ya no podía cambiar de opinión y elegir algo del otro grupo.

**Causa exacta**: `SeguimientoScreen` (`ContactDrawer.tsx`) aplica la regla de mutua exclusión de §16.1.B ("elegir una fila automática atenúa el grupo manual completo, y viceversa") con `opacity-40 pointer-events-none` sobre el grupo no elegido. El `pointer-events-none` bloqueaba TODOS los clics en ese grupo — incluido el que permitiría cambiar de opinión — sin ninguna otra vía para deshacer la selección (no hay botón de "deseleccionar", y volver a tocar la misma opción no la des-selecciona). Resultado: una vez elegida una opción, quedaba fija hasta cerrar el modal entero.

**Fix**: se quitó `pointer-events-none` de ambos grupos (`ContactDrawer.tsx`, línea de las 2 `<div>` que envuelven "Seguimiento automático"/"Seguimiento manual") — el atenuado visual (`opacity-40`) se mantiene como señal de "no es el modo activo", pero ahora ambos grupos siguen siendo clicables: tocar una opción del grupo atenuado la selecciona y invierte cuál de los dos queda atenuado, en vez de quedar congelado. Corrige la letra literal de §16.1.B (que pedía explícitamente "no interactivo") — corrección en vivo de Francisco tras probarlo, prevalece sobre el spec de texto anterior.

Mismo componente compartido por Closer y Setter (§16.1) — un solo fix cubre ambos flujos, sin tocar nada rol-específico.

**Verificado con Playwright**: Avanzar → Seguimiento → situación "Muy interesado" → pantalla Modo; clic en "Recupero" (automático) lo selecciona y atenúa el grupo manual; clic en "1 semana" (manual, dentro del grupo atenuado) cambia la selección correctamente — el grupo automático pasa a atenuado y el manual se activa; volver a clicar "Recupero" revierte sin problema. Sin errores de consola.

## 48. Perfil > Calificación — separación real Form VSL / Form Meta, + Llamadas IA en Interacciones (2026-07-16)

Francisco reportó que la sección "Calificación" del Perfil (§41.2) mezclaba todos los campos de calificación sin distinguir de qué formulario venían — aunque la pregunta se pareciera ("Etapa del negocio" en ambos, por ejemplo), son campos DISTINTOS: el lead form de Meta y el formulario de la VSL escriben cada uno los suyos, y un contacto puede tener llenos los de Meta, los del VSL, o ambos.

**A. `PerfilField` ganó `formulario?: "vsl" | "meta"`** (`closerStore.tsx`, tipo nuevo `PerfilFormulario`) — solo relevante cuando `group === "calificacion"`. `PerfilTab` (`ContactDrawer.tsx`) ahora renderiza la sección Calificación en 2 sub-bloques SIEMPRE visibles con encabezado ("Form VSL" / "Form Meta"): si el contacto tiene campos de ese formulario los lista: si no, muestra "Sin datos de este formulario." en cursiva — a diferencia del resto de los grupos (que si están vacíos simplemente no se renderizan, regla 10 de §4), acá la ausencia del bloque ES información real (ese lead nunca llenó ese formulario en particular).

**B. Campos canónicos por formulario** (nombres exactos que dio Francisco, reemplazan a los genéricos que había antes):
- **Form VSL**: Etapa del negocio · Objetivo de facturación · Tipo de servicios · Mayor obstáculo · Listo para empezar ahora · Inversión $4-8k · Compromiso de asistencia · Tiene equipo.
- **Form Meta**: Etapa del negocio · Objetivo de facturación · Mayor obstáculo.

Se re-etiquetaron los campos ya sembrados (ninguno se inventó de cero): "Facturación mensual" → "Objetivo de facturación", "Principal obstáculo" → "Mayor obstáculo", "Capital disponible"/"¿Tiene equipo?" → "Inversión $4-8k"/"Tiene equipo" (campos propios de la VSL). Seed resultante, con las 3 combinaciones reales que describió Francisco: `JUAN PEREZ`/`ARIEL MENDEZ`/`VALENTINA GOMEZ` (closer) y `PEDRO SANCHEZ` (setter) quedaron con AMBOS formularios parcialmente llenos (ej. Meta completo + solo "Inversión $4-8k" de la VSL, mostrando que un lead puede abandonar la VSL a mitad de formulario); `CARLA MENDOZA` (setter) quedó SOLO con Form Meta (Form VSL vacío); `SOFIA NUÑEZ` (setter) quedó SOLO con Form VSL (Form Meta vacío) — los 3 casos son visibles y verificados con Playwright.

**C. Interacciones — Llamadas IA.** Antes esta sección solo mostraba Video pre-call. Se agregó un bloque "Llamadas IA" (intentos, contestadas, último resultado) calculado con una función nueva y exportada, `callsIASummary(llamadas)` (`closerStore.tsx`) — mismo criterio de "un solo origen de verdad" que ya rige 📞/📹 (§27): NUNCA un campo suelto, siempre derivado de `contact.llamadas` (el mismo array que alimenta el tab Llamada). Cuenta los registros con `origin !== "sales_call"` (igual que `countCallsContestadas`), y como `llamadas` ya viene ordenado más-reciente-primero, el "último resultado" es simplemente el `resultado` del primer intento de IA de la lista. El bloque no se renderiza si el contacto no tiene ningún intento de IA (regla 10).

**Verificado con Playwright**: `JUAN PEREZ` muestra Form VSL + Form Meta ambos poblados, y en Interacciones "2 contestadas de 2 intentos · Último resultado: Contestó · confirmó" (además del Video pre-call ya existente); `CARLA MENDOZA` muestra Form Meta poblado y Form VSL con "Sin datos de este formulario."; `SOFIA NUÑEZ` muestra el caso inverso (solo VSL) y "1 contestadas de 2 intentos · Último resultado: Contestó · calificó parcial" en Interacciones. Sin errores de consola. `npm run build` limpio.

## 50. Backend de Seguimientos (Closer → Mi Día) — primera integración real (2026-07-25)

Primer backend del repo. Hasta acá todo era semilla en memoria: cero `fetch`, cero
persistencia salvo el `localStorage` de Ajustes. Con esto llegan las primeras llamadas de
red, la primera base de datos y la primera integración con GHL.

### 50.1 Arquitectura y una desviación consciente del contrato

`api/` (funciones de Vercel, en este repo) ↔ **GHL** (verdad del negocio) + **Supabase
SOFIA** (estado operativo del tool). La capa de integración vive acá y no en el motor de
Kevin, que es otro desarrollador y otro tiempo.

`CONTRATO-GHL.md` §0 dice que *"el tool NO es una base de datos"*. Se respeta casi entero —
la situación es un custom field, el modo es un tag, el stage lo mueve un workflow. **La
excepción es la fecha objetivo del seguimiento manual**: GHL solo necesita saber que el
contacto está en manual para no perseguirlo, y el día en que reaparece en la cola es lógica
de cola de trabajo, sin campo ni workflow en el contrato. Decisión tomada con Francisco.

Lo que el contrato SÍ impone y acá se respeta: **el tool arma la píldora** (§0) a partir de
stage + custom field crudos, y decide en qué sección aparece cada contacto. Eso **invierte**
§2 ("el frontend no calcula"). El contrato es más nuevo y más específico: gana.

### 50.2 Las tres reglas de producto nuevas

1. **"Seguimientos de hoy" = solo manuales.** Una serie automática en curso NO genera fila:
   §16.1 define el automático como "el sistema persigue por ti" y su resultado confirmado es
   píldora + ⏱ + evento, sin tarea; solo el manual dice "tarea que reaparece ese día". Es
   también lo único coherente con §40.E. Aflora una sola vez, cuando la serie se agota
   (§16.1.D). Si el contacto responde antes, vuelve por Buzón general o Urgentes.
2. **Cancelación universal.** CUALQUIER resultado de Avanzar cierra el seguimiento abierto,
   autor `Sistema`. No estaba en ningún documento. Es lo que evita que un trato ganado siga
   siendo perseguido.
3. **Uno solo abierto por contacto.** Repactar reemplaza; contactos distintos no se tocan.
   Es un índice parcial único en la base, no lógica de aplicación: convierte el doble submit
   y las dos pestañas en una violación reintentable en vez de dos filas y dos tags en GHL.

### 50.3 Sin cron: la cola es una consulta

No hay proceso que "active" seguimientos. La condición es `fecha_objetivo <= hoy_org()`: el
día 4 una fila con fecha 5 no cumple, el día 5 la misma fila cumple sin que nadie la toque.
Estado derivado, no mutado — un cron puede no correr, correr dos veces o fallar en silencio,
y ahí sí se pierden seguimientos.

### 50.4 Correcciones al contrato y a este documento

- **§8 queda corregido**: declara que el ⏱ corresponde al tag `seguimiento_activo`, pero
  ese tag fue ELIMINADO (§9 del contrato). El del closer es **`seguimiento_recupero`**.
  Ojo: el viejo *sigue existiendo* en la cuenta — la nota del contrato describe una
  intención, no el estado real. Igual pasa con `seguimiento_postcall`.
- **§16.1.A queda enmendado**: decía que el ⏱ se enciende y apaga "ÚNICAMENTE vía Avanzar".
  El sistema también lo apaga por serie agotada, respuesta del contacto o cancelación.
  Nueva redacción: *se enciende solo vía Avanzar; se apaga vía Avanzar **o por el sistema**,
  siempre con autor `Sistema` en Historial*.
- **§34 vs. los toques automáticos**: no hay contradicción. Los 3 toques los envía un
  *workflow* de GHL disparado por tag, no el agente conversacional, que sigue muerto. La
  serie es estrictamente saliente: cualquier respuesta la cancela (WF 02.6 del contrato).
- **Tag nuevo `seguimiento_manual`** y valor **`Otro`** en `nivel_de_inters_seguimiento`:
  ambos creados y verificados en la subcuenta.

### 50.5 Trampas encontradas contra los sistemas reales

Ninguna de estas se ve compilando. Todas costaron una verificación contra producción.

- **El custom field se escribe por `id`, no por `key`.** Mandarlo por `key` —como lo
  documenta el contrato §4— devuelve **200 y no escribe nada**. Comprobado con las tres
  variantes. Sin leer de vuelta para verificar, el sistema habría reportado "situación
  guardada" durante meses. `api/_lib/ghl/real.ts` cachea el catálogo key↔id.
- **El historial no podía borrarse.** El trigger append-only rechazaba UPDATE *y* DELETE, y
  como los eventos referencian el seguimiento, nada del módulo era borrable — ni el dato de
  prueba, ni el de alguien que pidiera supresión. Ahora solo bloquea UPDATE: la historia no
  se reescribe, pero borrar es una acción administrativa legítima.
- **Registrar es atómico o no es.** Son cuatro escrituras, y desde Node eran cuatro round
  trips sin transacción: si la creación fallaba tras cerrar el anterior, el contacto quedaba
  **sin** seguimiento en silencio. Vive en `closer_registrar_seguimiento()`.

### 50.6 Tres bugs preexistentes, corregidos de paso

- **El ⏱ nunca se apagaba**: `?? c.cadenciaActiva` conservaba el valor previo y solo
  Seguimiento escribía el campo, así que una Venta dejaba el reloj encendido sobre un trato
  ganado. Ahora se deriva de la serie pendiente.
- **"Mañana" devolvía pasado mañana** después de las 19:00 en Lima: `isoInDays` hacía
  aritmética local y luego `toISOString()`, que pasa a UTC antes de truncar. Eliminado; el
  cliente manda el preset y el servidor resuelve. Ver `src/lib/fechas.ts`.
- **Resurrección con la píldora equivocada**: `advance()` no limpiaba `respondido` ni
  `seguimientoPendiente`, así que tras una Venta se podía pulsar FIJAR y el contacto volvía
  a la cola luciendo `VENTA · $5.000`.

`cadenciaActiva` → `seguimientoAutomaticoActivo` en los dos stores (deuda de §15.3).

### 50.7 Estado y límites conocidos

- Implementada **solo la salida Seguimiento**. Las otras cinco devuelven 501 en vez de
  fingir: cada una tiene su tag y su campo, y aplicarlos mal dispara el workflow equivocado.
- Los contactos reales conviven con la semilla en el mismo `Record`, keyeados por
  `ghlContactId` en vez de por nombre. **No se migró la identidad de toda la app**: la clave
  es un string y a las vistas les da igual. Ese refactor sigue pendiente.
- **El frontend no lee ninguna variable de entorno.** La ruta del API es `/api` por
  constante, y el "modo demo" sale del manejo de errores: si el backend no responde, la app
  sigue con la semilla. Un clone limpio nunca se rompe por falta de configuración.
- **Divergencia sin resolver**: el stage `descalificado` se pinta de tres formas distintas
  según dónde se mire — `NO LE INTERESA · X` (Avanzar), `DESCALIFICADO · X` (contrato §4 y
  §39.5) y `NO INTERESADO · PRECIO` (semilla). Hay que elegir una.
- **Un solo closer.** `zona_closer` es territorio, no asignación: dice que el contacto está
  en el mundo del closer, no de cuál. Con más de uno hará falta el owner de la oportunidad.
### 50.8 Despliegue — el commit lo tiene que firmar el dueño de la cuenta

El proyecto quedó conectado a GitHub el 2026-07-25: un push a `main` despliega solo. Pero
hay una condición que no está en ninguna documentación de Vercel visible desde el repo, y
que cuesta una hora descubrir.

**El plan es Hobby, que no admite miembros de equipo.** Un commit firmado con un correo que
no sea el del dueño de la cuenta se bloquea con *"X is not a member of this team"*.

Y falla de la peor forma posible: Vercel **igual marca el deployment como `success` en
GitHub** y deja la URL sirviendo el build anterior. El check aparece verde, la página carga,
y lo que estás viendo es código viejo. Pasó exactamente eso con los commits `c49925e` y
`5f6e597`: los dos "exitosos", los dos sirviendo el mismo `dpl_Cfv4j68dvEfY` de un deploy
por CLI de tres horas antes.

**Cómo detectarlo:** comparar el atributo `data-dpl-id` del HTML entre dos deploys. Si no
cambió, no se construyó nada — sin importar lo que diga el check.

**Cómo evitarlo**, por repo y no global, para no pisar la identidad en otros proyectos:

```bash
git config user.email instalacionesariaia@gmail.com
```

La autoría real de quien escribe se conserva con un `Co-Authored-By` en el mensaje.

### 50.10 Datos de demostración: prefijo `EJEMPLO` obligatorio

Regla de Francisco (2026-07-25): **todo contacto de demostración empieza con `EJEMPLO`** —
`EJEMPLO RODRIGO SILVA`. En producción hay que poder distinguir de un vistazo un contacto
real de GHL de uno inventado, y con la app conectada esa confusión cuesta caro.

El prefijo va en **los cuatro lugares a la vez**: `closerStore`, `setterStore`, el `SCHEDULE`
de `CloserAI.tsx` y `agentAuditStore`. El nombre es a la vez texto visible **y** clave del
`Record`, y Agents Audit cruza por nombre (`AgentsAudit.tsx:723`); si uno queda sin prefijar,
abrir la ficha desde una evidencia deja de encontrar al contacto.

**Los nombres de los agentes NO llevan prefijo** (`Lead Flow AI`, `Appointment Flow Voz`):
son entidades reales del producto, no datos de demostración.

**"Agenda de Hoy" quedó vacía pero SIGUE VISIBLE.** Se quitó el campo `agenda` de los 6
contactos semilla que lo tenían, para que la prueba en producción se concentre en
Seguimientos — pero la sección no se oculta.

Es una excepción deliberada a §4.1 ("secciones vacías en Mi Día se ocultan"), la misma que
ya tenía "Completadas Hoy": el closer necesita **ver** que no tiene citas, no que la sección
desaparezca y lo deje dudando de si se rompió algo. Muestra el estado vacío "No tienes citas
agendadas para hoy.", copiando el patrón de Completadas Hoy.

El contador en cero sí se oculta — esa mitad de §4.1 ("contadores en cero jamás se
renderizan") sigue vigente y antes tampoco se cumplía acá.

### 50.9 Los imports de `api/` llevan extensión `.js` — obligatorio

`package.json` declara `"type": "module"` y el runtime de Vercel es Node 24. **ESM nativo no
resuelve un import relativo sin extensión.** En el front no se nota porque Vite los resuelve
al empaquetar; en las funciones no hay nadie que los resuelva.

```ts
import { env } from "./_lib/env.js";              // ✅
import { hoyISO } from "../src/lib/fechas.js";    // ✅
import { env } from "./_lib/env";                 // ❌ FUNCTION_INVOCATION_FAILED
import { ghl } from "./_lib/ghl.js";              // ❌ es una CARPETA — va ghl/index.js
```

Dos detalles que cuestan tiempo:

- **Tampoco existen los imports a carpetas.** `./_lib/ghl` tiene que ser `./_lib/ghl/index.js`.
- **Alcanza a `src/`.** Cualquier módulo de `src/lib/` que una función importe —y lo que ese
  módulo importe a su vez— necesita la extensión igual. Hoy es
  `src/lib/seguimientos/dominio.ts`.

`tsc -b` **no lo detecta**: con `moduleResolution: "bundler"` los imports sin extensión son
válidos. Falla solo en runtime, y el error de Vercel (`FUNCTION_INVOCATION_FAILED`) no dice
cuál módulo ni por qué. Se aisló desplegando cuatro sondas que se descartaban entre sí; si
vuelve a pasar, ese es el camino más corto: una función sin imports, otra con un import
relativo, y comparar.

Comprobado: con la extensión, `/api/diagnostico` devuelve `ok: true` contra SOFIA y GHL.

## 51. Conexiones y fin del polling masivo (2026-07-31)

Ejecuta `CONTEXTO-CLOSER-Conexiones-Polling.md` (el contrato de la tarea, de Fabio).
**Reemplaza la arquitectura de §50 en tres puntos y enmienda §2.**

### 51.1 La inversión: Supabase manda el stage (enmienda a §2)

- **`closer_contactos.stage_key` es la fuente de verdad de la etapa.** Lo escribe SOLO
  `proyectarAvance()` (`api/_lib/seguimientos.ts`) al registrar un Avanzar; el refresco de
  contacto (`sincronizarContacto`) no lo toca. Para un contacto sin ningún Avanzar,
  la etapa se deriva de los tags UNA vez en la lectura (`etapaDesdeTags`).
- **El dinero también:** cash collected y ventas del mes se CALCULAN por query sobre
  `closer_avances` (`GET /api/closer/inicio`). El Opportunity Value se MANDA a GHL al
  registrar la venta y **nunca se lee de vuelta** (se eliminó `/api/closer/cockpit`).
  El dashboard de Inicio arranca el mes en $0 y lo dice; las semillas EJEMPLO no suman ahí.
- GHL sigue siendo la fuente de mensajes, citas y tags — que se INGIEREN y se cachean
  (`closer_mensajes`, `closer_citas`, `closer_contactos`). El frontend NUNCA llama a GHL.

### 51.2 Ingesta: webhook + reconciliación (doble vía)

- `POST /api/webhooks/ghl` (secreto OBLIGATORIO — sin `WEBHOOK_SECRET` rechaza todo) da
  ≤1s; `POST /api/closer/reconciliar` da ≤10s sin depender de que Francisco cree workflows.
- **El "reloj de 10s" lo dispara el frontend** (solo con pestaña visible) y **el candado
  vive en Postgres** (`closer_reconciliar_claim`, migración 012): N pestañas = el costo de
  una. Camina `/conversations/search` por MARCA DE AGUA — verificado: el `tags=` del search
  SE IGNORA, así que se cruza contra los ids cacheados; costo O(actividad), no O(cuenta).
- Dedupe entre vías = la primary key de `closer_mensajes` (messageId de GHL).
- El analizador de Kevin se dispara SOLO desde el webhook, jamás desde la reconciliación.

### 51.3 Reglas nuevas de producto

- **Bot default APAGADO** (decisión de Fabio — INVIERTE el supuesto anterior): sin tags de
  bot, el mensaje entra al Buzón. Orden en `estadoBotDesdeTags()` (`contrato.ts`):
  postcall→OFF, fallo→OFF, `bot_activado`→ON, nada→OFF. Francisco debe aplicar
  `bot_activado` en sus workflows.
- **Toda salida de Avanzar menos No-show manda `bot_desactivado_postcall`**; No-show lo
  QUITA (el workflow de recuperación necesita al bot — espejo del §34).
- **Buzón General** = zona_closer + bot apagado + último entrante posterior a
  `buzon_resuelto_el`. DERIVADO por query, sin flag. "Marcar resuelto" mueve la marca.
- **Congelado** (`congelado=true` al perder `zona_closer`): visible y movible, pero CERO
  llamadas a GHL por él (Avanzar registra solo en Supabase; no se le envían mensajes).
- **Alta de contactos** (decisión de Fabio): NO hay barrido de descubrimiento —
  `zona_closer` se aplica DESPUÉS de agendar, así que todo contacto nuevo llega con cita
  (webhook de cita o cron :25/:55). Red de seguridad: cualquier webhook de un contacto
  desconocido lo crea por upsert (`asegurarContacto`).
- **Completadas Hoy** de contactos reales se deriva por query (avances + resoluciones del
  día, Lima) — a medianoche se vacía sola. El flag `completedToday` quedó solo para semillas.

### 51.4 El presupuesto de GHL (reemplaza la tabla de COSTOS-Y-POLLING.md)

| Proceso | Frecuencia | Llamadas |
|---|---|---|
| Reconciliación (candado en Postgres) | ≤1 vez/10s, solo con app abierta | 1 + 2×cambiados |
| Cron de citas `citas-respaldo` (vercel.json) | :25 y :55 | ~2-3/hora (incluye refresco pre-reunión) |
| Enviar mensaje / Avanzar / abrir día no cacheado | por acción del usuario | 1-2 |
| Urgentes del Setter (fuera de alcance, bajado 10s→60s) | 60s con pestaña visible | 1 + N notas |
| **Todo lo demás** | — | **0** |

El frontend tiene UN módulo de relojes (`src/lib/polling.ts`): pestaña oculta = cero
intervalos; el chat envía de verdad (`POST /api/closer/mensajes`, antes era estado local).
NOTA FUTURA: con Supabase Realtime, ese módulo se reemplaza por suscripciones.

### 51.5 Trampas nuevas contra los sistemas reales

- **PostgREST puede quedar con schema cache viejo tras un ALTER** (migración 011): el
  UPDATE con filtros daba 42703 "column does not exist" con la columna existente y el
  SELECT funcionando. Ni `NOTIFY pgrst` ni el PATCH de config lo destrabaron al instante.
  Salida: mover la operación a una función SQL (RPC) — migración 012. Si vuelve a pasar:
  sonda con SELECT + UPDATE + host (patrón `sonda-011`, ya borrada).
- El search de conversaciones pagina con `startAfterDate` y trae
  `lastMessageBody/Direction/Date` por conversación; el envío es
  `POST /conversations/messages {type:"WhatsApp", contactId, message}`.

## 52. Indicadores del contacto, Pipeline por etapa y optimización (2026-08-04)

Tres pedidos de Fabio en la misma pasada, sobre los mismos archivos.

### 52.1 Los 6 íconos son información PERSISTENTE del contacto

Pedido literal: *"estos símbolos deben aparecer como información del contacto, o sea que si
ese contacto se mueve a otra parte del pipeline esto siempre lo acompañará... cuando se
muestre en cualquier parte traerá esa información."*

**El problema real era peor de lo que parecía.** Los 6 se derivaban de `ClosurerContact.llamadas`
/`.agenda`/`.botEstado`, campos que solo existen en la semilla — y la semilla está vacía desde
el 2026-08-01. Para un contacto real de GHL, **cinco de los seis estaban permanentemente
apagados**; solo 💰 funcionaba. Además el bloque de render vivía duplicado en CINCO vitrinas con
lógica divergente: el header de la ficha tenía un `?? "activo"` que las listas no, así que el
mismo contacto se veía "sin bot" en el Pipeline e "IA activa" en su ficha.

**La arquitectura nueva**: un bloque `indicadores` calculado en el BACKEND, devuelto por todos
los endpoints que listan contactos, y pintado por UN componente
(`src/components/StatusIcons.tsx`). Ninguna vista deriva un ícono por su cuenta.

| Ícono | De dónde sale | Nota |
|---|---|---|
| 📹 reuniones | `closer_citas` pasadas no canceladas − los No-show de `closer_avances` | No hay fuente real de llamadas; ver 52.2 |
| 📅 cita | `closer_citas` futura no cancelada | |
| 📞 llamadas de voz | columnas `llamadas_ia_*`, cacheadas de los custom fields de GHL | La única denormalización |
| 🤖 bot | **derivado de los tags en cada lectura** | `botDesdeTags` en `contrato.ts` |
| ⏱ seguimiento | `closer_seguimientos` automático pendiente | Su único origen: la vista de Mi Día lo excluye a propósito (§50.2) |
| 💰 venta | `monto` con etapa `ganado` | Ya funcionaba |

**La regla que dejó la migración 013**: *lo que se deriva en la lectura no se queda viejo; lo
que se denormaliza, sí.* Se descubrió auditando la base: `closer_contactos.bot_estado` y
`cita_el` estaban **NULL en los 7 contactos** pese a que el código decía escribirlas. Las dos
quedaron marcadas obsoletas (no se dropean: un DROP repite el trap de schema cache de §51.5).
📞 es la excepción consciente — su origen está en GHL y traerlo en vivo costaría una llamada
por fila.

**Una sola derivación del bot.** Había dos que no se hablaban: `estadoBotDesdeTags` (binaria,
para el Buzón) y una `botDesdeTags` local en `api/_lib/contactos.ts`. Ahora `botDesdeTags` vive
en `contrato.ts` con los 6 valores y precedencia explícita (fallo > postcall > lt > manual >
activado > null), y `estadoBotDesdeTags` es su **proyección** — no una segunda implementación,
para que no puedan divergir. `bot_apagado_manual` y `derivado_lt` dejaron de ser strings sueltos.

**Se eliminó el `?? "activo"` del drawer.** §51.3 fijó el default en APAGADO; afirmar "IA
activa" sin ningún tag contradecía al propio sistema, que con ese default ya mandaba esos
mensajes al Buzón. `null` ahora significa lo que dice: sin evidencia de que el bot atienda.

### 52.2 📹 no tiene fuente real — y la regla que se eligió

GHL no expone las llamadas del closer, no hay evento de webhook, no hay tabla. Y su estado de
cita es inútil: **verificado, las citas que ya pasaron siguen en `confirmed`** — nadie marca
`showed`/`noshow`. Regla acordada con Fabio: *la cita pasó y el closer no dijo que lo
plantaron ⇒ la reunión ocurrió.* El vínculo cita↔avance es (contacto, día civil de la org).

**Límite dejado a propósito**: si el No-show se registra al día siguiente, la reunión se cuenta
igual. Es el MISMO hueco que ya tiene el show-rate de `api/closer/inicio.ts`; que los dos
mientan igual es preferible a arreglar uno solo y que el cockpit y el ícono del mismo contacto
se contradigan. Si se ensancha la ventana, se ensancha **en los dos lugares a la vez**.

### 52.3 La etapa manda la columna; la cita es un dato de la fila

Amplía la invariante de §38. La columna "Agendado" del Pipeline se armaba desde la caché de
CITAS, no desde la etapa. Consecuencias verificadas en producción: **Enrique Izaguirre y Fidel
no tenían fila en ninguna parte** aunque el contador los contara, el filtro de grade no tenía
ningún efecto sobre esa sección, sus 6 íconos estaban hardcodeados en apagado, y un contacto de
otra etapa con cita futura podía aparecer duplicado en dos columnas.

`PipelineAgendaRow`/`PipelineAgendaContact` se eliminaron. `PipelineRow` es una sola fila para
las 7 etapas; la cita pasó a ser una celda (encabezado "Próxima cita" en agendado, "Última
actividad" en el resto) con su variante ámbar "Vencida ·" para la que ya pasó (§50.10).

**Congelados visibles** (§51.3 pedía "visible y movible", y se veían idénticos a un activo):
fila con `opacity-60` + chip `FUERA DE ZONA`. "Base Total" muestra `N activos · M congelados`
desde el `stats` del backend, en vez de un total plano — el front lo ignoraba y recontaba solo.

### 52.4 "Sincronizar CRM" ahora sincroniza

Antes: 1 llamada a `/calendars/events`, guardaba citas, y **no releía ni un contacto ya
cacheado** — ni tags, ni bot, ni campos. El nombre prometía más de lo que hacía.

Ahora relee el territorio completo (`sincronizarTerritorio`), descongela al que recuperó
`zona_closer` y congela al que lo perdió. Dos modos: con `x-webhook-secret` (ops, tope 100) y
sin secreto para la UI (tope 25, candado de 60 s en Postgres). Abrirlo sin secreto tiene
precedente exacto: `/api/closer/reconciliar` ya es público y su freno también es un candado —
el `WEBHOOK_SECRET` es server-only y el browser no debe tenerlo.

**El guard que no se puede sacar.** Congelar por ausencia es peligroso: `buscarPorTag` devolvía
`[]` ante un error de GHL, indistinguible de "el territorio está vacío" — un 429 habría
congelado la base entera. Se arregló para que **lance**, y quedan además dos guards
(`!truncado && ids.length > 0`) como defensa en profundidad.

**Primera corrida real**: encontró 7 con `zona_closer` y **dos contactos que no estaban en la
plataforma** (leads activos, invisibles). La red de seguridad funcionando.

Fila nueva para la tabla de §51.4:

| Proceso | Frecuencia | Llamadas |
|---|---|---|
| Sincronizar CRM (botón del Pipeline) | por clic, ≤1 cada 60 s (candado en Postgres) | 2 + activos (tope 25) |

### 52.5 Optimización — qué costaba y qué se midió

El síntoma ("la app se puso lenta") no venía del volumen: 7 contactos y 45 mensajes.

- **El tick de 10 s re-renderizaba el árbol entero**, cambiara algo o no: el updater devolvía
  siempre un objeto nuevo y el `value` del contexto se recreaba en cada render. Ahora hay un
  guard **por campo** en el reloj de Mi Día (comparar referencias no serviría: los objetos
  `urgente`/`respondido` se reconstruyen frescos cada tick) + `useMemo` en los cuatro
  providers. **El orden importa**: memoizar sin el guard no habría servido de nada.
- **El agrupado por etapa hacía 7 pasadas completas por render** (un `.filter()` dentro del
  `.map` sobre `STAGE_ORDER`). Ahora es un `useMemo` de una pasada, sembrando las 7 claves para
  no romper §38.D.
- **N+1 real contra GHL**: `api/setter/urgentes.ts` pedía la nota de cada urgente por separado,
  cada 60 s. Reemplazado por una query batcheada a `closer_analisis_agente` — el mismo texto
  (`analizador.ts` guarda `motivo` en la tabla y manda el mismo string a la nota). De `1+N` a 1.
- **Cuatro endpoints de solo lectura importaban el cliente completo de GHL** (414 líneas, sin
  tree-shaking posible porque la elección real/stub es en runtime) solo para leer un string de
  diagnóstico. Ahora usan `env.ghlModo()`.
- **`.eq("org_id")` en los tres SELECT grandes**: con una sola org no cambia el comportamiento,
  pero es lo único que vuelve elegibles los índices compuestos — sin WHERE ningún índice ayuda.
- **Bundle**: `framer-motion` costaba 39 KB gzip (24% del total) por dos animaciones del tab
  Inicio; reproducidas con CSS + `requestAnimationFrame`, misma duración y curva. Más
  `React.lazy` por vista y `manualChunks` de react. **Medido: 161,7 KB gzip en un archivo →
  entrada de 22 KB + react 45 KB (cacheable entre deploys) + la vista que se abra.**
- **ErrorBoundary** (`src/components/LimiteDeError.tsx`), en el mismo commit que el splitting y
  no después: un chunk que no se puede descargar —el caso normal, deploy nuevo con pestaña
  vieja— deja la pantalla en blanco, y `closerStore.tsx` ya avisaba de que no había ninguno.

**Cómo medirlo**: React DevTools → Profiler → "Highlight updates", 60 s de inactividad (antes
parpadeaba 6 veces, objetivo 0) · `PerformanceObserver` sobre `longtask` · Network filtrado a
`/api/` · `gzip -c dist/assets/index-*.js | wc -c`.

### 52.6 Carpeta nueva: `src/components/`

No existía. La estrenan `StatusIcons.tsx` y `LimiteDeError.tsx`, que comparten `CloserAI`,
`ContactDrawer` y `App` — ninguno es "dueño" de ellos.

### 52.7 Pendientes detectados, no resueltos

- **`resolverBuzon()` existe en `api.ts` y nadie lo llama**: `resolveIntervention` solo limpia
  el marcador en memoria, así que el servidor lo vuelve a reportar en el tick siguiente.
  Resolverlo de verdad exige quitar el tag `bot_pausado_fallo` en GHL — es un cambio de
  producto, no de rendimiento.
- **Tick unificado**: `closer:reconciliar` y `closer:mi-dia` corren a la misma cadencia y leen
  la misma tabla por separado (12 req/min sin ficha). Fusionarlos en un `POST /api/closer/tick`
  con `Promise.allSettled` bajaría a 6-7 — diseñado y no ejecutado: toca ingesta, candado y las
  cinco colas a la vez, y merece su propio commit y deploy aislados.
- 📹 y 📞 con detalle por llamada (fecha, duración, grabación) siguen sin fuente en GHL. Lo de
  acá son proxies honestos sobre los datos que sí existen.

## 53. El auditor de IA — portones, costo y los 4 agentes que faltan (2026-08-04)

`api/_lib/analizador.ts` venía marcado como intocable ("es de Kevin"). Fabio autorizó
explícitamente modificarlo. **Coordinarlo con Kevin**: la rúbrica, el esquema y la lógica de
evaluación no se tocaron — solo los portones de entrada y el barrido manual.

### 53.1 El bug: el auditor juzgaba a una IA que no existe

Fabio Malpartida apareció en Intervenciones Urgentes con *"La IA no respondió a los últimos
mensajes del contacto"*. Su bot nunca estuvo encendido en esa conversación.

No era un falso positivo ocasional, era uno **garantizado por construcción**: el criterio 2 de
la rúbrica es *"La IA dejó de responder o ignoró al usuario"*, y con el bot apagado eso se
cumple siempre. El único portón que había era el territorio (`zona_closer`/`zona_setter`) —
nada verificaba que hubiera un agente atendiendo.

Datos reales del incidente: **4 llamadas a Opus 5 en 7 minutos** sobre un solo contacto de
prueba, y la cuarta lo mandó a la cola roja. Se limpió: tag quitado en GHL y las 4 filas de
`closer_analisis_agente` borradas.

### 53.2 Los cuatro portones

En orden, de más barato a más caro de evaluar. Cada uno evita una llamada al modelo.

| # | Portón | Por qué |
|---|---|---|
| 1 | `zona_closer` únicamente | Este es el auditor de CHAT DEL CLOSER. El de setter será su propio agente (53.4) |
| 2 | **`botAtendiendo(tags)`** | El que faltaba. `bot_activado` o `bot_reactivar`, y ningún tag de apagado |
| 3 | Ya tiene `bot_pausado_fallo` | Ya está en la cola; re-analizar duplica la nota |
| 4 | El transcript contiene `"IA:"` | Los HECHOS, no los tags — cubre un tag que quedó mintiendo |

El portón 4 no es redundante con el 2: un tag puede estar mal puesto, un workflow puede no
haber corrido, alguien puede editar a mano. Sin una sola línea de la IA no hay nada que auditar,
diga lo que diga el tag.

`botAtendiendo` vive en `contrato.ts` y es **distinta** de `estadoBotDesdeTags` a propósito:
incluye `bot_reactivar`, que el contrato §9 define como una ORDEN y no como un estado. Para el
ruteo del Buzón esa diferencia importa (todavía no contesta); para el auditor no (ya hay un
agente que va a responder, y su respuesta es auditable).

`analizarTerritorio` (el barrido manual) ahora filtra los candidatos ANTES de llamar a
`analizarYMarcar` — esa función vuelve a pedirle el contacto a GHL para decidir, así que sin el
filtro previo un barrido sobre 200 contactos gastaba 200 llamadas para descartar 190. Y pasó de
`Promise.all` a serie: cientos de llamadas al modelo a la vez no son un disparo manual.

### 53.3 El costo, medido

- **Modelo**: `claude-opus-5` (`CLAUDE_MODEL` lo sobreescribe), `max_tokens: 2000`, `effort: "low"`.
- **Por llamada**: system (contexto + rúbrica) ≈ 550 tokens + transcript (hasta 40 mensajes) +
  salida corta. Da del orden de **US$0,01 a US$0,02 por análisis** a precio de Opus 5
  ($5/1M entrada, $25/1M salida).
- **Frecuencia**: el webhook lo dispara en **CADA mensaje, entrante y saliente**
  (`api/webhooks/ghl.ts`, los dos handlers).
- **El multiplicador que importa**: el transcript se re-manda **entero** cada vez, así que el
  costo de una conversación crece con el **cuadrado** de su longitud. Una conversación de 20
  mensajes no cuesta 20 análisis baratos: cuesta 20 análisis cada vez más caros.

Estimación a volumen real: 100 leads/mes × ~20 mensajes ≈ 2.000 llamadas ≈ **US$20-40/mes**
solo para este auditor. Con los cuatro y más volumen, se multiplica.

**Los portones SON el control de gasto.** Antes de este cambio, un contacto sin bot generaba
una llamada por cada mensaje que se le mandara, para siempre.

Palancas que quedan disponibles y NO se aplicaron (son decisión de producto, no técnica):
1. **Bajar de modelo.** Es una clasificación contra 5 criterios explícitos con esquema fijo —
   el caso típico de un modelo más chico. Es la palanca más grande y la más fácil (`CLAUDE_MODEL`).
2. **Auditar solo en el saliente.** Tiene más sentido evaluar después de que la IA respondió
   que después de que escribió el contacto. Reduce a la mitad.
3. **Debounce por contacto**: no re-analizar si ya se analizó hace menos de N minutos.

### 53.4 Faltan 3 de los 4 auditores

Hoy existe **uno solo**: chat del closer.

| Auditor | Estado | Agente en Auditoría de Agentes |
|---|---|---|
| Chat · closer | ✅ funcionando | `appointment-flow-ai` |
| Chat · setter | ❌ no existe | `lead-flow-ai` |
| Llamadas (transcripciones) · closer | ❌ no existe | `appointment-flow-voz` |
| Llamadas (transcripciones) · setter | ❌ no existe | `lead-flow-voz` |

Lo que hay que tener en cuenta al construirlos:

- **El código YA tenía soporte de dos territorios** (`TERRITORIOS` en `analizador.ts`, con su
  contexto por rol) y `/api/setter/urgentes` lee la misma cola. Pero un auditor de setter no es
  "el mismo con otro contexto": la rúbrica de post-agenda juzga confirmar y acompañar una cita;
  la de pre-agenda juzga calificar y conseguir que agende. Por eso el portón 1 lo bloquea en vez
  de dejarlo correr con la rúbrica equivocada. La cola de urgentes del setter va a estar vacía
  hasta que exista su agente — es correcto, no un bug.
- **Los dos de voz no tienen fuente**: GHL no expone las llamadas ni sus transcripciones, y no
  hay evento de webhook (verificado en §52). Antes de escribir esos auditores hay que resolver
  de dónde sale el audio o el texto — es integración, no prompt.
- **`closer_analisis_agente.agente_id`** ya distingue por agente, así que los cuatro pueden
  convivir en la misma tabla y cada uno alimenta su propia tarjeta.

## 49. Cómo trabajar en este repo

- Los cambios llegan como **specs** de Francisco (reglas + prompts + mockups). Implementar lo especificado; NO inventar features, textos ni estados. Si un dato no existe, el elemento no se renderiza (regla 10 de §4).
- Ante ambigüedad: preguntar, no asumir. Las reglas de este archivo ganan sobre cualquier patrón genérico de UI.
- Datos demo: fechas en 2026, coherentes con el glosario (píldoras, subcategorías y autores reales: nombre del usuario o `Sistema`).
- Nombres de tags/campos/stages: usar LITERALES los del `CONTRATO-GHL-Kevin.md` (ej. tags `derivado_lt`, `seguimiento_activo`, `nurture_leadflow`/`nurture_appflow`, `cita_agendada`; stages "Calificado sin agendar", "Cierre en curso", "GANADO").
- **Después de cada cambio en el proyecto, desplegar a producción en Vercel** (`instalacionesariaia-1374s-projects/project-closer-setter`) sin esperar a que se pida explícitamente.
