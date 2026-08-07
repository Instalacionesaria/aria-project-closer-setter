-- 019 — `org_id` en las 6 tablas que no lo tenían. Fase EXPAND.
--
-- 12 de las 19 tablas ya tenían `org_id`. Esta migración completa las que faltaban.
-- `closer_evento_tipos` queda AFUERA a propósito: son 17 filas de vocabulario del sistema
-- (`seguimiento_creado`, `mensaje_entrante`…), compartido entre empresas. Darle una clave de
-- inquilino obligaría a replicar el mismo catálogo cinco veces.
--
-- ═══════════════════════════════════════════════════════════════════════
-- POR QUÉ NO HAY UN SOLO `update` ACÁ
-- ═══════════════════════════════════════════════════════════════════════
--
-- El procedimiento de la especificación (§2.3) es: columna nullable → `update` → `set not
-- null`. **Ese `update` no corre.** `closer_avances` tiene un trigger:
--
--   create trigger closer_avances_inmutable before update on closer_avances
--     for each row execute function closer_evitar_mutacion();   -- 011:99-102
--
-- y `closer_evitar_mutacion()` (001:260) hace `raise exception` INCONDICIONAL. Un
-- `update closer_avances set org_id = …` aborta la transacción entera, con un mensaje que
-- encima habla de otra tabla.
--
-- La salida no es desactivar el trigger —si la transacción muere en el medio queda apagado y
-- la tabla deja de ser inmutable sin que nadie lo note— sino **no hacer UPDATE**:
--
--   alter table … add column org_id uuid not null default '<ARIA>'
--
-- Es DDL: no dispara triggers de fila. Y en PostgreSQL 11+ un default CONSTANTE no reescribe
-- la tabla (se guarda como `attmissingval`), así que las filas existentes quedan con el valor
-- sin que nadie las toque. Como todo lo que hay hoy es de ARIA, el backfill entero desaparece.
--
-- ── El default es deuda con fecha ─────────────────────────────────────
--
-- Mientras exista, un INSERT que se olvide de mandar `org_id` se atribuye a ARIA **en
-- silencio**. Eso es aceptable HOY, cuando ARIA es la única empresa y el código viejo todavía
-- no manda la columna — de hecho es lo que permite desplegar la base antes que el código sin
-- romper la ingesta ni Avanzar. Deja de ser aceptable en cuanto entre la segunda empresa.
--
-- **Se quita en la migración de CONTRACT, después de desplegar el código que manda `org_id`.**

begin;

/* ──────────── Las cinco que reciben la columna obligatoria ──────────── */

alter table public.closer_mensajes
  add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000001';

alter table public.closer_citas
  add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000001';

-- La del trigger inmutable. Ver el encabezado: acá está el motivo de todo el diseño.
alter table public.closer_avances
  add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000001';

alter table public.closer_llamadas
  add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000001';

/* ──────────────────── La bandeja de webhooks: la excepción ──────────────────── */
--
-- Es la ÚNICA tabla donde `org_id` queda NULLABLE, y es deliberado (§6.3 + D15): un webhook
-- cuyo `locationId` no corresponde a ninguna empresa **se guarda igual** y no se procesa.
-- Nada se descarta en silencio. Un `not null` acá obligaría a tirar ese payload o a
-- atribuírselo a alguien al azar, que son las dos peores opciones.
--
-- Sin default, a propósito: acá el null SIGNIFICA algo ("llegó y no supimos de quién es"), y
-- un default lo taparía convirtiendo todo huérfano en ARIA.

alter table public.closer_webhook_inbox
  add column if not exists org_id uuid;

-- Los 60 payloads que ya estaban son de ARIA: llegaron cuando era la única subcuenta.
-- Esta tabla no tiene trigger de UPDATE, así que acá sí se puede.
update public.closer_webhook_inbox
   set org_id = '00000000-0000-0000-0000-000000000001'
 where org_id is null;

-- Para poder auditar los huérfanos sin escanear la tabla entera. Parcial porque, si todo
-- funciona, esta lista tiene que estar vacía casi siempre.
create index if not exists idx_webhook_inbox_huerfanos
  on public.closer_webhook_inbox (recibido_el desc)
  where org_id is null;

comment on column public.closer_webhook_inbox.org_id is
  'NULLABLE a propósito (§6.3): un webhook de un locationId desconocido se guarda con null y '
  'no se procesa. Es la única tabla con esta excepción.';

/* ──────────────────── Plantillas: la PK sí cambia ──────────────────── */
--
-- Su PK era `id`, un slug que elegimos NOSOTROS (`reactivacion_24h`), no un identificador de
-- GHL. Dos empresas que quieran una plantilla con el mismo nombre chocan. Es la única PK del
-- esquema con este problema: todas las demás son ids de GHL o uuids.
--
-- Se aprovecha para renombrar `id` → `slug`, que es lo que siempre fue. La tabla está VACÍA
-- (nació así en la 017, a propósito), así que no hay ni una fila que migrar.
--
-- Ninguna otra tabla la referencia y ningún `upsert` del código usa `onConflict: "id"` sobre
-- ella — verificado con grep antes de tocarla. Por eso este cambio no rompe nada, a
-- diferencia de volver compuestas las otras PKs, que rompería 8 sitios con 42P10.

alter table public.closer_plantillas
  add column if not exists org_id uuid not null default '00000000-0000-0000-0000-000000000001';

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'closer_plantillas'
                and column_name = 'id') then
    alter table public.closer_plantillas drop constraint if exists closer_plantillas_pkey;
    alter table public.closer_plantillas rename column id to slug;
    alter table public.closer_plantillas add primary key (org_id, slug);
  end if;
end;
$$;

/* ──────────── Outbox: la idempotencia también era global ──────────── */
--
-- `idempotency_key` la elige quien llama (`closerStore.tsx` y `analizador.ts` la componen a
-- partir del contacto y la operación). Dos empresas pueden generar la misma y una le comería
-- el efecto a la otra: el `23505` se traga a propósito en `repo.ts:59` porque un choque
-- significa "este efecto ya se anotó" — con la clave global significaría "otra empresa ya
-- anotó algo parecido", que es lo contrario.
--
-- La tabla está vacía. Ningún `upsert` la referencia por `onConflict`.

alter table public.closer_ghl_outbox
  drop constraint if exists closer_ghl_outbox_idempotency_key_key;
drop index if exists public.closer_ghl_outbox_idempotency_key_key;

create unique index if not exists closer_ghl_outbox_idem_por_org
  on public.closer_ghl_outbox (org_id, idempotency_key);

/* ──────────── Y la bandeja: su unicidad también era global ──────────── */
--
-- `(proveedor, external_id)` es la dedupe de webhooks. Los ids de GHL y de Assistable son
-- únicos entre cuentas, así que hoy no chocan — pero la unicidad se scopea igual: si algún
-- proveedor futuro numera por cuenta, el reintento de una empresa descartaría el evento de
-- otra, y eso se vería como "un webhook que no llegó nunca", que es imposible de diagnosticar.

drop index if exists public.closer_webhook_inbox_proveedor_external_id_key;
alter table public.closer_webhook_inbox
  drop constraint if exists closer_webhook_inbox_proveedor_external_id_key;

create unique index if not exists closer_webhook_inbox_evento_unico
  on public.closer_webhook_inbox (org_id, proveedor, external_id)
  where external_id is not null;

commit;

notify pgrst, 'reload schema';
