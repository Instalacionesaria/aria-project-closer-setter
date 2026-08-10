-- 034 · Los criterios del auditor del setter (2026-08-08)
--
-- El auditor de pre-agenda tiene su propia rúbrica: la misión del Lead Flow es **calificar y
-- agendar**, no confirmar y acompañar. "Abandonó la conversación" significa otra cosa cuando el
-- contacto todavía no agendó, y "promesa incorrecta sobre el programa" no aplica a quien nunca
-- habló del programa.
--
-- Seis criterios nuevos. `dato_faltante` no está en la lista porque ya existe y significa lo mismo
-- en las dos etapas — el contacto preguntó algo que el prompt SÍ contesta y el agente no lo supo.
--
-- ── Por qué una columna sola y no una por territorio ───────────────────────
--
-- Porque el criterio responde "qué falló", y eso no cambia de naturaleza según quién falló. El
-- territorio ya está implícito en `agente_id`, que tiene su propio CHECK. Partir la columna
-- obligaría a toda lectura a mirar las dos y decidir cuál gana — es la regla 3.
--
-- Que un criterio de setter aparezca en un análisis de closer es imposible por otra vía: la
-- rúbrica que se le manda al modelo solo describe los siete de su territorio, y el esquema de
-- structured outputs no admite otro valor.

alter table public.closer_analisis_agente
  drop constraint if exists closer_analisis_agente_criterio_check;

alter table public.closer_analisis_agente
  add constraint closer_analisis_agente_criterio_check
  check (criterio = any (array[
    -- Closer · post-agenda
    'frustracion',
    'dejo_de_responder',
    'promesa_incorrecta',
    'no_es_lo_que_busca',
    'insiste_no_entiende',
    'fuera_de_alcance',
    -- Setter · pre-agenda
    'calificacion_saltada',
    'presiono_sin_calificar',
    'sin_derivacion',
    'info_falsa',
    'abandono_calificado',
    'objecion_no_entendida',
    -- Compartidos
    'dato_faltante',
    'ninguno',
    -- Calidad, no fallo: el carril amarillo (migración 030)
    'acompanamiento'
  ]));

comment on column public.closer_analisis_agente.criterio is
  'El criterio principal del veredicto. Seis del closer, seis del setter, `dato_faltante` compartido, `acompanamiento` del carril amarillo, o `ninguno`.';

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
