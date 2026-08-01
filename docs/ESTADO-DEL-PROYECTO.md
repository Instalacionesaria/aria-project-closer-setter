# Estado del proyecto — Comando Central

**Última actualización: 2026-07-30.** Este documento dice qué está hecho, qué está a medias
y qué no existe. Se actualiza en cada sesión de trabajo.

> Para el **porqué** de las decisiones: `CLAUDE.md` §50 y
> `docs/CONTEXTO-Seguimiento-Closer-Backend.md`.
> Para el **esquema de la base**: `docs/db/README.md`.
> Para **armar los webhooks en GHL**: `docs/WEBHOOKS-APIS-Y-POLLING.md`.

---

## Resumen en una línea

El **frontend está completo** desde hace tiempo. El **backend recién arranca**: de todo el
producto, hoy solo la sección *Seguimientos* del closer escribe y lee de verdad.

---

## Infraestructura — lista

| Pieza | Estado |
|---|---|
| Base de datos (Supabase SOFIA, 11 tablas `closer_*`) | ✅ Aplicada y verificada (migraciones 001–008) |
| RLS en las 11 tablas | ✅ Verificado con la llave `anon`, no solo con `pg_class` |
| Integración con GHL (lectura y escritura) | ✅ Funcionando en producción |
| Despliegue automático (push a `main` → Vercel) | ✅ Funcionando |
| Diagnóstico (`/api/diagnostico`) | ✅ `ok: true` |
| Tests | ✅ 91 unitarios + 10 de integración |

---

## Módulo Closer

### Mi Día

| Sección | Backend | Notas |
|---|---|---|
| **Seguimientos de hoy** | ✅ Completo | Lee, escribe, persiste, y escribe tags y campos en GHL |
| **Agenda de Hoy** | ✅ Endpoint | `GET /api/closer/agenda` — calendario real de GHL, en vivo (Kevin) |
| **Respondieron / Buzón** | ✅ Endpoint | `GET /api/closer/respondieron` — conversaciones reales de GHL (Kevin) |
| **Completadas Hoy** | 🟡 A medias | Se calcula en la vista `closer_mi_dia`; falta exponerla |
| **Intervenciones urgentes** | ✅ Endpoint | `GET /api/closer/urgentes` (Kevin). **El analizador de IA lo toma otra persona** |

**Los tres endpoints nuevos leen de GHL en vivo, no de la base** — o sea, ya son *polling*, que
es la dirección que se decidió el 2026-07-30 en reemplazo de los webhooks. Funcionan hoy sin
que Francisco tenga que crear nada.

#### Sobre el solapamiento con la vista `closer_mi_dia`

Las dos piezas calculan las mismas secciones, así que a primera vista una sobra. No es el caso:
**se reparten según quién es dueño del dato**, y hoy solo una de las dos devuelve algo.

| | Endpoints (Kevin) | Vista `closer_mi_dia` (mía) |
|---|---|---|
| Fuente | GHL, en vivo | `closer_contactos`, proyección en Supabase |
| Se llena con | nada, consulta directa | webhooks — que **nunca se crearon** |
| Filas hoy | datos reales | **0** (verificado el 2026-07-30) |

La vista no es código muerto: es lo único que sabe de **seguimientos** —
`fecha_objetivo`, manual/automático, `fijada`, `completada_dia`— y eso GHL no lo puede
responder, porque es justamente la desviación consciente del contrato §0 (`CLAUDE.md` §50.1).
Lo que sí sobra es tener **dos implementaciones del criterio de "en qué sección cae cada
contacto"**: al cablear el front hay que decidir uno de los dos como autoridad y que el otro
solo aporte su mitad, o los criterios se van a desalinear en silencio.

### Avanzar (las 6 salidas)

| Salida | Estado |
|---|---|
| Seguimiento | ✅ Completo, probado contra GHL real |
| Venta · Acordó comprar · No le interesa · No-show · Nurture | 🟡 Mapeadas, sin ejecutar |

El catálogo `src/lib/ghl/resultados.ts` ya tiene, para las 6, su tag, su custom field y sus
opciones. Falta generalizar el caso de uso —hoy solo sabe registrar Seguimiento— y quitar el
`501`.

⚠️ **Hueco conocido en Venta**: el monto tiene que llegar al *Opportunity Value* de GHL, y no
hay ningún custom field documentado para eso. O se crea uno, o hay que llamar a la API de
oportunidades. Sin resolver.

### La ficha del contacto

| Tab | Estado |
|---|---|
| **Notas** | 🟡 Tabla creada, sin endpoint ni lectura. Es lo que pidió Francisco para que el closer conserve sus apuntes |
| **Historial** | 🟡 A medias — los eventos **sí se escriben** en la base, pero la ficha muestra un array fijo. Falta el camino de vuelta |
| **Perfil** | ❌ Seed. Los custom fields ya están mapeados, así que sería directo |
| **Chat** | ❌ Seed, y peor: un único array compartido por *todos* los contactos |
| **Llamada** | ❌ Seed |
| Enviar un mensaje | ❌ Solo actualiza la pantalla |

### Otras vistas del closer

