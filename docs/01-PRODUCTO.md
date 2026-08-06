# El producto

**Comando Central** es el dashboard de un equipo comercial high-ticket que opera sobre
GoHighLevel. No reemplaza a GHL: es la cabina desde donde los humanos ven el estado y
registran decisiones.

## El embudo

```
Meta Lead Ads ─┐
VSL opt-in ────┼→ Lead Flow (agente IA, texto + voz)  →  cita  →  Appointment Flow  →  sales call  →  venta
IG Profile ────┘         califica y agenda                        confirma y acompaña      (closer)
                              ↑                                          ↑
                          SETTER supervisa                        CLOSER supervisa
                            (pre-agenda)                            (post-agenda)
```

Producto **high-ticket** de $4.000–8.000. Para los que no califican hay un **low-ticket** de
$97–500, que vende el setter.

## Los cuatro roles

| Rol | Territorio | Su copiloto IA | Su "ganado" |
|---|---|---|---|
| **Setter** | Pre-agenda: entrada → cita | Lead Flow | Agendado (won, $0) y LT vendido (won, con monto) |
| **Closer** | Post-agenda: cita → venta | Appointment Flow | GANADO — el monto high-ticket vive solo acá |
| **Técnico** | Mantiene los agentes de IA | — | — |
| **Admin** (Francisco) | Configura catálogo, comisiones, metas | — | — |

**Regla de traspaso:** setter → closer es el MISMO contacto cambiando de etapa. Cero reseteo
de datos: el contador de llamadas, el perfil y el historial continúan. Solo cambian de dueño
las tareas. Las urgencias se rutean por etapa: pre-agenda al setter, post-agenda al closer.

**IG es el único canal sin bot.** Las reglas de humano-vs-bot no aplican ahí; todo Instagram
es trabajo manual.

## Glosario obligatorio

Estos son los términos oficiales. **No usar otros** — el vocabulario está atado a
automatizaciones de GHL y a los tags, así que un sinónimo en la UI se convierte en un bug de
integración.

### Salidas de Avanzar — Closer (6)

`Venta` · `Acordó comprar, falta pago` · `Seguimiento` · `No le interesa` · `No-show` · `Nurture`

### Salidas de Avanzar — Setter (5)

`Agendó` · `Venta Low-Ticket` · `Seguimiento` · `No califica` · `Nurture`

### Palabras prohibidas

| Nunca decir | Decir |
|---|---|
| "Cadencia" | **Seguimiento automático** |
| "Perdido" / "Pérdida" | **Descalificado** |
| "Cerró" | *(usar la salida concreta: Venta / Acordó comprar)* |
| "No se conectó" / "Conectó" | *(usar el resultado real de la llamada)* |

### Definiciones que importan

- **Venta** = pago verificado por un humano. Un webhook puede avisar, nunca registrar solo.
- **"Se presentó"** = hecho derivado que alimenta el Show rate. Nunca es una píldora.
- **Score** = letra de **fit** (A/B/C/D), no de engagement. Ver abajo.
- Toda salida de Avanzar lleva un campo **Nota** opcional que viaja al tab Notas con su
  contexto (fecha, resultado, autor).

## Subcategorías: por qué son obligatorias

La subcategoría **decide qué automatización se dispara**. Por eso van en chips, sin valor por
defecto, y bloquean el botón de confirmar hasta que se elige una.

| Salida | Subcategorías | Qué dispara cada una |
|---|---|---|
| **No-show** (closer) | Avisó · quiere reagendar | Camino de reagenda, sin recuperación |
| | Plantón · sin aviso | Workflow de recuperación |
| | Falla técnica | Reagenda inmediata, tono de disculpa |
| | Datos incorrectos | Corrección o descalificación |
| **Nurture** | Pidió tiempo | Re-contacto a 30–60 días |
| | Se enfrió | Solo contenido |
| **No califica** (setter) | Sin capital | Semillero de low-ticket futuro |
| | Sin urgencia / No es el perfil / Datos falsos | — |
| **Venta LT** | El producto del catálogo ES la subcategoría | Decide qué onboarding arranca |

### Seguimiento: dos grupos mutuamente excluyentes

Nunca los dos a la vez. Elegir uno atenúa el otro.

- **⚡ Automático** — *"el sistema persigue por ti"*. Enciende el ícono ⏱.
  - Setter: `Para agendar` (3 toques · 5 días) · `Para decisión LT` (2 toques · 3 días)
  - Closer: `Recupero` (3 toques · 7 días), única opción
- **👤 Manual** — *"vos lo retomás"*. **Sin** ⏱, porque no hay serie corriendo.
  - `Mañana` · `En 3 días` · `1 semana` · `Personalizada`
  - Genera una tarea con fecha; el toque lo da un humano.

## Score e inteligencia visible

**El score es la letra de FIT (A/B/C/D)**, derivada de la calificación: capital, urgencia,
etapa del negocio, facturación. Es casi estática.

