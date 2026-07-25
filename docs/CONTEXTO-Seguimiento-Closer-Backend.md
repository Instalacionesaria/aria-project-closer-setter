# Contexto — Seguimientos del Closer: del prototipo al backend real

**Para**: cualquiera que retome este módulo.
**Última actualización**: 2026-07-25. Rama `main`, desplegado en producción.

> Este documento cuenta **qué cambió y por qué**. Las reglas de producto viven en
> `CLAUDE.md` (§50 es la sección de este trabajo); los nombres literales de GHL, en
> `docs/CONTRATO-GHL.md`; el esquema de la base, en `docs/db/README.md`.

---

## 1. Qué era esto antes

Un frontend sin backend. Cero `fetch`, cero base de datos, cero integración. 38 contactos
falsos en memoria que se reseteaban con cada F5.

La sección **Closer AI → Mi Día → "Seguimientos de hoy"** tenía el flujo visual completo y
aprobado, pero no guardaba nada: la fecha se calculaba, se interpolaba en dos strings y se
descartaba. Pactar un seguimiento sacaba al contacto de Mi Día y no lo devolvía nunca.

## 2. Qué es ahora

```
Browser (React)      api/ en este repo         GoHighLevel        Supabase SOFIA
  closerStore ─HTTP─▶  funciones Vercel  ──▶  tags, custom        estado operativo
  arma píldora         (las escribimos    ─▶  fields, stages       del tool
  y secciones           nosotros)             = verdad del
                                               negocio
```

Funcionando en producción. Verificable en **`/api/diagnostico`**, que comprueba cada eslabón
por separado y devuelve 200 o 503.

---

## 3. El cambio más importante: la identidad de los contactos

**Antes, la clave primaria de toda la app era el nombre en mayúsculas.** `contacts["RODRIGO
SILVA"]`, y las 14 acciones de los dos stores recibían `name: string`.

Eso no sobrevive al contacto con datos reales:

- Dos homónimos se pisan en silencio. La semilla ya tenía cinco apellidos `GOMEZ`.
- Corregir un nombre en GHL pierde todo el estado asociado.
- No hay forma de escribirle a GHL, que identifica por id.

**Ahora los contactos reales se keyean por `ghlContactId`.** El campo nuevo en
`ClosurerContact` es la marca de agua que distingue los dos mundos:

```ts
interface ClosurerContact {
  name: string;
  /** Presente = viene de GHL. Ausente = es de la semilla del demo. */
  ghlContactId?: string;
  // ...
}
```

Y decide el comportamiento: `advance()` persiste contra el servidor **solo** si el contacto
tiene `ghlContactId`; si no, se queda en memoria como siempre.

### Por qué NO se migró toda la app

Los 38 contactos de la semilla siguen keyeados por nombre, conviviendo con los reales en el
mismo `Record`. La clave es un string y a las vistas les da igual si es un nombre o un id.

Migrar todo habría tocado los dos stores, las ocho vistas consumidoras y todos los
`key={c.name}` — para poder mostrar tres contactos reales. **Queda pendiente**, y cuando se
haga, el camino es: `openContactName` → `openContactId`, y las 14 acciones a recibir id.

---

## 4. Reparto: qué guarda GHL y qué guarda Supabase

`CONTRATO-GHL.md` §0 dice que *"el tool NO es una base de datos"*. Se respeta casi entero.

| Dato | Vive en | Por qué |
|---|---|---|
| Situación del seguimiento | **GHL** `contact.nivel_de_inters_seguimiento` | Custom field real; pinta la subcategoría de la píldora |
| Modo automático | **GHL** tag `seguimiento_recupero` | Es el interruptor de la serie |
| Modo manual | **GHL** tag `seguimiento_manual` | GHL solo necesita saber que no debe perseguirlo |
| Stage del pipeline | **GHL** | Lo mueve un workflow disparado por tag; el tool nunca lo escribe |
| **Fecha objetivo del manual** | **SOFIA** | ⚠️ La excepción — ver abajo |
| Nota, fijar, completado del día | **SOFIA** | Estado de la cola de trabajo, no del negocio |

**La desviación consciente**: la fecha del seguimiento manual. GHL solo necesita saber que
el contacto está en modo manual; el día exacto en que reaparece en la cola es lógica de cola
de trabajo, y no tiene campo ni workflow en el contrato. Decidido el 2026-07-25.

**Lo que el contrato SÍ impone y acá se respeta**: el tool **arma la píldora** a partir de
stage + custom field crudos, y decide en qué sección aparece cada contacto. Eso invierte
`CLAUDE.md` §2 ("el frontend no calcula"). El contrato es más nuevo y más específico: gana.

---

## 5. La base de datos

Esquema completo en `docs/db/README.md`. Lo esencial:

**7 tablas en `public` con prefijo `closer_`**, no en un esquema propio. SOFIA ya aloja
cuatro sistemas (`agentforge_*`, `aria_brain_*`, `ht_*`, `ob_*`) con esa convención, y un
esquema aparte habría obligado a exponerlo en PostgREST — un ajuste a nivel proyecto que
afecta a los otros sistemas.