- **Pipeline**: seed.
- **Inicio (cockpit)**: números literales en el código; solo se mueven con lo registrado en
  la sesión.

---

## Cómo entran los datos — se cambió a *polling* (2026-07-30)

**Decisión: se consulta la API de GHL bajo demanda, en vez de esperar webhooks.** Ventaja
inmediata: no depende de que Francisco arme nada en GHL, y no hay un secreto compartido que
mantener. Los tres endpoints de Mi Día ya funcionan así.

El webhook **no se borró**: `/api/webhooks/ghl` sigue construido y desplegado, entiende 8
eventos y guarda todo crudo antes de interpretarlo. Queda como el camino de baja latencia
para cuando se quiera (la ficha de cada uno sigue en
`docs/WEBHOOKS-APIS-Y-POLLING.md`). Lo que cambia es que **ya no bloquea nada**.

Lo que sí queda pendiente de resolver con polling: **cada request pega contra GHL**, así que
hay que mirar los rate limits y decidir si conviene una caché corta. Sin resolver.

También existe `/api/closer/sincronizar`, que barre GHL y trae todos los contactos con
`zona_closer` a `closer_contactos`. Con polling deja de ser "la red de seguridad del webhook"
y pasa a ser lo único que llena la proyección de la base — hoy está en 0 filas.

---

## Planeado, todavía sin construir

**Pestaña de configuración de conexiones** — a la derecha del encabezado de las secciones de
Mi Día. Ahí van a vivir la API de la IA, la API de GHL y las variables por cuenta. Es la
razón por la que se quitó el badge "GHL conectado" que ocupaba ese lugar (2026-07-25): ese
espacio queda reservado. Mientras tanto, el estado real de las conexiones se consulta en
`/api/diagnostico`, que además dice **cuál** eslabón falla — más útil que un punto verde.

Esto conecta con el objetivo de fondo que mencionó Francisco: que a futuro **cada usuario de
la plataforma configure su propio GHL**. Hoy `GHL_LOCATION_ID` es una variable de entorno
global justamente por eso — es el dato que va a pasar a ser por cuenta.

## Lo que no tiene nada de backend

- **Módulo Setter completo** — ni una línea. Sus dos series están mapeadas pero nada las
  dispara.
- **Auditoría de Agentes** — todo seed, incluidos los conteos.
- **Gerencia** — dos objetos fijos en el código; el selector de rango no está conectado.
- **Ajustes** — `localStorage`, solo en el navegador de cada uno. El catálogo de enlaces, las
  comisiones y las sugerencias no se comparten.
- **Autenticación** — no existe. El closer está fijo como "Diego M." y el rol se cambia
  haciendo clic.
- **La IA que redacta los toques** — era parte del pedido original y sigue sin construirse.
  Es también la única parte con costo por uso.

---

## Decisiones que hay que tomar

| Qué | Quién |
|---|---|
| El valor del `X-Webhook-Secret` | Francisco |
| Confirmar los merge fields de cita de GHL | Francisco |
| `descalificado` se pinta de **tres formas** distintas: `NO LE INTERESA · X` (Avanzar), `DESCALIFICADO · X` (contrato §4 y §39.5) y `NO INTERESADO · PRECIO` (semilla) | Francisco |
| Cómo llega el monto de la venta al *Opportunity Value* | Francisco |
| `seguimiento_terminado` existe en la cuenta y no está en el contrato — parece el disparador de "serie agotada" | Francisco |
| `seguimiento: 1a/1b/2a/2b/3a/3b` parecen marcar cada toque; si es así, evitan depender de webhooks | Francisco |
| El contrato se contradice sobre `cita_agendada`: §9 dice que se quita al cerrar la cita, §8 dice que no | Francisco |

---

## Orden sugerido para seguir

1. **Cablear el front a los tres endpoints** (`agenda`, `respondieron`, `urgentes`), que ya
   devuelven datos reales. Al hacerlo, decidir quién manda en el criterio de sección —el
   endpoint o la vista— y dejarlo escrito, o los dos criterios se desalinean solos.
2. **Las 5 salidas restantes de Avanzar** — el catálogo está hecho, es generalizar el caso de
   uso y quitar el `501`.
3. **Notas e Historial** en la ficha: las tablas existen y los eventos ya se escriben; falta
   el endpoint de vuelta.
4. Después: Perfil, Chat real, y el módulo Setter.

---

## Cosas operativas que conviene no olvidar

- **Los datos de demostración empiezan con `EJEMPLO`.** Si ves un contacto sin ese prefijo,
  es real y viene de GHL.
- **El commit lo tiene que firmar `instalacionesariaia@gmail.com`** o Vercel bloquea el
  build *y marca el deploy como exitoso igual*. Detalle en `CLAUDE.md` §50.8.
- **Los imports de `api/` llevan extensión `.js`.** `tsc` no lo detecta; falla solo en
  producción. `CLAUDE.md` §50.9.
- **`CONTRATO-GHL.md` no está en el repo** — está en `.gitignore`. Pedírselo a Francisco.
- **Rotar credenciales**: el token de Supabase y el de GHL circularon por un chat. Conviene
  regenerarlos.
