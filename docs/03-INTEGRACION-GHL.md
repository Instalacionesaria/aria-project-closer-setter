# La frontera con GHL

Todo lo que cruza entre la plataforma y GoHighLevel. Si algo no está acá, el código no
debería estar usándolo.

> **Los literales viven en `src/lib/ghl/contrato.ts`**, no en este documento. Cada uno con su
> valor exacto, su fuente y su nivel de confianza. Este documento explica el **modelo**; ese
> archivo es la **referencia**. Si los dos se contradicen, gana el archivo.
>
> El contrato original de GHL (`CONTRATO-GHL.md`) **no está en git** — está en
> `.gitignore` por decisión suya. Pedíselo antes de tocar la integración.

## Los tags son interruptores

GHL no tiene un campo "estado del bot". Lo que hay son tags, y su presencia o ausencia ES el
estado. Eso tiene dos consecuencias que hay que tener presentes siempre:

1. **Un tag puede mentir.** Un workflow que no corrió, alguien que lo editó a mano, un swap a
   medias. Por eso las decisiones caras se cruzan contra los hechos, no solo contra el tag.
2. **La ausencia significa algo.** El default del bot es **APAGADO**: sin tag de encendido, el
   sistema asume que no hay agente atendiendo.

### Territorio

| Tag | Qué significa |
|---|---|
| `zona_closer` | Portón de entrada al módulo Closer. Se aplica al agendar y **nunca se quita** — incluye descalificados y nurture |
| `zona_setter` | Territorio pre-agenda. El swap al agendar lo reemplaza por `zona_closer` |

Los dos no conviven. Si aparecieran ambos, gana `closer` (es la etapa más avanzada).

### Estado del agente de IA

Una sola función deriva el estado: **`botDesdeTags(tags, fuente)`** en `contrato.ts`. La
precedencia es fija y el orden importa:

```
fuente IG            → null (IG no tiene bot)
bot_pausado_fallo    → pausado_fallo
bot_desactivado_postcall → muerto_postcall
derivado_lt          → derivado_lt
bot_apagado_manual   → apagado_manual
bot_activado         → activo
(ninguno)            → null  ← default APAGADO
```

`pausa_temporal` **no se deriva de ningún tag**: es un estado optimista que vive solo en el
front, cuando un humano acaba de escribir.

> ⚠️ **`bot_activado` no lo aplica nadie hoy.** Verificado contra la subcuenta: cero
> contactos lo tienen, y los workflows que deberían ponerlo (`🟦 08.1`, `🟦 08.2`) están en
> borrador. Esto tiene una consecuencia grande en el auditor — ver
> [07-AUDITOR-IA](07-AUDITOR-IA.md).

### Resultados de Avanzar

Cada salida de Avanzar aplica su tag, y **el tag es lo que dispara el workflow de GHL**. Los
nombres exactos están en `TAGS` dentro de `contrato.ts`.

Nota importante: `noshow` **no apaga el bot** — al contrario, la IA tiene que seguir
trabajando para el workflow de recuperación. Todas las demás salidas sí lo apagan
(`bot_desactivado_postcall`).

## Custom fields

Se leen con **`leerCampo(contacto, literal)`**, que normaliza la clave: baja a minúsculas y
saca el prefijo `contact.`. GHL devuelve la misma clave a veces con prefijo y a veces sin él,
y a veces con mayúscula. Comparar los strings crudos hace que la mitad de los campos "no
existan" y el Perfil salga vacío sin que nada falle.

> Este bug existió: `api/_lib/contactos.ts` tenía su propio lector case-sensitive y las
> subcategorías se guardaban en `null` en silencio. Dos parsers sobre el mismo payload es la
> clase de bug que no se ve hasta que alguien compara dos pantallas.

## Cómo se identifica quién escribió un mensaje

**"Outbound" no quiere decir "IA".** Medido contra la cuenta real, por el mismo canal salen
cuatro cosas distintas, y se distinguen por `source` + `userId`:

| Firma | Autor |
|---|---|
| `source: "app"`, **sin** `userId` | El chatbot de GHL |
| `source: "app"`, **con** `userId` | Un humano tipeando en la UI de GHL |
| `source: "workflow"`, con `userId` | Plantilla automatizada. Su `userId` es el de quien *armó* el flujo |
| `source: "api"`, con o sin `userId` | Integraciones — **ambiguo** |

La clasificación vive en `src/lib/ghl/autoria.ts`. **El caso ambiguo se resuelve como
`desconocido`, nunca como `agente_ia`**: llamar IA a lo que no lo es puede mandar a una
persona real a la cola roja por algo que escribió un humano.

Válvulas para ajustar sin desplegar: `AUDITOR_FUENTES_IA` y `AUDITOR_USER_IDS_IA`.

## Webhooks

