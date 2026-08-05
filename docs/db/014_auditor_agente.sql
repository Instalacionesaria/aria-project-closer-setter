-- 014 — El auditor de IA: autoría de mensajes, debounce y hallazgos accionables (2026-08-04)
--
-- Tres cosas distintas en una migración porque las tres nacen del mismo cambio:
--
--   (a) `closer_mensajes` aprende QUIÉN escribió cada mensaje. Sin eso no se puede contar
--       "mensajes de la IA" (el debounce que pidió Fabio) ni etiquetar el transcript, y el
--       auditor sigue juzgando plantillas de workflow como si fueran del agente.
--   (b) `closer_analisis_agente` guarda la LÍNEA BASE del debounce y contra qué versión del
--       prompt del agente se emitió el veredicto.
--   (c) `closer_hallazgo_agente` es nueva: la unidad de trabajo de la pestaña Auditoría de
--       Agentes es la ALERTA, no el análisis. Y las alertas MUTAN (un técnico las parchea),
--       mientras que un análisis es una medición que no se toca.
--
-- ── Lo que se descubrió auditando producción antes de escribir esto ──
--
--   · `bot_activado` y `bot_reactivar` no existen en NINGÚN contacto de la cuenta (0 de 0),
--     y los workflows que los aplicarían están en borrador. El portón 2 del auditor bloquea
--     al 100%: hoy no produce ni un análisis, a propósito, hasta que Francisco los publique.
--   · Y sin embargo el bot SÍ atiende: la conversación del contacto de prueba `moises` es
--     un intercambio completo con Appointment Flow AI.
--   · "outbound" no quiere decir "IA". Por el mismo canal salen el chatbot
--     (`source:"app"` sin `userId`), un humano en la UI de GHL (`source:"app"` CON `userId`),
--     plantillas de workflow (`source:"workflow"`) e integraciones (`source:"api"`).
--
-- Regla heredada de 013 — «lo que se deriva en la lectura no se queda viejo; lo que se
-- denormaliza, sí». `autor` es la excepción CONSCIENTE: se denormaliza porque su origen
-- (`source`/`userId` del payload de GHL) no vuelve a estar disponible sin repedir la
-- conversación entera, y el debounce lo consulta en cada mensaje.
--
-- §51.5: `notify pgrst, 'reload schema';` al final. El ALTER de 011 dejó el schema cache
-- viejo y rompió un UPDATE en producción con un 42703 sobre una columna que existía.

begin;

/* ================================================================== */
/* (a) Autoría de cada mensaje                                         */
/* ================================================================== */

-- Nullable y SIN default, igual que los contadores de 013 y por la misma razón:
--   NULL          = se ingirió antes de esta migración (o la vía no trajo las señales)
--   'desconocido' = vinieron las señales y NO alcanzaron para atribuirlo
-- Poder distinguirlos es lo que va a permitir saber si el webhook estándar de GHL manda o
-- no `source`, en vez de tener que suponerlo. El diagnóstico reporta los dos por separado.
alter table public.closer_mensajes
  add column if not exists autor text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'closer_mensajes_autor_check'
  ) then
    alter table public.closer_mensajes
      add constraint closer_mensajes_autor_check
      check (autor is null or autor in
        ('contacto', 'agente_ia', 'asesor', 'workflow', 'sistema', 'desconocido'));
  end if;
end $$;

comment on column public.closer_mensajes.autor is
  'Quién escribió el mensaje, derivado de direction/source/userId en src/lib/ghl/autoria.ts. '
  'NULL = ingerido antes de 014. ''desconocido'' = no se pudo atribuir con confianza. '
  'Solo ''agente_ia'' cuenta para el debounce del auditor y para imputarle fallas al agente.';

-- El debounce hace `count(*) where ghl_contact_id = $1 and autor = 'agente_ia'` en cada
-- mensaje entrante o saliente. Parcial: las otras autorías no se cuentan nunca.
create index if not exists idx_mensajes_autor_ia
  on public.closer_mensajes (ghl_contact_id)
  where autor = 'agente_ia';

