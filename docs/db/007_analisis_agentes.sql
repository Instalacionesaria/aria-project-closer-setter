-- ============================================================================
-- Migración 007 · Resultado del análisis de conversaciones de los agentes de texto
--
-- ── Qué llena esta tabla ──
--
-- Las dos IAs analizadoras de agentes de TEXTO: una audita a Lead Flow AI (territorio
-- `zona_setter`, su trabajo es llevar el lead a la cita) y otra a Appointment Flow AI
-- (`zona_closer`, su trabajo es que el contacto se presente). Los agentes de VOZ son de
-- Fabio y no escriben acá.
--
-- ── Por qué se guarda en vez de calcularse al vuelo ──
--
-- La pestaña "Auditoría de Agentes" que armó Francisco pide, por agente: el sentimiento
-- repartido en tres tramos, los operativos de los últimos 30 días y un sparkline de 12
-- semanas. Nada de eso sale de mirar GHL en el momento: el sentimiento lo produce un modelo
-- (caro de recalcular) y las 12 semanas son historia que hay que haber acumulado.
--
-- Además `CLAUDE.md` §2 lo pide explícitamente: el dashboard LEE de la base, nunca calcula
-- al renderizar ni consulta servicios externos en vivo.
--
-- ── Una fila por (contacto, análisis), no por contacto ──
--
-- Cada vez que el webhook detecta un mensaje nuevo se guarda un análisis con su fecha. Eso
-- es lo que permite agrupar por semana para el sparkline y comparar período contra período
-- para el delta (▲ +4 pts). Si se pisara la fila anterior, la historia se perdería y el
-- gráfico no podría existir.
--
-- El análisis es incremental a propósito: la tarjeta habla de 214 conversaciones, y
-- analizarlas de una sentada serían 214 llamadas al modelo. Guardando cada una a medida que
-- llega el mensaje, los agregados se construyen solos y sin picos de costo.
-- ============================================================================

create table if not exists closer_analisis_agente (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null,

  -- ── A quién se auditó ──
  -- Coincide con `AgentInfo.id` del front: 'lead-flow-ai' | 'appointment-flow-ai'.
  -- Se guarda el id y no el territorio para que la fila se lea sin traducir nada.
  agente_id  text not null check (agente_id in ('lead-flow-ai', 'appointment-flow-ai')),

  ghl_contact_id  text not null,
  -- La conversación concreta. Junto con `analizado_el` permite ver la evolución de un mismo
  -- chat: el mismo contacto puede empeorar o mejorar con el correr de los mensajes.
  conversation_id text,

  -- ── Veredicto del modelo ──
  fallo    boolean not null,
  -- Los cinco criterios de la rúbrica, más 'ninguno'. Es la clave de agrupación de las
  -- alertas en la UI ("×15 casos" = 15 filas con el mismo criterio).
  criterio text not null check (criterio in (
    'frustracion', 'dejo_de_responder', 'promesa_incorrecta',
    'no_es_lo_que_busca', 'insiste_no_entiende', 'ninguno'
  )),
  -- Frase concreta y específica de esa conversación. Es el texto que el humano lee en su
  -- cola de intervenciones urgentes, y el que se copia a la nota `[IA]` de GHL.
  motivo   text,

  -- ── Sentimiento ──
  -- Alimenta el panel de tres tramos (POSITIVOS / NEUTRALES / MOLESTOS). Vive acá y no en
  -- una tabla aparte porque sale del mismo análisis: separarlo obligaría a llamar al modelo
  -- dos veces por conversación.
  sentimiento text not null check (sentimiento in ('positivo', 'neutral', 'molesto')),

  -- ── Trazabilidad ──
  -- Qué modelo emitió el veredicto. Sin esto, un cambio de modelo mezclaría en la misma
  -- serie mediciones que no son comparables, y el sparkline mostraría un salto sin causa.
  modelo      text,
  analizado_el timestamptz not null default now()
);

comment on table closer_analisis_agente is
  'Un análisis de conversación por fila. Alimenta sentimiento, operativos, sparkline y alertas de Auditoría de Agentes.';

-- El sparkline agrupa por semana y los operativos filtran por ventana de 30 días: los dos
-- recorren (agente, fecha). Sin este índice, cada carga de la pestaña haría un scan entero.
create index if not exists idx_analisis_agente_fecha
  on closer_analisis_agente (agente_id, analizado_el desc);

-- La lista de trabajo del técnico agrupa los fallos por criterio dentro de cada agente.
-- Parcial sobre `fallo` porque la enorme mayoría de las filas no son fallos, y ese índice
-- no tiene por qué cargar con ellas.
create index if not exists idx_analisis_agente_fallos
  on closer_analisis_agente (agente_id, criterio, analizado_el desc)
  where fallo;

-- Para resolver "¿cuál fue el último veredicto de este contacto?" sin recorrer su historia.
create index if not exists idx_analisis_agente_contacto
  on closer_analisis_agente (ghl_contact_id, analizado_el desc);

/* ==========================================================================
   Agregado por agente — lo que consume la pestaña
   ==========================================================================

   La vista resuelve en SQL el reparto del sentimiento y los conteos de los últimos 30
   días, para que el endpoint no reimplemente esos criterios (mismo motivo por el que
   existe `closer_mi_dia`: que el front no reescriba las reglas).

   NO calcula la tasa protagonista ni "agendadas": esos números salen de las citas de GHL,
   no de los análisis, y mezclarlos acá haría creer que esta tabla los conoce.
   -------------------------------------------------------------------------- */
create or replace view closer_agentes_texto_30d as
  select
    agente_id,
    count(*)                                          as analisis,
    count(distinct ghl_contact_id)                    as conversaciones,
    count(*) filter (where fallo)                     as fallos,
    -- Porcentajes enteros: es como los pinta la UI (85% / 10% / 5%).
    round(100.0 * count(*) filter (where sentimiento = 'positivo') / nullif(count(*), 0)) as pct_positivos,
    round(100.0 * count(*) filter (where sentimiento = 'neutral')  / nullif(count(*), 0)) as pct_neutrales,
    round(100.0 * count(*) filter (where sentimiento = 'molesto')  / nullif(count(*), 0)) as pct_molestos
  from closer_analisis_agente
  where analizado_el >= now() - interval '30 days'
  group by agente_id;

comment on view closer_agentes_texto_30d is
  'Sentimiento y volumen por agente en los últimos 30 días. La tasa protagonista sale de las citas de GHL, no de acá.';
