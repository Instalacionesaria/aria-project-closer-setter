# Estado del proyecto

**Actualizado: 2026-08-06.** Qué está construido, qué está a medias y qué no existe.

> Este es el documento que más rápido queda viejo. Si la fecha de arriba tiene más de dos
> semanas, verificá antes de confiar.

## En una línea

El módulo Closer está conectado a datos reales de punta a punta. El Setter y Auditoría de
Agentes tienen la estructura hecha pero les falta backend o les falta que Francisco publique
configuración en GHL.

## Infraestructura

| Pieza | Estado |
|---|---|
| Frontend en Vercel | ✅ Producción, deploy por push a `main` |
| Vercel Functions (`api/`) | ✅ 30+ endpoints |
| Supabase SOFIA | ✅ 17 migraciones aplicadas |
| Integración GHL (lectura) | ✅ Contactos, citas, conversaciones, custom fields |
| Integración GHL (escritura) | ✅ Aplicar y quitar tags, custom fields, notas |
| Webhooks de GHL | ⚠️ El endpoint existe; los workflows los tiene que crear Francisco |
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
| Endpoints (`texto`, `alertas`, `ajustes`, `auditor-estado`) | ✅ Todos en producción |
| Alertas agrupadas por patrón | ✅ Con evidencia, diagnóstico y bloque de corrección |
| Historial de ajustes | ✅ Persistido, con fecha y autor reales |
| Bloque DICE AHORA → DEBERÍA DECIR | ✅ Se activa cuando exista el archivo de prompt |
| Datos | ⏸ **Cero análisis** — ver abajo |

## Lo que bloquea, en orden de impacto

### 1. Francisco: publicar los workflows de `bot_activado`

**Es lo único que separa al auditor de estar funcionando.** Los workflows `🟦 08.1` y `🟦 08.2`
están en borrador; ningún contacto tiene el tag. Sin él, el auditor no analiza a nadie y la
pestaña de Auditoría queda en su estado vacío.

`GET /api/agentes/auditor-estado` devuelve la lista de lo que falta, redactada para reenviar.

### 2. El prompt del Appointment Flow AI

Pegarlo en **Ajustes › Credenciales › Prompts de los agentes**. Queda guardado en la
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
| Estadísticas con datos reales | La vista existe y funciona, pero su dataset es inventado (`src/lib/gerenciaStore.tsx`). Por eso queda limitada a `super_admin`: mostrarle métricas fabricadas al admin de una empresa cliente sería mostrarle datos falsos a quien paga. Se llamaba Gerencia hasta el 2026-08-07 |
| Sales calls en el tab Llamada | Nadie graba ni transcribe las reuniones del closer |

> **La autenticación real existe desde el 2026-08-06** y salió de esta lista: sesiones con
> cookie `httpOnly`, contraseñas con scrypt, 6 roles, bloqueo por intentos fallidos y auditoría
> de accesos. Ver [11-MULTIEMPRESA](11-MULTIEMPRESA.md) cuando exista; hasta entonces, las
> migraciones `018`–`024` y `api/_lib/auth.ts`.

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
- **La firma de los ajustes** usa el autor por defecto, que es el closer — pero quien aplica un
  ajuste al prompt es el técnico. Dato falso, solo que poco visible. Ya hay sesión con usuario
  real (`AUTOR_POR_DEFECTO` en `api/_lib/repo.ts` es lo que quedó de antes): la firma puede salir
  de `ctx.nombre` y todavía no lo hace.
- **Si alguien mueve un stage a mano en GHL**, la plataforma no se entera (ver
  [09-DECISIONES](09-DECISIONES.md) § D1).

## Operativo

- **Credenciales**: en `.env.local`, gitignored. **Pendiente rotarlas** — circularon en chats.
- **El access token de Facebook de la subcuenta** llegó dentro de los payloads de Assistable y
  estuvo en reposo en `closer_webhook_inbox`. Ya se redactó de las filas guardadas y el webhook
  lo recorta de entrada, pero **conviene rotarlo**.
- **Contactos que no se tocan en pruebas**: Veronica Ochoa Orrego, Enrique Izaguirre, Richard
  Andrés Rodriguez.
- **Contactos de prueba**: con `@example.com`, y se borran después.
- **Commits**: firmados con `instalacionesariaia@gmail.com`.
- **`api/_lib/analizador.ts` era de Kevin** y se reescribió con autorización explícita. Hay que
  coordinarlo con él.
