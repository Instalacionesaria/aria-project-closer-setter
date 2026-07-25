# Contexto — Seguimientos del Closer (Mi Día): del front actual al backend con IA

**Para**: un chat/dev que arranca de cero en esta tarea.
**Alcance**: SOLO la sección **Seguimientos** dentro de **Closer AI → Mi Día**. El resto de la app se describe únicamente en lo que la toca.
**Repo**: `aria-project-closer-setter` (Vite 5 + React + TypeScript + Tailwind, frontend-only).
**Fecha del análisis**: 2026-07-25. Último commit auditado: `ba6db41`.

> **Lee también `CLAUDE.md` en la raíz del repo.** Son 801 líneas y es la fuente de verdad del producto: define las reglas de negocio y el código las implementa, nunca al revés. Este documento no lo reemplaza — lo resume para esta tarea concreta y añade la auditoría de qué está construido y qué no.

---

## 1. El producto en un párrafo

**Comando Central** es el dashboard de un equipo comercial high-ticket que opera sobre **GoHighLevel (GHL)**. Dos roles operativos: **setter** (pre-agenda: del lead a la cita) y **closer** (post-agenda: de la cita a la venta). El embudo es Meta Lead Ads / VSL / Instagram → agente IA califica y agenda → cita → sales call del closer → venta ($4-8k high-ticket; hay un low-ticket de $97-500 para los que no califican).

## 2. Arquitectura declarada vs. arquitectura real

`CLAUDE.md` §2 define tres capas:

| Capa | Rol | Estado real |
|---|---|---|
| **GHL** | Fuente de verdad: contactos, custom fields, tags, stages, citas, conversaciones | Existe (es el CRM del cliente), pero **este repo no habla con él** |
| **Motor IA (Supabase)** | Analiza cada conversación UNA vez → 4 salidas: auditoría de agentes, sentimiento, briefing, extracción de perfil. Escribe eventos en Supabase, aplica tags vía API. Atribuido a "Kevin" en el spec | **No existe en este repo.** Ninguna referencia en el código |
| **Este frontend** | Muestra estado y registra decisiones humanas. Regla dura: nunca calcula al renderizar, nunca consulta servicios externos en vivo | Existe y está muy completo visualmente |

**Verificado con grep sobre todo `src/`**: cero `fetch`, cero cliente Supabase, cero `import.meta.env`/`VITE_*`, cero SDK de GHL. La única persistencia de toda la app es `localStorage` en `settingsStore.tsx`, y solo cuando el usuario pulsa "Guardar Cambios".

**Conclusión: todo lo que se ve son datos semilla en memoria.** `closerStore.tsx` (~41 KB) construye un `Record<string, ClosurerContact>` al montar el provider. Cualquier acción muta ese objeto en React state y se pierde al refrescar.

## 3. Dónde vive el código de esta sección

| Pieza | Archivo | Referencia |
|---|---|---|
| Vista Mi Día (closer) | `src/views/CloserAI.tsx` | `MiDiaTab`, línea ~575 |
| Render de la sección Seguimientos | `src/views/CloserAI.tsx` | línea ~878, `id="midia-seguimientos"` |
| Store, tipos y acciones | `src/lib/closerStore.tsx` | — |
| Modal "Avanzar" (donde nace un seguimiento) | `src/views/ContactDrawer.tsx` | `CloserAvanzar` (~276), `CloserSeguimientoFlow` (~628), `SeguimientoScreen` (~524) |
| Ficha del contacto (drawer global) | `src/views/ContactDrawer.tsx` | 94 KB, el componente más grande del repo |

Sin backend, sin carpeta `api/`, sin tests.

## 4. Qué hace hoy la sección Seguimientos

### 4.1 Criterio de aparición

Un contacto se lista en "Seguimientos de hoy" si y solo si tiene el campo `seguimientoPendiente` y no está `completedToday`. El tipo completo (`closerStore.tsx:159`):

```ts
export interface SeguimientoPendienteInfo {
  microtext: string;   // texto libre, ej. "vencido hace 1 día"
  vencido?: boolean;   // pinta el microtexto en rojo
}
```

