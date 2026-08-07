# Cómo llegan los datos y cada cuánto

De GHL a la pantalla. Este documento responde "¿por qué tarda X?" y "¿cuánto cuesta esto?".

## En cuatro líneas

1. **Mensajes** — un reloj del servidor los trae de GHL cada 10 s, solo con la app abierta.
   El webhook, cuando existe, baja eso a ≤1 s.
2. **Citas** — un cron a los :25 y :55 de cada hora, **una pasada por empresa activa**. La cita
   es también el ALTA: todo contacto nuevo llega con una, porque `zona_closer` se aplica
   *después* de agendar.

   > Desde el 2026-08-07 el cron recorre `organizacionesActivas()` en vez de atender solo a
   > ARIA. Cada empresa va en su propio `try` —una con el token vencido no corta a las demás— y
   > la que no tiene credenciales cargadas se saltea diciéndolo, en vez de heredar las de ARIA.
   > La respuesta trae `porEmpresa` con el detalle, y devuelve **207** si alguna falló: no es un
   > éxito, y tampoco un fracaso si las otras corrieron.
   >
   > **Cada empresa lee de SU calendario** (`closer_org_config.ghl_calendario_id`, migración `027`).
   > Era una variable de entorno global, y mientras lo fue el cron le habría pedido a cada empresa los
   > eventos del calendario de ARIA con su propio token — 404 de GHL, o peor, cero citas sin
   > explicación. Una empresa sin calendario cargado se saltea **diciendo cuál de las dos cosas
   > falta**: el token o el calendario. `sincronizarCitas` devuelve `sinCalendario: true` para que
   > "no se pudo sincronizar" no se confunda con "no había citas".
   >
   > `maxDuration` subió de 60 s a **300 s** por esto mismo. Los 60 estaban dimensionados para
   > una pasada; el bucle es secuencial, así que con cinco empresas el techo viejo cortaba a la
   > cuarta por timeout — y un cron que se corta a mitad no avisa, simplemente deja empresas sin
   > sincronizar.
3. **Todo lo demás** (etapas, notas, seguimientos, análisis) vive en Supabase y no necesita a
   GHL para pintarse.
4. **El frontend nunca llama a GHL.** Habla con `/api/*`, que lee de la caché.

## Los relojes

Todos viven en `src/lib/polling.ts`. **Con la pestaña oculta se pausan todos** — cero
intervalos corriendo. Al volver el foco, cada uno dispara una vez de inmediato.

| Reloj | Cada | Corre cuando | Qué hace |
|---|---|---|---|
| **`tick`** | 10 s | El módulo Closer está abierto | Ingesta desde GHL **+** las cinco colas de Mi Día |
| `chat` | 5 s | Hay una ficha abierta **en el tab Chat** | Mensajes + estado de la ventana de 24 h |
| `inicio` | 60 s | Tab Inicio | Métricas del cockpit |
| `setterUrgentes` | 60 s | Módulo Setter | Cola roja del setter |

Notar qué **no** está en esa tabla:

- **El Pipeline no tiene reloj.** Se pide al montar, al recuperar el foco, y después de cada
  Avanzar. La etapa vive en Supabase y el endpoint es una query a la caché: pedirlo entre
  eventos solo redibujaría lo mismo.
- **El auditor no tiene reloj.** Lo dispara el webhook cuando entra o sale un mensaje.
  Colgarlo de un intervalo convertiría cada ciclo con actividad en una llamada al modelo.

## El tick

`POST /api/closer/tick` hace las dos mitades que antes eran dos relojes y dos requests.
Bajó de 12–13 a ~7 requests por minuto por pestaña.

**Corre en SECUENCIA, ingesta primero.** Los dos relojes viejos estaban *en fase* —
`registrarReloj` dispara al registrarse y ambos se registraban en el mismo montaje—, así que
Mi Día leía la tabla microsegundos **antes** de que la reconciliación escribiera. Un mensaje
entrante tardaba un tick completo en llegar al Buzón: ~15 s. Ahora ~6 s.