> **Regla dura:** ninguna señal de engagement —ver el video, contestar llamadas, abrir
> mensajes— modifica la letra. Hay un diseño futuro (letra + superíndice numérico de
> temperatura) que está **en standby**: no implementar nada de eso sin spec explícita.

Sin datos de calificación → `—`. Nunca se inventa una letra.

**El video pre-call** vive en exactamente tres vitrinas: la línea del briefing, un campo en
Perfil > Interacciones con su procedencia, y los eventos del Historial. No tiene ícono
propio, no es un flag, y **nunca** modifica el score.

## Reglas transversales

Aplican a todo el producto. Están acá y no en cada documento porque romper una de estas
rompe la coherencia general.

1. **Un contador en cero jamás se renderiza.** El ícono queda atenuado, sin el "0". Las
   secciones vacías de Mi Día se ocultan — con una excepción: "Completadas Hoy" siempre se
   ve, como ancla.
2. **Espejo acción/estado.** El compositor y los controles son acciones y van abajo. La fila
   de íconos del header es solo estado, y **nunca** es clicable.
3. **Fuente única de verdad.** Ninguna vista tiene estado propio. Registrar algo actualiza
   todas las vistas al instante: Inicio, Mi Día, Pipeline, Agenda, ficha, historial.
4. **La ficha es UN componente global** que se abre como drawer donde se lo invoque. Nunca
   navega a otro módulo.
5. **Zonas de clic:** toda la fila abre la ficha. Expandir es un chevron que detiene la
   propagación. Los botones de acción tienen su propio clic aislado.
6. **Todo porcentaje lleva su base** ("X de Y").
7. **Textos derivados solo de eventos reales.** Sin dato, el elemento no se renderiza. Esta
   es la regla que más se viola y la que más caro sale.
8. **Temperatura visual:** Inicio y cockpit en oscuro + dorado celebratorio; las vistas de
   trabajo, claras. El dorado es dinero y logro, nada más.
9. **"Avanzar" es el ÚNICO registro de resultados.** Botón adaptativo (negro en claro, claro
   en oscuro), nunca dorado.
10. **Los eventos automáticos jamás pasan por Avanzar.** Se registran solos con autor
    `Sistema`.

## El sistema visual

### Temperatura

Inicio y los cockpits van en **oscuro + dorado celebratorio**; las vistas de trabajo, claras.
El dorado significa dinero y logro, nada más.

### Dark mode: capas por elevación, no negro absoluto

> *"El secreto de un dark mode premium no es usar negro absoluto en todo, sino crear capas de
> elevación con incrementos sutiles de luminosidad y el uso estratégico de bordes, ya que en
> fondos oscuros las sombras pierden efectividad."*

El sistema vive **únicamente** en el bloque `.dark` de `src/index.css`. Todo componente que use
`bg-card` / `bg-popover` / `bg-secondary` / `bg-muted` / `border-border` se beneficia
automáticamente, sin tocar una sola clase.

| Nivel | Variables | Qué va acá |
|---|---|---|
| **0** | `--background` | Solo el lienzo de scroll de cada vista |
| **1** | `--card` · `--popover` · `--sidebar-background` | Todo panel que "flota": tarjetas, el drawer de la ficha, modales, sidebar, toasts, dropdowns |
| **2** | `--secondary` · `--muted` · `--accent` | Elementos interactivos **dentro** de una tarjeta: inputs, chips no seleccionados, botones secundarios, hover |

`--border` e `--input` van **más luminosos que el nivel 2**: en dark mode la separación la dan
los bordes, nunca un `drop-shadow`. Y `--foreground` nunca es blanco puro.

**Lo que causó este sistema:** `--background` y `--card` eran el mismo valor, y
`--border`/`--secondary`/`--muted`/`--accent` eran idénticos entre sí. Cero elevación real —
todo pintado del mismo gris.

### Iconografía

Siempre de `lucide-react`, **nunca emojis sueltos**. Los emojis que quedan en píldoras y
microtextos (🔥, ✓, ⚠, 📷) vienen de specs anteriores y se mantienen.

### Animaciones

El plugin `tailwindcss-animate` es obligatorio: sin él, las clases
`animate-in`/`fade-in`/`slide-in-from-*` no generan ningún CSS y las animaciones simplemente no
ocurren, en silencio.

## Navegación

Sidebar: **Closer AI** · **Setter** · **Auditoría de Llamadas** (deshabilitado,
"Próximamente") · **Auditoría de Agentes** · **Gerencia** (deshabilitado) · **Ajustes**.

Al pie: **Sugerir Mejora (💡)** — popover que captura texto, usuario, fecha y vista activa, y
lo manda a la bandeja de Ajustes > Administración con un chip clicable de la vista de origen.
Y el **toggle de modo oscuro**.

Un ítem del sidebar siempre lleva a la raíz de su módulo.