Un solo endpoint: **`POST /api/webhooks/ghl`**, con el evento en la URL
(`?evento=cita.agendada`).

**Por qué el evento va en la URL y no en el cuerpo:** la acción Webhook estándar de GHL (la
gratis) no permite editar el cuerpo JSON — manda su payload nativo tal cual. La URL sí se
puede editar.

**Autenticación:** header `x-webhook-secret`, y **el secreto es por empresa** desde el
2026-08-07 (`closer_org_config.ghl_webhook_secret`), con `WEBHOOK_SECRET` como fallback — que es
cómo está configurada ARIA hoy. Sin ninguno de los dos, el endpoint se rechaza a sí mismo con 503.
Abierto, cualquiera que descubra la URL puede inyectar eventos y generar gasto.

**El secreto no se le pide al cliente: se lo damos.** Está en Ajustes › Credenciales › Webhooks,
con botón de copiar y de rotar. Antes era un campo de texto que el cliente tenía que completar, y
un campo que se puede dejar vacío se deja vacío. Ver [D31](09-DECISIONES.md).

Con un secreto único compartido entre las cinco empresas, el workflow de cualquiera podía inyectar
eventos a nombre de otra, y rotarlo obligaba a tocar los workflows de todos los clientes.

**De qué empresa es el evento:** del **`locationId` del payload**, contra el índice único de
`closer_org_config.ghl_location_id`.

> **Ojo con dónde viene.** Se contaron las 84 filas reales de `closer_webhook_inbox`: **GHL manda
> `location.id` ANIDADO** en 80 de 81 eventos, y ninguno lo trae como `locationId` arriba.
> Assistable sí lo manda arriba, como `location_id`. Las tres formas se aceptan.

Consecuencia de diseño: **el cuerpo se parsea ANTES de autenticar**, porque el secreto es por
empresa y de qué empresa se trata lo dice el payload.

**Un evento cuyo `locationId` no corresponde a ninguna empresa** se guarda crudo con
`org_id = null`, **no se procesa**, y responde 200 para que GHL no reintente. Nunca se atribuye a
la empresa principal por descarte: eso sería una fuga indetectable (D23).

**Nada se procesa sin guardarse primero.** Todo cuerpo entra crudo a `closer_webhook_inbox`
antes de interpretarse. Si el mapeo falla, el evento no se perdió.

### Eventos que entiende

`contacto.zona_closer` · `contacto.actualizado` · `mensaje.entrante` · `mensaje.saliente` ·
`cita.agendada` · `cita.cancelada` · `serie.toque` · `serie.agotada`

Un evento desconocido se guarda y responde 200. Mejor un registro sin interpretar que un
workflow que GHL desactiva solo por errores repetidos.

### Idempotencia, y su agujero

Cada cuerpo se inserta con un `external_id` y un índice único parcial lo deduplica.

**El agujero:** el fallback del discriminador es `Date.now()`, así que un evento sin
`messageId` ni `timestamp` genera un id distinto en cada reintento y **no deduplica**. El
webhook estándar de GHL no manda `messageId`, así que este caso es el normal, no la
excepción. Aguas abajo el procesamiento sí es idempotente (la PK de `closer_mensajes`), y hay
lógica de "gemelos" que reconcilia el mensaje fabricado con el real.

## Webhook de llamadas (Assistable)

**`POST /api/webhooks/llamada?token=…`** — las llamadas de los agentes de voz.

El secreto va en la **URL** porque Assistable solo ofrece un campo de URL, sin headers. Se
compensa por el lado del daño posible:

- **Token propio y por empresa** (`closer_org_config.assistable_token`, con `LLAMADAS_TOKEN`
  como fallback), distinto del secreto del webhook de GHL. Ese otro protege un endpoint que
  aplica tags y dispara al auditor.
- **La empresa sale del `location_id` del payload**, igual que en el de GHL. Assistable sí lo
  manda arriba. Sin empresa atribuible, el crudo se guarda con `org_id = null` y no se procesa.
- **El endpoint es inerte**: guarda el cuerpo crudo y responde 200. No llama a GHL, no llama
  al modelo, no escribe en ninguna otra tabla.

Guarda crudo y no interpreta porque todavía no se sabe si la transcripción viene en el
payload. Un `GET` sin token responde que está vivo, para poder confirmar el deploy desde el
navegador.

## Qué hay que configurar en la subcuenta

### Lo único bloqueante hoy

**Publicar los workflows que aplican `bot_activado` / `bot_reactivar`.** Los que
corresponden (`🟦 08.1 Apagar App Flow Agent`, `🟦 08.2 Reactivar App Flow Agent`,
`🟨 04.1/04.2`) están en **borrador**. Mientras tanto el auditor no analiza a nadie y el
Buzón rutea con el default apagado.

Para ver el estado exacto: `GET /api/agentes/auditor-estado` devuelve el embudo contacto por
contacto y una lista `loQueFalta[]` redactada para reenviar.

