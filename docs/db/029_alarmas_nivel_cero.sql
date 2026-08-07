-- 029 · Qué señal del nivel 0 adelantó el análisis (2026-08-07)
--
-- El nivel 0 son cinco heurísticas de costo cero (`api/_lib/auditor/heuristicas.ts`) que corren
-- sobre `closer_mensajes` y pueden **adelantar** un análisis que el debounce de 5 mensajes todavía
-- no dejaba pasar. Sin esto, una conversación donde la IA manda 4 mensajes y el contacto se va
-- enojado no se auditaba nunca: el agujero estaba documentado como consecuencia matemática de la
-- regla del debounce, y es justo el caso que más duele.
--
-- ── Por qué una columna nueva y no un valor más en `disparo` ────────────────
--
-- `disparo` responde **quién pidió** el análisis: `webhook`, `manual` o `linea_base`. La alarma
-- responde otra cosa —**por qué se adelantó**— y las dos son independientes: un análisis de
-- `disparo = 'webhook'` puede haber llegado por delta o por alarma. Meterlas en la misma columna
-- obligaría a `webhook_por_alarma`, y a partir de ahí cada combinación nueva multiplica los
-- valores hasta que la columna deja de ser consultable.
--
-- ── Para qué se guarda ─────────────────────────────────────────────────────
--
-- Para poder borrar señales. Una heurística que dispara seguido y **nunca** termina en veredicto
-- rojo es gasto puro, y sin este dato no hay forma de saber cuál es:
--
--   select unnest(alarmas) as senal,
--          count(*) as analisis,
--          count(*) filter (where fallo) as rojos
--     from closer_analisis_agente
--    where alarmas is not null
--    group by 1 order by 2 desc;
--
-- Es el pendiente #4 de `docs/13-LEXICO-AUDITOR.md`. Sin la columna, ese doc prometía una medición
-- que no se podía hacer.
--
-- `null` y `{}` NO significan lo mismo, y por eso no hay default: `null` = el análisis salió por
-- delta, nadie miró alarmas; `{}` no se escribe nunca. Un default `'{}'` haría que los análisis
-- viejos —anteriores a esta migración— parecieran "se miró y no había nada", que es un hecho que
-- nadie midió.

alter table public.closer_analisis_agente
  add column if not exists alarmas text[];

comment on column public.closer_analisis_agente.alarmas is
  'Señales del nivel 0 que adelantaron este análisis. null = salió por el debounce normal.';

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
