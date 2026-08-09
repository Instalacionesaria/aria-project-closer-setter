# Estado del proyecto

**Actualizado: 2026-08-08.** Qué está construido, qué está a medias y qué no existe.

> Este es el documento que más rápido queda viejo. Si la fecha de arriba tiene más de dos
> semanas, verificá antes de confiar.

## En una línea

El módulo Closer está conectado a datos reales de punta a punta. **La plataforma es
multi-empresa** desde el 2026-08-07: autenticación, roles, credenciales cifradas por empresa y
aislamiento en tres capas — ver [12-MULTIEMPRESA](12-MULTIEMPRESA.md). El Setter y Auditoría de
Agentes tienen la estructura hecha pero les falta backend o les falta que Francisco publique
configuración en GHL.

## Infraestructura

| Pieza | Estado |
|---|---|
| Frontend en Vercel | ✅ Producción, deploy por push a `main` |
| Vercel Functions (`api/`) | ✅ 40 endpoints, todos con portero de rol |
| Supabase SOFIA | ✅ 31 migraciones aplicadas |
| Multi-empresa | ✅ ARIA + hasta 4 clientes. Aislamiento en 3 capas, con tests que lo hacen cumplir |
| Autenticación | ✅ Sesiones con cookie `httpOnly`, scrypt, 6 roles, bloqueo por intentos, auditoría |
| Credenciales por empresa | ✅ AES-256-GCM. Ningún secreto en claro en Supabase ni en el browser |
| Integración Meta (lectura) | ⚠️ Construida y **nunca ejecutada**: falta cargar las credenciales de una cuenta real |
| Integración GHL (lectura) | ✅ Contactos, citas, conversaciones, custom fields |
| Integración GHL (escritura) | ✅ Aplicar y quitar tags, custom fields, notas |
| Webhooks de GHL | ⚠️ El endpoint existe y rutea por `locationId`; los workflows los tiene que crear Francisco |
| Webhook de llamadas (Assistable) | ✅ Recibe, redacta secretos, parsea y archiva en `closer_llamadas` |
| Anthropic (auditor) | ✅ Cableado. **En cero por decisión** — ver abajo |

## Closer — completo

| Vista | Estado |
|---|---|
| Inicio (cockpit) | ✅ Métricas reales de Supabase |
| Mi Día — las 5 colas | ✅ Todas derivadas, cero flags |
| Pipeline — 7 etapas | ✅ Por etapa, con congelados visibles |
| Agenda | ✅ Citas reales + briefing |
| Ficha: Chat | ✅ Conversación real, envío real, estados de entrega |
| Ficha: Perfil | ✅ Custom fields reales agrupados por significado |
| Ficha: Historial / Notas | ✅ Persistidos |
| Ficha: Llamada | ✅ Llamadas reales de Assistable. **Ninguna contestada todavía** — las 3 que hay cayeron en buzón |
| Avanzar (6 salidas) | ✅ Persiste en Supabase y aplica tags en GHL |
| Seguimientos | ✅ Automáticos y manuales, con su cola |

## Setter — estructura sí, backend parcial

| Qué | Estado |
|---|---|
| Las 6 colas de Mi Día | ⚠️ La estructura está; parte de los datos siguen siendo semilla |
| Pipeline de 7 etapas | ⚠️ Renderiza 2 columnas |
| Avanzar (5 salidas) | ✅ Funciona, persiste en su store |
| Cockpit de comisiones | ⚠️ Los dos tramos calculan de verdad; las "diferidas" salen de una base de referencia |
| Cola de urgentes | ⏸ **Vacía a propósito** — su auditor no existe |
| Ficha | ✅ Compartida con el closer |

**El latch de atribución** (`atribucionSetter`) es real y se enciende con la primera
intervención manual. Lo que falta es cruzar los stores para sumar ventas HT reales de contactos
marcados — requiere que el contacto del closer sepa qué setter lo originó.

## Auditoría de Agentes — cableada, esperando datos

