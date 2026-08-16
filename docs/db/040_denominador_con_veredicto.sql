-- 040 · El chip "N verdes de M" cuenta una sola población (2026-08-16)
--
-- ── El número falso, medido ────────────────────────────────────────────────
--
-- Hoy, en producción, la tarjeta de `appointment-flow-ai` dice **"0 VERDES de 3"**. Lo honesto es
-- "0 de 1". Las otras dos filas del denominador son análisis del 2026-08-07 con `nivel = null`:
-- **no pueden ser verdes**, así que engordan la M sin poder sumar nunca a la N.
--
-- Es el MISMO bug que ya se arregló una vez y del que quedó un caso afuera. El comentario de
-- `verdesDe()` en `api/agentes/texto.ts` lo dice: "el numerador y el denominador tienen que salir
-- del mismo conjunto". Esa query filtra `auditable`, `disparo <> 'linea_base'` **y
-- `nivel is not null`**; la vista que da la M filtra los dos primeros y no el tercero. Con
-- `verdesDe` excluyendo lo que la vista incluye, las dos mitades del chip volvieron a contar
-- poblaciones distintas.
--
-- ── Por qué esas filas existen, y por qué NO se tocan ──────────────────────
--
-- Son anteriores a la `031`, que introdujo los tres niveles. Esa migración dejó deliberadamente en
-- `null` las filas viejas de `fallo = false`: no se puede saber si eran verdes o amarillas, y
-- rellenarlas como verdes sería fabricar salud medida sobre análisis que nunca la afirmaron. Esa
-- decisión sigue en pie. **El defecto no es la fila: es contarla donde no puede competir.**
--
-- Tampoco se borran. Son análisis reales de conversaciones reales: su `sentimiento`, su `criterio`
-- y su `fallo` son datos medidos que otras vitrinas sí usan. Borrarlos para arreglar un porcentaje
-- sería tirar evidencia para maquillar un número.
--
-- ── Por qué una columna nueva y no un filtro en el WHERE ───────────────────
--
-- La tentación es agregar `and nivel is not null` al WHERE de la vista. Rompería el panel de
-- sentimiento: `pct_positivos/neutrales/molestos` se calculan sobre esta misma población, y el
-- sentimiento de una fila legacy es un dato perfectamente válido —el modelo lo midió— que no
-- depende del veredicto. Sacarla del WHERE le quitaría al panel de ánimo dos lecturas buenas para
-- arreglar un chip que no es el suyo.
--
-- Son dos preguntas distintas sobre el mismo conjunto, así que son dos contadores:
--
--   · `analisis`      — cuántos análisis hubo. Población del sentimiento y del volumen.
--   · `con_veredicto` — cuántos de esos pueden ser verde/amarillo/rojo. Denominador del chip.
--
-- `con_veredicto <= analisis` siempre, y la diferencia es exactamente el legado de la `031`. El
-- día que esas filas salgan de la ventana de 30 días los dos números coinciden solos.
--
-- ── Dos trampas de `create or replace view`, para el próximo que la toque ──
--
--   1. **La columna nueva va al FINAL.** Postgres exige que las columnas existentes conserven
--      nombre, tipo y ORDEN; solo se pueden agregar al final. Poner `con_veredicto` después de
--      `analisis` —que es donde se leería mejor— falla con "cannot change name of view column".
--   2. **El ACL sobrevive**, al revés que en un DROP + CREATE (la `035` lo aprendió por las malas
--      con una función). Los grants de abajo no reponen nada: son la declaración explícita de
--      quién puede leer esto, para que se vea en el diff y no haya que ir a buscarla a `pg_class`.

create or replace view public.closer_agentes_texto_30d as
  select
    org_id,
    agente_id,
    count(*) as analisis,
    count(distinct ghl_contact_id) as conversaciones,
    count(*) filter (where fallo) as fallos,
    round(100.0 * count(*) filter (where sentimiento = 'positivo') / nullif(count(*), 0)) as pct_positivos,
    round(100.0 * count(*) filter (where sentimiento = 'neutral') / nullif(count(*), 0)) as pct_neutrales,
    round(100.0 * count(*) filter (where sentimiento = 'molesto') / nullif(count(*), 0)) as pct_molestos,
    -- Al final por obligación de Postgres, no por importancia: es el denominador del chip de
    -- verdes y cuenta exactamente lo que cuenta `verdesDe()` en `api/agentes/texto.ts`. Si esa
    -- query cambia, esta línea cambia con ella.
    count(*) filter (where nivel is not null) as con_veredicto
  from public.closer_analisis_agente
  where analizado_el >= now() - interval '30 days'
    and auditable
    and disparo <> 'linea_base'
  group by org_id, agente_id;

comment on view public.closer_agentes_texto_30d is
  'Agregado de 30 días por agente. `analisis` es la población del sentimiento; `con_veredicto` es '
  'el denominador del chip de verdes — una fila sin nivel (legado de la 031) no puede ser verde y '
  'por eso no cuenta ahí.';

revoke all on public.closer_agentes_texto_30d from public, anon, authenticated;
grant select on public.closer_agentes_texto_30d to service_role;

notify pgrst, 'reload schema';