> Alcance de esa mejora: aplica al **Buzón**, que depende de `ultimo_entrante_el`. **Urgentes
> no** — depende de los tags cacheados, y la reconciliación no refresca tags.

**El presupuesto de la ingesta es un deadline cooperativo** (4 s), no un `Promise.race`. Un
race no cancela nada: la mitad seguiría corriendo después de responder y podría quedar
congelada entre el `update` de `last_message_ghl_at` y `efectosDeEntrante`, perdiendo para
siempre el evento de historial, la cancelación del seguimiento y el revive de la tarea. El
deadline corta **entre** conversaciones, nunca a mitad de una.

`maxDuration` del tick: **15**. Es un techo de seguridad; lo que se tunea es el presupuesto.

### Regla de admisión

Un endpoint que corre "todo lo del reloj de 10 s" atrae cada agregado futuro, y cada uno
hereda la latencia máxima y el radio de explosión completo.

> **Como mucho UNA mitad que toque GHL. Todo lo demás tiene que ser más barato que un
> roundtrip.**

Y una propiedad que hay que preservar: **la cadencia del cliente no es el rate limit de la
ingesta**. El candado (`VENTANA_MS` en `api/_lib/reconciliacion.ts`) lo es. Se puede mover
`CADENCIA.tick` sin tocar el presupuesto de GHL.

## La reconciliación

Es la mitad que habla con GHL. Vive en `api/_lib/reconciliacion.ts`.

### El candado

`UPDATE ... SET ultima_reconciliacion = now() WHERE ultima_reconciliacion < now() - 10s
RETURNING`. Cero filas = otro request ya corrió hace <10 s → se sale sin gastar **ni una**
llamada. Es un UPDATE condicional, no un SELECT+UPDATE: dos requests simultáneos no pueden
ganar los dos.

Consecuencia: **N pestañas cuestan lo mismo que una.**

### La marca de agua

El `tags=` del search de GHL **se ignora** (verificado), así que no se puede pedir "solo las
de zona_closer". En su lugar: el search viene ordenado por último mensaje descendente, y se
camina solo hasta cruzar `reconciliacion_marca_agua`. El costo es O(actividad en 10 s), no
O(tamaño de la cuenta) — y la cuenta tiene ~15.000 conversaciones.

### Tres invariantes que sostienen la reentrancia

No son evidentes leyendo el código y romper cualquiera pierde mensajes:

1. **`closer_reconciliar_marca` es monotónica del lado de Postgres**
   (`greatest(coalesce(actual,'epoch'), p_marca)`). Un cuerpo colgado que escribe tarde no
   puede hacer retroceder la marca.
2. **El paso de la marca va al final y solo se alcanza si el paso anterior completó.** Un
   abandono nunca deja la marca adelantada sobre trabajo no hecho.
3. **`porId` es un snapshot tomado ANTES de las escrituras del ciclo.** Recargarlo a mitad
   haría que `yaVisto` refleje lo que el propio ciclo acaba de escribir, y el paso 4 se
   auto-saltearía.

> **Prohibido:** escribir una marca parcial al vencer el deadline. `marcaNueva` avanza
> **antes** de los filtros, así que cubre conversaciones que todavía no se procesaron.
> Persistirla las dejaría detrás de la marca y sus mensajes se perderían para siempre. Si
> hubo truncamiento, el paso de la marca **se saltea entero**.
>
> No perder el trabajo hecho no depende de esa marca: el progreso se guarda contacto por
> contacto en `last_message_ghl_at`.

### La pasada que cierra los mensajes en el aire

La reconciliación solo relee conversaciones con actividad **nueva**, y un saliente que Meta
rechaza minutos después **no cambia la fecha de la conversación**. Sin una pasada extra, su
estado quedaría en `pending` para siempre.

Esa pasada relee solo conversaciones con salientes sin resolver de la última hora, con tope
de 2 por ciclo, y **excluye los ids fabricados `wh:…`** — los inventa el webhook cuando GHL
no manda `messageId`, no existen del lado de GHL, y sin excluirlos la consulta nunca se
vacía: costaría 2 llamadas por ciclo para siempre.

## La doble vía de ingesta