### Los workflows de webhook (opcionales)

Dan velocidad, no funcionalidad: sin ellos la reconciliación cubre todo con ≤10 s de retraso
en vez de ≤1 s. Cada uno es un workflow con acción Webhook apuntando a
`/api/webhooks/ghl?evento=<el que sea>` con el header del secreto.

---

## Lo que hay que configurar en GHL

Lo que sigue es lo único que falta del lado de la subcuenta. **Los tags los define el código**: son
literales que espera `contrato.ts`, y un nombre distinto no matchea nada.

### 1. Los tres tags que sus workflows tienen que aplicar

| Tag | Cuándo |
|---|---|
| `bot_activado` | Mientras el chatbot está atendiendo al contacto |
| `zona_closer` | El contacto ya agendó (post-agenda) |
| `zona_setter` | El contacto todavía no agendó (pre-agenda) |

Exactamente así: minúsculas, guion bajo, sin acentos ni espacios. Sin `bot_activado` el auditor no
mira a nadie; sin `zona_*` no sabe con qué rúbrica juzgarlo.

**`bot_pausado_fallo` NO lo toca él.** Lo aplica el auditor al apagar un bot y lo quita
`api/agentes/alertas.ts` al resolver la intervención. Si su workflow también lo escribiera, se
pisan.

### 2. El webhook

Acción **Webhook** de GHL —la estándar, la gratis— apuntando a:

```
https://<dominio>/api/webhooks/ghl?evento=mensaje.entrante
```

Un workflow por evento, cambiando solo el query param. Header `x-webhook-secret` con el valor que
sale de Ajustes › Credenciales › Webhooks.

> **No hay que componer ningún JSON**, y esto es fácil de equivocar. La acción Webhook estándar manda
> el payload nativo de GHL y **no deja editar el cuerpo** — por eso el evento va en la URL. El
> `contactId` lo saca el handler del payload nativo, probando `contactId`, `contact_id` y
> `contact.id` en ese orden. El `evento` en el cuerpo también funciona (webhook premium, o pruebas
> por curl) y la URL gana si vienen los dos.

### 3. Lo que él nos manda a nosotros

**Los prompts de los dos agentes de texto**, tal cual están en GHL: Appointment Flow AI
(post-agenda) y Lead Flow AI (pre-agenda). Se pegan en Auditoría de Agentes › Prompts. No requiere
deploy: el siguiente análisis los toma solo.

## Lo que GHL NO expone

Verificado contra la API, no inferido:

| Qué | Estado |
|---|---|
| Llamadas y transcripciones | **No hay endpoint ni evento de webhook.** Por eso las llamadas entran por Assistable — ver [11-VOZ-Y-LLAMADAS](11-VOZ-Y-LLAMADAS.md) |
| Plantillas de WhatsApp aprobadas por Meta | **No se pueden listar.** Cero rutas con `whatsapp` en los 84 specs oficiales. `GET /locations/{id}/templates` es `GET-all-or-email-sms-templates` y su esquema de respuesta solo tiene variantes SMS y Email. Reconfirmado el 2026-08-06 contra una subcuenta que **sí** tiene plantillas aprobadas: devuelve `totalCount: 0`, y otras cuatro rutas candidatas dan 404 |
| Enviar una plantilla con variables | `POST /conversations/messages` acepta `templateId` (comprobado: devuelve `CONVERSATIONS_MSG_TEMPLATE_NOT_FOUND`), pero **no hay campo para los `components`/parámetros**, así que una plantilla con `{{1}}` no se puede completar por API |
| Estado de asistencia a las citas | GHL nunca marca `showed`. En 633 citas hay 386 `confirmed`, 245 `cancelled`, 1 `noshow` y **cero** `showed` |
| Qué plantilla generó un mensaje | **El mensaje no lo guarda.** `GET /conversations/messages/{id}` sobre salientes con `source: "workflow"` no trae ningún `templateId` — ni el `TYPE_WHATSAPP` con `wamid` real de Meta. O sea que los ids de plantilla **no se pueden cosechar del historial**: la única fuente es la UI |
| Las acciones de un workflow | `GET /workflows/?locationId=` **lista** los 120 (id, nombre, estado), pero `GET /workflows/{id}` da 404. Se puede encontrar un workflow por nombre; no se puede saber qué hace |

**Para mandar una plantilla** hay dos caminos y la plataforma soporta los dos, elegibles por
plantilla: `templateId` en `POST /conversations/messages` (sin variables) y disparar un
workflow con `POST /contacts/{contactId}/workflow/{workflowId}` (la única vía documentada de
punta a punta, y la única con variables). Ninguno está confirmado todavía contra una plantilla
real — ver [08-MENSAJERIA](08-MENSAJERIA.md) § Plantillas.