| Qué | Estado |
|---|---|
| Las 4 tarjetas | ✅ Sin semillas. 1 con auditor, 3 con su motivo explícito |
| Endpoints (`texto`, `alertas`, `ajustes`, `auditor-estado`, `prompts`) | ✅ Todos en producción |
| Alertas agrupadas por patrón | ✅ Con evidencia, diagnóstico y bloque de corrección |
| Historial de ajustes | ✅ Persistido, con fecha y **autor de la sesión** (ya no "Jorge Q.") |
| Bloque DICE AHORA → DEBERÍA DECIR | ✅ Se activa cuando el prompt esté cargado |
| **Pestaña Prompts** | ✅ Nueva (2026-08-07). Habilitada para `tecnico`, verificado en el backend |
| **Carril rojo · nivel 0** | ✅ 5 heurísticas de costo cero. Cierra el agujero del debounce de 4 mensajes |
| **Carril amarillo** | ✅ Cron diario 16:00 Lima, 1 mejora por empresa/agente/día. **Sin correr todavía** |
| Datos | ⏸ **Casi cero análisis** — ver abajo |

## Lo que bloquea, en orden de impacto

### 1. Francisco: publicar los workflows de `bot_activado`

**Es lo único que separa al auditor de estar funcionando.** Los workflows `🟦 08.1` y `🟦 08.2`
están en borrador; ningún contacto tiene el tag. Sin él, el auditor no analiza a nadie y la
pestaña de Auditoría queda en su estado vacío.

`GET /api/agentes/auditor-estado` devuelve la lista de lo que falta, redactada para reenviar.

### 2. El prompt del Appointment Flow AI

Pegarlo en **Auditoría de Agentes › Prompts** (habilitada para `tecnico`). Queda guardado en la
configuración de la empresa (`closer_org_config`), con su hash, y el siguiente análisis lo toma
solo. **No requiere código ni deploy.**

Desde el 2026-08-07 el prompt sale de ahí y no de `docs/prompts/<agente>.md`: un archivo del repo
solo puede tener un prompt, y con cinco empresas auditar al agente de una contra el prompt de otra
no da un resultado peor — da uno convincente y falso.

### 3. Las plantillas de WhatsApp — **en pausa por decisión**

El envío está construido de punta a punta, pero `closer_plantillas` está **vacía a propósito**:
Fabio decidió el 2026-08-06 dejarlo apagado y resolverlo más adelante. Mientras no haya filas,
el botón del chat no se renderiza y el banner de 24 h queda como estaba.

Para encenderlo hacen falta dos cosas, ninguna de código:

1. El **texto** de cada plantilla (nombre, idioma, cuerpo aprobado), copiado de GHL
   (Settings > WhatsApp > Templates). Ninguna ruta de la API lo expone.
2. Un **workflow publicado** que solo mande esa plantilla. El `workflowId` no hay que pedirlo:
   se encuentra por nombre. Disparar un workflow ejecuta todo lo que tiene adentro, así que
   reusar uno existente traería sus otros efectos.

Medido: la plantilla `agendanclicconfirmarcall` sale hoy por workflow, `TYPE_WHATSAPP`,
entregada y con `wamid` real de Meta — o sea que ese camino funciona en esta cuenta. El camino
directo (`templateId`) no se pudo probar sin mandar un mensaje real, y de todos modos no tiene
campo para las 4 variables de esa plantilla.

### 4. Una llamada contestada de Assistable

Las tres que llegaron cayeron en buzón de voz, así que **todavía nadie vio una transcripción
real**. Es lo que falta para arrancar los auditores de voz.

## Lo que no existe

| Qué | Nota |
|---|---|
| Auditor de chat del setter | La rúbrica de pre-agenda es distinta; no es "el mismo con otro contexto" |
| Auditores de voz (×2) | Ya tienen fuente y esquema: `closer_llamadas.turnos` guarda la transcripción entera. Falta la rúbrica y una llamada contestada |
| Reproducir el audio de una llamada | `grabacion_url` se guarda y viaja; falta el reproductor |
| Reintentar un mensaje fallido | — |
| Sales calls en el tab Llamada | Nadie graba ni transcribe las reuniones del closer |
| Atribución, alertas y recomendaciones de pauta | Fase 8 de la especificación: se ven en Adquisición **detrás del velo de "en desarrollo"**, sin un solo número |
| Tracking del visitante (`visitor_id`, UTMs en la landing) | Ídem |

### Los 33 números que Estadísticas NO puede mostrar

El panel tenía 61 y ahora muestra **32**. El resto se reparte así, y el endpoint devuelve el motivo
de cada uno en `sinDato` para que la vista lo diga al pie:

