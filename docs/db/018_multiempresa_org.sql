-- 018 — La organización pasa a ser una EMPRESA: identidad, credenciales y prompts.
--
-- Primera migración de la capa multi-empresa (ESPEC-MULTIEMPRESA §2.1).
--
-- ── Por qué NO se crea `closer_empresas` ──────────────────────────────
--
-- La especificación pedía una tabla nueva. No hace falta: `closer_org_config` **ya es** la
-- tabla de configuración por organización. Su PK es `org_id`, no tiene ningún CHECK que la
-- limite a una fila, y ya guarda tres cosas que la spec pedía "convertir a por empresa" —
-- `zona_horaria`, `reconciliacion_marca_agua` y `ultima_reconciliacion`.
--
-- Crear `closer_empresas` al lado habría dejado DOS tablas de configuración por organización
-- que alguien tendría que mantener sincronizadas, y —peor— dos claves de inquilino
-- conviviendo (`org_id` y `empresa_id`), donde cada consulta tendría que acordarse de cuál
-- usar. Esa ambigüedad es exactamente como se filtran datos entre clientes.
--
-- Decisión de Fabio, 2026-08-06: se reusa `org_id` y se extiende esta tabla.
--
-- ── Los secretos nacen vacíos ─────────────────────────────────────────
--
-- Las columnas `*_cifrado` / `*_cifrada` guardan AES-256-GCM (`iv:authTag:ciphertext` en
-- base64) y las llena el panel de administración, nunca una migración: las migraciones están
-- en el repositorio. Hoy las credenciales siguen viniendo de variables de entorno de Vercel;
-- estas columnas son el destino, no el origen todavía.

begin;

/* ─────────────────────────── Identidad ─────────────────────────── */

alter table public.closer_org_config
  add column if not exists nombre       text,
  add column if not exists slug         text,
  add column if not exists es_principal boolean not null default false,
  add column if not exists activa       boolean not null default true,
  add column if not exists creado_el    timestamptz not null default now();

comment on column public.closer_org_config.es_principal is
  'SOLO ARIA. La empresa dueña de la plataforma: no se puede borrar ni desmarcar (trigger).';
comment on column public.closer_org_config.activa is
  'El cron no corre para las inactivas. Es la baja lógica: nunca se borran filas.';

/* ─────────────────────────── GoHighLevel ─────────────────────────── */

alter table public.closer_org_config
  -- Es la clave con la que un webhook entrante encuentra a su empresa (§6.3). No es un
  -- secreto: ya está versionado en `src/lib/ghl/contrato.ts` y viaja en cada payload.
  add column if not exists ghl_location_id    text,
  add column if not exists ghl_pit_cifrado    text,
  -- Distinto por empresa: si se filtra el de una, no sirve para las otras.
  add column if not exists ghl_webhook_secret text;

/* ─────────────────────────── Anthropic ─────────────────────────── */

alter table public.closer_org_config
  add column if not exists anthropic_key_cifrada text,
  add column if not exists anthropic_modelo      text,
  -- El código lo pasa como `output_config.effort`, no como un campo `thinking` del SDK.
  -- Valores válidos: low | medium | high. `off` NO existe en ese parámetro — si algún día se
  -- quiere apagar el razonamiento, es otra rama de código, no un valor de esta columna.
  add column if not exists anthropic_thinking    text;

alter table public.closer_org_config
  drop constraint if exists closer_org_config_thinking_valido;
alter table public.closer_org_config
  add constraint closer_org_config_thinking_valido
  check (anthropic_thinking is null or anthropic_thinking in ('low', 'medium', 'high'));

comment on column public.closer_org_config.anthropic_key_cifrada is
  'NULL = usa la key global ANTHROPIC_API_KEY. Ese fallback es TRANSITORIO (2026-08-06): '
  'cuando todas las empresas tengan la suya, se elimina y pasa a error explícito.';

/* ──────────────────── Assistable (llamadas de voz) ──────────────────── */

alter table public.closer_org_config
  add column if not exists assistable_token     text,
  add column if not exists assistable_cuenta_id text;

/* ─────────────────────────── Meta Ads ─────────────────────────── */

alter table public.closer_org_config
  add column if not exists meta_ad_account_id text,
  add column if not exists meta_token_cifrado text;

