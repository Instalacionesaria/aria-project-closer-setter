-- 016 — Las llamadas de los agentes de voz (Assistable).
--
-- Es la fuente que faltaba para los dos auditores de VOZ y para el tab Llamada de la ficha,
-- que existe desde julio renderizando `CallRecord[]` y hasta hoy nunca recibió una fila.
--
-- ── El esquema salió de payloads reales, no de la documentación ──
--
-- `api/webhooks/llamada.ts` se desplegó inerte a propósito: guardaba el cuerpo crudo en
-- `closer_webhook_inbox` y nada más, para que los datos decidieran las columnas. Llegaron
-- tres llamadas de prueba el 2026-08-06 entre las 00:45 y las 01:25 UTC, y respondieron la
-- pregunta que bloqueaba todo: **la transcripción viene en el mismo payload**
-- (`full_transcript` + `transcript_object`), junto con el resumen, el sentimiento y la URL
-- de la grabación. No hay que pedir nada aparte con el `call_id`.
--
-- Las tres cayeron en buzón de voz, así que los campos de conversación llegaron vacíos —
-- pero vacíos con su clave presente, que es lo que hacía falta para tipar las columnas.
--
-- ── Sin foreign key a closer_contactos, a propósito ──
--
-- Assistable llama a contactos de GHL, no a nuestra caché. Un contacto recién creado puede
-- recibir la llamada antes de que la reconciliación lo ingiera, y una FK convertiría esa
-- carrera —normal, esperable— en un webhook rechazado y una llamada perdida para siempre.
-- El join se hace por `ghl_contact_id` en la lectura, que tolera el hueco.
--
-- ── Sin CHECK en los vocabularios de Assistable ──
-- `motivo_desconexion`, `motivo_cierre` y `sentimiento` son de ellos. Un CHECK acá haría que
-- el día que agreguen un valor nuevo el INSERT falle y perdamos la llamada entera por no
-- saber nombrar su final. Se guarda lo que mandan; la traducción es de la vista.

begin;

create table if not exists public.closer_llamadas (
  -- El `call_id` de Assistable es la clave natural: el upsert por PK es lo que hace que un
  -- reintento suyo actualice la fila en vez de duplicarla.
  call_id             text primary key,
  ghl_contact_id      text not null,
  location_id         text,
  assistant_id        text,

  -- `app_flow_voz` | `lead_flow_voz` | `voz_ia`. El último es el honesto: llegó una llamada
  -- de un asistente que no está en el mapa y no sabemos de qué embudo es. Ver `src/lib/assistable.ts`.
  origen              text not null,
  direccion           text,

  numero_desde        text,
  numero_hacia        text,

  -- Nullables porque lo son de verdad: una llamada rechazada antes de conectar no tiene
  -- `start_timestamp` (payload #2 del 2026-08-06 llegó con los dos en null).
  inicio_el           timestamptz,
  fin_el              timestamptz,
  duracion_segundos   numeric(10,2) not null default 0,

  -- Derivado, no copiado: `duracion > 0` NO alcanza. El buzón de voz "dura" 1.86 s y no lo
  -- atendió nadie. La regla vive en `contestoAlguien()` y acá queda su resultado.
  contestada          boolean not null,
  motivo_desconexion  text,
  motivo_cierre       text,

  resumen             text,
  transcripcion       text,
  -- `transcript_object`: los turnos con rol y texto. Se guarda entero para los auditores de
  -- voz, que van a necesitar atribuir cada frase igual que hace `autoria.ts` con el chat.
  turnos              jsonb,
  sentimiento         text,
  grabacion_url       text,

  -- Lo que el agente extrajo y las herramientas que usó. Todavía nadie los lee; se guardan
  -- porque son el material de la auditoría de voz y no se pueden recuperar después.
  extracciones        jsonb,
  herramientas        jsonb,

  recibido_el         timestamptz not null default now()
);

comment on table public.closer_llamadas is
  'Llamadas de los agentes de voz, tal como las manda Assistable a /api/webhooks/llamada. '
  'Sin FK a closer_contactos: la llamada puede llegar antes que el contacto.';
comment on column public.closer_llamadas.contestada is
  'Derivado: hubo un humano del otro lado. Un buzón de voz dura segundos y NO cuenta.';
comment on column public.closer_llamadas.origen is
  'app_flow_voz | lead_flow_voz | voz_ia. voz_ia = asistente desconocido, no se inventa embudo.';

-- El tab Llamada pide todas las de un contacto, más reciente primero. `recibido_el` y no
-- `inicio_el` porque el segundo es nullable y un índice que no cubre las filas sin conectar
-- deja justo fuera a los no-contesta, que son la mayoría de los intentos.
create index if not exists idx_llamadas_contacto
  on public.closer_llamadas (ghl_contact_id, recibido_el desc);

-- §Seguridad: la anon key viaja en el bundle del browser. Sin esto, cualquiera con el
-- bundle lee transcripciones de llamadas reales. La 007 se lo olvidó y hubo que escribir la
-- 008 solo para arreglarlo.
alter table public.closer_llamadas enable row level security;
revoke all on public.closer_llamadas from anon, authenticated;

commit;

-- Obligatorio (§51.5): sin esto PostgREST sigue sirviendo el schema viejo y el primer INSERT
-- falla con 42703 sobre una tabla que ya existe.
notify pgrst, 'reload schema';