**Eso es todo el modelo de datos de un seguimiento.** No hay fecha, no hay situación, no hay modo (auto/manual), no hay contador de toques, no hay ID. `"vencido hace 1 día"` es un string hardcodeado en la semilla, no un cálculo contra ninguna fecha.

Hoy solo dos contactos demo lo tienen: `RODRIGO SILVA` (vencido) y `VALERIA CASTRO` (programado para hoy).

Nota: `seguimientoPendiente` (presencia en la cola de Mi Día) es un concepto **distinto** de `stage: "seguimiento"` (columna del Pipeline). Un contacto puede estar en el stage sin tener tarea hoy.

### 4.2 El flujo de creación (front completo, diseño aprobado)

Se dispara desde la ficha del contacto → botón **"Avanzar"** (el único registro de resultados en todo el producto) → tarjeta **"Seguimiento"** del grid de 6 salidas. Especificado en `CLAUDE.md` §16.1 y §39.1. Son dos pantallas:

**Pantalla 1 — "¿Cómo está el contacto?"** (obligatoria, cinco tarjetas de más caliente a más frío):

| Situación | Descripción | Tono |
|---|---|---|
| 🔥 Próximo a pagar | "Dijo que sí, es cuestión de días" | emerald |
| ⭐ Muy interesado | "Quiere, sin fecha de pago aún" | amber |
| ❓ Dudando | "Tiene una objeción sin resolver" | violet |
| ❄️ Enfriándose | "Perdiendo interés, riesgo de fuga" | blue |
| Otro | "Situación no listada" | slate |

**Pantalla 2 — "¿Cuándo lo retomas?"** — dos grupos **mutuamente excluyentes** (elegir uno atenúa el otro al 40% y lo desactiva):

- ⚡ **Seguimiento automático** — "el sistema persigue por ti". Para el closer hay una sola opción: **Recupero, 3 toques · 7 días**. Enciende el ícono ⏱ del contacto.
- 👤 **Seguimiento manual** — "tú lo retomas". Chips: `Mañana` / `En 3 días` / `1 semana` / `Personalizada` (con date picker). No enciende ⏱.

Nota opcional en ambos casos. El botón de confirmar está deshabilitado hasta que haya selección válida.

**Vocabulario obligatorio**: se dice "seguimiento automático", **nunca "cadencia"** (`CLAUDE.md` §3). Ojo: el campo interno del código sí se llama `cadenciaActiva` — es deuda de nombre, no texto de usuario.

### 4.3 Qué pasa realmente al confirmar — aquí está el agujero

`SeguimientoScreen.confirm()` (`ContactDrawer.tsx:562`) construye un objeto y lo pasa a `advance()` del store. Extracto real:

```ts
const effectiveFecha = manualPick === "Personalizada"
  ? customFecha
  : isoInDays(manualPick === "Mañana" ? 1 : manualPick === "En 3 días" ? 3 : 7);

onConfirm({
  pildora: `SEGUIMIENTO · ${situacionPill}`,
  texto: `Seguimiento manual · para el ${shortDate(effectiveFecha)}`,
  toast: `Seguimiento programado — ${shortDate(effectiveFecha)}`,
  nota: ...,
  stage,
  cadenciaActiva: false,
});
```

**La fecha se calcula y se tira.** `effectiveFecha` solo se interpola dentro de dos strings de presentación (`texto`, `toast`). Nunca llega al modelo de datos como fecha.

Y `advance()` (`closerStore.tsx:660`) hace exactamente esto:

- cambia `situacion` a la píldora (`SEGUIMIENTO · MUY INTERESADO`),
- añade una línea al historial y la nota si la hay,
- setea `cadenciaActiva: true|false`,
- mata el agente IA (`botEstado: "muerto_postcall"` — regla §34: la IA muere tras la sales call, salvo No-show),
- y marca **`completedToday: true`**.

**No crea `seguimientoPendiente`.** El resultado neto es que registrar un seguimiento **saca al contacto de Mi Día y no lo devuelve nunca**. La tarea que acabas de pactar no existe.

### 4.4 Inventario de lo que es fachada