**RLS activado en las 7, sin políticas.** `public` está expuesto por PostgREST: una tabla sin
RLS es legible **y escribible** con la anon key, la que viaja en el bundle del browser. Sin
políticas solo pasa `service_role`, o sea que todo el acceso entra por `api/`.

Auditado con la anon key contra la base real: el INSERT lo bloquea el RLS, la RPC de registro
da *permission denied*, y las lecturas devuelven cero filas.

**Invariantes que garantiza la base, no el código:**

- Un solo seguimiento abierto por contacto — índice parcial único. El doble submit pasa a ser
  una violación reintentable en vez de dos filas y dos tags en GHL.
- `closer_hoy_org()` es el único origen de "hoy". Nunca `current_date`: Supabase corre en UTC
  y a las 20:00 de Lima daría el día siguiente.
- El historial rechaza UPDATE por trigger. La historia no se reescribe.
- Un evento de sistema no puede firmar como persona (`CHECK`). Es `CLAUDE.md` §2 como
  constraint.
- Un toque reenviado por un reintento de GHL no se cuenta dos veces.

---

## 6. Las tres reglas de producto nuevas

Ninguna estaba en un documento previo.

1. **"Seguimientos de hoy" = solo manuales.** Una serie automática en curso NO genera fila:
   §16.1 define el automático como "el sistema persigue por ti", y su resultado confirmado es
   píldora + ⏱ + evento, sin tarea. Aflora una sola vez, cuando la serie se agota. Si el
   contacto responde antes, vuelve por Buzón general o Urgentes.
2. **Cancelación universal.** Cualquier resultado de Avanzar cierra el seguimiento abierto,
   autor `Sistema`. Es lo que evita que un trato ganado siga siendo perseguido.
3. **Uno solo abierto por contacto.** Repactar reemplaza; contactos distintos no se tocan.

### Sin cron: la cola es una consulta

No hay proceso que "active" seguimientos. La condición es `fecha_objetivo <= hoy_org()`: el
día 4 una fila con fecha 5 no cumple, el día 5 la misma fila cumple sin que nadie la toque.

Estado derivado, no mutado. Un cron puede no correr, correr dos veces o fallar en silencio —
y ahí sí se pierden seguimientos.

---

## 7. Datos de demostración: prefijo `EJEMPLO`

**Todo contacto de demostración empieza con `EJEMPLO`** (`EJEMPLO RODRIGO SILVA`). Regla de
Francisco, 2026-07-25: en producción hay que poder distinguir de un vistazo un contacto real
de uno inventado.

El prefijo va en los cuatro lugares a la vez —`closerStore`, `setterStore`, el `SCHEDULE` de
`CloserAI` y `agentAuditStore`— porque el nombre es a la vez texto visible **y** clave del
`Record`, y Agents Audit cruza por nombre. Si uno queda sin prefijar, abrir la ficha desde
una evidencia deja de encontrar al contacto.

**Los nombres de los agentes (`Lead Flow AI`, `Appointment Flow Voz`) NO llevan prefijo**: son
entidades reales del producto, no datos de demostración.

**La sección "Agenda de Hoy" se vació**: se quitó el campo `agenda` de los 6 contactos
semilla que lo tenían, para que la prueba se concentre en Seguimientos. Y se le agregó el
conditional que faltaba — ahora se oculta cuando está vacía, que es la regla §4.1 y hasta
ahora no se cumplía ahí (mostraba el encabezado con un "0").

---

## 8. Trampas que solo aparecieron contra los sistemas reales

Ninguna se ve compilando. Cada una costó una verificación contra producción.

### El custom field se escribe por `id`, no por `key`

Mandarlo por `key` —como lo documenta el contrato §4 y como parece natural— devuelve **200 y
no escribe nada**. Comprobado con las tres variantes:

| Forma | Resultado |
|---|---|
| `{ key, field_value }` | 200 — y el campo vacío |
| `{ id, field_value }` | escribe |
| `{ id, value }` | escribe |

Al leer, GHL devuelve `{id, value}` sin la key. `api/_lib/ghl/real.ts` cachea el catálogo
key↔id. **Sin leer de vuelta para verificar, el sistema habría reportado "situación guardada"
durante meses.**

### Los imports de `api/` llevan extensión `.js` — obligatorio

`"type": "module"` + Node 24 = ESM nativo, que no resuelve imports relativos sin extensión.
Tampoco existen los imports a carpetas: `./_lib/ghl` tiene que ser `./_lib/ghl/index.js`.
Alcanza también a los módulos de `src/` que las funciones importan en cadena.

`tsc -b` **no lo detecta** (con `moduleResolution: "bundler"` son válidos) y el error de
Vercel (`FUNCTION_INVOCATION_FAILED`) no dice cuál módulo. Detalle y método de diagnóstico en
`CLAUDE.md` §50.9.