El webhook da velocidad; la reconciliación da confiabilidad. Ninguna depende de la otra y las
dos terminan en el mismo upsert.

**El problema que eso creó:** el webhook estándar de GHL **no manda `messageId`**, así que
fabrica un id `wh:…` y la reconciliación guarda el mismo mensaje con su id real. Dos filas,
un mensaje.

La regla es asimétrica y solo cruza fabricado↔real (nunca real↔real, que son mensajes
legítimamente distintos aunque digan lo mismo):

- Un fabricado **no se inserta** si su mensaje real ya está.
- Un real, al insertarse, **borra** los fabricados equivalentes (mismo texto y dirección, con
  las horas a menos de 10 min).

Así, en cualquier orden de llegada queda exactamente una fila, con la hora buena.

## El presupuesto de llamadas a GHL

| Operación | Costo |
|---|---|
| Tick en reposo | **1** llamada (el search por marca de agua) |
| Tick con actividad | 1 + 1 por conversación cambiada |
| Cerrar mensajes en el aire | 0 en reposo · hasta 2 mientras hay algo sin resolver |
| Abrir una ficha | 1 (el contacto vivo, que además refresca los contadores de voz) |
| Enviar un mensaje | 1 · **0 si la ventana de 24 h está cerrada** (se corta antes) |
| Sincronizar CRM (manual) | 2 + 1 por contacto activo. Los congelados cuestan 0 |
| Cron de citas (:25, :55) | 1 + 1 por contacto nuevo descubierto, **por empresa activa** |
| Cron de Meta (06:20 UTC) | 4 a la Graph API por empresa con credenciales — un nivel cada una |
| Chat, Mi Día, Pipeline, Inicio | **0** — todo sale de la caché |
| Estadísticas | **0** a GHL: es agregación por query sobre Supabase |
| Adquisición | **0** a Meta: lee `closer_meta_metricas`, que llena el cron |

**Todo lo de arriba se multiplica por la cantidad de empresas activas**, y el límite de GHL es
**por subcuenta**, así que el presupuesto por cliente no cambia: cinco empresas son cinco
presupuestos de 200.000 diarios, no uno repartido. Lo que sí se multiplica es el **tiempo** de un
cron secuencial — por eso `citas-respaldo` tiene `maxDuration: 300`.

**Lo que sí crece con el negocio** no es el polling: es el auditor. Cada análisis es una
llamada al modelo, y se factura contra la key de **cada empresa**, no contra una global. Ver
[07-AUDITOR-IA](07-AUDITOR-IA.md).

## Congelados

Un contacto que perdió `zona_closer` queda `congelado`: **visible y movible, pero inerte** —
ni una llamada más de GHL por él. Se detecta por ausencia en el barrido por tag, así que
recuperar el tag lo descongela solo, sin costar una llamada por contacto.

Los dos guards del congelamiento por ausencia son innegociables: solo se congela si la lista
**no vino truncada** y **no vino vacía**. Un 429 de GHL que devolviera lista vacía congelaría
el territorio entero.

## Los indicadores del contacto

Los 6 íconos de la fila se calculan en el backend y viajan en un bloque `indicadores`, para
que se vean **iguales en todas las vitrinas**. La regla que decide cómo se obtiene cada uno:

> **Lo que se deriva en la lectura no se queda viejo; lo que se denormaliza, sí.**

- 📹 📅 ⏱ salen de la vista SQL `closer_indicadores_contacto`, sobre las tablas vivas.
- 🤖 se deriva de los tags en cada lectura.
- 💰 sale de la etapa y el monto.
- 📞 es **la única excepción denormalizada**: su origen son custom fields de GHL y traerlo en
  vivo costaría una llamada por contacto.

`closer_mensajes.autor` es la otra denormalización consciente: su origen (`source`/`userId`)
no vuelve a estar disponible sin repedir la conversación entera.

Hay tres columnas **muertas** que quedaron de un diseño anterior — `bot_estado`, `cita_el`,
`cita_meet_url`. Están marcadas con `comment on column` y nadie las lee. No se dropearon
porque un DROP vuelve a disparar el problema del schema cache sin ninguna ganancia.
