# Base de datos — módulo Closer

Proyecto Supabase: **SOFIA** (`pajhjpzydkkpmjdofqqp`).

## Dónde viven las tablas

En `public`, con prefijo `closer_`. SOFIA ya aloja cuatro sistemas — `agentforge_*`,
`aria_brain_*`, `ht_*`, `ob_*` — y todos usan esa convención. Un esquema aparte habría
obligado a agregarlo a los expuestos por PostgREST, que es un ajuste a nivel proyecto y
habría afectado a los otros sistemas.

Todas las tablas tienen **RLS activado y ninguna política**. Es la postura de 29 de las 35
tablas existentes, y es la correcta: `public` está expuesto por PostgREST, así que una
tabla sin RLS es legible y escribible con la anon key — la que viaja en el bundle del
browser. Sin políticas solo pasa `service_role`, o sea que todo el acceso entra por las
funciones de `api/` y el cliente nunca toca las tablas directo.

## Migraciones

Van de la `001` a la **`038`**, todas aplicadas en SOFIA. La tabla de abajo detalla solo el
esquema base (`001`–`005`, aplicadas el 2026-07-25); de la `006` en adelante **el encabezado de
cada archivo explica por qué existe** —esa es la fuente— y el tema al que pertenecen está
documentado en el `docs/` correspondiente:

| Migración | Qué agrega | Documento |
|---|---|---|
| `013` | Indicadores, contadores de IA, candado de sync | [04-DATOS-Y-RELOJES](../04-DATOS-Y-RELOJES.md) |
| `014` | Autoría de mensajes, hallazgos y ajustes del auditor | [07-AUDITOR-IA](../07-AUDITOR-IA.md) |
| `015` | Estado de entrega y error de envío | [08-MENSAJERIA](../08-MENSAJERIA.md) |
| `016` | `closer_llamadas` — las llamadas de los agentes de voz | [11-VOZ-Y-LLAMADAS](../11-VOZ-Y-LLAMADAS.md) |
| `017` | `closer_plantillas` — plantillas de WhatsApp aprobadas | [08-MENSAJERIA](../08-MENSAJERIA.md) § Plantillas |

Las `018`–`027` son la **capa multi-empresa**, y conviene leerlas en orden porque cada una
depende de la anterior. Las `028`–`031` son del auditor; las `032`–`034`, del setter con backend real; las `035`–`037`
son la **contracción del multi-empresa** — sacan los defaults y las sobrecargas que hacían que
un llamador distraído escribiera en la empresa principal sin fallar:

| Migración | Qué agrega |
|---|---|
| `018` | Extiende `closer_org_config` con identidad, credenciales cifradas y los 4 prompts. Siembra ARIA y protege la empresa principal con triggers |
| `019` | `org_id` en las 5 tablas que no lo tenían, con `default` para no reescribirlas. `closer_webhook_inbox.org_id` queda **nullable** a propósito (D15) |
| `020` | `closer_hoy_org` / `closer_dia_org` / `closer_auditor_claim` con parámetro de empresa, como **sobrecargas** — las viejas siguen vivas hasta el contract |
| `021` | Las 3 vistas, con `org_id` y `security_invoker` |
| `022` | FKs `on delete restrict`, índices compuestos y `revoke` sobre 19 tablas |
| `023` | Autenticación: email y hash en `closer_usuarios`, `roles text[]`, `closer_sesiones`, `closer_auditoria_accesos` |
| `024` | `closer_usuarios.tema` — la preferencia de modo claro/oscuro, por usuario |
| `025` | `closer_avances.autor_usuario_id` — quién registró cada Avanzar. Nullable y **sin backfill**: las filas viejas no tienen autor y no se inventó uno |
| `026` | `closer_meta_metricas` y `closer_meta_crudo` — la pauta de Meta, una fila por objeto y por día |
| `027` | `closer_org_config.ghl_calendario_id` — el calendario por empresa. Era una variable de entorno global, y el último bloqueante para dar de alta un cliente con agenda |
| `028` | **DROP** de `anthropic_modelo` y `anthropic_thinking`. El modelo del auditor pasa a ser constante del código: una perilla de config podía dejar a una empresa auditando con otro modelo sin aparecer en ningún diff |
| `029` | `closer_analisis_agente.alarmas text[]` — qué señal del nivel 0 adelantó el análisis. Sin default: `null` = salió por el debounce normal, y no es lo mismo que `{}` |
| `030` | `acompanamiento` entra al CHECK de `criterio`. Es la dimensión de **calidad** del carril amarillo, no un octavo criterio de fallo |
| `031` | `nivel`, `destacado` y `evidencia` en `closer_analisis_agente` — el veredicto de tres niveles. `fallo` queda como proyección de `nivel`, y un CHECK impide que se contradigan. Backfill parcial: solo las de `fallo = true` son rojas sin ambigüedad |
| `032` | `closer_avances.rol` con un CHECK compuesto (rol, salida) — el Avanzar del setter entra a la misma tabla, y un par inválido no se puede escribir. Más `closer_contactos.atribucion_setter_id`, el latch que estaba solo en el browser |
| `033` | `closer_comisiones (org_id, usuario_id, tipo, pct)` — el % sale del localStorage. Indexada por id y no por nombre: con la clave vieja, renombrar a alguien le borraba su comisión en silencio |
| `034` | Los seis criterios del auditor del setter, con su vocabulario propio de pre-agenda |
| `035` | `closer_registrar_seguimiento` **sin ningún default**. Tenía `p_org_id DEFAULT '…0001'` y `p_autor_nombre DEFAULT 'Usuario Activo'`: un olvido escribía en ARIA firmado por nadie. Ahora falla ruidoso |
| `036` | Baja de `closer_conexiones` — el almacén de credenciales de antes del multi-empresa, con cero filas y cero lectores. Dos puertas para el mismo PIT, una sin efecto |
| `037` | La contracción: se van `closer_hoy_org()`, `closer_dia_org(timestamptz)`, `closer_auditor_claim(text,int)` y `closer_usuarios.rol`. Las sobrecargas viejas no fallaban, **resolvían** a la empresa principal |
| `038` | Los `agente_id` de voz entran a las 3 tablas del auditor (CHECK ampliado a los 4). El CHECK de `criterio` no se toca: la voz reusa los criterios de su territorio |