### El plan Hobby de Vercel bloquea commits de quien no es dueño

Y falla de la peor forma: marca el deployment como `success` en GitHub y deja la URL sirviendo
el build anterior. Check verde, página que carga, código viejo. Detalle en `CLAUDE.md` §50.8.

### Registrar un seguimiento tiene que ser atómico

Son cuatro escrituras. Desde Node eran cuatro round trips sin transacción: si la creación
fallaba tras cerrar el anterior, el contacto quedaba **sin** seguimiento en silencio. Vive en
`closer_registrar_seguimiento()` (`docs/db/003_*.sql`).

---

## 9. Tres bugs preexistentes, corregidos de paso

- **El ⏱ nunca se apagaba.** `?? c.cadenciaActiva` conservaba el valor previo y solo la
  salida Seguimiento escribía el campo, así que una Venta dejaba el reloj encendido sobre un
  trato ganado. Ahora se deriva de la serie pendiente.
- **"Mañana" devolvía pasado mañana** después de las 19:00 en Lima: `isoInDays` hacía
  aritmética local y luego `toISOString()`, que pasa a UTC antes de truncar. Eliminado; ver
  `src/lib/fechas.ts`.
- **Resurrección con la píldora equivocada.** `advance()` no limpiaba `respondido` ni
  `seguimientoPendiente`, así que tras una Venta se podía pulsar FIJAR y el contacto volvía a
  la cola luciendo `VENTA · $5.000`.

`cadenciaActiva` → `seguimientoAutomaticoActivo` en los dos stores (deuda de §15.3; §3
prohíbe la palabra "cadencia").

---

## 10. Cómo correr y probar

```bash
npm install && npm run dev      # demo pura, sin red
npm test                        # 91 tests, offline
```

**Sin backend la app corre con la semilla.** No hay variable de entorno en el frontend: la
ruta es `/api` por constante y el "modo demo" sale del manejo de errores. Un clone limpio no
se rompe por falta de configuración.

Pruebas contra los sistemas reales (opt-in, necesitan `.env.local`):

```bash
$env:INTEGRACION=1;            npx vitest run api/_lib/integracion.test.ts
$env:INTEGRACION_ESCRITURA=1;  # además, escribe en GHL sobre un contacto que crea y borra
```

⚠️ La escritura solo prueba **modo manual**. `seguimiento_manual` no tiene workflow
enganchado; `seguimiento_recupero` dispara la serie, que envía tres mensajes reales durante
siete días y eso no se deshace quitando el tag.

### Variables de entorno: tres, y solo dos son secretos

| Variable | Por qué |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Secreto. Permiso total sobre la base |
| `GHL_PIT` | Secreto. Private Integration Token |
| `GHL_LOCATION_ID` | No es secreto, pero a futuro cada cliente tendrá el suyo |

La URL de SOFIA es una constante (permanente y no secreta). El modo de GHL se deduce: con
credenciales es `real`, sin ellas `stub`. `GHL_MODO=stub` sigue sirviendo de freno manual.

---

## 11. Estado y límites conocidos

- **Solo la salida Seguimiento** está implementada. Las otras cinco devuelven 501 en vez de
  fingir: cada una tiene su tag y su campo, y aplicarlos mal dispara el workflow equivocado.
- **El adapter stub no pierde nada.** Cada efecto queda en `closer_ghl_outbox` con estado
  `omitido_stub` — una cola de replay.
- **La cuenta de GHL está casi vacía**: 3 contactos con `zona_closer`, ninguno con cita ni
  seguimiento. La sección va a estar legítimamente vacía hasta que entren leads reales.
- **`zona_closer` es el portón de entrada** al módulo (verificado contra el contrato). Es
  territorio, no asignación: dice que el contacto está en el mundo del closer, no de cuál.
  Con más de un closer hará falta el owner de la oportunidad.
- **`seguimiento_activo` sigue existiendo en la cuenta** aunque el contrato lo declare
  eliminado. El del closer es `seguimiento_recupero`. La nota del contrato describe una
  intención, no el estado real.

### Pendientes para Francisco

- **`descalificado` se pinta de tres formas** según dónde se mire: `NO LE INTERESA · X`
  (Avanzar), `DESCALIFICADO · X` (contrato §4 y §39.5) y `NO INTERESADO · PRECIO` (semilla).
  Hay que elegir una.
- **`seguimiento_terminado`** existe en la cuenta y no está en el contrato. Por el nombre
  parece el disparador de "serie agotada" que falta para §16.1.D. Queda en solo lectura hasta
  saber quién lo aplica.
- **`seguimiento: 1a/1b/2a/2b/3a/3b`** parecen marcar cada toque enviado de las series. Si es
  así, son la vía para conocer los toques sin depender de webhooks.
- **El contrato se contradice sobre `cita_agendada`**: §9 dice que se quita al cerrar la cita,
  §8 dice que no. Afecta a la lógica de `Resultado de call`.