| Elemento visible | Realidad |
|---|---|
| Fecha del seguimiento manual | Se calcula, se muestra en un toast, se descarta |
| Ícono ⏱ "seguimiento automático activo" | Un booleano que solo controla la opacidad de un ícono |
| Serie "3 toques · 7 días" | No existe. No hay scheduler, ni contador de toques, ni mensajes |
| Microtexto de la fila ("vencido hace 1 día") | String literal en la semilla |
| "Seguimiento agotado — revisar" | Descrito en el spec (§16.1.D) como dato demo del setter; no hay lógica que lo genere |
| Tope de 3 rescates → Nurture | Documentado en el spec (§13); explícitamente **no implementado** |
| Narrativa de última actividad | Campo `activity`, string de la semilla. El spec dice que lo genera el motor IA |

## 5. Reglas de negocio que el backend debe respetar

Extraídas de `CLAUDE.md`; violarlas rompe el producto.

1. **§4.4 Fuente única de verdad** — ninguna vista tiene estado propio. Registrar algo actualiza al instante Inicio, Mi Día, Pipeline, Agenda, Ficha, Historial. El backend debe ser esa fuente única; nada de estado duplicado por vista.
2. **§2 El frontend no calcula** — nunca computa al renderizar ni llama a servicios externos en vivo. Lee estado ya resuelto. Los derivados (vencido/no vencido, toques restantes, narrativa) los produce el backend.
3. **§4.12 "Avanzar" es el ÚNICO registro de resultados humanos.** Ningún otro control registra outcome.
4. **§2 Los eventos automáticos** (cita por link, pago por webhook, toque de una serie) se registran solos con autor **`Sistema`** y **JAMÁS** pasan por Avanzar. El historial es un timeline inmutable con autor real.
5. **§12 / §39.3 Píldora = `CATEGORÍA · SUBCATEGORÍA`**, en mayúsculas, y refleja la **situación real** del contacto. Para el closer, un seguimiento **siempre** produce `SEGUIMIENTO · {SITUACIÓN}` — la fecha del manual va en la segunda línea de la fila, **nunca** en la píldora. Una condición temporal (vencido, estancado) se comunica con tinte de fila, jamás como píldora.
6. **§4.1 Los ceros no se renderizan.** Contador en cero = ícono atenuado sin número. Secciones vacías de Mi Día se ocultan, excepto "Completadas Hoy".
7. **§4.10 Sin dato, no hay elemento.** Nada de placeholders inventados. Score sin datos → `"—"`.
8. **§40.E Si la IA está activa, no hay tarea humana.** Un contacto con el bot en `activo` no debe generar tarea en Mi Día — es contradictorio y el spec lo audita explícitamente.
9. **§34 La IA muere tras la sales call** (`muerto_postcall`), salvo No-show, que la reactiva para el workflow de recuperación. Instagram nunca tuvo bot. **Esto choca de frente con los toques automáticos del seguimiento** — ver §7.
10. **§4.9 Todo porcentaje lleva su base** ("X de Y").

## 6. Lo que falta construir, en orden de dependencia

### 6.1 Persistencia (bloquea todo lo demás)

Una entidad `seguimiento` real. Como mínimo:

```
id, contacto_id, closer_id
situacion          -- proximo_a_pagar | muy_interesado | dudando | enfriandose | otro
modo               -- automatico | manual
fecha_objetivo     -- date (manual: la fecha pactada; automático: la del próximo toque)
toques_dados       -- int, solo automático
toques_totales     -- int (3 para "Recupero")
estado             -- pendiente | completado | agotado | cancelado
nota, created_at, created_by
```

Y `advance()` debe crear el registro **y** poblar `seguimientoPendiente` para que la tarea reaparezca. Hoy hace lo contrario: marca `completedToday`.

### 6.2 Scheduler

- **Manual**: despertar la tarea el día pactado y marcarla vencida si pasa.
- **Automático**: disparar 3 toques cada ~7 días.
- **Tope de serie**: agotada sin respuesta → tarea `"Seguimiento agotado — revisar"` con autor `Sistema` (el spec ya define el caso y hasta el dato demo, §16.1.D).
- **Cancelación**: si el contacto responde, la serie muere y pasa a "Respondieron".

### 6.3 La capa de IA

El spec le asigna al motor cosas que hoy son strings muertos:

