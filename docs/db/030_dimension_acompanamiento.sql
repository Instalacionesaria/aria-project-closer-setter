-- 030 · `acompanamiento`: la dimensión de calidad del carril amarillo (2026-08-07)
--
-- Los siete criterios de la rúbrica son de **fallo**: cada uno describe algo que salió mal, y
-- cumplirse significa que el agente hizo daño. El carril amarillo necesita decir "esto se podía
-- hacer mejor" sin que sea un defecto, y eso no se consigue aflojándole el umbral a los siete: un
-- criterio con umbral flojo produce ruido, y el ruido le enseña al técnico a ignorar la pestaña.
--
-- Por eso `acompanamiento` entra al CHECK como un valor más, pero **no es un octavo criterio**.
-- Vive en su propia escala (`acompano` / `respondio` / `desacompaso`, en
-- `api/_lib/auditor/amarillo.ts`), la escribe un camino distinto —el cron diario, no el webhook—
-- y nunca produce `fallo = true`. Lo único que comparte con los siete es la columna.
--
-- ── Qué NO cambia, y es lo importante ──────────────────────────────────────
--
-- La cola roja se enciende con `closer_analisis_agente.fallo`, no con `criterio`. Un análisis de
-- este carril se escribe con `fallo = false`, así que no le apaga el bot a nadie, no entra a Mi
-- Día, ni a Urgentes, ni al Buzón. Un contacto no aparece en ninguna cola del closer por un
-- amarillo — vive únicamente en Auditoría de Agentes, para el técnico.
--
-- ── Por qué el CHECK y no una columna nueva ────────────────────────────────
--
-- `criterio` ya responde "por qué se escribió este análisis", y agregar una columna paralela
-- —`dimension`, digamos— obligaría a que toda lectura mirara las dos y decidiera cuál gana. Dos
-- columnas que responden lo mismo divergen: es la regla 3 de CLAUDE.md.
--
-- `closer_hallazgo_agente.criterio` no lleva CHECK, así que no hay nada que tocar de ese lado.

alter table public.closer_analisis_agente
  drop constraint if exists closer_analisis_agente_criterio_check;

alter table public.closer_analisis_agente
  add constraint closer_analisis_agente_criterio_check
  check (criterio = any (array[
    'frustracion',
    'dejo_de_responder',
    'promesa_incorrecta',
    'no_es_lo_que_busca',
    'insiste_no_entiende',
    'fuera_de_alcance',
    'dato_faltante',
    'ninguno',
    -- Calidad, no fallo. Solo lo escribe el cron diario del carril amarillo.
    'acompanamiento'
  ]));

comment on column public.closer_analisis_agente.criterio is
  'Los 7 criterios de fallo de la rúbrica, o `acompanamiento` (calidad, carril amarillo), o `ninguno`.';

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
