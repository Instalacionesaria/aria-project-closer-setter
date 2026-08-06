# Estado del proyecto

**Actualizado: 2026-08-05.** Qué está construido, qué está a medias y qué no existe.

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
| Supabase SOFIA | ✅ 15 migraciones aplicadas |
| Integración GHL (lectura) | ✅ Contactos, citas, conversaciones, custom fields |
| Integración GHL (escritura) | ✅ Tags, custom fields, notas. **Falta `quitarTags`** |
| Webhooks de GHL | ⚠️ El endpoint existe; los workflows los tiene que crear Francisco |
| Webhook de llamadas (Assistable) | ✅ Recibe y guarda crudo. Esperando el primer payload real |
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
| Ficha: Llamada | ⚠️ El componente existe; **no hay datos** hasta que lleguen los de Assistable |
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

Pegarlo en `docs/prompts/appointment-flow-ai.md`. Sin él, las correcciones del auditor son
instrucciones genéricas en vez de reemplazos citados. **No requiere código ni deploy**: el
siguiente análisis lo toma solo.

### 3. `quitarTags` en el puerto de GHL

Resolver una intervención marca el hallazgo y lo persiste, pero **no saca el tag** — así que el
contacto vuelve a Urgentes en el próximo tick. Es un cambio de producto: hay que decidir si la
plataforma puede quitar tags en GHL.

### 4. La primera llamada real de Assistable

Con dos o tres payloads en la bandeja se puede diseñar la tabla, el parser y el auditor de voz.
Hoy se guardan crudos en `closer_webhook_inbox`.

## Lo que no existe

| Qué | Nota |
|---|---|
| Auditor de chat del setter | La rúbrica de pre-agenda es distinta; no es "el mismo con otro contexto" |
| Auditores de voz (×2) | Ya tienen fuente: el webhook de Assistable. Falta ver el payload |
| Mandar plantillas de WhatsApp | La vía es disparar un workflow de GHL. Requiere que existan plantillas aprobadas |
| Reintentar un mensaje fallido | — |
| Gerencia | Placeholder "Próximamente" |
| Auditoría de Llamadas | Placeholder "Próximamente" |
| Autenticación real | Todo firma con un autor por defecto |
| Reproducción de audio | Los botones existen, no hay backend |

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
  ajuste al prompt es el técnico. Dato falso, solo que poco visible.
- **Si alguien mueve un stage a mano en GHL**, la plataforma no se entera (ver
  [09-DECISIONES](09-DECISIONES.md) § D1).

## Operativo

- **Credenciales**: en `.env.local`, gitignored. **Pendiente rotarlas** — circularon en chats.
- **Contactos que no se tocan en pruebas**: Veronica Ochoa Orrego, Enrique Izaguirre, Richard
  Andrés Rodriguez.
- **Contactos de prueba**: con `@example.com`, y se borran después.
- **Commits**: firmados con `instalacionesariaia@gmail.com`.
- **`api/_lib/analizador.ts` era de Kevin** y se reescribió con autorización explícita. Hay que
  coordinarlo con él.