/* ──────────────── Los prompts de los 4 agentes auditados ──────────────── */
--
-- Reemplazan a `docs/prompts/<agente>.md` (§7.3). El auditor deja de leer del disco, con lo
-- que se cae también la dependencia de `includeFiles` en `vercel.json` — que es justamente el
-- modo de fallar más silencioso que tenía: el archivo existía en local y no en producción.
--
-- El hash se guarda AL LADO del texto y no se calcula al vuelo, porque es lo que permite
-- decirle al técnico "el prompt cambió desde que se detectó este hallazgo". Si se derivara en
-- la lectura, un cambio de prompt reescribiría la historia de los hallazgos viejos.

alter table public.closer_org_config
  add column if not exists prompt_appointment_texto      text,
  add column if not exists prompt_appointment_texto_hash text,
  add column if not exists prompt_lead_texto             text,
  add column if not exists prompt_lead_texto_hash        text,
  add column if not exists prompt_appointment_voz        text,
  add column if not exists prompt_appointment_voz_hash   text,
  add column if not exists prompt_lead_voz               text,
  add column if not exists prompt_lead_voz_hash          text;

/* ──────────────────────── Unicidades ──────────────────────── */

create unique index if not exists closer_org_config_slug_unico
  on public.closer_org_config (slug) where slug is not null;

-- El ruteo de webhooks depende de que un locationId apunte a UNA sola empresa. Si dos filas
-- lo compartieran, un mensaje entrante se atribuiría a cualquiera de las dos.
create unique index if not exists closer_org_config_location_unico
  on public.closer_org_config (ghl_location_id) where ghl_location_id is not null;

-- Solo puede existir UNA empresa principal (§2.2.1).
create unique index if not exists closer_org_config_una_principal
  on public.closer_org_config (es_principal) where es_principal;

/* ──────────────────── Guards: en la base, no en el código ──────────────────── */
--
-- §2.2 es explícita: estas reglas NO se confían al código de aplicación, porque un bug en un
-- endpoint las rompería para siempre. Un `delete` mal filtrado que se lleve a ARIA se lleva
-- con ella, por la FK, todos los datos del cliente que paga.

create or replace function public.closer_proteger_principal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.es_principal then
      raise exception 'La empresa principal no se puede eliminar (org %).', old.org_id
        using errcode = 'raise_exception';
    end if;
    return old;
  end if;

  -- UPDATE: se puede editar todo MENOS dejar de ser principal.
  if old.es_principal and not new.es_principal then
    raise exception 'La empresa principal no se puede desmarcar (org %).', old.org_id
      using errcode = 'raise_exception';
  end if;
  -- Desactivarla equivaldría a apagar la plataforma entera: el cron deja de correr para ella.
  if old.es_principal and not new.activa then
    raise exception 'La empresa principal no se puede desactivar (org %).', old.org_id
      using errcode = 'raise_exception';
  end if;
  return new;
end;
$$;

drop trigger if exists closer_org_config_protegida on public.closer_org_config;
create trigger closer_org_config_protegida
  before update or delete on public.closer_org_config
  for each row execute function public.closer_proteger_principal();

/* ──────────────────────── ARIA ──────────────────────── */
--
-- La fila YA existe (la sembró 002_bootstrap.sql). Acá solo se le completa la identidad; su
-- `org_id` no se toca porque es el que replica `api/_lib/repo.ts:38` y el que llevan las 12
-- tablas que ya tienen la columna. Cambiarlo obligaría a reescribir todo lo existente.
--
-- El `where` sobre las columnas nuevas hace la migración idempotente: si se vuelve a correr
-- no pisa una edición hecha desde el panel.

update public.closer_org_config
   set nombre          = coalesce(nombre, 'ARIA IA'),
       slug            = coalesce(slug, 'aria'),
       es_principal    = true,
       activa          = true,
       ghl_location_id = coalesce(ghl_location_id, 'DbWG5cimcumPcKk5p3xC')
 where org_id = '00000000-0000-0000-0000-000000000001';

commit;

-- Obligatorio: sin esto PostgREST sigue sirviendo el schema viejo y el primer INSERT contra
-- las columnas nuevas falla con 42703 aunque el ALTER haya corrido.
notify pgrst, 'reload schema';