-- El diagnóstico agrupa por autoría en una ventana de días.
create index if not exists idx_mensajes_autor_fecha
  on public.closer_mensajes (autor, timestamp_ghl desc);

/* ================================================================== */
/* (b) El análisis: línea base del debounce y versión del prompt       */
/* ================================================================== */

-- Cuántos mensajes de la IA había en el CACHÉ cuando se corrió este análisis. El debounce
-- es una resta contra este número, no un contador incremental: si aparecen o desaparecen
-- mensajes (backfill, o el borrado de gemelos de ingesta.ts), las dos puntas de la resta se
-- mueven juntas y el cálculo se auto-cura. Un contador incremental no.
alter table public.closer_analisis_agente
  add column if not exists ia_cache_al_analizar integer;

-- Hash del contenido del prompt del agente auditado (docs/prompts/*.md) en el momento del
-- veredicto. Sirve para que la pestaña avise "el prompt cambió desde que se detectó esto":
-- sin él, un técnico pega un reemplazo de un fragmento que ya no existe.
alter table public.closer_analisis_agente
  add column if not exists prompt_hash text;

-- ¿La conversación se pudo auditar? La rúbrica nueva tiene una precondición explícita
-- (sin mensajes del agente, mayormente audio, o muy corta). Antes eso no existía y una
-- conversación inauditable recibía un veredicto igual — que es como nació el bug de §53.1.
alter table public.closer_analisis_agente
  add column if not exists auditable boolean not null default true;

-- Qué disparó este análisis: 'webhook' | 'manual' | 'linea_base'.
-- 'linea_base' son filas que NO llamaron al modelo: existen solo para sembrar el contador
-- de una conversación vieja sin gastar una inferencia por cada backfill.
alter table public.closer_analisis_agente
  add column if not exists disparo text not null default 'webhook';

/**
 * La rúbrica nueva agrega dos criterios y el CHECK viejo los rechazaría.
 *
 * `fuera_de_alcance` (el agente deja al contacto en un callejón sin derivarlo) y
 * `dato_faltante` (no sabe algo que debería estar en su base de conocimiento) no son
 * variantes de los cinco anteriores: son las dos causas más frecuentes de conversación
 * trabada que la rúbrica vieja tenía que forzar dentro de "insiste y no entiende".
 *
 * Se busca el constraint por su definición en vez de por nombre: el nombre depende de cómo
 * lo generó Postgres y de si alguien lo recreó a mano.
 */
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.closer_analisis_agente'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%criterio%'
  loop
    execute format('alter table public.closer_analisis_agente drop constraint %I', c.conname);
  end loop;

  execute $ck$
    alter table public.closer_analisis_agente
      add constraint closer_analisis_agente_criterio_check
      check (criterio in ('frustracion', 'dejo_de_responder', 'promesa_incorrecta',
                          'no_es_lo_que_busca', 'insiste_no_entiende', 'fuera_de_alcance',
                          'dato_faltante', 'ninguno'))
  $ck$;
end $$;

comment on column public.closer_analisis_agente.ia_cache_al_analizar is
  'Mensajes con autor=''agente_ia'' que tenía el contacto en closer_mensajes al analizar. '
  'El debounce dispara cuando el conteo actual menos este supera AUDITOR_UMBRAL_IA.';
comment on column public.closer_analisis_agente.disparo is
  'webhook | manual | linea_base. Las de linea_base no llamaron al modelo.';

-- El debounce lee la fila más reciente por contacto en cada mensaje: sin esto sería un scan.
create index if not exists idx_analisis_contacto_reciente
  on public.closer_analisis_agente (ghl_contact_id, analizado_el desc);

/**
 * La vista de 30 días pasa a contar SOLO lo que de verdad se midió.
 *
 * Sin este filtro, las filas de línea base (que nunca vieron el modelo y llevan el
 * sentimiento por defecto) inflarían el denominador y el "85% positivos" de la pestaña
 * estaría midiendo, en parte, conversaciones que nadie evaluó.
 */
create or replace view public.closer_agentes_texto_30d as
  select
    agente_id,
    count(*)                                        as analisis,
    count(distinct ghl_contact_id)                  as conversaciones,
    count(*) filter (where fallo)                   as fallos,
    round(100.0 * count(*) filter (where sentimiento = 'positivo')::numeric
          / nullif(count(*), 0)::numeric)           as pct_positivos,
    round(100.0 * count(*) filter (where sentimiento = 'neutral')::numeric
          / nullif(count(*), 0)::numeric)           as pct_neutrales,
    round(100.0 * count(*) filter (where sentimiento = 'molesto')::numeric
          / nullif(count(*), 0)::numeric)           as pct_molestos
  from public.closer_analisis_agente
  where analizado_el >= now() - interval '30 days'
    and auditable
    and disparo <> 'linea_base'
  group by agente_id;

/* ================================================================== */
/* (c) Los hallazgos — la unidad de trabajo de la pestaña              */
/* ================================================================== */

/**
 * Por qué tabla hija y no columnas de `closer_analisis_agente`:
 *
 *   1. Un análisis puede producir VARIOS hallazgos (una conversación puede tener a la vez
 *      una promesa incorrecta y respuestas larguísimas). El esquema actual fuerza
 *      exactamente un `criterio`.
 *   2. Los hallazgos MUTAN: `activo → resuelto_por_humano → parcheado`. Mutar la tabla de
 *      análisis para anotar estado de trabajo humano rompería la serie histórica de 12
 *      semanas que esa tabla existe para sostener.
 *   3. Agrupar y contar por `error_code` necesita columnas indexadas, no un jsonb.
 *
 * `fallo`, `criterio`, `motivo` y `sentimiento` se quedan en el padre y NO se tocan: los
 * leen `api/closer/mi-dia.ts` y `api/setter/urgentes.ts` para las dos colas rojas.
 */
create table if not exists public.closer_hallazgo_agente (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  analisis_id uuid not null references public.closer_analisis_agente(id) on delete cascade,
  agente_id   text not null check (agente_id in ('lead-flow-ai', 'appointment-flow-ai')),
  ghl_contact_id text not null,

  -- La clave de agrupación. Es lo que convierte 15 casos sueltos en un "×15 casos" sobre el
  -- que el técnico puede actuar una sola vez. El formato lo normaliza Node antes de insertar.
  error_code  text not null check (error_code ~ '^[a-z0-9_]{3,48}$'),
  titulo      text not null,
  categoria   text not null check (categoria in
                ('comportamiento', 'base_conocimiento', 'informacion_adicional')),
  severidad   text not null check (severidad in ('rojo', 'amarillo')),
  criterio    text not null,
  diagnostico text,

  -- La corrección al prompt del agente. `fragmento_prompt` es el DISCRIMINANTE ESTRUCTURAL
  -- del front (regla 1 del patrón del closer): presente = el auditor tenía el prompt del
  -- agente y citó el texto exacto; ausente = no lo tenía y la corrección es una instrucción
  -- autónoma para agregar. Nunca un booleano.
  fragmento_prompt text,
  prompt_seccion   text,
  correccion_tipo  text check (correccion_tipo in ('reemplazo', 'agregado')),
  correccion       text,
  prompt_hash      text,

  -- El par de mensajes que citó el auditor. Es lo que hace falsable el veredicto: sin cita
  -- textual, un hallazgo es una opinión que nadie puede verificar contra el chat.
  evidencia_usuario text,
  evidencia_ia      text,
  evidencia_el      timestamptz,

  estado      text not null default 'activo'
              check (estado in ('activo', 'resuelto_por_humano', 'parcheado')),
  resuelto_el timestamptz,
  resuelto_por text,

  detectado_el timestamptz not null default now()
);

comment on table public.closer_hallazgo_agente is
  'Un hallazgo del auditor sobre el agente de IA. Varios por análisis. Se agrupan por '
  'error_code en la pestaña Auditoría de Agentes y mutan cuando un técnico los parchea.';

-- El endpoint de alertas pide los activos de un agente agrupados por patrón.
create index if not exists idx_hallazgo_agrupacion
  on public.closer_hallazgo_agente (agente_id, error_code, detectado_el desc);
create index if not exists idx_hallazgo_activos
  on public.closer_hallazgo_agente (agente_id, detectado_el desc)
  where estado = 'activo';
create index if not exists idx_hallazgo_contacto
  on public.closer_hallazgo_agente (ghl_contact_id, detectado_el desc);

/* ================================================================== */
/* (d) El historial de ajustes — append-only                           */
/* ================================================================== */

-- Cada fila es "un técnico aplicó esta corrección al prompt y con eso cerró N casos".
-- Append-only: es un registro permanente, y la pestaña promete que queda guardado.
create table if not exists public.closer_ajustes_agente (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,
  agente_id  text not null check (agente_id in ('lead-flow-ai', 'appointment-flow-ai')),
  error_code text not null,
  titulo     text not null,
  categoria  text not null,
  -- Cuántos casos cerró ESTE ajuste. Es un hecho de la escritura, no un recuento vivo: si
  -- mañana el patrón reaparece, esta fila tiene que seguir diciendo cuántos cerró entonces.
  casos_cerrados integer not null default 0,
  diagnostico      text,
  fragmento_prompt text,
  correccion       text,
  prompt_hash      text,
  autor      text not null,
  aplicado_el timestamptz not null default now()
);

create index if not exists idx_ajustes_agente_fecha
  on public.closer_ajustes_agente (agente_id, aplicado_el desc);

/* ================================================================== */
/* (e) Candado por contacto — un análisis a la vez                     */
/* ================================================================== */

-- Los webhooks de entrante y saliente llegan casi juntos todo el tiempo. Sin candado, los
-- dos pueden ver el mismo delta y disparar dos análisis del mismo contacto.
alter table public.closer_contactos
  add column if not exists auditor_claim_el timestamptz;

/**
 * Calcado de `closer_reconciliar_claim` (012), y RPC por la misma razón de §51.5: un
 * `.update().or()` de PostgREST ya falló en producción con 42703 sobre una columna que
 * existía, por schema cache viejo tras un ALTER. La RPC esquiva el camino de filtros.
 *
 * NO se libera al terminar. Si el análisis explota, la resta del debounce sigue por encima
 * del umbral y el próximo mensaje reintenta; liberar en caliente abriría un bucle de
 * reintentos justo cuando GHL o Anthropic están fallando. Como efecto lateral, el candado
 * es además un techo duro: nunca más de un análisis por contacto por ventana.
 */
create or replace function public.closer_auditor_claim(
  p_contact_id text,
  p_ventana_segundos integer default 120
) returns boolean
language sql
security definer
set search_path to 'public'
as $$
  with intento as (
    update public.closer_contactos
       set auditor_claim_el = now()
     where ghl_contact_id = p_contact_id
       and (auditor_claim_el is null
            or auditor_claim_el < now() - make_interval(secs => p_ventana_segundos))
    returning 1
  )
  select exists (select 1 from intento);
$$;

/* ================================================================== */
/* (f) Permisos                                                        */
/* ================================================================== */

-- La 007 se olvidó de esto y la 008 existe SOLO para arreglarlo. No repetir el olvido: la
-- anon key viaja en el bundle del browser, así que una tabla sin RLS ni revoke queda
-- legible Y ESCRIBIBLE por cualquiera que abra la app.
alter table public.closer_hallazgo_agente enable row level security;
alter table public.closer_ajustes_agente  enable row level security;

revoke all on public.closer_hallazgo_agente from anon, authenticated;
revoke all on public.closer_ajustes_agente  from anon, authenticated;
revoke all on public.closer_agentes_texto_30d from anon, authenticated;

grant select, insert, update, delete on public.closer_hallazgo_agente to service_role;
grant select, insert, update, delete on public.closer_ajustes_agente  to service_role;
grant select on public.closer_agentes_texto_30d to service_role;

revoke all on function public.closer_auditor_claim(text, integer) from anon, authenticated;
grant execute on function public.closer_auditor_claim(text, integer) to service_role;

commit;

-- Obligatorio (§51.5). Sin esto, PostgREST sigue sirviendo el schema viejo y los primeros
-- INSERT contra las columnas nuevas fallan con 42703 aunque el SQL de arriba haya corrido.
notify pgrst, 'reload schema';