| Qué falta | Cuántos | Por qué |
|---|---|---|
| **La clasificación caliente / tibio / probable-LT** | 3 | No existe en ninguna parte del sistema. Solo vivía en el store inventado |
| **Los cuatro de automatización** | 4 | `ClosurerContact.atribucionSetter` se **declara y nunca se asigna**: no hay señal de intervención manual que contrastar |
| **El corte high-ticket / low-ticket** | ~5 | Ninguna marca sobre una venta lo distingue. `closer_avances.salida` tiene las 6 salidas, no el tipo de ticket |
| **Las cuatro del setter** | 4 | `api/setter/` tiene **un solo archivo** (`urgentes.ts`): ninguna acción de un setter llega a Supabase |
| ~~ROAS, CAC, CPL, CPA~~ | ~~4~~ | ✅ **Resueltos el 2026-08-07**: salen de `closer_meta_metricas`. Siguen en `null` para una empresa sin Meta conectado, que es lo correcto |
| **Métricas de video** | ~4 | `contact._video_precall` llega de GHL y **no se persiste** |
| **La tendencia de 6 meses** | ~6 | No hay historial anterior a este sistema y no se puede fabricar |
| **Fecha de entrada del lead** | 1 | El `dateAdded` de GHL no se captura. `closer_contactos.creado_el` es la fecha del CACHÉ, no del negocio |
| **Comisión por persona** | 2 | El porcentaje vive en `settingsStore` (localStorage), no en la base. Las **filas** sí salen ya de los usuarios reales con rol closer/setter |

> **La autenticación real existe desde el 2026-08-06** y salió de esta lista: sesiones con
> cookie `httpOnly`, contraseñas con scrypt, 6 roles, bloqueo por intentos fallidos y auditoría
> de accesos. Ver [12-MULTIEMPRESA](12-MULTIEMPRESA.md) — la espec pedía el `11`, que ya estaba
> ocupado por Voz y llamadas; hasta entonces, las
> migraciones `018`–`024` y `api/_lib/auth.ts`.

## Parches vivos y deuda con fecha

Cosas que **funcionan a propósito de una forma provisoria**. Cada una tiene un motivo escrito y un
momento en el que hay que volver.

### El contract que falta

La migración multi-empresa usó **expand → deploy → contract** y el tercer paso no se dio. Siguen
vivas, sin usarse:

| Qué | Por qué se dejó | Cuándo se saca |
|---|---|---|
| `closer_hoy_org()`, `closer_dia_org(p_momento)`, `closer_auditor_claim(p_contact_id, p_ventana)` | Dropearlas ahora convertiría cualquier llamador que se haya escapado en un error inmediato en producción | Después de una semana estable |
| `closer_usuarios.rol` (singular), nullable | Mismo criterio. La reemplazó `roles text[]` | Ídem |

> **Ojo con `closer_registrar_seguimiento`:** su parámetro `p_org_id` tiene
> `DEFAULT '00000000-…-0001'`. Mientras ese default exista, un llamador que se olvide del
> parámetro **escribe en ARIA en silencio**. Hoy el único llamador lo pasa.

### Lo global que debería ser por empresa

| Qué | Consecuencia | Gravedad |
|---|---|---|
| **`ZONA_HORARIA_ORG`** hardcodeada en `src/lib/fechas.ts` | `env.zonaHoraria()` ya resuelve por empresa; faltan los consumidores | Media: hoy todas las empresas están en Lima |
| **Las seis perillas del auditor** (`AUDITOR_UMBRAL_IA`, `AUDITOR_FUENTES_IA`, `AUDITOR_CLAIM_S`…) | Están calibradas contra una cuenta. Un cliente con otro volumen hereda el umbral de ARIA | Baja |
| **`CLOSER_POR_DEFECTO`** | Sigue apuntando a un usuario fijo cuando el endpoint no manda `closerId` | Baja |

> **`AUTOR_POR_DEFECTO` salió de esta lista el 2026-08-07.** Era `"Jorge Q."` en tres archivos. El
> autor ahora sale de `ctx.nombre`, y lo que no tiene autor humano —un cron, un webhook— se firma
> `Sistema`. Ver [D32](09-DECISIONES.md).

### Parches de UI

- **El velo de "en desarrollo"** tapa cuatro secciones de Adquisición con contenido de maqueta
  detrás. Activar cada una es cambiar un `true` por `false` en `src/lib/enDesarrollo.tsx` — y el
  test que fija las seis claves va a fallar hasta que se actualice, a propósito.