- **Redactar el mensaje de cada toque** según la situación. Un "Próximo a pagar" no se persigue con el mismo tono que un "Enfriándose" — esa es toda la razón de ser de la Pantalla 1.
- **Generar el microtexto / narrativa** de la fila (campo `activity`) desde eventos reales.
- **Detectar la respuesta** del contacto para cancelar la serie y reclasificar la tarea.
- **Briefing**: 2-3 líneas (quién es · de dónde vino · qué le importa u objeción), solo de eventos reales.

Restricción dura de `CLAUDE.md` §9: **ninguna señal de engagement modifica la letra del Score** (A/B/C/D = fit, casi estático). Hay un diseño de superíndice numérico para engagement, en standby: **no implementarlo sin spec explícito**.

### 6.4 Integración con GHL

Mover el stage del pipeline vía API y aplicar/quitar el tag `seguimiento_activo` (los tags son los interruptores de los workflows de GHL). El spec menciona un doc hermano `CONTRATO-GHL-Kevin.md` con los nombres exactos de tags, custom fields y stages — **no está en este repo, hay que pedírselo a Francisco**. Sin él no se puede escribir la integración sin adivinar.

## 7. Decisiones abiertas (resolver antes de escribir código)

1. **¿Dónde vive la lógica?** El spec asume que Kevin construye el motor en Supabase y este front solo lee. Si la lógica de seguimientos se implementa por fuera, hay que decidir si se escribe dentro de ese motor o se levanta un backend propio. Cambia la forma de todo lo demás y arriesga dos fuentes de verdad, que es justo lo que la regla §4.4 prohíbe.
2. **Contradicción real: §34 vs. toques automáticos.** La regla dice que tras la sales call el agente IA muere para siempre (y `advance()` lo implementa: `botEstado: "muerto_postcall"`). Pero un seguimiento automático post-call necesita a alguien enviando 3 mensajes. ¿Los envía un agente distinto? ¿Es una excepción a §34? **No está definido y bloquea el diseño del automático.**
3. **La situación de la Pantalla 1 no se persiste como dato**, solo como texto dentro de la píldora. Si la IA va a decidir el tono del mensaje según la situación, tiene que ser un campo, no un substring.
4. **Formato de la fecha**: `customFecha` viene de un input date; `isoInDays()` produce ISO. No hay manejo de zona horaria en ninguna parte del repo. Definirlo antes de que "mañana" signifique dos días distintos.
5. **Instagram**: canal sin bot (§11). ¿Un seguimiento automático sobre un contacto de IG simplemente no se ofrece? Hoy la UI lo ofrece igual.
6. **Deuda de nombre**: el campo interno `cadenciaActiva` usa la palabra prohibida. Si se toca el modelo, es el momento de renombrarlo (`seguimientoAutomaticoActivo`). `CLAUDE.md` §15.3 ya lista "eliminar cadencia de la UI" como deuda pendiente.

## 8. Cómo levantar el proyecto

```bash
cd C:\PROYECTOS\aria-project-closer-setter && npm install && npm run dev
```

Corre en `http://localhost:5173`. `npx tsc --noEmit` pasa limpio.

**Gotcha de instalación**: npm bloquea el postinstall de `esbuild` por política de scripts; sin aprobarlo, Vite no arranca. Se resuelve con `npm approve-scripts esbuild` y reinstalando. `npm audit` reporta 3 vulnerabilidades en dependencias de desarrollo (1 moderada, 2 altas); el `fix --force` implica cambios rompedores, así que se dejaron sin tocar.

**Ruta en la UI**: sidebar → **Closer AI** → pestaña **Mi Día** → sección **"Seguimientos de hoy"** (fondo ámbar). Para ver el flujo de creación: clic en cualquier fila → se abre la ficha como drawer → botón **"Avanzar"** → tarjeta **"Seguimiento"**.

## 9. Convención de trabajo del repo

`CLAUDE.md` §49 lo establece y las 49 secciones del documento lo demuestran: **cada cambio de comportamiento se documenta ahí con fecha y razón** antes o junto al código. El archivo es un registro de decisiones de producto, no un readme. Si cambias el modelo de datos de los seguimientos, va con su sección nueva.
