-- 038 · Los agente_id de voz entran a las tablas del auditor (2026-08-10)
--
-- El auditor de voz existe desde hoy (pedido de Fabio: empiezan las pruebas de los agentes de
-- llamadas), y las tres tablas del auditor tenían el CHECK de `agente_id` escrito cuando el
-- universo era de dos: `lead-flow-ai` y `appointment-flow-ai`. Un INSERT con un id de voz fallaba
-- con 23514 en las tres.
--
-- ── Qué se amplía y qué NO ────────────────────────────────────────────────
--
-- Se recrean los tres CHECK con los CUATRO ids. **El CHECK de `criterio` no se toca**: la rúbrica
-- de voz juzga el mismo trabajo que la de chat de su territorio —confirmar y acompañar el
-- Appointment Flow, calificar y agendar el Lead Flow— así que reusa los criterios de la `034` tal
-- cual. Un criterio nuevo inventado para voz habría partido las estadísticas por canal sin ganar
-- nada: "presión por agendar" es el mismo fallo dicho por chat o por teléfono.
--
-- Sigue siendo un CHECK con lista literal, no una FK a un catálogo: los agentes son cuatro y
-- cambian con deploy (los define el código en `TERRITORIOS` / `TERRITORIOS_VOZ`), y la lista en el
-- CHECK hace que un id inventado sea inescribible — la misma técnica de la `031` con `nivel`.
--
-- ── Cómo se dedupe un análisis de voz, sin columna nueva ──────────────────
--
-- `closer_analisis_agente.conversation_id` guarda el `call_id` de la llamada (una llamada ES una
-- conversación completa). El par (agente_id, conversation_id) es el candado del reintento del
-- webhook — no hace falta ni columna ni índice nuevo: la consulta de dedupe es puntual y la tabla
-- es chica por definición (un análisis por llamada contestada).

alter table public.closer_analisis_agente drop constraint closer_analisis_agente_agente_id_check;
alter table public.closer_analisis_agente add constraint closer_analisis_agente_agente_id_check
  check (agente_id in ('lead-flow-ai', 'appointment-flow-ai', 'lead-flow-voz', 'appointment-flow-voz'));

alter table public.closer_hallazgo_agente drop constraint closer_hallazgo_agente_agente_id_check;
alter table public.closer_hallazgo_agente add constraint closer_hallazgo_agente_agente_id_check
  check (agente_id in ('lead-flow-ai', 'appointment-flow-ai', 'lead-flow-voz', 'appointment-flow-voz'));

alter table public.closer_ajustes_agente drop constraint closer_ajustes_agente_agente_id_check;
alter table public.closer_ajustes_agente add constraint closer_ajustes_agente_agente_id_check
  check (agente_id in ('lead-flow-ai', 'appointment-flow-ai', 'lead-flow-voz', 'appointment-flow-voz'));

notify pgrst, 'reload schema';