- **La bandeja de sugerencias se borró** pero la clave `sugerencias` sigue en los blobs de
  localStorage de cada usuario. Se dejó de leer, no se borró: lo que el equipo había mandado sigue
  ahí si algún día hace falta.
- **`closer_conexiones` es un almacén de credenciales paralelo y muerto.** La escribe y la lee solo
  `api/closer/conexiones.ts`; `env.ts` no la consulta nunca, así que un admin podía guardar ahí su
  calendario, ver el éxito, y nada lo leía. Es el mismo modo de fallar que tenían los prompts. Las
  credenciales de verdad viven en `closer_org_config` y se editan en Ajustes › Credenciales — ese
  panel y esa tabla habría que borrarlos.
- **`gerencia` en `settingsStore`** conserva el nombre viejo del módulo. **No renombrar**: es una
  clave de nivel 1 del JSON guardado, y renombrarla sin shim borra el objetivo de facturación de
  cada usuario — en silencio, porque el fallback no falla, sustituye.
- **Las semillas de Ajustes › Operación se vaciaron** (2026-08-07, patrón D4): el catálogo de
  enlaces, los mapas de comisiones y el `linkPersonal` de ejemplo. Las funciones que las producen
  siguen ahí, vacías. Lo que queda en el localStorage de quien ya usó la app **no se limpia solo**:
  si alguien ve todavía "Ariel C." o un link a `pay.example.com`, es su blob viejo.
- **El porcentaje de comisión sigue en localStorage.** Las **filas** ya salen de los usuarios reales
  de la empresa con rol closer/setter, pero el `%` que se les asigna vive en `settingsStore`, o sea
  por navegador y por usuario. Dos admins pueden ver porcentajes distintos del mismo closer. Hay
  que mudarlo a `closer_org_config` — es la deuda más concreta que dejó el Bloque F.

### Lo que se construyó y nunca se ejercitó (y lo que eso costó)

**Crear una empresa nunca funcionó** hasta el 2026-08-08. `closer_org_config.org_id` es la PRIMARY
KEY, es `not null` y no tiene default, y el INSERT de `api/admin/empresas.ts` no lo mandaba: todo
intento moría con `null value in column "org_id" ... violates not-null constraint`.

No se notó en toda la fase 7 porque la única empresa que existe —ARIA— la sembró la migración `018`
con el UUID escrito a mano. El panel se construyó, se documentó como terminado y jamás se probó
creando una de verdad. Lo encontró Fabio apretando el botón.

> Ningún test offline podía cazarlo: `tsc` está contento —la columna no aparece en el tipo del
> insert— y la regla vive en el esquema, no en el código. Por eso el guard quedó en
> `integracion.test.ts`, contra la base real: es el único lugar donde *"¿este INSERT entra?"* es una
> pregunta que se pueda responder.

Se barrieron las demás PK del esquema buscando el mismo modo de fallo. `closer_mensajes.id` es la
única otra sin default, y ahí es correcto: es el id del mensaje de GHL, una clave natural que el
código pone a propósito. El resto son `identity`.

### Lo que hay que verificar la primera vez que corra

- **La sincronización de Meta nunca se ejecutó.** El mapeo de `api/_lib/meta/real.ts` está escrito
  desde la documentación de Meta, no desde una respuesta observada. La primera corrida es una
  verificación: abrir `closer_meta_crudo` y comparar contra lo que quedó en
  `closer_meta_metricas`. Por eso existe la tabla de crudos (D15).
- **El carril amarillo nunca corrió.** El cron está registrado (`0 21 * * *`) y la lógica se probó
  contra datos reales de producción en `dryRun`, pero **la llamada al modelo y la escritura del
  hallazgo no se ejecutaron nunca**. La primera corrida es una verificación: mirar que el hallazgo
  quede con `criterio = 'acompanamiento'`, `severidad = 'amarillo'` y su análisis con
  `fallo = false` — si saliera con `fallo = true`, le apagaría el bot a alguien, que es justo lo
  que este carril no hace.
- **`closer_avances.autor_usuario_id`** empieza a llenarse desde el 2026-08-07. Las filas anteriores
  quedan en `null` **a propósito** — probable no es medido. El panel las cuenta en los totales y las
  excluye del desglose por persona, diciéndolo en pantalla.

