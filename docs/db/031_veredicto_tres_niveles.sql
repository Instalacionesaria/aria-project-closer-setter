-- 031 · El veredicto pasa a tener tres niveles (2026-08-08)
--
-- `fallo boolean` metía dos hechos distintos en la misma casilla: "el agente trabajó bien" y "no
-- se pudo decir nada". Un análisis que salió limpio **es un dato medido**, y es lo único que
-- permite que una tarjeta afirme salud en vez de mostrar `—` por falta de datos (D3).
--
--   verde    · el agente trabajó bien. Se guarda QUÉ estuvo bien, con su cita textual.
--   amarillo · sin fallo, pero mejorable. Sin corrección de prompt.
--   rojo     · fallo crítico. Diagnóstico + corrección de prompt.
--
-- ── Por qué `fallo` NO se dropea ───────────────────────────────────────────
--
-- Lo leen `miDia.ts` (la cola de Urgentes), `setter/urgentes.ts`, `alertas.ts` y el panel de
-- sentimiento. Dropearlo ahora sería el contract sin el expand, que es justo el patrón que este
-- repo usa para no romper producción.
--
-- Pero dos columnas que responden lo mismo divergen — es la regla 3 de CLAUDE.md — así que la
-- invariante la hace cumplir **Postgres**, no la disciplina de quien escriba el próximo INSERT:
--
--     check ((nivel = 'rojo') = fallo)
--
-- Con eso `fallo` deja de ser un dato paralelo y pasa a ser la proyección booleana de `nivel`. Una
-- fila incoherente no se puede escribir ni a mano.
--
-- ── El backfill dice la verdad, y por eso no llena todo ────────────────────
--
-- Las filas viejas se pueden clasificar con lo que ya tienen:
--
--   · `fallo = true`  → `rojo`. No hay ambigüedad: pidió intervención.
--   · `fallo = false` → **NO se puede saber** si fue verde o amarillo. El nivel viejo no
--     distinguía "salió limpio" de "tenía observaciones sin gravedad", y esa diferencia la decidía
--     el modelo mirando la conversación. Rellenarlas como `verde` sería fabricar salud medida
--     sobre análisis que nunca la afirmaron — exactamente el dato falso que D3 existe para evitar.
--
-- Así que `nivel` queda **nullable** y las filas de `fallo = false` se quedan en `null`. `null`
-- significa "análisis anterior a los tres niveles", y la vista no lo cuenta como verde. Mismo
-- criterio que `closer_avances.autor_usuario_id` en la `025`: nullable y sin backfill inventado.
--
-- El CHECK tolera el `null` a propósito (`nivel is null or ...`), o el backfill parcial no entraría.

alter table public.closer_analisis_agente
  add column if not exists nivel text,
  -- Qué estuvo bien (verde) o qué se puede mejorar (amarillo), en una línea.
  add column if not exists destacado text,
  -- La cita textual del transcript que lo respalda. Sin cita, no se escribe el destacado.
  add column if not exists evidencia text;

-- Las viejas con intervención son rojas sin ambigüedad. Las demás quedan en null: ver arriba.
update public.closer_analisis_agente
   set nivel = 'rojo'
 where nivel is null
   and fallo = true;

alter table public.closer_analisis_agente
  drop constraint if exists closer_analisis_agente_nivel_check;

alter table public.closer_analisis_agente
  add constraint closer_analisis_agente_nivel_check
  check (nivel is null or nivel in ('verde', 'amarillo', 'rojo'));

-- La invariante: `fallo` es la proyección de `nivel`, y Postgres no deja escribir otra cosa.
alter table public.closer_analisis_agente
  drop constraint if exists closer_analisis_agente_nivel_coherente;

alter table public.closer_analisis_agente
  add constraint closer_analisis_agente_nivel_coherente
  check (nivel is null or ((nivel = 'rojo') = fallo));

comment on column public.closer_analisis_agente.nivel is
  'verde | amarillo | rojo. null = análisis anterior a la 031 que no pidió intervención: no se sabe cuál de los dos era.';
comment on column public.closer_analisis_agente.destacado is
  'Qué estuvo bien (verde) o qué mejorar (amarillo). Nunca se escribe sin `evidencia`.';

-- Cuenta los verdes de un agente sin escanear la tabla: es lo que alimenta la tarjeta.
create index if not exists idx_analisis_nivel
  on public.closer_analisis_agente (org_id, agente_id, nivel, analizado_el desc);

-- Sin esto el primer INSERT falla con 42703 sobre una columna que existe.
notify pgrst, 'reload schema';