| Archivo | Qué hace | Por qué existe |
|---|---|---|
| `001_seguimientos.sql` | 7 tablas, 5 enums, 2 funciones, 1 vista | El esquema base |
| `002_bootstrap.sql` | La org y un closer | Sin esto `closer_id` no tiene a qué apuntar y el primer Avanzar falla con un error de FK poco descriptivo |
| `003_registrar_seguimiento.sql` | Función atómica de registro | Son cuatro escrituras; desde Node eran cuatro round trips sin transacción, y si la creación fallaba tras cerrar el anterior el contacto quedaba **sin** seguimiento en silencio |
| `004_historial_borrable.sql` | El trigger deja de bloquear `DELETE` | Bloquear el UPDATE es el punto (la historia no se reescribe); bloquear el DELETE hacía que ningún dato fuera borrable, ni el de prueba ni el de alguien que pidiera supresión |
| `005_permisos_funciones.sql` | Revoca `closer_hoy_org()` y la vista a `anon` | Eran alcanzables con la llave pública, la que viaja en el bundle del browser |

Son idempotentes (`create ... if not exists`, `do $$ ... exception when duplicate_object`,
`on conflict do nothing`), así que se pueden volver a correr sin romper nada.

### Cómo aplicar

Con el CLI, una vez linkeado el proyecto:

```bash
npx supabase db push
```

O pegando el archivo en el SQL editor del dashboard. Durante el desarrollo se aplicó vía la
Management API (`POST /v1/projects/{ref}/database/query`) con un access token personal, que
evita el prompt interactivo de contraseña del `supabase link`.

## Qué guarda esta base y qué no

`CONTRATO-GHL.md` §0 dice que el tool no almacena datos propios. Se respeta casi entero:
**GHL sigue siendo la fuente de verdad del negocio**. La situación del seguimiento es el
custom field `nivel_de_inters_seguimiento`, el modo es un tag (`seguimiento_recupero` /
`seguimiento_manual`), y el stage lo mueve un workflow. Nada de eso se duplica acá.

Lo que sí vive acá es el estado **operativo**, que GHL no puede sostener:

1. **La fecha objetivo del seguimiento manual.** GHL solo necesita saber que el contacto
   está en manual para no dispararle la serie automática; el día en que reaparece en la
   cola es lógica de cola de trabajo, y no tiene campo ni workflow en el contrato.
2. **Fijar y completado del día** — estado de la cola, no del contacto.
3. **Outbox e inbox** — para que un fallo de red no pierda una intención.

Desviación consciente, decidida el 2026-07-25.

## Invariantes que garantiza la base (no el código)

Verificadas con una prueba de humo de 13 checks contra SOFIA:

- **Un solo seguimiento abierto por contacto** — índice parcial único. El doble submit y
  las dos pestañas abiertas pasan a ser una violación reintentable en vez de dos filas y
  dos tags en GHL.
- **`closer_hoy_org()` es el único origen de "hoy"** — nunca `current_date`, que en Supabase
  corre en UTC y a las 20:00 de Lima daría el día siguiente.
- **El historial es append-only** — trigger que rechaza UPDATE y DELETE.
- **Un evento de sistema no puede firmar como persona** — `CHECK` que obliga
  `autor_tipo='sistema'` ⇒ `autor_nombre='Sistema'`. Es `CLAUDE.md` §2 como constraint.
- **Un seguimiento manual no puede llevar datos de serie**, y **cerrar exige motivo y fecha**.
- **Un toque reenviado por un reintento de GHL no se cuenta dos veces** — índice único sobre
  `(seguimiento_id, payload->>'toque_n')`.
- **Una serie automática en curso no aparece en la cola**; solo cuando se agota.

La prueba de humo termina con un `raise exception` deliberado: aborta el bloque y revierte
todo lo insertado, así no deja residuo por construcción. Un `delete` no serviría — el
trigger append-only lo rechaza, que es justamente lo que se está verificando.

## Cosa a saber si tocás el historial

`closer_contacto_eventos.seguimiento_id` es `on delete no action`, **no** `set null`. Un
`set null` sería un UPDATE sobre la tabla append-only, y el trigger lo rechazaría: borrar un
seguimiento fallaría con un error incomprensible. Es coherente con el diseño — acá nada se
borra en duro, los seguimientos se cierran (`cancelado`, `reemplazado`) y quedan.