## Huecos conocidos

Cosas que funcionan pero con un límite que conviene tener presente:

- **Rescate de Estancadas en Instagram** — el mecanismo dependía de un botón que se eliminó. No
  hay vía definida; no se inventó un reemplazo.
- **El estado de asistencia a citas** — GHL nunca marca `showed`, así que el show-rate del
  Appointment Flow no se puede calcular. Se destraba cuando alguien marque la asistencia, o
  cuando Avanzar escriba el desenlace.
- **`ops["Sin Respuesta"]`** en Auditoría de Agentes viaja siempre `null`: Francisco no definió
  qué cuenta.
- **`tasa` del sparkline viaja `null`** mientras sea el mismo número que el sentimiento. Dos
  trazos superpuestos se leen como bug de render.
- **Con la app cerrada solo ingiere el webhook**, que casi nunca manda `source`. El contador de
  mensajes de la IA no avanza hasta que alguien abra la herramienta.
- **Tres contactos con `bot_pausado_fallo` sin territorio** — el auditor no pudo tagearlos.
  Hay otra fuente sin identificar. Va como pregunta en el diagnóstico.
- **Si alguien mueve un stage a mano en GHL**, la plataforma no se entera (ver
  [09-DECISIONES](09-DECISIONES.md) § D1).
- **La app no tiene rutas navegables.** La navegación es un switch de vista sobre `React.lazy`,
  sin History API: no hay `pushState`, no hay `<a href>`, la URL nunca cambia. Consecuencias: el
  botón atrás **sale de la aplicación**, refrescar devuelve al inicio, y no se puede compartir un
  link a una vista ni a un contacto. Es estético y no corrompe ningún dato, así que se pospuso
  frente al lanzamiento del 15/08.
  El diseño está resuelto y listo para retomar: un mapa vista↔ruta, la ficha del contacto como
  query param, y `pushState` a mano sin sumar una librería de routing.
- **La empresa activa es por sesión, no por pestaña.** Un `super_admin` con dos pestañas en dos
  empresas distintas escribe en la última que eligió, **sin error visible** — la escritura sale
  bien, en la empresa equivocada. Hoy se mitiga con el aviso permanente junto al selector
  (`AvisoPestanaUnica` en `src/App.tsx`), que es disciplina, no garantía.
  La solución real es mover el contexto a la URL —prefijo `/e/<slug>/` más un header por
  request— y se pospuso porque toca `exigir()`, el punto único por donde pasa todo el aislamiento
  entre empresas: no es el archivo que conviene tocar la semana del lanzamiento. Ver
  [D37](09-DECISIONES.md).

## Operativo

- **Credenciales**: en `.env.local`, gitignored. **Pendiente rotarlas** — circularon en chats.
- **Rotar el token de Facebook.** Estuvo en reposo en `closer_webhook_inbox`; ya está redactado en
  los payloads nuevos, pero el token sigue vivo.
- **Rotar `Fabio@123`.** Es super admin sobre las cinco empresas y circuló en texto plano.
- **`Quiroz Prueba` sigue con `bot_pausado_fallo`** de la prueba del auditor del 06/08.
- **Variables de entorno nuevas**: `CIFRADO_MASTER_KEY` (obligatoria para guardar cualquier
  credencial), `CRON_SECRET` (sin ella los dos crons devuelven 503 y no corren), `BOOTSTRAP_TOKEN`,
  `ADMIN_PRINCIPAL_EMAIL`, `ADMIN_PRINCIPAL_PASSWORD`.
- **Vercel puede activar su Security Checkpoint** si se le pega con muchos `curl` seguidos. Los
  navegadores lo pasan solos; verificar con el navegador y no con `curl`.
- **El access token de Facebook de la subcuenta** llegó dentro de los payloads de Assistable y
  estuvo en reposo en `closer_webhook_inbox`. Ya se redactó de las filas guardadas y el webhook
  lo recorta de entrada, pero **conviene rotarlo**.
- **Contactos que no se tocan en pruebas**: Veronica Ochoa Orrego, Enrique Izaguirre, Richard
  Andrés Rodriguez.
- **Contactos de prueba**: con `@example.com`, y se borran después.
- **Commits**: firmados con `instalacionesariaia@gmail.com`.
- **`api/_lib/analizador.ts` era de Kevin** y se reescribió con autorización explícita. Hay que
  coordinarlo con él.
